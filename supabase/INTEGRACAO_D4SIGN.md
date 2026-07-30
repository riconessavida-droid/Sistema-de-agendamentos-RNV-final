# Integração D4Sign — contrato assinado dá baixa sozinho

Quando o cliente assina o contrato no D4Sign, o sistema recebe um aviso,
confere o CPF, descobre de quem é o contrato, marca **Contrato Assinado**
e notifica o Eduardo. Se o CPF estiver inválido, o cliente fica **pendente
com o motivo escrito na tela** e a notificação vira "avisa ele pra refazer".

---

## ⚠️ Antes de tudo: o bloqueio

Cadastrar a URL de destino do webhook **é uma chamada de API do D4Sign**, e
o plano atual não tem acesso à API. Sem isso, o D4Sign não sabe para onde
mandar o aviso e **nada acontece** — mesmo com tudo abaixo pronto.

Chamada que precisa ser feita (uma vez por cofre):

```
POST https://secure.d4sign.com.br/api/v1/webhooks/v2/?tokenAPI=<token>&cryptKey=<key>
Content-Type: application/json

{
  "type": "cofre",
  "uuid": "<uuid do cofre dos contratos>",
  "url":  "https://dxqfiucnvlzjukoleqcv.supabase.co/functions/v1/d4sign-webhook"
}
```

É **um cadastro único**: depois disso, todo contrato futuro daquele cofre
dispara o webhook sozinho, sem usar API nunca mais.

**Status:** aguardando retorno do suporte/gerente do D4Sign.

---

## Passo a passo (na ordem)

### 1. Rodar o SQL

Supabase → **SQL Editor** → colar e Run:

`supabase/migrations/005_d4sign_contracts.sql`

Cria os campos novos em `clients` (e-mail, CPF, data da assinatura, motivo
da pendência) e as tabelas `d4sign_documents` e `d4sign_client_links`.
Pode rodar mais de uma vez sem quebrar nada.

### 2. Publicar a Edge Function

Supabase → **Edge Functions** → criar `d4sign-webhook` → colar o conteúdo de
`supabase/functions/d4sign-webhook/index.ts` → **Deploy**.

> **Verify JWT: DESLIGADO** — o D4Sign não manda JWT.
> A segurança aqui é o HMAC (passo 3), que é mais forte.

### 3. Cadastrar os segredos

Supabase → Edge Functions → **Secrets**:

| Segredo | Obrigatório | O que é |
|---|---|---|
| `D4SIGN_HMAC_SECRET` | **sim** | a Secret Key gerada no D4Sign (Gerenciar conta → Webhooks → Configurações) |
| `D4SIGN_OWNER_EMAILS` | não | e-mails do Eduardo, separados por vírgula. Padrão já embutido: `riconessavida@gmail.com,eduardo@riconessavida.com.br` |
| `D4SIGN_NOTIFY_URL` | não | webhook de entrada do papo.ai para avisar no WhatsApp. **Sem ele, a baixa acontece normalmente, só não sai notificação.** |
| `D4SIGN_NOTIFY_TOKEN` | não | Bearer do webhook de notificação, se houver |

### 4. Conferir a configuração no D4Sign

Gerenciar conta → **Webhooks** (já feito em 30/jul/2026):

- ✅ Webhook 2.0 **ativado** — é ele que manda o CPF (`identification_number`)
- ✅ Content-Type em **JSON**
- ✅ HMAC **ativo** com Secret Key gerada

> Se regenerar a Secret Key no painel, **atualize `D4SIGN_HMAC_SECRET`**
> no Supabase — senão a função passa a rejeitar tudo com 401.

### 5. Cadastrar a URL (bloqueado — ver topo)

---

## Como testar sem esperar o D4Sign

Com o HMAC ligado, é preciso mandar o header certo. Jeito mais simples de
testar: **deixe `D4SIGN_HMAC_SECRET` vazio** temporariamente (a função pula
a validação), dispare o POST abaixo e depois **cadastre o segredo de volta**.

```bash
curl -X POST https://dxqfiucnvlzjukoleqcv.supabase.co/functions/v1/d4sign-webhook \
  -H "content-type: application/json" \
  -d '{
    "uuid": "teste-0001",
    "type_post": "1",
    "message": "Finished document",
    "event_datetime": "2026-07-30T20:00:00Z",
    "document_name": "Contrato 26 atualizado whatsapp - fulano@gmail com",
    "signers": [{
      "uuid": "sig-1",
      "name": "Rodrigo Moraes Martins",
      "email": "fulano@gmail.com",
      "signed_at": "2026-07-30T19:42:46Z",
      "identification_number": "013.793.734-25"
    }]
  }'
```

- CPF acima é **válido** → deve marcar Contrato Assinado.
- Troque o final para `013.793.734-99` → **inválido**, deve criar/deixar
  pendente com `contract_issue = "CPF inválido (013.793.734-99)"`.
- Depois do teste, apague a linha em `d4sign_documents` e o cliente criado.

---

## O que a função faz, em ordem

1. Valida o **HMAC** (`Content-Hmac: sha256=<hex>` = HMAC-SHA256 **do UUID
   do documento**, não do body — é assim que o D4Sign faz).
2. Ignora tudo que não for `type_post = 1` (documento finalizado).
3. **Idempotência**: se aquele documento já foi processado com sucesso, para.
4. Escolhe o signatário que **não** é o Eduardo.
5. Valida o **dígito verificador do CPF**.
6. Descobre de quem é o contrato, nesta ordem:
   1. vínculo aprendido pelo e-mail (`d4sign_client_links`)
   2. CPF igual ao de um cliente
   3. e-mail igual ao de um cliente
   4. 1º+2º nome batendo com **exatamente 1 cliente ativo**
   5. ninguém bate → **cria o cliente**
7. Marca `contract_signed` (**só se o CPF passou**), grava e-mail, CPF,
   data da assinatura e o motivo da pendência.
8. Aprende o e-mail para a próxima vez ser instantânea.
9. Registra tudo em `d4sign_documents` (auditoria e triagem).
10. Notifica, se `D4SIGN_NOTIFY_URL` estiver configurado.

---

## Limites conhecidos

- **Endereço e data digitada não são conferidos.** Eles só existem dentro
  do PDF, e baixar o PDF exige API. Se a API for liberada, isso entra como
  camada extra sem mexer no que já está feito.
- **Telefone não vem no webhook.** Cliente criado nasce com
  `phone_digits` vazio — o telefone chega depois pelo webhook do eAgenda,
  que já roda. Enquanto não chegar, esse cliente não recebe lembrete.
- **Mês de início é provisório.** Cliente criado nasce com o mês/dia da
  assinatura. Combinado com o Eduardo: o ciclo de faturamento ancora na
  **1ª reunião agendada** — quando a assinatura e a 1ª reunião caem em
  meses diferentes (virada de mês), o mês precisa ser ajustado. Hoje esse
  ajuste é manual; automatizá-lo exige uma alteração no `eagenda-webhook`.

---

## Melhoria já mapeada (fase 2)

Cobrar sozinho quem não assinou, usando a data da reunião que o eAgenda já
preenche (`customDate`), apertando conforme a reunião se aproxima — e um
alerta na véspera: *"amanhã você tem reunião com o Fulano e o contrato dele
não está assinado"*. Substitui a cobrança manual da assistente.

Exige **template novo aprovado na Meta** (alguns dias). Ver
`LEMBRETES_WHATSAPP.md`.
