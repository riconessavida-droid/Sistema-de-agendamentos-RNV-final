// Conversão entre "data/hora civil no Brasil" e instante absoluto.
//
// Este projeto já teve bug de fuso (a coluna de setembro aparecendo "AGOSTO",
// porque `new Date('2026-09-01')` no UTC-3 volta para 31/08). Um sistema de
// horários multiplica esse risco, então aqui a regra é rígida:
//
//   - o banco guarda instante absoluto (timestamptz)
//   - a tela e as regras trabalham com data civil ('2026-08-13') e hora ('15:00')
//   - a conversão entre os dois acontece SÓ aqui
//
// Nada de `new Date(string)` com data solta fora deste arquivo.

export const TIMEZONE = 'America/Sao_Paulo';

/** Data civil no formato 'YYYY-MM-DD'. */
export type DayKey = string;

/** Hora civil no formato 'HH:MM'. */
export type TimeKey = string;

const pad = (n: number) => String(n).padStart(2, '0');

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

type CivilParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Quebra um instante nos componentes civis do fuso de São Paulo. */
export const toCivilParts = (instant: Date): CivilParts => {
  const parts = partsFormatter.formatToParts(instant);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // 'hour12: false' devolve 24 à meia-noite em alguns runtimes.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second')
  };
};

/** Offset do fuso, em minutos, válido para aquele instante. */
const offsetMinutesAt = (instant: Date): number => {
  const c = toCivilParts(instant);
  const asIfUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  return (asIfUtc - instant.getTime()) / 60_000;
};

/**
 * Data e hora civis no Brasil  →  instante absoluto.
 *
 * A segunda passada existe para o caso de o Brasil voltar a ter horário de
 * verão: na madrugada da virada o offset muda, e a primeira estimativa
 * cairia do lado errado.
 */
export const zonedToInstant = (day: DayKey, time: TimeKey): Date => {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const naive = Date.UTC(year, month - 1, dayOfMonth, hour, minute);

  const firstGuess = naive - offsetMinutesAt(new Date(naive)) * 60_000;
  const settled = naive - offsetMinutesAt(new Date(firstGuess)) * 60_000;

  return new Date(settled);
};

/** Instante absoluto  →  data civil ('2026-08-13'). */
export const toDayKey = (instant: Date): DayKey => {
  const c = toCivilParts(instant);
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
};

/** Instante absoluto  →  hora civil ('15:00'). */
export const toTimeKey = (instant: Date): TimeKey => {
  const c = toCivilParts(instant);
  return `${pad(c.hour)}:${pad(c.minute)}`;
};

/** Instante absoluto  →  mês civil ('2026-08'), a chave usada no statusByMonth. */
export const toMonthKey = (instant: Date): string => {
  const c = toCivilParts(instant);
  return `${c.year}-${pad(c.month)}`;
};

/** Instante absoluto  →  dia do mês, o valor que vira o customDate. */
export const toDayOfMonth = (instant: Date): number => toCivilParts(instant).day;

/** Dia da semana civil (0 = domingo ... 6 = sábado), no padrão do JavaScript. */
export const weekdayOf = (day: DayKey): number => {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  // Date.UTC + getUTCDay evita qualquer influência do fuso da máquina.
  return new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
};

/** Soma dias a uma data civil, sem passar por instante. */
export const addDays = (day: DayKey, delta: number): DayKey => {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, dayOfMonth + delta));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Diferença em dias entre duas datas civis (b - a). */
export const daysBetween = (a: DayKey, b: DayKey): number => {
  const parse = (s: DayKey) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(b) - parse(a)) / 86_400_000);
};

/** 'HH:MM' → minutos desde a meia-noite. Facilita comparar faixas. */
export const timeToMinutes = (time: TimeKey): number => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

/** Minutos desde a meia-noite → 'HH:MM'. */
export const minutesToTime = (minutes: number): TimeKey =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

const WEEKDAY_LABELS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Rótulo de uma reunião para as mensagens: "quinta-feira, 13/08 às 15:00". */
export const formatMeetingLabel = (instant: Date): string => {
  const c = toCivilParts(instant);
  const weekday = WEEKDAY_LABELS[weekdayOf(toDayKey(instant))];
  const suffix = weekday === 'sábado' || weekday === 'domingo' ? '' : '-feira';
  return `${weekday}${suffix}, ${pad(c.day)}/${pad(c.month)} às ${pad(c.hour)}:${pad(c.minute)}`;
};
