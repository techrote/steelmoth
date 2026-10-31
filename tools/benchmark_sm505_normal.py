#!/usr/bin/env python3
"""Plan or serialize qualified actual-index SM-505 target timing; never retry runs."""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import functools
import hashlib
import http.server
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

from benchmark_webgl2 import SCENARIOS
from diagnose_sm505_presentation import ObserverCDP
from validate_webgpu_ssgi_browser import QuietHandler, browser_path, gpu_inventory, stop_browser, wait_for_page
from validate_sm603_ssgi_browser import video_controller_inventory
from validate_sm603_target_report import hardware_errors

ROOT=Path(__file__).resolve().parents[1]
SCENARIO_BY_ID={item['id']:item for item in SCENARIOS}
QUALIFICATION_SCHEMA='steelmoth-sm505-qualification/v1'
CONFIGURATION={'width':1920,'height':1080,'dpr':1,'quality':'Medium','gtaoEnabled':False,'inspection':'none'}


def utc_now():return dt.datetime.now(dt.timezone.utc)
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write_json(path,payload):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(payload,indent=2,allow_nan=False)+'\n',encoding='utf-8')
def manifest(directory):
    files=sorted(p for p in directory.rglob('*') if p.is_file() and p.name!='SHA256SUMS.txt')
    (directory/'SHA256SUMS.txt').write_text(''.join(f'{digest(p)}  {p.relative_to(directory).as_posix()}\n' for p in files),encoding='utf-8')


def stats(values):
    if not values or any(type(v) not in (int,float) or not math.isfinite(v) or v<0 for v in values):raise ValueError('finite nonnegative raw timestamp samples required; no filtering')
    ordered=sorted(values);n=len(ordered)
    def q(f):return ordered[max(0,math.ceil(f*n)-1)]
    return {'count':n,'mean':sum(values)/n,'median':q(.5),'p90':q(.9),'p95':q(.95),'p99':q(.99),'max':ordered[-1]}


def source_identity(root=ROOT):
    def git(*args):return subprocess.run(['git','-C',str(root),*args],capture_output=True,text=True,check=True,timeout=30).stdout.strip()
    runtime=set()
    for pattern in ('engine/*.js','game_data/*.json','assets/generated/**/*','render-tests/fixtures/*.json'):
        runtime.update(p for p in root.glob(pattern) if p.is_file())
    runtime.update(root/name for name in ('index.html','style.css','webapp.js','sw.js','DEPLOYMENT_MANIFEST.json'))
    closure=runtime|set(root.glob('tools/*.py'))|{root/'tools/sm505_normal_benchmark.js'}
    missing=[str(p) for p in closure if not p.is_file()]
    if missing:raise RuntimeError('source closure paths missing: '+str(missing))
    tracked=set(git('ls-files').splitlines());paths=sorted(p.relative_to(root).as_posix() for p in closure)
    return {'commit':git('rev-parse','HEAD'),'tree':git('rev-parse','HEAD^{tree}'),'branch':git('branch','--show-current'),
      'cleanTrackedState':not bool(git('status','--porcelain=v1','--untracked-files=no')),'workingTreeStatus':git('status','--porcelain=v1','--untracked-files=all'),
      'closureTracked':all(name in tracked for name in paths),'untrackedClosurePaths':[name for name in paths if name not in tracked],
      'runtimeFileSha256':{p.relative_to(root).as_posix():digest(p) for p in sorted(runtime)},'fileSha256':{name:digest(root/name) for name in paths},
      'boundary':'Actual runtime assets/data/fixture inputs plus all top-level Python runner/helper sources and the timing observer. Raw checkout bytes are hashed; no source-equivalence exception.'}


def same_source(a,b):
    if not isinstance(a,dict) or not isinstance(b,dict):return False
    keys=('commit','tree','branch','cleanTrackedState','closureTracked','untrackedClosurePaths','runtimeFileSha256','fileSha256')
    return all(a.get(key)==b.get(key) for key in keys)


