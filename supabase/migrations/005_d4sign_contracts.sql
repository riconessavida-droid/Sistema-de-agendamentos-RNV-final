-- =====================================================================
-- Integração D4Sign (assinatura de contrato)  →  Sistema de Agendamentos RNV
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- O que ele cria:
--   1) campos novos em `clients` (e-mail, CPF, quando assinou, motivo da pendência)
--   2) `d4sign_documents` — tudo que o webhook recebe (auditoria + triagem)
--   3) `d4sign_client_links` — vínculo aprendido e-mail -> cliente
--
-- Seguro rodar mais de uma vez (tudo é "if not exists").
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Campos novos no cliente.
--    `contract_signed` (boolean) já existe e continua sendo a verdade:
--    só vira true quando a validação passa.
-- ---------------------------------------------------------------------
alter table public.clients add column if not exists email             text;
alter table public.clients add column if not exists cpf               text;
alter table public.clients add column if not exists contract_signed_at timestamptz;
alter table public.clients add column if not exists contract_doc_uuid  text;
-- Motivo da pendência, em português, pra assistente saber o que cobrar.
-- Ex.: "CPF inválido (013.793.734-99)". NULL = sem problema.
alter table public.clients add column if not exists contract_issue     text;

create index if not exists clients_email_idx on public.clients (lower(email));
create index if not exists clients_cpf_idx   on public.clients (cpf);

-- ---------------------------------------------------------------------
-- 2) Tudo que chega do D4Sign. Serve de auditoria, de dedupe (o webhook
--    pode ser reenviado) e de fila de triagem quando algo dá errado.
-- ---------------------------------------------------------------------
create table if not exists public.d4sign_documents (
  doc_uuid        text primary key,          -- uuid do documento no D4Sign
  document_name   text,                      -- traz o e-mail do cliente no nome
  event_datetime  timestamptz,
  signer_name     text,
  signer_email    text,
  signer_cpf      text,                      -- identification_number do webhook
  signed_at       timestamptz,               -- carimbo da assinatura
  cpf_valid       boolean,
  status          text not null default 'PENDING'
                    check (status in ('OK','INVALID_CPF','UNMATCHED','IGNORED')),
  issue           text,                      -- motivo legível, quando status <> OK
  matched_client_id text,                    -- clients.id
  match_method    text                       -- link | cpf | email | name | created
                    check (match_method in ('link','cpf','email','name','created') or match_method is null),
  raw             jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists d4sign_documents_status_idx
  on public.d4sign_documents (status, signed_at desc);

create index if not exists d4sign_documents_client_idx
  on public.d4sign_documents (matched_client_id);

-- ---------------------------------------------------------------------
-- 3) Vínculo aprendido: e-mail do signatário -> cliente do sistema.
--    Mesma ideia do eagenda_client_links: a primeira vez custa (nome/CPF),
--    da segunda em diante é instantâneo.
-- ---------------------------------------------------------------------
create table if not exists public.d4sign_client_links (
  email        text primary key,             -- sempre em minúsculas
  client_id    text not null,
  linked_name  text,                         -- nome no momento do vínculo (referência)
  created_at   timestamptz not null default now()
);

create index if not exists d4sign_client_links_client_idx
  on public.d4sign_client_links (client_id);

-- ---------------------------------------------------------------------
-- 4) RLS — mesmo padrão das tabelas do eAgenda (frontend usa anon key com
--    sessão; a Edge Function usa service_role e ignora RLS).
-- ---------------------------------------------------------------------
alter table public.d4sign_documents    enable row level security;
alter table public.d4sign_client_links enable row level security;

drop policy if exists d4sign_documents_rw on public.d4sign_documents;
create policy d4sign_documents_rw
  on public.d4sign_documents
  for all
  using (true)
  with check (true);

drop policy if exists d4sign_client_links_rw on public.d4sign_client_links;
create policy d4sign_client_links_rw
  on public.d4sign_client_links
  for all
  using (true)
  with check (true);

-- updated_at automático em d4sign_documents
create or replace function public.touch_d4sign_documents_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_d4sign_documents on public.d4sign_documents;
create trigger trg_touch_d4sign_documents
  before update on public.d4sign_documents
  for each row execute function public.touch_d4sign_documents_updated_at();
