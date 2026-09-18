'use strict';
const CACHE = 'small-machine-web-v1.2.3-r19';
const CORE = [
  './index.html', './style.css?v=1.2.3', './webapp.js?v=1.2.3', './manifest.webmanifest',
  './engine/game.js?v=1.2.3', './engine/editor.js?v=1.2.3', './engine/foliagefx.js?v=1.2.3', './engine/surfacefx.js?v=1.2.3',
  './engine/render_transform.js?v=sm101-1', './engine/render_transform_integration.js?v=sm101-1',
  './engine/render_scene.js?v=sm100-1', './engine/render_transform_scene_adapter.js?v=sm101-1', './engine/webgl2_scene_adapter.js?v=sm100-1',
  './engine/webgpu_device.js?v=sm102-1', './engine/webgpu_resources.js?v=sm103-1', './engine/pseudo_depth.js?v=sm201-1',
  './engine/webgpu_gbuffer.js?v=sm200-1', './engine/webgpu_ownership.js?v=sm202-1', './engine/webgpu_depth_hierarchy.js?v=sm203-1', './engine/webgpu_lighting.js?v=sm204-1', './engine/webgpu_local_shadows.js?v=sm205-1', './engine/webgpu_transparent_fx.js?v=sm206-1', './engine/webgpu_post.js?v=sm207-1', './engine/webgpu_occluders.js?v=sm300-1', './engine/webgpu_clusters.js?v=sm301-1', './engine/webgpu_dominance.js?v=sm302-1', './engine/webgpu_dso.js?v=sm303-1', './engine/webgpu_dso_hierarchy.js?v=sm304-1', './engine/webgpu_dark_bloom.js?v=sm305-1', './engine/webgpu_dark_bloom_temporal.js?v=sm306-1', './engine/webgpu_visibility.js?v=sm307-1', './engine/webgpu_water.js?v=sm400-1', './engine/backend_runtime.js?v=sm102-1',
  './game_data/maps.json', './game_data/story.json', './game_data/sprites.json',
  './game_data/luts.json', './game_data/effects.json', './assets/generated/atlas.json'
];
const abs = p => new URL(p, self.registration.scope).href;
self.addEventListener('install', event => {event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE.map(abs))).then(() => self.skipWaiting()));});
self.addEventListener('activate', event => {event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('small-machine-web-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));});
self.addEventListener('fetch', event => {const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url);if(url.origin!==self.location.origin)return;const isImage=/\.(?:png|webp|jpe?g)$/i.test(url.pathname);if(isImage){event.respondWith(caches.open(CACHE).then(async cache=>{const hit=await cache.match(req);if(hit)return hit;const res=await fetch(req);if(res.ok)cache.put(req,res.clone());return res;}));return;}event.respondWith(fetch(req).then(res=>{if(res.ok)caches.open(CACHE).then(cache=>cache.put(req,res.clone()));return res;}).catch(()=>caches.match(req).then(hit=>hit||(req.mode==='navigate'?caches.match(abs('./index.html')):undefined))));});
