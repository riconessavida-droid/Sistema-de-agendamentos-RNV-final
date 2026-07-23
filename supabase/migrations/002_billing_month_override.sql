-- =====================================================================
-- Faturamento: salvar o deslocamento manual (drag-and-drop) do mês de
-- pagamento NO BANCO (antes ficava só no localStorage do navegador, o que
-- causava perda/inconsistência entre navegadores e ao longo do tempo).
-- Rode uma vez no Supabase (SQL Editor).
-- =====================================================================

alter table public.clients
  add column if not exists billing_month_override text;
