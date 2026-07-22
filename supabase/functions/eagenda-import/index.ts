// =====================================================================
// Edge Function: eagenda-import
// Adianta a conciliação ANCORADO nos clientes ATIVOS do nosso sistema:
// para cada agendamento do eAgenda DENTRO DE UMA JANELA de dias (±N),
// tenta casar com um cliente ATIVO (por telefone ou 1º+2º nome).
//   - casou com ativo   -> preenche a data + aprende o vínculo (MATCHED)
//   - casou com inativo -> IGNORA (regra: só ativos)
//   - não casou         -> fila "não achei" (PENDING) — poucos, por causa da janela
// Fora da janela de dias -> ignora.
//
// Body opcional (JSON): { "daysBack": 15, "daysForward": 15 }
//
// Deploy COM verify-jwt LIGADO. Segredo: EAGENDA_API_TOKEN.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EAGENDA_BASE = "https://eagenda.com.br/api/v3";
const INACTIVE_STATUSES = new Set(["CLOSED_CONTRACT", "CANCELLED_EARLY"]);
const PROTECTED_STATUSES = new Set(["DONE", "CLOSED_CONTRACT", "CANCELLED_EARLY"]);
const SKIP_EVENT_STATUSES = new Set(["CANCELED", "NO_SHOW"]);
const MAX_PAGES = 100;
const DEFAULT_WINDOW = 15;

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

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
function dateOnly(dateTime: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(dateTime ?? "");
  return m ? m[1] : null;
}
function parseStart(dateTime: string): { monthKey: string; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateTime ?? "");
  if (!m) return null;
  return { monthKey: `${m[1]}-${m[2]}`, day: parseInt(m[3], 10) };
}
function addDaysISO(base: Date, delta: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const apiToken = Deno.env.get("EAGENDA_API_TOKEN");
  if (!apiToken) return json({ error: "EAGENDA_API_TOKEN não configurado" }, 500);

  // Janela de dias (padrão ±15)
  let daysBack = DEFAULT_WINDOW, daysForward = DEFAULT_WINDOW;
  try {
    const body = await req.json();
    if (Number.isFinite(body?.daysBack)) daysBack = Math.max(0, Math.min(365, body.daysBack));
    if (Number.isFinite(body?.daysForward)) daysForward = Math.max(0, Math.min(365, body.daysForward));
  } catch { /* sem body = usa padrão */ }

  const now = new Date();
  const windowStart = addDaysISO(now, -daysBack);   // YYYY-MM-DD
  const windowEnd = addDaysISO(now, daysForward);   // YYYY-MM-DD

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ---- Índices dos clientes ATIVOS (âncora) -------------------------
  const { data: clientsRaw, error: cErr } = await supabase
    .from("clients").select("id, name, phone_digits, status_by_month");
  if (cErr) return json({ error: cErr.message }, 500);
  const clients = clientsRaw ?? [];
  const isInactive = (c: any) =>
    Object.values(c.status_by_month ?? {}).some((s: any) => INACTIVE_STATUSES.has(s?.status));

  const activeByPhone = new Map<string, any>();
  const activeByName = new Map<string, any | null>(); // null = ambíguo (2+ ativos)
  let activeCount = 0;
  for (const c of clients) {
    if (isInactive(c)) continue;
    activeCount++;
    const p = normalizePhone(c.phone_digits ?? "");
    if (p) activeByPhone.set(p, c);
    const n = firstTwoNames(c.name ?? "");
    if (n) activeByName.set(n, activeByName.has(n) ? null : c);
  }
  const clientById = new Map(clients.map((c: any) => [c.id, c]));

  const { data: linksRaw } = await supabase.from("eagenda_client_links").select("person_key, client_id");
  const linkByPerson = new Map((linksRaw ?? []).map((l: any) => [l.person_key, l.client_id]));

  async function applyToClient(clientId: string, monthKey: string, day: number): Promise<boolean> {
    const c = clientById.get(clientId);
    if (!c) return false;
    const sbm = c.status_by_month ?? {};
    const current = sbm[monthKey] ?? {};
    if (PROTECTED_STATUSES.has(current.status ?? "") && current.customDate != null) return true;
    const nextSbm = { ...sbm, [monthKey]: { ...current, customDate: day, status: current.status ?? "PENDING" } };
    const { error } = await supabase.from("clients").update({ status_by_month: nextSbm }).eq("id", clientId);
    if (!error) c.status_by_month = nextSbm;
    return !error;
  }

  // ---- Puxa agendamentos do eAgenda (paginado) ----------------------
  const appointments: any[] = [];
  let url: string | null = `${EAGENDA_BASE}/appointments/`;
  let pages = 0;
  try {
    while (url && pages < MAX_PAGES) {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
      if (!resp.ok) return json({ error: `eAgenda respondeu ${resp.status}`, detail: (await resp.text()).slice(0, 500) }, 502);
      const body = await resp.json();
      const batch = Array.isArray(body) ? body : (body.results ?? body.data ?? []);
      appointments.push(...batch);
      url = (body && typeof body === "object" && body.next) ? body.next : null;
      pages++;
    }
  } catch (e) {
    return json({ error: `Falha ao chamar a API do eAgenda: ${String(e)}` }, 502);
  }

  // ---- Processa só o que está DENTRO da janela ----------------------
  const summary = {
    activeClients: activeCount, windowStart, windowEnd,
    totalFromApi: appointments.length, inWindow: 0,
    autoMatched: 0, notFound: 0, skippedInactive: 0, skippedStatus: 0, outOfWindow: 0, invalid: 0,
  };

  for (const appt of appointments) {
    const appointmentKey = appt?.appointment_key;
    const status = String(appt?.status ?? "").toUpperCase();
    if (!appointmentKey) { summary.invalid++; continue; }

    const day = dateOnly(appt?.start?.dateTime ?? "");
    if (!day) { summary.invalid++; continue; }
    if (day < windowStart || day > windowEnd) { summary.outOfWindow++; continue; }
    summary.inWindow++;

    if (SKIP_EVENT_STATUSES.has(status)) { summary.skippedStatus++; continue; }

    const attendee = Array.isArray(appt?.attendees) ? appt.attendees[0] : undefined;
    const personKey = attendee?.person_key ?? null;
    const name = attendee?.name ?? null;
    const email = attendee?.email ?? null;
    const phone = normalizePhone(attendee?.phone ?? "");
    const parsed = parseStart(appt?.start?.dateTime ?? "");
    if (!parsed) { summary.invalid++; continue; }

    // Match SÓ contra clientes ativos: vínculo -> telefone -> 1º+2º nome
    let clientId: string | null = null;
    if (personKey && linkByPerson.has(personKey)) {
      const linked = linkByPerson.get(personKey)!;
      if (clientById.has(linked) && !isInactive(clientById.get(linked))) clientId = linked;
    }
    if (!clientId && phone && activeByPhone.has(phone)) clientId = activeByPhone.get(phone).id;
    if (!clientId && name) {
      const n = firstTwoNames(name);
      const byName = n ? activeByName.get(n) : undefined;
      if (byName) clientId = byName.id;
    }

    // Bateu com cliente ENCERRADO? Ignora de vez (regra: só ativos).
    if (!clientId && (phone || name)) {
      const inactiveHit = clients.find((c: any) =>
        isInactive(c) && (
          (phone && normalizePhone(c.phone_digits ?? "") === phone) ||
          (name && firstTwoNames(c.name ?? "") === firstTwoNames(name))
        )
      );
      if (inactiveHit) { summary.skippedInactive++; continue; }
    }

    const base = {
      appointment_key: appointmentKey, person_key: personKey, attendee_name: name, attendee_email: email,
      start_datetime: appt?.start?.dateTime, month_key: parsed.monthKey, day_of_month: parsed.day,
      event_status: status, raw: appt,
    };

    if (clientId) {
      // Não mexe no que já foi conciliado/ignorado manualmente antes.
      const { data: prev } = await supabase
        .from("eagenda_bookings").select("conciliation_status").eq("appointment_key", appointmentKey).maybeSingle();
      if (prev?.conciliation_status === "IGNORED") { summary.skippedStatus++; continue; }

      if (personKey && !linkByPerson.has(personKey)) {
        await supabase.from("eagenda_client_links").upsert({ person_key: personKey, client_id: clientId, linked_name: name }, { onConflict: "person_key" });
        linkByPerson.set(personKey, clientId);
      }
      await applyToClient(clientId, parsed.monthKey, parsed.day);
      await supabase.from("eagenda_bookings").upsert({ ...base, conciliation_status: "MATCHED", matched_client_id: clientId }, { onConflict: "appointment_key" });
      summary.autoMatched++;
    } else {
      // Não é cliente ativo -> só conta, NÃO cria pendência (só nos importam os ativos).
      summary.notFound++;
    }
  }

  return json({ ok: true, summary });
});
