# Google Agenda + Google Meet

Conectado, o sistema passa a:

1. **criar o link do Meet** de cada reunião
2. **colocar a reunião na sua agenda** do Google (com lembrete por e-mail 24h
   antes e pop-up 30 min antes — os mesmos que o eAgenda já configurava)
3. **mandar o convite por e-mail pro cliente**, de graça, pelo próprio Google
4. **não oferecer horário** em que você já tem compromisso pessoal

> Se o Google falhar, **o agendamento não falha**. A reunião é gravada sem
> link, o erro fica registrado e aparece na aba Google.

---

## Parte 1 — Google Cloud (uma vez só, ~10 minutos)

Tudo em [console.cloud.google.com](https://console.cloud.google.com), logado
com **riconessavida@gmail.com**.

### 1.1 Criar o projeto

No seletor de projeto (canto superior esquerdo) → **Novo projeto** →
nome `RNV Agendamentos` → **Criar**. Espere e selecione o projeto novo.

### 1.2 Ativar a API do Calendar

Busque no topo por **Google Calendar API** → abra → **Ativar**.

### 1.3 Tela de consentimento

Menu → **APIs e serviços** → **Tela de permissão OAuth**.
*(Em contas mais novas o Google chamou isso de **Google Auth Platform**, com
as abas Branding / Público-alvo / Clientes — os campos são os mesmos.)*

- Tipo de usuário: **Externo** → Criar
  > "Interno" só existe em conta Google Workspace. Como é Gmail comum, é Externo mesmo.
- Nome do app: `RNV Agendamentos`
- E-mail de suporte e e-mail do desenvolvedor: `riconessavida@gmail.com`
- Salvar e continuar até o fim (pode pular Escopos e Usuários de teste)

### 1.4 ⚠️ PUBLICAR o app — não pule este passo

Ainda na tela de consentimento (ou na aba **Público-alvo**), procure
**Publicar app** / **Publicar aplicativo** e confirme. O status precisa ficar
**Em produção**, não "Teste".

> **Por que importa:** em modo "Teste", o Google **cancela a autorização a cada
> 7 dias**. O Meet pararia de ser criado sem aviso nenhum, e você só
> descobriria quando um cliente reclamasse.

Não precisa passar por verificação do Google. Como você é o único a autorizar,
vai aparecer uma tela de "app não verificado" **uma vez** — é só clicar em
**Avançado → Ir para RNV Agendamentos (não seguro)**.

### 1.5 Criar a credencial

**APIs e serviços** → **Credenciais** → **Criar credenciais** →
**ID do cliente OAuth**.

- Tipo de aplicativo: **Aplicativo da Web**
- Nome: `Sistema RNV`
- Em **URIs de redirecionamento autorizados** → **Adicionar URI** e cole o
  endereço que o sistema mostra em **Agenda → Google** (algo como
  `https://seu-endereco.vercel.app/google-callback`)

> Esse endereço tem que ser **idêntico**, incluindo o `https://` e sem barra no
> final. Use o botão **Copiar** da aba Google para não errar.

Clique em **Criar**. O Google mostra o **ID do cliente** e a **Chave secreta**.
**Deixe essa janela aberta** — você vai precisar dos dois agora.

---

## Parte 2 — Supabase

### 2.1 Guardar as chaves

**Supabase → Edge Functions → Secrets** (ou Project Settings → Edge Functions),
crie os dois:

| Nome | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | o ID do cliente |
| `GOOGLE_CLIENT_SECRET` | a chave secreta |

### 2.2 Rodar o SQL

**SQL Editor** → cole e execute `supabase/migrations/007_google_calendar.sql`.

### 2.3 Publicar a função `google-oauth`

**Edge Functions** → nova função com o nome exato **`google-oauth`** → cole
`supabase/functions/google-oauth/index.ts` → **Deploy**.

> Esta fica com **Verify JWT LIGADO** (só o sistema logado chama).

### 2.4 Atualizar a função `booking`

A `booking` mudou (agora cria o Meet e lê sua ocupação). Abra ela e cole de
novo o conteúdo atualizado de `supabase/functions/booking/index.ts`.

> Continua com **Verify JWT DESLIGADO**.

---

## Parte 3 — Conectar

No sistema: **Agenda → Google → Conectar minha conta Google**.

Escolha `riconessavida@gmail.com`, passe pelo aviso de app não verificado
(Avançado → Ir para) e autorize. Você volta para o sistema com a mensagem
**"Google conectado!"**.

---

## Testando

1. Marque uma reunião de teste pelo seu link (aba anônima).
2. Abra o card dela na aba **Semana** → deve ter o botão verde
   **Abrir videoconferência**.
3. Abra o **Google Agenda** no celular → o evento deve estar lá, com o Meet.
4. Crie um compromisso qualquer no Google Agenda num horário da sua grade,
   recarregue o link de agendamento e confirme que aquele horário **sumiu**.
5. Cancele o teste por `/r/<manageToken>` → o evento deve sair do Google.

---

## Quando der problema

**"Google conectado" mas sem link do Meet nas reuniões**
Veja a aba **Agenda → Google**: se a autorização caiu, aparece um aviso
vermelho. Desconecte e conecte de novo.

**A autorização cai sozinha depois de alguns dias**
O app ficou em modo "Teste". Volte no passo **1.4** e publique.

**"Erro 400: redirect_uri_mismatch"**
O endereço no Google Cloud está diferente do que o sistema usa. Copie de novo
pelo botão da aba Google e cole exatamente igual.

**"blocked by CORS policy" no console, ou "não consegui falar com a função"**
A função publicada está desatualizada. Recole o conteúdo de
`supabase/functions/google-oauth/index.ts` e faça Deploy de novo.

**"O Google não devolveu a autorização permanente"**
A conta já tinha autorizado antes. Vá em
[myaccount.google.com/permissions](https://myaccount.google.com/permissions),
remova o acesso de `RNV Agendamentos` e conecte de novo.

---

## Sobre o limite de 60 minutos

Em conta Gmail comum, o Meet corta em **60 minutos** quando há **3 ou mais
pessoas** (1 a 1 vai até 24h). Isso **já é assim hoje** com o eAgenda, que usa
a mesma conta — não é mudança nossa. Se virar problema, o Google Workspace
(~R$30/mês) sobe o limite.
