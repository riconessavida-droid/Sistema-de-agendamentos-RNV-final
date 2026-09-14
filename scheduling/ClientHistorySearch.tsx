import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Client } from '../types';
import { HistoryEntry, loadBookingHistory } from './db';
import { Appointment } from './types';
import { TIMEZONE } from './timezone';

interface ClientHistorySearchProps {
  clients: Client[];
  now: Date;
  /** Muda quando a agenda recarrega — a busca descarta o que tinha guardado. */
  version: unknown;
  onSelectAppointment: (appointment: Appointment) => void;
}

const normalize = (value: string): string =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const ORIGIN_LABEL: Record<HistoryEntry['origin'], string> = {
  sistema: 'pelo link',
  agenda: 'pela agenda',
  eagenda: 'eAgenda'
};

const MIN_CHARS = 2;
const MAX_RESULTS = 60;

const dateLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: TIMEZONE });

const weekdayTimeLabel = (iso: string): string => {
  const instant = new Date(iso);
  const weekday = instant
    .toLocaleDateString('pt-BR', { timeZone: TIMEZONE, weekday: 'short' })
    .replace('.', '');
  const time = instant.toLocaleTimeString('pt-BR', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${weekday} · ${time}`;
};

/**
 * Busca por cliente: todas as reuniões dele, uma embaixo da outra.
 *
 * Responde "quando ele agendou?" e "ele já agendou?" sem andar semana por
 * semana. Olha as duas agendas e o ano inteiro, e mostra também o que foi
 * cancelado — às vezes a resposta é justamente essa.
 *
 * Os dados só são buscados quando alguém digita: quem abre a agenda para
 * ver a semana não paga por uma consulta que não pediu.
 */
export function ClientHistorySearch({
  clients,
  now,
  version,
  onSelectAppointment
}: ClientHistorySearchProps) {
  const [term, setTerm] = useState('');
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const target = normalize(term);
  const active = target.length >= MIN_CHARS;

  // A agenda recarregou (reunião marcada ou cancelada): o que estava guardado envelheceu.
  useEffect(() => {
    setHistory(null);
  }, [version]);

  useEffect(() => {
    if (!active || history || loading) return;
    let cancelled = false;
    setLoading(true);
    loadBookingHistory()
      .then(result => {
        if (!cancelled) setHistory(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, history, loading]);

  const clientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients) map.set(client.id, client.name);
    return map;
  }, [clients]);

  const results = useMemo(() => {
    if (!history || !active) return [];
    return history
      .filter(entry => {
        const fichaName = entry.clientId ? clientNames.get(entry.clientId) ?? '' : '';
        return (
          normalize(fichaName).includes(target) ||
          normalize(entry.attendeeName ?? '').includes(target)
        );
      })
      .slice(-MAX_RESULTS);
  }, [history, active, target, clientNames]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={term}
          onChange={event => setTerm(event.target.value)}
          placeholder="Buscar cliente para ver todos os agendamentos dele"
          className="w-full pl-9 pr-10 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-yellow-400"
        />
        {term && (
          <button
            onClick={() => setTerm('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            title="Limpar busca"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {active && (
        <div className="border-t border-slate-100">
          {loading && !history ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">Buscando...</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              Nenhum agendamento com esse nome no último ano.
            </p>
          ) : (
            <>
              <p className="px-4 pt-3 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                {results.length} {results.length === 1 ? 'agendamento' : 'agendamentos'}
              </p>
              <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {results.map(entry => {
                  const future = new Date(entry.startsAt).getTime() > now.getTime();
                  const name =
                    (entry.clientId && clientNames.get(entry.clientId)) ||
                    entry.attendeeName ||
                    'Sem nome';
                  const clickable = Boolean(entry.appointment);

                  const status = entry.canceled
                    ? { text: 'cancelada', style: 'bg-red-50 text-red-600' }
                    : future
                      ? { text: 'marcada', style: 'bg-emerald-100 text-emerald-700' }
                      : { text: 'passou', style: 'bg-slate-100 text-slate-500' };

                  return (
                    <li key={entry.key}>
                      <button
                        disabled={!clickable}
                        onClick={() => entry.appointment && onSelectAppointment(entry.appointment)}
                        className={`w-full text-left px-4 py-2.5 flex items-center gap-x-4 gap-y-1 flex-wrap transition-colors ${
                          clickable ? 'hover:bg-slate-50' : 'cursor-default'
                        }`}
                      >
                        <span
                          className={`text-sm font-black tabular-nums w-24 shrink-0 ${
                            entry.canceled ? 'text-slate-300 line-through' : 'text-slate-700'
                          }`}
                        >
                          {dateLabel(entry.startsAt)}
                        </span>
                        <span className="text-xs font-bold text-slate-500 w-20 shrink-0 tabular-nums">
                          {weekdayTimeLabel(entry.startsAt)}
                        </span>
                        <span className="flex-1 min-w-[8rem] text-sm font-semibold text-slate-700 truncate">
                          {name}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 shrink-0">
                          {ORIGIN_LABEL[entry.origin]}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider shrink-0 ${status.style}`}
                        >
                          {status.text}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
