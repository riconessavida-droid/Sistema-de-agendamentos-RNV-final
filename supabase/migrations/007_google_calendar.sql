-- =====================================================================
-- Integração Google Calendar / Google Meet
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- Guarda a autorização do Google (a mesma conta que o eAgenda já usa,
-- riconessavida@gmail.com) para o sistema poder:
--   1) criar o evento e o link do Meet a cada agendamento
--   2) colocar a reunião na agenda do Eduardo
--   3) ler a ocupação dele e não oferecer horário já comprometido
-- =====================================================================

create table if not exists public.google_credentials (
  id              int primary key default 1 check (id = 1),
  refresh_token   text not null,
  access_token    text,
  expires_at      timestamptz,
  connected_email text,
  calendar_id     text not null default 'primary',
  last_error      text,           -- último erro do Google (token revogado etc.)
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RLS: ligado e SEM NENHUMA POLICY, de propósito.
--
-- Sem policy, ninguém que use a chave pública do navegador consegue ler
-- esta tabela — nem o Eduardo, nem a assistente. Só a service_role (que
-- ignora RLS) enxerga, e ela só existe dentro das Edge Functions.
--
-- O refresh_token dá acesso à agenda do Google dele: não pode ficar ao
-- alcance do frontend, diferente das outras tabelas do agendamento.
-- ---------------------------------------------------------------------
alter table public.google_credentials enable row level security;

drop trigger if exists trg_touch_google_credentials on public.google_credentials;
create trigger trg_touch_google_credentials
  before update on public.google_credentials
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Colunas de apoio em appointments: quando o Meet falha, o agendamento
-- NÃO falha junto — ele fica marcado para nova tentativa e aparece em
-- vermelho na agenda.
-- ---------------------------------------------------------------------
alter table public.appointments
  add column if not exists meet_attempts int not null default 0,
  add column if not exists meet_error text;
