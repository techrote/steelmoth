#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
errors=[]
def need(ok,msg):
    if not ok: errors.append(msg)
def text(path): return (ROOT/path).read_text(encoding='utf-8')

engine=text(Path('engine/webgpu_performance.js'))
test=text(Path('tools/validate_webgpu_performance.js'))
plan=text(Path('docs/WEBGPU_VALIDATION_PLAN.md'))
doc=text(Path('docs/SM500_TIMING_BOUNDARY.md'))
checks=text(Path('tools/run_checks.py'))
workflow=text(Path('.github/workflows/sm500-timing-boundary.yml'))

for token in ('TIMING_SEMANTICS_SCHEMA','queueSpanGpuMs','commandGpuMs','performanceTimingScope','measureHostWait','readbackMapLatencyMs','maxCommandSpansPerPass'):
    need(token in engine,f'SM-500 hardened instrumentation missing token: {token}')
need("gpuMs:'legacy alias of queueSpanGpuMs" in engine,'legacy gpuMs compatibility must be explicitly documented in diagnostics')
need("start-marker + supplied command buffers + end-marker in one GPUQueue.submit call" in engine,'command-span queue-boundary contract missing')
need('scope.submit([env.gpuWork(2_000_000)]' in test and 'advanceGpuClock(9_000_000)' in test,'host-gap contamination witness missing')
need('p.queueSpanGpuMs>p.commandGpuMs+8.9' in test,'host-gap witness must prove queue span exceeds command span')
need('timestamp-query-feature-unavailable' in engine and 'unsupportedTimestampStillSubmits' in test,'timestamp-unavailable path must remain executable')
need('queue span' in plan.lower() and 'command span' in plan.lower(),'canonical validation plan must distinguish queue and command spans')
need('do not subtract cpu' in plan.lower(),'canonical plan must forbid CPU subtraction as a timing correction')
need('SM-500 timing boundary' in doc and 'historical' in doc.lower(),'timing-boundary decision/evidence document missing')
need('js-webgpu-performance' in checks and 'webgpu-performance-contract' in checks,'normal repository gate does not include SM-500 timing checks')
need('validate_webgpu_performance.js' in workflow and 'validate_webgpu_performance_contract.py' in workflow,'dedicated SM-500 workflow missing validator commands')

if errors:
    print('SM-500 TIMING CONTRACT FAIL')
    for e in errors: print(' -',e)
    raise SystemExit(1)
print('SM-500 TIMING CONTRACT PASS: legacy queue span retained, explicit command span isolated, host waits/readback latency labeled, normal and dedicated gates wired')
