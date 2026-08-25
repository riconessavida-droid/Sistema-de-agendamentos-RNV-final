-- =====================================================================
-- Notificações no celular (Web Push)  →  Sistema de Agendamentos RNV
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- POR QUE EXISTE: depois de quatro quedas do canal de WhatsApp em duas
-- semanas, o Eduardo precisa de um aviso que não dependa de terceiro
-- nenhum — nem da Meta, nem do papo.ai, nem de abrir e-mail. Adicionando
-- o sistema à tela de início do iPhone, o push chega como notificação de
-- app, sem App Store e sem TestFlight (que expiraria a cada 90 dias).
--
-- Cada linha aqui é UM APARELHO que autorizou receber. O mesmo usuário
-- pode ter vários (celular, iPad, desktop) e todos recebem.
-- =====================================================================

create table if not exists public.push_subscriptions (
  id          bigserial primary key,
  -- Endereço único que o navegador gera para este aparelho. É por ele que
  -- o serviço de push (Apple/Google) sabe para quem entregar.
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  -- De quem é o aparelho. Hoje só o Eduardo recebe, mas a assistente pode
  -- entrar depois sem mudar nada aqui.
  user_email  text,
  label       text,                       -- "iPhone do Eduardo", opcional
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  -- Preenchido quando o serviço de push responde 404/410: o aparelho
  -- desinstalou ou revogou. Guardar em vez de apagar deixa claro o que
  -- aconteceu quando alguém perguntar "por que parei de receber?".
  gone_at     timestamptz
);

create index if not exists push_subscriptions_ativos_idx
  on public.push_subscriptions (created_at desc)
  where gone_at is null;

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_rw on public.push_subscriptions;
create policy push_subscriptions_rw
  on public.push_subscriptions
  for all
  using (true)
  with check (true);

-- Conferir:
--   select label, user_email, created_at, gone_at from public.push_subscriptions;
