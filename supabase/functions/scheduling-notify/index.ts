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
//   ADMIN_EMAIL                  e-mail do Eduardo, para o resumo do dia
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

/**
 * Envia pela função send-email, que é o único lugar que fala com o
 * provedor e sabe o layout.
 *
 * Só conta como enviado o que o provedor aceitou de verdade — a
 * send-email devolve {ok:true, id}. Foi confiar no "aceitei o POST" do
 * WhatsApp que escondeu cinco dias de silêncio em agosto/2026.
 */
async function sendEmail(
  template: string,
  to: string,
  data: Record<string, unknown>
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
      },
      body: JSON.stringify({ template, to, data })
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      return { ok: false, detail: body?.error ?? `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

Deno.serve(async (req: Request) => {
  let body: any = {};
  try { body = await req.json(); } catch { /* cron chama sem corpo */ }

  const adminEmail = cleanText(Deno.env.get("ADMIN_EMAIL"));
  const siteUrl = cleanUrl(Deno.env.get("SITE_URL"));

  // Sem o e-mail do Eduardo o resumo não tem para onde ir; o lembrete de
  // véspera continua valendo, porque vai para o cliente.
  const dryRun = body?.dryRun === true;

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

  /**
   * O resumo olha as DUAS agendas.
   *
   * Enquanto o eAgenda existir, um cliente ou outro ainda marca por lá — e
   * essas reuniões não entravam no aviso da véspera. Foi o caso de uma
   * reunião das 8:30 que só existia no eAgenda: o dia começou sem ela no
   * resumo.
   *
   * A busca vem ANTES do corte abaixo de propósito. Um dia que só tenha
   * reunião do eAgenda ainda é um dia com reunião, e antes ele caía fora
   * aqui mesmo, sem aviso nenhum.
   *
   * Quando o eAgenda for desligado a tabela para de crescer e isto passa a
   * não devolver nada — não precisa ser desfeito.
   */
  const { data: eagendaAmanha } = await supabase
    .from("eagenda_bookings")
    .select("attendee_name, start_datetime, event_status")
    .gte("start_datetime", zonedToInstant(tomorrow, "00:00").toISOString())
    .lt("start_datetime", zonedToInstant(addDays(tomorrow, 1), "00:00").toISOString());

  // O status vem escrito do jeito que o eAgenda manda; fica de fora só o
  // que não vai acontecer.
  const DESCARTADOS = new Set(["CANCELED", "NO_SHOW"]);
  const eagendaAtivas = (eagendaAmanha ?? [])
    .filter((b: any) => !DESCARTADOS.has(String(b.event_status ?? "").toUpperCase()));

  if (meetings.length === 0 && eagendaAtivas.length === 0) {
    return json({ ok: true, day: tomorrow, meetings: 0, note: "nenhuma reunião amanhã" });
  }

  // Nome do cliente cadastrado ganha do nome digitado no agendamento.
  const clientIds = meetings.map(m => m.client_id).filter(Boolean);
  const { data: clients } = clientIds.length
    ? await supabase.from("clients").select("id, name, email, phone_digits, contract_signed").in("id", clientIds)
    : { data: [] as any[] };
  type ClientRow = {
    id: string;
    name: string | null;
    email: string | null;
    phone_digits: string | null;
    contract_signed: boolean | null;
  };
  const clientById = new Map<string, ClientRow>(
    (clients ?? []).map((c: any) => [c.id as string, c as ClientRow])
  );

  // ----------------------------------------------------- lembrete véspera
  const reminders: any[] = [];

  for (const meeting of meetings) {
    const client = meeting.client_id ? clientById.get(meeting.client_id) : null;
    const name = client?.name ?? meeting.attendee_name ?? "";
    // O e-mail digitado no agendamento ganha do cadastro: é o que a
    // pessoa acabou de informar, e por onde ela espera ser avisada.
    const email = cleanText(meeting.attendee_email || client?.email || "");
    const startsAt = new Date(meeting.starts_at);

    if (!email || !email.includes("@")) {
      reminders.push({ id: meeting.id, name, skipped: "sem e-mail" });
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
      first_name: firstName(name),
      full_name: name,
      meeting_label: meetingLabel(startsAt),
      meeting_time: toTimeKey(startsAt),
      meet_url: meeting.meet_url ?? null,
      manage_url: siteUrl ? `${siteUrl}/r/${meeting.manage_token}` : null
    };

    if (dryRun) {
      reminders.push({ id: meeting.id, name, to: email, dryRun: true, payload });
      continue;
    }

    const sent = await sendEmail("vespera", email, payload);
    await supabase.from("scheduling_notifications").insert({
      kind: "day_before",
      appointment_id: meeting.id,
      ok: sent.ok,
      detail: sent.detail ?? null
    });
    reminders.push({ id: meeting.id, name, to: email, sent: sent.ok, detail: sent.detail });
  }

  // -------------------------------------------------------- resumo do dia
  const shortName = (full: string): string =>
    cleanText(full).split(" ").filter(Boolean).slice(0, 2).join(" ");

  /**
   * No WhatsApp isto era uma linha só ("08:30 Livia · 09:30 Lucas"),
   * porque a Meta rejeita parâmetro de template com quebra de linha. No
   * e-mail a limitação some: vira uma tabela de verdade, com horário e
   * nome em colunas.
   *
   * `contract_pending` marca quem vai sentar com o Eduardo sem ter
   * assinado — assim ele vê isso de manhã, sem precisar de outro aviso.
   */
  const linhasProprias = meetings.map(m => {
    const client = m.client_id ? clientById.get(m.client_id) : null;
    return {
      // O instante em número, e não o texto da data: as duas tabelas
      // escrevem o mesmo horário de formas diferentes, e comparar texto
      // faria a mesma reunião passar por duas.
      at: new Date(m.starts_at).getTime(),
      time: toTimeKey(new Date(m.starts_at)),
      name: shortName(client?.name ?? m.attendee_name ?? "sem nome"),
      contract_pending: client ? client.contract_signed === false : false
    };
  });

  const linhasEagenda = eagendaAtivas.map((b: any) => ({
    at: new Date(b.start_datetime).getTime(),
    time: toTimeKey(new Date(b.start_datetime)),
    name: shortName(b.attendee_name ?? "sem nome"),
    // Quem marcou pelo eAgenda não tem ficha aqui, então não dá para saber
    // se assinou — melhor não afirmar o que não se sabe.
    contract_pending: false
  }));

  // O mesmo horário nas duas agendas é uma reunião só: o eAgenda foi
  // importado para cá e as duas fontes se sobrepõem.
  const vistos = new Set(linhasProprias.map(l => l.at));
  const meetingRows = [...linhasProprias, ...linhasEagenda.filter(l => !vistos.has(l.at))]
    .sort((a, b) => a.at - b.at)
    .map(({ at: _at, ...linha }) => linha);

  const totalReunioes = meetingRows.length;

  const summaryPayload = {
    summary_date: `${tomorrow.slice(8)}/${tomorrow.slice(5, 7)}`,
    meeting_count: String(totalReunioes),
    first_time: meetingRows[0]?.time ?? "",
    last_time: meetingRows[meetingRows.length - 1]?.time ?? "",
    meetings: meetingRows,
    day_url: siteUrl ? `${siteUrl}/dia/${tomorrow}` : null
  };

  let summary: any = { dryRun: true, payload: summaryPayload };

  const { data: summarySent } = await supabase
    .from("scheduling_notifications")
    .select("id").eq("kind", "daily_digest").eq("ref_day", tomorrow).maybeSingle();

  if (summarySent) {
    summary = { skipped: "já enviado" };
  } else if (!dryRun && adminEmail) {
    // Além do e-mail, a notificação no celular — que chega mesmo com o
    // aparelho bloqueado e não depende de ele abrir a caixa de entrada.
    try {
      const lista = meetingRows.map(m => `${m.time} — ${m.name}`).join("\n");
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
        },
        body: JSON.stringify({
          /**
           * O iPhone já escreve "de RNV Consultoria" embaixo, então repetir
           * a contagem no título deixava a notificação com cara de sistema.
           * O nome vem na frente e o recado embaixo, como uma mensagem.
           */
          title: "RNV Consultoria",
          body: `Amanhã você tem ${totalReunioes} ${totalReunioes === 1 ? "reunião" : "reuniões"}:\n${lista}`,
          url: siteUrl ? `/dia/${tomorrow}` : "/",
          tag: `resumo-${tomorrow}`
        })
      });
    } catch { /* push é extra; o resumo por e-mail continua valendo */ }

    const sent = await sendEmail("resumo", adminEmail, summaryPayload);
    await supabase.from("scheduling_notifications").insert({
      kind: "daily_digest",
      ref_day: tomorrow,
      ok: sent.ok,
      detail: sent.detail ?? null
    });
    summary = { sent: sent.ok, detail: sent.detail };
  } else if (!adminEmail) {
    summary = { skipped: "ADMIN_EMAIL não configurado" };
  }

  return json({ ok: true, dryRun, day: tomorrow, meetings: totalReunioes, reminders, summary });
});
