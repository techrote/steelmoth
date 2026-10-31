#!/usr/bin/env python3
"""CPU custody regression: padded float mask bytes must survive PNG previewing."""
import base64
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import json
import numpy as np
from PIL import Image
from diagnose_sm505_presentation import ObserverCDP, save_item


class CaptureFormats(unittest.TestCase):
    def test_padded_scalar_masks_preserve_original_bytes_and_numeric_values(self):
        for fmt, dtype in [('r16float','<f2'), ('r32float','<f4')]:
            with self.subTest(format=fmt), tempfile.TemporaryDirectory() as name:
                # Poison padding catches accidental row interpretation. Fractional
                # values distinguish visibility data from display sRGB conversion.
                rows=np.full((2,256),0xcd,dtype=np.uint8)
                expected=np.array([[0,.25,1],[.5,.75,1]],dtype=dtype)
                rows[:,:expected.shape[1]*expected.dtype.itemsize]=expected.view(np.uint8).reshape(2,-1)
                raw=rows.tobytes();out=Path(name)
                item={'name':'mask','width':3,'height':2,'rowBytes':256,'format':fmt,'kind':'visibility','base64':base64.b64encode(raw).decode()}
                save_item(out,item)
                self.assertEqual((out/'mask.bin').read_bytes(),raw)
                self.assertTrue(item['finite'])
                self.assertEqual(item['channels']['visibility']['zeroPixels'],1)
                self.assertEqual(item['channels']['visibility']['belowNeutralPixels'],4)
                self.assertAlmostEqual(item['channels']['visibility']['mean'],7/12,places=6)
                rgba=np.array(Image.open(out/'mask.png'))
                self.assertEqual(tuple(rgba.shape[:2]),(2,3))
                self.assertLessEqual(abs(int(rgba[0,1,0])-64),1)
                self.assertEqual(int(rgba[0,2,0]),255)

    def test_rgba_visibility_reports_dedicated_channels(self):
        with tempfile.TemporaryDirectory() as name:
            rows=np.zeros((1,256),dtype=np.uint8)
            expected=np.array([[.2,0,.7,0],[1,1,1,1]],dtype='<f2')
            rows[0,:16]=expected.view(np.uint8).reshape(-1)
            item={'name':'composed','width':2,'height':1,'rowBytes':256,'format':'rgba16float','kind':'visibility-channels','base64':base64.b64encode(rows.tobytes()).decode()}
            save_item(Path(name),item)
            self.assertEqual(set(item['channels']),{'combined','direct','ambient','dso'})
            self.assertEqual(item['channels']['direct']['zeroPixels'],1)
            self.assertEqual(item['channels']['ambient']['zeroPixels'],0)
            self.assertAlmostEqual(item['channels']['ambient']['minimum'],.7,places=3)


class ObserverDeadlines(unittest.TestCase):
    def observer(self):
        class Socket:
            sent=[]
            timeouts=[]
            receives=0
            def settimeout(self,value):self.timeouts.append(value)
            def send(self,value):self.sent.append(value)
            def recv(self):self.receives+=1;return json.dumps({'method':'Runtime.consoleAPICalled','params':{'message':'retained before deadline'}})
        observer=object.__new__(ObserverCDP);observer.ws=Socket();observer.serial=0;observer.events=[];observer.exceptions=[];observer.timeout=120;observer.deadline=5
        return observer

    def test_expired_workload_never_sends_browser_command(self):
        observer=self.observer()
        with patch('diagnose_sm505_presentation.time.monotonic',return_value=5):
            with self.assertRaises(TimeoutError):observer.call('MustNotLaunch')
        self.assertEqual(observer.serial,0);self.assertEqual(observer.ws.receives,0)

    def test_events_cannot_extend_global_workload_deadline(self):
        observer=self.observer()
        with patch('diagnose_sm505_presentation.time.monotonic',side_effect=[0,0,5]):
            with self.assertRaises(TimeoutError):observer.call('ReadOnlyState')
        self.assertEqual(observer.ws.receives,1)
        self.assertEqual(len(observer.events),1,'original event survives deadline failure')
        self.assertTrue(all(0<t<=5 for t in observer.ws.timeouts),'socket waits remain inside the workload budget')


if __name__=='__main__':unittest.main()
