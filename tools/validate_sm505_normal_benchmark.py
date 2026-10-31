#!/usr/bin/env python3
"""CPU-only qualification, provenance, guard and planning mutation tests."""
from __future__ import annotations
import copy
import datetime as dt
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace

import benchmark_sm505_normal as B


class Contract(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='sm505-normal-contract-');self.root=Path(self.temp.name)
        self.source={'commit':'a'*40,'tree':'b'*40,'branch':'codex/test','cleanTrackedState':True,'closureTracked':True,'untrackedClosurePaths':[],'runtimeFileSha256':{'engine/game.js':'c'*64},'fileSha256':{'engine/game.js':'c'*64,'tools/sm505_normal_benchmark.js':'d'*64},'workingTreeStatus':'?? artifacts/old'}
        self.presentation=self.root/'presentation.json';self.presentation.write_text('{"testOnlyMock":true}\n');self.visual=self.root/'visual.json';self.visual.write_text('{"testOnlyMock":true}\n')
        self.qualification={'schema':B.QUALIFICATION_SCHEMA,'source':{'commit':self.source['commit'],'runtimeFileSha256':self.source['runtimeFileSha256']},'configuration':copy.deepcopy(B.CONFIGURATION),'gates':{'normalPresentation':'PASS','visualCorrectness':'PASS'},'evidence':[{'kind':'presentation','path':'presentation.json','sha256':B.digest(self.presentation)},{'kind':'visual','path':'visual.json','sha256':B.digest(self.visual)}]}
        self.path=self.root/'qualification.json'
    def tearDown(self):self.temp.cleanup()
    def validate(self,payload=None,source=None):
        self.path.write_text(json.dumps(payload or self.qualification));return B.validate_qualification(self.path,source or self.source)
    def test_positive_qualification_is_only_source_matched_authority(self):
        result=self.validate();self.assertEqual(result['sourceCommit'],self.source['commit']);self.assertEqual(result['configuration'],B.CONFIGURATION)
    def test_failed_missing_or_diagnostic_gates_refuse(self):
        for gates in ({},{'normalPresentation':'PASS'},{'normalPresentation':'PASS','visualCorrectness':'FAIL'},{'normalPresentation':'PASS','visualCorrectness':True}):
            with self.subTest(gates=gates):
                p=copy.deepcopy(self.qualification);p['gates']=gates;p['ok']=True;p['blackFraction']=0
                with self.assertRaises(ValueError):self.validate(p)
    def test_stale_commit_or_runtime_refuse(self):
        for key,value in [('commit','e'*40),('runtimeFileSha256',{'engine/game.js':'e'*64})]:
            p=copy.deepcopy(self.qualification);p['source'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):self.validate(p)
    def test_preset_inspection_and_extent_mutations_refuse(self):
        for key,value in [('quality','High'),('inspection','development'),('gtaoEnabled',True),('width',1280),('dpr',2)]:
            p=copy.deepcopy(self.qualification);p['configuration'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):self.validate(p)
    def test_dirty_untracked_or_incomplete_source_refuse(self):
        for change in [{'cleanTrackedState':False},{'closureTracked':False},{'untrackedClosurePaths':['tools/new.js']},{'runtimeFileSha256':{}},{'runtimeFileSha256':{'engine/game.js':17}},{'runtimeFileSha256':{'engine/game.js':'e'*64}}]:
            source={**self.source,**change}
            with self.subTest(change=change),self.assertRaises(ValueError):self.validate(source=source)
    def test_missing_tampered_or_incomplete_evidence_refuse(self):
        for evidence in [[],self.qualification['evidence'][:1],[{'kind':'visual','path':'missing.json','sha256':'f'*64}]]:
            p=copy.deepcopy(self.qualification);p['evidence']=evidence
            with self.subTest(evidence=evidence),self.assertRaises(ValueError):self.validate(p)
        self.visual.write_text('changed')
        with self.assertRaises(ValueError):self.validate()
    def test_source_status_only_artifact_changes_do_not_forge_runtime_drift(self):
        after={**self.source,'workingTreeStatus':'?? artifacts/new'};self.assertTrue(B.same_source(self.source,after));after['fileSha256']={'engine/game.js':'f'*64};self.assertFalse(B.same_source(self.source,after))
    def test_guard_pid_freshness_identity_and_thermal_refusals(self):
        now=dt.datetime.now(dt.timezone.utc);guard=self.root/'guard.json';telemetry=self.root/'telemetry.jsonl'
        base={'schema':'steelmoth-sm505-physical-guard/v1','childPid':42,'endedAt':None,'failure':None,'samples':1,'deadlineUtc':(now+dt.timedelta(minutes=10)).isoformat(),'gpu':{'uuid':'GPU-test'}}
        sample={'at':now.isoformat(),'uuid':'GPU-test','name':'NVIDIA GeForce GTX 1650 SUPER','memoryTotalMiB':4096,'temperatureC':35}
        def run(g=None,t=None):guard.write_text(json.dumps(g or base));telemetry.write_text(json.dumps(t or sample)+'\n');return B.validate_guard(guard,pid=42,now=now)
        self.assertEqual(run()['childPid'],42)
        for change in [{'childPid':43},{'endedAt':now.isoformat()},{'failure':{'message':'watchdog'}},{'samples':0},{'deadlineUtc':(now-dt.timedelta(seconds=1)).isoformat()}]:
            with self.subTest(change=change),self.assertRaises(ValueError):run({**base,**change})
        for change in [{'at':(now-dt.timedelta(seconds=20)).isoformat()},{'uuid':'GPU-other'},{'name':'SwiftShader'},{'memoryTotalMiB':8192},{'temperatureC':85}]:
            with self.subTest(change=change),self.assertRaises(ValueError):run(t={**sample,**change})
    def test_full_plan_is_canonical_eight_by_three(self):
        plan=B.plan(campaign=True);self.assertEqual(len(plan),24);self.assertEqual({p['scene'] for p in plan},set(B.SCENARIO_BY_ID))
        for scene in B.SCENARIO_BY_ID:self.assertEqual([p['run'] for p in plan if p['scene']==scene],[1,2,3])
        for p in plan:self.assertTrue((B.ROOT/'render-tests/fixtures'/(p['scenario']['fixture']+'.json')).is_file())
    def test_plan_cli_never_needs_or_launches_a_browser(self):
        done=subprocess.run([sys.executable,str(B.ROOT/'tools/benchmark_sm505_normal.py'),'--plan','--campaign'],capture_output=True,text=True,timeout=20);self.assertEqual(done.returncode,0,done.stderr);payload=json.loads(done.stdout);self.assertEqual(payload['browserProcesses'],24);self.assertIn('No browser/GPU',payload['boundary'])
    def test_actual_cli_without_gates_refuses_before_execution(self):
        for args in [[],['--hardware'],['--hardware','--guard-report','missing']]:
            done=subprocess.run([sys.executable,str(B.ROOT/'tools/benchmark_sm505_normal.py'),*args],capture_output=True,text=True,timeout=20);self.assertEqual(done.returncode,2);self.assertIn('qualification-report',done.stderr)
    def test_statistics_never_trim_failed_samples(self):
        self.assertEqual(B.stats([4,1,3,2])['median'],2)
        for values in [[],[float('nan')],[1,-1]]:
            with self.assertRaises(ValueError):B.stats(values)
    def test_malformed_nested_run_records_return_errors_instead_of_crashing(self):
        args=SimpleNamespace(samples=600,warmup=300);scenario=B.SCENARIO_BY_ID['representative']
        for payload in [None,[],{'benchmark':[1]},{'benchmark':{'rawFrames':[None,17,{'passes':[None]},{'passes':'broken'}]}},{'benchmark':{'rawFrames':{'bad':'shape'},'queueSpanGpuMs':['NaN',{},True],'commandCoverage':[3],'frameAccounting':7,'cpu':'bad'},'browser':{'command':[{}]},'runtimeAfter':['webgl2'],'smoke':{'gpu':['malformed']}}]:
            with self.subTest(payload=payload):self.assertTrue(B.validate_run(payload,args,scenario))
    def test_retained_run_cannot_forge_distributions_coverage_or_ownership(self):
        scenario=B.SCENARIO_BY_ID['representative'];values=[.5]*600
        benchmark={'schema':'steelmoth-sm505-normal-benchmark-run/v1','ok':True,'restored':True,'visualAcceptance':False,'releaseAcceptance':False,'configuration':{**B.CONFIGURATION,'scenario':scenario},'queueSpanGpuMs':values,'commandGpuMs':[None]*600,'commandCoverage':{'explicitCommandSpans':0},'statistics':B.stats(values),'targets':{'meanMs':12,'p95Ms':14.5},'runThresholdPass':True,'rawFrames':[{'gpuTiming':{'readbackPending':False},'passes':[{'name':'rendererTotal','queueSpanGpuMs':.5,'commandGpuMs':None,'commandSpans':[]}]} for _ in range(600)],'cpu':{'pureEncoding':None},'frameAccounting':{'warmup':300,'presentedDelta':900,'droppedDelta':0},'sceneFingerprintBefore':'fixed','sceneFingerprintAfter':'fixed','errors':[]}
        report={'testOnlyMock':True,'benchmark':benchmark,'source':self.source,'sourceAfter':copy.deepcopy(self.source),'browserProcessExited':True,'browser':{'command':['chrome.exe']},'runtimeAfter':{'requestedBackend':'webgpu','activeBackend':'webgpu','presentationBackend':'webgpu','webgpu':{'uncapturedErrors':[]}},'hardwareRequested':True,'softwareRequested':False,'gpuInventory':{'available':True,'devices':[{'name':'NVIDIA GeForce GTX 1650 SUPER','memoryMiB':4096,'driver':'mock-driver','pciBusId':'mock-pci'}]},'smoke':{'gpu':{'adapterInfo':{'vendor':'nvidia','architecture':'turing'},'isFallbackAdapter':False}}}
        args=SimpleNamespace(samples=600,warmup=300)
        self.assertEqual(B.validate_run(report,args,scenario),[])
        mutations=[lambda p:p['benchmark']['statistics'].update(mean=.4),lambda p:p['benchmark']['targets'].update(meanMs=13),lambda p:p['benchmark']['commandGpuMs'].__setitem__(0,.1),lambda p:p['benchmark']['rawFrames'][0]['passes'][0].update(queueSpanGpuMs=.7),lambda p:p['benchmark'].update(restored=False),lambda p:p['runtimeAfter'].update(presentationBackend='webgl2'),lambda p:p['browser']['command'].append('--use-angle=swiftshader'),lambda p:p['sourceAfter'].update(commit='f'*40),lambda p:(p['source'].update(cleanTrackedState=False),p['sourceAfter'].update(cleanTrackedState=False))]
        for index,mutation in enumerate(mutations):
            changed=copy.deepcopy(report);mutation(changed)
            with self.subTest(mutation=index):self.assertTrue(B.validate_run(changed,args,scenario),'tampered run cannot satisfy timing evidence contract')


if __name__=='__main__':unittest.main()
