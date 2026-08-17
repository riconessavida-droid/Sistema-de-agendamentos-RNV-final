// =====================================================================
// Edge Function: send-email
//
// O único lugar do sistema que fala com o provedor de e-mail (Resend) e
// o único que sabe como um e-mail da RNV se parece.
//
// POR QUE CENTRALIZAR: o motor de horários já vive duplicado em dois
// arquivos porque não há CLI do Supabase para compartilhar código, e isso
// custa caro em manutenção. Com o e-mail seria pior — layout, remetente e
// tratamento de erro repetidos em quatro funções. Aqui as outras mandam
// só o TIPO e os DADOS; o texto e o desenho ficam neste arquivo.
//
// Chamada:
//   POST { template, to, data: {...} }
//   POST { template, to, data, dryRun: true }   -> devolve o HTML, não envia
//
// Templates:
//   confirmacao        cliente acabou de agendar
//   cobranca7          está na hora de marcar a próxima
//   cobranca3          ainda sem data, mais direto
//   vespera            a reunião é amanhã
//   resumo             o dia seguinte do Eduardo (admin)
//   contrato_ok        contrato assinado (admin)
//   contrato_pendente  contrato parado sem assinar (admin)
//
// Deploy:  Verify JWT LIGADO (só as nossas funções chamam).
// Segredos:
//   RESEND_API_KEY  (obrigatório; sem ele a função entra em dry-run)
//   MAIL_FROM       ex.: RNV Consultoria <contato@send.rnvconsultoria.com>
//   MAIL_REPLY_TO   (opcional) para onde vai a resposta do cliente
//   SITE_URL        endereço público do sistema
// =====================================================================

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const VERDE = "#0E4C45";
const DOURADO = "#F0B429";
const TEXTO = "#1f2937";
const CINZA = "#6b7280";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    },
  });

const clean = (v) => String(v ?? "").trim();

/** E-mail não é navegador: nada de CSS externo, tudo inline e em tabela. */
function layout({ titulo, corpo, botao, rodape }) {
  const botaoHtml = botao
    ? `
      <tr>
        <td style="padding: 8px 0 28px;">
          <a href="${botao.url}"
             style="display:inline-block; background:${DOURADO}; color:#1a1a1a;
                    font-weight:700; font-size:16px; text-decoration:none;
                    padding:14px 28px; border-radius:8px;">
            ${botao.texto}
          </a>
        </td>
      </tr>`
    : "";

  const rodapeHtml = rodape
    ? `<p style="margin:0 0 6px; color:${CINZA}; font-size:13px; line-height:1.6;">${rodape}</p>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0; padding:0; background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6; padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px; background:#ffffff; border-radius:14px; overflow:hidden;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">

        <tr>
          <td style="background:${VERDE}; padding:18px 28px;">
            <span style="color:#ffffff; font-size:15px; font-weight:700; letter-spacing:.4px;">
              RNV Consultoria
            </span>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 28px 0;">
            <h1 style="margin:0 0 18px; color:${TEXTO}; font-size:21px; line-height:1.35; font-weight:700;">
              ${titulo}
            </h1>
          </td>
        </tr>

        <tr>
          <td style="padding:0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="color:${TEXTO}; font-size:16px; line-height:1.65; padding-bottom:20px;">
                  ${corpo}
                </td>
              </tr>
              ${botaoHtml}
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:8px 28px 28px; border-top:1px solid #e5e7eb;">
            <div style="padding-top:16px;">
              ${rodapeHtml}
              <p style="margin:0; color:${CINZA}; font-size:13px; line-height:1.6;">
                Eduardo Stetner · RNV Consultoria
              </p>
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const p = (texto) => `<p style="margin:0 0 14px;">${texto}</p>`;
const forte = (t) => `<strong style="color:${TEXTO};">${t}</strong>`;

// ---------------------------------------------------------------------
// Os textos. Aprovados pelo Eduardo antes de virarem código.
// ---------------------------------------------------------------------
const TEMPLATES = {
  confirmacao: (d) => ({
    subject: `Reunião confirmada — ${d.meeting_label}`,
    titulo: "Sua reunião está confirmada",
    corpo:
      p(`Olá, ${d.first_name}!`) +
      p(`Sua reunião de consultoria está confirmada para ${forte(d.meeting_label)}.`) +
      (d.meet_url ? "" : p("O link da videochamada chega junto com o convite do Google Agenda.")),
    botao: d.meet_url ? { texto: "Entrar na reunião", url: d.meet_url } : null,
    rodape: "Precisa remarcar? É só responder este e-mail.",
  }),

  cobranca7: (d) => ({
    subject: "Vamos marcar sua próxima consultoria?",
    titulo: "Hora de marcar a próxima conversa",
    corpo:
      p(`Olá, ${d.first_name}!`) +
      p("Já faz quase um mês desde a nossa última conversa, e é hora de marcar a próxima.") +
      p("São poucos minutos para escolher o dia e o horário que funcionam melhor para você."),
    botao: { texto: "Escolher meu horário", url: d.booking_url },
    rodape: "O link é pessoal e já reconhece você — não precisa preencher nada.",
  }),

  cobranca3: (d) => ({
    subject: "Sua próxima consultoria ainda está sem data",
    titulo: "Ainda não vi o seu agendamento",
    corpo:
      p(`Olá, ${d.first_name}!`) +
      p("Sua próxima reunião de consultoria ainda está sem data marcada.") +
      p("Os horários costumam fechar rápido — vale escolher o seu agora."),
    botao: { texto: "Escolher meu horário", url: d.booking_url },
    rodape: "O link é pessoal e já reconhece você — não precisa preencher nada.",
  }),

  vespera: (d) => ({
    subject: `Sua reunião é amanhã às ${d.meeting_time}`,
    titulo: "Sua reunião é amanhã",
    corpo:
      p(`Olá, ${d.first_name}!`) +
      p(`Passando para lembrar da nossa reunião ${forte(d.meeting_label)}.`) +
      p("Separe seus números atualizados — a conversa rende bem mais quando eles já estão à mão."),
    botao: d.meet_url ? { texto: "Entrar na reunião", url: d.meet_url } : null,
    rodape: "Se precisar remarcar, responda este e-mail o quanto antes.",
  }),

  // ------------------------------------------------- internos (Eduardo)
  resumo: (d) => ({
    subject: `Amanhã: ${d.meeting_count} ${Number(d.meeting_count) === 1 ? "reunião" : "reuniões"} (${d.first_time} às ${d.last_time})`,
    titulo: `Amanhã você tem ${d.meeting_count} ${Number(d.meeting_count) === 1 ? "reunião" : "reuniões"}`,
    corpo:
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; margin:0 0 8px;">` +
      (d.meetings ?? [])
        .map(
          (m) => `<tr>
            <td style="padding:9px 0; border-bottom:1px solid #f3f4f6; width:74px; color:${VERDE}; font-weight:700; font-size:15px;">${m.time}</td>
            <td style="padding:9px 0; border-bottom:1px solid #f3f4f6; color:${TEXTO}; font-size:15px;">${m.name}${
            m.contract_pending
              ? ` <span style="color:#b45309; font-size:13px;">· contrato pendente</span>`
              : ""
          }</td>
          </tr>`,
        )
        .join("") +
      `</table>`,
    botao: d.day_url ? { texto: "Abrir a lista do dia", url: d.day_url } : null,
    rodape: null,
  }),

  contrato_ok: (d) => ({
    subject: `${d.full_name} assinou o contrato`,
    titulo: "Contrato assinado",
    corpo:
      p(`${forte(d.full_name)} acabou de assinar o contrato.`) +
      p(d.status_line) +
      (d.cpf ? p(`<span style="color:${CINZA}; font-size:14px;">CPF conferido: ${d.cpf}</span>`) : ""),
    botao: d.pdf_url ? { texto: "Ver o contrato", url: d.pdf_url } : null,
    rodape: null,
  }),

  contrato_pendente: (d) => ({
    subject: `Contrato pendente — ${d.full_name}`,
    titulo: "Contrato ainda não assinado",
    corpo: p(`${forte(d.full_name)} ainda não assinou o contrato.`) + p(d.status_line),
    botao: null,
    rodape: null,
  }),
};

