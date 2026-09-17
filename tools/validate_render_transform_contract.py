#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def read(path): return (ROOT/path).read_text(encoding='utf-8')
def require(cond,msg):
    if not cond: raise AssertionError(msg)

def main():
    transform=read('engine/render_transform.js')
    integration=read('engine/render_transform_integration.js')
    scene_adapter=read('engine/render_transform_scene_adapter.js')
    webgl_adapter=read('engine/webgl2_scene_adapter.js')
    webapp=read('webapp.js')
    sw=read('sw.js')
    docs=read('docs/ROOT_FOOT_CONVENTION.md')
    game=read('engine/game.js')

    for token in ['function resolve(','function legacyFootAnchor(','function frameBounds(','function shadowFootRect(','function shadowSections(','function shadowPlacement(','function editorBounds(']:
        require(token in transform,f'missing shared transform API: {token}')
    require("root.getSpriteFootAnchor=function" in integration,'compatibility material anchor is not interposed')
    require("root.spriteShadowFootRect=function" in integration and "root.spriteShadowSections=function" in integration,'shadow helpers are not interposed')
    require('function patchCasterCollection(' in integration,'shadow caster collection is not migrated through shared root authority')
    require('shadowContactOffsetY' in integration and 'T.shadowPlacement(' in integration,'shadow compatibility contacts are not explicit offsets from shared roots')
    require('editor.spriteBBox=function' in integration and 'editor.drawSpriteGhost=function' in integration,'WYSIWYG geometry is not interposed')
    require('ensureBackground(true)' in integration,'late integration does not refresh static material descriptors')
    require("authority:q.root.authority" in scene_adapter,'RenderScene sprite roots are not canonicalized')
    require('shadowContactPolicy' in scene_adapter and 'o.rootX' in scene_adapter,'RenderScene occluders do not carry shared caster roots/contact offsets')
    require('scene.transformAuthority=' in scene_adapter,'RenderScene does not advertise transform authority')
    require('SteelMothRenderTransformIntegration?.patchExistingGame?.(game)' in webgl_adapter,'late Game construction is not bound to shared transform integration')

    # webapp intentionally contains two branches: a render-test-only SM-100 baseline
    # branch and the normal SM-101 chain. A global string-position sort is invalid
    # because the baseline branch mentions render_scene first. Verify the actual
    # normal promise chain instead, and verify the baseline bypass is separately
    # gated to renderTest requests.
    normal_chain="""import('./engine/render_transform.js?v=sm101-1')
      .then(() => import('./engine/render_transform_integration.js?v=sm101-1'))
      .then(() => import('./engine/render_scene.js?v=sm100-1'))
      .then(() => import('./engine/render_transform_scene_adapter.js?v=sm101-1')))\n    .then(() => import('./engine/webgl2_scene_adapter.js?v=sm100-1'))"""
    require(normal_chain in webapp,'normal webapp transform/scene modules are not chained in the required execution order')
    order=['render_transform.js?v=sm101-1','render_transform_integration.js?v=sm101-1','render_scene.js?v=sm100-1','render_transform_scene_adapter.js?v=sm101-1','webgl2_scene_adapter.js?v=sm100-1']
    for item in order:
        require(item in webapp,f'webapp missing transform/scene module: {item}')
    require('renderTransformBaseline' in webapp and "params.get('renderTest')" in webapp,'test-only before/after browser parity mode is missing or insufficiently gated')
    for item in order:
        require(item in sw,f'offline CORE missing {item}')
    require("small-machine-web-v1.2.3-r2" in sw,'service-worker cache identity was not advanced for SM-101 runtime modules')

    # The accepted baseline source is deliberately retained; the integration layer
    # owns active interpretation rather than silently rewriting accepted placement.
    require('function getSpriteFootAnchor(' in game,'baseline helper unexpectedly removed; provenance assumption changed')
    require('function spriteShadowFootRect(' in game and 'function spriteShadowSections(' in game,'baseline shadow helper unexpectedly removed')
    require('collectCasters(){' in game,'baseline caster collection unexpectedly removed; parity baseline changed')
    for phrase in ['unrotated ground-contact','subrect','WYSIWYG','shadow contact','SM-201','WebGL2','WebGPU']:
        require(phrase.lower() in docs.lower(),f'root/foot documentation missing {phrase!r}')

    print('SM-101 render-transform source contract: PASS')
    return 0

if __name__=='__main__': raise SystemExit(main())
