-- =====================================================================
-- Sistema de Agendamento próprio (substitui o eAgenda)
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- Cinco peças:
--   1) scheduling_settings   configurações gerais (duração, antecedências)
--   2) availability_rules    a grade: faixas de atendimento por dia da semana
--   3) schedule_blocks       bloqueios (férias, compromissos, importados)
--   4) appointments          os agendamentos em si
--   5) booking_links         o link pessoal de cada cliente
--   + holiday_overrides      feriados extras / liberados
--   + scheduling_notifications  log de envio (evita mandar 2x)
--
-- REGRA CENTRAL: um agendamento é INDEPENDENTE da grade. Depois de criado,
-- ele nunca mais consulta availability_rules. Por isso mudar a grade só
-- afeta o que ainda pode ser marcado, nunca o que já foi — que é
-- exatamente o comportamento do eAgenda.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Configurações gerais (linha única)
-- ---------------------------------------------------------------------
create table if not exists public.scheduling_settings (
  id                        int primary key default 1 check (id = 1),
  slot_duration_minutes     int  not null default 60,   -- duração do atendimento
  min_notice_hours          int  not null default 24,   -- antecedência mínima
  max_advance_days          int  not null default 15,   -- antecedência máxima
  cancel_min_notice_hours   int  not null default 5,    -- prazo mínimo p/ cancelar
  block_national_holidays   boolean not null default true,
  block_state_holidays      boolean not null default true,
  state_code                text not null default 'SP',
  timezone                  text not null default 'America/Sao_Paulo',
  updated_at                timestamptz not null default now()
);

-- Valores atuais do eAgenda, para o comportamento não mudar no dia da virada.
insert into public.scheduling_settings (id) values (1)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2) A grade: faixas de atendimento por dia da semana.
--    Uma faixa 18:30–21:30 com duração de 60min gera 18:30, 19:30 e 20:30
--    (o horário só existe se início + duração couber dentro da faixa).
--    weekday segue o padrão do JavaScript: 0 = domingo ... 6 = sábado.
-- ---------------------------------------------------------------------
create table if not exists public.availability_rules (
  id          bigserial primary key,
  weekday     smallint not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists availability_rules_weekday_idx
  on public.availability_rules (weekday, start_time);

-- Grade atual do eAgenda (conferida contra o painel em 30/07/2026).
insert into public.availability_rules (weekday, start_time, end_time) values
  (1, '08:30', '10:30'), (1, '14:00', '17:00'), (1, '18:30', '21:30'),  -- Segunda
  (2, '08:30', '10:30'), (2, '14:00', '17:00'), (2, '18:30', '20:30'),  -- Terça
  (3, '14:00', '17:00'), (3, '18:30', '20:30'),                          -- Quarta
  (4, '08:30', '10:30'), (4, '14:00', '17:00'), (4, '18:30', '19:30'),  -- Quinta
  (5, '14:00', '17:00'),                                                 -- Sexta
  (6, '09:00', '10:00')                                                  -- Sábado
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3) Bloqueios. Mesmo formato da tela de bloqueio do eAgenda:
--      - date_to NULL      => bloqueia só o dia date_from
--      - time_from NULL    => bloqueia o dia inteiro
--      - time_from/time_to => bloqueia essa faixa EM CADA dia do período
--    (ex.: de 20/12 a 05/01, dia inteiro = férias)
-- ---------------------------------------------------------------------
create table if not exists public.schedule_blocks (
  id           bigserial primary key,
  date_from    date not null,
  date_to      date,
  time_from    time,
  time_to      time,
  reason       text,
  source       text not null default 'manual'
                 check (source in ('manual', 'eagenda', 'google')),
  external_ref text,                       -- appointment_key do eAgenda (evita duplicar na importação)
  created_at   timestamptz not null default now(),
  check (date_to is null or date_to >= date_from),
  check ((time_from is null) = (time_to is null)),
  check (time_to is null or time_to > time_from)
);

create index if not exists schedule_blocks_range_idx
  on public.schedule_blocks (date_from, date_to);

create unique index if not exists schedule_blocks_external_ref_uk
  on public.schedule_blocks (source, external_ref)
  where external_ref is not null;

