// =====================================================================
// Edge Function: eagenda-import
// Puxa os agendamentos existentes da API do eAgenda e adianta a
// conciliação: casa por TELEFONE só com clientes ATIVOS, preenche as
// datas e aprende os vínculos (person_key -> cliente). O que não casar
// por telefone vai para a fila (PENDING) para conciliação manual.
// Agendamentos de clientes já encerrados são ignorados.
//
// Chamada pelo frontend (admin) via supabase.functions.invoke.
// Deploy COM verify-jwt LIGADO (só quem tem a anon key do projeto chama).
//
// Segredo necessário:
//   supabase secrets set EAGENDA_API_TOKEN=<seu-token-da-api-eagenda>
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EAGENDA_BASE = "https://eagenda.com.br/api/v3";
const INACTIVE_STATUSES = new Set(["CLOSED_CONTRACT", "CANCELLED_EARLY"]);
const PROTECTED_STATUSES = new Set(["DONE", "CLOSED_CONTRACT", "CANCELLED_EARLY"]);
// Status do eAgenda que NÃO devem virar reunião marcada.
const SKIP_EVENT_STATUSES = new Set(["CANCELED", "NO_SHOW"]);
const MAX_PAGES = 50; // trava de segurança para a paginação

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  };
}

// Só os últimos 11 dígitos (DDD + celular), removendo o 55 do país se vier.
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

