-- =====================================================================
-- Conserto + trava do inventário do D4Sign
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- POR QUE EXISTE
--
-- Em 13/08/2026 a função d4sign-sync criou 3 clientes a partir de
-- contratos ANTIGOS do cofre — exatamente o backfill que estava
-- descartado no desenho. A causa não foi o D4Sign nem o parsing: foi o
-- critério que decidia se aquela era a "primeira rodada".
--
-- Duas heurísticas foram tentadas e as duas falharam:
--   1. "last_run_at em branco"  -> uma rodada que FALHA grava esse campo
--      ao registrar o erro, e o modo inventário se desligava sozinho.
--   2. "tabela de documentos vazia" -> uma rodada anterior, com código
--      velho, repovoava a tabela e desligava o inventário de novo.
--
-- A correção é parar de inferir e passar a MARCAR: `inventory_done` só
-- vira true no fim de um inventário bem-sucedido, e enquanto estiver
-- falsa a função se recusa a criar cliente.
--
-- Seguro rodar mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) A marca explícita.
-- ---------------------------------------------------------------------
alter table public.d4sign_sync_state
  add column if not exists inventory_done boolean not null default false;

-- Garante que o inventário rode de novo do zero depois da limpeza abaixo.
update public.d4sign_sync_state set inventory_done = false where id = 1;

-- ---------------------------------------------------------------------
-- 2) Desfaz o que a rodada errada criou.
--
--    São os 3 clientes nascidos de contratos do histórico. Nenhum deles
--    tem reunião, faturamento ou qualquer dado além do que veio do
--    contrato — foram criados hoje e nada mais tocou neles.
--
--    Confira antes de apagar, se quiser:
--      select id, name, email, cpf, contract_signed_at
--        from public.clients
--       where id in ('e8078fff-aa82-4fd9-a60a-424d564de52c',
--                    'e24a93cc-ee78-4bfa-a71e-32f9ebd996d0',
--                    '72fc6139-fdf1-4f8d-9838-0e40a4bf3905');
-- ---------------------------------------------------------------------
delete from public.d4sign_client_links
 where client_id in ('e8078fff-aa82-4fd9-a60a-424d564de52c',
                     'e24a93cc-ee78-4bfa-a71e-32f9ebd996d0',
                     '72fc6139-fdf1-4f8d-9838-0e40a4bf3905');

delete from public.clients
 where id in ('e8078fff-aa82-4fd9-a60a-424d564de52c',
              'e24a93cc-ee78-4bfa-a71e-32f9ebd996d0',
              '72fc6139-fdf1-4f8d-9838-0e40a4bf3905');

-- ---------------------------------------------------------------------
-- 3) Zera o que as rodadas de teste deixaram, para o inventário partir
--    de uma folha limpa. Nada aqui é dado de negócio: a tabela só foi
--    povoada hoje, por essas tentativas.
-- ---------------------------------------------------------------------
delete from public.d4sign_documents;

-- Conferir depois de rodar:
--   select inventory_done from public.d4sign_sync_state;          -- false
--   select count(*) from public.d4sign_documents;                 -- 0
--   select count(*) from public.clients where contract_doc_uuid is not null;  -- 0
