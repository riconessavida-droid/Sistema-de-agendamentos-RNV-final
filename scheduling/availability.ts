// O motor: transforma a grade em horários oferecíveis.
//
// Decodificado do eAgenda e conferido contra o painel real em 30/07/2026:
// uma faixa 18:30–21:30 com duração de 60min gera 18:30, 19:30 e 20:30 —
// o horário só existe se início + duração couber DENTRO da faixa.

import {
  DayKey,
  addDays,
  daysBetween,
  minutesToTime,
  timeToMinutes,
  toDayKey,
  weekdayOf,
  zonedToInstant
} from './timezone';
import { holidaysBetween, HolidayOverride } from './holidays';
import {
  Appointment,
  AvailabilityRule,
  ScheduleBlock,
  SchedulingSettings,
  Slot,
  SlotState
} from './types';

const MS_PER_HOUR = 3_600_000;

/**
 * Os horários que uma faixa gera. O horário só nasce se a reunião inteira
 * couber DENTRO da faixa — 18:30–21:30 com 60min dá 18:30, 19:30 e 20:30.
 *
 * É o coração da regra, e a tela de Configurar Horários usa esta mesma
 * função para mostrar ao vivo o que cada faixa vai gerar.
 */
export const slotTimesInRange = (
  startTime: string,
  endTime: string,
  durationMinutes: number
): string[] => {
  const rangeStart = timeToMinutes(startTime);
  const rangeEnd = timeToMinutes(endTime);
  const times: string[] = [];

  if (durationMinutes <= 0) return times;

  for (let at = rangeStart; at + durationMinutes <= rangeEnd; at += durationMinutes) {
    times.push(minutesToTime(at));
  }
  return times;
};

/**
 * Gera os horários da grade num intervalo de dias, sem aplicar nenhuma
 * restrição. É a "planta" da agenda — quem filtra é o `availableSlots`.
 */
export const generateSlots = (
  fromDay: DayKey,
  toDay: DayKey,
  rules: AvailabilityRule[],
  durationMinutes: number
): Slot[] => {
  const activeRules = rules.filter(rule => rule.active);

  // Duas faixas do mesmo dia que se cruzam gerariam o mesmo horário duas
  // vezes. A tela de Configurar Horários avisa antes de salvar, mas aqui a
  // dedup garante que um horário nunca apareça repetido na agenda.
  const byInstant = new Map<number, Slot>();

  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    const weekday = weekdayOf(day);

    for (const rule of activeRules) {
      if (rule.weekday !== weekday) continue;

      for (const time of slotTimesInRange(rule.startTime, rule.endTime, durationMinutes)) {
        const startsAt = zonedToInstant(day, time);
        if (byInstant.has(startsAt.getTime())) continue;
        byInstant.set(startsAt.getTime(), {
          day,
          time,
          startsAt,
          endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000)
        });
      }
    }
  }

  return [...byInstant.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
};

/** O bloqueio cobre este dia? */
const blockCoversDay = (block: ScheduleBlock, day: DayKey): boolean =>
  day >= block.dateFrom && day <= (block.dateTo ?? block.dateFrom);

/** O bloqueio derruba este horário? (dia inteiro, ou faixa que se sobrepõe) */
const blockHitsSlot = (block: ScheduleBlock, slot: Slot, durationMinutes: number): boolean => {
  if (!blockCoversDay(block, slot.day)) return false;
  if (!block.timeFrom || !block.timeTo) return true; // dia inteiro

  const slotStart = timeToMinutes(slot.time);
  const slotEnd = slotStart + durationMinutes;
  const blockStart = timeToMinutes(block.timeFrom);
  const blockEnd = timeToMinutes(block.timeTo);

  return slotStart < blockEnd && slotEnd > blockStart;
};

export type AvailabilityInput = {
  now: Date;
  rules: AvailabilityRule[];
  blocks: ScheduleBlock[];
  appointments: Appointment[];
  settings: SchedulingSettings;
  holidayOverrides?: HolidayOverride[];
};

/** Instantes já ocupados por reunião confirmada. */
const bookedInstants = (appointments: Appointment[]): Set<number> =>
  new Set(
    appointments
      .filter(appointment => appointment.status === 'CONFIRMED')
      .map(appointment => new Date(appointment.startsAt).getTime())
  );

/**
 * Os horários que o cliente pode escolher agora.
 *
 * Aplica, nesta ordem: janela de antecedência (mínima e máxima), feriados,
 * bloqueios e horários já ocupados.
 */