def validate_source(source):
    if not isinstance(source,dict):raise ValueError('source identity must be an object')
    if not isinstance(source.get('runtimeFileSha256'),dict) or not isinstance(source.get('fileSha256'),dict):raise ValueError('source fingerprints must be maps')
    if not source.get('commit') or not source.get('runtimeFileSha256') or not source.get('fileSha256'):raise ValueError('complete source identity required')
    for field in ('runtimeFileSha256','fileSha256'):
        if any(not isinstance(name,str) or not name or not isinstance(value,str) or len(value)!=64 or any(c not in '0123456789abcdef' for c in value) for name,value in source[field].items()):raise ValueError('source fingerprints must contain valid SHA-256 strings')
    if any(source['fileSha256'].get(name)!=value for name,value in source['runtimeFileSha256'].items()):raise ValueError('runtime fingerprints must belong to the complete source closure')
    if source.get('cleanTrackedState') is not True:raise ValueError('tracked source must be clean before target measurement')
    if source.get('closureTracked') is not True or source.get('untrackedClosurePaths'):raise ValueError('every executable source-closure path must be Git-tracked')


def validate_qualification(path,source):
    path=Path(path).resolve();payload=json.loads(path.read_text(encoding='utf-8'));validate_source(source)
    if payload.get('schema')!=QUALIFICATION_SCHEMA:raise ValueError('source-matched SM505 qualification schema required')
    qualified=payload.get('source') or {}
    if qualified.get('commit')!=source['commit'] or qualified.get('runtimeFileSha256')!=source['runtimeFileSha256']:raise ValueError('qualification source commit/runtime hashes must exactly match current source')
    if payload.get('configuration')!=CONFIGURATION:raise ValueError('qualification requires original Medium/1080p/DPR1/GTAO-off/inspection-none configuration')
    gates=payload.get('gates') or {}
    if gates.get('normalPresentation')!='PASS' or gates.get('visualCorrectness')!='PASS':raise ValueError('normal presentation AND visual correctness must explicitly PASS; diagnostics or black fractions cannot authorize timing')
    kinds=set();captured_report=False;references=[]
    for item in payload.get('evidence') or []:
        if not isinstance(item,dict) or item.get('kind') not in ('presentation','visual'):raise ValueError('qualification evidence kind must identify presentation or visual evidence')
        candidate=Path(item.get('path',''));candidate=candidate if candidate.is_absolute() else path.parent/candidate
        if not candidate.is_file() or digest(candidate)!=item.get('sha256'):raise ValueError('qualification evidence is missing or its SHA-256 differs')
        kinds.add(item['kind']);captured_report|=candidate.suffix.lower()=='.json';references.append({'kind':item['kind'],'path':str(candidate.resolve()),'sha256':digest(candidate)})
    if kinds!={'presentation','visual'} or not captured_report:raise ValueError('qualification must reference presentation and visual evidence including a captured JSON report')
    return {'path':str(path),'sha256':digest(path),'schema':QUALIFICATION_SCHEMA,'evidence':references,'gates':gates,'configuration':payload['configuration'],'sourceCommit':qualified['commit']}


