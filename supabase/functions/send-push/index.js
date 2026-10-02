// =====================================================================
// Edge Function: send-push
//
// Manda notificação para os aparelhos que o Eduardo autorizou. É o único
// canal de aviso que não depende de terceiro nenhum: nem da Meta, nem do
// papo.ai, nem de ele lembrar de abrir o e-mail.
//
// Chamada:
//   POST { title, body, url?, tag? }
//
// Deploy:  Verify JWT LIGADO (só as nossas funções e a tela chamam).
// Segredos:
//   VAPID_PUBLIC_KEY   chave pública (a mesma que a tela usa ao assinar)
//   VAPID_PRIVATE_KEY  chave privada
//   VAPID_SUBJECT      "mailto:riconessavida@gmail.com"
//
// Sem as chaves, diz o que falta em vez de fingir que enviou — a lição do
// log de WhatsApp que dava tudo por entregue durante cinco dias.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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

  const publicKey = clean(Deno.env.get("VAPID_PUBLIC_KEY"));
  const privateKey = clean(Deno.env.get("VAPID_PRIVATE_KEY"));
  const subject = clean(Deno.env.get("VAPID_SUBJECT")) || "mailto:riconessavida@gmail.com";

  if (!publicKey || !privateKey) {
    return json({ ok: false, error: "faltam os segredos VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY" }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "corpo inválido" }, 400);
  }

  const title = clean(body?.title);
  if (!title) return json({ ok: false, error: "title é obrigatório" }, 400);

  const payload = JSON.stringify({
    title,
    body: clean(body?.body),
    url: clean(body?.url) || "/",
    tag: clean(body?.tag) || undefined,
  });

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  );

  const { data: todos, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, label, user_email")
    .is("gone_at", null);

  if (error) return json({ ok: false, error: error.message }, 500);
  if (!todos || todos.length === 0) {
    return json({ ok: true, enviados: 0, note: "nenhum aparelho autorizado ainda" });
  }

  /**
   * "toEmails" escolhe para QUEM vai o aviso.
   *
   * Sem ele, vai para todos os aparelhos — é assim que o resumo do dia, o
   * contrato assinado e o novo agendamento chegam ao Eduardo e à Giane.
   * Com ele, só quem está na lista recebe: o lembrete de meia hora antes
   * de cada reunião é do Eduardo, e tocar no celular da Giane a cada
   * reunião dele seria barulho.
   *
   * A comparação ignora maiúsculas: o e-mail do aparelho foi gravado do
   * jeito que o navegador tinha, e o da lista vem de um segredo digitado
   * à mão.
   */
  const paraQuem = Array.isArray(body?.toEmails)
    ? body.toEmails.map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean)
    : [];

  const inscritos = paraQuem.length
    ? todos.filter((i) => paraQuem.includes(String(i.user_email ?? "").trim().toLowerCase()))
    : todos;

  if (inscritos.length === 0) {
    // Não cai de volta para "manda para todos": seria o oposto do pedido.
    return json({
      ok: true, enviados: 0, encontrados: 0,
      note: "nenhum aparelho dos destinatários pedidos"
    });
  }

  let enviados = 0;
  const falhas = [];

  for (const inscrito of inscritos) {
    try {
      await webpush.sendNotification(
        {
          endpoint: inscrito.endpoint,
          keys: { p256dh: inscrito.p256dh, auth: inscrito.auth },
        },
        payload,
      );
      enviados++;
      await supabase.from("push_subscriptions")
        .update({ last_ok_at: new Date().toISOString() }).eq("id", inscrito.id);
    } catch (e) {
      const status = e?.statusCode ?? 0;

      // 404/410 = o aparelho desinstalou ou revogou a permissão. Marcar em
      // vez de apagar: quando alguém perguntar "por que parei de receber?",
      // a resposta fica escrita.
      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions")
          .update({ gone_at: new Date().toISOString() }).eq("id", inscrito.id);
        falhas.push({ label: inscrito.label, motivo: "aparelho não aceita mais (removido)" });
      } else {
        falhas.push({
          label: inscrito.label,
          motivo: `HTTP ${status}: ${String(e?.message ?? e).slice(0, 120)}`,
        });
      }
    }
  }

  return json({ ok: true, enviados, total: inscritos.length, falhas });
});