-- ---------------------------------------------------------------------
-- 4) Agendamentos.
--    client_id fica NULL quando quem agendou ainda não é cliente do
--    sistema (prospect vindo pelo link geral) — a conciliação resolve depois.
-- ---------------------------------------------------------------------
create table if not exists public.appointments (
  id              uuid primary key default gen_random_uuid(),
  client_id       text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  attendee_name   text,
  attendee_email  text,
  attendee_phone  text,                    -- só dígitos
  status          text not null default 'CONFIRMED'
                    check (status in ('CONFIRMED', 'CANCELED')),
  meet_url        text,                    -- link do Google Meet
  google_event_id text,                    -- id do evento no Google Calendar
  manage_token    text not null,           -- token da página "sua reunião"
  source          text not null default 'personal_link'
                    check (source in ('personal_link', 'public_link', 'manual', 'fit_in')),
  canceled_at     timestamptz,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- TRAVA DE DUPLA MARCAÇÃO: dois clientes clicando no mesmo horário ao mesmo
-- tempo. Garantida pelo banco, não por checagem no código — checagem no
-- código sempre fura numa corrida.
create unique index if not exists appointments_slot_uk
  on public.appointments (starts_at)
  where status = 'CONFIRMED';

create unique index if not exists appointments_manage_token_uk
  on public.appointments (manage_token);

create index if not exists appointments_period_idx
  on public.appointments (starts_at) where status = 'CONFIRMED';

create index if not exists appointments_client_idx
  on public.appointments (client_id, starts_at desc);

-- ---------------------------------------------------------------------
-- 5) Link pessoal do cliente.
--    fit_in_starts_at preenchido = "link de encaixe": vale para um único
--    horário, mesmo fora da grade (o cliente que pediu 7h da manhã).
-- ---------------------------------------------------------------------
create table if not exists public.booking_links (
  token            text primary key,
  client_id        text not null,
  active           boolean not null default true,
  fit_in_starts_at timestamptz,
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz
);

create index if not exists booking_links_client_idx
  on public.booking_links (client_id) where active;

-- ---------------------------------------------------------------------
-- Feriados: os nacionais e os estaduais de SP são calculados no código
-- (inclusive os móveis, que dependem da Páscoa). Esta tabela é só para
-- exceções — bloquear uma data a mais, ou liberar um feriado que você
-- quer atender.
-- ---------------------------------------------------------------------
create table if not exists public.holiday_overrides (
  day        date primary key,
  kind       text not null check (kind in ('block', 'allow')),
  label      text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Log de notificações — evita mandar a mesma mensagem duas vezes.
--   appointment_id: confirmação e lembrete de véspera
--   ref_day:        resumo diário (um por dia)
-- ---------------------------------------------------------------------
create table if not exists public.scheduling_notifications (
  id             bigserial primary key,
  kind           text not null
                   check (kind in ('confirmation', 'day_before', 'daily_digest', 'admin_new_booking')),
  appointment_id uuid,
  ref_day        date,
  ok             boolean not null default true,
  detail         text,
  sent_at        timestamptz not null default now()
);

create unique index if not exists scheduling_notifications_appt_uk
  on public.scheduling_notifications (kind, appointment_id)
  where appointment_id is not null;

create unique index if not exists scheduling_notifications_day_uk
  on public.scheduling_notifications (kind, ref_day)
  where ref_day is not null;

-- ---------------------------------------------------------------------
-- RLS
--
-- Estas tabelas guardam dado pessoal (nome, e-mail, telefone), então
-- seguem o padrão da tabela `clients` (exige usuário autenticado) e NÃO o
-- de `eagenda_bookings` (aberto). A página pública de agendamento não fala
-- direto com o banco: ela passa pelas Edge Functions, que usam a
-- service_role e ignoram RLS.
-- ---------------------------------------------------------------------
alter table public.scheduling_settings      enable row level security;
alter table public.availability_rules       enable row level security;
alter table public.schedule_blocks          enable row level security;
alter table public.appointments             enable row level security;
alter table public.booking_links            enable row level security;
alter table public.holiday_overrides        enable row level security;
alter table public.scheduling_notifications enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'scheduling_settings', 'availability_rules', 'schedule_blocks',
    'appointments', 'booking_links', 'holiday_overrides',
    'scheduling_notifications'
  ] loop
    execute format('drop policy if exists %I_rw on public.%I', t, t);
    execute format(
      'create policy %I_rw on public.%I for all to authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

-- updated_at automático
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_appointments on public.appointments;
create trigger trg_touch_appointments
  before update on public.appointments
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_scheduling_settings on public.scheduling_settings;
create trigger trg_touch_scheduling_settings
  before update on public.scheduling_settings
  for each row execute function public.touch_updated_at();