// =====================================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
        "access-control-allow-methods": "POST, OPTIONS",
      },
    });
  }
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "corpo inválido" }, 400);
  }

  const templateName = clean(body?.template);
  const to = clean(body?.to);
  const data = body?.data ?? {};

  const build = TEMPLATES[templateName];
  if (!build) return json({ ok: false, error: `template desconhecido: ${templateName || "(vazio)"}` }, 400);
  if (!to || !to.includes("@")) return json({ ok: false, error: `destinatário inválido: ${to || "(vazio)"}` }, 400);

  const montado = build(data);
  const html = layout(montado);

  const apiKey = clean(Deno.env.get("RESEND_API_KEY"));
  const from = clean(Deno.env.get("MAIL_FROM")) || "RNV Consultoria <contato@send.rnvconsultoria.com>";
  const replyTo = clean(Deno.env.get("MAIL_REPLY_TO"));

  // Sem chave, ou a pedido: mostra o que sairia e não envia. É assim que
  // se confere um texto novo sem gastar envio nem incomodar cliente.
  const dryRun = body?.dryRun === true || !apiKey;
  if (dryRun) {
    return json({
      ok: true,
      dryRun: true,
      reason: apiKey ? "pedido no corpo" : "RESEND_API_KEY não configurada",
      to, from, subject: montado.subject, html,
    });
  }

  const payload = { from, to: [to], subject: montado.subject, html };
  if (replyTo) payload.reply_to = replyTo;

  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();

    // O Resend responde 200 com o id da mensagem. Qualquer outra coisa é
    // falha de verdade — e falha precisa aparecer, não virar "enviado".
    if (!resp.ok) {
      return json({ ok: false, error: `Resend HTTP ${resp.status}`, detail: text.slice(0, 300) }, 502);
    }

    let id = null;
    try { id = JSON.parse(text)?.id ?? null; } catch { /* resposta sem id */ }

    return json({ ok: true, id, to, subject: montado.subject });
  } catch (e) {
    return json({ ok: false, error: String(e?.message ?? e) }, 502);
  }
});
