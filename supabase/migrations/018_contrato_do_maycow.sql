-- =====================================================================
-- Liga o contrato assinado do Maycow à ficha "MAYCOW"
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- POR QUE EXISTE: o Maycow ASSINOU. O D4Sign registra o contrato
-- "maycowjunio09@gmail com" como Finalizado, assinado por MAYCOW JUNIO
-- SILVA e processado pelo sistema em 03/09/2026.
--
-- Na época o sistema não reconheceu a ficha "MAYCOW" (cadastrada à mão,
-- sem e-mail e sem CPF — nome curto não basta) e criou uma ficha nova,
-- "MAYCOW JUNIO SILVA", com o contrato. Essa ficha não existe mais
-- (provavelmente foi apagada como duplicata), e o contrato foi embora com
-- ela. Sobrou a ficha à mão, marcada como contrato pendente.
--
-- Este arquivo copia os dados do contrato (CPF, e-mail, data, PDF) para a
-- ficha "MAYCOW" e religa o documento a ela.
--
-- Seguro: só age se existir EXATAMENTE UMA ficha chamada "MAYCOW".
-- =====================================================================

do $$
declare
  alvo   text;
  qtd    int;
begin
  select count(*), min(id::text) into qtd, alvo
    from public.clients
   where upper(trim(name)) = 'MAYCOW';

  if qtd <> 1 then
    raise exception 'Esperava 1 ficha "MAYCOW", achei %. Nada foi alterado.', qtd;
  end if;

  update public.clients c
     set contract_signed     = coalesce(d.cpf_valid, true),
         contract_signed_at  = d.signed_at,
         contract_doc_uuid   = d.doc_uuid,
         contract_pdf_url    = coalesce(d.pdf_url, c.contract_pdf_url),
         contract_pdf_url_at = case when d.pdf_url is not null then now() else c.contract_pdf_url_at end,
         email               = coalesce(nullif(trim(c.email), ''), d.signer_email),
         cpf                 = coalesce(nullif(trim(c.cpf), ''), d.signer_cpf)
    from public.d4sign_documents d
   where d.doc_uuid = '51949d2d-7362-477b-94f5-26e2eeb703e7'
     and c.id::text = alvo;

  update public.d4sign_documents
     set matched_client_id = alvo,
         match_method = 'name'
   where doc_uuid = '51949d2d-7362-477b-94f5-26e2eeb703e7';

  -- Contrato futuro com o mesmo e-mail cai direto nesta ficha.
  update public.d4sign_client_links
     set client_id = alvo
   where email = 'maycowjunio09@gmail.com';
end $$;

-- Conferir:
select name, email, cpf, contract_signed, contract_pdf_url is not null as tem_pdf
  from public.clients
 where upper(trim(name)) = 'MAYCOW';
