import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FileSignature, Lock, Video, X } from 'lucide-react';
import { offGridAppointments, slotStates } from './availability';
import { holidaysBetween } from './holidays';
import { DayKey, addDays, toDayKey, toTimeKey, weekdayOf } from './timezone';
import { Appointment, SlotState } from './types';
import { SchedulingData } from './db';

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export const startOfWeek = (day: DayKey): DayKey => addDays(day, -weekdayOf(day));

export interface ClientBadge {
  name: string;
  contractSigned: boolean;
}

interface WeekCalendarProps {
  anchorDay: DayKey;
  now: Date;
  data: SchedulingData;
  clientsById: Map<string, ClientBadge>;
  onNavigate: (day: DayKey) => void;
  onSelectAppointment: (appointment: Appointment) => void;
  /** Bloqueia um horário avulso direto do calendário. */
  onBlockSlot?: (day: DayKey, time: string) => Promise<void> | void;
  /** Desfaz um bloqueio manual criado por aqui. */
  onUnblockSlot?: (blockId: number) => Promise<void> | void;
}

type Entry = {
  time: string;
  state: SlotState | 'off_grid';
  appointment?: Appointment;
  /** Id do bloqueio manual, quando houver — é o que permite desfazer. */
  blockId?: number;
  blockReason?: string;
};

const STATE_STYLE: Record<Entry['state'], string> = {
  booked: 'bg-red-500 text-white hover:bg-red-600 cursor-pointer',
  off_grid: 'bg-red-500 text-white hover:bg-red-600 cursor-pointer ring-2 ring-orange-300',
  free: 'bg-emerald-500 text-white hover:bg-emerald-600 cursor-pointer',
  blocked: 'bg-slate-300 text-slate-700 hover:bg-slate-400 cursor-pointer',
  holiday: 'bg-slate-200 text-slate-500',
  too_soon: 'bg-slate-50 text-slate-300 border border-slate-200',
  too_far: 'bg-slate-50 text-slate-300 border border-slate-200'
};

/** O que o clique num horário abre. */
type SlotAction = {
  day: DayKey;
  entry: Entry;
};

