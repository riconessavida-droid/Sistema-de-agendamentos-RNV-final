// =====================================================================
// Edge Function: send-reminders
// Roda 1x/dia (via cron). Para cada cliente ATIVO, calcula a próxima
// reunião (última reunião feita + ~30 dias) e dispara o lembrete:
//   - 7 dias antes  -> e-mail "vamos marcar sua próxima consultoria?"
//   - 3 dias antes  -> e-mail "sua próxima consultoria ainda está sem data"
// Regras: NÃO manda se o cliente já agendou; NÃO repete um lembrete já
// enviado (reminder_log); a 2ª mensagem não sai se ele agendou depois da 1ª.
//
// O ENVIO era por WhatsApp (webhook do papo.ai) até 17/08/2026. Virou
// e-mail porque aquela cadeia tinha três donos — WABA de terceiro,
// plataforma do parceiro e aprovação da Meta — e nenhum deles é a RNV.
// Em dez dias custou um número perdido, três quedas de canal e cinco dias
// de lembretes que o log dava como enviados sem ninguém receber. Quem
// envia agora é a função send-email, com o domínio da própria RNV.
//
// Segredos: nenhum aqui. A chave do provedor vive na send-email.
//
// Modo teste: POST {"dryRun": true}  -> não envia, só retorna quem receberia.
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

