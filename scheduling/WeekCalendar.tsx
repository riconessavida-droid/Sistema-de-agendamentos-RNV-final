import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, FileSignature, Lock, Video } from 'lucide-react';
import { offGridAppointments, slotStates } from './availability';
import { holidaysBetween } from './holidays';
import { DayKey, addDays, toDayKey, toTimeKey, weekdayOf } from './timezone';
import { Appointment, SlotState } from './types';
import { SchedulingData } from './db';

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export const startOfWeek = (day: DayKey): DayKey => addDays(day, -weekdayOf(day));

export type ClientBadge = { name: string; contractSigned: boolean };

interface WeekCalendarProps {
  anchorDay: DayKey;
  now: Date;
  data: SchedulingData;
  clientsById: Map<string, ClientBadge>;
  onNavigate: (day: DayKey) => void;
  onSelectAppointment: (appointment: Appointment) => void;
}

type Entry = {
  time: string;
  state: SlotState | 'off_grid';
  appointment?: Appointment;
};

const STATE_STYLE: Record<Entry['state'], string> = {
  booked: 'bg-red-500 text-white hover:bg-red-600 cursor-pointer',
  off_grid: 'bg-red-500 text-white hover:bg-red-600 cursor-pointer ring-2 ring-orange-300',
  free: 'bg-emerald-500 text-white',
  blocked: 'bg-slate-300 text-slate-700',
  holiday: 'bg-slate-200 text-slate-500',
  too_soon: 'bg-slate-50 text-slate-300 border border-slate-200',
  too_far: 'bg-slate-50 text-slate-300 border border-slate-200'
};

export function WeekCalendar({
  anchorDay,
  now,
  data,
  clientsById,
  onNavigate,
  onSelectAppointment
}: WeekCalendarProps) {
  const weekStart = startOfWeek(anchorDay);
  const weekEnd = addDays(weekStart, 6);
  const today = toDayKey(now);

  const { byDay, holidays } = useMemo(() => {
    const input = {
      now,
      rules: data.rules,
      blocks: data.blocks,
      appointments: data.appointments,
      settings: data.settings,
      holidayOverrides: data.holidayOverrides
    };

    const states = slotStates(weekStart, weekEnd, input);

    // Reuniões que existem mas não estão mais na grade — porque a grade
    // mudou depois, ou porque foram encaixes. Precisam aparecer.
    const offGrid = offGridAppointments(
      weekStart,
      weekEnd,
      data.rules,
      data.appointments,
      data.settings.slotDurationMinutes
    );

    const map = new Map<DayKey, Entry[]>();
    for (let day = weekStart; day <= weekEnd; day = addDays(day, 1)) map.set(day, []);

    for (const slot of states) {
      map.get(slot.day)?.push({
        time: slot.time,
        state: slot.state,
        appointment: slot.appointment
      });
    }

    for (const appointment of offGrid) {
      const startsAt = new Date(appointment.startsAt);
      map.get(toDayKey(startsAt))?.push({
        time: toTimeKey(startsAt),
        state: 'off_grid',
        appointment
      });
    }

    for (const entries of map.values()) {
      entries.sort((a, b) => a.time.localeCompare(b.time));
    }

    return {
      byDay: map,
      holidays: holidaysBetween(weekStart, weekEnd, {
        blockNational: data.settings.blockNationalHolidays,
        blockState: data.settings.blockStateHolidays,
        stateCode: data.settings.stateCode,
        overrides: data.holidayOverrides
      })
    };
  }, [weekStart, weekEnd, now, data]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const rangeLabel = `${weekStart.slice(8)}/${weekStart.slice(5, 7)} – ${weekEnd.slice(8)}/${weekEnd.slice(5, 7)}`;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate(addDays(weekStart, -7))}
            className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
            title="Semana anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => onNavigate(today)}
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-bold transition-colors"
          >
            Hoje
          </button>
          <button
            onClick={() => onNavigate(addDays(weekStart, 7))}
            className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
            title="Próxima semana"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="ml-2 text-sm font-black text-slate-700">{rangeLabel}</span>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-500">
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-emerald-500 inline-block" /> livre</span>
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-red-500 inline-block" /> ocupado</span>
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slate-300 inline-block" /> bloqueado</span>
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slate-50 border border-slate-200 inline-block" /> fora do prazo</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 min-w-[900px] divide-x divide-slate-100">
          {days.map(day => {
            const entries = byDay.get(day) ?? [];
            const holidayLabel = holidays.get(day);
            const isToday = day === today;

            return (
              <div key={day} className={isToday ? 'bg-yellow-50/50' : ''}>
                <div
                  className={`px-2 py-2 text-center border-b border-slate-200 ${
                    isToday ? 'bg-yellow-100' : 'bg-white'
                  }`}
                >
                  <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                    {WEEKDAY_SHORT[weekdayOf(day)]}
                  </div>
                  <div className={`text-lg font-black ${isToday ? 'text-yellow-700' : 'text-slate-700'}`}>
                    {Number(day.slice(8))}
                  </div>
                </div>

                <div className="p-1.5 space-y-1 min-h-[120px]">
                  {holidayLabel && (
                    <div className="px-2 py-1 rounded-md bg-slate-200 text-slate-600 text-[10px] font-bold text-center">
                      {holidayLabel}
                    </div>
                  )}

                  {entries.length === 0 && !holidayLabel && (
                    <div className="text-center text-[11px] text-slate-300 py-4">—</div>
                  )}

                  {entries.map(entry => {
                    const client = entry.appointment?.clientId
                      ? clientsById.get(entry.appointment.clientId)
                      : undefined;
                    const name = client?.name ?? entry.appointment?.attendeeName ?? '';
                    const pendingContract = client ? !client.contractSigned : false;

                    return (
                      <button
                        key={`${entry.time}-${entry.state}`}
                        onClick={() =>
                          entry.appointment && onSelectAppointment(entry.appointment)
                        }
                        disabled={!entry.appointment}
                        className={`w-full text-left px-2 py-1 rounded-md text-[11px] font-bold leading-tight transition-colors ${
                          STATE_STYLE[entry.state]
                        }`}
                        title={
                          entry.state === 'off_grid'
                            ? 'Reunião fora da grade atual (a grade mudou depois, ou foi um encaixe)'
                            : entry.state === 'blocked'
                              ? 'Horário bloqueado'
                              : undefined
                        }
                      >
                        <span className="flex items-center gap-1">
                          {entry.state === 'blocked' && <Lock className="w-3 h-3 shrink-0" />}
                          {entry.time}
                          {pendingContract && (
                            <FileSignature className="w-3 h-3 shrink-0 text-yellow-200" />
                          )}
                          {entry.appointment?.meetUrl && (
                            <Video className="w-3 h-3 shrink-0 opacity-70" />
                          )}
                        </span>
                        {name && <span className="block truncate">{name}</span>}
                        {entry.state === 'blocked' && (
                          <span className="block truncate opacity-70">bloqueado</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
