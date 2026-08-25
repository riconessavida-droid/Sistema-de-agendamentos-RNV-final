// =====================================================================
// Edge Function: d4sign-sync
//
// De hora em hora pergunta ao D4Sign o que mudou nos contratos e faz
// sozinho o que a assistente fazia na mão:
//
//   1) contrato FINALIZADO  -> confere o CPF, descobre de quem é, marca
//      "Contrato Assinado", guarda o PDF e avisa o Eduardo no WhatsApp
//   2) contrato PARADO 2 dias sem assinar -> avisa o Eduardo para cobrar
//
// POR QUE POLLING E NÃO WEBHOOK: o webhook do D4Sign só se cadastra
// documento a documento, por API. A assistente envia os contratos pelo
// PAINEL, então os documentos dela nasceriam sem webhook e nada chegaria.
// Perguntando, funciona não importa como o contrato foi enviado.
//
// ⚠️ A API do D4Sign permite 10 REQUISIÇÕES POR HORA no plano atual.
// Uma rodada parada gasta 1 (a listagem). Só documento que MUDOU custa
// mais. MAX_REQUESTS abaixo é o freio: o que não couber nesta hora fica
// para a próxima, sem perder nada.
//
// ⚠️ A lógica de validar CPF e descobrir de quem é o contrato é a MESMA
// da função d4sign-webhook — está duplicada aqui porque sem a CLI do
// Supabase não dá para compartilhar arquivo entre funções. Mudou a regra
// numa, mude na outra.
//
// Deploy:  Verify JWT DESLIGADO (quem chama é o cron do banco).
// Segredos:
//   D4SIGN_TOKEN_API    (obrigatório)  TokenAPI do painel do D4Sign
//   D4SIGN_CRYPT_KEY    (obrigatório)  CryptKey do painel do D4Sign
//   D4SIGN_SAFE_UUID    (opcional)     força um cofre; sem ele, descobre
//   D4SIGN_NOTIFY_URL   (opcional)     webhook papo.ai "contrato assinado"
//   D4SIGN_CHASE_URL    (opcional)     webhook papo.ai "contrato pendente"
//   D4SIGN_NOTIFY_TOKEN (opcional)     Bearer dos webhooks acima
//   D4SIGN_OWNER_EMAILS (opcional)     e-mails do Eduardo, separados por vírgula
//   ADMIN_PHONE         (obrigatório para notificar) telefone com DDI
//
// Body {"dryRun": true} consulta o D4Sign e mostra o que faria, sem
// gravar nem enviar. Bom para conferir antes de soltar.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API_BASE = "https://secure.d4sign.com.br/api/v1";

// Teto de requisições por rodada. O plano permite 10/hora; deixamos folga
// porque uma retentativa do cron pode cair na mesma hora.
const MAX_REQUESTS = 7;

// Dias sem assinar até o Eduardo ser avisado. Combinado com ele: 2.
const CHASE_AFTER_DAYS = 2;

/**
 * Trava de segurança: quantos clientes a função pode criar numa rodada.
 *
 * O cofre real tem 413 documentos — todo o histórico da consultoria. Sem
 * esta trava, um engano de leitura vira dezenas de clientes-fantasma e
 * dezenas de mensagens no WhatsApp do Eduardo, em produção, de uma vez.
 * Se o teto for atingido a rodada para e reporta, em vez de continuar.
 */
const MAX_NEW_CLIENTS_PER_RUN = 3;

/**
 * LINHA DE CORTE — segunda camada, não a principal.
 *
 * ⚠️ Ela SOZINHA não segura nada, e isso já custou caro: em 22/08/2026 uns
 * 60 clientes antigos viraram fichas novas apesar da trava estar em
 * 17/08. O motivo é que o endpoint de signatários não devolve a data da
 * assinatura em nenhum dos campos conhecidos, então `signedAtDate` caía no
 * fallback "agora" e TODO contrato parecia recém-assinado. As datas
 * gravadas denunciavam: todas no minuto 10, que é a hora do cron.
 *
 * Quem segura de verdade é o inventário POR COFRE, mais abaixo, que não
 * depende de data nenhuma. Esta data fica como reforço para o dia em que
 * a leitura do carimbo for corrigida.
 *
 * Sobrescrevível pelo segredo D4SIGN_SINCE (AAAA-MM-DD).
 */
const DEFAULT_PROCESS_SINCE = "2026-08-25";

const INACTIVE_STATUSES = new Set(["CLOSED_CONTRACT", "CANCELLED_EARLY"]);
const DEFAULT_OWNER_EMAILS = ["riconessavida@gmail.com", "eduardo@riconessavida.com.br"];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// --------------------------------------------------------------- texto
function normalizeName(s) {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}
function firstTwoNames(s) {
  return normalizeName(s).split(" ").filter(Boolean).slice(0, 2).join(" ");
}
function onlyDigits(s) {
  return (s ?? "").replace(/\D/g, "");
}
function normalizeEmail(s) {
  return (s ?? "").trim().toLowerCase();
}
function formatCpf(d) {
  return d.length === 11 ? d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9) : d;
}
const firstName = (full) => (full ?? "").trim().split(/\s+/)[0] ?? "";

