// =====================================================================
// Edge Function: d4sign-webhook
// Recebe o webhook 2.0 do D4Sign quando um contrato é FINALIZADO e faz
// sozinho o que a assistente fazia na mão:
//
//   1) confere se o CPF é válido (dígito verificador)
//   2) descobre de quem é o contrato
//        a) vínculo já aprendido (e-mail)      -> instantâneo
//        b) CPF igual ao de um cliente         -> automático
//        c) e-mail igual ao de um cliente      -> automático
//        d) 1º+2º nome batem com 1 ATIVO       -> automático (+ aprende)
//        e) ninguém bate                       -> CRIA o cliente
//   3) marca "Contrato Assinado" (só se o CPF passou)
//   4) notifica o Eduardo (sucesso ou "preencheu errado, avisa ele")
//
// O que NÃO dá pra fazer sem acesso à API do D4Sign: baixar o PDF. Por
// isso endereço e data digitada não são conferidos aqui — o webhook não
// os manda. Se um dia a API for liberada, entra como camada extra sem
// mexer em nada disto.
//
// Deploy:  Verify JWT DESLIGADO (o D4Sign não manda JWT).
// Segredos:
//   D4SIGN_HMAC_SECRET       (obrigatório em produção; sem ele não valida)
//   D4SIGN_OWNER_EMAILS      (opcional, separado por vírgula — signatários
//                             que são o Eduardo e devem ser ignorados)
//   D4SIGN_NOTIFY_URL        (opcional — webhook do papo.ai pra avisar no
//                             WhatsApp; sem ele, só grava no banco)
//   D4SIGN_NOTIFY_TOKEN      (opcional — Bearer do webhook de notificação)
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const INACTIVE_STATUSES = new Set(["CLOSED_CONTRACT", "CANCELLED_EARLY"]);
const TYPE_FINISHED = "1";

// E-mails do próprio Eduardo — nunca são "o cliente" do contrato.
const DEFAULT_OWNER_EMAILS = ["riconessavida@gmail.com", "eduardo@riconessavida.com.br"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ---------------------------------------------------------------------
// Helpers (mesma lógica do eagenda-webhook, pra os dois concordarem)
// ---------------------------------------------------------------------
function normalizeName(s: string): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}
function firstTwoNames(s: string): string {
  return normalizeName(s).split(" ").filter(Boolean).slice(0, 2).join(" ");
}
function onlyDigits(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}
function normalizeEmail(s: string): string {
  return (s ?? "").trim().toLowerCase();
}
function formatCpf(d: string): string {
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
}

