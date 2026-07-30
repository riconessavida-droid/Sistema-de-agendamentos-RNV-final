// =====================================================================
// Edge Function: booking
// Atende a PÁGINA PÚBLICA de agendamento (a que substitui o eAgenda).
//
// Quatro ações, numa função só para o deploy manual ser um só:
//   availability -> horários livres (link pessoal ou geral)
//   create       -> cria o agendamento
//   manage       -> dados da página "sua reunião"
//   cancel       -> cancela (respeitando o prazo mínimo)
//
// Deploy: verify-jwt DESLIGADO (a página é pública, não tem sessão).
// A função usa a service_role e é a ÚNICA porta entre a internet e o
// banco — a página nunca fala direto com o Supabase.
//
// ⚠️ A lógica de horários abaixo é ESPELHO de scheduling/availability.ts,
//    scheduling/timezone.ts e scheduling/holidays.ts. Mudou a regra lá,
//    mude aqui (os testes do frontend cobrem a outra ponta).
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TIMEZONE = "America/Sao_Paulo";
const MS_PER_HOUR = 3_600_000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS }
  });

const pad = (n: number) => String(n).padStart(2, "0");

// ---------------------------------------------------------------- fuso
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

function toDayKey(instant: Date): string {
  const c = civilParts(instant);
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
}

function toTimeKey(instant: Date): string {
  const c = civilParts(instant);
  return `${pad(c.hour)}:${pad(c.minute)}`;
}

function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + delta));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const timeToMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const minutesToTime = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// ------------------------------------------------------------ feriados
function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function holidaySet(fromDay: string, toDay: string, settings: any, overrides: any[]): Set<string> {
  const result = new Set<string>();
  const firstYear = Number(fromDay.slice(0, 4));
  const lastYear = Number(toDay.slice(0, 4));

  for (let year = firstYear; year <= lastYear; year++) {
    const easter = easterSunday(year);
    const days: string[] = [];

    if (settings.block_national_holidays) {
      days.push(
        `${year}-01-01`, addDays(easter, -48), addDays(easter, -47), addDays(easter, -2),
        `${year}-04-21`, `${year}-05-01`, addDays(easter, 60), `${year}-09-07`,
        `${year}-10-12`, `${year}-11-02`, `${year}-11-15`, `${year}-11-20`, `${year}-12-25`
      );
    }
    if (settings.block_state_holidays && settings.state_code === "SP") {
      days.push(`${year}-07-09`);
    }
    for (const day of days) {
      if (day >= fromDay && day <= toDay) result.add(day);
    }
  }

  for (const override of overrides ?? []) {
    if (override.kind === "allow") result.delete(override.day);
    else if (override.day >= fromDay && override.day <= toDay) result.add(override.day);
  }
  return result;
}

// ------------------------------------------------------------- horários
function blockHitsSlot(block: any, day: string, time: string, duration: number): boolean {
  const to = block.date_to ?? block.date_from;
  if (day < block.date_from || day > to) return false;
  if (!block.time_from || !block.time_to) return true;

  const slotStart = timeToMinutes(time);
  const slotEnd = slotStart + duration;
  const blockStart = timeToMinutes(block.time_from.slice(0, 5));
  const blockEnd = timeToMinutes(block.time_to.slice(0, 5));
  return slotStart < blockEnd && slotEnd > blockStart;
}

type FreeSlot = { day: string; time: string; startsAt: Date };

