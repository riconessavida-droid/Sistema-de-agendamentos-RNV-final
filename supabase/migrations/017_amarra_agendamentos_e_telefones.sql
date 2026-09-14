-- =====================================================================
-- Amarra agendamentos sem dono e completa o telefone das fichas
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- POR QUE EXISTE: duas falhas que se somavam.
--
--   1) Quem agenda pelo link geral ANTES de ter ficha (agenda primeiro,
--      assina o contrato depois) fica com o agendamento sem dono. A ficha
--      só nasce na assinatura e nada voltava para amarrar os dois — a
--      Conciliação mostrava "sem agendamento" e não oferecia como resolver.
--
--   2) Ficha criada pelo contrato nasce sem telefone: o D4Sign não informa,
--      e quem completava era o eAgenda, que foi desligado.
--
-- O código novo resolve os dois daqui para a frente. Este arquivo acerta o
-- que já ficou para trás.
--
-- Seguro rodar mais de uma vez: só preenche o que está vazio, só amarra
-- quando o e-mail aponta para UMA ficha ativa, e nunca troca um dono que
-- já existe.
--
-- Os ::text existem porque clients.id é uuid e appointments.client_id é
-- texto: sem a conversão o Postgres recusa a comparação.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Agendamento sem dono cujo e-mail bate com exatamente UMA ficha ativa.
--    A data da reunião também vai para a ficha (statusByMonth).
-- ---------------------------------------------------------------------
do $$
declare
  r      record;
  mes    text;
  dia    int;
  sbm    jsonb;
  atual  jsonb;
begin
  for r in
    with ativas as (
      select c.id::text as id, lower(trim(c.email)) as email
        from public.clients c
       where coalesce(trim(c.email), '') <> ''
         and not exists (
           select 1 from jsonb_each(coalesce(c.status_by_month, '{}'::jsonb)) e
            where e.value ->> 'status' in ('CLOSED_CONTRACT', 'CANCELLED_EARLY')
         )
    ),
    unicas as (
      select email, min(id) as client_id
        from ativas
       group by email
      having count(*) = 1
    )
    select a.id as appointment_id, u.client_id, a.starts_at
      from public.appointments a
      join unicas u on u.email = lower(trim(a.attendee_email))
     where a.client_id is null
       and a.status = 'CONFIRMED'
     order by a.starts_at
  loop
    update public.appointments
       set client_id = r.client_id
     where id = r.appointment_id
       and client_id is null;

    mes := to_char(r.starts_at at time zone 'America/Sao_Paulo', 'YYYY-MM');
    dia := extract(day from r.starts_at at time zone 'America/Sao_Paulo')::int;

    select coalesce(status_by_month, '{}'::jsonb) into sbm
      from public.clients where id::text = r.client_id;
    atual := coalesce(sbm -> mes, '{"status": "PENDING"}'::jsonb);

    -- dentro do mês vale o maior dia (mesma regra do agendamento)
    if (atual ->> 'customDate') is null or (atual ->> 'customDate')::int <= dia then
      update public.clients
         set status_by_month = jsonb_set(sbm, array[mes], atual || jsonb_build_object('customDate', dia))
       where id::text = r.client_id;
    end if;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 2) Ficha sem telefone ganha o telefone digitado no agendamento mais
--    recente dela. Ficha que já tem telefone não é tocada.
-- ---------------------------------------------------------------------
update public.clients c
   set phone_digits = '(' || substr(x.d, 1, 2) || ') ' || substr(x.d, 3, 5) || '-' || substr(x.d, 8, 4)
  from (
    select distinct on (a.client_id) a.client_id, a.d
      from (
        select client_id, starts_at,
               right(regexp_replace(coalesce(attendee_phone, ''), '\D', '', 'g'), 11) as d
          from public.appointments
         where client_id is not null
      ) a
     where length(a.d) = 11
     order by a.client_id, a.starts_at desc
  ) x
 where c.id::text = x.client_id
   and length(regexp_replace(coalesce(c.phone_digits, ''), '\D', '', 'g')) < 10;


-- ---------------------------------------------------------------------
-- 3) CONFERÊNCIA — de onde veio cada ficha dos últimos meses.
--    "criada pelo contrato" = o D4Sign criou a ficha sozinho.
--    "cadastrada à mão"     = alguém digitou (Eduardo ou Giane).
--    Ordenado pelo primeiro nome, para duplicatas ficarem lado a lado.
-- ---------------------------------------------------------------------
select
  c.name                                                        as cliente,
  coalesce(nullif(c.phone_digits, ''), '— sem telefone —')      as telefone,
  coalesce(c.email, '—')                                        as email,
  case when d.doc_uuid is not null
       then 'criada pelo contrato (D4Sign)'
       else 'cadastrada à mão' end                              as origem,
  to_char(d.signed_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') as contrato_assinado_em,
  (select count(*) from public.appointments a
    where a.client_id = c.id::text and a.status = 'CONFIRMED')        as agendamentos
from public.clients c
left join public.d4sign_documents d
  on d.matched_client_id = c.id::text and d.match_method = 'created'
where c.start_month_year >= '2026-08'
order by lower(split_part(c.name, ' ', 1)), c.name;
