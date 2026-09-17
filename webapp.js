'use strict';
(() => {
  const localPreview = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const secureEnough = location.protocol === 'https:' || localPreview;

  // SM-100/SM-101 renderer boundary. game.js remains the v1.2.3 compatibility
  // producer. Shared transform interposition is installed first; if Game already
  // constructed, it refreshes the static descriptor cache without changing
  // coordinates. RenderScene capture is then canonicalized before WebGL2 replay.
  const renderSceneReady = import('./engine/render_transform.js?v=sm101-1')
    .then(() => import('./engine/render_transform_integration.js?v=sm101-1'))
    .then(() => import('./engine/render_scene.js?v=sm100-1'))
    .then(() => import('./engine/render_transform_scene_adapter.js?v=sm101-1'))
    .then(() => import('./engine/webgl2_scene_adapter.js?v=sm100-1'))
    .then(() => globalThis.SteelMothWebGL2SceneAdapter?.installWhenGameAvailable?.(globalThis) || null)
    .catch(err => {
      globalThis.steelMothRenderSceneBridgeError = String(err?.stack || err);
      console.warn('Render Scene/transform compatibility bridge unavailable; continuing with direct WebGL2.', err);
      return null;
    });
  globalThis.steelMothRenderSceneReady = renderSceneReady;

  async function clearLocalPreviewCaches(){
    if(!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    try{
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }catch(err){ console.warn('Local service-worker unregister failed:', err); }
    try{
      if('caches' in window){
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('small-machine-web-')).map(k => caches.delete(k)));
      }
    }catch(err){ console.warn('Local cache cleanup failed:', err); }
    if(hadController && !sessionStorage.getItem('steel-moth-local-sw-cleared-v123')){
      sessionStorage.setItem('steel-moth-local-sw-cleared-v123','1');
      location.reload();
    }
  }

  if(localPreview){
    window.addEventListener('load', clearLocalPreviewCaches, {once:true});
    return;
  }

  if('serviceWorker' in navigator && secureEnough){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=1.2.3', {scope:'./', updateViaCache:'none'}).catch(err => {
        console.warn('Offline cache unavailable:', err);
      });
    }, {once:true});
  }
})();
