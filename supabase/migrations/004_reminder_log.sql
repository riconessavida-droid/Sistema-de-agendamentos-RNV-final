-- =====================================================================
-- Log de lembretes de WhatsApp: evita mandar duas vezes o mesmo lembrete
-- e guarda a comprovação de envio (id da mensagem + status da Meta).
-- Rode uma vez no Supabase (SQL Editor).
-- =====================================================================

create table if not exists public.reminder_log (
  id             bigint generated always as identity primary key,
  client_id      text not null,
  month_key      text not null,        -- mês da reunião que o lembrete cobre (YYYY-MM)
  reminder_type  text not null,        -- '7d' | '3d'
  status         text,                 -- 'sent' | 'failed' | 'dry'
  wa_message_id  text,                 -- id da mensagem retornado pela Meta (comprovação)
  detail         text,                 -- erro/observação, se houver
  created_at     timestamptz not null default now(),
  unique (client_id, month_key, reminder_type)
);

create index if not exists reminder_log_client_idx on public.reminder_log (client_id, month_key);

alter table public.reminder_log enable row level security;
drop policy if exists reminder_log_rw on public.reminder_log;
create policy reminder_log_rw on public.reminder_log for all using (true) with check (true);
