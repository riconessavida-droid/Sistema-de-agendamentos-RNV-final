-- =====================================================================
-- Recria a ficha da Ana Carolina Carvalho Arantes
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- POR QUE EXISTE: o contrato dela foi assinado em 21/08/2026 e o sistema
-- criou a ficha corretamente — mas ela foi apagada junto com as 66 fichas
-- duplicadas que o sync tinha gerado por engano, porque não havia como
-- distinguir uma da outra olhando a lista.
--
-- Confirmado que é cliente NOVA: as duas "Ana Carolina" que existem na
-- base começaram em out/2025 e dez/2025, e nenhuma tem o CPF nem o e-mail
-- deste contrato.
--
-- Os dados vêm todos do documento já processado, então nada é digitado à
-- mão aqui — inclusive o link do PDF, que o sync tinha baixado.
--
-- Seguro rodar mais de uma vez (não duplica).
-- =====================================================================

insert into public.clients (
  id, name, phone_digits, start_month_year, start_date, sequence_in_month,
  group_color, status_by_month, extra_meetings,
  email, cpf,
  contract_signed, contract_signed_at, contract_doc_uuid, contract_pdf_url,
  contract_pdf_url_at, contract_gross_value, contract_machine_rate, contract_value
)
select
  gen_random_uuid(),
  d.signer_name,
  '',                                   -- telefone chega quando ela agendar
  '2026-08',
  21,                                   -- dia da assinatura
  0,
  'bg-yellow-100 border-yellow-200 text-yellow-800',
  '{}'::jsonb,
  0,
  d.signer_email,
  d.signer_cpf,
  true,
  d.signed_at,
  d.doc_uuid,
  d.pdf_url,
  now(),
  coalesce(b.contract_value, 1599),
  coalesce(b.machine_rate, 10),
  round(coalesce(b.contract_value, 1599) * (1 - coalesce(b.machine_rate, 10) / 100.0), 2)
from public.d4sign_documents d
left join public.billing_config b on true
where d.doc_uuid = 'e2f921f8-0e81-4b91-b44a-032651f0d70e'
  and not exists (
    select 1 from public.clients c
     where regexp_replace(coalesce(c.cpf,''),'\D','','g') = d.signer_cpf
  );

-- Religa o documento à ficha nova, para o sistema não tentar criar de novo.
update public.d4sign_documents d
   set matched_client_id = c.id::text,
       -- 'created' e não um texto livre: a coluna tem CHECK e só aceita
       -- link | cpf | email | name | created.
       match_method = 'created'
  from public.clients c
 where d.doc_uuid = 'e2f921f8-0e81-4b91-b44a-032651f0d70e'
   and regexp_replace(coalesce(c.cpf,''),'\D','','g') = d.signer_cpf;

-- Conferir:
--   select name, email, cpf, contract_signed, contract_pdf_url is not null as tem_pdf
--     from public.clients where cpf = '36052235837';
