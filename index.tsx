
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BookingPage } from './scheduling/BookingPage';
import { ManageBookingPage } from './scheduling/ManageBookingPage';
import { GoogleCallbackPage } from './scheduling/GooglePanel';

/**
 * Registra o service worker — a peça que recebe notificação quando o
 * sistema está fechado. Falhar aqui não pode derrubar o app: sem ele o
 * sistema funciona igual, só não avisa nada no celular.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* navegador sem suporte ou modo privado: segue sem push */
    });
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/**
 * Roteamento mínimo, sem biblioteca: o sistema é uma tela só atrás de
 * login, e as únicas rotas PÚBLICAS são as do agendamento.
 *
 *   /agendar          link geral (quem ainda não é cliente)
 *   /agendar/<token>  link pessoal do cliente
 *   /r/<token>        página "sua reunião" (videochamada e cancelamento)
 *
 * Qualquer outro caminho cai no sistema normal.
 */
function pickPage() {
  const segments = window.location.pathname.split('/').filter(Boolean);

  if (segments[0] === 'agendar') {
    return <BookingPage token={segments[1] ?? null} />;
  }
  if (segments[0] === 'r' && segments[1]) {
    return <ManageBookingPage manageToken={segments[1]} />;
  }
  if (segments[0] === 'google-callback') {
    return <GoogleCallbackPage />;
  }
  // /dia/2026-08-13 — o link do resumo das 21h. Abre o sistema (com login)
  // direto na Lista do Dia daquele dia.
  if (segments[0] === 'dia' && /^\d{4}-\d{2}-\d{2}$/.test(segments[1] ?? '')) {
    return <App initialDay={segments[1]} />;
  }
  return <App />;
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {pickPage()}
  </React.StrictMode>
);
