#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def text(path:str)->str:
    return (ROOT/path).read_text(encoding='utf-8')

def require(haystack:str,needle:str,label:str)->None:
    if needle not in haystack: raise AssertionError(f'{label}: missing {needle!r}')

def forbid(haystack:str,needle:str,label:str)->None:
    if needle in haystack: raise AssertionError(f'{label}: forbidden duplicate/ownership term {needle!r}')

def main()->int:
    model=text('engine/pseudo_depth.js')
    docs=text('docs/PSEUDO_DEPTH_MODEL.md')
    research=text('docs/RESEARCH_AND_DECISIONS.md')
    gbuffer=text('engine/webgpu_gbuffer.js')
    ownership=text('engine/webgpu_ownership.js')
    generator=text('tools/generate_material_v2.py')
    run_checks=text('tools/run_checks.py')
    vectors=json.loads(text('render-tests/pseudo-depth/vectors.json'))

    for needle in [
        "const SCHEMA='steelmoth-pseudo-depth/v1'",
        'const MAX_WORLD_Z=64',
        'const Z_TO_SCREEN_Y=1',
        'const LAYER_STRIDE=1024',
        'function projectFragment',
        'function projectSpriteFragment',
        "productionDepthWrites:true",
        "productionOwner:'SM-202'",
        "productionModule:'engine/webgpu_ownership.js'"
    ]: require(model,needle,'pseudo_depth.js')

    require(generator,'MAX_WORLD_Z = 64.0','Material-v2 generator world-Z contract')
    # SM-200 remains the intentionally depth-disabled material/control path.
    require(gbuffer,"ownershipDepth:'not-implemented-sm201-sm202'",'SM-200 control boundary')
    require(gbuffer,"depthWriteEnabled:false,depthCompare:'always'",'SM-200 control boundary')
    # SM-202 production ownership must import/reference the SM-201 authority rather
    # than introducing unrelated numeric constants or light-dependent projection.
    for needle in ["require('./pseudo_depth.js')",'PseudoDepth.MAX_WORLD_Z','PseudoDepth.Z_TO_SCREEN_Y','PseudoDepth.LAYER_STRIDE','PseudoDepth.DEPTH_KEY_MIN','PseudoDepth.DEPTH_KEY_MAX','@builtin(frag_depth)',"depthCompare:'less'"]:
        require(ownership,needle,'SM-202 ownership adoption')

    for path in ['engine/game.js','engine/editor.js','engine/webgl2_scene_adapter.js','engine/webgpu_gbuffer.js']:
        body=text(path)
        for term in ['projectedGroundY','visibilityKey','LAYER_STRIDE=1024']:
            forbid(body,term,path)

    for needle in [
        'projectedGroundY = fragmentScreenY + worldZ',
        'visibilityKey = layer * 1024 + projectedGroundY + bias',
        'depth01 = clamp((3072 - visibilityKey) / 5120, 0, 1)',
        'SM-202 production adoption complete',
        'light-independent',
        'alpha cutout',
        'Rejected alternatives'
    ]: require(docs,needle,'PSEUDO_DEPTH_MODEL.md')
    require(research,'ADR-008 — canonical pseudo-depth projection','RESEARCH_AND_DECISIONS.md')
    require(research,'Q-001 — exact pseudo-depth projection — resolved','RESEARCH_AND_DECISIONS.md')
    require(run_checks,'validate_pseudo_depth.js','run_checks.py')
    require(run_checks,'validate_pseudo_depth_contract.py','run_checks.py')
    require(run_checks,'validate_webgpu_ownership.js','run_checks.py')
    if vectors.get('model')!='steelmoth-pseudo-depth/v1' or len(vectors.get('vectors',[]))<7:
        raise AssertionError('pseudo-depth vectors are missing or incomplete')

    print('Pseudo-depth source contract PASS: SM-201 remains the canonical formula; SM-200 is the depth-disabled control and SM-202 is the production ownership adopter.')
    return 0

if __name__=='__main__': raise SystemExit(main())
