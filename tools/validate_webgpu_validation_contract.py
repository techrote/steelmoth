#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def text(path:str)->str:return (ROOT/path).read_text(encoding='utf-8')
def require(haystack:str,needle:str,where:str)->None:
    if needle not in haystack:raise AssertionError(f'{where}: missing {needle!r}')

def main()->int:
    engine=text('engine/webgpu_validation.js');page=text('webgpu-validation-smoke.html');runner=text('tools/validate_webgpu_validation_browser.py');checks=text('tools/run_checks.py');docs=text('docs/WEBGPU_API_VALIDATION.md');clean=text('tools/validate_clean_package.py')
    for needle in ['steelmoth-webgpu-validation/v1','steelmoth-webgpu-validation-report/v1','infrastructure-render-probe','infrastructure-compute-probe','getCompilationInfo','createRenderPipelineAsync','createComputePipelineAsync','copyExternalImageToTexture','deliberate-invalid-buffer','profile:\'fallback\'','WebGPUValidationSuite',"['COPY_DST','TEXTURE_BINDING','RENDER_ATTACHMENT']"]:
        require(engine,needle,'engine/webgpu_validation.js')
    for needle in ['engine/webgpu_validation.js?v=sm104-1','optionalFeatureAbsence','fallback-device-lost','failureStage:\'device\'','getContext(\'webgl2\')','stateUnchanged']:
        require(page,needle,'webgpu-validation-smoke.html')
    for needle in ['--require-webgpu','getCompilationInfo','core/fallback','device-loss path','steelmoth-webgpu-validation-browser-report/v1']:
        require(runner,needle,'tools/validate_webgpu_validation_browser.py')
    for needle in ['js-webgpu-validation','webgpu-validation','webgpu-validation-contract']:
        require(checks,needle,'tools/run_checks.py')
    workflow_path=ROOT/'.github/workflows/verification.yml'
    if workflow_path.is_file():
        workflow=workflow_path.read_text(encoding='utf-8')
        require(workflow,'validate_webgpu_validation_browser.py --require-webgpu','verification workflow')
        require(workflow,'artifacts/webgpu-validation-browser.json','verification workflow')
    # Clean source archives intentionally exclude .github/.git. CI wiring is checked
    # in the repository checkout above; the extracted archive must remain independently
    # valid without manufacturing workflow files that are outside package scope.
    for needle in ['engine/webgpu_validation.js','webgpu-validation-smoke.html','tools/validate_webgpu_validation_contract.py','docs/WEBGPU_API_VALIDATION.md']:
        require(clean,needle,'tools/validate_clean_package.py')
    for needle in ['Production inventory','Compilation information','Validation scopes','Atlas upload','Optional-feature absence','Device loss','WebGL2 fallback','Evidence boundary','Firefox','CopyDst and RenderAttachment']:
        require(docs,needle,'docs/WEBGPU_API_VALIDATION.md')
    sample=json.loads(text('render-tests/webgpu-validation-report.sample.json'))
    if sample.get('schema')!='steelmoth-webgpu-validation-browser-report/v1':raise AssertionError('sample validation report schema mismatch')
    if sample.get('sampleOnly') is not True:raise AssertionError('sample report must be explicitly non-measured')
    if sample.get('ok') is not None:raise AssertionError('sample report must not claim a pass/fail measurement')
    print('SM-104 WebGPU validation source contract: PASS')
    return 0
if __name__=='__main__':raise SystemExit(main())
