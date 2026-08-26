import { useEffect, useState } from 'react';
import { Bell, BellOff, Smartphone } from 'lucide-react';
import { supabase } from './supabaseClient';

/**
 * Autoriza este aparelho a receber notificação do sistema.
 *
 * POR QUE EXISTE: depois de quatro quedas do canal de WhatsApp em duas
 * semanas, o Eduardo precisava de um aviso que não passasse por terceiro
 * nenhum. Adicionando o sistema à tela de início do iPhone, o push chega
 * como notificação de app — sem App Store, sem TestFlight (que expiraria
 * a cada 90 dias) e sem depender da Meta.
 */

/** A chave pública do VAPID vem do build; sem ela não dá para assinar. */
const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

/** O navegador exige a chave em bytes, não no texto base64url. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normal);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/**
 * No iPhone, push SÓ funciona depois que o site foi adicionado à tela de
 * início. Enquanto estiver aberto no Safari a permissão nem é oferecida —
 * e sem explicar isso, o botão pareceria quebrado.
 */
const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent);

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as any).standalone === true;

type Estado = 'carregando' | 'indisponivel' | 'precisa_instalar' | 'desligado' | 'ligado' | 'negado';

export function PushSetup({ userEmail }: { userEmail?: string }) {
  const [estado, setEstado] = useState<Estado>('carregando');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const avaliar = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        // iPhone no Safari, fora da tela de início, cai aqui.
        setEstado(isIOS() && !isStandalone() ? 'precisa_instalar' : 'indisponivel');
        return;
      }
      if (Notification.permission === 'denied') { setEstado('negado'); return; }

      try {
        const registro = await navigator.serviceWorker.ready;
        const atual = await registro.pushManager.getSubscription();
        setEstado(atual ? 'ligado' : 'desligado');
      } catch {
        setEstado('desligado');
      }
    };
    avaliar();
  }, []);

  const ativar = async () => {
    setErro(null);
    if (!VAPID_PUBLIC) {
      setErro('A chave de notificação não está configurada no site.');
      return;
    }
    setSalvando(true);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') {
        setEstado(permissao === 'denied' ? 'negado' : 'desligado');
        return;
      }

      const registro = await navigator.serviceWorker.ready;
      const inscricao = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC)
      });

      const bruto = inscricao.toJSON() as { endpoint?: string; keys?: Record<string, string> };
      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          endpoint: bruto.endpoint,
          p256dh: bruto.keys?.p256dh,
          auth: bruto.keys?.auth,
          user_email: userEmail ?? null,
          label: navigator.platform || 'aparelho'
        },
        { onConflict: 'endpoint' }
      );

      if (error) { setErro(error.message); return; }
      setEstado('ligado');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui ativar as notificações.');
    } finally {
      setSalvando(false);
    }
  };

  const desativar = async () => {
    setSalvando(true);
    try {
      const registro = await navigator.serviceWorker.ready;
      const atual = await registro.pushManager.getSubscription();
      if (atual) {
        await supabase.from('push_subscriptions')
          .update({ gone_at: new Date().toISOString() })
          .eq('endpoint', atual.endpoint);
        await atual.unsubscribe();
      }
      setEstado('desligado');
    } finally {
      setSalvando(false);
    }
  };

  if (estado === 'carregando' || estado === 'indisponivel') return null;

  const base = 'flex items-start gap-3 p-4 rounded-2xl border text-sm';

  if (estado === 'precisa_instalar') {
    return (
      <div className={`${base} bg-slate-50 border-slate-200 text-slate-600`}>
        <Smartphone className="w-5 h-5 shrink-0 mt-0.5 text-slate-400" />
        <div>
          <p className="font-black text-slate-700">Receba avisos neste iPhone</p>
          <p className="mt-1 leading-relaxed">
            Toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.
            Abra o sistema por esse ícone e o botão de ativar notificações aparece aqui.
          </p>
        </div>
      </div>
    );
  }

  if (estado === 'negado') {
    return (
      <div className={`${base} bg-amber-50 border-amber-200 text-amber-800`}>
        <BellOff className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-black">Notificações bloqueadas neste aparelho</p>
          <p className="mt-1 leading-relaxed">
            O navegador guardou um "não" anterior. Para reverter, é preciso liberar
            nas configurações do site e recarregar a página.
          </p>
        </div>
      </div>
    );
  }

  /**
   * Já ativo vira uma tarja fina.
   *
   * O cartão explicativo faz sentido uma vez, para quem ainda não ativou.
   * Depois disso ele só ocupa o topo da tela todo dia, repetindo algo que
   * a pessoa já sabe — no celular chegava a empurrar a lista de clientes
   * para fora da primeira tela.
   */
  if (estado === 'ligado') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800">
        <Bell className="w-3.5 h-3.5 shrink-0" />
        <span className="text-[11px] font-bold flex-1">Notificações ativas</span>
        <button
          onClick={desativar}
          disabled={salvando}
          className="text-[11px] font-bold underline underline-offset-2 opacity-60 hover:opacity-100"
        >
          {salvando ? '...' : 'desativar'}
        </button>
      </div>
    );
  }

  return (
    <div className={`${base} bg-white border-slate-200 text-slate-600`}>
      <Bell className="w-5 h-5 shrink-0 mt-0.5 text-slate-400" />
      <div className="flex-1">
        <p className="font-black text-slate-700">Receber avisos neste aparelho</p>
        <p className="mt-1 leading-relaxed">
          Cliente agendou, contrato assinado e o resumo do dia — direto aqui,
          sem depender de WhatsApp.
        </p>
        {erro && <p className="mt-2 text-xs font-bold text-red-600">{erro}</p>}
        <button
          onClick={ativar}
          disabled={salvando}
          className="mt-3 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-black transition-colors disabled:opacity-50"
        >
          {salvando ? 'Ativando...' : 'Ativar notificações'}
        </button>
      </div>
    </div>
  );
}