// A Meta REJEITA parâmetro de template com quebra de linha (erro 132018).
// Tudo que vai para o WhatsApp passa por aqui antes.
const cleanText = (v) => (v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
const cleanUrl = (v) => (v ?? "").replace(/\s+/g, "").replace(/\/+$/, "");

// O papo.ai exige DDI + DDD + número.
const toWhatsApp = (digits) => {
  const clean = (digits ?? "").replace(/\D/g, "");
  if (clean.length < 10) return null;
  return clean.startsWith("55") ? clean : "55" + clean;
};

// Dígito verificador do CPF. É esta função que protege a negativação.
function isValidCpf(raw) {
  const d = onlyDigits(raw);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i], 10) * (10 - i);
  let dv1 = (sum * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== parseInt(d[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i], 10) * (11 - i);
  let dv2 = (sum * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return dv2 === parseInt(d[10], 10);
}

// --------------------------------------------------------------- datas
function monthKeyOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  const d = m ? new Date(m[1] + "-" + m[2] + "-" + m[3] + "T12:00:00") : new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function dayOf(iso) {
  const m = /^\d{4}-\d{2}-(\d{2})/.exec(iso ?? "");
  return m ? parseInt(m[1], 10) : new Date().getDate();
}

/**
 * O D4Sign devolve data em formatos diferentes conforme o endpoint:
 * "2026-08-11 14:32:09" (mais comum) ou ISO com timezone. O primeiro não
 * tem fuso — é horário de Brasília, e interpretar como UTC jogaria a data
 * 3h para trás, o que atrasaria a régua de cobrança.
 */
function parseD4SignDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (plain) {
    return new Date(
      plain[1] + "-" + plain[2] + "-" + plain[3] + "T" +
      plain[4] + ":" + plain[5] + ":" + (plain[6] ?? "00") + "-03:00"
    );
  }
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** Primeiro valor não vazio entre vários nomes possíveis de campo. */
function pick(obj, names) {
  if (!obj) return null;
  for (const name of names) {
    const value = obj[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

/**
 * A documentação pública do D4Sign não fixa os nomes dos campos, e eles
 * variam de endpoint para endpoint ("uuid-safe", "uuidSafe", "uuid_safe").
 * Em vez de adivinhar de novo a cada erro, aqui a chave é comparada sem
 * hífen, underscore nem maiúscula — então qualquer uma dessas grafias cai
 * no mesmo lugar.
 */
const flatKey = (k) => String(k).toLowerCase().replace(/[-_\s]/g, "");

function pickLoose(obj, names) {
  if (!obj || typeof obj !== "object") return null;
  const wanted = names.map(flatKey);
  for (const [key, value] of Object.entries(obj)) {
    if (!wanted.includes(flatKey(key))) continue;
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Último recurso: qualquer campo cujo valor tenha cara de UUID. */
function anyUuid(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && UUID_RE.test(value.trim()) && flatKey(key).includes("uuid")) {
      return value.trim();
    }
  }
  for (const value of Object.values(obj)) {
    if (typeof value === "string" && UUID_RE.test(value.trim())) return value.trim();
  }
  return null;
}

const daysBetween = (from, to) => (to.getTime() - from.getTime()) / 86400000;

// =====================================================================
Deno.serve(async (req) => {
  let body = {};
  try { body = await req.json(); } catch { /* o cron chama sem corpo */ }
  const dryRun = body?.dryRun === true;

  const tokenApi = cleanUrl(Deno.env.get("D4SIGN_TOKEN_API"));
  const cryptKey = cleanUrl(Deno.env.get("D4SIGN_CRYPT_KEY"));
  if (!tokenApi || !cryptKey) {
    return json({ ok: false, error: "faltam os segredos D4SIGN_TOKEN_API e D4SIGN_CRYPT_KEY" }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );

  // ------------------------------------------------- chamadas à API
  let requestsUsed = 0;
  const auth = "tokenAPI=" + encodeURIComponent(tokenApi) + "&cryptKey=" + encodeURIComponent(cryptKey);

  async function apiCall(path, method = "GET", payload = null) {
    if (requestsUsed >= MAX_REQUESTS) {
      const err = new Error("teto de requisições da rodada atingido");
      err.budgetExhausted = true;
      throw err;
    }
    requestsUsed++;
    const url = API_BASE + path + (path.includes("?") ? "&" : "?") + auth;
    const init = { method, headers: { "content-type": "application/json" } };
    if (payload) init.body = JSON.stringify(payload);

    const response = await fetch(url, init);
    const text = await response.text();

    if (response.status === 429) {
      const err = new Error("D4Sign recusou por excesso de requisições (429)");
      err.budgetExhausted = true;
      throw err;
    }
    if (!response.ok) {
      throw new Error("D4Sign " + method + " " + path + " respondeu HTTP " + response.status + ": " + text.slice(0, 300));
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("D4Sign devolveu resposta que não é JSON em " + path + ": " + text.slice(0, 300));
    }
  }

  // A API às vezes devolve [ {...} ], às vezes { data: [...] }, às vezes
  // um objeto indexado por número, às vezes lista dentro de lista.
  // Normaliza tudo para uma lista rasa de objetos.
  function asList(payload) {
    const out = [];
    const walk = (node, depth) => {
      if (node === null || node === undefined || depth > 3) return;
      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, depth + 1));
        return;
      }
      if (typeof node !== "object") return;

      // Objeto que já parece um registro: tem alguma chave com "uuid".
      const hasUuid = Object.keys(node).some((k) => flatKey(k).includes("uuid"));
      if (hasUuid) { out.push(node); return; }

      // Senão é envelope ({data: ...}, {"0": {...}}): desce mais um nível.
      Object.values(node).forEach((item) => walk(item, depth + 1));
    };
    walk(payload, 0);
    return out;
  }

  const state = {
    last_run_at: new Date().toISOString(),
    last_ok: true,
    last_error: null,
    requests_used: 0,
    documents_seen: 0
  };
  const report = { dryRun, signed: [], chased: [], skipped: [], errors: [] };

  async function saveState(extra) {
    if (dryRun) return;
    await supabase.from("d4sign_sync_state")
      .update({ ...state, ...extra, requests_used: requestsUsed })
      .eq("id", 1);
  }

  try {
    // ------------------------------------------------------- o cofre
    const { data: stored } = await supabase
      .from("d4sign_sync_state").select("*").eq("id", 1).maybeSingle();

    let safeUuid = cleanUrl(Deno.env.get("D4SIGN_SAFE_UUID")) || stored?.safe_uuid || null;
    let safeName = stored?.safe_name ?? null;

    /**
     * TODOS os cofres, não só um.
     *
     * A primeira versão fixava um cofre ("Contrato e promissória
     * consultoria") e ignorava o resto. Um contrato assinado em 18/08 ficou
     * invisível por isso: estava em outro cofre da mesma conta, o sistema
     * nunca soube que existia e o cliente ficou sem PDF na ficha.
     *
     * Agora a descoberta guarda a lista inteira e cada rodada varre todos.
     * Custa 1 requisição por cofre — com o teto de 7 por rodada, cabe.
     */
    let safes = Array.isArray(stored?.safes) && stored.safes.length ? stored.safes : null;

    if (!safes && !safeUuid) {
      // Descoberta custa 1 requisição — por isso o resultado fica guardado.
      const rawSafes = await apiCall("/safes");
      const safes_ = asList(rawSafes);
      if (safes_.length === 0) {
        // Mostra o retorno cru: é mais barato conferir o formato uma vez
        // do que adivinhar nome de campo a cada deploy.
        throw new Error(
          "a conta do D4Sign não devolveu nenhum cofre reconhecível. Retorno: " +
          JSON.stringify(rawSafes).slice(0, 500)
        );
      }

      const safeNameOf = (s) => String(pickLoose(s, ["name-safe", "name", "nameSafe", "safeName"]) ?? "");

      // Prefere um cofre com "contrato" no nome; senão, o primeiro.
      const preferred =
        safes_.find((s) => normalizeName(safeNameOf(s)).includes("contrato")) ?? safes_[0];

      safes = safes_.map((x) => ({
        uuid: String(pickLoose(x, ["uuid-safe", "uuid", "uuidSafe", "safeUuid"]) ?? anyUuid(x) ?? ""),
        name: safeNameOf(x),
      })).filter((x) => x.uuid);

      if (safes.length === 0) {
        throw new Error(
          "não achei o uuid de nenhum cofre. Retorno: " + JSON.stringify(safes_).slice(0, 500)
        );
      }

      safeUuid = preferred ? String(pickLoose(preferred, ["uuid-safe", "uuid", "uuidSafe", "safeUuid"]) ?? anyUuid(preferred) ?? "") : safes[0].uuid;
      safeName = preferred ? safeNameOf(preferred) : safes[0].name;
      if (!dryRun) {
        await supabase.from("d4sign_sync_state")
          .update({ safe_uuid: safeUuid, safe_name: safeName, safes }).eq("id", 1);
      }
    }

    // -------------------------------------------- os documentos do cofre
    /**
     * Varre TODOS os cofres, um por requisição.
     *
     * Ficar num cofre só escondeu um contrato finalizado por dias: ele
     * estava em outro cofre da mesma conta e o sistema nunca soube que
     * existia. Se o orçamento de requisições acabar no meio, os cofres que
     * faltaram entram na próxima rodada — nada se perde, só atrasa.
     */
    const alvos = safes && safes.length
      ? safes
      : [{ uuid: safeUuid, name: safeName ?? "", inventoried: false }];

    const rawDocuments = [];
    const cofresLidos = [];
    for (const cofre of alvos) {
      try {
        const doCofre = asList(await apiCall("/documents/" + encodeURIComponent(cofre.uuid) + "/safe"));
        doCofre.forEach((d) => rawDocuments.push(d));
        cofresLidos.push({ nome: cofre.name, documentos: doCofre.length });
      } catch (e) {
        if (e.budgetExhausted) {
          report.skipped.push({ cofre: cofre.name, reason: "sem requisição sobrando nesta hora" });
          break;
        }
        report.errors.push({ cofre: cofre.name, error: String(e.message ?? e) });
      }
    }
    state.documents_seen = rawDocuments.length;

    /**
     * COFRE NOVO ENTRA INTEIRO COMO HISTÓRICO.
     *
     * A linha de corte por data não segurou nada: o endpoint de
     * signatários não devolve a data da assinatura nos campos conhecidos,
     * então TODO contrato parecia "assinado agora" e ~60 clientes antigos
     * viraram fichas novas, que o Eduardo teve de apagar um a um.
     *
     * O critério agora não depende de data nenhuma: na primeira vez que um
     * cofre é visto, tudo que está nele é passado. Só documento que
     * aparecer DEPOIS disso conta como novo. É a mesma ideia do inventário
     * inicial, aplicada por cofre — porque foi exatamente um cofre novo
     * aparecendo que causou o estrago.
     */
    const novos = alvos.filter((c) => !c.inventoried && cofresLidos.some((l) => l.nome === c.name));
    if (novos.length > 0) {
      const novosUuids = new Set(novos.map((c) => c.uuid));
      const doNovo = rawDocuments.filter((d) => {
        const u = String(pickLoose(d, ["uuidSafe", "uuid-safe"]) ?? "");
        return novosUuids.has(u);
      });

      if (!dryRun && doNovo.length > 0) {
        const linhas = doNovo.map((d) => {
          const statusName = String(pickLoose(d, ["statusName", "status"]) ?? "");
          const flat = normalizeName(statusName);
          const fin = flat.includes("finaliz");
          const can = flat.includes("cancel");
          return {
            doc_uuid: String(pickLoose(d, ["uuidDoc", "uuid"]) ?? anyUuid(d) ?? ""),
            document_name: String(pickLoose(d, ["nameDoc", "name"]) ?? ""),
            uuid_safe: String(pickLoose(d, ["uuidSafe", "uuid-safe"]) ?? ""),
            status_name: statusName,
            sent_at: now.toISOString(),
            status: fin ? "IGNORED" : can ? "CANCELED" : "AWAITING",
            issue: "cofre inventariado em " + now.toISOString().slice(0, 10) + " — anterior à integração",
            chase_sent_at: fin || can ? null : now.toISOString(),
            last_seen_at: now.toISOString(),
            raw: d,
          };
        }).filter((l) => l.doc_uuid);

        for (let i = 0; i < linhas.length; i += 100) {
          await supabase.from("d4sign_documents")
            .upsert(linhas.slice(i, i + 100), { onConflict: "doc_uuid" });
        }

        const marcados = alvos.map((c) => ({ ...c, inventoried: c.inventoried || novosUuids.has(c.uuid) }));
        await supabase.from("d4sign_sync_state").update({ safes: marcados }).eq("id", 1);
      }

      return json({
        ok: true,
        mode: "inventário de cofre novo",
        cofres: novos.map((c) => c.name),
        documentos: doNovo.length,
        note: "Passado registrado sem processar. Só o que entrar a partir de agora conta como novo.",
        dryRun,
        requestsUsed,
      });
    }

    const documents = rawDocuments.map((d) => {
      const statusName = String(pickLoose(d, ["statusName", "status"]) ?? "");
      const flat = normalizeName(statusName);
      return {
        uuid: String(pickLoose(d, ["uuidDoc", "uuid"]) ?? anyUuid(d) ?? ""),
        name: String(pickLoose(d, ["nameDoc", "name"]) ?? ""),
        statusId: String(pickLoose(d, ["statusId"]) ?? ""),
        statusName,
        // Classificar pelo NOME e não pelo número: a documentação pública
        // não fixa os códigos, mas o texto é estável.
        isFinished: flat.includes("finaliz"),
        isCanceled: flat.includes("cancel"),
        sentAt: parseD4SignDate(pickLoose(d, ["dateCreated", "createdAt", "dateSend", "dateUpload", "date"])),
        raw: d
      };
    }).filter((d) => d.uuid);

    // Um único "agora" para a rodada inteira: o inventário e a régua de
    // cobrança precisam concordar sobre o instante de referência.
    const now = new Date();

    const sinceRaw = cleanUrl(Deno.env.get("D4SIGN_SINCE")) || DEFAULT_PROCESS_SINCE;
    const processSince = new Date(sinceRaw + "T00:00:00-03:00");

    // O que o sistema já sabe sobre esses documentos.
    const { data: knownRows } = await supabase
      .from("d4sign_documents")
      .select("doc_uuid, status, sent_at, chase_sent_at, matched_client_id");
    const known = new Map((knownRows ?? []).map((r) => [r.doc_uuid, r]));

    // ------------------------------------------------- primeira rodada
    /**
     * O cofre carrega TODO o histórico (413 documentos). Como a nossa
     * tabela nasce vazia, sem isto a primeira rodada leria cada contrato
     * antigo como recém-assinado: criaria cliente, marcaria assinado e
     * mandaria um WhatsApp para cada um — exatamente o backfill que o
     * Eduardo descartou ("só clientes novos daqui pra frente").
     *
     * Então a primeira rodada é só INVENTÁRIO: registra o que existe e o
     * estado de cada um, sem processar assinatura e sem notificar ninguém.
     * A partir da segunda, só o que MUDAR desse retrato é tratado como
     * novidade — que é a definição prática de "daqui pra frente".
     */
    /**
     * Uma marca explícita, e nada mais.
     *
     * Já tentei duas heurísticas aqui e as duas falharam em produção:
     *   1. "last_run_at em branco" — uma rodada que FALHA grava esse
     *      campo ao registrar o erro, e o inventário se desligava sozinho.
     *   2. "tabela vazia" — uma rodada anterior com código velho
     *      repovoava a tabela, e o inventário se desligava de novo. Essa
     *      criou 3 clientes do histórico na base real.
     *
     * A diferença agora: `inventory_done` só vira true no fim de um
     * inventário bem-sucedido. Nenhum caminho de erro liga essa flag, e
     * enquanto ela estiver falsa a função se recusa a criar cliente.
     */
    const isFirstRun = stored?.inventory_done !== true;

    if (isFirstRun) {
      if (dryRun) {
        return json({
          ok: true, dryRun: true, mode: "inventário (primeira rodada)",
          safe: safeName, documents: documents.length,
          note: "A primeira rodada real vai apenas registrar estes documentos, sem criar cliente nem notificar.",
          sampleDocument: documents[0]?.raw ?? null,
          requestsUsed
        });
      }

      /**
       * A listagem do D4Sign não traz NENHUMA data (os campos são
       * uuidDoc, nameDoc, type, size, pages, uuidSafe, safeName,
       * statusId, statusName). Sem data, todo documento antigo pareceria
       * ter sido enviado "agora" — e em dois dias o Eduardo receberia uma
       * cobrança para cada contrato do histórico que nunca foi assinado.
       *
       * Por isso o inventário já nasce com `chase_sent_at` preenchido nos
       * que estão aguardando: marca o histórico como "já tratado" e tira
       * todos eles da régua de cobrança. Contrato que aparecer DEPOIS
       * desta rodada entra sem essa marca e é cobrado normalmente.
       */
      const inventory = documents.map((doc) => ({
        doc_uuid: doc.uuid,
        document_name: doc.name,
        uuid_safe: safeUuid,
        status_id: doc.statusId,
        status_name: doc.statusName,
        sent_at: (doc.sentAt ?? now).toISOString(),
        status: doc.isFinished ? "IGNORED" : doc.isCanceled ? "CANCELED" : "AWAITING",
        issue: doc.isFinished
          ? "histórico anterior à integração — não processado de propósito"
          : doc.isCanceled ? null : "histórico anterior à integração — fora da régua de cobrança",
        chase_sent_at: doc.isFinished || doc.isCanceled ? null : now.toISOString(),
        last_seen_at: now.toISOString(),
        raw: doc.raw
      }));

      // Em blocos, para não estourar o limite de payload do PostgREST.
      for (let i = 0; i < inventory.length; i += 100) {
        const { error: invErr } = await supabase
          .from("d4sign_documents").upsert(inventory.slice(i, i + 100), { onConflict: "doc_uuid" });
        if (invErr) throw new Error(`inventário: ${invErr.message}`);
      }

      // A flag só é ligada AQUI, depois de o inventário inteiro ter sido
      // gravado sem erro. É o que separa "já conheço o histórico" de
      // "ainda não sei o que é antigo" — e nenhum caminho de erro passa
      // por esta linha.
      await saveState({
        safe_uuid: safeUuid,
        safe_name: safeName,
        documents_seen: documents.length,
        sample_document: documents[0]?.raw ?? null,
        inventory_done: true
      });

      return json({
        ok: true, mode: "inventário (primeira rodada)",
        safe: safeName, safes: cofresLidos, documents: documents.length, inventoried: inventory.length,
        note: "Histórico registrado sem processar. Da próxima rodada em diante, só o que mudar é tratado como novo.",
        requestsUsed
      });
    }

    let createdThisRun = 0;

    // ---------------------------------------------- clientes (1 leitura)
    const { data: allClients } = await supabase
      .from("clients").select("id, name, email, cpf, phone_digits, status_by_month");
    const clients = allClients ?? [];
    const activeClients = clients.filter(
      (c) => !Object.values(c.status_by_month ?? {}).some((s) => INACTIVE_STATUSES.has(s?.status))
    );

    const ownerEmails = new Set(
      (Deno.env.get("D4SIGN_OWNER_EMAILS") ?? DEFAULT_OWNER_EMAILS.join(","))
        .split(",").map(normalizeEmail).filter(Boolean)
    );

    const notifyUrl = cleanUrl(Deno.env.get("D4SIGN_NOTIFY_URL"));
    const chaseUrl = cleanUrl(Deno.env.get("D4SIGN_CHASE_URL"));
    const adminPhone = toWhatsApp(cleanText(Deno.env.get("ADMIN_PHONE")));
    const notifyToken = cleanText(Deno.env.get("D4SIGN_NOTIFY_TOKEN"));

    async function notify(url, payload) {
      if (!url || !adminPhone) return { ok: false, detail: "sem URL ou sem ADMIN_PHONE" };
      try {
        const headers = { "content-type": "application/json" };
        if (notifyToken) headers["authorization"] = "Bearer " + notifyToken;
        const response = await fetch(url, {
          method: "POST", headers,
          body: JSON.stringify({ ...payload, phone: adminPhone })
        });
        return response.ok ? { ok: true } : { ok: false, detail: "HTTP " + response.status };
      } catch (e) {
        return { ok: false, detail: String(e) };
      }
    }

    let sampleSigner = null;

    // ============================================ 1) contratos assinados
    for (const doc of documents) {
      const previous = known.get(doc.uuid);

      if (!doc.isFinished) continue;
      // Já demos baixa neste contrato: não gasta requisição de novo.
      if (previous && (previous.status === "OK" || previous.status === "INVALID_CPF")) continue;
      // Histórico registrado no inventário: fica como está, de propósito.
      if (previous && previous.status === "IGNORED") continue;

      if (createdThisRun >= MAX_NEW_CLIENTS_PER_RUN) {
        report.skipped.push({ uuid: doc.uuid, name: doc.name, reason: "teto de criação por rodada atingido" });
        break;
      }

      let signers;
      try {
        const rawSigners = await apiCall("/documents/" + encodeURIComponent(doc.uuid) + "/list");

        /**
         * O endpoint devolve o DOCUMENTO, com os signatários aninhados
         * num campo `list`. Como o objeto de fora também tem "uuidDoc", o
         * achatamento genérico parava nele e devolvia o documento como se
         * fosse o signatário — daí nome, e-mail e CPF virem vazios.
         *
         * Formato real de cada signatário:
         *   { key_signer, user_name, user_document, email, signed, ... }
         */
        const nested = [];
        const collect = (node, depth) => {
          if (!node || depth > 3) return;
          if (Array.isArray(node)) { node.forEach((n) => collect(n, depth + 1)); return; }
          if (typeof node !== "object") return;
          if (Array.isArray(node.list)) { nested.push(...node.list); return; }
          Object.values(node).forEach((n) => collect(n, depth + 1));
        };
        collect(rawSigners, 0);

        signers = nested.length > 0 ? nested : asList(rawSigners);
      } catch (e) {
        if (e.budgetExhausted) {
          // Fica para a próxima hora, intacto. Nada se perde.
          report.skipped.push({ uuid: doc.uuid, name: doc.name, reason: "sem requisição sobrando nesta hora" });
          break;
        }
        report.errors.push({ uuid: doc.uuid, error: String(e.message ?? e) });
        continue;
      }

      // O signatário que não é o Eduardo é o cliente.
      const signer =
        signers.find((s) => !ownerEmails.has(normalizeEmail(String(pickLoose(s, ["email", "userEmail"]) ?? "")))) ??
        signers[0];

      if (!signer) {
        report.errors.push({ uuid: doc.uuid, error: "documento finalizado sem signatário" });
        continue;
      }
      // Guardado para descobrir em que campo vem a data da assinatura —
      // hoje ela não é lida e o carimbo acaba sendo a hora do cron.
      if (!sampleSigner) sampleSigner = signer;

      // Nomes confirmados no retorno real: user_name, user_document, email.
      const signerName = String(pickLoose(signer, ["userName", "displayName", "name"]) ?? "");
      const signerEmail = normalizeEmail(String(pickLoose(signer, ["email", "userEmail"]) ?? ""));
      const signerCpfDigits = onlyDigits(String(pickLoose(signer, ["userDocument", "documento", "identificationNumber", "cpf"]) ?? ""));
      // `signed` é "1"/"0", não uma data — não serve como carimbo.
      const signedAtDate =
        parseD4SignDate(pickLoose(signer, ["signedAt", "dateSigned", "signDate"])) ??
        parseD4SignDate(pickLoose(signer?.sign_info ?? {}, ["date", "signedAt"])) ??
        doc.sentAt ?? now;
      const signedAt = signedAtDate.toISOString();
      // ------------------------------------------- linha de corte por data
      // Antes de qualquer coisa: se o contrato é anterior ao corte, ele é
      // histórico. Registra e sai — sem baixar PDF (economiza a segunda
      // requisição), sem criar cliente, sem notificar.
      if (signedAtDate < processSince) {
        if (!dryRun) {
          await supabase.from("d4sign_documents").upsert({
            doc_uuid: doc.uuid,
            document_name: doc.name,
            uuid_safe: doc.safeUuid ?? safeUuid,
            status_id: doc.statusId,
            status_name: doc.statusName,
            signer_name: signerName || null,
            signer_email: signerEmail || null,
            signed_at: signedAt,
            sent_at: signedAt,
            status: "IGNORED",
            issue: "assinado antes da linha de corte (" + processSince.toISOString().slice(0, 10) + ")",
            last_seen_at: now.toISOString(),
            raw: doc.raw,
          }, { onConflict: "doc_uuid" });
        }
        report.skipped.push({
          uuid: doc.uuid,
          name: signerName || doc.name,
          reason: "assinado em " + signedAt.slice(0, 10) + ", antes do corte",
        });
        continue;
      }

      const cpfValid = isValidCpf(signerCpfDigits);
      const issue = cpfValid ? null : "CPF inválido (" + (formatCpf(signerCpfDigits) || "não informado") + ")";

      /**
       * Guarda de sanidade: se NADA foi lido do signatário, o problema é
       * de leitura da API, não do contrato. Criar cliente aqui produziria
       * uma ficha vazia e um alarme falso no WhatsApp — melhor parar e
       * deixar o retorno cru registrado para eu corrigir o parsing.
       */
      if (!signerName && !signerEmail && !signerCpfDigits) {
        report.errors.push({
          uuid: doc.uuid,
          error: "não consegui ler nome, e-mail nem CPF do signatário",
          rawSigner: signer
        });
        if (!dryRun) {
          await supabase.from("d4sign_documents").upsert({
            doc_uuid: doc.uuid,
            document_name: doc.name,
            uuid_safe: safeUuid,
            status_id: doc.statusId,
            status_name: doc.statusName,
            status: "UNMATCHED",
            issue: "signatário ilegível no retorno da API",
            last_seen_at: now.toISOString(),
            raw: { document: doc.raw, signer }
          }, { onConflict: "doc_uuid" });
        }
        continue;
      }

      // ---------------------------------------- de quem é este contrato?
      let clientId = null;
      let matchMethod = null;

      if (signerEmail) {
        const { data: link } = await supabase
          .from("d4sign_client_links").select("client_id").eq("email", signerEmail).maybeSingle();
        if (link?.client_id) { clientId = link.client_id; matchMethod = "link"; }
      }
      if (!clientId && signerCpfDigits) {
        const byCpf = clients.filter((c) => onlyDigits(c.cpf ?? "") === signerCpfDigits);
        if (byCpf.length === 1) { clientId = byCpf[0].id; matchMethod = "cpf"; }
      }
      if (!clientId && signerEmail) {
        const byEmail = clients.filter((c) => normalizeEmail(c.email ?? "") === signerEmail);
        if (byEmail.length === 1) { clientId = byEmail[0].id; matchMethod = "email"; }
      }
      if (!clientId && signerName) {
        const target = firstTwoNames(signerName);
        if (target) {
          const byName = activeClients.filter((c) => firstTwoNames(c.name ?? "") === target);
          if (byName.length === 1) { clientId = byName[0].id; matchMethod = "name"; }
        }
      }

      // ------------------------------------------------------- o PDF
      let pdfUrl = null;
      try {
        const download = await apiCall(
          "/documents/" + encodeURIComponent(doc.uuid) + "/download",
          "POST",
          { document: "true", language: "pt" }
        );
        pdfUrl = pick(download, ["url", "link"]) ?? null;
      } catch (e) {
        // Sem PDF a baixa acontece igual — o link é conveniência, não requisito.
        if (!e.budgetExhausted) report.errors.push({ uuid: doc.uuid, error: "download: " + String(e.message ?? e) });
      }

      if (dryRun) {
        report.signed.push({
          uuid: doc.uuid, name: signerName, email: signerEmail,
          cpf: formatCpf(signerCpfDigits), cpfValid, matchMethod: matchMethod ?? "criaria cliente",
          pdf: Boolean(pdfUrl), wouldNotify: true
        });
        continue;
      }

      if (!clientId) createdThisRun++;

      // --------------------------------------- grava cliente (acha ou cria)
      let created = false;
      if (!clientId) {
        let grossValue = 1599;
        let machineRate = 10;
        try {
          const { data: cfg } = await supabase
            .from("billing_config").select("contract_value, machine_rate").maybeSingle();
          if (cfg) {
            grossValue = cfg.contract_value ?? grossValue;
            machineRate = cfg.machine_rate ?? machineRate;
          }
        } catch { /* mantém o padrão */ }
        const netValue = parseFloat((grossValue - (grossValue * machineRate / 100)).toFixed(2));

        const colors = [
          "bg-yellow-100 border-yellow-200 text-yellow-800",
          "bg-slate-200/50 border-slate-300 text-slate-700",
          "bg-amber-100 border-amber-200 text-amber-800",
          "bg-slate-300/40 border-slate-400 text-slate-600"
        ];

        const newId = crypto.randomUUID();
        const { error: insErr } = await supabase.from("clients").insert({
          id: newId,
          name: signerName || "(sem nome)",
          phone_digits: "",                        // chega depois, pelo eAgenda
          start_month_year: monthKeyOf(signedAt),  // provisório: mês da assinatura
          start_date: dayOf(signedAt),
          sequence_in_month: 0,
          group_color: colors[clients.length % colors.length],
          status_by_month: {},
          extra_meetings: 0,
          contract_signed: cpfValid,
          contract_gross_value: grossValue,
          contract_machine_rate: machineRate,
          contract_value: netValue,
          email: signerEmail || null,
          cpf: signerCpfDigits || null,
          contract_signed_at: signedAt,
          contract_doc_uuid: doc.uuid,
          contract_issue: issue,
          contract_pdf_url: pdfUrl,
          contract_pdf_url_at: pdfUrl ? now.toISOString() : null
        });
        if (insErr) {
          report.errors.push({ uuid: doc.uuid, error: "insert client: " + insErr.message });
          continue;
        }
        clientId = newId;
        matchMethod = "created";
        created = true;
      } else {
        const current = clients.find((c) => c.id === clientId) ?? {};
        const patch = {
          contract_signed: cpfValid,
          contract_signed_at: signedAt,
          contract_doc_uuid: doc.uuid,
          contract_issue: issue,
          contract_pdf_url: pdfUrl,
          contract_pdf_url_at: pdfUrl ? now.toISOString() : null
        };
        if (!current.email && signerEmail) patch.email = signerEmail;
        if (!current.cpf && signerCpfDigits) patch.cpf = signerCpfDigits;

        const { error: upErr } = await supabase.from("clients").update(patch).eq("id", clientId);
        if (upErr) {
          report.errors.push({ uuid: doc.uuid, error: "update client: " + upErr.message });
          continue;
        }
      }

      if (signerEmail && clientId) {
        await supabase.from("d4sign_client_links").upsert(
          { email: signerEmail, client_id: clientId, linked_name: signerName },
          { onConflict: "email" }
        );
      }

      await supabase.from("d4sign_documents").upsert({
        doc_uuid: doc.uuid,
        document_name: doc.name,
        uuid_safe: safeUuid,
        status_id: doc.statusId,
        status_name: doc.statusName,
        sent_at: (doc.sentAt ?? previous?.sent_at ?? signedAtDate) instanceof Date
          ? (doc.sentAt ?? signedAtDate).toISOString()
          : (previous?.sent_at ?? signedAt),
        event_datetime: signedAt,
        signer_name: signerName || null,
        signer_email: signerEmail || null,
        signer_cpf: signerCpfDigits || null,
        signed_at: signedAt,
        cpf_valid: cpfValid,
        status: cpfValid ? "OK" : "INVALID_CPF",
        issue,
        matched_client_id: clientId,
        match_method: matchMethod,
        pdf_url: pdfUrl,
        last_seen_at: now.toISOString(),
        raw: doc.raw
      }, { onConflict: "doc_uuid" });

      // ------------------------------------------------- avisa o Eduardo
      const statusLine = cpfValid
        ? "Pode iniciar a consultoria."
        : "Atenção: o CPF informado é inválido (" + formatCpf(signerCpfDigits) + "). Peça para ele refazer.";

      const sent = await notify(notifyUrl, {
        event: cpfValid ? "contract_signed_ok" : "contract_signed_invalid",
        client_id: clientId,
        first_name: cleanText(firstName(signerName)),
        full_name: cleanText(signerName),
        status_line: cleanText(statusLine),
        email: cleanText(signerEmail),
        cpf: formatCpf(signerCpfDigits),
        cpf_valid: cpfValid,
        created
      });

      report.signed.push({
        uuid: doc.uuid, name: signerName, cpfValid,
        matchMethod, created, pdf: Boolean(pdfUrl), notified: sent.ok, detail: sent.detail
      });
    }

    // ================================== 2) parados sem assinar (cobrança)
    for (const doc of documents) {
      if (doc.isFinished || doc.isCanceled) continue;

      const previous = known.get(doc.uuid);
      // Sem data da API, vale a primeira vez que vimos o documento. A
      // precisão é de uma hora — de sobra para uma régua de 2 dias.
      const sentAt = doc.sentAt ?? (previous?.sent_at ? new Date(previous.sent_at) : now);

      if (!dryRun) {
        await supabase.from("d4sign_documents").upsert({
          doc_uuid: doc.uuid,
          document_name: doc.name,
          uuid_safe: safeUuid,
          status_id: doc.statusId,
          status_name: doc.statusName,
          sent_at: sentAt.toISOString(),
          status: doc.isCanceled ? "CANCELED" : "AWAITING",
          last_seen_at: now.toISOString(),
          raw: doc.raw
        }, { onConflict: "doc_uuid" });
      }

      const waitingDays = daysBetween(sentAt, now);
      if (waitingDays < CHASE_AFTER_DAYS) continue;
      if (previous?.chase_sent_at) continue;   // já cobrou uma vez

      // O nome do documento no D4Sign carrega o e-mail do cliente
      // ("Contrato 26 atualizado whatsapp - fulano@gmail com"), então dá
      // para dizer de quem é sem gastar requisição buscando signatário.
      const emailFromName = /([\w.+-]+)@([\w-]+)[ .]([\w.]+)/.exec(doc.name ?? "");
      const guessedEmail = emailFromName
        ? normalizeEmail(emailFromName[1] + "@" + emailFromName[2] + "." + emailFromName[3])
        : null;
      const guessedClient = guessedEmail
        ? clients.find((c) => normalizeEmail(c.email ?? "") === guessedEmail)
        : null;

      const who = guessedClient?.name ?? doc.name ?? "um cliente";
      const waited = Math.floor(waitingDays);

      if (dryRun) {
        report.chased.push({ uuid: doc.uuid, who, waitedDays: waited, wouldNotify: true });
        continue;
      }

      const sent = await notify(chaseUrl, {
        event: "contract_pending",
        client_id: guessedClient?.id ?? null,
        first_name: cleanText(firstName(who)),
        full_name: cleanText(who),
        status_line: cleanText("Enviado há " + waited + (waited === 1 ? " dia" : " dias") + " e ainda não assinou."),
        waited_days: String(waited)
      });

      if (sent.ok) {
        await supabase.from("d4sign_documents")
          .update({ chase_sent_at: now.toISOString() }).eq("doc_uuid", doc.uuid);
      }
      report.chased.push({ uuid: doc.uuid, who, waitedDays: waited, notified: sent.ok, detail: sent.detail });
    }

    await saveState({
      safe_uuid: safeUuid,
      safe_name: safeName,
      documents_seen: state.documents_seen,
      sample_document: documents[0]?.raw ?? null,
      sample_signer: sampleSigner ?? stored?.sample_signer ?? null
    });

    return json({
      ok: true, ...report,
      safe: safeName, safes: cofresLidos, documents: documents.length, requestsUsed,
      // Em modo seco vai junto o retorno cru do signatário: é com ele que
      // se conferem os nomes reais dos campos sem gastar outra rodada.
      ...(dryRun ? { sampleSigner } : {})
    });

  } catch (e) {
    const message = String(e?.message ?? e);
    state.last_ok = false;
    state.last_error = message;
    await saveState({});
    // Erro de teto não é falha: é a rodada dizendo "continuo na próxima".
    const exhausted = e?.budgetExhausted === true;
    return json({ ok: exhausted, error: message, ...report, requestsUsed }, exhausted ? 200 : 500);
  }
});
