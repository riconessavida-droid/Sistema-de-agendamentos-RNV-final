# Sistema de Agendamento próprio (substitui o eAgenda)

O cliente recebe um link, escolhe o horário e a data cai sozinha no sistema —
**sem conciliação**, porque o link já sabe quem ele é.

## Como funciona

```
Você define a grade em  Agenda → Horários   (uma vez, muda quando quiser)
                │
                ▼
Copia o link do cliente em  Agenda → Links
                │  (manda no WhatsApp)
                ▼
Cliente abre, vê só os horários livres, escolhe e confirma
                │
                ▼
Grava o agendamento  ──►  preenche o customDate no mês do cliente
                     ──►  (em breve) cria o Meet e avisa vocês dois
```

**Regra central:** mudar a grade vale **só daqui pra frente**. Quem já marcou
continua marcado, mesmo que o horário saia da grade.

---

## Instalação

### 1. SQL — ✅ já rodado

`supabase/migrations/006_agendamento_proprio.sql` (Supabase → SQL Editor).

### 2. Publicar a Edge Function `booking`

No **Supabase → Edge Functions**:

1. **Create a new function** (ou abra a existente) com o nome exato **`booking`**
2. Cole o conteúdo de `supabase/functions/booking/index.ts`
3. Em **Settings** da função, **DESLIGUE o "Verify JWT"**
   > A página é pública e não tem login. Sem isso, o cliente recebe erro 401.
4. **Deploy**

Não precisa criar nenhum segredo: `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`
já são injetados automaticamente.

### 3. Frontend

Commit + push na `main` → a Vercel publica em 1-2 min.

O `vercel.json` foi adicionado para as rotas `/agendar/...` e `/r/...`
funcionarem. **Sem ele, o link do cliente dá 404.**

---

## Testando (na ordem)

1. Abra o sistema → aba **Agenda** → **Horários**. Confirme que a sua grade
   está lá e que a coluna "Horários gerados" mostra os horários certos.
2. Vá em **Links**, busque um cliente e clique em **Copiar link**.
3. Cole o link **numa aba anônima** (para não estar logado) e veja a tela do
   cliente. Confira: o nome dele aparece na saudação, a estrelinha marca a
   data ideal e só aparecem horários livres.
4. **Marque um horário de teste.** Volte na aba **Semana** — ele deve estar lá
   em vermelho.
5. Abra o card e confira o telefone, o histórico e a tarja de contrato.
6. Teste o cancelamento: a tela de sucesso não mostra o link de gerenciar
   ainda (ele vai chegar pelo WhatsApp), mas o endereço é `/r/<manageToken>`.
   Dá para pegá-lo na tabela `appointments`, coluna `manage_token`.
7. **Apague o agendamento de teste** direto na tabela `appointments`
   (ou cancele por `/r/<token>`).

---

## Endereços

| Endereço | Para quem |
|---|---|
| `/agendar/<token>` | Cliente já cadastrado — não pede nada, cai no cliente certo |
| `/agendar` | Quem ainda não é cliente — pede nome, WhatsApp e e-mail |
| `/r/<manageToken>` | "Sua reunião": link da videochamada e cancelamento |

---

## Segurança

- A página pública **nunca fala com o banco**. Só conhece a função `booking`,
  que roda com service_role do outro lado.
- As tabelas novas exigem usuário autenticado (padrão da `clients`, não o da
  `eagenda_bookings`, que é aberta).
- Os tokens têm 32 caracteres aleatórios.
- **Dupla marcação é impossível**: existe um índice único no horário. Se dois
  clientes clicarem no mesmo segundo, o segundo recebe "alguém acabou de
  reservar esse horário".
- Pelo link geral, o mesmo telefone não consegue empilhar agendamentos.

---

## Ainda falta

- **Google Meet** (criar o evento e o link)
- **WhatsApp**: confirmação, lembrete de véspera e o resumo das 21h
- Desligar o eAgenda (só depois de tudo provado)

---

## Arquivos

| Arquivo | O quê |
|---|---|
| `supabase/migrations/006_agendamento_proprio.sql` | As tabelas |
| `supabase/functions/booking/index.ts` | A função pública (4 ações) |
| `scheduling/availability.ts` | O motor de horários |
| `scheduling/timezone.ts` | Toda conversão de fuso |
| `scheduling/holidays.ts` | Feriados calculados (inclusive os móveis) |
| `scheduling/SchedulingTab.tsx` | A aba Agenda |
| `scheduling/BookingPage.tsx` | A tela do cliente |
| `scheduling/availability.test.ts` | 28 testes (`npm test`) |
| `vercel.json` | Rotas públicas na Vercel |