// Dígito verificador do CPF. É esta função que protege a negativação.
function isValidCpf(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // 111.111.111-11 e afins
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

// O D4Sign assina o UUID do documento (não o body) e manda em
// "Content-Hmac: sha256=<hex>".
async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function monthKeyOf(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`) : new Date();
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${mm}`;
}
function dayOf(iso: string): number {
  const m = /^\d{4}-\d{2}-(\d{2})/.exec(iso ?? "");
  return m ? parseInt(m[1], 10) : new Date().getDate();
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // ---- corpo (o painel está em JSON, mas aceita form-data por segurança)
  const rawBody = await req.text();
  let payload: any = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    try {
      const params = new URLSearchParams(rawBody);
      payload = Object.fromEntries(params.entries());
      if (typeof payload.signers === "string") payload.signers = JSON.parse(payload.signers);
    } catch {
      return json({ error: "invalid body" }, 400);
    }
  }

  const docUuid: string = payload?.uuid ?? "";
  if (!docUuid) return json({ error: "missing uuid" }, 400);

  // ---- HMAC: assinatura do UUID com a secret key do painel
  const hmacSecret = Deno.env.get("D4SIGN_HMAC_SECRET");
  if (hmacSecret) {
    const header = req.headers.get("content-hmac") ?? "";
    const received = header.replace(/^sha256=/i, "").trim().toLowerCase();
    const expected = await hmacSha256Hex(docUuid, hmacSecret);
    if (!received || !safeEqual(received, expected)) return json({ error: "invalid hmac" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---- só nos interessa o evento "documento finalizado"
  const typePost = String(payload?.type_post ?? "");
  if (typePost !== TYPE_FINISHED) {
    await supabase.from("d4sign_documents").upsert({
      doc_uuid: docUuid,
      document_name: payload?.document_name ?? null,
      status: "IGNORED",
      issue: `evento ignorado (type_post=${typePost || "?"})`,
      raw: payload,
    }, { onConflict: "doc_uuid" });
    return json({ ok: true, action: "ignored", typePost });
  }

  // ---- idempotência: o D4Sign reenvia webhook. Se já demos baixa, para.
  const { data: already } = await supabase
    .from("d4sign_documents").select("doc_uuid, status, matched_client_id")
    .eq("doc_uuid", docUuid).maybeSingle();
  if (already && already.status === "OK") {
    return json({ ok: true, action: "already-processed", clientId: already.matched_client_id });
  }

  // ---- qual signatário é o cliente (o Eduardo não conta)
  const ownerEmails = new Set(
    (Deno.env.get("D4SIGN_OWNER_EMAILS") ?? DEFAULT_OWNER_EMAILS.join(","))
      .split(",").map(normalizeEmail).filter(Boolean),
  );
  const signers: any[] = Array.isArray(payload?.signers) ? payload.signers : [];
  const signer = signers.find((s) => !ownerEmails.has(normalizeEmail(s?.email ?? ""))) ?? signers[0];

  if (!signer) {
    await supabase.from("d4sign_documents").upsert({
      doc_uuid: docUuid, document_name: payload?.document_name ?? null,
      event_datetime: payload?.event_datetime ?? null,
      status: "UNMATCHED", issue: "webhook sem signatário", raw: payload,
    }, { onConflict: "doc_uuid" });
    return json({ error: "no signer" }, 400);
  }

  const signerName: string = signer?.name ?? "";
  const signerEmail: string = normalizeEmail(signer?.email ?? "");
  const signerCpfDigits: string = onlyDigits(signer?.identification_number ?? "");
  const signedAt: string = signer?.signed_at ?? payload?.event_datetime ?? new Date().toISOString();
  const cpfValid = isValidCpf(signerCpfDigits);

  // ---- de quem é este contrato?
  let clientId: string | null = null;
  let matchMethod: string | null = null;

  // a) vínculo já aprendido
  if (signerEmail) {
    const { data: link } = await supabase
      .from("d4sign_client_links").select("client_id").eq("email", signerEmail).maybeSingle();
    if (link?.client_id) { clientId = link.client_id; matchMethod = "link"; }
  }

  const { data: allClients } = await supabase
    .from("clients").select("id, name, email, cpf, status_by_month");
  const clients = allClients ?? [];
  const activeClients = clients.filter(
    (c: any) => !Object.values(c.status_by_month ?? {}).some((s: any) => INACTIVE_STATUSES.has(s?.status)),
  );

  // b) CPF (mesmo entre inativos: é identidade, não atividade)
  if (!clientId && signerCpfDigits) {
    const byCpf = clients.filter((c: any) => onlyDigits(c.cpf ?? "") === signerCpfDigits);
    if (byCpf.length === 1) { clientId = byCpf[0].id; matchMethod = "cpf"; }
  }
  // c) e-mail já cadastrado no cliente
  if (!clientId && signerEmail) {
    const byEmail = clients.filter((c: any) => normalizeEmail(c.email ?? "") === signerEmail);
    if (byEmail.length === 1) { clientId = byEmail[0].id; matchMethod = "email"; }
  }
  // d) 1º+2º nome contra ATIVOS (precisa bater com exatamente 1)
  if (!clientId && signerName) {
    const target = firstTwoNames(signerName);
    if (target) {
      const byName = activeClients.filter((c: any) => firstTwoNames(c.name ?? "") === target);
      if (byName.length === 1) { clientId = byName[0].id; matchMethod = "name"; }
    }
  }

  const issue = cpfValid ? null : `CPF inválido (${formatCpf(signerCpfDigits) || "não informado"})`;

  // e) ninguém bate -> nasce um cliente novo
  let created = false;
  if (!clientId) {
    // Valores do contrato congelados na época, igual o addClient do App.tsx
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
      "bg-slate-300/40 border-slate-400 text-slate-600",
    ];

    const newId = crypto.randomUUID();
    const { error: insErr } = await supabase.from("clients").insert({
      id: newId,
      name: signerName || "(sem nome)",
      phone_digits: "",                       // chega depois, pelo webhook do eAgenda
      start_month_year: monthKeyOf(signedAt), // provisório: mês da assinatura
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
      contract_doc_uuid: docUuid,
      contract_issue: issue,
    });
    if (insErr) return json({ error: `insert client: ${insErr.message}` }, 500);
    clientId = newId;
    matchMethod = "created";
    created = true;
  } else {
    // achou: completa o que faltava, sem sobrescrever o que já existe
    const current = clients.find((c: any) => c.id === clientId) ?? {};
    const patch: Record<string, unknown> = {
      contract_signed: cpfValid,
      contract_signed_at: signedAt,
      contract_doc_uuid: docUuid,
      contract_issue: issue,
    };
    if (!(current as any).email && signerEmail) patch.email = signerEmail;
    if (!(current as any).cpf && signerCpfDigits) patch.cpf = signerCpfDigits;

    const { error: upErr } = await supabase.from("clients").update(patch).eq("id", clientId);
    if (upErr) return json({ error: `update client: ${upErr.message}` }, 500);
  }

  // ---- aprende o e-mail pra próxima vez ser instantânea
  if (signerEmail && clientId) {
    await supabase.from("d4sign_client_links").upsert(
      { email: signerEmail, client_id: clientId, linked_name: signerName },
      { onConflict: "email" },
    );
  }

  // ---- registra tudo (auditoria + triagem)
  const status = cpfValid ? "OK" : "INVALID_CPF";
  await supabase.from("d4sign_documents").upsert({
    doc_uuid: docUuid,
    document_name: payload?.document_name ?? null,
    event_datetime: payload?.event_datetime ?? null,
    signer_name: signerName || null,
    signer_email: signerEmail || null,
    signer_cpf: signerCpfDigits || null,
    signed_at: signedAt,
    cpf_valid: cpfValid,
    status,
    issue,
    matched_client_id: clientId,
    match_method: matchMethod,
    raw: payload,
  }, { onConflict: "doc_uuid" });

  // ---- notifica o Eduardo
  const notifyUrl = Deno.env.get("D4SIGN_NOTIFY_URL");
  if (notifyUrl) {
    const firstName = (signerName || "").split(" ")[0] || "Cliente";
    const message = cpfValid
      ? `${signerName} assinou o contrato. Pode iniciar a consultoria.`
      : `${signerName} assinou o contrato, mas preencheu errado: ${issue}. Avisa ele pra refazer.`;
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const notifyToken = Deno.env.get("D4SIGN_NOTIFY_TOKEN");
      if (notifyToken) headers["authorization"] = `Bearer ${notifyToken}`;
      await fetch(notifyUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          event: cpfValid ? "contract_signed_ok" : "contract_signed_invalid",
          client_id: clientId,
          first_name: firstName,
          full_name: signerName,
          email: signerEmail,
          cpf: formatCpf(signerCpfDigits),
          cpf_valid: cpfValid,
          issue,
          created,
          message,
        }),
      });
    } catch { /* notificação não pode derrubar a baixa do contrato */ }
  }

  return json({
    ok: true,
    action: created ? "client-created" : `matched:${matchMethod}`,
    clientId, cpfValid, issue,
  });
});
