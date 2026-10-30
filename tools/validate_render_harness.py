#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, re, subprocess, sys
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
need("return source.replace(gameTag,harnessTag)" in entry,'render-test bootstrap replacement missing')
need("+gameTag" in entry,'render-test bootstrap must place harness immediately before game.js')
need('gameTags.length!==1' in entry,'render-test bootstrap must reject missing or duplicate game tags')
bootstrap_test=r'''
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const entry=fs.readFileSync(process.argv[1],'utf8');
const script=entry.match(/<script>([\s\S]*)<\/script>/)[1];
const context={fetch:()=>new Promise(()=>{})};vm.createContext(context);vm.runInContext(script,context);
const inject=context.injectRenderHarness;
for(const revision of ['1.2.3','sm505-1','future-asset-revision']){
  const game=`<script defer src="engine/game.js?v=${revision}"></script>`;
  const input='before'+game+'after',output=inject(input);
  assert(output.startsWith('before')&&output.endsWith('after'));
  assert(output.indexOf('engine/render_fixture_adapter.js')<output.indexOf('engine/render_harness.js'));
  assert(output.indexOf('engine/render_harness.js')<output.indexOf(game));
  assert.equal(output.split(game).length-1,1,'production game tag/cache identity must be preserved exactly once');
}
assert.throws(()=>inject('<script src="engine/other.js"></script>'),/exactly one/);
assert.throws(()=>inject('<script src="engine/game.js?v=one"></script><script src="engine/game.js?v=two"></script>'),/exactly one/);
const production=fs.readFileSync(process.argv[2],'utf8');
const injected=inject(production);
assert.equal((injected.match(/engine\/render_fixture_adapter\.js/g)||[]).length,1);
assert.equal((injected.match(/engine\/render_harness\.js/g)||[]).length,1);
'''
try:
    result=subprocess.run(['node','-e',bootstrap_test,str(ROOT/'render-test.html'),str(ROOT/'index.html')],capture_output=True,text=True,timeout=15)
    need(result.returncode==0,'render-test bootstrap execution/order/negative witnesses: '+result.stderr.strip())
except (OSError,subprocess.SubprocessError) as exc:
    need(False,'render-test bootstrap execution unavailable: '+str(exc))
for angle in ['0','45','90','135','180','225','270','315']:
    need(angle in doc,f'doc angle {angle}')
if errors:
    print('render harness validation: FAIL')
    for e in errors: print(' -',e)
    sys.exit(1)
print('render harness validation: PASS')
print('fixture:',fixture['id'])
print('angles: 0,45,90,135,180,225,270,315')
