// =====================================================================
// Edge Function: send-reminders
// Roda 1x/dia (via cron). Para cada cliente ATIVO, calcula a próxima
// reunião (última reunião feita + ~30 dias) e envia lembrete no WhatsApp:
//   - 7 dias antes  -> template "lembrete_7dias"
//   - 3 dias antes  -> template "lembrete_3dias"
// Regras: NÃO manda se o cliente já agendou aquele mês; NÃO repete um
// lembrete já enviado (reminder_log); a 2ª mensagem não sai se ele agendou
// depois da 1ª (a data preenchida faz pular).
//
// Envio via Meta Cloud API (Coexistence no número da assistente).
// Segredos: WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID.
// Modo teste: POST {"dryRun": true}  -> não envia, só retorna quem receberia.
// Sem WA_ACCESS_TOKEN configurado -> assume dry-run automaticamente.
//
// Deploy COM verify-jwt LIGADO (chamado pelo cron com a anon key).
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_VERSION = "v21.0";
const INACTIVE = new Set(["CLOSED_CONTRACT", "CANCELLED_EARLY"]);
const CYCLE_DAYS = 30;
const TEMPLATE_7D = "lembrete_7dias";
const TEMPLATE_3D = "lembrete_3dias";
const LANG = "pt_BR";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...cors } });

function getNextMonths(startMonthYear: string, count: number): string[] {
  const [y, m] = startMonthYear.split("-").map(Number);
  const res: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    res.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return res;
}
const monthKeyFromUTC = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
function firstName(name: string): string {
  const n = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "";
}
// telefone do cliente -> E.164 sem "+", com 55 na frente
function toWhatsApp(raw: string): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(-11);
  if (d.length < 10) return null;
  return "55" + d;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const token = Deno.env.get("WA_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WA_PHONE_NUMBER_ID");
  let dryRun = !token || !phoneNumberId;
  try { const b = await req.json(); if (b?.dryRun === true) dryRun = true; } catch { /* sem body */ }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // "hoje" no fuso de São Paulo, como número de dia (Date.UTC do calendário local)
  const brStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // YYYY-MM-DD
  const [ty, tm, td] = brStr.split("-").map(Number);
  const todayUTC = Date.UTC(ty, tm - 1, td);

  const { data: clientsRaw, error } = await supabase
    .from("clients").select("id, name, phone_digits, start_date, start_month_year, extra_meetings, status_by_month");
  if (error) return json({ error: error.message }, 500);
  const clients = clientsRaw ?? [];

  // lembretes já enviados (para não repetir)
  const { data: logRaw } = await supabase.from("reminder_log").select("client_id, month_key, reminder_type");
  const alreadySent = new Set((logRaw ?? []).map((r: any) => `${r.client_id}|${r.month_key}|${r.reminder_type}`));

  const isInactive = (c: any) => Object.values(c.status_by_month ?? {}).some((s: any) => INACTIVE.has(s?.status));

  type Due = { client: any; type: "7d" | "3d"; monthKey: string; daysUntil: number; to: string | null };
  const due: Due[] = [];

  for (const c of clients) {
    if (isInactive(c)) continue;
    const total = 5 + (c.extra_meetings ?? 0);
    const cycle = getNextMonths(c.start_month_year, total);
    const sbm = c.status_by_month ?? {};

    // última reunião FEITA
    let lastDoneUTC: number | null = null;
    for (let i = cycle.length - 1; i >= 0; i--) {
      const s = sbm[cycle[i]];
      if (s?.status === "DONE") {
        const day = s.customDate || c.start_date || 1;
        const [yy, mm] = cycle[i].split("-").map(Number);
        lastDoneUTC = Date.UTC(yy, mm - 1, day);
        break;
      }
    }
    if (lastDoneUTC == null) continue;

    const nextUTC = lastDoneUTC + CYCLE_DAYS * 86400000;
    const daysUntil = Math.round((nextUTC - todayUTC) / 86400000);
    const nextMonthKey = monthKeyFromUTC(nextUTC);
    const nextEntry = sbm[nextMonthKey];

    // já agendou (data preenchida) OU já avisado manualmente -> não manda
    if (nextEntry?.customDate != null || nextEntry?.notified === true) continue;

    // janelas (com folga para o caso do cron falhar num dia):
    let type: "7d" | "3d" | null = null;
    if (daysUntil >= 4 && daysUntil <= 7) type = "7d";
    else if (daysUntil >= 1 && daysUntil <= 3) type = "3d";
    if (!type) continue;

    if (alreadySent.has(`${c.id}|${nextMonthKey}|${type}`)) continue;

    due.push({ client: c, type, monthKey: nextMonthKey, daysUntil, to: toWhatsApp(c.phone_digits) });
  }

  const summary = { total: due.length, sent: 0, failed: 0, skippedNoPhone: 0, dryRun };
  const details: any[] = [];

  for (const d of due) {
    const templateName = d.type === "7d" ? TEMPLATE_7D : TEMPLATE_3D;
    if (!d.to) {
      summary.skippedNoPhone++;
      details.push({ client: d.client.name, type: d.type, status: "no_phone" });
      continue;
    }

    if (dryRun) {
      details.push({ client: d.client.name, to: d.to, type: d.type, monthKey: d.monthKey, template: templateName, status: "dry" });
      continue;
    }

    try {
      const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: d.to,
          type: "template",
          template: {
            name: templateName,
            language: { code: LANG },
            components: [{ type: "body", parameters: [{ type: "text", text: firstName(d.client.name) }] }],
          },
        }),
      });
      const body = await resp.json();
      if (resp.ok) {
        const waId = body?.messages?.[0]?.id ?? null;
        summary.sent++;
        await supabase.from("reminder_log").upsert(
          { client_id: d.client.id, month_key: d.monthKey, reminder_type: d.type, status: "sent", wa_message_id: waId },
          { onConflict: "client_id,month_key,reminder_type" },
        );
        details.push({ client: d.client.name, type: d.type, status: "sent", waId });
      } else {
        summary.failed++;
        const msg = JSON.stringify(body?.error ?? body).slice(0, 300);
        await supabase.from("reminder_log").upsert(
          { client_id: d.client.id, month_key: d.monthKey, reminder_type: d.type, status: "failed", detail: msg },
          { onConflict: "client_id,month_key,reminder_type" },
        );
        details.push({ client: d.client.name, type: d.type, status: "failed", error: msg });
      }
    } catch (e) {
      summary.failed++;
      details.push({ client: d.client.name, type: d.type, status: "error", error: String(e) });
    }
  }

  return json({ ok: true, today: brStr, summary, details });
});
