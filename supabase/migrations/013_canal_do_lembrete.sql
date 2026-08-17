-- =====================================================================
-- Por onde o lembrete saiu  →  Sistema de Agendamentos RNV
-- Rode este arquivo uma vez no Supabase (SQL Editor).
--
-- POR QUE EXISTE: desde 17/08/2026 o lembrete de 3 dias sai por DOIS
-- canais (e-mail + WhatsApp) e o de 7 dias só por e-mail. Sem registrar
-- por onde foi, a assistente abre a aba Tarefas do Dia, lê "enviado", e
-- vai procurar no WhatsApp uma mensagem de 7 dias que nunca existiu —
-- perdendo tempo e concluindo que o sistema falhou.
--
-- Duas colunas em vez de um texto: a tela precisa mostrar dois símbolos
-- independentes, e o WhatsApp pode falhar sozinho sem derrubar o e-mail.
--
-- Seguro rodar mais de uma vez.
-- =====================================================================

alter table public.reminder_log
  add column if not exists sent_email    boolean not null default false;

alter table public.reminder_log
  add column if not exists sent_whatsapp boolean not null default false;

-- O histórico até aqui: tudo que consta como enviado saiu por um canal só.
-- Antes de 17/08 era WhatsApp; a partir dali, e-mail. A data separa os dois.
update public.reminder_log
   set sent_whatsapp = true
 where status = 'sent'
   and created_at < timestamptz '2026-08-17 16:00:00-03'
   and sent_email = false and sent_whatsapp = false;

update public.reminder_log
   set sent_email = true
 where status = 'sent'
   and created_at >= timestamptz '2026-08-17 16:00:00-03'
   and sent_email = false and sent_whatsapp = false;

-- Conferir:
--   select reminder_type, sent_email, sent_whatsapp, count(*)
--     from public.reminder_log group by 1,2,3 order by 1;
