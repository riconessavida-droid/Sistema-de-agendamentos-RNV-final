# Integração eAgenda → Sistema de Agendamentos RNV

Quando um cliente agenda uma reunião no eAgenda, a data cai **sozinha** no
sistema de agendamentos. Você só toca no que for ambíguo (na aba **Conciliação**).
Cancelamento no eAgenda também é tratado: a data é limpa automaticamente.

## Como funciona (resumo)

```
Cliente agenda no eAgenda
        │  (webhook)
        ▼
Edge Function  ──► pessoa já vinculada?  ── sim ──►  preenche a data no cliente  (automático, silencioso)
                                          └─ não ──►  vai pra fila da aba "Conciliação"
                                                            │  (você confirma 1x)
                                                            ▼
                                                   grava a data + APRENDE o vínculo
                                                   (próximas vezes = automático)
```

- **Só data:** o status da reunião continua "Pendente". O "Realizada" (verde)
  continua vindo do cash-in, como já é hoje.
- **Só clientes ativos** aparecem na conciliação (encerrados/cancelados são ocultados).

---

## Instalação (passo a passo)

### 1. Rodar o SQL (uma vez)

No **Supabase → SQL Editor**, cole e execute o conteúdo de:

```
supabase/migrations/001_eagenda_integration.sql
```

Isso cria as tabelas `eagenda_bookings` (fila) e `eagenda_client_links` (vínculo aprendido).

> ⚠️ As policies de RLS no SQL estão liberadas (`using (true)`). Se a sua tabela
> `clients` usa policies mais restritas, replique-as nessas duas tabelas para
> manter o mesmo nível de segurança.

### 2. Publicar a Edge Function

Precisa do [Supabase CLI](https://supabase.com/docs/guides/cli) instalado e logado.

```bash
# na pasta do projeto:
supabase link --project-ref <SEU-PROJECT-REF>

# define um token secreto (invente uma senha forte):
supabase secrets set EAGENDA_WEBHOOK_TOKEN=troque-por-um-token-secreto

# publica a função:
supabase functions deploy eagenda-webhook --no-verify-jwt
```

A URL final será:

```
https://<SEU-PROJECT-REF>.supabase.co/functions/v1/eagenda-webhook
```

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são injetados automaticamente
> na função pelo Supabase — não precisa configurá-los.

### 3. Configurar o webhook no eAgenda

No painel do eAgenda, em **Notificações / Webhooks**, crie um webhook:

| Campo | Valor |
|-------|-------|
| URL | `https://<SEU-PROJECT-REF>.supabase.co/functions/v1/eagenda-webhook` |
| Método | `POST` |
| Header | `Authorization: Bearer troque-por-um-token-secreto` (o mesmo do passo 2) |
| Eventos | Criação, Alteração e Cancelamento de agendamento |

### 4. Testar

1. Faça um agendamento de teste no eAgenda com o nome de um cliente ativo.
2. Abra o sistema → aba **Conciliação**. O agendamento deve aparecer lá.
3. Confirme o cliente. A data é preenchida no mês correspondente **e o vínculo
   é aprendido**.
4. Faça um segundo agendamento com a **mesma pessoa** → agora ele deve cair
   automático (não aparece na fila; a data já vai direto pro cliente).
5. Cancele o agendamento no eAgenda → a data some do cliente.

---

## Detalhes técnicos

- **Identificação:** o webhook do eAgenda manda `nome` + `email` + `person_key`,
  mas **não manda telefone**. Por isso a 1ª conciliação é manual (sugestão por
  semelhança de nome) e o sistema guarda o `person_key → cliente` para automatizar
  as próximas.
- **Mês/slot:** o mês da data agendada define o slot (ex.: `28/07/2026` → mês
  `2026-07`, dia `28` vira o `customDate`).
- **Proteção:** um cancelamento **nunca** apaga a data de uma reunião já marcada
  como Realizada/Encerrada (essas vêm do cash-in).

## Arquivos

| Arquivo | O quê |
|--------|-------|
| `supabase/migrations/001_eagenda_integration.sql` | Tabelas da fila e do vínculo |
| `supabase/functions/eagenda-webhook/index.ts` | Recebe o webhook, auto-concilia, trata cancelamento |
| `App.tsx` (aba Conciliação) | Fila, filtro de ativos, sugestão por nome, confirmar + aprender |
| `types.ts` (`EagendaBooking`) | Tipo do agendamento na fila |
