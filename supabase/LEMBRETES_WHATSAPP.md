# Lembretes automáticos no WhatsApp (Meta Cloud API)

Cada cliente ativo recebe 2 lembretes/mês para agendar a próxima reunião:
**7 dias antes** e **3 dias antes** da data prevista (última reunião feita + ~30 dias).
Não manda para quem já agendou; não repete lembrete já enviado; a 2ª mensagem
não sai se o cliente agendou depois da 1ª. Envio pelo número da assistente
(via Coexistence). Custo estimado: ~R$11/mês (categoria "utility").

---

## Passo 1 — Banco

No Supabase → SQL Editor, rode `supabase/migrations/004_reminder_log.sql`
(cria a tabela `reminder_log` que evita duplicidade e guarda a comprovação).

## Passo 2 — Publicar a função `send-reminders`

Edge Functions → Deploy a new function → Via editor. Nome: `send-reminders`.
**Verify JWT LIGADO** (o cron chama com a anon key). Cole o conteúdo de
`supabase/functions/send-reminders/index.ts` (versão JS colável abaixo, se preferir).

> Enquanto os segredos do WhatsApp NÃO estiverem configurados, a função entra
> em **dry-run** automático: ela calcula e retorna QUEM receberia, mas NÃO envia.
> Isso serve para testarmos a lógica antes de mexer na Meta.

### Teste dry-run (antes da Meta)

```bash
curl -X POST 'https://dxqfiucnvlzjukoleqcv.supabase.co/functions/v1/send-reminders' \
  -H 'apikey: <ANON_KEY>' -H 'Authorization: Bearer <ANON_KEY>' \
  -H 'Content-Type: application/json' --data '{"dryRun": true}'
```

Retorna a lista de quem receberia lembrete hoje (7d/3d), sem enviar nada.

## Passo 3 — Cadastro na Meta (Cloud API + Coexistence)

1. Acesse **business.facebook.com** e crie/abra o **Meta Business**.
2. Em **WhatsApp** (Meta for Developers → criar App do tipo Business), inicie o
   **Embedded Signup** e escolha o fluxo de **Coexistence**, conectando o número
   **(12) 98172-4562** (que já está no app **WhatsApp Business**, versão 2.24.17+).
3. Faça a **verificação do negócio** (a Meta analisa em ~2-4 dias).
4. Anote o **Phone Number ID** e gere um **token de acesso** (system user).
5. Cadastre os 2 templates abaixo (categoria **Utility**, idioma **Português (BR)**).

### Template 1 — nome: `lembrete_7dias` (Utility, pt_BR)

Corpo:
```
Olá {{1}}! 👋 Já é quase hora da sua próxima reunião de consultoria financeira da RNV. Garanta seu melhor horário agendando aqui: COLE_AQUI_O_LINK_DO_EAGENDA. Peço que agende o quanto antes justamente para mantermos o combinado de 1 reunião a cada +/- 30 dias, tudo bem? Aguardo seu agendamento.
```
Exemplo para `{{1}}`: `Maria`

### Template 2 — nome: `lembrete_3dias` (Utility, pt_BR)

Corpo:
```
Oi {{1}}! Passando pra lembrar 😊 sua reunião mensal de consultoria RNV está chegando e ainda não vi seu agendamento. É rapidinho, escolhe seu horário aqui: COLE_AQUI_O_LINK_DO_EAGENDA. Lembrando que é fundamental mantermos uma reunião a cada +/- 30 dias, tudo bem? Aguardo seu retorno. Muito obrigado.
```
Exemplo para `{{1}}`: `Maria`

> Troque `COLE_AQUI_O_LINK_DO_EAGENDA` pelo seu link real de agendamento do eAgenda.
> Se a Meta recusar como "Utility", reenvie ajustando o texto (menos promocional) —
> lembrete de compromisso costuma passar como Utility.

## Passo 4 — Segredos no Supabase

Edge Functions → Secrets:
- `WA_ACCESS_TOKEN` = token de acesso da Meta
- `WA_PHONE_NUMBER_ID` = Phone Number ID do número

A partir daqui a função para de fazer dry-run e passa a **enviar de verdade**.

## Passo 5 — Ligar o envio diário (cron)

No SQL Editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'whatsapp-lembretes-diario',
  '0 13 * * *',   -- todo dia às 13:00 UTC (10:00 no Brasil)
  $$
  select net.http_post(
    url     := 'https://dxqfiucnvlzjukoleqcv.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

## Conferir depois

- Envios: `select * from reminder_log order by created_at desc limit 20;`
  (guarda `wa_message_id` = comprovação da Meta, e status entregue/erro).
- Rodadas do cron: `select * from cron.job_run_details order by start_time desc limit 10;`
