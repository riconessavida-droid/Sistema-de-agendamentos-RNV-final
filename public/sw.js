/* =====================================================================
 * Service worker do RNV Consultoria.
 *
 * Existe por um motivo só: receber notificação push quando o sistema está
 * fechado. É o que permite o Eduardo saber que um cliente agendou ou
 * assinou contrato sem depender de WhatsApp — depois de quatro quedas de
 * canal em duas semanas, ter um aviso que não passa por terceiro nenhum
 * deixou de ser conforto e virou necessidade.
 *
 * NÃO faz cache de nada de propósito. O sistema lida com agenda e
 * contratos: mostrar uma versão velha da tela seria pior que não abrir.
 * ===================================================================== */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'RNV Consultoria', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'RNV Consultoria';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || undefined,
    // Notificação do mesmo assunto substitui a anterior em vez de empilhar
    // (três avisos do mesmo contrato viram um), mas ainda vibra.
    renotify: Boolean(payload.tag),
    data: { url: payload.url || '/' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || '/';

  // Se o app já está aberto numa aba, foca nela em vez de abrir outra.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
      for (const cliente of lista) {
        if ('focus' in cliente) {
          cliente.navigate(destino);
          return cliente.focus();
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
