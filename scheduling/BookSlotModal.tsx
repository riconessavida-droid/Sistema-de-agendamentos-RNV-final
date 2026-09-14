import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarPlus, CheckCircle2, Mail, Search, X } from 'lucide-react';
import { Client, MeetingStatus } from '../types';
import { adminCreateAppointment, AdminBookingResult } from './db';
import { Appointment } from './types';
import { DayKey, formatMeetingLabel, zonedToInstant } from './timezone';

interface BookSlotModalProps {
  day: DayKey;
  time: string;
  clients: Client[];
  /** Agendamentos já carregados — servem para avisar de reunião duplicada. */
  appointments: Appointment[];
  now: Date;
  onClose: () => void;
  onBooked: () => Promise<void> | void;
}

const MAX_OPTIONS = 8;

const normalize = (value: string): string =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const isInactive = (client: Client): boolean =>
  Object.values(client.statusByMonth ?? {}).some(
    entry =>
      entry?.status === MeetingStatus.CLOSED_CONTRACT ||
      entry?.status === MeetingStatus.CANCELLED_EARLY
  );

/**
 * Agendar um cliente cadastrado num horário, pelo painel.
 *
 * É o fluxo do eAgenda que faltava: clicar no horário, procurar o cliente,
 * confirmar. O cliente recebe o mesmo e-mail de confirmação de quem marca
 * sozinho, com o link do Meet.
 *
 * Dois avisos aparecem ANTES de confirmar, porque depois é tarde:
 *  - ficha sem e-mail: a reunião é marcada, mas ninguém é avisado;
 *  - cliente com reunião futura: esta vira uma segunda, a outra continua.
 */
export function BookSlotModal({
  day,
  time,
  clients,
  appointments,
  now,
  onClose,
  onBooked
}: BookSlotModalProps) {
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<Client | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<AdminBookingResult | null>(null);

  const slotLabel = formatMeetingLabel(zonedToInstant(day, time));

  const options = useMemo(() => {
    const target = normalize(term);
    const digits = term.replace(/\D/g, '');
    if (target.length < 2 && digits.length < 3) return [];
    return clients
      .filter(client => !isInactive(client))
      .filter(
        client =>
          normalize(client.name).includes(target) ||
          (digits.length >= 3 && (client.phoneDigits ?? '').replace(/\D/g, '').includes(digits))
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_OPTIONS);
  }, [clients, term]);

  const nextMeeting = useMemo(() => {
    if (!chosen) return null;
    return (
      appointments
        .filter(
          a =>
            a.clientId === chosen.id &&
            a.status === 'CONFIRMED' &&
            new Date(a.startsAt).getTime() > now.getTime()
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null
    );
  }, [appointments, chosen, now]);

  const confirm = async () => {
    if (!chosen) return;
    setSaving(true);
    const outcome = await adminCreateAppointment(chosen.id, day, time);
    setSaving(false);
    setResult(outcome);
    if (!outcome.error) await onBooked();
  };

  const booked = result !== null && !result.error;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={event => event.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-black uppercase tracking-widest text-slate-600 flex items-center gap-2">
              <CalendarPlus className="w-4 h-4 text-emerald-600" /> Agendar cliente
            </h4>
            <p className="text-sm text-slate-500 mt-1">{slotLabel}</p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {booked && result ? (
          <div className="px-5 py-6 space-y-3">
            <p className="flex items-center gap-2 text-emerald-700 font-black">
              <CheckCircle2 className="w-5 h-5 shrink-0" /> Reunião marcada para {chosen?.name}.
            </p>
            {result.emailSent ? (
              <p className="text-sm text-slate-600">
                Confirmação enviada para <b>{result.emailTo}</b>
                {result.meetUrl ? ', com o link do Meet.' : '.'}
              </p>
            ) : (
              <p className="text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                {result.emailTo
                  ? 'O e-mail de confirmação não saiu. Avise o cliente por WhatsApp.'
                  : 'A ficha não tem e-mail, então o cliente não foi avisado. Mande a confirmação por WhatsApp.'}
              </p>
            )}
            {!result.meetUrl && (
              <p className="text-xs text-slate-400">
                O link do Meet não foi gerado agora — confira a aba Google.
              </p>
            )}
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3">
            {!chosen ? (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    value={term}
                    onChange={event => setTerm(event.target.value)}
                    placeholder="Nome ou telefone do cliente"
                    className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>

                {options.length > 0 ? (
                  <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-64 overflow-y-auto">
                    {options.map(client => (
                      <li key={client.id}>
                        <button
                          onClick={() => setChosen(client)}
                          className="w-full text-left px-3 py-2.5 hover:bg-yellow-50 transition-colors"
                        >
                          <span className="block text-sm font-bold text-slate-700">{client.name}</span>
                          <span className="block text-xs text-slate-400 truncate">
                            {client.phoneDigits || 'sem telefone'} · {client.email || 'sem e-mail'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400 px-1">
                    {term.trim().length < 2
                      ? 'Digite o nome do cliente cadastrado.'
                      : 'Nenhum cliente ativo com esse nome.'}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="rounded-lg border border-slate-200 px-3 py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-800 truncate">{chosen.name}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 truncate">
                      <Mail className="w-3 h-3 shrink-0" /> {chosen.email || 'sem e-mail'}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setChosen(null);
                      setResult(null);
                    }}
                    disabled={saving}
                    className="text-xs font-bold text-slate-400 hover:text-yellow-600 shrink-0"
                  >
                    Trocar
                  </button>
                </div>

                {!chosen.email && (
                  <p className="flex items-start gap-2 text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                    A ficha não tem e-mail: a reunião entra na agenda, mas o cliente não
                    recebe a confirmação.
                  </p>
                )}

                {nextMeeting && (
                  <p className="flex items-start gap-2 text-xs text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                    Já tem reunião em {formatMeetingLabel(new Date(nextMeeting.startsAt))}. Esta será
                    uma segunda reunião — a outra não é cancelada.
                  </p>
                )}

                {result?.error && <p className="text-xs font-bold text-red-600">{result.error}</p>}
              </>
            )}
          </div>
        )}

        <div className="px-5 py-4 bg-slate-50 flex gap-2 justify-end">
          {booked ? (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-black text-white bg-slate-700 hover:bg-slate-800 transition-colors"
            >
              Fechar
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirm}
                disabled={!chosen || saving}
                className="px-4 py-2 rounded-lg text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-40"
              >
                {saving ? 'Marcando...' : 'Confirmar agendamento'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