function computeFreeSlots(
  now: Date, settings: any, rules: any[], blocks: any[], taken: Set<number>, overrides: any[]
): FreeSlot[] {
  const duration = settings.slot_duration_minutes;
  const today = toDayKey(now);
  const lastDay = addDays(today, settings.max_advance_days);
  const earliest = now.getTime() + settings.min_notice_hours * MS_PER_HOUR;
  const holidays = holidaySet(today, lastDay, settings, overrides);

  const seen = new Set<number>();
  const slots: FreeSlot[] = [];

  for (let day = today; day <= lastDay; day = addDays(day, 1)) {
    if (holidays.has(day)) continue;
    const weekday = weekdayOf(day);

    for (const rule of rules) {
      if (rule.weekday !== weekday || rule.active === false) continue;
      const rangeStart = timeToMinutes(rule.start_time.slice(0, 5));
      const rangeEnd = timeToMinutes(rule.end_time.slice(0, 5));

      for (let at = rangeStart; at + duration <= rangeEnd; at += duration) {
        const time = minutesToTime(at);
        const startsAt = zonedToInstant(day, time);
        const stamp = startsAt.getTime();

        if (seen.has(stamp)) continue;
        seen.add(stamp);

        if (stamp < earliest) continue;
        if (taken.has(stamp)) continue;
        if (blocks.some(b => blockHitsSlot(b, day, time, duration))) continue;

        slots.push({ day, time, startsAt });
      }
    }
  }

  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

// ---------------------------------------------------------------- util
const normalizePhone = (raw: string): string => {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d.slice(-11);
};

const firstName = (full: string): string => (full ?? "").trim().split(/\s+/)[0] ?? "";

const newToken = () => crypto.randomUUID().replace(/-/g, "");

/** Última data de reunião do cliente, lida do statusByMonth. */
function lastMeetingDay(statusByMonth: Record<string, any>): string | null {
  let best: string | null = null;
  for (const [monthKey, value] of Object.entries(statusByMonth ?? {})) {
    if (!value?.customDate) continue;
    const day = `${monthKey}-${pad(Number(value.customDate))}`;
    if (!best || day > best) best = day;
  }
  return best;
}

// ================================================================ main
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const action: string = payload?.action ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();

  const loadConfig = async () => {
    const [settingsRes, rulesRes, blocksRes, overridesRes] = await Promise.all([
      supabase.from("scheduling_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("availability_rules").select("*").eq("active", true),
      supabase.from("schedule_blocks").select("*"),
      supabase.from("holiday_overrides").select("*")
    ]);
    return {
      settings: settingsRes.data ?? {
        slot_duration_minutes: 60, min_notice_hours: 24, max_advance_days: 15,
        cancel_min_notice_hours: 5, block_national_holidays: true,
        block_state_holidays: true, state_code: "SP"
      },
      rules: rulesRes.data ?? [],
      blocks: blocksRes.data ?? [],
      overrides: overridesRes.data ?? []
    };
  };

  const takenInstants = async (fromIso: string, toIso: string) => {
    const { data } = await supabase
      .from("appointments")
      .select("starts_at")
      .eq("status", "CONFIRMED")
      .gte("starts_at", fromIso)
      .lte("starts_at", toIso);
    return new Set((data ?? []).map((r: any) => new Date(r.starts_at).getTime()));
  };

  // ------------------------------------------------------- availability
  if (action === "availability") {
    const token: string | null = payload?.token ?? null;
    const config = await loadConfig();

    let client: any = null;
    let link: any = null;

    if (token) {
      const { data: linkRow } = await supabase
        .from("booking_links").select("*").eq("token", token).eq("active", true).maybeSingle();
      if (!linkRow) return json({ ok: false, error: "invalid_token" }, 404);
      link = linkRow;

      const { data: clientRow } = await supabase
        .from("clients").select("id, name, status_by_month, closed_at")
        .eq("id", linkRow.client_id).maybeSingle();
      if (!clientRow) return json({ ok: false, error: "invalid_token" }, 404);
      client = clientRow;
    }

    // Link de encaixe: vale por um horário só, mesmo fora da grade.
    if (link?.fit_in_starts_at) {
      const startsAt = new Date(link.fit_in_starts_at);
      const stillFree = !(await takenInstants(link.fit_in_starts_at, link.fit_in_starts_at)).size;
      return json({
        ok: true,
        mode: "fit_in",
        firstName: firstName(client?.name ?? ""),
        durationMinutes: config.settings.slot_duration_minutes,
        suggestedDay: null,
        days: stillFree
          ? [{ day: toDayKey(startsAt), times: [toTimeKey(startsAt)] }]
          : []
      });
    }

    const today = toDayKey(now);
    const lastDay = addDays(today, config.settings.max_advance_days);
    const taken = await takenInstants(
      zonedToInstant(today, "00:00").toISOString(),
      zonedToInstant(addDays(lastDay, 1), "00:00").toISOString()
    );

    const slots = computeFreeSlots(now, config.settings, config.rules, config.blocks, taken, config.overrides);

    const byDay = new Map<string, string[]>();
    for (const slot of slots) {
      if (!byDay.has(slot.day)) byDay.set(slot.day, []);
      byDay.get(slot.day)!.push(slot.time);
    }

    const last = client ? lastMeetingDay(client.status_by_month) : null;

    return json({
      ok: true,
      mode: token ? "personal" : "public",
      firstName: firstName(client?.name ?? ""),
      durationMinutes: config.settings.slot_duration_minutes,
      lastMeetingDay: last,
      suggestedDay: last ? addDays(last, 30) : null,
      days: [...byDay.entries()].map(([day, times]) => ({ day, times }))
    });
  }

  // -------------------------------------------------------------- create
  if (action === "create") {
    const { token, day, time } = payload ?? {};
    if (!day || !time) return json({ ok: false, error: "missing_slot" }, 400);
    if (!payload?.consent) return json({ ok: false, error: "missing_consent" }, 400);

    const config = await loadConfig();
    const duration = config.settings.slot_duration_minutes;
    const startsAt = zonedToInstant(day, time);
    const endsAt = new Date(startsAt.getTime() + duration * 60000);

    let clientId: string | null = null;
    let name = (payload?.name ?? "").trim();
    let email = (payload?.email ?? "").trim() || null;
    let phone = normalizePhone(payload?.phone ?? "");
    let source = "public_link";
    let link: any = null;

    if (token) {
      const { data: linkRow } = await supabase
        .from("booking_links").select("*").eq("token", token).eq("active", true).maybeSingle();
      if (!linkRow) return json({ ok: false, error: "invalid_token" }, 404);
      link = linkRow;

      const { data: clientRow } = await supabase
        .from("clients").select("id, name, phone_digits, email").eq("id", linkRow.client_id).maybeSingle();
      if (!clientRow) return json({ ok: false, error: "invalid_token" }, 404);

      clientId = clientRow.id;
      name = clientRow.name;
      email = clientRow.email ?? email;
      phone = clientRow.phone_digits ?? phone;
      source = linkRow.fit_in_starts_at ? "fit_in" : "personal_link";
    } else {
      if (!name || !phone) return json({ ok: false, error: "missing_contact" }, 400);

      // Sem link pessoal, evita que a mesma pessoa (ou um robô com o mesmo
      // telefone) empilhe agendamentos futuros.
      const { data: already } = await supabase
        .from("appointments").select("id")
        .eq("attendee_phone", phone).eq("status", "CONFIRMED")
        .gte("starts_at", now.toISOString()).limit(1);
      if (already && already.length > 0) {
        return json({ ok: false, error: "already_booked" }, 409);
      }
    }

    // O horário ainda é oferecível? (protege contra payload adulterado)
    if (link?.fit_in_starts_at) {
      if (new Date(link.fit_in_starts_at).getTime() !== startsAt.getTime()) {
        return json({ ok: false, error: "slot_unavailable" }, 409);
      }
    } else {
      const taken = await takenInstants(startsAt.toISOString(), startsAt.toISOString());
      const free = computeFreeSlots(now, config.settings, config.rules, config.blocks, taken, config.overrides);
      if (!free.some(s => s.startsAt.getTime() === startsAt.getTime())) {
        return json({ ok: false, error: "slot_unavailable" }, 409);
      }
    }

    const manageToken = newToken();

    const { data: created, error } = await supabase
      .from("appointments")
      .insert({
        client_id: clientId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        attendee_name: name || null,
        attendee_email: email,
        attendee_phone: phone || null,
        status: "CONFIRMED",
        manage_token: manageToken,
        source
      })
      .select("id")
      .single();

    if (error) {
      // O índice único do banco é a trava real da dupla marcação: se dois
      // clientes clicarem no mesmo segundo, um dos dois cai aqui.
      const duplicated = (error as any).code === "23505";
      return json({ ok: false, error: duplicated ? "slot_taken" : "insert_failed" }, duplicated ? 409 : 500);
    }

    // Espelha a data no statusByMonth, que é o que o resto do sistema lê.
    // O nosso agendamento tem precedência sobre o eAgenda.
    if (clientId) {
      const monthKey = `${day.slice(0, 4)}-${day.slice(5, 7)}`;
      const dayOfMonth = Number(day.slice(8));
      const { data: clientRow } = await supabase
        .from("clients").select("status_by_month").eq("id", clientId).maybeSingle();

      const statusByMonth = { ...(clientRow?.status_by_month ?? {}) };
      const current = statusByMonth[monthKey] ?? { status: "PENDING" };
      // Dentro do mês vale o maior dia (remarcação para a frente ganha).
      if (!current.customDate || dayOfMonth >= current.customDate) {
        statusByMonth[monthKey] = { ...current, customDate: dayOfMonth };
        await supabase.from("clients").update({ status_by_month: statusByMonth }).eq("id", clientId);
      }
    }

    if (link) {
      await supabase.from("booking_links")
        .update({ last_used_at: new Date().toISOString() })
        .eq("token", link.token);
      // Link de encaixe é de uso único.
      if (link.fit_in_starts_at) {
        await supabase.from("booking_links").update({ active: false }).eq("token", link.token);
      }
    }

    return json({ ok: true, appointmentId: created.id, manageToken });
  }

  // -------------------------------------------------------------- manage
  if (action === "manage" || action === "cancel") {
    const manageToken: string = payload?.manageToken ?? "";
    if (!manageToken) return json({ ok: false, error: "missing_token" }, 400);

    const { data: appointment } = await supabase
      .from("appointments").select("*").eq("manage_token", manageToken).maybeSingle();
    if (!appointment) return json({ ok: false, error: "not_found" }, 404);

    const config = await loadConfig();
    const startsAt = new Date(appointment.starts_at);
    const cancelable =
      appointment.status === "CONFIRMED" &&
      startsAt.getTime() - now.getTime() >= config.settings.cancel_min_notice_hours * MS_PER_HOUR;

    if (action === "manage") {
      return json({
        ok: true,
        appointment: {
          day: toDayKey(startsAt),
          time: toTimeKey(startsAt),
          status: appointment.status,
          meetUrl: appointment.meet_url,
          name: appointment.attendee_name
        },
        cancelable,
        cancelMinNoticeHours: config.settings.cancel_min_notice_hours
      });
    }

    if (!cancelable) return json({ ok: false, error: "too_late" }, 409);

    await supabase.from("appointments").update({
      status: "CANCELED",
      canceled_at: new Date().toISOString(),
      cancel_reason: "Cancelado pelo cliente"
    }).eq("id", appointment.id);

    // Limpa a data do mês, sem tocar em reunião já realizada.
    if (appointment.client_id) {
      const day = toDayKey(startsAt);
      const monthKey = day.slice(0, 7);
      const dayOfMonth = Number(day.slice(8));
      const { data: clientRow } = await supabase
        .from("clients").select("status_by_month").eq("id", appointment.client_id).maybeSingle();

      const statusByMonth = { ...(clientRow?.status_by_month ?? {}) };
      const entry = statusByMonth[monthKey];
      const protectedStatus = ["DONE", "CLOSED_CONTRACT", "CANCELLED_EARLY"];

      if (entry?.customDate === dayOfMonth && !protectedStatus.includes(entry.status)) {
        const { customDate, ...rest } = entry;
        statusByMonth[monthKey] = rest;
        await supabase.from("clients").update({ status_by_month: statusByMonth }).eq("id", appointment.client_id);
      }
    }

    return json({ ok: true });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
});
