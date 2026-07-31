// =====================================================================
// Edge Function: scheduling-notify
// Roda uma vez por dia (cron das 21h BRT) e faz duas coisas:
//   1) lembrete de véspera para cada cliente com reunião amanhã
//   2) resumo do dia seguinte para o Eduardo
//
// Não manda nada quando não há reunião no dia seguinte.
//
// Deploy:  verify-jwt DESLIGADO (quem chama é o cron do banco).
// Segredos:
//   PAPO_WEBHOOK_VESPERA_URL     webhook de entrada "Lembrete véspera"
//   PAPO_WEBHOOK_RESUMO_URL      webhook de entrada "Resumo do dia"
//   ADMIN_PHONE                  telefone do Eduardo, com DDI (55...)
//   SITE_URL                     endereço público do sistema
//
// Body {"dryRun": true} simula tudo sem enviar (bom para conferir).
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TIMEZONE = "America/Sao_Paulo";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });

const pad = (n: number) => String(n).padStart(2, "0");

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE, hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit"
});

function civilParts(instant: Date) {
  const parts = partsFormatter.formatToParts(instant);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  return {
    year: get("year"), month: get("month"), day: get("day"),
    hour: get("hour") % 24, minute: get("minute"), second: get("second")
  };
}

function offsetMinutesAt(instant: Date): number {
  const c = civilParts(instant);
  return (Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - instant.getTime()) / 60000;
}

function zonedToInstant(day: string, time: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const first = naive - offsetMinutesAt(new Date(naive)) * 60000;
  return new Date(naive - offsetMinutesAt(new Date(first)) * 60000);
}

const toDayKey = (instant: Date) => {
  const c = civilParts(instant);
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
};

const toTimeKey = (instant: Date) => {
  const c = civilParts(instant);
  return `${pad(c.hour)}:${pad(c.minute)}`;
};

function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + delta));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "quinta-feira, 13/08 às 15:00" — o texto que vai na mensagem. */
function meetingLabel(instant: Date): string {
  const c = civilParts(instant);
  const [y, m, d] = [c.year, c.month, c.day];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const suffix = weekday === "sábado" || weekday === "domingo" ? "" : "-feira";
  return `${weekday}${suffix}, ${pad(d)}/${pad(m)} às ${pad(c.hour)}:${pad(c.minute)}`;
}

const firstName = (full: string) => (full ?? "").trim().split(/\s+/)[0] ?? "";

