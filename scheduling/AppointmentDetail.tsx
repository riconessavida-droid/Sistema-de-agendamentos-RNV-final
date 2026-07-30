import React from 'react';
import { AlertTriangle, Mail, Phone, Video, X } from 'lucide-react';
import { Client } from '../types';
import { getMonthLabel } from '../constants';
import { canCancel } from './availability';
import { formatMeetingLabel } from './timezone';
import { Appointment, SchedulingSettings } from './types';

interface AppointmentDetailProps {
  appointment: Appointment;
  client?: Client;
  settings: SchedulingSettings;
  now: Date;
  onClose: () => void;
}

/**
 * Últimas reuniões do cliente, lidas do statusByMonth.
 * (melhoria B — entrar na call já sabendo o histórico)
 */
const recentMeetings = (client: Client | undefined, limit = 4): string[] => {
  if (!client) return [];
  return Object.entries(client.statusByMonth || {})
    .filter(([, value]) => value?.customDate)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, limit)
    .map(([monthKey, value]) => `${String(value.customDate).padStart(2, '0')} de ${getMonthLabel(monthKey)}`);
};

const formatPhone = (digits: string | null): string | null => {
  if (!digits) return null;
  const clean = digits.replace(/\D/g, '').slice(-11);
  if (clean.length < 10) return digits;
  const ddd = clean.slice(0, 2);
  const rest = clean.slice(2);
  return rest.length === 9
    ? `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`
    : `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
};

export function AppointmentDetail({
  appointment,
  client,
  settings,
  now,
  onClose
}: AppointmentDetailProps) {
  const startsAt = new Date(appointment.startsAt);
  const history = recentMeetings(client);
  const phone = formatPhone(appointment.attendeePhone ?? client?.phoneDigits ?? null);
  const email = appointment.attendeeEmail ?? client?.email ?? null;
  const stillCancelable = canCancel(appointment, now, settings);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-800">
              {client?.name ?? appointment.attendeeName ?? 'Agendamento'}
            </h3>
            <p className="text-sm text-slate-500 mt-0.5">{formatMeetingLabel(startsAt)}</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-300 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {client && !client.contractSigned && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                <strong>Contrato pendente.</strong> Este cliente ainda não assinou.
                {client.contractIssue && <> Motivo: {client.contractIssue}</>}
              </span>
            </div>
          )}

          {appointment.status === 'CANCELED' && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-semibold">
              Reunião cancelada
              {appointment.cancelReason ? ` — ${appointment.cancelReason}` : ''}.
            </div>
          )}

          {appointment.meetUrl ? (
            <a
              href={appointment.meetUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold transition-colors"
            >
              <Video className="w-4 h-4" /> Abrir videoconferência
            </a>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 text-sm">
              <Video className="w-4 h-4 shrink-0" />
              Sem link de videochamada ainda.
            </div>
          )}

          <div className="space-y-1.5 text-sm text-slate-600">
            {phone && (
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                <a href={`https://wa.me/55${phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="hover:text-yellow-600">
                  {phone}
                </a>
              </div>
            )}
            {email && (
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="truncate">{email}</span>
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                Reuniões anteriores
              </h4>
              <ul className="text-sm text-slate-600 space-y-0.5">
                {history.map(entry => (
                  <li key={entry}>· {entry}</li>
                ))}
              </ul>
            </div>
          )}

          {appointment.status === 'CONFIRMED' && !stillCancelable && (
            <p className="text-xs text-slate-400 pt-1">
              O cliente já não consegue cancelar sozinho (o prazo é de{' '}
              {settings.cancelMinNoticeHours}h antes).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
