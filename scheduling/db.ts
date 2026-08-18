// Conversão entre as tabelas do Supabase e os tipos da aplicação.
// Mesmo padrão do dbToClient/clientToDb do App.tsx: snake_case no banco,
// camelCase no código.

import { supabase } from '../supabaseClient';
import {
  DayKey,
  addDays,
  minutesToTime,
  timeToMinutes,
  toDayKey,
  toTimeKey,
  zonedToInstant
} from './timezone';
import { HolidayOverride } from './holidays';
import {
  Appointment,
  AvailabilityRule,
  BookingLink,
  DEFAULT_SETTINGS,
  ScheduleBlock,
  SchedulingSettings
} from './types';

export const dbToSettings = (row: any): SchedulingSettings => ({
  slotDurationMinutes: row.slot_duration_minutes ?? DEFAULT_SETTINGS.slotDurationMinutes,
  minNoticeHours: row.min_notice_hours ?? DEFAULT_SETTINGS.minNoticeHours,
  maxAdvanceDays: row.max_advance_days ?? DEFAULT_SETTINGS.maxAdvanceDays,
  cancelMinNoticeHours: row.cancel_min_notice_hours ?? DEFAULT_SETTINGS.cancelMinNoticeHours,
  blockNationalHolidays: row.block_national_holidays ?? true,
  blockStateHolidays: row.block_state_holidays ?? true,
  stateCode: row.state_code ?? 'SP'
});

export const settingsToDb = (settings: SchedulingSettings) => ({
  id: 1,
  slot_duration_minutes: settings.slotDurationMinutes,
  min_notice_hours: settings.minNoticeHours,
  max_advance_days: settings.maxAdvanceDays,
  cancel_min_notice_hours: settings.cancelMinNoticeHours,
  block_national_holidays: settings.blockNationalHolidays,
  block_state_holidays: settings.blockStateHolidays,
  state_code: settings.stateCode
});

/** O banco devolve 'HH:MM:SS'; a tela trabalha com 'HH:MM'. */
const trimSeconds = (time: string): string => time.slice(0, 5);

export const dbToRule = (row: any): AvailabilityRule => ({
  id: row.id,
  weekday: row.weekday,
  startTime: trimSeconds(row.start_time),
  endTime: trimSeconds(row.end_time),
  active: row.active ?? true
});

export const dbToBlock = (row: any): ScheduleBlock => ({
  id: row.id,
  dateFrom: row.date_from,
  dateTo: row.date_to ?? null,
  timeFrom: row.time_from ? trimSeconds(row.time_from) : null,
  timeTo: row.time_to ? trimSeconds(row.time_to) : null,
  reason: row.reason ?? undefined,
  source: row.source ?? 'manual'
});

export const dbToAppointment = (row: any): Appointment => ({
  id: row.id,
  clientId: row.client_id ?? null,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  attendeeName: row.attendee_name ?? null,
  attendeeEmail: row.attendee_email ?? null,
  attendeePhone: row.attendee_phone ?? null,
  status: row.status,
  meetUrl: row.meet_url ?? null,
  googleEventId: row.google_event_id ?? null,
  manageToken: row.manage_token,
  source: row.source,
  canceledAt: row.canceled_at ?? null,
  cancelReason: row.cancel_reason ?? null,
  createdAt: row.created_at
});

export const dbToBookingLink = (row: any): BookingLink => ({
  token: row.token,
  clientId: row.client_id,
  active: row.active ?? true,
  fitInStartsAt: row.fit_in_starts_at ?? null,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at ?? null
});

export type SchedulingData = {
  settings: SchedulingSettings;
  rules: AvailabilityRule[];
  blocks: ScheduleBlock[];
  appointments: Appointment[];
  holidayOverrides: HolidayOverride[];
};

/**
 * Carrega tudo que a agenda precisa para um intervalo de dias.
 *
 * Os bloqueios vêm inteiros (são poucos e um período pode começar antes da
 * janela); agendamentos e o resto são filtrados pelo intervalo.
 */
