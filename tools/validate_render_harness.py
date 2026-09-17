#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, re, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
errors=[]
def need(cond,msg):
    if not cond: errors.append(msg)
js=(ROOT/'engine/render_harness.js').read_text(encoding='utf-8')
entry=(ROOT/'render-test.html').read_text(encoding='utf-8')
fixture=json.loads((ROOT/'render-tests/fixtures/harness-smoke.json').read_text(encoding='utf-8'))
doc=(ROOT/'docs/RENDER_CAPTURE_HARNESS.md').read_text(encoding='utf-8')
need(fixture.get('schema')=='steelmoth-render-fixture/v1','fixture schema')
need(fixture.get('id')=='harness-smoke','fixture id')
need(re.search(r'\bANGLES\s*=\s*Object\.freeze\(\[0,45,90,135,180,225,270,315\]\)',js) is not None,'canonical 8 angles')
for token in ['renderTest','fixture','backend','quality','width','height','dpr','lightAngle','seed','fixedTimeMs','sceneFingerprint','canvasPng','gpuTimingAvailable']:
    need(token in js,f'missing harness token {token}')
need('signalOrchardStateV103' in js and 'signalOrchardGraphicsV123' in js,'persistence isolation keys')
need('Math.random =' in js,'seeded PRNG hook')
need("game.paused = true" in js,'simulation pause')
need("game.render = () => originalRender(config.fixedTimeMs)" in js,'fixed renderer time')
need('engine/render_harness.js' in entry,'render-test bootstrap harness script missing')
need("source=source.replace(gameTag,harnessTag)" in entry,'render-test bootstrap replacement missing')
need("+gameTag" in entry,'render-test bootstrap must place harness immediately before game.js')
for angle in ['0','45','90','135','180','225','270','315']:
    need(angle in doc,f'doc angle {angle}')
if errors:
    print('render harness validation: FAIL')
    for e in errors: print(' -',e)
    sys.exit(1)
print('render harness validation: PASS')
print('fixture:',fixture['id'])
print('angles: 0,45,90,135,180,225,270,315')