def validate_guard(path,pid=None,now=None):
    path=Path(path).resolve();report=json.loads(path.read_text(encoding='utf-8'));pid=os.getpid() if pid is None else pid;now=utc_now() if now is None else now
    if report.get('schema')!='steelmoth-sm505-physical-guard/v1' or report.get('childPid')!=pid:raise ValueError('active physical guard must own this exact runner PID')
    if report.get('endedAt') is not None or report.get('failure') is not None or report.get('samples',0)<1:raise ValueError('physical guard is inactive or failed')
    deadline=dt.datetime.fromisoformat(str(report.get('deadlineUtc')).replace('Z','+00:00'))
    if deadline.tzinfo is None or deadline<=now:raise ValueError('physical guard global deadline expired or invalid')
    telemetry=path.parent/'telemetry.jsonl'
    with telemetry.open('rb') as stream:stream.seek(max(0,telemetry.stat().st_size-16384));lines=stream.read().decode('utf-8').splitlines()
    latest=None
    for line in reversed(lines):
        try:latest=json.loads(line);break
        except json.JSONDecodeError:continue
    if not latest:raise ValueError('physical telemetry is unavailable')
    age=(now-dt.datetime.fromisoformat(latest['at'].replace('Z','+00:00'))).total_seconds()
    if not -5<=age<=8 or latest.get('uuid')!=(report.get('gpu') or {}).get('uuid'):raise ValueError('physical telemetry is stale or not the guarded GPU')
    if latest.get('name')!='NVIDIA GeForce GTX 1650 SUPER' or latest.get('memoryTotalMiB')!=4096 or not isinstance(latest.get('temperatureC'),(int,float)) or not math.isfinite(latest['temperatureC']) or latest['temperatureC']>=85:raise ValueError('guarded target identity/temperature is invalid')
    return {'path':str(path),'childPid':pid,'gpu':report['gpu'],'deadlineUtc':report['deadlineUtc'],'latestTelemetry':latest}


def wait_guard(path):
    deadline=time.monotonic()+5;last=None
    while time.monotonic()<deadline:
        try:return validate_guard(path)
        except (OSError,ValueError,KeyError) as error:last=error;time.sleep(.1)
    raise RuntimeError('active owned physical guard proof unavailable: '+str(last))


def plan(campaign=False,scene='representative',run=1):
    return [{'scene':item['id'],'scenario':item,'run':index,'relativeOut':item['id']+'/run-'+str(index)} for item in SCENARIOS for index in range(1,4)] if campaign else [{'scene':scene,'scenario':SCENARIO_BY_ID[scene],'run':run,'relativeOut':scene+'/run-'+str(run)}]