export const loadSchedulingData = async (
  fromDay: DayKey,
  toDay: DayKey
): Promise<SchedulingData> => {
  const rangeStart = zonedToInstant(fromDay, '00:00').toISOString();
  const rangeEnd = zonedToInstant(addDays(toDay, 1), '00:00').toISOString();

  const [settingsRes, rulesRes, blocksRes, appointmentsRes, overridesRes, eagendaRes] = await Promise.all([
    supabase.from('scheduling_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('availability_rules').select('*').order('weekday').order('start_time'),
    supabase.from('schedule_blocks').select('*').order('date_from'),
    supabase
      .from('appointments')
      .select('*')
      .gte('starts_at', rangeStart)
      .lt('starts_at', rangeEnd)
      .order('starts_at'),
    supabase.from('holiday_overrides').select('*'),
    // Enquanto o eAgenda existir, quem agendou LÁ também ocupa o horário
    // AQUI. A página pública já lia isso ao vivo desde 11/08; esta tela
    // não, e por isso mostrava como livre um horário já tomado — foi assim
    // que uma cliente marcou por cima de um compromisso do eAgenda.
    supabase
      .from('eagenda_bookings')
      .select('appointment_key, attendee_name, start_datetime, event_status')
      .eq('event_status', 'CONFIRMED')
      .gte('start_datetime', rangeStart)
      .lt('start_datetime', rangeEnd)
  ]);

  /**
   * Vira bloqueio na hora, sem gravar nada: a fonte da verdade continua
   * sendo a tabela do eAgenda. Se um agendamento for cancelado lá, o
   * horário reabre aqui sozinho na próxima carga — o que não aconteceria
   * com bloqueios copiados para dentro do nosso banco.
   *
   * O id negativo evita colidir com os bloqueios reais e deixa claro, para
   * quem for mexer depois, que esta linha não existe em schedule_blocks.
   */
  const eagendaBlocks: ScheduleBlock[] = (eagendaRes.data ?? []).map((row: any, i: number) => {
    const instant = new Date(row.start_datetime);
    const day = toDayKey(instant);
    const from = toTimeKey(instant);
    const to = toTimeKey(new Date(instant.getTime() + 60 * 60 * 1000));
    return {
      id: -(i + 1),
      dateFrom: day,
      dateTo: null,
      timeFrom: from,
      timeTo: to,
      reason: `eAgenda — ${row.attendee_name ?? 'agendamento'}`,
      source: 'eagenda' as const
    };
  });

  return {
    settings: settingsRes.data ? dbToSettings(settingsRes.data) : DEFAULT_SETTINGS,
    rules: (rulesRes.data ?? []).map(dbToRule),
    blocks: [...(blocksRes.data ?? []).map(dbToBlock), ...eagendaBlocks],
    appointments: (appointmentsRes.data ?? []).map(dbToAppointment),
    holidayOverrides: (overridesRes.data ?? []).map((row: any) => ({
      day: row.day,
      kind: row.kind,
      label: row.label ?? undefined
    }))
  };
};

/**
 * Substitui a grade inteira.
 *
 * INSERE PRIMEIRO, APAGA DEPOIS — de propósito. Não dá para fazer os dois
 * numa transação pelo cliente do Supabase, então a ordem escolhe qual falha
 * a gente prefere: se o insert quebrar, nada muda; se o delete quebrar,
 * sobram faixas duplicadas (visível na tela e fácil de corrigir). O caminho
 * inverso deixaria a agenda SEM NENHUM horário — o cliente abriria o link e
 * não veria nada, e ninguém perceberia.
 *
 * Trocar a grade é seguro por causa da regra central: agendamento é
 * independente dela, então mexer aqui nunca alcança quem já marcou.
 */
export const saveRules = async (rules: Omit<AvailabilityRule, 'id'>[]): Promise<string | null> => {
  const { data: previous, error: readError } = await supabase
    .from('availability_rules')
    .select('id');
  if (readError) return readError.message;

  if (rules.length > 0) {
    const { error: insertError } = await supabase.from('availability_rules').insert(
      rules.map(rule => ({
        weekday: rule.weekday,
        start_time: rule.startTime,
        end_time: rule.endTime,
        active: rule.active
      }))
    );
    if (insertError) return insertError.message;
  }

  const oldIds = (previous ?? []).map((row: { id: number }) => row.id);
  if (oldIds.length === 0) return null;

  const { error: deleteError } = await supabase
    .from('availability_rules')
    .delete()
    .in('id', oldIds);
  return deleteError?.message ?? null;
};

export const saveSettings = async (settings: SchedulingSettings): Promise<string | null> => {
  const { error } = await supabase
    .from('scheduling_settings')
    .upsert(settingsToDb(settings), { onConflict: 'id' });
  return error?.message ?? null;
};

const newToken = () =>
  (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 32);

/**
 * O link pessoal do cliente. É o que substitui a conciliação: como o token
 * identifica o cliente, o agendamento cai no lugar certo sem adivinhação.
 *
 * Reaproveita o link existente — o mesmo endereço serve para sempre, e é
 * ele que vai dentro dos lembretes de WhatsApp.
 */
export const ensureBookingLink = async (
  clientId: string
): Promise<{ token?: string; error?: string }> => {
  const { data: existing, error: readError } = await supabase
    .from('booking_links')
    .select('token')
    .eq('client_id', clientId)
    .eq('active', true)
    .is('fit_in_starts_at', null)
    .limit(1);

  if (readError) return { error: readError.message };
  if (existing && existing.length > 0) return { token: existing[0].token };

  const token = newToken();
  const { error } = await supabase
    .from('booking_links')
    .insert({ token, client_id: clientId });

  return error ? { error: error.message } : { token };
};

/**
 * Link de encaixe: vale por um único horário, mesmo fora da grade, e some
 * depois de usado. Para quando o cliente pede "consegue me atender quarta
 * às 7h?" sem precisar bagunçar a grade inteira.
 */
export const createFitInLink = async (
  clientId: string,
  day: DayKey,
  time: string
): Promise<{ token?: string; error?: string }> => {
  const token = newToken();
  const { error } = await supabase.from('booking_links').insert({
    token,
    client_id: clientId,
    fit_in_starts_at: zonedToInstant(day, time).toISOString()
  });
  return error ? { error: error.message } : { token };
};

export type NewBlock = {
  dateFrom: DayKey;
  dateTo?: DayKey | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  reason?: string;
};

export const addBlock = async (block: NewBlock): Promise<string | null> => {
  const { error } = await supabase.from('schedule_blocks').insert({
    date_from: block.dateFrom,
    date_to: block.dateTo || null,
    time_from: block.timeFrom || null,
    time_to: block.timeTo || null,
    reason: block.reason || null,
    source: 'manual'
  });
  return error?.message ?? null;
};

export const removeBlock = async (id: number): Promise<string | null> => {
  const { error } = await supabase.from('schedule_blocks').delete().eq('id', id);
  return error?.message ?? null;
};

/**
 * Cria bloqueios a partir dos agendamentos futuros que ainda vivem no
 * eAgenda — é a migração sem trabalho manual: os horários que já estão
 * tomados lá param de ser oferecidos aqui.
 *
 * `external_ref` é o appointment_key, e o índice único impede duplicar se
 * você rodar duas vezes.
 */
export const importEagendaBlocks = async (): Promise<{ imported: number; error?: string }> => {
  const todayIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('eagenda_bookings')
    .select('appointment_key, start_datetime, attendee_name, conciliation_status')
    .in('conciliation_status', ['MATCHED', 'PENDING'])
    .gte('start_datetime', todayIso);

  if (error) return { imported: 0, error: error.message };
  if (!data || data.length === 0) return { imported: 0 };

  // Descobre o que já foi importado antes em vez de usar ON CONFLICT: o
  // índice único de external_ref é parcial, e o Postgres não aceita
  // ON CONFLICT apontando para índice parcial.
  const { data: existing, error: existingError } = await supabase
    .from('schedule_blocks')
    .select('external_ref')
    .eq('source', 'eagenda')
    .not('external_ref', 'is', null);

  if (existingError) return { imported: 0, error: existingError.message };

  const known = new Set((existing ?? []).map((row: { external_ref: string }) => row.external_ref));

  const rows = data
    .filter((booking: any) => !known.has(booking.appointment_key))
    .map((booking: any) => {
      const startsAt = new Date(booking.start_datetime);
      const time = toTimeKey(startsAt);
      return {
        date_from: toDayKey(startsAt),
        date_to: null,
        time_from: time,
        time_to: minutesToTime(timeToMinutes(time) + 60),
        reason: `eAgenda — ${booking.attendee_name ?? 'agendamento'}`,
        source: 'eagenda',
        external_ref: booking.appointment_key
      };
    });

  if (rows.length === 0) return { imported: 0 };

  const { error: insertError } = await supabase.from('schedule_blocks').insert(rows);
  if (insertError) return { imported: 0, error: insertError.message };
  return { imported: rows.length };
};
