import { DayKey, TimeKey } from './timezone';

export interface SchedulingSettings {
  slotDurationMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  cancelMinNoticeHours: number;
  blockNationalHolidays: boolean;
  blockStateHolidays: boolean;
  stateCode: string;
}

export const DEFAULT_SETTINGS: SchedulingSettings = {
  slotDurationMinutes: 60,
  minNoticeHours: 24,
  maxAdvanceDays: 15,
  cancelMinNoticeHours: 5,
  blockNationalHolidays: true,
  blockStateHolidays: true,
  stateCode: 'SP'
};

/** Uma faixa de atendimento num dia da semana (0 = domingo ... 6 = sábado). */
export interface AvailabilityRule {
  id: number;
  weekday: number;
  startTime: TimeKey;
  endTime: TimeKey;
  active: boolean;
}

/**
 * Bloqueio, no mesmo formato da tela do eAgenda:
 *   dateTo null   => só o dia dateFrom
 *   timeFrom null => o dia inteiro
 *   com horário   => essa faixa em CADA dia do período
 */
export interface ScheduleBlock {
  id: number;
  dateFrom: DayKey;
  dateTo: DayKey | null;
  timeFrom: TimeKey | null;
  timeTo: TimeKey | null;
  reason?: string;
  source: 'manual' | 'eagenda' | 'google';
}

export type AppointmentStatus = 'CONFIRMED' | 'CANCELED';
export type AppointmentSource = 'personal_link' | 'public_link' | 'manual' | 'fit_in';

export interface Appointment {
  id: string;
  clientId: string | null;
  startsAt: string;              // ISO — instante absoluto
  endsAt: string;
  attendeeName: string | null;
  attendeeEmail: string | null;
  attendeePhone: string | null;  // só dígitos
  status: AppointmentStatus;
  meetUrl: string | null;
  googleEventId: string | null;
  manageToken: string;
  source: AppointmentSource;
  canceledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface BookingLink {
  token: string;
  clientId: string;
  active: boolean;
  fitInStartsAt: string | null;  // preenchido = link de encaixe (um horário só)
  createdAt: string;
  lastUsedAt: string | null;
}

/** Um horário oferecível. */
export interface Slot {
  day: DayKey;
  time: TimeKey;
  startsAt: Date;
  endsAt: Date;
}

/** Por que um horário não está disponível — usado na agenda do admin. */
export type SlotState = 'free' | 'booked' | 'blocked' | 'holiday' | 'too_soon' | 'too_far';
