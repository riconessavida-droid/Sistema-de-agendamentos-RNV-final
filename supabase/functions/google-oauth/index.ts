// =====================================================================
// Edge Function: google-oauth
// Conecta a conta do Google (a mesma que o eAgenda usa hoje) para o
// sistema criar o evento + link do Meet e ler a ocupação da agenda.
//
// Ações:
//   start      -> devolve a URL para onde mandar o Eduardo autorizar
//   callback   -> troca o "code" pelo refresh_token e guarda
//   status     -> { connected, email } (nunca devolve o token)
//   disconnect -> esquece a autorização
//
// Deploy:  verify-jwt LIGADO (só o sistema logado chama esta função).
// Segredos: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Um escopo só, que cobre criar o evento com Meet e ler a ocupação.
const SCOPE = "https://www.googleapis.com/auth/calendar";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// O id do calendário principal É o e-mail da conta. Usar isto em vez do
// endpoint de "userinfo" evita pedir uma permissão a mais só para mostrar
// qual conta ficou conectada.
const PRIMARY_CALENDAR_URL = "https://www.googleapis.com/calendar/v3/calendars/primary";

// O cliente do Supabase (functions.invoke) manda apikey e x-client-info
// além dos óbvios. Faltando qualquer um aqui, o navegador barra a chamada
// no preflight e o erro aparece como "CORS policy" no console.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS }
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const action: string = payload?.action ?? "";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ---------------------------------------------------------------- start
  if (action === "start") {
    if (!clientId) return json({ ok: false, error: "missing_client_id" }, 400);

    const redirectUri: string = payload?.redirectUri ?? "";
    if (!redirectUri.startsWith("https://")) {
      return json({ ok: false, error: "invalid_redirect" }, 400);
    }

    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    // offline + consent garantem que o refresh_token venha (sem eles, o
    // Google só manda na primeiríssima autorização e nunca mais).
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");

    return json({ ok: true, url: url.toString() });
  }

  // ------------------------------------------------------------- callback
  if (action === "callback") {
    if (!clientId || !clientSecret) return json({ ok: false, error: "missing_credentials" }, 400);

    const code: string = payload?.code ?? "";
    const redirectUri: string = payload?.redirectUri ?? "";
    if (!code) return json({ ok: false, error: "missing_code" }, 400);

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok || !tokens.refresh_token) {
      // Sem refresh_token normalmente significa que a conta já autorizou
      // antes: é preciso remover o acesso em myaccount.google.com e
      // autorizar de novo, ou usar prompt=consent (que já usamos).
      return json({
        ok: false,
        error: "no_refresh_token",
        detail: tokens.error_description ?? tokens.error ?? null
      }, 400);
    }

    let email: string | null = null;
    try {
      const info = await fetch(PRIMARY_CALENDAR_URL, {
        headers: { authorization: `Bearer ${tokens.access_token}` }
      });
      if (info.ok) email = (await info.json())?.id ?? null;
    } catch { /* o e-mail é só informativo */ }

    const { error } = await supabase.from("google_credentials").upsert({
      id: 1,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token ?? null,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      connected_email: email,
      last_error: null
    }, { onConflict: "id" });

    if (error) return json({ ok: false, error: "save_failed", detail: error.message }, 500);
    return json({ ok: true, email });
  }

  // --------------------------------------------------------------- status
  if (action === "status") {
    const { data } = await supabase
      .from("google_credentials")
      .select("connected_email, last_error, updated_at")
      .eq("id", 1)
      .maybeSingle();

    return json({
      ok: true,
      connected: !!data,
      email: data?.connected_email ?? null,
      lastError: data?.last_error ?? null,
      updatedAt: data?.updated_at ?? null
    });
  }

  // ----------------------------------------------------------- disconnect
  if (action === "disconnect") {
    await supabase.from("google_credentials").delete().eq("id", 1);
    return json({ ok: true });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
});