export const availableSlots = (input: AvailabilityInput): Slot[] => {
  const { now, rules, blocks, appointments, settings, holidayOverrides } = input;

  const today = toDayKey(now);
  const lastDay = addDays(today, settings.maxAdvanceDays);
  const earliestStart = now.getTime() + settings.minNoticeHours * MS_PER_HOUR;

  const holidays = holidaysBetween(today, lastDay, {
    blockNational: settings.blockNationalHolidays,
    blockState: settings.blockStateHolidays,
    stateCode: settings.stateCode,
    overrides: holidayOverrides
  });

  const taken = bookedInstants(appointments);

  return generateSlots(today, lastDay, rules, settings.slotDurationMinutes).filter(slot => {
    if (slot.startsAt.getTime() < earliestStart) return false;
    if (holidays.has(slot.day)) return false;
    if (taken.has(slot.startsAt.getTime())) return false;
    if (blocks.some(block => blockHitsSlot(block, slot, settings.slotDurationMinutes))) return false;
    return true;
  });
};

/**
 * Estado de cada horário para a agenda do admin (as cores do calendário).
 *
 * Diferente do `availableSlots`, aqui nada é escondido: o admin precisa ver
 * o dia inteiro, inclusive o que está ocupado e o que está bloqueado.
 */
export const slotStates = (
  fromDay: DayKey,
  toDay: DayKey,
  input: AvailabilityInput
): Array<Slot & { state: SlotState; appointment?: Appointment }> => {
  const { now, rules, blocks, appointments, settings, holidayOverrides } = input;

  const today = toDayKey(now);
  const earliestStart = now.getTime() + settings.minNoticeHours * MS_PER_HOUR;

  const holidays = holidaysBetween(fromDay, toDay, {
    blockNational: settings.blockNationalHolidays,
    blockState: settings.blockStateHolidays,
    stateCode: settings.stateCode,
    overrides: holidayOverrides
  });

  const byInstant = new Map<number, Appointment>();
  for (const appointment of appointments) {
    if (appointment.status === 'CONFIRMED') {
      byInstant.set(new Date(appointment.startsAt).getTime(), appointment);
    }
  }

  return generateSlots(fromDay, toDay, rules, settings.slotDurationMinutes).map(slot => {
    const appointment = byInstant.get(slot.startsAt.getTime());
    if (appointment) return { ...slot, state: 'booked' as const, appointment };
    if (holidays.has(slot.day)) return { ...slot, state: 'holiday' as const };
    if (blocks.some(block => blockHitsSlot(block, slot, settings.slotDurationMinutes))) {
      return { ...slot, state: 'blocked' as const };
    }
    if (slot.startsAt.getTime() < earliestStart) return { ...slot, state: 'too_soon' as const };
    if (daysBetween(today, slot.day) > settings.maxAdvanceDays) {
      return { ...slot, state: 'too_far' as const };
    }
    return { ...slot, state: 'free' as const };
  });
};

/**
 * Reuniões que já existem mas caíram fora da grade atual — porque a grade
 * mudou depois de elas serem marcadas, ou porque foram encaixes.
 *
 * É o caso da quarta de manhã: o horário saiu da grade, mas quem já tinha
 * marcado continua marcado. O calendário precisa mostrar esses.
 */
export const offGridAppointments = (
  fromDay: DayKey,
  toDay: DayKey,
  rules: AvailabilityRule[],
  appointments: Appointment[],
  durationMinutes: number
): Appointment[] => {
  const gridInstants = new Set(
    generateSlots(fromDay, toDay, rules, durationMinutes).map(slot => slot.startsAt.getTime())
  );

  return appointments.filter(appointment => {
    if (appointment.status !== 'CONFIRMED') return false;
    const startsAt = new Date(appointment.startsAt);
    const day = toDayKey(startsAt);
    if (day < fromDay || day > toDay) return false;
    return !gridInstants.has(startsAt.getTime());
  });
};

/** O cliente ainda pode cancelar esta reunião? (prazo mínimo de antecedência) */
export const canCancel = (
  appointment: Appointment,
  now: Date,
  settings: SchedulingSettings
): boolean => {
  if (appointment.status !== 'CONFIRMED') return false;
  const startsAt = new Date(appointment.startsAt).getTime();
  return startsAt - now.getTime() >= settings.cancelMinNoticeHours * MS_PER_HOUR;
};

/**
 * A data "ideal" da próxima reunião: 30 dias depois da última.
 *
 * Vira a estrelinha no calendário do cliente — substituindo aquele texto
 * pedindo para ele fazer a conta de cabeça. É só destaque: o cliente
 * continua livre para escolher outro dia.
 */
export const suggestedDay = (lastMeetingDay: DayKey | null): DayKey | null =>
  lastMeetingDay ? addDays(lastMeetingDay, 30) : null;
