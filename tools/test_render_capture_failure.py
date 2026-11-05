#!/usr/bin/env python3
"""Deterministic failure-artifact contract; no browser or GPU needed."""
from __future__ import annotations
import json
import tempfile
from pathlib import Path
from capture_render_fixture import save_capture_failure

def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root=Path(tmp); log=root/'chrome.log'; out=root/'failure-diagnostics.json'
        log.write_text('start\nshader-error\n',encoding='utf-8')
        probe={'documentReadyState':'complete','hasBody':True,'ready':False,'error':False,'resultLength':0,
               'harnessInstalled':True,'harnessEnabled':True,'harnessStage':'render-scene-promise',
               'harnessStageHistory':[{'stage':'fixture-fetch','elapsedMs':10},{'stage':'render-scene-promise','elapsedMs':20}],
               'gamePresent':True,'gameReady':True,'bridgeAttached':False,'bridgePromisePresent':True}
        save_capture_failure(out,phase='render-test-readiness',error=RuntimeError('timeout'),
                             polls=3,last_probe=probe,chrome_log=log,browser_exit=None,elapsed_s=12.34567)
        d=json.loads(out.read_text(encoding='utf-8'))
        assert d['schema']=='steelmoth-browser-capture-failure/v1'
        assert d['phase']=='render-test-readiness' and d['error']=='timeout'
        assert d['readyPolls']==3 and d['lastReadinessProbe']==probe
        assert d['lastReadinessProbe']['harnessStage']=='render-scene-promise'
        assert d['browserExitCode'] is None and d['elapsedSeconds']==12.346
        assert 'shader-error' in d['chromeLogTail']
        log.unlink()
        save_capture_failure(out,phase='cdp-session',error=ValueError('no target'),
                             polls=0,last_probe=None,chrome_log=log,browser_exit=7,elapsed_s=0)
        d=json.loads(out.read_text(encoding='utf-8'))
        assert d['chromeLogTail']=='' and d['lastReadinessProbe'] is None
        assert d['browserExitCode']==7
        log.write_text('x'*8000,encoding='utf-8')
        save_capture_failure(out,phase='viewport-screenshot',error=RuntimeError('bad PNG'),
                             polls=1,last_probe=probe,chrome_log=log,browser_exit=0,elapsed_s=1)
        assert len(json.loads(out.read_text(encoding='utf-8'))['chromeLogTail'])==6000
    print('Capture failure diagnostics: 3 cases PASS')

if __name__=='__main__':
    main()
