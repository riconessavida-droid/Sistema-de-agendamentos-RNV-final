-- =====================================================================
-- E-mail na ficha do cliente  →  Sistema de Agendamentos RNV
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- POR QUE EXISTE: as notificações passaram de WhatsApp para e-mail, e o
-- endereço vira o dado mais importante do cadastro. Ele já existe no
-- sistema há meses — o webhook do eAgenda sempre trouxe `attendee_email`
-- —, mas ficava só na tabela de agendamentos, nunca na ficha do cliente.
-- Sem isto, cliente com e-mail conhecido apareceria como "sem e-mail" e
-- deixaria de ser avisado, silenciosamente.
--
-- Preenche apenas quem está com o campo vazio: e-mail digitado à mão na
-- ficha ganha do que veio do eAgenda, sempre.
--
-- Seguro rodar mais de uma vez.
-- =====================================================================

alter table public.clients add column if not exists email text;

-- Para cada cliente sem e-mail, pega o do agendamento MAIS RECENTE que
-- foi conciliado com ele. O mais recente porque, se a pessoa trocou de
-- endereço em algum momento, o último é o que ela usa hoje.
with ultimo_email as (
  select distinct on (b.matched_client_id)
         b.matched_client_id as client_id,
         lower(trim(b.attendee_email)) as email
    from public.eagenda_bookings b
   where b.matched_client_id is not null
     and b.attendee_email is not null
     and position('@' in b.attendee_email) > 1
   order by b.matched_client_id, b.start_datetime desc
)
update public.clients c
   set email = u.email
  from ultimo_email u
 where c.id = u.client_id
   and (c.email is null or trim(c.email) = '');

-- Conferir depois de rodar:
--   select count(*) filter (where email is not null and email <> '') as com_email,
--          count(*) filter (where email is null or email = '')       as sem_email
--     from public.clients;
--
-- Quem ficou sem e-mail (esses precisam de cadastro manual, ou só serão
-- avisados quando agendarem pela primeira vez pelo link novo):
--   select name, phone_digits from public.clients
--    where (email is null or email = '') order by name;
