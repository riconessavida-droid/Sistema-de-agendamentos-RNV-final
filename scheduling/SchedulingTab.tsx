import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Link2, ListChecks, Lock, RefreshCw, Settings2, Video } from 'lucide-react';
import { Client, UserRole } from '../types';
import {
  SchedulingData,
  addBlock,
  importEagendaBlocks,
  loadSchedulingData,
  removeBlock,
  saveRules
} from './db';
import { DayKey, addDays, toDayKey, toTimeKey } from './timezone';
import { DEFAULT_SETTINGS, Appointment } from './types';
import { WeekCalendar, startOfWeek, ClientBadge } from './WeekCalendar';
import { HoursConfig } from './HoursConfig';
import { BlocksPanel } from './BlocksPanel';
import { AppointmentDetail } from './AppointmentDetail';
import { LinksPanel } from './LinksPanel';
import { GooglePanel } from './GooglePanel';

type SubTab = 'week' | 'day' | 'links' | 'hours' | 'blocks' | 'google';

const EMPTY: SchedulingData = {
  settings: DEFAULT_SETTINGS,
  rules: [],
  blocks: [],
  appointments: [],
  holidayOverrides: []
};

interface SchedulingTabProps {
  clients: Client[];
  role: UserRole;
  /** Dia vindo do link do resumo das 21h — abre direto na Lista do Dia. */
  initialDay?: string;
}

