// =====================================================================
// Edge Function: send-reminders
// Roda 1x/dia (via cron). Para cada cliente ATIVO, calcula a próxima
// reunião (última reunião feita + ~30 dias) e dispara lembrete:
//   - 7 dias antes  -> POST no webhook do parceiro (template 7 dias)
//   - 3 dias antes  -> POST no webhook do parceiro (template 3 dias)
// Regras: NÃO manda se o cliente já agendou aquele mês; NÃO repete um
// lembrete já enviado (reminder_log); a 2ª mensagem não sai se ele agendou
// depois da 1ª (a data preenchida faz pular).
//
// O ENVIO em si é feito pela plataforma do parceiro (empresa da IA que já
// usa o número da assistente). Nosso sistema só faz um POST para o
// "webhook de entrada" deles, com os dados do destinatário; eles enviam
// o template aprovado. Assim usamos o número da assistente sem conflito.
//
// Segredos:
//   REMINDER_WEBHOOK_7D_URL  -> webhook do parceiro que envia o template de 7 dias
//   REMINDER_WEBHOOK_3D_URL  -> webhook do parceiro que envia o template de 3 dias
//   REMINDER_WEBHOOK_TOKEN   -> (opcional) valor do header Authorization, se exigirem
//
// Modo teste: POST {"dryRun": true}  -> não envia, só retorna quem receberia.
// Sem as URLs configuradas -> dry-run automático.
//
// Deploy COM verify-jwt LIGADO (chamado pelo cron com a anon key).
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const INACTIVE = new Set(["CLOSED_CONTRACT", "CANCELLED_EARLY"]);
const CYCLE_DAYS = 30;

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

  const url7d = Deno.env.get("REMINDER_WEBHOOK_7D_URL");
  const url3d = Deno.env.get("REMINDER_WEBHOOK_3D_URL");
  const authHeader = Deno.env.get("REMINDER_WEBHOOK_TOKEN"); // opcional
  let dryRun = !url7d && !url3d;
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

    if (nextEntry?.customDate != null || nextEntry?.notified === true) continue;

    let type: "7d" | "3d" | null = null;
    if (daysUntil >= 4 && daysUntil <= 7) type = "7d";
    else if (daysUntil >= 1 && daysUntil <= 3) type = "3d";
    if (!type) continue;

    if (alreadySent.has(`${c.id}|${nextMonthKey}|${type}`)) continue;

    due.push({ client: c, type, monthKey: nextMonthKey, daysUntil, to: toWhatsApp(c.phone_digits) });
  }

  const summary = { total: due.length, sent: 0, failed: 0, skippedNoPhone: 0, skippedNoUrl: 0, dryRun };
  const details: any[] = [];

  for (const d of due) {
    if (!d.to) {
      summary.skippedNoPhone++;
      details.push({ client: d.client.name, type: d.type, status: "no_phone" });
      continue;
    }

    const payload = {
      phone: d.to,
      first_name: firstName(d.client.name),
      full_name: d.client.name,
      reminder_type: d.type,
      month_key: d.monthKey,
    };

    if (dryRun) {
      details.push({ ...payload, status: "dry" });
      continue;
    }

    const targetUrl = d.type === "7d" ? url7d : url3d;
    if (!targetUrl) {
      summary.skippedNoUrl++;
      details.push({ client: d.client.name, type: d.type, status: "no_url" });
      continue;
    }

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authHeader) headers["Authorization"] = authHeader;
      const resp = await fetch(targetUrl, { method: "POST", headers, body: JSON.stringify(payload) });
      const text = await resp.text();
      if (resp.ok) {
        summary.sent++;
        await supabase.from("reminder_log").upsert(
          { client_id: d.client.id, month_key: d.monthKey, reminder_type: d.type, status: "sent", detail: text.slice(0, 200) },
          { onConflict: "client_id,month_key,reminder_type" },
        );
        details.push({ client: d.client.name, type: d.type, status: "sent" });
      } else {
        summary.failed++;
        await supabase.from("reminder_log").upsert(
          { client_id: d.client.id, month_key: d.monthKey, reminder_type: d.type, status: "failed", detail: `${resp.status}: ${text.slice(0, 200)}` },
          { onConflict: "client_id,month_key,reminder_type" },
        );
        details.push({ client: d.client.name, type: d.type, status: "failed", http: resp.status });
      }
    } catch (e) {
      summary.failed++;
      details.push({ client: d.client.name, type: d.type, status: "error", error: String(e) });
    }
  }

  return json({ ok: true, today: brStr, summary, details });
});
