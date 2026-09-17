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
    webapp=read('webapp.js')
    sw=read('sw.js')
    docs=read('docs/ROOT_FOOT_CONVENTION.md')
    game=read('engine/game.js')

    for token in ['function resolve(','function legacyFootAnchor(','function frameBounds(','function shadowFootRect(','function shadowSections(','function editorBounds(']:
        require(token in transform,f'missing shared transform API: {token}')
    require("root.getSpriteFootAnchor=function" in integration,'compatibility material anchor is not interposed')
    require("root.spriteShadowFootRect=function" in integration and "root.spriteShadowSections=function" in integration,'shadow helpers are not interposed')
    require('editor.spriteBBox=function' in integration and 'editor.drawSpriteGhost=function' in integration,'WYSIWYG geometry is not interposed')
    require('ensureBackground(true)' in integration,'late integration does not refresh static material descriptors')
    require("authority:'shared-render-transform/v1'" in scene_adapter,'RenderScene roots are not canonicalized')
    require('scene.transformAuthority=' in scene_adapter,'RenderScene does not advertise transform authority')

    order=['render_transform.js?v=sm101-1','render_transform_integration.js?v=sm101-1','render_scene.js?v=sm100-1','render_transform_scene_adapter.js?v=sm101-1','webgl2_scene_adapter.js?v=sm100-1']
    positions=[webapp.find(x) for x in order]
    require(all(p>=0 for p in positions),f'webapp missing transform/scene module: {positions}')
    require(positions==sorted(positions),'webapp transform modules are loaded in unsafe order')
    for item in order:
        require(item in sw,f'offline CORE missing {item}')
    require("small-machine-web-v1.2.3-r2" in sw,'service-worker cache identity was not advanced for SM-101 runtime modules')

    # The accepted baseline source is deliberately retained; the integration layer
    # must own active interpretation rather than silently rewriting art placement.
    require('function getSpriteFootAnchor(' in game,'baseline helper unexpectedly removed; provenance assumption changed')
    require('function spriteShadowFootRect(' in game and 'function spriteShadowSections(' in game,'baseline shadow helper unexpectedly removed')
    for phrase in ['unrotated ground-contact','subrect','WYSIWYG','SM-201','WebGL2','WebGPU']:
        require(phrase in docs,f'root/foot documentation missing {phrase!r}')

    print('SM-101 render-transform source contract: PASS')
    return 0

if __name__=='__main__': raise SystemExit(main())
