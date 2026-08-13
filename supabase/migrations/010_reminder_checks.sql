-- =====================================================================
-- Conferência dos lembretes  →  Sistema de Agendamentos RNV
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- Para que serve: durante a migração do eAgenda, a assistente confere na
-- aba Tarefas do Dia se cada cliente que o sistema diz ter avisado
-- realmente recebeu a mensagem no papo.ai. Esta tabela guarda o "já
-- conferi este aqui", para ela não perder o lugar quando fecha a tela.
--
-- A chave é a mesma do reminder_log (cliente + mês + tipo), então serve
-- tanto para quem recebeu quanto para quem NÃO recebeu — que é
-- justamente o caso que ela precisa marcar depois de resolver na mão.
--
-- Seguro rodar mais de uma vez.
-- =====================================================================

create table if not exists public.reminder_checks (
  client_id     text not null,
  month_key     text not null,              -- "2026-08"
  reminder_type text not null check (reminder_type in ('3d','7d')),
  checked_at    timestamptz not null default now(),
  -- O que a assistente viu no papo.ai. Preenchido só quando ela marca
  -- como problema, para o Eduardo entender depois o que aconteceu.
  note          text,
  primary key (client_id, month_key, reminder_type)
);

create index if not exists reminder_checks_month_idx
  on public.reminder_checks (month_key, checked_at desc);

-- ---------------------------------------------------------------------
-- RLS — mesmo padrão das outras tabelas do sistema.
-- ---------------------------------------------------------------------
alter table public.reminder_checks enable row level security;

drop policy if exists reminder_checks_rw on public.reminder_checks;
create policy reminder_checks_rw
  on public.reminder_checks
  for all
  using (true)
  with check (true);

-- Conferir:
--   select * from public.reminder_checks order by checked_at desc limit 20;
