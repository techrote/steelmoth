#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

SCENARIOS=('representative','empty','dense-static','dynamic-robot','foliage','bin-cluster','diagnostic-light','mixed')
TARGET_MEAN_MS=12.0
TARGET_P95_MS=14.5


def finite(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError,ValueError):
        return False


def main() -> int:
    parser=argparse.ArgumentParser(description='Validate an SM-501 physical GTX 1650 SUPER WebGPU acceptance report.')
    parser.add_argument('report',type=Path)
    args=parser.parse_args()
    payload=json.loads(args.report.read_text(encoding='utf-8'))
    errors=[]
    def require(condition: bool,message: str) -> None:
        if not condition:
            errors.append(message)

    require(payload.get('schema')=='steelmoth-sm501-gtx1650s/v1','schema must be steelmoth-sm501-gtx1650s/v1')
    require(payload.get('qualityPreset')=='Medium','acceptance report must benchmark Medium')
    require(payload.get('resolution')==[1920,1080],'acceptance report must be native 1920x1080')
    require(float(payload.get('dpr',0) or 0)==1.0,'acceptance report must use DPR 1')
    require(payload.get('timestampQuery') is True,'timestamp-query must be available; CPU time cannot substitute')
    require(payload.get('source',{}).get('cleanTrackedState') is True,'source tracked state must be clean')
    require(bool(payload.get('source',{}).get('commit')),'source commit is required')

    env=payload.get('environment') or {}
    gpu=str(env.get('gpuName') or '')
    require('GTX 1650 SUPER' in gpu.upper(),'physical target GPU must be GTX 1650 SUPER')
    require(bool(env.get('driver')),'GPU driver metadata is required')
    require(str(env.get('os') or '').lower().startswith('windows'),'target operating system must be Windows')
    require(bool(env.get('chromeVersion')),'Chrome version is required')

    scenarios=payload.get('scenarios') or {}
    for name in SCENARIOS:
        scenario=scenarios.get(name)
        require(isinstance(scenario,dict),f'missing canonical scenario {name}')
        if not isinstance(scenario,dict):
            continue
        runs=scenario.get('runs') or []
        require(len(runs)==3,f'{name}: exactly three independent Chrome runs are required')
        for index,run in enumerate(runs,1):
            require(int(run.get('warmupFrames',0) or 0)>=300,f'{name} run {index}: warm-up must be >=300')
            samples=run.get('gpuRendererMs') or []
            require(len(samples)>=600,f'{name} run {index}: retain >=600 renderer GPU samples')
            require(all(finite(v) and float(v)>=0 for v in samples),f'{name} run {index}: GPU samples must be finite non-negative timestamp results')
            stats=run.get('stats') or {}
            for key in ('mean','median','p90','p95','p99','max'):
                require(finite(stats.get(key)),f'{name} run {index}: missing finite {key}')
            cpu=run.get('cpu') or {}
            require(finite(cpu.get('scenePrepMeanMs')),f'{name} run {index}: separate CPU scene-prep mean required')
            require(finite(cpu.get('encodingMeanMs')),f'{name} run {index}: separate CPU encoding mean required')
            workload=run.get('workload') or {}
            for key in ('visibleInstances','staticInstances','dynamicInstances','foregroundInstances','activeLights','selfShadowedLights','selfShadowSamples','contactShadowSamples','occluders','clusters','largestCluster','dsoTiles','dsoPixels'):
                require(key in workload,f'{name} run {index}: workload metadata missing {key}')
            memory=run.get('memory') or {}
            for key in ('texturesBytes','buffersBytes','historyBytes','totalEstimatedBytes'):
                require(key in memory,f'{name} run {index}: memory metadata missing {key}')
        aggregate=scenario.get('aggregate') or {}
        require(finite(aggregate.get('mean')),f'{name}: aggregate mean missing')
        require(finite(aggregate.get('p95')),f'{name}: aggregate p95 missing')
        if finite(aggregate.get('mean')):
            require(float(aggregate['mean'])<=TARGET_MEAN_MS,f'{name}: aggregate GPU mean {aggregate["mean"]} exceeds {TARGET_MEAN_MS} ms')
        if finite(aggregate.get('p95')):
            require(float(aggregate['p95'])<=TARGET_P95_MS,f'{name}: aggregate GPU p95 {aggregate["p95"]} exceeds {TARGET_P95_MS} ms')

    firefox=payload.get('firefoxSpotCheck') or {}
    require(firefox.get('ok') is True,'Firefox target-machine spot-check must pass')
    require(firefox.get('qualityPreset')=='Medium','Firefox spot-check must use Medium')
    require(firefox.get('isFallbackAdapter') is False,'Firefox spot-check must use a physical non-fallback adapter')
    require(int(firefox.get('warmupFrames',0) or 0)>=300,'Firefox spot-check warm-up must be >=300')
    firefox_samples=firefox.get('gpuRendererMs') or []
    require(len(firefox_samples)>=600,'Firefox spot-check must retain >=600 GPU timestamp samples')
    require(all(finite(v) and float(v)>=0 for v in firefox_samples),'Firefox spot-check samples must be finite GPU timestamps')

    baseline=payload.get('webgl2BaselineComparison') or {}
    require(baseline.get('source')=='docs/WEBGL2_BASELINE_PERFORMANCE.md','report must identify the canonical SM-003 baseline')
    for name in SCENARIOS:
        row=(baseline.get('scenarios') or {}).get(name) or {}
        require(finite(row.get('webgl2MeanMs')) and finite(row.get('webgl2P95Ms')),f'{name}: missing WebGL2 comparison values')
        require(finite(row.get('webgpuMeanMs')) and finite(row.get('webgpuP95Ms')),f'{name}: missing WebGPU comparison values')

    if errors:
        print('SM-501 TARGET REPORT FAIL')
        for error in errors:
            print(' -',error)
        return 1
    print('SM-501 TARGET REPORT PASS: physical GTX 1650 SUPER Medium dataset satisfies method, metadata, Chrome three-run timing targets, Firefox spot-check and SM-003 comparison contract')
    return 0

if __name__=='__main__':
    raise SystemExit(main())
