-- =====================================================================
-- Integração eAgenda  →  Sistema de Agendamentos RNV
-- Rode este arquivo uma vez no Supabase (SQL Editor).
-- Cria a fila de conciliação e a tabela que "aprende" o vínculo
-- entre uma pessoa do eAgenda e um cliente do sistema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Fila de conciliação: cada agendamento que chega do eAgenda.
--    A maioria vira MATCHED automaticamente (quando o person_key já
--    está vinculado). Só os PENDING aparecem na tela de Conciliação.
-- ---------------------------------------------------------------------
create table if not exists public.eagenda_bookings (
  appointment_key     text primary key,          -- id do agendamento no eAgenda
  person_key          text,                       -- id da pessoa no eAgenda
  attendee_name       text,
  attendee_email      text,
  start_datetime      timestamptz not null,       -- data/hora agendada
  month_key           text not null,              -- "2026-07" (mês do agendamento)
  day_of_month        int  not null,              -- dia (1..31)  → vira o customDate
  event_status        text,                       -- ATTENDED / PENDING / CANCELED (vindo do eAgenda)
  conciliation_status text not null default 'PENDING'
                        check (conciliation_status in ('PENDING','MATCHED','IGNORED','CANCELED')),
  matched_client_id   text,                       -- clients.id, quando conciliado
  raw                 jsonb,                      -- payload completo (auditoria/debug)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists eagenda_bookings_status_idx
  on public.eagenda_bookings (conciliation_status, start_datetime desc);

create index if not exists eagenda_bookings_person_idx
  on public.eagenda_bookings (person_key);

-- ---------------------------------------------------------------------
-- 2) Vínculo aprendido: person_key (eAgenda)  →  client_id (sistema).
--    Preenchido na 1ª conciliação manual. A partir daí, tudo daquela
--    pessoa cai automático.
-- ---------------------------------------------------------------------
create table if not exists public.eagenda_client_links (
  person_key   text primary key,
  client_id    text not null,
  linked_name  text,                              -- nome do eAgenda no momento do vínculo (referência)
  created_at   timestamptz not null default now()
);

create index if not exists eagenda_client_links_client_idx
  on public.eagenda_client_links (client_id);

-- ---------------------------------------------------------------------
-- 3) RLS — mesmo padrão do resto do app (acesso via anon key no
--    frontend; a Edge Function usa a service_role e ignora RLS).
--    Ajuste as policies conforme a sua política atual da tabela clients.
-- ---------------------------------------------------------------------
alter table public.eagenda_bookings      enable row level security;
alter table public.eagenda_client_links  enable row level security;

-- Leitura/escrita para usuários autenticados (o app usa a anon key com
-- sessão). Se a sua tabela `clients` usa policies diferentes, replique-as
-- aqui para manter consistência.
drop policy if exists eagenda_bookings_rw on public.eagenda_bookings;
create policy eagenda_bookings_rw
  on public.eagenda_bookings
  for all
  using (true)
  with check (true);

drop policy if exists eagenda_client_links_rw on public.eagenda_client_links;
create policy eagenda_client_links_rw
  on public.eagenda_client_links
  for all
  using (true)
  with check (true);

-- updated_at automático em eagenda_bookings
create or replace function public.touch_eagenda_bookings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_eagenda_bookings on public.eagenda_bookings;
create trigger trg_touch_eagenda_bookings
  before update on public.eagenda_bookings
  for each row execute function public.touch_eagenda_bookings_updated_at();