def validate_run(payload,args,scenario):
    if not isinstance(payload,dict):return ['run report must be an object']
    mapping=lambda value:value if isinstance(value,dict) else {}
    sequence=lambda value:value if isinstance(value,list) else []
    errors=[];smoke=mapping(payload.get('benchmark'))
    for name in ('source','sourceAfter'):
        try:validate_source(payload.get(name))
        except ValueError as error:errors.append(name+': '+str(error))
    if smoke.get('schema')!='steelmoth-sm505-normal-benchmark-run/v1' or smoke.get('ok') is not True:errors.append('actual normal-game benchmark did not complete')
    if smoke.get('restored') is not True:errors.append('benchmark-owned hooks/resources were not restored')
    if smoke.get('visualAcceptance') is not False or smoke.get('releaseAcceptance') is not False:errors.append('timing observer must not claim visual/release acceptance')
    config=mapping(smoke.get('configuration'))
    if any(config.get(k)!=v for k,v in CONFIGURATION.items()) or config.get('scenario')!=scenario:errors.append('actual benchmark configuration differs from canonical requested profile')
    values=sequence(smoke.get('queueSpanGpuMs'));commands=sequence(smoke.get('commandGpuMs'))
    valid_values=len(values)==args.samples and all(type(v) in (int,float) and math.isfinite(v) and v>0 for v in values)
    if not valid_values:errors.append('retain exactly the requested positive finite queue-span timestamp samples')
    if valid_values:
        expected=stats(values);reported=mapping(smoke.get('statistics'))
        if any(type(reported.get(k)) not in (int,float) or not math.isfinite(reported[k]) or not math.isclose(reported[k],v,rel_tol=1e-9,abs_tol=1e-9) for k,v in expected.items()):errors.append('reported GPU distributions do not match retained raw timestamp samples')
        if smoke.get('targets')!={'meanMs':12,'p95Ms':14.5} or smoke.get('runThresholdPass')!=(expected['mean']<=12 and expected['p95']<=14.5):errors.append('target constants/comparison changed from12ms mean/14.5ms p95')
    raw=sequence(smoke.get('rawFrames'));raw_valid=valid_values and len(raw)==args.samples
    for index,frame in enumerate(raw):
        if not isinstance(frame,dict):raw_valid=False;continue
        passes=sequence(frame.get('passes'));timing=mapping(frame.get('gpuTiming'))
        if len(passes)!=1 or not isinstance(passes[0],dict):raw_valid=False;continue
        record=passes[0];value=record.get('queueSpanGpuMs')
        if (index>=len(values) or record.get('name')!='rendererTotal' or type(value) not in (int,float)
            or not math.isfinite(value) or value!=values[index] or record.get('commandGpuMs') is not None
            or record.get('commandSpans')!=[] or timing.get('readbackPending') is not False):raw_valid=False
    if not raw_valid:errors.append('raw rendererTotal records do not substantiate retained timestamp/command series')
    if mapping(smoke.get('cpu')).get('pureEncoding') is not None:errors.append('async presentation callback cannot be reported as pure command encoding')
    if len(commands)!=args.samples or any(v is not None for v in commands) or mapping(smoke.get('commandCoverage')).get('explicitCommandSpans')!=0:errors.append('uncovered command GPU times must remain null with explicit zero coverage')
    accounting=mapping(smoke.get('frameAccounting'))
    if accounting.get('warmup')!=args.warmup or accounting.get('presentedDelta')!=args.warmup+args.samples or accounting.get('droppedDelta')!=0:errors.append('normal presenter frame/warmup accounting differs')
    if smoke.get('sceneFingerprintBefore')!=smoke.get('sceneFingerprintAfter') or not smoke.get('sceneFingerprintBefore'):errors.append('fixed scene/settings fingerprint changed')
    after=mapping(payload.get('runtimeAfter'))
    if smoke.get('errors') or payload.get('javascriptExceptions') or mapping(after.get('webgpu')).get('uncapturedErrors'):errors.append('GPU/JavaScript/runtime errors present')
    if not same_source(payload.get('source'),payload.get('sourceAfter')):errors.append('source identity changed during measurement')
    if any(after.get(k)!='webgpu' for k in ('requestedBackend','activeBackend','presentationBackend')):errors.append('normal WebGPU ownership was not retained through measurement')
    raw_command=mapping(payload.get('browser')).get('command')
    if not isinstance(raw_command,list) or any(not isinstance(v,str) for v in raw_command):errors.append('browser command must be a string list');command=''
    else:command=' '.join(raw_command).lower()
    if any(flag in command for flag in ('swiftshader','warp','llvmpipe','use-vulkan=','use-angle=','ignore-gpu-blocklist')):errors.append('physical report includes a software/adapter override')
    if not payload.get('browserProcessExited'):errors.append('owned browser teardown not verified')
    try:errors.extend(hardware_errors(payload))
    except (AttributeError,TypeError,ValueError):errors.append('physical adapter proof has malformed nested metadata')
    return errors


