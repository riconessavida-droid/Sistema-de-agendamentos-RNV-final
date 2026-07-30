// Feriados que bloqueiam a agenda.
//
// O eAgenda tem dois interruptores ligados: "bloquear agenda em feriados
// nacionais" e "em feriados estaduais". Aqui eles são CALCULADOS, não
// buscados numa API de terceiro — uma API fora do ar num feriado deixaria a
// agenda aberta (ou fechada) sem ninguém perceber.
//
// Os móveis (Carnaval, Sexta-feira Santa, Corpus Christi) dependem da Páscoa,
// por isso o cálculo abaixo.

import { DayKey, addDays } from './timezone';

const pad = (n: number) => String(n).padStart(2, '0');

const dayKeyOf = (year: number, month: number, day: number): DayKey =>
  `${year}-${pad(month)}-${pad(day)}`;

/**
 * Domingo de Páscoa do ano, no calendário gregoriano
 * (algoritmo de Meeus/Jones/Butcher).
 */
export const easterSunday = (year: number): DayKey => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayKeyOf(year, month, day);
};

export type Holiday = { day: DayKey; label: string };

/** Feriados nacionais do ano (fixos + móveis). */
export const nationalHolidays = (year: number): Holiday[] => {
  const easter = easterSunday(year);

  return [
    { day: dayKeyOf(year, 1, 1), label: 'Confraternização Universal' },
    { day: addDays(easter, -48), label: 'Carnaval (segunda)' },
    { day: addDays(easter, -47), label: 'Carnaval (terça)' },
    { day: addDays(easter, -2), label: 'Sexta-feira Santa' },
    { day: dayKeyOf(year, 4, 21), label: 'Tiradentes' },
    { day: dayKeyOf(year, 5, 1), label: 'Dia do Trabalho' },
    { day: addDays(easter, 60), label: 'Corpus Christi' },
    { day: dayKeyOf(year, 9, 7), label: 'Independência' },
    { day: dayKeyOf(year, 10, 12), label: 'Nossa Senhora Aparecida' },
    { day: dayKeyOf(year, 11, 2), label: 'Finados' },
    { day: dayKeyOf(year, 11, 15), label: 'Proclamação da República' },
    { day: dayKeyOf(year, 11, 20), label: 'Consciência Negra' },
    { day: dayKeyOf(year, 12, 25), label: 'Natal' }
  ];
};

/** Feriados estaduais. Hoje só SP, que é onde o escritório fica. */
export const stateHolidays = (year: number, stateCode: string): Holiday[] => {
  if (stateCode === 'SP') {
    return [{ day: dayKeyOf(year, 7, 9), label: 'Revolução Constitucionalista' }];
  }
  return [];
};

export type HolidayOverride = { day: DayKey; kind: 'block' | 'allow'; label?: string };

export type HolidayOptions = {
  blockNational: boolean;
  blockState: boolean;
  stateCode: string;
  overrides?: HolidayOverride[];
};

/**
 * Monta o conjunto de dias bloqueados por feriado num intervalo.
 *
 * As exceções mandam: 'allow' libera um feriado que você quer atender,
 * 'block' fecha um dia que o cálculo não conhece (feriado municipal, emenda).
 */
export const holidaysBetween = (
  fromDay: DayKey,
  toDay: DayKey,
  options: HolidayOptions
): Map<DayKey, string> => {
  const firstYear = Number(fromDay.slice(0, 4));
  const lastYear = Number(toDay.slice(0, 4));

  const result = new Map<DayKey, string>();

  for (let year = firstYear; year <= lastYear; year++) {
    const holidays = [
      ...(options.blockNational ? nationalHolidays(year) : []),
      ...(options.blockState ? stateHolidays(year, options.stateCode) : [])
    ];
    for (const holiday of holidays) {
      if (holiday.day >= fromDay && holiday.day <= toDay) {
        result.set(holiday.day, holiday.label);
      }
    }
  }

  for (const override of options.overrides ?? []) {
    if (override.kind === 'allow') {
      result.delete(override.day);
    } else if (override.day >= fromDay && override.day <= toDay) {
      result.set(override.day, override.label ?? 'Bloqueado');
    }
  }

  return result;
};
