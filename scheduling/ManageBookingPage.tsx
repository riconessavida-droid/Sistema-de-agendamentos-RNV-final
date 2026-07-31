import React, { useEffect, useState } from 'react';
import { Loader2, Video, XCircle } from 'lucide-react';
import { Logo, RNV_OFFWHITE } from './Logo';
import {
  ManageResponse,
  cancelBooking,
  errorMessage,
  fetchBooking,
  isBookingError
} from './bookingApi';
import { formatMeetingLabel, zonedToInstant } from './timezone';

interface ManageBookingPageProps {
  manageToken: string;
}

/**
 * A página "sua reunião" — é o link que vai no WhatsApp de confirmação e no
 * lembrete de véspera. Concentra o link da videochamada e o cancelamento
 * num endereço só, então a mensagem não precisa carregar vários links (e o
 * template da Meta fica mais simples de aprovar).
 */
export function ManageBookingPage({ manageToken }: ManageBookingPageProps) {
  const [data, setData] = useState<ManageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const load = async () => {
    const response = await fetchBooking(manageToken);
    setLoading(false);
    if (isBookingError(response)) {
      setError(errorMessage(response.error));
      return;
    }
    setData(response);
  };

  useEffect(() => { load(); }, [manageToken]);

  const handleCancel = async () => {
    setCanceling(true);
    setError(null);
    const response = await cancelBooking(manageToken);
    setCanceling(false);
    setConfirmingCancel(false);
    if (isBookingError(response)) {
      setError(errorMessage(response.error));
      return;
    }
    await load();
  };

  const appointment = data?.appointment;
  const canceled = appointment?.status === 'CANCELED';

  return (
    <div className="font-body min-h-screen flex flex-col items-center px-4 py-8" style={{ backgroundColor: RNV_OFFWHITE }}>
      <div className="w-full max-w-md">
        <header className="flex justify-center mb-6">
          <Logo />
        </header>

        <main className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
          {loading && (
            <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-sm">Carregando…</span>
            </div>
          )}

          {!loading && !appointment && (
            <p className="py-10 text-center text-slate-600 font-semibold">
              {error ?? 'Não encontrei essa reunião.'}
            </p>
          )}

          {appointment && (
            <div className="space-y-4">
              <div className="text-center">
                <h1 className="text-sm font-black uppercase tracking-widest text-slate-400">
                  {canceled ? 'Reunião cancelada' : 'Sua reunião'}
                </h1>
                <p
                  className={`text-xl font-black mt-1 ${
                    canceled ? 'text-slate-400 line-through' : 'text-slate-800'
                  }`}
                >
                  {formatMeetingLabel(zonedToInstant(appointment.day, appointment.time))}
                </p>
              </div>

              {!canceled && (
                <>
                  {appointment.meetUrl ? (
                    <a
                      href={appointment.meetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black transition-colors"
                    >
                      <Video className="w-4 h-4" /> Entrar na videochamada
                    </a>
                  ) : (
                    <p className="text-center text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl py-3 px-4">
                      O link da videochamada chega no seu WhatsApp antes da reunião.
                    </p>
                  )}

                  <p className="text-center text-xs text-slate-400">
                    A tolerância de atraso é de 20 minutos, conforme contrato.
                  </p>
                </>
              )}

              {error && (
                <p className="text-sm text-red-600 font-semibold text-center">{error}</p>
              )}

              {!canceled && data?.cancelable && !confirmingCancel && (
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(true)}
                  className="w-full py-2.5 text-sm font-bold text-slate-400 hover:text-red-600 transition-colors"
                >
                  Preciso cancelar
                </button>
              )}

              {confirmingCancel && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
                  <p className="text-sm text-red-800 font-semibold text-center">
                    Cancelar esta reunião?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingCancel(false)}
                      className="flex-1 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-sm font-bold"
                    >
                      Manter
                    </button>
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={canceling}
                      className="flex-1 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-sm font-bold flex items-center justify-center gap-2"
                    >
                      {canceling ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {!canceled && data && !data.cancelable && (
                <p className="text-center text-xs text-slate-400 pt-1">
                  O cancelamento pelo site fecha {data.cancelMinNoticeHours}h antes da reunião.
                  Se precisar, fale com o Eduardo.
                </p>
              )}

              {canceled && (
                <p className="text-center text-sm text-slate-500">
                  Para marcar uma nova data, use o link de agendamento que o Eduardo te enviou.
                </p>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