def run_one(args,item,out,source,qualification):
    if out.exists():raise RuntimeError('original run evidence cannot be overwritten: '+str(out))
    out.mkdir(parents=True);report={'schema':'steelmoth-sm505-normal-browser-run/v1','ok':False,'hardwareRequested':True,'softwareRequested':False,'releaseAcceptance':False,'visualAcceptance':False,'startedAt':utc_now().isoformat(),'scenario':item['scenario'],'run':item['run'],'source':source,'qualification':qualification,'errors':[]}
    process=cdp=server=profile=log=None;deadline=time.monotonic()+args.timeout
    try:
        report['guardBefore']=validate_guard(args.guard_report);report['gpuInventory']=gpu_inventory();report['videoControllers']=video_controller_inventory();exe=browser_path(args.browser)
        if not exe or Path(exe).name.lower()!='chrome.exe':raise RuntimeError('installed Windows Chrome stable executable required; Edge/software substitutes are not accepted')
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
        profile=tempfile.TemporaryDirectory(prefix='sm505-normal-target-',ignore_cleanup_errors=True);log=(out/'browser.log').open('wb')
        command=[exe,'--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--enable-unsafe-webgpu','--force-device-scale-factor=1','--window-size=1920,1080','--remote-debugging-port=0','--remote-allow-origins=*','--user-data-dir='+profile.name,'about:blank']
        process=subprocess.Popen(command,cwd=ROOT,stdout=log,stderr=log,start_new_session=os.name!='nt',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0) if os.name=='nt' else 0)
        report['browser']={'kind':'chrome','executable':exe,'processId':process.pid,'freshProcess':True,'freshProfile':True,'profileIdentity':Path(profile.name).name,'command':[v if not v.startswith('--user-data-dir=') else '--user-data-dir=<fresh-profile>' for v in command],'defaultBrowserCompatibilityClaim':False}
        target=wait_for_page(process,Path(profile.name),deadline);cdp=ObserverCDP(target['webSocketDebuggerUrl'],deadline=deadline);cdp.call('Runtime.enable');cdp.call('Page.enable');cdp.call('Log.enable');report['browser']['version']=cdp.call('Browser.getVersion')
        cdp.call('Emulation.setDeviceMetricsOverride',{'width':1920,'height':1080,'deviceScaleFactor':1,'mobile':False})
        injection=(ROOT/'engine/render_fixture_adapter.js').read_text(encoding='utf-8')+'\n'+(ROOT/'engine/render_harness.js').read_text(encoding='utf-8');cdp.call('Page.addScriptToEvaluateOnNewDocument',{'source':injection})
        scenario=item['scenario'];query=urllib.parse.urlencode({'rendererBackend':'webgl2','renderTest':1,'backend':'webgl2','benchmarkPrepare':1,'benchmarkProfile':scenario['profile'],'fixture':scenario['fixture'],'quality':'medium','webgpuQuality':'Medium','width':1920,'height':1080,'dpr':1,'lightAngle':scenario['angle'],'seed':1397572098,'fixedTimeMs':12000,'settleFrames':4,'inspection':'none'})
        navigation=cdp.call('Page.navigate',{'url':f'http://127.0.0.1:{server.server_address[1]}/index.html?{query}'})
        if navigation.get('errorText'):raise RuntimeError(navigation['errorText'])
        while time.monotonic()<deadline:
            state=cdp.value('({ready:document.body?.dataset.renderTestReady,error:document.body?.dataset.renderTestError,result:globalThis.SteelMothRenderHarness?.result})') or {}
            if state.get('error'):raise RuntimeError('normal fixture preparation failed: '+str(state.get('result')))
            if state.get('ready')=='1':break
            time.sleep(.1)
        else:raise TimeoutError('normal fixture preparation deadline')
        report['fixtureMetadata']=state.get('result',{}).get('metadata');cdp.evaluate("game.loop=()=>{};steelMothBackendRuntime.select('webgpu',{persist:false})")
        report['runtimeBefore']=cdp.evaluate('steelMothBackendRuntime.diagnostics()')
        if report['runtimeBefore'].get('presentationBackend')!='webgpu':raise RuntimeError('normal WebGPU presenter could not acquire presentation')
        report['smoke']={'gpu':cdp.evaluate('({adapterInfo:steelMothBackendRuntime.manager.diagnostics().adapterInfo,isFallbackAdapter:steelMothBackendRuntime.manager.adapter.isFallbackAdapter??steelMothBackendRuntime.manager.adapter.info?.isFallbackAdapter??null})')}
        failures=hardware_errors(report)
        if failures:raise RuntimeError('actual target adapter proof failed: '+'; '.join(failures))
        report['display']=cdp.evaluate('({screen:[screen.width,screen.height],viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,canvas:[game.canvas.width,game.canvas.height]})')
        cdp.evaluate("import('./engine/webgpu_performance.js')")
        js=(ROOT/'tools/sm505_normal_benchmark.js').read_text(encoding='utf-8');options={'scenario':scenario,'warmup':args.warmup,'samples':args.samples,'timeoutMs':max(1000,(deadline-time.monotonic()-10)*1000)}
        cdp.call('Runtime.evaluate',{'expression':js+'\n globalThis.SM505NormalBenchmarkPromise=sm505NormalBenchmark('+json.dumps(options)+').then(r=>{globalThis.SM505NormalBenchmarkResult=r}).catch(e=>{globalThis.SM505NormalBenchmarkResult={ok:false,errors:[String(e?.stack||e)]}});','returnByValue':False})
        last_checkpoint=0
        while time.monotonic()<deadline:
            cdp.ws.settimeout(max(.2,min(30,deadline-time.monotonic())));state=cdp.value('({result:globalThis.SM505NormalBenchmarkResult||null,progress:globalThis.SM505NormalBenchmarkProgress||null})') or {}
            if isinstance(state.get('result'),dict):report['benchmark']=state['result'];break
            report['progress']=state.get('progress')
            if time.monotonic()-last_checkpoint>=2:write_json(out/'report.json',report);report['guardDuring']=validate_guard(args.guard_report);last_checkpoint=time.monotonic()
            time.sleep(.1)
        else:raise TimeoutError('normal presenter benchmark workload deadline')
        report['runtimeAfter']=cdp.evaluate('steelMothBackendRuntime.diagnostics()');report['sourceAfter']=source_identity();report['guardAfter']=validate_guard(args.guard_report)
        screenshot=cdp.call('Page.captureScreenshot',{'format':'png','fromSurface':True});(out/'presented.png').write_bytes(base64.b64decode(screenshot['data']))
        report['ok']=True
    except Exception as error:
        report['errors'].append(str(error));report['ok']=False
        if cdp:
            try:
                cdp.ws.settimeout(5);report['failureState']=cdp.evaluate('({runtime:globalThis.steelMothBackendRuntime?.diagnostics(),progress:globalThis.SM505NormalBenchmarkProgress,partial:globalThis.SM505NormalBenchmarkResult||null})');shot=cdp.call('Page.captureScreenshot',{'format':'png'});(out/'failure-presented.png').write_bytes(base64.b64decode(shot['data']))
            except Exception as capture_error:report['failureCaptureError']=str(capture_error)
    finally:
        if cdp:report['javascriptExceptions']=cdp.exceptions;report['browserEvents']=cdp.events
        if process:
            try:stop_browser(process,cdp)
            except Exception as cleanup_error:report['errors'].append('owned browser cleanup: '+str(cleanup_error));report['ok']=False
            report['browserProcessExited']=process.poll() is not None;report['browserExitCode']=process.poll()
        if log:log.flush();log.close()
        if profile:profile.cleanup()
        if server:server.shutdown();server.server_close()
        if report['ok']:
            errors=validate_run(report,args,item['scenario']);report['errors'].extend(errors);report['ok']=not errors
        report['endedAt']=utc_now().isoformat();write_json(out/'report.json',report);manifest(out)
    return report


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--out',type=Path,default=Path('artifacts/sm505-normal-target'));ap.add_argument('--scene',choices=tuple(SCENARIO_BY_ID),default='representative');ap.add_argument('--run',type=int,choices=(1,2,3),default=1);ap.add_argument('--campaign',action='store_true');ap.add_argument('--plan',action='store_true');ap.add_argument('--hardware',action='store_true');ap.add_argument('--browser');ap.add_argument('--guard-report',type=Path);ap.add_argument('--qualification-report',type=Path);ap.add_argument('--warmup',type=int,default=300);ap.add_argument('--samples',type=int,default=600);ap.add_argument('--timeout',type=float,default=600)
    args=ap.parse_args()
    if not 300<=args.warmup<=5000 or not 600<=args.samples<=5000 or not math.isfinite(args.timeout) or not 30<=args.timeout<=1800:ap.error('canonical window requires300..5000 warmup/600..5000 samples and timeout30..1800 seconds')
    planned=plan(args.campaign,args.scene,args.run)
    if args.plan:print(json.dumps({'schema':'steelmoth-sm505-normal-target-plan/v1','browserProcesses':len(planned),'configuration':CONFIGURATION,'warmup':args.warmup,'samples':args.samples,'runs':planned,'boundary':'Plan only. No browser/GPU execution or qualification/acceptance claim.'},indent=2));return 0
    if not args.hardware or not args.guard_report or not args.qualification_report:ap.error('actual runs require --hardware, active --guard-report and source/config-matched --qualification-report; no bypass')
    out=args.out.resolve()
    if out.exists():ap.error('output directory must be new; no original/failed evidence overwrites')
    out.mkdir(parents=True);campaign={'schema':'steelmoth-sm505-normal-target-campaign/v1','ok':False,'releaseAcceptance':False,'visualAcceptance':False,'configuration':CONFIGURATION,'plan':planned,'runs':[],'errors':[],'startedAt':utc_now().isoformat()}
    try:
        if os.name!='nt':raise RuntimeError('physical target campaign requires Windows')
        campaign['source']=source_identity();validate_source(campaign['source']);campaign['qualification']=validate_qualification(args.qualification_report,campaign['source']);campaign['guard']=wait_guard(args.guard_report);write_json(out/'campaign.json',campaign)
        for item in planned:
            campaign['active']=item;write_json(out/'campaign.json',campaign)
            run=run_one(args,item,out/item['relativeOut'],campaign['source'],campaign['qualification']);report_path=out/item['relativeOut']/'report.json';campaign['runs'].append({'scene':item['scene'],'run':item['run'],'path':report_path.relative_to(out).as_posix(),'sha256':digest(report_path),'ok':run['ok']});write_json(out/'campaign.json',campaign)
            if not run['ok']:raise RuntimeError('failed physical run retained; automatic retry prohibited: '+str(run['errors']))
        campaign['sourceAfter']=source_identity()
        if not same_source(campaign['sourceAfter'],campaign['source']):raise RuntimeError('source closure changed during campaign')
        campaign['summary']={}
        for scene in dict.fromkeys(item['scene'] for item in planned):
            entries=[r for r in campaign['runs'] if r['scene']==scene];values=[]
            for row in entries:values.extend(json.loads((out/row['path']).read_text(encoding='utf-8'))['benchmark']['queueSpanGpuMs'])
            summary=stats(values);campaign['summary'][scene]={'runs':len(entries),'aggregate':summary,'thresholds':{'meanMs':12,'p95Ms':14.5},'thresholdPass':summary['mean']<=12 and summary['p95']<=14.5}
        campaign['completeCanonicalMatrix']=args.campaign and len(campaign['runs'])==24;campaign['targetTimingPass']=campaign['completeCanonicalMatrix'] and all(row['thresholdPass'] for row in campaign['summary'].values());campaign['ok']=True;campaign.pop('active',None)
    except Exception as error:campaign['errors'].append(str(error))
    finally:campaign['endedAt']=utc_now().isoformat();write_json(out/'campaign.json',campaign);manifest(out)
    print(json.dumps({'ok':campaign['ok'],'completeCanonicalMatrix':campaign.get('completeCanonicalMatrix',False),'targetTimingPass':campaign.get('targetTimingPass',False),'errors':campaign['errors'],'report':str(out/'campaign.json')}));return 0 if campaign['ok'] and (not args.campaign or campaign.get('targetTimingPass')) else 1


if __name__=='__main__':raise SystemExit(main())
