// SW minimal pour installabilité, sans offline caching
self.addEventListener('install', ()=> self.skipWaiting());
self.addEventListener('activate', (e)=> e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', ()=> { /* no-op: pas de mise en cache */ });

