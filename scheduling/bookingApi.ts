// Ponte entre a página pública e a Edge Function `booking`.
//
// A página pública NUNCA fala direto com o Supabase — ela só conhece esta
// função, que roda com service_role do outro lado. É o que impede alguém
// de varrer a base de clientes com a chave que fica exposta no navegador.

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/booking`;

export type AvailabilityResponse = {
  ok: true;
  mode: 'personal' | 'public' | 'fit_in';
  firstName: string;
  durationMinutes: number;
  lastMeetingDay?: string | null;
  suggestedDay?: string | null;
  days: Array<{ day: string; times: string[] }>;
};

export type ManageResponse = {
  ok: true;
  appointment: {
    day: string;
    time: string;
    status: 'CONFIRMED' | 'CANCELED';
    meetUrl: string | null;
    name: string | null;
  };
  cancelable: boolean;
  cancelMinNoticeHours: number;
};

export type BookingError = { ok: false; error: string };

/**
 * O projeto não compila em modo `strict`, e sem isso o TypeScript não
 * estreita a união pelo campo `ok`. Este guard resolve de forma explícita.
 */
export const isBookingError = (response: unknown): response is BookingError =>
  !!response && (response as BookingError).ok === false;

const MESSAGES: Record<string, string> = {
  invalid_token: 'Este link não é válido ou expirou. Fale com o Eduardo para receber um novo.',
  slot_taken: 'Que pena — alguém acabou de reservar esse horário. Escolha outro, por favor.',
  slot_unavailable: 'Esse horário não está mais disponível. Escolha outro, por favor.',
  already_booked: 'Você já tem uma reunião marcada. Se precisar remarcar, fale com o Eduardo.',
  missing_contact: 'Preencha seu nome e telefone.',
  missing_consent: 'É preciso aceitar o uso dos dados para agendar.',
  missing_slot: 'Escolha um dia e um horário.',
  too_late: 'Já passou do prazo para cancelar sozinho. Fale com o Eduardo, por favor.',
  not_found: 'Não encontrei essa reunião.'
};

export const errorMessage = (code: string): string =>
  MESSAGES[code] ?? 'Não consegui completar agora. Tente de novo em instantes.';

async function call<T>(action: string, body: Record<string, unknown>): Promise<T | BookingError> {
  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...body })
    });
    return (await response.json()) as T | BookingError;
  } catch {
    return { ok: false, error: 'network' };
  }
}

export const fetchAvailability = (token: string | null) =>
  call<AvailabilityResponse>('availability', { token });

export const createBooking = (input: {
  token: string | null;
  day: string;
  time: string;
  name?: string;
  email?: string;
  phone?: string;
  consent: boolean;
}) => call<{ ok: true; manageToken: string }>('create', input);

export const fetchBooking = (manageToken: string) =>
  call<ManageResponse>('manage', { manageToken });

export const cancelBooking = (manageToken: string) =>
  call<{ ok: true }>('cancel', { manageToken });
