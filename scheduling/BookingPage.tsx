import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Video } from 'lucide-react';
import { Logo } from './Logo';
import {
  AvailabilityResponse,
  createBooking,
  errorMessage,
  fetchAvailability,
  isBookingError
} from './bookingApi';
import { BookingCalendar } from './BookingCalendar';
import { formatMeetingLabel, zonedToInstant } from './timezone';

interface BookingPageProps {
  /** null = link geral (quem ainda não é cliente) */
  token: string | null;
}

type Stage = 'loading' | 'choosing' | 'details' | 'done' | 'dead_end';

export function BookingPage({ token }: BookingPageProps) {
  const [stage, setStage] = useState<Stage>('loading');
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isPersonal = availability?.mode === 'personal' || availability?.mode === 'fit_in';

  useEffect(() => {
    let active = true;
    fetchAvailability(token).then(response => {
      if (!active) return;
      if (isBookingError(response)) {
        setError(errorMessage(response.error));
        setStage('dead_end');
        return;
      }
      setAvailability(response);
      setStage(response.days.length === 0 ? 'dead_end' : 'choosing');
    });
    return () => { active = false; };
  }, [token]);

  const availableDays = useMemo(
    () => (availability?.days ?? []).map(entry => entry.day),
    [availability]
  );

  const timesOfDay = useMemo(
    () => availability?.days.find(entry => entry.day === selectedDay)?.times ?? [],
    [availability, selectedDay]
  );

  const handleSelectDay = (day: string) => {
    setSelectedDay(day);
    setSelectedTime(null);
  };

  const handleConfirm = async () => {
    if (!selectedDay || !selectedTime) return;

    setSubmitting(true);
    setError(null);

    const response = await createBooking({
      token,
      day: selectedDay,
      time: selectedTime,
      name: isPersonal ? undefined : name.trim(),
      email: isPersonal ? undefined : email.trim(),
      phone: isPersonal ? undefined : phone.replace(/\D/g, ''),
      consent: isPersonal ? true : consent
    });

    setSubmitting(false);

    if (isBookingError(response)) {
      setError(errorMessage(response.error));
      // Horário tomado por outra pessoa: recarrega para não insistir nele.
      if (response.error === 'slot_taken' || response.error === 'slot_unavailable') {
        setSelectedTime(null);
        const fresh = await fetchAvailability(token);
        if (!isBookingError(fresh)) setAvailability(fresh);
      }
      return;
    }

    setStage('done');
  };

  const chosenLabel =
    selectedDay && selectedTime
      ? formatMeetingLabel(zonedToInstant(selectedDay, selectedTime))
      : '';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <header className="flex justify-center mb-6">
          <Logo />
        </header>

        <main className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
          {stage === 'loading' && (
            <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-sm">Carregando os horários…</span>
            </div>
          )}

          {stage === 'dead_end' && (
            <div className="py-10 text-center space-y-2">
              <p className="text-slate-700 font-semibold">
                {error ?? 'Não há horários disponíveis no momento.'}
              </p>
              {!error && (
                <p className="text-sm text-slate-500">
                  Os horários costumam abrir conforme a data se aproxima. Tente novamente
                  em alguns dias, ou fale com o Eduardo.
                </p>
              )}
            </div>
          )}

          {stage === 'choosing' && availability && (
            <>
              <div className="mb-5 text-center">
                <h1 className="text-xl font-black text-slate-800">
                  {availability.firstName ? `Olá, ${availability.firstName}!` : 'Vamos agendar?'}
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                  {availability.lastMeetingDay
                    ? `Sua última reunião foi em ${availability.lastMeetingDay.slice(8)}/${availability.lastMeetingDay.slice(5, 7)}. Escolha o melhor dia para a próxima:`
                    : 'Escolha o melhor dia para a nossa reunião:'}
                </p>
              </div>

              <BookingCalendar
                availableDays={availableDays}
                selectedDay={selectedDay}
                suggestedDay={availability.suggestedDay}
                onSelect={handleSelectDay}
              />

              {selectedDay && (
                <div className="mt-6 pt-5 border-t border-slate-100">
                  <h2 className="text-sm font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-1.5">
                    <Clock className="w-4 h-4" /> Horários
                  </h2>
                  <div className="grid grid-cols-3 gap-2">
                    {timesOfDay.map(time => (
                      <button
                        key={time}
                        type="button"
                        onClick={() => setSelectedTime(time)}
                        className={`py-2.5 rounded-xl text-sm font-bold transition-all ${
                          selectedTime === time
                            ? 'bg-slate-800 text-white shadow-md'
                            : 'bg-slate-50 text-slate-700 border border-slate-200 hover:border-yellow-400'
                        }`}
                      >
                        {time}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <p className="mt-4 text-sm text-red-600 font-semibold text-center">{error}</p>
              )}

              {selectedTime && (
                <button
                  type="button"
                  onClick={() => (isPersonal ? handleConfirm() : setStage('details'))}
                  disabled={submitting}
                  className="mt-6 w-full py-3 rounded-xl bg-yellow-500 hover:bg-yellow-600 disabled:opacity-60 text-white font-black transition-colors flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {submitting ? 'Confirmando…' : 'Confirmar reunião'}
                </button>
              )}

              {selectedTime && (
                <p className="mt-2 text-center text-xs text-slate-400">{chosenLabel}</p>
              )}
            </>
          )}

          {stage === 'details' && (
            <>
              <h1 className="text-xl font-black text-slate-800 mb-1">Seus dados</h1>
              <p className="text-sm text-slate-500 mb-5">{chosenLabel}</p>

              <div className="space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Nome completo *
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                  WhatsApp *
                  <input
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    inputMode="tel"
                    placeholder="(00) 00000-0000"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                  E-mail
                  <input
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    inputMode="email"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                  <span className="block mt-1 font-normal normal-case text-[11px] text-slate-400">
                    Se informar, você recebe o convite com o link da videochamada.
                  </span>
                </label>

                <label className="flex items-start gap-2 text-xs text-slate-500 pt-1">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={e => setConsent(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded accent-yellow-500 shrink-0"
                  />
                  <span>
                    Autorizo o uso dos meus dados para agendar e confirmar esta reunião.
                    Eles não são compartilhados com terceiros.
                  </span>
                </label>
              </div>

              {error && (
                <p className="mt-4 text-sm text-red-600 font-semibold text-center">{error}</p>
              )}

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => { setStage('choosing'); setError(null); }}
                  className="px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-bold transition-colors"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={submitting || !name.trim() || !phone.trim() || !consent}
                  className="flex-1 py-3 rounded-xl bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-white font-black transition-colors flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {submitting ? 'Confirmando…' : 'Confirmar reunião'}
                </button>
              </div>
            </>
          )}

          {stage === 'done' && (
            <div className="py-8 text-center space-y-3">
              <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
              <h1 className="text-xl font-black text-slate-800">Reunião confirmada!</h1>
              <p className="text-slate-600 font-semibold">{chosenLabel}</p>
              <div className="pt-2 text-sm text-slate-500 space-y-1.5">
                <p className="flex items-center justify-center gap-1.5">
                  <Video className="w-4 h-4" />
                  Você vai receber o link da videochamada no WhatsApp.
                </p>
                <p>A tolerância de atraso é de 20 minutos, conforme contrato.</p>
              </div>
            </div>
          )}
        </main>

        <p className="text-center text-xs text-slate-400 mt-5">
          Consultoria financeira · reuniões de {availability?.durationMinutes ?? 60} minutos
        </p>
      </div>
    </div>
  );
}
