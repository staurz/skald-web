/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true" />
/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', () => sw.skipWaiting());
sw.addEventListener('activate', (e) => e.waitUntil(sw.clients.claim()));

// Web Push handler — wired up properly in the alerts task.
sw.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json() as { title: string; body: string; tag?: string };
  event.waitUntil(
    sw.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/icon-192.png',
    }),
  );
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(sw.clients.openWindow('/'));
});
