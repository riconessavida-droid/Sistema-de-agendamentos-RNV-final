// =====================================================================
// Edge Function: eagenda-webhook
// Recebe as notificações (webhook) do eAgenda e:
//   - agendamento criado/alterado -> grava na fila e, se a pessoa já
//     tem vínculo, preenche a data no cliente automaticamente;
//   - agendamento cancelado -> limpa a data daquele mês (se ainda pendente).
//
// Deploy:  supabase functions deploy eagenda-webhook --no-verify-jwt
// Segredo: supabase secrets set EAGENDA_WEBHOOK_TOKEN=algum-token-secreto
//
// No painel do eAgenda, configure o webhook apontando para:
//   https://<SEU-PROJ>.supabase.co/functions/v1/eagenda-webhook
// com o header Authorization: Bearer <EAGENDA_WEBHOOK_TOKEN>
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Status que NÃO devem ter a data sobrescrita/apagada por um cancelamento,
// pois representam reunião já realizada / cliente encerrado (vêm do cash-in).
const PROTECTED_STATUSES = new Set([
  "DONE",
  "CLOSED_CONTRACT",
  "CANCELLED_EARLY",
]);

type MonthEntry = {
  status?: string;
  customDate?: number | null;
  notified?: boolean;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// "2026-07-28T14:00:00" -> { monthKey: "2026-07", day: 28 }  (sem virar dia
// anterior por fuso: lemos direto os caracteres da string ISO local).
function parseStart(dateTime: string): { monthKey: string; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateTime ?? "");
  if (!m) return null;
  return { monthKey: `${m[1]}-${m[2]}`, day: parseInt(m[3], 10) };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // ---- autenticação do webhook -------------------------------------
  const expected = Deno.env.get("EAGENDA_WEBHOOK_TOKEN");
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) return json({ error: "unauthorized" }, 401);
  }

  // ---- payload ------------------------------------------------------
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const event: string = payload?.event ?? "";
  const data = payload?.data ?? {};
  const appointmentKey: string | undefined = data?.appointment_key;
  if (!appointmentKey) return json({ error: "missing appointment_key" }, 400);

  const attendee = Array.isArray(data?.attendees) ? data.attendees[0] : undefined;
  const personKey: string | null = attendee?.person_key ?? null;
  const attendeeName: string | null = attendee?.name ?? null;
  const attendeeEmail: string | null = attendee?.email ?? null;
  const startDateTime: string = data?.start?.dateTime ?? "";
  const parsed = parseStart(startDateTime);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const isCancel =
    event.includes("cancel") || (data?.status ?? "").toUpperCase() === "CANCELED";

  // -------------------------------------------------------------------
  // Aplica (ou limpa) a data no cliente. Nunca rebaixa status protegido.
  // -------------------------------------------------------------------
  async function applyToClient(
    clientId: string,
    monthKey: string,
    day: number | null,
  ): Promise<boolean> {
    const { data: client, error } = await supabase
      .from("clients")
      .select("id, status_by_month")
      .eq("id", clientId)
      .single();
    if (error || !client) return false;

    const sbm: Record<string, MonthEntry> = client.status_by_month ?? {};
    const current: MonthEntry = sbm[monthKey] ?? {};

    // Cancelamento não mexe em reunião já realizada / encerrada.
    if (day === null && PROTECTED_STATUSES.has(current.status ?? "")) return true;

    const nextEntry: MonthEntry = {
      ...current,
      customDate: day, // null limpa a data
      // "só a data": mantém o status atual; se não havia, fica PENDING.
      status: current.status ?? "PENDING",
    };

    const nextSbm = { ...sbm, [monthKey]: nextEntry };
    const { error: upErr } = await supabase
      .from("clients")
      .update({ status_by_month: nextSbm })
      .eq("id", clientId);
    return !upErr;
  }

  // -------------------------------------------------------------------
  // CANCELAMENTO
  // -------------------------------------------------------------------
  if (isCancel) {
    // Descobre a que cliente/mês esse agendamento pertencia.
    const { data: existing } = await supabase
      .from("eagenda_bookings")
      .select("matched_client_id, month_key")
      .eq("appointment_key", appointmentKey)
      .maybeSingle();

    const clientId = existing?.matched_client_id ?? null;
    const monthKey = existing?.month_key ?? parsed?.monthKey ?? null;

    if (clientId && monthKey) {
      await applyToClient(clientId, monthKey, null); // limpa a data
    }

    await supabase
      .from("eagenda_bookings")
      .update({ conciliation_status: "CANCELED", event_status: "CANCELED", raw: payload })
      .eq("appointment_key", appointmentKey);

    return json({ ok: true, action: "canceled", clientId, monthKey });
  }

  // -------------------------------------------------------------------
  // CRIAÇÃO / ALTERAÇÃO
  // -------------------------------------------------------------------
  if (!parsed) return json({ error: "invalid start.dateTime" }, 400);

  // A pessoa já foi vinculada a um cliente antes?
  let matchedClientId: string | null = null;
  let conciliationStatus = "PENDING";
  if (personKey) {
    const { data: link } = await supabase
      .from("eagenda_client_links")
      .select("client_id")
      .eq("person_key", personKey)
      .maybeSingle();
    if (link?.client_id) {
      const applied = await applyToClient(link.client_id, parsed.monthKey, parsed.day);
      if (applied) {
        matchedClientId = link.client_id;
        conciliationStatus = "MATCHED";
      }
    }
  }

  // Registra/atualiza na fila (upsert pela chave do agendamento).
  const { error: upsertErr } = await supabase.from("eagenda_bookings").upsert(
    {
      appointment_key: appointmentKey,
      person_key: personKey,
      attendee_name: attendeeName,
      attendee_email: attendeeEmail,
      start_datetime: startDateTime,
      month_key: parsed.monthKey,
      day_of_month: parsed.day,
      event_status: (data?.status ?? "PENDING"),
      conciliation_status: conciliationStatus,
      matched_client_id: matchedClientId,
      raw: payload,
    },
    { onConflict: "appointment_key" },
  );

  if (upsertErr) return json({ error: upsertErr.message }, 500);

  return json({
    ok: true,
    action: conciliationStatus === "MATCHED" ? "auto-matched" : "queued",
    matchedClientId,
  });
});
