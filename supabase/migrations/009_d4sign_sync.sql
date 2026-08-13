-- =====================================================================
-- D4Sign por API (polling)  →  Sistema de Agendamentos RNV
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- Por que existe: o webhook do D4Sign só pode ser cadastrado documento a
-- documento, por API. Como a assistente envia os contratos pelo PAINEL,
-- os documentos dela nasceriam sem webhook e nada chegaria aqui. Então o
-- sistema inverte: de hora em hora ele PERGUNTA ao D4Sign o que mudou.
--
-- Isso resolve três coisas de uma vez:
--   1) "Fulano assinou, pode começar"  — vê o documento virar finalizado
--   2) "já faz 2 dias e não assinou"   — o D4Sign sabe a data de envio
--   3) o PDF do contrato entra no sistema para download
--
-- O que este arquivo faz:
--   1) campos novos em `d4sign_documents` (status, envio, PDF, cobrança)
--   2) conserta o CHECK de status, que hoje proíbe o próprio default
--   3) `contract_pdf_url` em `clients`
--   4) `d4sign_sync_state` — cofre descoberto + diagnóstico da última rodada
--   5) o cron de hora em hora
--
-- Seguro rodar mais de uma vez (tudo é "if not exists" / "or replace").
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Campos novos em d4sign_documents.
--    Antes a tabela só guardava contrato ASSINADO (era o único evento que
--    o webhook mandava). Agora ela acompanha o documento a vida toda:
--    enviado -> aguardando -> finalizado (ou cancelado).
-- ---------------------------------------------------------------------
alter table public.d4sign_documents add column if not exists uuid_safe     text;
alter table public.d4sign_documents add column if not exists status_id     text;
alter table public.d4sign_documents add column if not exists status_name   text;
-- Quando o documento foi criado/enviado no D4Sign. É esta data que faz a
-- cobrança de "2 dias sem assinar" funcionar sem ninguém digitar nada.
alter table public.d4sign_documents add column if not exists sent_at       timestamptz;
alter table public.d4sign_documents add column if not exists pdf_url       text;
-- Dedupe da cobrança: preenchido quando o aviso "não assinou" é enviado.
alter table public.d4sign_documents add column if not exists chase_sent_at timestamptz;
alter table public.d4sign_documents add column if not exists last_seen_at  timestamptz;

-- ---------------------------------------------------------------------
-- 2) O CHECK de status estava impossível: o default é 'PENDING', mas
--    'PENDING' não estava na lista permitida — qualquer insert que
--    omitisse o status quebrava. Nunca estourou porque o webhook sempre
--    mandava o status explícito. O polling grava documento ainda não
--    assinado, então agora precisa valer de verdade.
-- ---------------------------------------------------------------------
alter table public.d4sign_documents drop constraint if exists d4sign_documents_status_check;
alter table public.d4sign_documents add constraint d4sign_documents_status_check
  check (status in ('PENDING','AWAITING','OK','INVALID_CPF','UNMATCHED','IGNORED','CANCELED'));

create index if not exists d4sign_documents_awaiting_idx
  on public.d4sign_documents (status, sent_at)
  where status = 'AWAITING';

-- ---------------------------------------------------------------------
-- 3) O contrato assinado, para baixar direto da ficha do cliente.
--    O link do D4Sign é temporário; guardamos junto de quando foi gerado
--    para saber quando renovar.
-- ---------------------------------------------------------------------
alter table public.clients add column if not exists contract_pdf_url    text;
alter table public.clients add column if not exists contract_pdf_url_at timestamptz;

-- ---------------------------------------------------------------------
-- 4) Estado do sync. Linha única (id = 1).
--
--    `safe_uuid` é descoberto sozinho na primeira rodada e guardado aqui,
--    para não gastar requisição repetindo a descoberta — a API do D4Sign
--    permite só 10 requisições POR HORA no plano atual.
--
--    `sample_document` e `sample_signer` guardam um exemplo cru do que a
--    API devolveu. A documentação pública não especifica os nomes dos
--    campos do signatário; a função tenta vários apelidos conhecidos e
--    guarda o original aqui, para conferir contra o primeiro contrato real.
-- ---------------------------------------------------------------------
create table if not exists public.d4sign_sync_state (
  id              smallint primary key default 1 check (id = 1),
  safe_uuid       text,
  safe_name       text,
  last_run_at     timestamptz,
  last_ok         boolean,
  last_error      text,
  requests_used   smallint,
  documents_seen  integer,
  sample_document jsonb,
  sample_signer   jsonb,
  updated_at      timestamptz not null default now()
);

insert into public.d4sign_sync_state (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 5) RLS — mesmo padrão das outras tabelas da integração.
-- ---------------------------------------------------------------------
alter table public.d4sign_sync_state enable row level security;

drop policy if exists d4sign_sync_state_rw on public.d4sign_sync_state;
create policy d4sign_sync_state_rw
  on public.d4sign_sync_state
  for all
  using (true)
  with check (true);

create or replace function public.touch_d4sign_sync_state_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_d4sign_sync_state on public.d4sign_sync_state;
create trigger trg_touch_d4sign_sync_state
  before update on public.d4sign_sync_state
  for each row execute function public.touch_d4sign_sync_state_updated_at();

-- ---------------------------------------------------------------------
-- 6) O cron: de hora em hora, no minuto 10.
--
--    Minuto 10 e não 0 de propósito — os outros jobs rodam na virada da
--    hora, e a API do D4Sign é apertada demais para disputar espaço.
--
--    Uma rodada normal gasta 1 requisição (a listagem). Só documento que
--    MUDOU custa mais, e a função tem teto próprio para nunca estourar as
--    10/hora do plano.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('d4sign-sync-horario')
  where exists (select 1 from cron.job where jobname = 'd4sign-sync-horario');

select cron.schedule(
  'd4sign-sync-horario',
  '10 * * * *',
  $$
  select net.http_post(
    url     := 'https://dxqfiucnvlzjukoleqcv.supabase.co/functions/v1/d4sign-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- Conferir:
--   select * from public.d4sign_sync_state;                      -- última rodada
--   select doc_uuid, status, status_name, sent_at, signer_name
--     from public.d4sign_documents order by sent_at desc limit 20;
--   select * from cron.job where jobname = 'd4sign-sync-horario';
-- Desligar, se precisar:
--   select cron.unschedule('d4sign-sync-horario');
