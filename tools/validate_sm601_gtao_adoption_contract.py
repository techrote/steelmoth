#!/usr/bin/env python3
"""Production adoption integration/source authority checks; no GPU execution."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
errors = []


def need(condition, message):
    if not condition:
        errors.append(message)


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


engine = read('engine/webgpu_gtao_readback.js')
page = read('webgpu-target-benchmark.html')
smoke = read('webgpu-gtao-adoption-smoke.html')
runner = read('tools/validate_sm601_gtao_adoption_browser.py')
checks = read('tools/run_checks.py')
sw = read('sw.js')
cpu = read('tools/validate_sm601_gtao_readback.js')
workflow = read('.github/workflows/sm601-gtao-stabilization.yml')

need("require('./webgpu_gtao_stabilization.js')" in engine, 'production closure must use the engine temporal authority')
need('frozen_sm601' not in engine and 'tools/' not in engine, 'production must not depend on research tooling')
need("counterMode(options.counterMode??'baseline')" in engine and "mode(options.statsMode??'blocking')" in engine, 'compatibility defaults must remain baseline counters/blocking delivery')
need("Object.defineProperty(this,'counterMode'" in engine and "Object.defineProperty(this,'statsSlots'" in engine, 'shader mode and staging capacity must be immutable')
need("value>8" in engine and "skip(frame)" in engine and 'lastStatsFrame' in engine and 'statsForCurrentFrame' in engine, 'bounded ring/attribution authority missing')
need("AGGREGATED_TEMPORAL_WGSL_SHA256='11024a2f13f20abda1dee7cdc1a6d6703ecfc1982929ed51ccaa7b071579acf7'" in engine, 'production candidate identity must equal native measured shader')
need("mode==='sm601'?new GTR.WebGPUGTAOTemporal" in page and "statsMode:'deferred',statsSlots:3,counterMode:'aggregated'" in page, 'selected producer must be explicit and confined to SM601 caller')
need("new GT.WebGPUGTAOTemporal" in page and 'gtaoEnabled===false' in page, 'SM501 GTAO-off/original compatibility path must remain')
need("await perf.endFrame();if(mode==='sm601')await collectGtaoDiagnostics('measured-outside-timing')" in page, 'diagnostic drain must be outside recorded callback/queue span')
need("if(mode!=='sm601'){const row=diag.lastStats" in page, 'deferred stale diagnostics must not be used as current inside the callback')
need('samples[0].frame.frameId!==gtaoTemporal.updateCount' in page, 'drained attribution must match actual submitted frame')
need('diagnosticRows' in read('tools/run_webgpu_target_campaign.py') and 'timingCoverage' in page, 'acceptance evidence must retain timing semantics and delayed diagnostic attribution')
need('AGGREGATED_TEMPORAL_WGSL' in cpu and 'cases:outcomes.length' in cpu and 'seeded slow-map stress' in cpu, 'inherited lifecycle/counter identity CPU checks missing')
need('allFourTexturesByteIdentical' in smoke and 'allEightCounterWordsExact' in smoke and 'expectedVisibility' in smoke and '2e-6' in smoke, 'real shader equivalence must retain exact A/B and separate inherited CPU comparison')
need('referenceDevice' in smoke and 'Production.AGGREGATED_TEMPORAL_WGSL' in smoke and 'explicit-history-reset' in smoke, 'production/frozen/native rejection comparison missing')
need("--hardware" in runner and "--native" in runner and '63' in runner and ('wait_for_page_target' in runner or 'BrowserStartup(proc, port_file, deadline).wait_for_page()' in runner) and 'Report already exists' in runner, 'bounded software/native runner and evidence-preservation admission missing')
for name in ('webgpu_gtao', 'webgpu_gtao_stabilization', 'webgpu_gtao_readback'):
    need(f'./engine/{name}.js?' in sw, f'offline engine closure missing {name}')
for entry in ('js-webgpu-gtao-readback', 'sm601-gtao-readback', 'sm601-gtao-adoption-contract'):
    need(entry in checks, f'normal gate missing {entry}')
need('validate_sm601_gtao_adoption_browser.py --timeout 180' in workflow, 'bounded real-WebGPU production adoption correctness step missing')


def scene_function(text):
    match = re.search(r'(?m)^    function buildScene\([\s\S]*?(?=\n\s+let scene=)', text)
    return match.group(0) if match else None


need(scene_function(smoke) == scene_function(page) and scene_function(page) is not None, 'native production equivalence must copy canonical moving fixture exactly')
if errors:
    print('SM-601 ADOPTION CONTRACT FAIL')
    for message in errors:
        print(' -', message)
    raise SystemExit(1)
print('SM-601 ADOPTION CONTRACT PASS: exact measured shader, bounded attribution, explicit caller, preserved timing/quality authority, production/frozen correctness and offline/CI gates wired')