export function SchedulingTab({ clients, role, initialDay }: SchedulingTabProps) {
  const [now, setNow] = useState(() => new Date());
  const [anchorDay, setAnchorDay] = useState<DayKey>(() => initialDay || toDayKey(new Date()));
  /**
   * No celular abre na Lista do Dia; no computador, na semana.
   *
   * A grade semanal tem sete colunas e não cabe em 390px — o Eduardo
   * precisava arrastar a tela para os lados e ainda assim não conseguia
   * ler o dia inteiro. A lista de um dia só mostra exatamente o que ele
   * quer no telefone: os horários daquele dia, com Anterior e Próximo
   * para andar. No computador a semana continua sendo a melhor visão, e
   * as duas seguem disponíveis nos dois tamanhos.
   */
  const [subTab, setSubTab] = useState<SubTab>(() => {
    if (initialDay) return 'day';
    const noCelular = typeof window !== 'undefined' && window.innerWidth < 1024;
    return noCelular ? 'day' : 'week';
  });
  const [data, setData] = useState<SchedulingData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Appointment | null>(null);

  // Só o Eduardo mexe na grade; a assistente vê tudo e pode bloquear.
  const canEditGrid = role === UserRole.ADMIN;

  const clientsById = useMemo(() => {
    const map = new Map<string, ClientBadge>();
    for (const client of clients) {
      map.set(client.id, { name: client.name, contractSigned: !!client.contractSigned });
    }
    return map;
  }, [clients]);

  const clientRecord = useMemo(() => {
    const map = new Map<string, Client>();
    for (const client of clients) map.set(client.id, client);
    return map;
  }, [clients]);

  const reload = useCallback(async () => {
    setLoading(true);
    // Carrega uma janela folgada em volta da semana, para a Lista do Dia
    // e a navegação não precisarem de ida ao banco a cada clique.
    const weekStart = startOfWeek(anchorDay);
    const fresh = await loadSchedulingData(addDays(weekStart, -14), addDays(weekStart, 28));
    setData(fresh);
    setNow(new Date());
    setLoading(false);
  }, [anchorDay]);

  useEffect(() => { reload(); }, [reload]);

  const dayAppointments = useMemo(
    () =>
      data.appointments
        .filter(a => a.status === 'CONFIRMED' && toDayKey(new Date(a.startsAt)) === anchorDay)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [data.appointments, anchorDay]
  );

  const handleSaveRules = async (rules: Parameters<typeof saveRules>[0]) => {
    const error = await saveRules(rules);
    if (!error) await reload();
    return error;
  };

  const handleAddBlock = async (block: Parameters<typeof addBlock>[0]) => {
    const error = await addBlock(block);
    if (!error) await reload();
    return error;
  };

  const handleRemoveBlock = async (id: number) => {
    const error = await removeBlock(id);
    if (!error) await reload();
    return error;
  };

  /**
   * Bloqueio de um horário só, direto do calendário.
   *
   * Vira um bloqueio manual comum (mesma tabela do painel de Bloqueios),
   * com a duração de um slot. O motivo fica escrito para o Eduardo saber
   * depois que aquilo veio de um clique na semana, e não de uma regra.
   */
  const handleBlockSlot = async (day: DayKey, time: string) => {
    const [h, m] = time.split(':').map(Number);
    const end = new Date(Date.UTC(2000, 0, 1, h, m + data.settings.slotDurationMinutes));
    const timeTo = `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}`;

    const error = await addBlock({
      dateFrom: day,
      dateTo: null,
      timeFrom: time,
      timeTo,
      reason: 'bloqueado pela agenda'
    });
    if (error) window.alert(`Não consegui bloquear: ${error}`);
    else await reload();
  };

  const handleUnblockSlot = async (id: number) => {
    const error = await removeBlock(id);
    if (error) window.alert(`Não consegui liberar: ${error}`);
    else await reload();
  };

  const handleImport = async () => {
    const result = await importEagendaBlocks();
    if (!result.error) await reload();
    return result;
  };

  const SUB_TABS: Array<{ id: SubTab; label: string; icon: React.ReactNode }> = [
    { id: 'week', label: 'Semana', icon: <CalendarDays className="w-3.5 h-3.5" /> },
    { id: 'day', label: 'Lista do dia', icon: <ListChecks className="w-3.5 h-3.5" /> },
    { id: 'links', label: 'Links', icon: <Link2 className="w-3.5 h-3.5" /> },
    { id: 'hours', label: 'Horários', icon: <Settings2 className="w-3.5 h-3.5" /> },
    { id: 'blocks', label: 'Bloqueios', icon: <Lock className="w-3.5 h-3.5" /> },
    { id: 'google', label: 'Google', icon: <Video className="w-3.5 h-3.5" /> }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-yellow-500" />
            Agenda
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Sua grade de atendimento e as reuniões marcadas. Mudar os horários vale
            só para novos agendamentos.
          </p>
        </div>
        <button
          onClick={reload}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-semibold transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold w-fit">
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 transition-colors ${
              subTab === tab.id ? 'bg-yellow-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'week' && (
        <WeekCalendar
          anchorDay={anchorDay}
          now={now}
          data={data}
          clientsById={clientsById}
          onNavigate={setAnchorDay}
          onSelectAppointment={setSelected}
          onBlockSlot={handleBlockSlot}
          onUnblockSlot={handleUnblockSlot}
        />
      )}

      {subTab === 'day' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-600">
              {anchorDay === toDayKey(now) ? 'Hoje' : 'Dia'} ·{' '}
              {`${anchorDay.slice(8)}/${anchorDay.slice(5, 7)}/${anchorDay.slice(0, 4)}`}
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAnchorDay(addDays(anchorDay, -1))}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-bold"
              >
                Anterior
              </button>
              <button
                onClick={() => setAnchorDay(toDayKey(now))}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-bold"
              >
                Hoje
              </button>
              <button
                onClick={() => setAnchorDay(addDays(anchorDay, 1))}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-bold"
              >
                Próximo
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {dayAppointments.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-sm">
                Nenhuma reunião neste dia.
              </div>
            ) : (
              dayAppointments.map(appointment => {
                const client = appointment.clientId ? clientRecord.get(appointment.clientId) : undefined;
                const pendingContract = client ? !client.contractSigned : false;

                return (
                  <button
                    key={appointment.id}
                    onClick={() => setSelected(appointment)}
                    className="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-slate-50 transition-colors"
                  >
                    <span className="text-lg font-black text-slate-700 w-16 shrink-0">
                      {toTimeKey(new Date(appointment.startsAt))}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold text-slate-800 truncate">
                        {client?.name ?? appointment.attendeeName ?? 'Sem nome'}
                      </span>
                      <span className="block text-xs text-slate-400 truncate">
                        {appointment.attendeePhone ?? client?.phoneDigits ?? 'sem telefone'}
                      </span>
                    </span>
                    {pendingContract && (
                      <span className="px-2 py-1 rounded-md bg-yellow-100 text-yellow-800 text-[10px] font-black uppercase tracking-wider shrink-0">
                        Contrato pendente
                      </span>
                    )}
                    {appointment.meetUrl && (
                      <span className="px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-wider shrink-0">
                        Meet
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {subTab === 'links' && <LinksPanel clients={clients} now={now} />}

      {subTab === 'hours' && (
        <HoursConfig
          rules={data.rules}
          durationMinutes={data.settings.slotDurationMinutes}
          canEdit={canEditGrid}
          onSave={handleSaveRules}
        />
      )}

      {subTab === 'blocks' && (
        <BlocksPanel
          blocks={data.blocks}
          now={now}
          canEdit
          onAdd={handleAddBlock}
          onRemove={handleRemoveBlock}
          onImportEagenda={handleImport}
        />
      )}

      {subTab === 'google' && <GooglePanel canEdit={canEditGrid} />}

      {selected && (
        <AppointmentDetail
          appointment={selected}
          client={selected.clientId ? clientRecord.get(selected.clientId) : undefined}
          settings={data.settings}
          now={now}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
