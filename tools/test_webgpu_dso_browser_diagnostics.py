#!/usr/bin/env python3
"""Regression for SM-303 timeout diagnostics; no browser or GPU required."""
from __future__ import annotations
import json
from pathlib import Path
from validate_webgpu_dso_browser import CDP, normalize_readiness, probe_readiness

ROOT=Path(__file__).resolve().parents[1]
checks=0
def check(value,message):
    global checks
    if not value: raise AssertionError(message)
    checks+=1

bad=normalize_readiness(None)
check(not bad['done'] and bad['stage'] is None and bad['resultLength']==0,'invalid CDP payload fails closed')
pending=normalize_readiness({'done':False,'documentReadyState':'complete','hasBody':True,'stage':'request-adapter','resultLength':0})
check(not pending['done'] and pending['stage']=='request-adapter' and pending['hasBody'],'ready document is not smoke success')
check(normalize_readiness({'done':1})['done'] is False,'truthy nonboolean is not accepted')
check(normalize_readiness({'done':True,'resultLength':999999999})['resultLength']==1000000,'bounded length')
check(normalize_readiness({'done':False,'stage':'x'*200})['stage']=='x'*64,'stage bounded')
check(normalize_readiness({'done':True,'resultLength':'bad'})['resultLength']==0,'malformed length handled')

class FakeCDP:
    def __init__(self, payload):self.payload=payload;self.expr=''
    def eval(self,expr):self.expr=expr;return self.payload
cdp=FakeCDP({'done':False,'stage':'gpu-readback-sweep','hasBody':True,'documentReadyState':'complete','resultLength':0})
state=probe_readiness(cdp)
check(state['stage']=='gpu-readback-sweep' and not state['done'],'probe retains readback phase')
check('webgpuDsoDone' in cdp.expr and 'webgpuDsoStage' in cdp.expr,'probe observes authoritative page signals')

class WS:
    def __init__(self):self.incoming=iter([
        {'method':'Runtime.exceptionThrown','params':{'exceptionDetails':{'text':'adapter failed'}}},
        {'method':'Runtime.consoleAPICalled','params':{'args':[{'value':'diagnostic'}]}},
        {'id':1,'result':{'ok':True}},
    ])
    def send(self,data):self.sent=json.loads(data)
    def recv(self):return json.dumps(next(self.incoming))
fake=CDP.__new__(CDP);fake.ws=WS();fake.seq=0;fake.events=[]
check(fake.call('Runtime.evaluate')['ok'],'CDP reply remains authoritative with interleaved events')
check(len(fake.events)==2 and fake.events[0]['message']=='adapter failed','runtime exceptions captured without swallowing reply')

html=(ROOT/'webgpu-dso-smoke.html').read_text(encoding='utf-8')
for stage in ('request-adapter','request-device','module-imports','gpu-readback-sweep','owner-stability','published'):
    check("webgpuDsoStage='"+stage+"'" in html,'fixture exposes stage '+stage)
print('SM-303 DSO timeout-diagnostics regression: PASS',checks,'checks')
