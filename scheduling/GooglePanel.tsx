import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy, Link2, Loader2, Unplug } from 'lucide-react';
import { supabase } from '../supabaseClient';

type Status = {
  connected: boolean;
  email: string | null;
  lastError: string | null;
};

export const googleRedirectUri = () => `${window.location.origin}/google-callback`;

const callGoogle = async (action: string, body: Record<string, unknown> = {}) => {
  const { data, error } = await supabase.functions.invoke('google-oauth', {
    body: { action, ...body }
  });
  if (error) return { ok: false, error: error.message } as const;
  return data as any;
};

interface GooglePanelProps {
  canEdit: boolean;
}

export function GooglePanel({ canEdit }: GooglePanelProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const redirectUri = googleRedirectUri();

  const load = async () => {
    const response = await callGoogle('status');
    setLoading(false);
    if (response?.ok) {
      setStatus({
        connected: response.connected,
        email: response.email,
        lastError: response.lastError
      });
    } else {
      setMessage('Não consegui verificar a conexão. A função google-oauth já foi publicada?');
    }
  };

  useEffect(() => { load(); }, []);

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    const response = await callGoogle('start', { redirectUri });
    setBusy(false);

    if (!response?.ok) {
      // Mostra o motivo real: um erro genérico aqui manda você procurar no
      // lugar errado (já aconteceu com um problema de CORS).
      setMessage(
        response?.error === 'missing_client_id'
          ? 'Falta cadastrar o segredo GOOGLE_CLIENT_ID no Supabase.'
          : `Não consegui falar com a função google-oauth: ${response?.error ?? 'erro desconhecido'}`
      );
      return;
    }
    window.location.href = response.url;
  };

  const disconnect = async () => {
    setBusy(true);
    await callGoogle('disconnect');
    setBusy(false);
    await load();
  };

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage('Não consegui copiar. Selecione o endereço e copie na mão.');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-600">
          Google Agenda e Meet
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Conectado, o sistema cria o link do Meet, põe a reunião na sua agenda e
          deixa de oferecer horário em que você já tem compromisso.
        </p>
      </div>

      <div className="px-4 py-4 space-y-4">
        {loading ? (
          <div className="py-8 flex items-center justify-center gap-2 text-slate-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Verificando…
          </div>
        ) : status?.connected ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                {status.email
                  ? <>Conectado como <strong>{status.email}</strong>.</>
                  : <>Conectado à sua conta Google.</>}
              </span>
            </div>

            {status.lastError && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  <strong>O Google recusou o último acesso.</strong> Normalmente é a
                  autorização que foi revogada — clique em desconectar e conecte de novo.
                  <span className="block mt-1 text-xs opacity-75">{status.lastError}</span>
                </span>
              </div>
            )}

            {canEdit && (
              <button
                onClick={disconnect}
                disabled={busy}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-600 text-sm font-semibold transition-colors"
              >
                <Unplug className="w-4 h-4" /> Desconectar
              </button>
            )}
          </>
        ) : (
          <>
            <div className="px-3 py-2.5 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-900 text-sm">
              Ainda não conectado. Enquanto isso, os agendamentos funcionam
              normalmente — só não geram link de videochamada.
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Endereço de retorno (cole no Google Cloud)
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600">
                  {redirectUri}
                </code>
                <button
                  onClick={copyRedirect}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition-colors shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                No Google Cloud, esse endereço vai em <strong>URIs de redirecionamento
                autorizados</strong> da credencial OAuth.
              </p>
            </div>

            {canEdit && (
              <button
                onClick={connect}
                disabled={busy}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-white text-sm font-bold transition-colors"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                Conectar minha conta Google
              </button>
            )}
          </>
        )}

        {message && <p className="text-sm text-red-600 font-semibold">{message}</p>}
      </div>
    </div>
  );
}

/**
 * Tela de retorno do Google (/google-callback). Fica fora do sistema
 * logado só para pegar o `code` da URL e mandar para a Edge Function,
 * que é quem guarda o token.
 */
export function GoogleCallbackPage() {
  const [state, setState] = useState<'working' | 'ok' | 'fail'>('working');
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    if (error || !code) {
      setState('fail');
      setDetail(error === 'access_denied' ? 'Você recusou a autorização.' : error);
      return;
    }

    callGoogle('callback', { code, redirectUri: googleRedirectUri() }).then(response => {
      if (response?.ok) {
        setState('ok');
        setDetail(response.email ?? null);
        return;
      }
      setState('fail');
      setDetail(
        response?.error === 'no_refresh_token'
          ? 'O Google não devolveu a autorização permanente. Remova o acesso do app em myaccount.google.com/permissions e tente de novo.'
          : (response?.detail ?? response?.error ?? 'Erro desconhecido')
      );
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 max-w-md w-full text-center space-y-3">
        {state === 'working' && (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-slate-300 mx-auto" />
            <p className="text-slate-500 text-sm">Conectando com o Google…</p>
          </>
        )}
        {state === 'ok' && (
          <>
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <h1 className="text-lg font-black text-slate-800">Google conectado!</h1>
            {detail && <p className="text-sm text-slate-500">{detail}</p>}
            <a
              href="/"
              className="inline-block mt-2 px-4 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-bold"
            >
              Voltar ao sistema
            </a>
          </>
        )}
        {state === 'fail' && (
          <>
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
            <h1 className="text-lg font-black text-slate-800">Não deu certo</h1>
            {detail && <p className="text-sm text-slate-500">{detail}</p>}
            <a
              href="/"
              className="inline-block mt-2 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-bold"
            >
              Voltar ao sistema
            </a>
          </>
        )}
      </div>
    </div>
  );
}
