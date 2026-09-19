'use strict';

(function(root, factory){
  const Resources = root?.SteelMothWebGPUResources || ((typeof module === 'object' && module.exports) ? require('./webgpu_resources.js') : null);
  const DSO = root?.SteelMothWebGPUDSO || ((typeof module === 'object' && module.exports) ? require('./webgpu_dso.js') : null);
  const Hierarchy = root?.SteelMothWebGPUDSOHierarchy || ((typeof module === 'object' && module.exports) ? require('./webgpu_dso_hierarchy.js') : null);
  const api = factory(Resources, DSO, Hierarchy, root);
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.SteelMothWebGPUDarkBloom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Resources, DSO, Hierarchy, root){
  if(!Resources) throw new Error('SteelMothWebGPUResources is required before webgpu_dark_bloom');
  if(!DSO) throw new Error('SteelMothWebGPUDSO is required before webgpu_dark_bloom');
  if(!Hierarchy) throw new Error('SteelMothWebGPUDSOHierarchy is required before webgpu_dark_bloom');

  const SCHEMA = 'steelmoth-webgpu-dark-bloom/v1';
  const SNAPSHOT_SCHEMA = 'steelmoth-webgpu-dark-bloom-snapshot/v1';
  const SCALE = 2;
  const QUALITY = Object.freeze({
    Low: Object.freeze({nearRadius:1, midRadius:2, farRadius:3, nearStrength:.08, midStrength:.18, farStrength:.28, depthThreshold:.018}),
    Medium: Object.freeze({nearRadius:1, midRadius:3, farRadius:4, nearStrength:.10, midStrength:.22, farStrength:.34, depthThreshold:.020}),
    High: Object.freeze({nearRadius:2, midRadius:4, farRadius:6, nearStrength:.12, midStrength:.26, farStrength:.40, depthThreshold:.022}),
    Ultra: Object.freeze({nearRadius:2, midRadius:5, farRadius:8, nearStrength:.14, midStrength:.30, farStrength:.45, depthThreshold:.025})
  });
  const DEFAULTS = Object.freeze({quality:'Medium'});
  const FALLBACK_BUFFER_USAGE = Object.freeze({MAP_READ:0x0001, COPY_SRC:0x0004, COPY_DST:0x0008, UNIFORM:0x0040, STORAGE:0x0080});
  const FALLBACK_TEXTURE_USAGE = Object.freeze({COPY_SRC:0x01, COPY_DST:0x02, TEXTURE_BINDING:0x04, STORAGE_BINDING:0x08});
  const MAP_MODE_READ = 0x0001;
  const finite = (v, f=0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const align = (v, m=4) => Math.ceil(Math.max(0, Number(v) || 0) / m) * m;
  const bufferUsage = names => names.reduce((v,n) => v | Number(root?.GPUBufferUsage?.[n] ?? FALLBACK_BUFFER_USAGE[n] ?? 0), 0);
  const textureUsage = names => names.reduce((v,n) => v | Number(root?.GPUTextureUsage?.[n] ?? FALLBACK_TEXTURE_USAGE[n] ?? 0), 0);

  function qualityName(value){
    const s = String(value || DEFAULTS.quality).toLowerCase();
    return Object.keys(QUALITY).find(k => k.toLowerCase() === s) || DEFAULTS.quality;
  }

  function qualitySettings(value, overrides={}){
    const q = {...QUALITY[qualityName(value)], ...overrides};
    for(const k of ['nearRadius','midRadius','farRadius']) q[k] = clamp(Math.round(finite(q[k])), 0, 8);
    q.nearRadius = Math.min(q.nearRadius, q.midRadius);
    q.midRadius = Math.min(q.midRadius, q.farRadius);
    for(const k of ['nearStrength','midStrength','farStrength']) q[k] = clamp(finite(q[k]), 0, .95);
    q.nearStrength = Math.min(q.nearStrength, q.midStrength);
    q.midStrength = Math.min(q.midStrength, q.farStrength);
    q.depthThreshold = clamp(finite(q.depthThreshold, .02), .001, .25);
    return q;
  }

  function unwrapHierarchy(input){
    const plan = input?.snapshot?.schema === Hierarchy.SNAPSHOT_SCHEMA ? input.snapshot : input;
    if(!plan || plan.schema !== Hierarchy.SNAPSHOT_SCHEMA) throw new Error(`SM-305 requires ${Hierarchy.SNAPSHOT_SCHEMA} input from SM-304`);
    return plan;
  }

  function lowDimensions(width, height){
    return {width:Math.ceil(width / SCALE), height:Math.ceil(height / SCALE)};
  }

  function contourBounds(record, tier){
    return tier >= 2 ? record.farBounds : tier >= 1 ? record.midBounds : record.nearBounds;
  }

  function tierAtPoint(plan, p){
    let found = 0;
    for(const job of plan.jobs || []){
      const distance = Hierarchy.sourceDistance(p, job.nearBounds, job.shadowDir);
      const level = Hierarchy.levelForDistance(distance, job);
      const tier = level === 'far' ? 2 : level === 'mid' ? 1 : 0;
      let hit = DSO.sweptContains(p[0], p[1], contourBounds(job, tier), job.shadowDir, job.ownerThrow);
      if(!hit){
        for(let m=0; m<job.memberCount && !hit; m++){
          const member = plan.members[job.memberOffset + m];
          if(member && member.maxTier >= tier) hit = DSO.sweptContains(p[0], p[1], contourBounds(member, tier), job.shadowDir, member.throwLength);
        }
      }
      if(hit) found = Math.max(found, tier + 1);
    }
    return found;
  }

  function tierForJobAtPoint(plan, job, p){
    const distance = Hierarchy.sourceDistance(p, job.nearBounds, job.shadowDir);
    const level = Hierarchy.levelForDistance(distance, job);
    const tier = level === 'far' ? 2 : level === 'mid' ? 1 : 0;
    let hit = DSO.sweptContains(p[0], p[1], contourBounds(job, tier), job.shadowDir, job.ownerThrow);
    if(!hit){
      for(let m=0; m<job.memberCount && !hit; m++){
        const member = plan.members[job.memberOffset + m];
        if(member && member.maxTier >= tier) hit = DSO.sweptContains(p[0], p[1], contourBounds(member, tier), job.shadowDir, member.throwLength);
      }
    }
    return hit ? tier + 1 : 0;
  }

  function buildTierMap(hierarchyInput, reuseData=null){
    const plan = unwrapHierarchy(hierarchyInput);
    const low = lowDimensions(plan.grid.width, plan.grid.height);
    const length = low.width * low.height;
    const map = reuseData instanceof Uint32Array && reuseData.length === length ? reuseData : new Uint32Array(length);
    map.fill(0);
    const counts = [0,0,0,0];
    const jobs = plan.jobs || [];
    let candidatePixels = 0;
    const p = [0,0];

    // Each job rasterizes only its own swept extent. The previous implementation
    // called tierAtPoint() here, which rescanned every job for every candidate
    // pixel and turned this stage into O(candidatePixels * jobCount) work.
    for(const job of jobs){
      const bounds = job.sweptBounds || DSO.sweptBounds(job.farBounds, job.shadowDir, job.ownerThrow);
      if(bounds[2] <= 0 || bounds[3] <= 0 || bounds[0] >= plan.grid.width || bounds[1] >= plan.grid.height) continue;
      const x0 = clamp(Math.floor(bounds[0] / SCALE), 0, low.width - 1);
      const y0 = clamp(Math.floor(bounds[1] / SCALE), 0, low.height - 1);
      const x1 = clamp(Math.floor((bounds[2] - 1e-6) / SCALE), 0, low.width - 1);
      const y1 = clamp(Math.floor((bounds[3] - 1e-6) / SCALE), 0, low.height - 1);
      for(let y=y0; y<=y1; y++) for(let x=x0; x<=x1; x++){
        p[0] = Math.min(plan.grid.width - .5, x*SCALE + SCALE*.5);
        p[1] = Math.min(plan.grid.height - .5, y*SCALE + SCALE*.5);
        const index = y*low.width + x;
        const tier = tierForJobAtPoint(plan, job, p);
        candidatePixels++;
        if(tier > map[index]) map[index] = tier;
      }
    }
    for(const v of map) counts[v]++;
    return {
      width:low.width,
      height:low.height,
      data:map,
      counts,
      diagnostics:{
        jobCount:jobs.length,
        candidatePixels,
        jobTests:candidatePixels,
        eliminatedNestedJobRescans:candidatePixels * Math.max(0, jobs.length - 1)
      }
    };
  }

  function reducedCore(hardMask, width, height){
    const low = lowDimensions(width, height);
    const out = new Uint8Array(low.width * low.height);
    for(let ly=0; ly<low.height; ly++) for(let lx=0; lx<low.width; lx++){
      let hit = 0;
      for(let oy=0; oy<SCALE && !hit; oy++) for(let ox=0; ox<SCALE; ox++){
        const x = lx*SCALE + ox;
        const y = ly*SCALE + oy;
        if(x < width && y < height && finite(hardMask?.[y*width+x]) > .5){hit = 1; break;}
      }
      out[ly*low.width+lx] = hit;
    }
    return {...low, data:out};
  }

  function depthAtLow(depth, width, height, lx, ly){
    const x = Math.min(width - 1, lx*SCALE + Math.floor(SCALE/2));
    const y = Math.min(height - 1, ly*SCALE + Math.floor(SCALE/2));
    return clamp(finite(depth?.[y*width+x], 1), 0, 1);
  }

  function depthCompatible(a, b, threshold){
    return Math.abs(finite(a,1) - finite(b,1)) <= threshold;
  }

  function settingsForTier(q, tier){
    return tier >= 3 ? [q.farRadius,q.farStrength] : tier === 2 ? [q.midRadius,q.midStrength] : [q.nearRadius,q.nearStrength];
  }

  function referenceFromTierMap(hardMask, depth, width, height, tierMap, quality='Medium', overrides={}){
    const q = qualitySettings(quality, overrides);
    const core = reducedCore(hardMask, width, height);
    const lowW = core.width, lowH = core.height;
    if(!tierMap || tierMap.length !== lowW*lowH) throw new Error('SM-305 tier map dimensions do not match reduced target');
    const lowBloom = new Float32Array(lowW*lowH);
    const maxRadius = q.farRadius;

    for(let y=0; y<lowH; y++) for(let x=0; x<lowW; x++){
      const index = y*lowW+x;
      if(core.data[index]) continue;
      const receiverDepth = depthAtLow(depth, width, height, x, y);
      let best = 0;
      for(let oy=-maxRadius; oy<=maxRadius; oy++) for(let ox=-maxRadius; ox<=maxRadius; ox++){
        const sx = x+ox, sy = y+oy;
        if(sx<0 || sy<0 || sx>=lowW || sy>=lowH) continue;
        const sourceIndex = sy*lowW+sx;
        const tier = tierMap[sourceIndex];
        if(!core.data[sourceIndex] || !tier) continue;
        const [radius,strength] = settingsForTier(q, tier);
        const distance = Math.hypot(ox,oy);
        if(distance <= 0 || distance > radius) continue;
        const sourceDepth = depthAtLow(depth, width, height, sx, sy);
        if(!depthCompatible(receiverDepth, sourceDepth, q.depthThreshold)) continue;
        best = Math.max(best, strength*(1-distance/(radius+1)));
      }
      lowBloom[index] = best;
    }

    const full = new Float32Array(width*height);
    let peak = 0, bloomPixels = 0;
    for(let y=0; y<height; y++) for(let x=0; x<width; x++){
      const fullIndex = y*width+x;
      if(finite(hardMask?.[fullIndex]) > .5){full[fullIndex] = 0; continue;}
      const gx = (x+.5)/SCALE-.5, gy = (y+.5)/SCALE-.5;
      const x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx-x0, ty = gy-y0;
      const receiverDepth = clamp(finite(depth?.[fullIndex],1),0,1);
      let sum = 0, weightSum = 0;
      for(let oy=0; oy<2; oy++) for(let ox=0; ox<2; ox++){
        const lx=x0+ox, ly=y0+oy;
        if(lx<0 || ly<0 || lx>=lowW || ly>=lowH) continue;
        const weight = (ox ? tx : 1-tx) * (oy ? ty : 1-ty);
        if(weight <= 0) continue;
        const sampleDepth = depthAtLow(depth,width,height,lx,ly);
        if(!depthCompatible(receiverDepth,sampleDepth,q.depthThreshold)) continue;
        sum += lowBloom[ly*lowW+lx]*weight;
        weightSum += weight;
      }
      const value = weightSum > 0 ? sum/weightSum : 0;
      full[fullIndex] = value;
      if(value > 0) bloomPixels++;
      peak = Math.max(peak,value);
    }

    return {
      schema:SNAPSHOT_SCHEMA, quality:qualityName(quality), settings:q,
      width,height,lowWidth:lowW,lowHeight:lowH,core:core.data,lowBloom,full,tierMap,
      diagnostics:{peakContribution:peak,bloomPixels,corePixels:core.data.reduce((n,v)=>n+(v?1:0),0),maxRadiusReduced:maxRadius,maxRadiusPixels:maxRadius*SCALE,nearStrength:q.nearStrength,midStrength:q.midStrength,farStrength:q.farStrength,depthThreshold:q.depthThreshold,noTemporal:true}
    };
  }

  function buildReference(hardMask, depth, hierarchyInput, options={}){
    const plan = unwrapHierarchy(hierarchyInput);
    const tier = buildTierMap(plan);
    return referenceFromTierMap(hardMask, depth, plan.grid.width, plan.grid.height, tier.data, options.quality || DEFAULTS.quality, options.qualityOverrides || {});
  }

  function bloomMetrics(result){
    let sum=0, nonzero=0, max=0;
    for(const value of result.full || []){const v=finite(value);sum+=v;if(v>0)nonzero++;max=Math.max(max,v);}
    return {peak:max,mean:result.full?.length?sum/result.full.length:0,nonzeroPixels:nonzero,corePixels:result.diagnostics?.corePixels||0,maxRadiusPixels:result.diagnostics?.maxRadiusPixels||0};
  }

  const BLOOM_WGSL = `
struct Params { full:vec4<u32>, radii:vec4<f32>, strengths:vec4<f32>, misc:vec4<f32> };
@group(0) @binding(0) var coreTex:texture_2d<f32>;
@group(0) @binding(1) var rangeTex:texture_2d<f32>;
@group(0) @binding(2) var<storage,read> tiers:array<u32>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var bloomOut:texture_storage_2d<r32float,write>;
fn low_core(p:vec2<i32>)->bool{
  let base=p*2;
  for(var oy:i32=0;oy<2;oy++){for(var ox:i32=0;ox<2;ox++){
    let q=base+vec2<i32>(ox,oy);
    if(q.x<i32(params.full.x)&&q.y<i32(params.full.y)&&textureLoad(coreTex,q,0).x>0.5){return true;}
  }}
  return false;
}
fn low_depth(p:vec2<i32>)->f32{
  let q=min(p*2+vec2<i32>(1),vec2<i32>(i32(params.full.x)-1,i32(params.full.y)-1));
  let r=textureLoad(rangeTex,q,0).rg;
  return select(1.0,r.x,r.x<=r.y);
}
fn radius_for(t:u32)->f32{return select(select(params.radii.x,params.radii.y,t==2u),params.radii.z,t>=3u);}
fn strength_for(t:u32)->f32{return select(select(params.strengths.x,params.strengths.y,t==2u),params.strengths.z,t>=3u);}
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3<u32>){
  if(gid.x>=params.full.z||gid.y>=params.full.w){return;}
  let p=vec2<i32>(gid.xy);
  if(low_core(p)){textureStore(bloomOut,p,vec4<f32>(0.0));return;}
  let receiverDepth=low_depth(p);
  var best=0.0;
  for(var oy:i32=-8;oy<=8;oy++){for(var ox:i32=-8;ox<=8;ox++){
    let s=p+vec2<i32>(ox,oy);
    if(s.x<0||s.y<0||s.x>=i32(params.full.z)||s.y>=i32(params.full.w)){continue;}
    let sourceIndex=u32(s.y)*params.full.z+u32(s.x);
    let tier=tiers[sourceIndex];
    if(tier==0u||!low_core(s)){continue;}
    let radius=radius_for(tier);
    let distance=length(vec2<f32>(f32(ox),f32(oy)));
    if(distance<=0.0||distance>radius){continue;}
    let sourceDepth=low_depth(s);
    if(abs(receiverDepth-sourceDepth)>params.misc.x){continue;}
    let value=strength_for(tier)*(1.0-distance/(radius+1.0));
    best=max(best,value);
  }}
  textureStore(bloomOut,p,vec4<f32>(best,0.0,0.0,1.0));
}`;

  const UPSAMPLE_WGSL = `
struct Params { full:vec4<u32>, radii:vec4<f32>, strengths:vec4<f32>, misc:vec4<f32> };
@group(0) @binding(0) var lowTex:texture_2d<f32>;
@group(0) @binding(1) var coreTex:texture_2d<f32>;
@group(0) @binding(2) var rangeTex:texture_2d<f32>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var fullOut:texture_storage_2d<r32float,write>;
fn low_depth(p:vec2<i32>)->f32{
  let q=min(p*2+vec2<i32>(1),vec2<i32>(i32(params.full.x)-1,i32(params.full.y)-1));
  let r=textureLoad(rangeTex,q,0).rg;
  return select(1.0,r.x,r.x<=r.y);
}
fn full_depth(p:vec2<i32>)->f32{
  let r=textureLoad(rangeTex,p,0).rg;
  return select(1.0,r.x,r.x<=r.y);
}
@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3<u32>){
  if(gid.x>=params.full.x||gid.y>=params.full.y){return;}
  let p=vec2<i32>(gid.xy);
  if(textureLoad(coreTex,p,0).x>0.5){textureStore(fullOut,p,vec4<f32>(0.0));return;}
  let g=(vec2<f32>(gid.xy)+vec2<f32>(0.5))/2.0-vec2<f32>(0.5);
  let base=vec2<i32>(floor(g));
  let t=fract(g);
  let receiverDepth=full_depth(p);
  var sum=0.0;
  var weightSum=0.0;
  for(var oy:i32=0;oy<2;oy++){for(var ox:i32=0;ox<2;ox++){
    let q=base+vec2<i32>(ox,oy);
    if(q.x<0||q.y<0||q.x>=i32(params.full.z)||q.y>=i32(params.full.w)){continue;}
    let wx=select(1.0-t.x,t.x,ox==1);
    let wy=select(1.0-t.y,t.y,oy==1);
    let weight=wx*wy;
    if(weight<=0.0||abs(receiverDepth-low_depth(q))>params.misc.x){continue;}
    sum+=textureLoad(lowTex,q,0).x*weight;
    weightSum+=weight;
  }}
  var value=0.0;
  if(weightSum>0.0){value=sum/weightSum;}
  textureStore(fullOut,p,vec4<f32>(value,0.0,0.0,1.0));
}`;

  class WebGPUDarkBloom{
    constructor(options={}){
      if(!options.device) throw new Error('WebGPUDarkBloom requires GPUDevice');
      this.device=options.device;this.queue=options.queue||options.device.queue;this.options={...DEFAULTS,...options};
      this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));
      this.registry=null;this.pipelineCache=null;this.bloomPipeline=null;this.upsamplePipeline=null;this.snapshot=null;this.valid=false;this.closed=false;
      this.generation=0;this.updateCount=0;this.uploadCount=0;this.dispatchCount=0;this.invalidationCount=0;this.lastInvalidationReason='uninitialized';this.lastRoomId=null;this.tierCacheKey=null;this.tierCache=null;this.tierBuildCount=0;this.tierReuseCount=0;
      this.configure(this.width,this.height);
    }
    _name(name){return `sm305:${name}`;}
    configure(width,height){
      if(this.closed) throw new Error('WebGPUDarkBloom is closed');
      width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));
      if(this.registry&&width===this.width&&height===this.height) return false;
      if(this.registry) this.registry.close();if(this.pipelineCache) this.pipelineCache.clear();
      this.width=width;this.height=height;const low=lowDimensions(width,height);
      this.registry=new Resources.ResourceRegistry({device:this.device,queue:this.queue,width,height,labelPrefix:'SteelMothDarkBloom'});
      this.pipelineCache=this.pipelineCache||new Resources.PipelineCache(this.device,{labelPrefix:'SteelMothDarkBloom'});
      const textureFlags=textureUsage(['TEXTURE_BINDING','STORAGE_BINDING','COPY_SRC']);
      const bufferFlags=bufferUsage(['STORAGE','COPY_DST','COPY_SRC']);
      this.registry.defineTexture(this._name('low'),{format:'r32float',usage:textureFlags,size:{width:low.width,height:low.height,depthOrArrayLayers:1},resizeDependent:false});
      this.registry.defineTexture(this._name('full'),{format:'r32float',usage:textureFlags,size:'surface'});
      this.registry.defineBuffer(this._name('tiers'),{size:Math.max(4,low.width*low.height*4),usage:bufferFlags});
      this.registry.defineBuffer(this._name('params'),{size:64,usage:bufferUsage(['UNIFORM','COPY_DST'])});
      this.bloomPipeline=null;this.upsamplePipeline=null;this.tierCacheKey=null;this.tierCache=null;this.generation++;this.invalidate('configure');return true;
    }
    resize(width,height){return this.configure(width,height);}
    resetDevice(device,queue=device?.queue){
      if(!device) throw new Error('resetDevice requires GPUDevice');
      this.device=device;this.queue=queue||device.queue;if(this.registry)this.registry.close();this.registry=null;
      if(this.pipelineCache)this.pipelineCache.resetDevice(device);this.bloomPipeline=null;this.upsamplePipeline=null;this.generation++;
      this.configure(this.width,this.height);this.invalidate('device-reset');return this.generation;
    }
    invalidate(reason='explicit'){this.valid=false;this.snapshot=null;this.invalidationCount++;this.lastInvalidationReason=String(reason||'explicit');return this.invalidationCount;}
    async _pipelines(){
      if(this.bloomPipeline&&this.upsamplePipeline)return;
      this.bloomPipeline=await this.pipelineCache.getCompute('dark-bloom-v1',async(device,label)=>{
        const module=device.createShaderModule({label:`${label}:wgsl`,code:BLOOM_WGSL});
        if(typeof module.getCompilationInfo==='function'){const info=await module.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error(`SM-305 bloom WGSL compilation failed: ${errors.map(e=>e.message).join('; ')}`);}
        return device.createComputePipeline({label,layout:'auto',compute:{module,entryPoint:'cs_main'}});
      });
      this.upsamplePipeline=await this.pipelineCache.getCompute('dark-bloom-upsample-v1',async(device,label)=>{
        const module=device.createShaderModule({label:`${label}:wgsl`,code:UPSAMPLE_WGSL});
        if(typeof module.getCompilationInfo==='function'){const info=await module.getCompilationInfo(),errors=(info.messages||[]).filter(m=>m.type==='error');if(errors.length)throw new Error(`SM-305 upsample WGSL compilation failed: ${errors.map(e=>e.message).join('; ')}`);}
        return device.createComputePipeline({label,layout:'auto',compute:{module,entryPoint:'cs_main'}});
      });
    }
    _record(name){if(!this.valid)throw new Error(`Dark Bloom is invalid: ${this.lastInvalidationReason}`);return this.registry.require(this._name(name));}
    sourceFromPaths(dsoHierarchy,depthHierarchy){
      if(!dsoHierarchy?.snapshot||typeof dsoHierarchy.bindings!=='function')throw new Error('sourceFromPaths requires SM-304 WebGPUDSOHierarchy');
      if(typeof depthHierarchy?.levelView!=='function')throw new Error('sourceFromPaths requires SM-203 WebGPUDepthHierarchy');
      return{hierarchySnapshot:dsoHierarchy.snapshot,hardMaskView:dsoHierarchy.bindings().mask,depthRangeView:depthHierarchy.levelView(0),width:dsoHierarchy.width,height:dsoHierarchy.height,roomId:dsoHierarchy.snapshot.roomId};
    }
    async update(source={},options={}){
      const plan=unwrapHierarchy(source.hierarchySnapshot||source.snapshot),width=Math.max(1,Math.round(source.width||plan.grid.width)),height=Math.max(1,Math.round(source.height||plan.grid.height));
      if(!source.hardMaskView||!source.depthRangeView)throw new Error('SM-305 update requires hardMaskView and canonical SM-203 depthRangeView');
      if(width!==this.width||height!==this.height)this.configure(width,height);
      const roomId=String(source.roomId||plan.roomId||'unknown-room');if(this.lastRoomId!==null&&roomId!==this.lastRoomId)this.invalidate('room-change');
      const quality=qualityName(options.quality||this.options.quality),settings=qualitySettings(quality,options.qualityOverrides||{}),low=lowDimensions(width,height);
      const tierKey=plan.signature?\`${width}x${height}:${plan.signature}\`:null;
      let tier,tierReused=false;
      if(tierKey&&this.tierCache&&this.tierCacheKey===tierKey){tier=this.tierCache;tierReused=true;this.tierReuseCount++;}
      else{tier=buildTierMap(plan,this.tierCache?.data||null);this.tierCache=tier;this.tierCacheKey=tierKey;this.tierBuildCount++;}
      const tierBytes=new Uint8Array(tier.data.buffer,tier.data.byteOffset,tier.data.byteLength),tiers=this.registry.require(this._name('tiers')).handle,params=this.registry.require(this._name('params')).handle;
      if(!tierReused)this.queue.writeBuffer(tiers,0,tierBytes);
      const paramBuffer=new ArrayBuffer(64),u=new Uint32Array(paramBuffer),f=new Float32Array(paramBuffer);
      u[0]=width;u[1]=height;u[2]=low.width;u[3]=low.height;
      f[4]=settings.nearRadius;f[5]=settings.midRadius;f[6]=settings.farRadius;f[7]=settings.farRadius;
      f[8]=settings.nearStrength;f[9]=settings.midStrength;f[10]=settings.farStrength;f[11]=settings.farStrength;
      f[12]=settings.depthThreshold;f[13]=SCALE;
      this.queue.writeBuffer(params,0,new Uint8Array(paramBuffer));this.uploadCount+=tierReused?1:2;
      await this._pipelines();
      const lowView=this.registry.require(this._name('low')).handle.createView(),fullView=this.registry.require(this._name('full')).handle.createView();
      const reducedBind=this.device.createBindGroup({label:'SteelMothDarkBloom:reduced-bind',layout:this.bloomPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:source.hardMaskView},{binding:1,resource:source.depthRangeView},{binding:2,resource:{buffer:tiers}},{binding:3,resource:{buffer:params}},{binding:4,resource:lowView}]});
      const upsampleBind=this.device.createBindGroup({label:'SteelMothDarkBloom:upsample-bind',layout:this.upsamplePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:lowView},{binding:1,resource:source.hardMaskView},{binding:2,resource:source.depthRangeView},{binding:3,resource:{buffer:params}},{binding:4,resource:fullView}]});
      const encoder=this.device.createCommandEncoder({label:'SteelMothDarkBloom:encoder'});
      {const pass=encoder.beginComputePass({label:'SteelMothDarkBloom:reduced'});pass.setPipeline(this.bloomPipeline);pass.setBindGroup(0,reducedBind);pass.dispatchWorkgroups(Math.ceil(low.width/8),Math.ceil(low.height/8));pass.end();}
      {const pass=encoder.beginComputePass({label:'SteelMothDarkBloom:upsample'});pass.setPipeline(this.upsamplePipeline);pass.setBindGroup(0,upsampleBind);pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));pass.end();}
      this.queue.submit([encoder.finish()]);if(typeof this.queue.onSubmittedWorkDone==='function'&&options.wait!==false)await this.queue.onSubmittedWorkDone();
      this.snapshot={schema:SNAPSHOT_SCHEMA,roomId,quality,settings,width,height,lowWidth:low.width,lowHeight:low.height,tierCounts:tier.counts,sourceHierarchySignature:plan.signature,diagnostics:{boundedRadius:true,maxRadiusReduced:settings.farRadius,maxRadiusPixels:settings.farRadius*SCALE,peakBound:settings.farStrength,nearContribution:settings.nearStrength,farContribution:settings.farStrength,depthAwareUpsample:true,temporalAccumulation:false,tierMapReused:tierReused,tierMapBuilds:this.tierBuildCount,tierMapReuses:this.tierReuseCount,tierMap:tier.diagnostics||null}};
      this.valid=true;this.lastRoomId=roomId;this.lastInvalidationReason='';this.updateCount++;this.dispatchCount+=2;return this.diagnostics();
    }
    bindings(){return{residual:this._record('full').handle.createView(),reduced:this._record('low').handle.createView(),format:'r32float',quality:this.snapshot.quality,generation:this.generation};}
    async readback(){
      const texture=this._record('full').handle,w=this.width,h=this.height,rowBytes=w*4,bytesPerRow=align(rowBytes,256),size=bytesPerRow*h;
      const map=this.device.createBuffer({label:'SteelMothDarkBloom:readback',size,usage:bufferUsage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder({label:'SteelMothDarkBloom:readback-encoder'});
      encoder.copyTextureToBuffer({texture},{buffer:map,bytesPerRow,rowsPerImage:h},{width:w,height:h,depthOrArrayLayers:1});this.queue.submit([encoder.finish()]);
      await map.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const raw=new Uint8Array(map.getMappedRange()),out=new Float32Array(w*h);
      for(let y=0;y<h;y++){const row=new DataView(raw.buffer,raw.byteOffset+y*bytesPerRow,rowBytes);for(let x=0;x<w;x++)out[y*w+x]=row.getFloat32(x*4,true);}
      map.unmap();map.destroy?.();return out;
    }
    debugOverlay(){if(!this.valid)throw new Error(`Dark Bloom is invalid: ${this.lastInvalidationReason}`);return{schema:SCHEMA,quality:this.snapshot.quality,settings:{...this.snapshot.settings},tierCounts:[...this.snapshot.tierCounts],contract:'Reduced-resolution residual only: weaker than the DSO hard core, bounded by quality/distance, depth-aware on reconstruction, and never temporal in SM-305.',scopeBoundary:'SM-305 does not alter hard DSO ownership and has no temporal accumulation or final visibility composition.'};}
    diagnostics(){return{schema:SCHEMA,valid:this.valid,generation:this.generation,roomId:this.lastRoomId,updateCount:this.updateCount,uploadCount:this.uploadCount,dispatchCount:this.dispatchCount,tierBuildCount:this.tierBuildCount,tierReuseCount:this.tierReuseCount,invalidationCount:this.invalidationCount,lastInvalidationReason:this.lastInvalidationReason,extent:{width:this.width,height:this.height},snapshot:this.snapshot?JSON.parse(JSON.stringify(this.snapshot)):null,resourceDiagnostics:this.registry?.diagnostics?.()||null,pipelineDiagnostics:this.pipelineCache?.diagnostics?.()||null};}
    close(){if(this.registry)this.registry.close();if(this.pipelineCache)this.pipelineCache.clear();this.registry=null;this.pipelineCache=null;this.bloomPipeline=null;this.upsamplePipeline=null;this.snapshot=null;this.valid=false;this.closed=true;}
  }

  return{SCHEMA,SNAPSHOT_SCHEMA,SCALE,QUALITY,DEFAULTS,BLOOM_WGSL,UPSAMPLE_WGSL,qualityName,qualitySettings,lowDimensions,tierAtPoint,tierForJobAtPoint,buildTierMap,reducedCore,depthCompatible,referenceFromTierMap,buildReference,bloomMetrics,WebGPUDarkBloom};
});
