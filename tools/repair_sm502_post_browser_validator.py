#!/usr/bin/env python3
from pathlib import Path
p=Path('tools/validate_webgpu_post_browser.py')
s=p.read_text(encoding='utf-8')
old="    if 'SM-502' not in str(diag.get('colorSpaceBoundary')):raise RuntimeError('SM-502 colour-space deferral missing')\n"
new="    boundary=str(diag.get('colorSpaceBoundary'))\n    if 'linear/HDR' not in boundary or 'sRGB' not in boundary or 'exactly once' not in boundary:raise RuntimeError('completed SM-502 linear/HDR to sRGB boundary missing')\n"
if s.count(old)!=1: raise SystemExit(f'expected one SM-502 browser validator anchor, found {s.count(old)}')
s=s.replace(old,new)
old2="'evidenceBoundary':'Real hosted WebGPU validates compatibility bloom, bounded quality tiers, numeric grading-control sweeps, raw/debug bypass and a real preferred-format GPUCanvasContext. It does not claim SM-502 colour-space redesign, SM-505 backend promotion, target-GPU performance, or subjective visual approval.'"
new2="'evidenceBoundary':'Real hosted WebGPU validates compatibility bloom, bounded quality tiers, numeric grading-control sweeps, the completed SM-502 linear-to-sRGB post/display boundary, raw/debug presentation and a real preferred-format GPUCanvasContext. It does not claim SM-505 backend promotion, target-GPU performance, or subjective visual approval.'"
if s.count(old2)!=1: raise SystemExit(f'expected one SM-207 evidence-boundary anchor, found {s.count(old2)}')
p.write_text(s.replace(old2,new2),encoding='utf-8')
print('SM-502 post browser validator migrated')
