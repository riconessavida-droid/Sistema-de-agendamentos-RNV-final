-- =====================================================================
-- 1) Lembrete de 30 minutos antes de cada reunião
-- 2) Feriados municipais (São José dos Campos e Caçapava)
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- Depois de rodar, cole a função scheduling-notify atualizada: é ela que
-- sabe o que fazer com o cron novo.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1a) O registro de "já avisei desta reunião".
--
-- O índice único (kind, ref_key) é a trava real contra o aviso repetido:
-- a cada 5 minutos a função tenta gravar a chave da reunião, e só quem
-- consegue gravar manda a notificação. Duas rodadas ao mesmo tempo não
-- conseguem gravar a mesma chave.
--
-- ref_day sozinho não serviria: ele é único por dia, e num dia há várias
-- reuniões. A chave carrega o id do agendamento (ou a chave do eAgenda).
-- ---------------------------------------------------------------------
alter table public.scheduling_notifications
  add column if not exists ref_key text;

create unique index if not exists scheduling_notifications_key_uk
  on public.scheduling_notifications (kind, ref_key)
  where ref_key is not null;

-- O CHECK de kind foi escrito junto com a tabela e não aceita 'soon'. O
-- nome dele é automático, então o bloco abaixo acha pelo conteúdo em vez
-- de chutar o nome.
do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.scheduling_notifications'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%daily_digest%'
  loop
    execute format('alter table public.scheduling_notifications drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.scheduling_notifications
  add constraint scheduling_notifications_kind_check
  check (kind in ('confirmation', 'day_before', 'daily_digest', 'admin_new_booking', 'soon'));


-- ---------------------------------------------------------------------
-- 1b) O cron de 5 em 5 minutos.
--
-- A função só olha quem começa daqui a 20–35 minutos, então rodada sem
-- reunião à vista não faz nada além de uma consulta curta.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'scheduling-notify-30min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://dxqfiucnvlzjukoleqcv.supabase.co/functions/v1/scheduling-notify',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{"mode":"soon"}'::jsonb
  );
  $$
);


-- ---------------------------------------------------------------------
-- 2) Feriados municipais.
--
-- Liga o bloqueio automático de 27/07 (aniversário de São José dos
-- Campos) e 14/04 (aniversário de Caçapava). As datas estão no código, em
-- scheduling/holidays.ts; aqui fica só o interruptor.
-- ---------------------------------------------------------------------
alter table public.scheduling_settings
  add column if not exists block_municipal_holidays boolean not null default true;


-- Conferir:
--   select * from cron.job;
--   select kind, ref_key, ok, sent_at from public.scheduling_notifications
--     where kind = 'soon' order by sent_at desc limit 10;
--   select block_municipal_holidays from public.scheduling_settings where id = 1;