export function WeekCalendar({
  anchorDay,
  now,
  data,
  clientsById,
  onNavigate,
  onSelectAppointment,
  onBlockSlot,
  onUnblockSlot
}: WeekCalendarProps) {
  const weekStart = startOfWeek(anchorDay);
  const weekEnd = addDays(weekStart, 6);
  const today = toDayKey(now);

  const [action, setAction] = useState<SlotAction | null>(null);
  const [saving, setSaving] = useState(false);

  const { byDay, holidays, allTimes } = useMemo(() => {
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
        appointment: slot.appointment,
        blockId: slot.blockId,
        blockReason: slot.blockReason
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

    /**
     * A LINHA DE CADA HORÁRIO É A MESMA A SEMANA INTEIRA.
     *
     * Antes cada dia era uma pilha independente: numa terça com menos
     * horários, as 14:00 subiam e ficavam na altura das 09:30 de quarta.
     * Bater o olho e comparar a semana ficava impossível.
     *
     * Agora as linhas são a união de todos os horários da semana, então
     * 14:00 fica na altura de 14:00 em todos os dias — como no eAgenda.
     */
    const times = new Set<string>();
    for (const entries of map.values()) {
      for (const entry of entries) times.add(entry.time);
    }

    return {
      byDay: map,
      holidays: holidaysBetween(weekStart, weekEnd, {
        blockNational: data.settings.blockNationalHolidays,
        blockState: data.settings.blockStateHolidays,
        stateCode: data.settings.stateCode,
        overrides: data.holidayOverrides
      }),
      allTimes: Array.from(times).sort((a, b) => a.localeCompare(b))
    };
  }, [weekStart, weekEnd, now, data]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const rangeLabel = `${weekStart.slice(8)}/${weekStart.slice(5, 7)} – ${weekEnd.slice(8)}/${weekEnd.slice(5, 7)}`;

  const entryAt = (day: DayKey, time: string): Entry | undefined =>
    (byDay.get(day) ?? []).find(e => e.time === time);

  /** Só horário livre ou bloqueado por nós abre o pop-up. */
  const handleClick = (day: DayKey, entry: Entry) => {
    if (entry.appointment) {
      onSelectAppointment(entry.appointment);
      return;
    }
    if (entry.state === 'free' && onBlockSlot) setAction({ day, entry });
    else if (entry.state === 'blocked' && entry.blockId && onUnblockSlot) setAction({ day, entry });
  };

  const confirmAction = async () => {
    if (!action) return;
    setSaving(true);
    if (action.entry.state === 'free') {
      await onBlockSlot?.(action.day, action.entry.time);
    } else if (action.entry.blockId != null) {
      await onUnblockSlot?.(action.entry.blockId);
    }
    setSaving(false);
    setAction(null);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate(addDays(weekStart, -7))}
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors"
            title="Semana anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => onNavigate(today)}
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Hoje
          </button>
          <button
            onClick={() => onNavigate(addDays(weekStart, 7))}
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors"
            title="Próxima semana"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="ml-2 text-sm font-black text-slate-700">{rangeLabel}</span>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-500 flex-wrap">
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-emerald-500 inline-block" /> livre</span>
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-red-500 inline-block" /> ocupado</span>
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slate-300 inline-block" /> bloqueado</span>
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-slate-50 border border-slate-200 inline-block" /> fora do prazo</span>
        </div>
      </div>

      {onBlockSlot && (
        <p className="px-4 py-2 text-[11px] text-slate-500 bg-slate-50/60 border-b border-slate-100">
          Clique num horário <b>livre</b> para bloquear, ou num <b>bloqueado</b> para liberar.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] border-collapse table-fixed">
          <colgroup>
            {/* Largura igual para os sete dias. A coluna do horário é
                estreita e fixa; o resto divide o espaço em partes iguais,
                para a semana ficar simétrica independente do tamanho dos
                nomes. */}
            <col className="w-[68px]" />
            {days.map(day => (
              <col key={day} className="w-[13.4%]" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="bg-white border-b border-slate-200" />
              {days.map(day => {
                const isToday = day === today;
                return (
                  <th
                    key={day}
                    className={`px-2 py-2 text-center border-b border-l border-slate-200 ${
                      isToday ? 'bg-yellow-100' : 'bg-white'
                    }`}
                  >
                    <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                      {WEEKDAY_SHORT[weekdayOf(day)]}
                    </div>
                    <div className={`text-lg font-black ${isToday ? 'text-yellow-700' : 'text-slate-700'}`}>
                      {Number(day.slice(8))}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {/* Feriados numa faixa própria: valem o dia inteiro, não um horário. */}
            {holidays.size > 0 && (
              <tr>
                <td className="bg-white" />
                {days.map(day => (
                  <td key={day} className="px-1.5 pt-1.5 border-l border-slate-100 align-top">
                    {holidays.get(day) && (
                      <div className="px-2 py-1 rounded-md bg-slate-200 text-slate-600 text-[10px] font-bold text-center truncate">
                        {holidays.get(day)}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            )}

            {allTimes.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-sm text-slate-300 py-10">
                  Nenhum horário nesta semana
                </td>
              </tr>
            )}

            {allTimes.map(time => (
              /* Altura fixa: a linha das 14:00 tem o mesmo tamanho da das
                 09:30, com ou sem nome dentro. É o que permite ler a
                 semana na horizontal sem recontar. */
              <tr key={time} className="h-[52px]">
                <td className="px-2 py-1 text-right align-middle text-[11px] font-black text-slate-400 tabular-nums">
                  {time}
                </td>

                {days.map(day => {
                  const entry = entryAt(day, time);
                  const isToday = day === today;

                  if (!entry) {
                    return (
                      <td
                        key={day}
                        className={`px-1.5 py-1 border-l border-slate-100 ${isToday ? 'bg-yellow-50/50' : ''}`}
                      />
                    );
                  }

                  const client = entry.appointment?.clientId
                    ? clientsById.get(entry.appointment.clientId)
                    : undefined;
                  const name = client?.name ?? entry.appointment?.attendeeName ?? '';
                  const pendingContract = client ? !client.contractSigned : false;
                  const clickable =
                    Boolean(entry.appointment) ||
                    (entry.state === 'free' && Boolean(onBlockSlot)) ||
                    (entry.state === 'blocked' && entry.blockId != null && Boolean(onUnblockSlot));

                  return (
                    <td
                      key={day}
                      className={`px-1.5 py-1 border-l border-slate-100 align-top ${isToday ? 'bg-yellow-50/50' : ''}`}
                    >
                      <button
                        onClick={() => handleClick(day, entry)}
                        disabled={!clickable}
                        className={`w-full h-[44px] overflow-hidden text-left px-2 py-1 rounded-md text-[11px] font-bold leading-tight transition-colors ${
                          STATE_STYLE[entry.state]
                        } ${clickable ? '' : 'cursor-default'}`}
                        title={
                          entry.state === 'off_grid'
                            ? 'Reunião fora da grade atual (a grade mudou depois, ou foi um encaixe)'
                            : entry.state === 'blocked'
                              ? entry.blockReason ?? 'Horário bloqueado'
                              : entry.state === 'free'
                                ? 'Livre — clique para bloquear'
                                : undefined
                        }
                      >
                        <span className="flex items-center gap-1">
                          {entry.state === 'blocked' && <Lock className="w-3 h-3 shrink-0" />}
                          {entry.time}
                          {pendingContract && <FileSignature className="w-3 h-3 shrink-0 text-yellow-200" />}
                          {entry.appointment?.meetUrl && <Video className="w-3 h-3 shrink-0 opacity-70" />}
                        </span>
                        {name && <span className="block truncate text-[10px]">{name}</span>}
                        {entry.state === 'blocked' && !name && (
                          <span className="block truncate opacity-70 text-[10px]">
                            {entry.blockReason ?? 'bloqueado'}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------------------------------------- pop-up de bloqueio */}
      {action && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          onClick={() => !saving && setAction(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-sm font-black uppercase tracking-widest text-slate-600">
                {action.entry.state === 'free' ? 'Bloquear horário' : 'Liberar horário'}
              </h4>
              <button
                onClick={() => setAction(null)}
                disabled={saving}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-5">
              <p className="text-sm text-slate-600 leading-relaxed">
                {action.entry.state === 'free' ? (
                  <>
                    Bloquear <b>{action.day.slice(8)}/{action.day.slice(5, 7)}</b> às{' '}
                    <b>{action.entry.time}</b>? O horário some das opções do cliente
                    na hora.
                  </>
                ) : (
                  <>
                    Liberar <b>{action.day.slice(8)}/{action.day.slice(5, 7)}</b> às{' '}
                    <b>{action.entry.time}</b>? Ele volta a aparecer para os clientes.
                  </>
                )}
              </p>
              <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
                Reunião já marcada não é afetada — isto só muda o que o cliente
                pode escolher daqui pra frente.
              </p>
            </div>

            <div className="px-5 py-4 bg-slate-50 flex gap-2 justify-end">
              <button
                onClick={() => setAction(null)}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmAction}
                disabled={saving}
                className={`px-4 py-2 rounded-lg text-xs font-black text-white transition-colors disabled:opacity-50 ${
                  action.entry.state === 'free'
                    ? 'bg-slate-700 hover:bg-slate-800'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {saving
                  ? 'Salvando...'
                  : action.entry.state === 'free'
                    ? 'Bloquear'
                    : 'Liberar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
