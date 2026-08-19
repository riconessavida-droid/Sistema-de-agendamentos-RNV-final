-- =====================================================================
-- Varredura de TODOS os cofres do D4Sign  →  Sistema de Agendamentos RNV
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- POR QUE EXISTE: o sync olhava um cofre só, escolhido na primeira rodada
-- por ter "contrato" no nome. Em 19/08/2026 descobrimos que um contrato
-- FINALIZADO desde o dia 18 estava invisível para o sistema — ele havia
-- sido enviado para outro cofre da mesma conta. A cliente aparecia sem
-- PDF na ficha e ninguém tinha como saber por quê.
--
-- Agora a lista de cofres fica guardada aqui e cada rodada varre todos.
-- =====================================================================

alter table public.d4sign_sync_state
  add column if not exists safes jsonb;

-- Zera a descoberta: a próxima rodada lista os cofres de novo e grava
-- todos, em vez de reaproveitar o único que estava fixado.
update public.d4sign_sync_state
   set safes = null,
       safe_uuid = null,
       safe_name = null
 where id = 1;

-- Conferir depois da próxima rodada:
--   select safes, documents_seen, last_run_at from public.d4sign_sync_state;
