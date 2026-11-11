/**
 * Le service worker de Kipushku : l'appli s'ouvre sans connexion, et tout de suite.
 * Tous les fichiers sont gardés en cache à l'installation ; une nouvelle version (VERSION change à chaque
 * publication) remplace l'ancienne, et la page se recharge. Aucune donnée ne passe par ici : elles sont dans
 * le stockage du navigateur, pas dans le cache.
 */
const VERSION = "kipushku-9c7f094942a8";
const FICHIERS = ["./","index.html","local.js","serveur.js","calcul.js","coffre.js","manifest.webmanifest","icone-192.png","icone-512.png"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // Le cache d'abord (hors connexion, instantané) ; la page elle-même, quelle que soit l'adresse : index.html.
  e.respondWith(caches.match(e.request, { ignoreSearch: true })
    .then((r) => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : null))
    .then((r) => r || fetch(e.request)));
});
