'use strict';

(function(root,factory){
  const Resources=root?.SteelMothWebGPUResources||((typeof module==='object'&&module.exports)?require('./webgpu_resources.js'):null);
  const GBuffer=root?.SteelMothWebGPUGBuffer||((typeof module==='object'&&module.exports)?require('./webgpu_gbuffer.js'):null);
  const api=factory(Resources,GBuffer,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUOccluders=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,GBuffer,root){
  if(!Resources)throw new Error('SteelMothWebGPUResources is required before webgpu_occluders');
  if(!GBuffer)throw new Error('SteelMothWebGPUGBuffer is required before webgpu_occluders');

  const SCHEMA='steelmoth-webgpu-occluders/v1';
  const SNAPSHOT_SCHEMA='steelmoth-webgpu-occluder-snapshot/v1';
  const RECORD_STRIDE=64;
  const TILE_HEADER_STRIDE=8;
  const DEFAULTS=Object.freeze({tileSize:32,maxOccluders:512,maxPerTile:32,maxTileRefs:8192,tinyArea:72,tinyExtent:12,tinyMaxZ:4});
  const FLAGS=Object.freeze({STATIC:1,DYNAMIC:2,SUBSTANTIAL:4,RECEIVER_ONLY:8,CASTS:16,HAS_SECTIONS:32,EXPLICIT_MAJOR:64});
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,STORAGE:0x0080});
  const MAP_MODE_READ=0x0001;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const hash=value=>GBuffer.objectIdForStableId(String(value??''));
  const usage=names=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);
  const align=(v,m=4)=>Math.ceil(Math.max(0,Number(v)||0)/m)*m;
  const stableJson=value=>JSON.stringify(value,Object.keys(value||{}).sort());

  function objectIdForOccluder(o={}){
    const explicit=Number(o.objectId);
    if(Number.isInteger(explicit)&&explicit>0)return explicit>>>0;
    return hash(o.objectIdBasis||o.id||o.source||'occluder');
  }
  function boundsFor(o={}){
    const raw=Array.isArray(o.bounds)?o.bounds:Array.isArray(o.rect)?o.rect:null;
    if(!raw||raw.length<4)return null;
    let [l,t,r,b]=raw.slice(0,4).map(v=>finite(v,0));
    if(r<l)[l,r]=[r,l];if(b<t)[t,b]=[b,t];
    return r>l&&b>t?[l,t,r,b]:null;
  }
  function rootFor(o={},bounds=null){
    const r=o.root||{};return [finite(r.x,o.x==null?(bounds?(bounds[0]+bounds[2])*.5:0):o.x),finite(r.y,o.contactY==null?(bounds?bounds[3]:0):o.contactY)];
  }
  function zRangeFor(o={}){
    if(Array.isArray(o.zRange)&&o.zRange.length>=2){let a=finite(o.zRange[0],0),b=finite(o.zRange[1],0);if(b<a)[a,b]=[b,a];return[a,b]}
    let maxZ=finite(o.maxZ,0);for(const s of o.sections||[])maxZ=Math.max(maxZ,finite(s?.z,0));return[0,Math.max(0,maxZ)];
  }
  function updateClassFor(o={}){
    const explicit=String(o.updateClass||'').toLowerCase();if(explicit==='dynamic'||explicit==='static')return explicit;
    if(o.dynamic===true)return'dynamic';if(o.dynamic===false)return'static';
    const kind=String(o.kind||o.materialClass||'').toLowerCase();
    return /^(?:player|robot|actor|creature|companion|dynamic)$/.test(kind)?'dynamic':'static';
  }
  function classifyOccluder(o={},options={}){
    const d={...DEFAULTS,...options},bounds=boundsFor(o);if(!bounds)return{valid:false,reason:'invalid-bounds'};
    const w=bounds[2]-bounds[0],h=bounds[3]-bounds[1],area=w*h,z=zRangeFor(o),maxZ=Math.max(Math.abs(z[0]),Math.abs(z[1]));
    const casts=o.castShadow!==false&&o.shadowCast!==false&&o.receiverOnly!==true;
    const explicitMajor=o.majorOccluder===true||o.macroOccluder===true||o.shadowProfile?.macroOccluder===true;
    const explicitReceiver=o.majorOccluder===false||o.macroOccluder===false||o.receiverOnly===true||o.shadowProfile?.receiverOnly===true;
    const geometricMajor=area>=d.tinyArea||Math.max(w,h)>=d.tinyExtent||maxZ>=d.tinyMaxZ;
    const substantial=casts&&!explicitReceiver&&(explicitMajor||geometricMajor);
    return{valid:true,bounds,width:w,height:h,area,zRange:z,casts,explicitMajor,substantial,receiverOnly:!substantial,updateClass:updateClassFor(o)};
  }
  function normalizedRecord(o={},options={}){
    const c=classifyOccluder(o,options);if(!c.valid)return null;const root=rootFor(o,c.bounds),id=String(o.id||`occluder:${hash(stableJson(o))}`),objectId=objectIdForOccluder({...o,id});
    let flags=(c.updateClass==='dynamic'?FLAGS.DYNAMIC:FLAGS.STATIC)|(c.substantial?FLAGS.SUBSTANTIAL:FLAGS.RECEIVER_ONLY)|(c.casts?FLAGS.CASTS:0)|((o.sections||[]).length?FLAGS.HAS_SECTIONS:0)|(c.explicitMajor?FLAGS.EXPLICIT_MAJOR:0);
    return{id,objectId,flags,updateClass:c.updateClass,substantial:c.substantial,receiverOnly:c.receiverOnly,bounds:c.bounds,root,zRange:c.zRange,layer:finite(o.layer??o.depthLayer,0),strength:clamp(finite(o.strength,1),0,2),profileHash:hash(`${o.materialClass||o.kind||'unknown'}|${o.silhouetteClass||o.kind||'unknown'}`),sourceHash:hash(o.source||o.id||'unknown')};
  }
  function compareRecords(a,b){return a.objectId-b.objectId||a.id.localeCompare(b.id)}
  function packRecords(records=[]){
    const bytes=new Uint8Array(Math.max(RECORD_STRIDE,records.length*RECORD_STRIDE)),dv=new DataView(bytes.buffer);
    for(let i=0;i<records.length;i++){
      const r=records[i],o=i*RECORD_STRIDE,u=(n,v)=>dv.setUint32(o+n,Number(v)>>>0,true),f=(n,v)=>dv.setFloat32(o+n,finite(v,0),true);
      u(0,r.objectId);u(4,r.flags);u(8,r.profileHash);u(12,r.sourceHash);
      r.bounds.forEach((v,j)=>f(16+j*4,v));f(32,r.root[0]);f(36,r.root[1]);f(40,r.zRange[0]);f(44,r.zRange[1]);f(48,r.layer);f(52,r.strength);u(56,hash(r.id));u(60,0);
    }
    return bytes.subarray(0,Math.max(RECORD_STRIDE,records.length*RECORD_STRIDE));
  }
  function tileGrid(width,height,tileSize=DEFAULTS.tileSize){
    tileSize=Math.max(8,Math.round(finite(tileSize,DEFAULTS.tileSize)));width=Math.max(1,Math.round(finite(width,640)));height=Math.max(1,Math.round(finite(height,360)));
    return{width,height,tileSize,columns:Math.ceil(width/tileSize),rows:Math.ceil(height/tileSize),count:Math.ceil(width/tileSize)*Math.ceil(height/tileSize)};
  }
  function tileRange(bounds,grid){
    const x0=clamp(Math.floor(bounds[0]/grid.tileSize),0,grid.columns-1),x1=clamp(Math.floor(Math.max(bounds[0],bounds[2]-1e-6)/grid.tileSize),0,grid.columns-1),y0=clamp(Math.floor(bounds[1]/grid.tileSize),0,grid.rows-1),y1=clamp(Math.floor(Math.max(bounds[1],bounds[3]-1e-6)/grid.tileSize),0,grid.rows-1);return{x0,x1,y0,y1};
  }
  function buildTileBins(records,grid,options={}){
    const d={...DEFAULTS,...options},lists=Array.from({length:grid.count},()=>[]),overflow=new Uint8Array(grid.count);let droppedRefs=0;
    records.forEach((r,index)=>{if(!r.substantial)return;const q=tileRange(r.bounds,grid);for(let y=q.y0;y<=q.y1;y++)for(let x=q.x0;x<=q.x1;x++){const ti=y*grid.columns+x,l=lists[ti];if(l.length>=d.maxPerTile){overflow[ti]=1;droppedRefs++;continue}l.push(index)}});
    const headers=new Uint32Array(grid.count*2),refs=[];for(let i=0;i<lists.length;i++){headers[i*2]=refs.length;const room=Math.max(0,d.maxTileRefs-refs.length),count=Math.min(lists[i].length,room);headers[i*2+1]=count;for(let j=0;j<count;j++)refs.push(lists[i][j]);if(count<lists[i].length){overflow[i]=1;droppedRefs+=lists[i].length-count}}
    return{headers,refs:Uint32Array.from(refs),overflow,droppedRefs,nonEmptyTiles:lists.reduce((n,l)=>n+(l.length?1:0),0),maxOccupancy:lists.reduce((n,l)=>Math.max(n,l.length),0)};
  }
  function signature(records){let h=2166136261>>>0;for(const r of records){const b=packRecords([r]);for(const x of b){h^=x;h=Math.imul(h,16777619)>>>0}}return h>>>0}
  function buildOccluderSnapshot(scene={},options={}){
    const d={...DEFAULTS,...options},logical=scene?.frame?.logicalSize||[options.width||640,options.height||360],grid=tileGrid(options.width||logical[0],options.height||logical[1],d.tileSize),valid=[],invalid=[];
    for(const raw of scene.occluders||[]){const r=normalizedRecord(raw,d);if(r)valid.push(r);else invalid.push(String(raw?.id||raw?.source||'unknown'))}
    valid.sort(compareRecords);const overflowCount=Math.max(0,valid.length-d.maxOccluders),kept=valid.slice(0,d.maxOccluders),staticRecords=kept.filter(r=>r.updateClass==='static').sort(compareRecords),dynamicRecords=kept.filter(r=>r.updateClass==='dynamic').sort(compareRecords),records=[...staticRecords,...dynamicRecords],bins=buildTileBins(records,grid,d),packed=packRecords(records);
    return{schema:SNAPSHOT_SCHEMA,roomId:String(scene?.frame?.roomId||'unknown-room'),grid,records,staticRecords,dynamicRecords,packed,tileHeaders:bins.headers,tileRefs:bins.refs,tileOverflow:bins.overflow,staticSignature:signature(staticRecords),dynamicSignature:signature(dynamicRecords),diagnostics:{inputCount:(scene.occluders||[]).length,recordCount:records.length,staticCount:staticRecords.length,dynamicCount:dynamicRecords.length,substantialCount:records.filter(r=>r.substantial).length,receiverOnlyCount:records.filter(r=>r.receiverOnly).length,invalidCount:invalid.length,invalidIds:invalid,occluderOverflow:overflowCount,tileRefCount:bins.refs.length,tileRefOverflow:bins.droppedRefs,nonEmptyTiles:bins.nonEmptyTiles,maxTileOccupancy:bins.maxOccupancy,overflowTileCount:Array.from(bins.overflow).filter(Boolean).length}};
  }
  function debugTileOverlay(snapshot){
    const g=snapshot.grid,out=[];for(let i=0;i<g.count;i++){const count=snapshot.tileHeaders[i*2+1];if(!count&&!snapshot.tileOverflow[i])continue;const x=i%g.columns,y=Math.floor(i/g.columns),members=[];for(let j=0;j<count;j++){const index=snapshot.tileRefs[snapshot.tileHeaders[i*2]+j],r=snapshot.records[index];if(r)members.push(r.objectId)}out.push({tile:i,rect:[x*g.tileSize,y*g.tileSize,Math.min(g.width,(x+1)*g.tileSize),Math.min(g.height,(y+1)*g.tileSize)],count,load:count/Math.max(1,DEFAULTS.maxPerTile),overflow:!!snapshot.tileOverflow[i],objectIds:members})}return out;
  }

  class WebGPUOccluderBins{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUOccluderBins requires GPUDevice');this.device=options.device;this.queue=options.queue||options.device.queue;this.options={...DEFAULTS,...options};this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));this.registry=null;this.snapshot=null;this.valid=false;this.closed=false;this.generation=0;this.updateCount=0;this.invalidationCount=0;this.staticUploadCount=0;this.dynamicUploadCount=0;this.tileUploadCount=0;this.lastRoomId=null;this.lastStaticSignature=null;this.lastDynamicSignature=null;this.lastInvalidationReason='uninitialized';this.configure(this.width,this.height);
    }
    _name(n){return`sm300:${n}`}
    configure(width,height){
      if(this.closed)throw new Error('WebGPUOccluderBins is closed');width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));if(this.registry&&width===this.width&&height===this.height)return false;if(this.registry)this.registry.close();this.width=width;this.height=height;this.registry=new Resources.ResourceRegistry({device:this.device,queue:this.queue,width,height,labelPrefix:'SteelMothOccluders'});const g=tileGrid(width,height,this.options.tileSize),storage=usage(['STORAGE','COPY_DST','COPY_SRC']);this.registry.defineBuffer(this._name('records'),{size:this.options.maxOccluders*RECORD_STRIDE,usage:storage});this.registry.defineBuffer(this._name('tile-headers'),{size:Math.max(4,g.count*TILE_HEADER_STRIDE),usage:storage});this.registry.defineBuffer(this._name('tile-refs'),{size:Math.max(4,this.options.maxTileRefs*4),usage:storage});this.generation++;this.invalidate('configure');return true;
    }
    resize(width,height){return this.configure(width,height)}
    resetDevice(device,queue=device?.queue){if(!device)throw new Error('resetDevice requires GPUDevice');this.device=device;this.queue=queue||device.queue;if(this.registry)this.registry.close();this.registry=null;this.generation++;this.configure(this.width,this.height);this.invalidate('device-reset');return this.generation}
    invalidate(reason='explicit'){this.valid=false;this.snapshot=null;this.lastStaticSignature=null;this.lastDynamicSignature=null;this.invalidationCount++;this.lastInvalidationReason=String(reason||'explicit');return this.invalidationCount}
    _record(name){if(!this.valid)throw new Error(`occluder bins are invalid: ${this.lastInvalidationReason}`);return this.registry.require(this._name(name))}
    bindings(){return{records:this._record('records').handle,tileHeaders:this._record('tile-headers').handle,tileRefs:this._record('tile-refs').handle,recordCount:this.snapshot.records.length,tileCount:this.snapshot.grid.count,tileRefCount:this.snapshot.tileRefs.length,generation:this.generation}}
    async update(scene={},options={}){
      const logical=scene?.frame?.logicalSize||[this.width,this.height];if(logical[0]!==this.width||logical[1]!==this.height)this.configure(logical[0],logical[1]);const roomId=String(scene?.frame?.roomId||'unknown-room');if(this.lastRoomId!==null&&roomId!==this.lastRoomId)this.invalidate('room-change');const snap=buildOccluderSnapshot(scene,{...this.options,width:this.width,height:this.height,...options}),staticChanged=this.lastStaticSignature!==snap.staticSignature,dynamicChanged=this.lastDynamicSignature!==snap.dynamicSignature,records=this.registry.require(this._name('records')).handle;
      if(staticChanged||!this.valid){if(snap.staticRecords.length)this.queue.writeBuffer(records,0,packRecords(snap.staticRecords));this.staticUploadCount++}
      const dynamicOffset=snap.staticRecords.length*RECORD_STRIDE;if(dynamicChanged||staticChanged||!this.valid){if(snap.dynamicRecords.length)this.queue.writeBuffer(records,dynamicOffset,packRecords(snap.dynamicRecords));this.dynamicUploadCount++}
      this.queue.writeBuffer(this.registry.require(this._name('tile-headers')).handle,0,snap.tileHeaders);if(snap.tileRefs.length)this.queue.writeBuffer(this.registry.require(this._name('tile-refs')).handle,0,snap.tileRefs);this.tileUploadCount++;
      if(typeof this.queue.onSubmittedWorkDone==='function'&&options.wait!==false)await this.queue.onSubmittedWorkDone();this.snapshot=snap;this.lastRoomId=roomId;this.lastStaticSignature=snap.staticSignature;this.lastDynamicSignature=snap.dynamicSignature;this.valid=true;this.lastInvalidationReason='';this.updateCount++;return this.diagnostics();
    }
    debugOverlay(){if(!this.valid)throw new Error(`occluder bins are invalid: ${this.lastInvalidationReason}`);return debugTileOverlay(this.snapshot)}
    async _readBuffer(record,bytes){
      bytes=align(bytes,4);if(bytes<=0)return new Uint8Array();const map=this.device.createBuffer({label:'SteelMothOccluderReadback',size:bytes,usage:usage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder({label:'SteelMothOccluderReadbackEncoder'});encoder.copyBufferToBuffer(record.handle,0,map,0,bytes);this.queue.submit([encoder.finish()]);await map.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const out=new Uint8Array(map.getMappedRange()).slice();map.unmap();map.destroy?.();return out;
    }
    async readback(){
      if(!this.valid)throw new Error(`occluder bins are invalid: ${this.lastInvalidationReason}`);const rc=this.snapshot.records.length,tc=this.snapshot.grid.count,tr=this.snapshot.tileRefs.length;return{records:await this._readBuffer(this.registry.require(this._name('records')),Math.max(4,rc*RECORD_STRIDE)),tileHeaders:await this._readBuffer(this.registry.require(this._name('tile-headers')),Math.max(4,tc*TILE_HEADER_STRIDE)),tileRefs:await this._readBuffer(this.registry.require(this._name('tile-refs')),Math.max(4,tr*4))};
    }
    diagnostics(){
      return{schema:SCHEMA,valid:this.valid,generation:this.generation,extent:[this.width,this.height],options:{tileSize:this.options.tileSize,maxOccluders:this.options.maxOccluders,maxPerTile:this.options.maxPerTile,maxTileRefs:this.options.maxTileRefs},roomId:this.lastRoomId,updateCount:this.updateCount,invalidationCount:this.invalidationCount,lastInvalidationReason:this.lastInvalidationReason,uploads:{static:this.staticUploadCount,dynamic:this.dynamicUploadCount,tiles:this.tileUploadCount},snapshot:this.snapshot?{grid:this.snapshot.grid,...this.snapshot.diagnostics,staticSignature:this.snapshot.staticSignature,dynamicSignature:this.snapshot.dynamicSignature}:null,resourceDiagnostics:this.registry?.diagnostics?.()||null,depthHierarchyContract:'Consumes SM-202 object/scene identity and is staged immediately after SM-203; it does not build a second depth pyramid.',classificationContract:'Explicit macro/receiver metadata wins; otherwise bounded geometry thresholds classify substantial versus receiver-only occluders without sprite-name special cases.'};
    }
    close(){if(this.registry)this.registry.close();this.registry=null;this.snapshot=null;this.valid=false;this.closed=true}
  }

  return{SCHEMA,SNAPSHOT_SCHEMA,RECORD_STRIDE,TILE_HEADER_STRIDE,DEFAULTS,FLAGS,objectIdForOccluder,boundsFor,rootFor,zRangeFor,updateClassFor,classifyOccluder,normalizedRecord,packRecords,tileGrid,tileRange,buildTileBins,buildOccluderSnapshot,debugTileOverlay,WebGPUOccluderBins};
});
