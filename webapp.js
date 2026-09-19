'use strict';
(() => {
  const localPreview = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const secureEnough = location.protocol === 'https:' || localPreview;
  const params = new URLSearchParams(location.search);
  // Deterministic render-test only: reproduce the immediately-pre-SM-101 SM-100
  // boundary so CI can capture before/after WebGL2 pixels from one checkout.
  // Normal gameplay can never enter this path without renderTest=1.
  const renderTransformBaseline = /^(1|true|yes|on)$/i.test(params.get('renderTransformBaseline')||'') && /^(1|true|yes|on)$/i.test(params.get('renderTest')||params.get('render_test')||'');

  // SM-100/SM-101 renderer boundary. game.js remains the v1.2.3 compatibility
  // producer. Shared transform interposition is installed first; if Game already
  // constructed, it refreshes the static descriptor cache without changing
  // coordinates. RenderScene capture is then canonicalized before WebGL2 replay.
  const renderSceneReady = (renderTransformBaseline
    ? import('./engine/render_scene.js?v=sm100-1')
    : import('./engine/render_transform.js?v=sm101-1')
      .then(() => import('./engine/render_transform_integration.js?v=sm101-1'))
      .then(() => import('./engine/render_scene.js?v=sm100-1'))
      .then(() => import('./engine/render_transform_scene_adapter.js?v=sm101-1')))
    .then(() => import('./engine/webgl2_scene_adapter.js?v=sm100-1'))
    .then(() => globalThis.SteelMothWebGL2SceneAdapter?.installWhenGameAvailable?.(globalThis) || null)
    .catch(err => {
      globalThis.steelMothRenderSceneBridgeError = String(err?.stack || err);
      console.warn('Render Scene/transform compatibility bridge unavailable; continuing with direct WebGL2.', err);
      return null;
    });
  globalThis.steelMothRenderSceneReady = renderSceneReady;
  globalThis.steelMothRenderTransformBaseline = renderTransformBaseline;

  // SM-102/103 platform/resource lifecycle plus the Material-v2 representation
  // chain through SM-207 post, SM-300 bounded occluder preparation, SM-301
  // stable geometry-only clustering, SM-302 stable per-light dominant ownership,
  // SM-303 tile-local DSO hard macro occlusion, SM-304 projected-throw
  // near/mid/far silhouette hierarchy, SM-305 reduced-resolution bounded
  // depth-aware Dark Bloom, SM-306 low-frequency soft-history stabilization,
  // SM-307 bounded DSO/self/contact/Bloom/AO visibility composition, SM-400
  // canonical-light/depth/visibility water staging, SM-401 rooted foliage /
  // Fine Grass staging, SM-402 explicit transparent/procedural/post ordering,
  // SM-403 editor invalidation, SM-404 room/resize/backend invalidation, and
  // SM-501 static bounded quality policy against the same production render
  // state. Auto remains WebGL2 until SM-505; staged WebGPU modules do not
  // change presentation.
  const backendReady = import('./engine/webgpu_device.js?v=sm102-1')
    .then(() => import('./engine/webgpu_resources.js?v=sm103-1'))
    .then(() => import('./engine/pseudo_depth.js?v=sm201-1'))
    .then(() => import('./engine/webgpu_gbuffer.js?v=sm200-1'))
    .then(() => import('./engine/webgpu_ownership.js?v=sm202-1'))
    .then(() => import('./engine/webgpu_depth_hierarchy.js?v=sm203-1'))
    .then(() => import('./engine/webgpu_lighting.js?v=sm204-1'))
    .then(() => import('./engine/webgpu_local_shadows.js?v=sm205-1'))
    .then(() => import('./engine/webgpu_transparent_fx.js?v=sm206-1'))
    .then(() => import('./engine/webgpu_post.js?v=sm207-1'))
    .then(() => import('./engine/webgpu_occluders.js?v=sm300-1'))
    .then(() => import('./engine/webgpu_clusters.js?v=sm301-1'))
    .then(() => import('./engine/webgpu_dominance.js?v=sm302-1'))
    .then(() => import('./engine/webgpu_dso.js?v=sm303-1'))
    .then(() => import('./engine/webgpu_dso_hierarchy.js?v=sm304-1'))
    .then(() => import('./engine/webgpu_dark_bloom.js?v=sm305-1'))
    .then(() => import('./engine/webgpu_dark_bloom_temporal.js?v=sm306-1'))
    .then(() => import('./engine/webgpu_visibility.js?v=sm307-1'))
    .then(() => import('./engine/webgpu_water.js?v=sm400-1'))
    .then(() => import('./engine/webgpu_foliage.js?v=sm401-1'))
    .then(() => import('./engine/webgpu_ordering.js?v=sm402-1'))
    .then(() => import('./engine/webgpu_quality.js?v=sm501-1'))
    .then(() => globalThis.SteelMothWebGPUQuality?.installRuntimeIntegration?.(globalThis) || null)
    .then(() => import('./engine/webgpu_editor_state.js?v=sm403-1'))
    .then(() => globalThis.SteelMothWebGPUEditorState?.installWhenEditorAvailable?.(globalThis) || null)
    .then(() => import('./engine/backend_runtime.js?v=sm102-1'))
    .then(() => globalThis.SteelMothBackendRuntime?.install?.(globalThis) || null)
    .then(() => import('./engine/webgpu_transition_state.js?v=sm404-1'))
    .then(() => globalThis.SteelMothWebGPUTransitionState?.installRuntimeIntegration?.(globalThis) || null)
    .catch(err => {
      globalThis.steelMothBackendRuntimeError = String(err?.stack || err);
      console.warn('WebGPU staged renderer lifecycle through post/occluder/cluster/dominance/DSO hierarchy/Dark Bloom/temporal/bounded visibility/canonical water/foliage/ordering/editor/transition-state/quality preparation unavailable; continuing with WebGL2.', err);
      return null;
    });
  globalThis.steelMothBackendReady = backendReady;

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