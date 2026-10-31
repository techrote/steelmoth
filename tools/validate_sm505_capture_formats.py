#!/usr/bin/env python3
"""CPU custody regression: padded float mask bytes must survive PNG previewing."""
import base64
from pathlib import Path
import tempfile
import unittest
import numpy as np
from PIL import Image
from diagnose_sm505_presentation import save_item


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


if __name__=='__main__':unittest.main()
