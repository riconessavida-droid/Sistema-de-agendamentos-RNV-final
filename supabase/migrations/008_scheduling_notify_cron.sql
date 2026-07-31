-- =====================================================================
-- Notificações do agendamento — o disparo das 21h.
--
-- Uma vez por dia a função scheduling-notify:
--   1) manda o lembrete de véspera para quem tem reunião amanhã
--   2) manda o resumo do dia seguinte no WhatsApp do Eduardo
-- Se não houver reunião amanhã, não manda nada.
--
-- Rode uma vez no Supabase (SQL Editor).
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 21:00 em Brasília = 00:00 UTC do dia seguinte (UTC-3).
select cron.schedule(
  'scheduling-notify-diario',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := 'https://dxqfiucnvlzjukoleqcv.supabase.co/functions/v1/scheduling-notify',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- Para conferir os jobs:       select * from cron.job;
-- Para ver as últimas rodadas: select * from cron.job_run_details order by start_time desc limit 10;
-- Para desligar, se quiser:    select cron.unschedule('scheduling-notify-diario');

-- Conferir o que já foi enviado:
--   select * from public.scheduling_notifications order by sent_at desc limit 20;
