'use strict';
const CACHE = 'small-machine-web-v1.2.3-r3';
const CORE = [
  './index.html', './style.css?v=1.2.3', './webapp.js?v=1.2.3', './manifest.webmanifest',
  './engine/game.js?v=1.2.3', './engine/editor.js?v=1.2.3', './engine/foliagefx.js?v=1.2.3', './engine/surfacefx.js?v=1.2.3',
  './engine/render_transform.js?v=sm101-1', './engine/render_transform_integration.js?v=sm101-1',
  './engine/render_scene.js?v=sm100-1', './engine/render_transform_scene_adapter.js?v=sm101-1', './engine/webgl2_scene_adapter.js?v=sm100-1',
  './engine/webgpu_device.js?v=sm102-1', './engine/webgpu_resources.js?v=sm103-1', './engine/backend_runtime.js?v=sm102-1',
  './game_data/maps.json', './game_data/story.json', './game_data/sprites.json',
  './game_data/luts.json', './game_data/effects.json', './assets/generated/atlas.json'
];
const abs = p => new URL(p, self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE.map(abs))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('small-machine-web-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isImage = /\.(?:png|webp|jpe?g)$/i.test(url.pathname);
  if (isImage) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }
  event.respondWith(fetch(req).then(res => {
    if (res.ok) caches.open(CACHE).then(cache => cache.put(req, res.clone()));
    return res;
  }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match(abs('./index.html')) : undefined))));
});
