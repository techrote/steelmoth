#!/usr/bin/env python3
from pathlib import Path
p=Path('engine/webgpu_gbuffer.js')
s=p.read_text(encoding='utf-8')
old="const usage=textureUsage(['COPY_DST','TEXTURE_BINDING']),make=(name,src,format)=>"
new="const usage=textureUsage(['COPY_DST','TEXTURE_BINDING','RENDER_ATTACHMENT']),make=(name,src,format)=>"
if s.count(old)!=1:
    raise SystemExit(f'expected one atlas usage anchor, found {s.count(old)}')
p.write_text(s.replace(old,new),encoding='utf-8')
print('SM-502 atlas upload usage repaired')
