#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
scene = (ROOT / 'engine' / 'render_scene.js').read_text(encoding='utf-8')
adapter = (ROOT / 'engine' / 'webgl2_scene_adapter.js').read_text(encoding='utf-8')
webapp = (ROOT / 'webapp.js').read_text(encoding='utf-8')
sw = (ROOT / 'sw.js').read_text(encoding='utf-8')
doc = (ROOT / 'docs' / 'RENDER_SCENE_DESCRIPTION.md').read_text(encoding='utf-8')

for schema in [
    'steelmoth-render-scene/v1',
    'steelmoth-sprite-instance/v1',
    'steelmoth-material-instance/v1',
    'steelmoth-light-instance/v1',
    'steelmoth-occluder-instance/v1',
    'steelmoth-procedural-layer/v1',
]:
    assert schema in scene, schema

for category in ["'static'", "'ground'", "'dynamic'", "'foreground'", "'top'"]:
    assert category in scene, category

for token in [
    'class RenderSceneBuilder',
    'validateRenderScene(scene)',
    "sprite:static:${slug(this.roomId)}:${i}",
    "this.nextId('sprite',this.scope)",
    "light:player-cone:0",
    "procedural:water",
    "procedural:grass",
    "procedural:foliage",
    "procedural:effects",
]:
    assert token in scene, token

for method in [
    'add','addGround','addRootedGrass','addHDRootedGrass','addHDForeground',
    'addHDSubrectForeground','addTop','addHD','addHDSubrect','addHDTint'
]:
    assert f"'{method}'" in adapter, method

for token in [
    'class WebGL2SceneAdapter',
    'class RenderSceneBridge',
    'this.adapter.consume(scene)',
    'this.originals.end(...endArgs)',
    'Render Scene bridge disabled after capture failure',
    'this.game.renderScene=scene',
]:
    assert token in adapter, token

for url in [
    './engine/render_scene.js?v=sm100-1',
    './engine/webgl2_scene_adapter.js?v=sm100-1',
]:
    assert url in webapp, f'webapp missing {url}'
    assert url in sw, f'service worker missing {url}'

assert 'steelMothRenderSceneBridgeError' in webapp
assert 'continuing with direct WebGL2' in webapp

for heading in [
    '# Render Scene Description',
    '## Authority boundary',
    '## Record schemas',
    '## Stable identity contract',
    '## WebGL2 compatibility adapter',
    '## Root and depth semantics',
    '## Procedural layers',
]:
    assert heading in doc, heading

assert 'SM-101' in doc and 'SM-201' in doc
assert 'gameplay' in doc.lower()

print('RENDER SCENE CONTRACT PASS: typed schemas, explicit categories, stable identity basis, WebGL2 compatibility bridge, offline module registration, and fail-open authority boundary are present')