// Valor colado num segredo quase sempre traz espaço ou quebra de linha
// invisível junto, e a Meta REJEITA parâmetro de template com quebra de
// linha (erro 132018). Tudo que vai para o WhatsApp passa por aqui.
const cleanText = (v: string | null | undefined) =>
  (v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
const cleanUrl = (v: string | null | undefined) =>
  (v ?? "").replace(/\s+/g, "").replace(/\/+$/, "");

const newToken = () =>
  (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 32);

/**
 * O link PESSOAL de agendamento do cliente.
 *
 * É o que substitui o link fixo do eAgenda que ficava escrito dentro do
 * template: como o token identifica o cliente, a página já sabe quem ele
 * é, não pede nada e marca a data ideal dos 30 dias.
 *
 * Reaproveita o link existente; só cria na primeira vez.
 */
async function bookingUrlFor(
  supabase: any, clientId: string, siteUrl: string,
): Promise<string> {
  if (!siteUrl) return "";

  const { data: existing } = await supabase
    .from("booking_links")
    .select("token")
    .eq("client_id", clientId)
    .eq("active", true)
    .is("fit_in_starts_at", null)
    .limit(1);

  let token: string | undefined = existing?.[0]?.token;

  if (!token) {
    token = newToken();
    const { error } = await supabase
      .from("booking_links")
      .insert({ token, client_id: clientId });
    // Se não deu para criar o link pessoal, o link geral ainda agenda —
    // só volta a exigir conciliação depois. Melhor que não mandar nada.
    if (error) return `${siteUrl}/agendar`;
  }

  return `${siteUrl}/agendar/${token}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const siteUrl = cleanUrl(Deno.env.get("SITE_URL"));
  let dryRun = false;
  try { const b = await req.json(); if (b?.dryRun === true) dryRun = true; } catch { /* sem body */ }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // "hoje" no fuso de São Paulo, como número de dia (Date.UTC do calendário local)
  const brStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // YYYY-MM-DD
  const [ty, tm, td] = brStr.split("-").map(Number);
  const todayUTC = Date.UTC(ty, tm - 1, td);

  const { data: clientsRaw, error } = await supabase
    .from("clients").select("id, name, email, phone_digits, start_date, start_month_year, extra_meetings, status_by_month");
  if (error) return json({ error: error.message }, 500);
  const clients = clientsRaw ?? [];

  // Só lembrete que REALMENTE saiu bloqueia um novo envio. Antes o dedupe
  // olhava qualquer linha do log, então uma falha silenciava o cliente até
  // o fim do ciclo — o oposto do que se quer de um registro de falha.
  const { data: logRaw } = await supabase
    .from("reminder_log").select("client_id, month_key, reminder_type, status");
  const alreadySent = new Set(
    (logRaw ?? [])
      .filter((r: any) => r.status === "sent" || r.status === "skipped")
      .map((r: any) => `${r.client_id}|${r.month_key}|${r.reminder_type}`),
  );

  // Quem JÁ TEM reunião marcada para frente não recebe cobrança para marcar.
  //
  // Antes olhávamos só o mês previsto: se a próxima era setembro e o
  // cliente agendava para 30/08, a data caía em agosto, setembro ficava
  // vazio e ele recebia "ainda não vi seu agendamento" mesmo tendo
  // agendado. Na virada de mês isso aconteceria toda hora.
  const { data: futuros } = await supabase
    .from("appointments")
    .select("client_id")
    .eq("status", "CONFIRMED")
    .gte("starts_at", new Date().toISOString());

  const jaAgendou = new Set(
    (futuros ?? []).map((a: any) => a.client_id).filter(Boolean),
  );

  const isInactive = (c: any) => Object.values(c.status_by_month ?? {}).some((s: any) => INACTIVE.has(s?.status));

  type Due = { client: any; type: "7d" | "3d"; monthKey: string; daysUntil: number; to: string | null };
  const due: Due[] = [];

  for (const c of clients) {
    if (isInactive(c)) continue;
    if (jaAgendou.has(c.id)) continue;
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

    // Só a DATA MARCADA tira o cliente da fila.
    //
    // O flag `notified` não é mais consultado aqui: ele nasceu do fluxo
    // manual (a assistente avisava e clicava em "Avisar") e passou a
    // silenciar o automático — cliente sem data marcada ficava invisível
    // só porque alguém clicou num botão. Agora ele é CONSEQUÊNCIA do
    // envio, não condição para ele: quem manda marcar é a função, mais
    // abaixo. O que evita mensagem repetida é o reminder_log.
    if (nextEntry?.customDate != null) continue;

    // Quem PASSOU da data prevista continua sendo cobrado por mais 7 dias.
    //
    // Antes a cobrança parava no dia da data prevista: quem estava atrasado
    // — justamente quem mais precisa ser cobrado — sumia do radar para
    // sempre. O dedupe do reminder_log garante que, mesmo com a janela
    // maior, a mensagem sai UMA VEZ SÓ.
    const ATRASO_MAX = 7;

    let type: "7d" | "3d" | null = null;
    if (daysUntil >= 4 && daysUntil <= 7) type = "7d";
    else if (daysUntil >= -ATRASO_MAX && daysUntil <= 3) type = "3d";
    if (!type) continue;

    if (alreadySent.has(`${c.id}|${nextMonthKey}|${type}`)) continue;

    // O destino agora é o e-mail. Era o WhatsApp até 17/08/2026 — trocado
    // porque aquela cadeia tem três donos e nenhum é a RNV.
    due.push({ client: c, type, monthKey: nextMonthKey, daysUntil, to: cleanText(c.email) });
  }

  const summary = { total: due.length, sent: 0, failed: 0, skippedNoEmail: 0, dryRun };
  const details: any[] = [];

  for (const d of due) {
    if (!d.to || !d.to.includes("@")) {
      // Não é erro do envio: é cadastro incompleto. Fica registrado como
      // falha no log para aparecer em vermelho na aba Tarefas do Dia, que
      // é onde a assistente resolve.
      summary.skippedNoEmail++;
      await supabase.from("reminder_log").upsert(
        { client_id: d.client.id, month_key: d.monthKey, reminder_type: d.type, status: "failed", detail: "cliente sem e-mail cadastrado" },
        { onConflict: "client_id,month_key,reminder_type" },
      );
      details.push({ client: d.client.name, type: d.type, status: "no_email" });
      continue;
    }

    const payload = {
      template: d.type === "7d" ? "cobranca7" : "cobranca3",
      to: d.to,
      data: {
        first_name: firstName(d.client.name),
        full_name: d.client.name,
        booking_url: await bookingUrlFor(supabase, d.client.id, siteUrl),
      },
    };

    if (dryRun) {
      details.push({ client: d.client.name, type: d.type, to: d.to, status: "dry" });
      continue;
    }

    const targetUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`;

    try {
      const resp = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify(payload),
      });
      const text = await resp.text();

      // Só conta como enviado o que o provedor ACEITOU DE VERDADE.
      //
      // A lição vem do WhatsApp: entre 08 e 13/08/2026 o canal ficou
      // desconectado, o papo.ai seguiu respondendo 200 por "ter aceitado o
      // POST", e 19 lembretes foram gravados como enviados sem nunca sair.
      // Como o dedupe olha o log, aqueles clientes ficaram silenciados até
      // alguém apagar as linhas na mão.
      //
      // A send-email devolve {ok:true, id} quando o Resend aceitou, e
      // {ok:false, error} em qualquer outro caso. Nada de otimismo aqui.
      const accepted = (() => {
        if (!resp.ok) return { ok: false, why: `HTTP ${resp.status}` };
        try {
          const body = JSON.parse(text);
          if (body?.ok !== true) return { ok: false, why: body?.error ?? "envio recusado" };
          return { ok: true, why: "" };
        } catch {
          return { ok: false, why: "resposta ilegível do envio" };
        }
      })();

      if (accepted.ok) {
        summary.sent++;
        await supabase.from("reminder_log").upsert(
          { client_id: d.client.id, month_key: d.monthKey, reminder_type: d.type, status: "sent", detail: text.slice(0, 200) },
          { onConflict: "client_id,month_key,reminder_type" },
        );

        // Acende o "Avisado ✓" na tela sozinho. Antes alguém tinha que
        // clicar; agora o botão mostra o que o sistema realmente fez.
        const sbm = { ...(d.client.status_by_month ?? {}) };
        sbm[d.monthKey] = { status: "PENDING", ...(sbm[d.monthKey] ?? {}), notified: true };
        await supabase.from("clients").update({ status_by_month: sbm }).eq("id", d.client.id);

        details.push({ client: d.client.name, type: d.type, to: d.to, status: "sent" });
      } else {
        // Não saiu: registra como falha, com o motivo escrito. Fica em
        // vermelho na aba Tarefas do Dia e é tentado de novo amanhã —
        // falha nunca silencia o cliente até o fim do ciclo.
        summary.failed++;
        await supabase.from("reminder_log").upsert(
          { client_id: d.client.id, month_key: d.monthKey, reminder_type: d.type, status: "failed", detail: `${accepted.why}: ${text.slice(0, 160)}` },
          { onConflict: "client_id,month_key,reminder_type" },
        );
        details.push({ client: d.client.name, type: d.type, status: "failed", why: accepted.why });
      }
    } catch (e) {
      summary.failed++;
      await supabase.from("reminder_log").upsert(
        { client_id: d.client.id, month_key: d.monthKey, reminder_type: d.type, status: "failed", detail: String(e).slice(0, 200) },
        { onConflict: "client_id,month_key,reminder_type" },
      );
      details.push({ client: d.client.name, type: d.type, status: "error", error: String(e) });
    }
  }

  return json({ ok: true, today: brStr, summary, details });
});
