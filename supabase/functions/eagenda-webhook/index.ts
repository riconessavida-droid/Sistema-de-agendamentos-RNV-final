// =====================================================================
// Edge Function: eagenda-webhook
// Recebe as notificações (webhook) do eAgenda e concilia sozinho quando
// dá pra ter certeza:
//   1) person_key já vinculado          -> automático
//   2) telefone bate com cliente ativo  -> automático (+ aprende vínculo)
//   3) 1º+2º nome batem com 1 ativo      -> automático (+ aprende vínculo)
//   senão                               -> fila (PENDING) pra conciliar/cadastrar
// Cancelamento: limpa a data daquele mês (sem mexer em reunião já realizada).
//
// Deploy:  verify-jwt DESLIGADO (o eAgenda não manda JWT).
// Segredo: EAGENDA_WEBHOOK_TOKEN (validação do header Authorization).
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const INACTIVE_STATUSES = new Set(["CLOSED_CONTRACT", "CANCELLED_EARLY"]);
const PROTECTED_STATUSES = new Set(["DONE", "CLOSED_CONTRACT", "CANCELLED_EARLY"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function normalizePhone(raw: string): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d.slice(-11);
}
function normalizeName(s: string): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}
function firstTwoNames(s: string): string {
  return normalizeName(s).split(" ").filter(Boolean).slice(0, 2).join(" ");
}
function parseStart(dateTime: string): { monthKey: string; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateTime ?? "");
  if (!m) return null;
  return { monthKey: `${m[1]}-${m[2]}`, day: parseInt(m[3], 10) };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const expected = Deno.env.get("EAGENDA_WEBHOOK_TOKEN");
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) return json({ error: "unauthorized" }, 401);
  }

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  const event: string = payload?.event ?? "";
  const data = payload?.data ?? {};
  const appointmentKey: string | undefined = data?.appointment_key;
  if (!appointmentKey) return json({ error: "missing appointment_key" }, 400);

  const attendee = Array.isArray(data?.attendees) ? data.attendees[0] : undefined;
  const personKey: string | null = attendee?.person_key ?? null;
  const attendeeName: string | null = attendee?.name ?? null;
  const attendeeEmail: string | null = attendee?.email ?? null;
  const attendeePhone: string = normalizePhone(attendee?.phone ?? "");
  const startDateTime: string = data?.start?.dateTime ?? "";
  const parsed = parseStart(startDateTime);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const isCancel = event.includes("cancel") || (data?.status ?? "").toUpperCase() === "CANCELED";

  async function applyToClient(clientId: string, monthKey: string, day: number | null): Promise<boolean> {
    const { data: client, error } = await supabase
      .from("clients").select("id, status_by_month").eq("id", clientId).single();
    if (error || !client) return false;
    const sbm: Record<string, any> = client.status_by_month ?? {};
    const current = sbm[monthKey] ?? {};
    if (day === null && PROTECTED_STATUSES.has(current.status ?? "")) return true;
    // Regra: dentro do mês vale a ÚLTIMA data (maior dia). Nunca rebaixa.
    let finalDay = day;
    if (day !== null) {
      const curDay = typeof current.customDate === "number" ? current.customDate : null;
      finalDay = (curDay != null && curDay > day) ? curDay : day;
    }
    const nextSbm = { ...sbm, [monthKey]: { ...current, customDate: finalDay, status: current.status ?? "PENDING" } };
    const { error: upErr } = await supabase.from("clients").update({ status_by_month: nextSbm }).eq("id", clientId);
    return !upErr;
  }

  // ---- CANCELAMENTO ----
  if (isCancel) {
    const { data: existing } = await supabase
      .from("eagenda_bookings").select("matched_client_id, month_key, day_of_month")
      .eq("appointment_key", appointmentKey).maybeSingle();
    const clientId = existing?.matched_client_id ?? null;
    const monthKey = existing?.month_key ?? parsed?.monthKey ?? null;
    const canceledDay = existing?.day_of_month ?? parsed?.day ?? null;
    // Só limpa a data do cliente se ela for justamente a do agendamento
    // cancelado (assim cancelar o 22 não apaga um 29 remarcado).
    if (clientId && monthKey && canceledDay != null) {
      const { data: c } = await supabase.from("clients").select("status_by_month").eq("id", clientId).single();
      const cur = c?.status_by_month?.[monthKey];
      if (cur?.customDate === canceledDay) await applyToClient(clientId, monthKey, null);
    }
    await supabase.from("eagenda_bookings")
      .update({ conciliation_status: "CANCELED", event_status: "CANCELED", raw: payload })
      .eq("appointment_key", appointmentKey);
    return json({ ok: true, action: "canceled", clientId, monthKey });
  }

  // ---- CRIAÇÃO / ALTERAÇÃO ----
  if (!parsed) return json({ error: "invalid start.dateTime" }, 400);

  let matchedClientId: string | null = null;
  let matchReason: string | null = null;

  // 1) vínculo já aprendido
  if (personKey) {
    const { data: link } = await supabase
      .from("eagenda_client_links").select("client_id").eq("person_key", personKey).maybeSingle();
    if (link?.client_id) { matchedClientId = link.client_id; matchReason = "link"; }
  }

  // 2) e 3) telefone / nome contra clientes ativos
  if (!matchedClientId) {
    const { data: clientsRaw } = await supabase.from("clients").select("id, name, phone_digits, status_by_month");
    const clients = (clientsRaw ?? []).filter(
      (c: any) => !Object.values(c.status_by_month ?? {}).some((s: any) => INACTIVE_STATUSES.has(s?.status))
    );
    // 2) telefone (precisa bater com exatamente 1 ativo)
    if (attendeePhone) {
      const byPhone = clients.filter((c: any) => normalizePhone(c.phone_digits ?? "") === attendeePhone);
      if (byPhone.length === 1) { matchedClientId = byPhone[0].id; matchReason = "phone"; }
    }
    // 3) 1º+2º nome (precisa bater com exatamente 1 ativo)
    if (!matchedClientId && attendeeName) {
      const target = firstTwoNames(attendeeName);
      if (target) {
        const byName = clients.filter((c: any) => firstTwoNames(c.name ?? "") === target);
        if (byName.length === 1) { matchedClientId = byName[0].id; matchReason = "name"; }
      }
    }
  }

  let conciliationStatus = "PENDING";
  if (matchedClientId) {
    const applied = await applyToClient(matchedClientId, parsed.monthKey, parsed.day);
    if (applied) {
      conciliationStatus = "MATCHED";
      // aprende/atualiza o vínculo pra próxima vez ser instantânea
      if (personKey) {
        await supabase.from("eagenda_client_links").upsert(
          { person_key: personKey, client_id: matchedClientId, linked_name: attendeeName },
          { onConflict: "person_key" },
        );
      }
    } else {
      matchedClientId = null;
    }
  }

  const { error: upsertErr } = await supabase.from("eagenda_bookings").upsert({
    appointment_key: appointmentKey, person_key: personKey, attendee_name: attendeeName,
    attendee_email: attendeeEmail, start_datetime: startDateTime, month_key: parsed.monthKey,
    day_of_month: parsed.day, event_status: (data?.status ?? "PENDING"),
    conciliation_status: conciliationStatus, matched_client_id: matchedClientId, raw: payload,
  }, { onConflict: "appointment_key" });
  if (upsertErr) return json({ error: upsertErr.message }, 500);

  return json({ ok: true, action: conciliationStatus === "MATCHED" ? `auto-matched:${matchReason}` : "queued", matchedClientId });
});