// Valor colado num segredo quase sempre traz espaço ou quebra de linha
// invisível junto, e a Meta REJEITA parâmetro de template com quebra de
// linha. Tudo que vai para o WhatsApp passa por aqui antes.
const cleanText = (value: string | null | undefined): string =>
  (value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

const cleanUrl = (value: string | null | undefined): string =>
  (value ?? "").replace(/\s+/g, "").replace(/\/+$/, "");

/** O papo.ai exige DDI + DDD + número. */
const toWhatsApp = (digits: string | null): string | null => {
  const clean = (digits ?? "").replace(/\D/g, "");
  if (clean.length < 10) return null;
  return clean.startsWith("55") ? clean : `55${clean}`;
};

async function postWebhook(url: string, payload: unknown): Promise<{ ok: boolean; detail?: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

Deno.serve(async (req: Request) => {
  let body: any = {};
  try { body = await req.json(); } catch { /* cron chama sem corpo */ }

  const vesperaUrl = cleanUrl(Deno.env.get("PAPO_WEBHOOK_VESPERA_URL"));
  const resumoUrl = cleanUrl(Deno.env.get("PAPO_WEBHOOK_RESUMO_URL"));
  const adminPhone = cleanText(Deno.env.get("ADMIN_PHONE"));
  const siteUrl = cleanUrl(Deno.env.get("SITE_URL"));

  // Sem as URLs configuradas, roda em seco automaticamente — nunca falha
  // silenciosamente nem manda para lugar nenhum.
  const dryRun = body?.dryRun === true || !vesperaUrl || !resumoUrl;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();
  const tomorrow = addDays(toDayKey(now), 1);

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("status", "CONFIRMED")
    .gte("starts_at", zonedToInstant(tomorrow, "00:00").toISOString())
    .lt("starts_at", zonedToInstant(addDays(tomorrow, 1), "00:00").toISOString())
    .order("starts_at");

  if (error) return json({ ok: false, error: error.message }, 500);

  const meetings = appointments ?? [];

  if (meetings.length === 0) {
    return json({ ok: true, day: tomorrow, meetings: 0, note: "nenhuma reunião amanhã" });
  }

  // Nome do cliente cadastrado ganha do nome digitado no agendamento.
  const clientIds = meetings.map(m => m.client_id).filter(Boolean);
  const { data: clients } = clientIds.length
    ? await supabase.from("clients").select("id, name, phone_digits").in("id", clientIds)
    : { data: [] as any[] };
  const clientById = new Map((clients ?? []).map((c: any) => [c.id, c]));

  // ----------------------------------------------------- lembrete véspera
  const reminders: any[] = [];

  for (const meeting of meetings) {
    const client = meeting.client_id ? clientById.get(meeting.client_id) : null;
    const name = client?.name ?? meeting.attendee_name ?? "";
    const phone = toWhatsApp(meeting.attendee_phone ?? client?.phone_digits ?? null);
    const startsAt = new Date(meeting.starts_at);

    if (!phone) {
      reminders.push({ id: meeting.id, name, skipped: "sem telefone" });
      continue;
    }

    // Não repete se já mandou (o índice único da tabela é a rede de segurança).
    const { data: already } = await supabase
      .from("scheduling_notifications")
      .select("id").eq("kind", "day_before").eq("appointment_id", meeting.id).maybeSingle();

    if (already) {
      reminders.push({ id: meeting.id, name, skipped: "já enviado" });
      continue;
    }

    const payload = {
      phone,
      first_name: cleanText(firstName(name)),
      full_name: cleanText(name),
      email: cleanText(meeting.attendee_email),
      meeting_label: cleanText(meetingLabel(startsAt)),
      meeting_url: cleanUrl(`${siteUrl}/r/${meeting.manage_token}`)
    };

    if (dryRun) {
      reminders.push({ id: meeting.id, name, dryRun: true, payload });
      continue;
    }

    const sent = await postWebhook(vesperaUrl!, payload);
    await supabase.from("scheduling_notifications").insert({
      kind: "day_before",
      appointment_id: meeting.id,
      ok: sent.ok,
      detail: sent.detail ?? null
    });
    reminders.push({ id: meeting.id, name, sent: sent.ok, detail: sent.detail });
  }

  // -------------------------------------------------------- resumo do dia
  const times = meetings.map(m => toTimeKey(new Date(m.starts_at))).sort();

  const summaryPayload = {
    phone: toWhatsApp(adminPhone) ?? "",
    first_name: "Eduardo",
    full_name: "Eduardo Stetner",
    summary_date: `${tomorrow.slice(8)}/${tomorrow.slice(5, 7)}`,
    meeting_count: String(meetings.length),
    first_time: times[0],
    last_time: times[times.length - 1],
    day_url: cleanUrl(`${siteUrl}/dia/${tomorrow}`)
  };

  let summary: any = { dryRun: true, payload: summaryPayload };

  const { data: summarySent } = await supabase
    .from("scheduling_notifications")
    .select("id").eq("kind", "daily_digest").eq("ref_day", tomorrow).maybeSingle();

  if (summarySent) {
    summary = { skipped: "já enviado" };
  } else if (!dryRun && summaryPayload.phone) {
    const sent = await postWebhook(resumoUrl!, summaryPayload);
    await supabase.from("scheduling_notifications").insert({
      kind: "daily_digest",
      ref_day: tomorrow,
      ok: sent.ok,
      detail: sent.detail ?? null
    });
    summary = { sent: sent.ok, detail: sent.detail };
  }

  return json({ ok: true, dryRun, day: tomorrow, meetings: meetings.length, reminders, summary });
});
