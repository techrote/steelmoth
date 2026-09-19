#!/usr/bin/env python3
from pathlib import Path
p=Path('engine/webgpu_post.js')
s=p.read_text(encoding='utf-8')
old="return{SCHEMA,DEFAULTS,normalizeSettings,bloomPassesForQuality,linearChannelToSrgb,linearToSrgb,applyPostReference,packPostSettings,preferredCanvasFormat,WebGPUPost};"
new="return{SCHEMA,DEFAULTS,BRIGHT_WGSL,BLUR_WGSL,POST_WGSL,RAW_WGSL,normalizeSettings,bloomPassesForQuality,linearChannelToSrgb,linearToSrgb,applyPostReference,packPostSettings,preferredCanvasFormat,WebGPUPost};"
if s.count(old)!=1:
    raise SystemExit(f'expected one SM-502 post export anchor, found {s.count(old)}')
p.write_text(s.replace(old,new),encoding='utf-8')
print('SM-502 post exports repaired')