// "2026-07-28T14:00:00" -> { monthKey: "2026-07", day: 28 }
function parseStart(dateTime: string): { monthKey: string; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateTime ?? "");
  if (!m) return null;
  return { monthKey: `${m[1]}-${m[2]}`, day: parseInt(m[3], 10) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const apiToken = Deno.env.get("EAGENDA_API_TOKEN");
  if (!apiToken) return json({ error: "EAGENDA_API_TOKEN não configurado" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---- 1) Carrega clientes e monta os índices de matching -----------
  const { data: clientsRaw, error: cErr } = await supabase
    .from("clients")
    .select("id, name, phone_digits, status_by_month");
  if (cErr) return json({ error: cErr.message }, 500);

  const clients = clientsRaw ?? [];
  const isInactive = (c: any) =>
    Object.values(c.status_by_month ?? {}).some((s: any) => INACTIVE_STATUSES.has(s?.status));

  const activeByPhone = new Map<string, any>();
  // nome (1º+2º) -> cliente único; se dois ativos têm o mesmo, marca null (ambíguo)
  const activeByName = new Map<string, any | null>();
  for (const c of clients) {
    if (isInactive(c)) continue;
    const p = normalizePhone(c.phone_digits ?? "");
    if (p) activeByPhone.set(p, c);
    const n = firstTwoNames(c.name ?? "");
    if (n) activeByName.set(n, activeByName.has(n) ? null : c);
  }
  const clientById = new Map(clients.map((c: any) => [c.id, c]));

  // Vínculos já aprendidos.
  const { data: linksRaw } = await supabase
    .from("eagenda_client_links")
    .select("person_key, client_id");
  const linkByPerson = new Map((linksRaw ?? []).map((l: any) => [l.person_key, l.client_id]));

  // ---- 2) Aplica data no cliente (mesma regra do webhook) -----------
  async function applyToClient(clientId: string, monthKey: string, day: number): Promise<boolean> {
    const c = clientById.get(clientId);
    if (!c) return false;
    const sbm = c.status_by_month ?? {};
    const current = sbm[monthKey] ?? {};
    if (PROTECTED_STATUSES.has(current.status ?? "") && current.customDate != null) return true;
    const nextSbm = {
      ...sbm,
      [monthKey]: { ...current, customDate: day, status: current.status ?? "PENDING" },
    };
    const { error } = await supabase.from("clients").update({ status_by_month: nextSbm }).eq("id", clientId);
    if (!error) c.status_by_month = nextSbm; // mantém o cache local coerente
    return !error;
  }

  // ---- 3) Puxa os agendamentos do eAgenda (com paginação) -----------
  const appointments: any[] = [];
  let url: string | null = `${EAGENDA_BASE}/appointments/`;
  let pages = 0;
  try {
    while (url && pages < MAX_PAGES) {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
      if (!resp.ok) {
        const text = await resp.text();
        return json({ error: `eAgenda respondeu ${resp.status}`, detail: text.slice(0, 500) }, 502);
      }
      const body = await resp.json();
      const batch = Array.isArray(body) ? body : (body.results ?? body.data ?? []);
      appointments.push(...batch);
      url = (body && typeof body === "object" && body.next) ? body.next : null;
      pages++;
    }
  } catch (e) {
    return json({ error: `Falha ao chamar a API do eAgenda: ${String(e)}` }, 502);
  }

  // ---- 4) Processa cada agendamento ---------------------------------
  const summary = { total: appointments.length, autoMatched: 0, queued: 0, skippedInactive: 0, skippedStatus: 0, invalid: 0 };

  for (const appt of appointments) {
    const appointmentKey = appt?.appointment_key;
    const status = String(appt?.status ?? "").toUpperCase();
    if (!appointmentKey) { summary.invalid++; continue; }
    if (SKIP_EVENT_STATUSES.has(status)) { summary.skippedStatus++; continue; }

    const attendee = Array.isArray(appt?.attendees) ? appt.attendees[0] : undefined;
    const personKey = attendee?.person_key ?? null;
    const name = attendee?.name ?? null;
    const email = attendee?.email ?? null;
    const phone = normalizePhone(attendee?.phone ?? "");
    const parsed = parseStart(appt?.start?.dateTime ?? "");
    if (!parsed) { summary.invalid++; continue; }

    // Descobre o cliente: 1º pelo vínculo, 2º pelo telefone.
    let clientId: string | null = null;
    if (personKey && linkByPerson.has(personKey)) {
      const linked = linkByPerson.get(personKey)!;
      if (clientById.has(linked) && !isInactive(clientById.get(linked))) clientId = linked;
    }
    if (!clientId && phone && activeByPhone.has(phone)) {
      clientId = activeByPhone.get(phone).id;
    }
    // Sem telefone batendo: tenta 1º+2º nome (só se for único entre os ativos).
    if (!clientId && name) {
      const n = firstTwoNames(name);
      const byName = n ? activeByName.get(n) : undefined;
      if (byName) clientId = byName.id;
    }

    // Telefone bateu com um cliente ENCERRADO? Ignora (regra: só ativos).
    if (!clientId && phone) {
      const anyClient = clients.find((c: any) => normalizePhone(c.phone_digits ?? "") === phone);
      if (anyClient && isInactive(anyClient)) { summary.skippedInactive++; continue; }
    }

    if (clientId) {
      // Auto-concilia: aprende vínculo + preenche data.
      if (personKey && !linkByPerson.has(personKey)) {
        await supabase.from("eagenda_client_links").upsert(
          { person_key: personKey, client_id: clientId, linked_name: name },
          { onConflict: "person_key" },
        );
        linkByPerson.set(personKey, clientId);
      }
      await applyToClient(clientId, parsed.monthKey, parsed.day);
      await supabase.from("eagenda_bookings").upsert({
        appointment_key: appointmentKey, person_key: personKey, attendee_name: name,
        attendee_email: email, start_datetime: appt?.start?.dateTime, month_key: parsed.monthKey,
        day_of_month: parsed.day, event_status: status, conciliation_status: "MATCHED",
        matched_client_id: clientId, raw: appt,
      }, { onConflict: "appointment_key" });
      summary.autoMatched++;
    } else {
      // Sem match confiável -> fila para conciliação manual (dropdown = só ativos).
      await supabase.from("eagenda_bookings").upsert({
        appointment_key: appointmentKey, person_key: personKey, attendee_name: name,
        attendee_email: email, start_datetime: appt?.start?.dateTime, month_key: parsed.monthKey,
        day_of_month: parsed.day, event_status: status, conciliation_status: "PENDING",
        matched_client_id: null, raw: appt,
      }, { onConflict: "appointment_key" });
      summary.queued++;
    }
  }

  return json({ ok: true, summary });
});
