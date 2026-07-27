-- =====================================================================
-- Sincronização AUTOMÁTICA com o eAgenda (rede de segurança).
-- Roda a Edge Function eagenda-import a cada 15 min, de forma que, mesmo
-- que o webhook do eAgenda falhe em entregar um evento, o sistema se
-- auto-corrige e preenche as datas sozinho. É idempotente (não duplica,
-- preserva conciliados/ignorados).
--
-- Rode uma vez no Supabase (SQL Editor). Se pg_cron/pg_net não existirem,
-- habilite antes em Database > Extensions (pg_cron e pg_net).
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- (Re)cria o agendamento. cron.schedule com o mesmo nome substitui o anterior.
select cron.schedule(
  'eagenda-auto-sync',
  '*/15 * * * *',   -- a cada 15 minutos
  $$
  select net.http_post(
    url     := 'https://dxqfiucnvlzjukoleqcv.supabase.co/functions/v1/eagenda-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4cWZpdWNudmx6anVrb2xlcWN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyMzgwNjksImV4cCI6MjA4NDgxNDA2OX0.J77kGr_YxfUk4yOJGnCoYi1-jPZXGbOdMls8PyGsyzY'
    ),
    body    := jsonb_build_object('daysBack', 60, 'daysForward', 60)
  );
  $$
);

-- Para conferir os jobs:      select * from cron.job;
-- Para ver as últimas rodadas: select * from cron.job_run_details order by start_time desc limit 10;
-- Para desligar, se quiser:    select cron.unschedule('eagenda-auto-sync');
