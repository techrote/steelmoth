'use strict';

(function(root,factory){
  const Resources=root?.SteelMothWebGPUResources||((typeof module==='object'&&module.exports)?require('./webgpu_resources.js'):null);
  const Occluders=root?.SteelMothWebGPUOccluders||((typeof module==='object'&&module.exports)?require('./webgpu_occluders.js'):null);
  const Clusters=root?.SteelMothWebGPUClusters||((typeof module==='object'&&module.exports)?require('./webgpu_clusters.js'):null);
  const Lighting=root?.SteelMothWebGPULighting||((typeof module==='object'&&module.exports)?require('./webgpu_lighting.js'):null);
  const api=factory(Resources,Occluders,Clusters,Lighting,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUDominance=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,Occluders,Clusters,Lighting,root){
  if(!Resources)throw new Error('SteelMothWebGPUResources is required before webgpu_dominance');
  if(!Occluders)throw new Error('SteelMothWebGPUOccluders is required before webgpu_dominance');
  if(!Clusters)throw new Error('SteelMothWebGPUClusters is required before webgpu_dominance');
  if(!Lighting)throw new Error('SteelMothWebGPULighting is required before webgpu_dominance');

  const SCHEMA='steelmoth-webgpu-dominance/v1';
  const SNAPSHOT_SCHEMA='steelmoth-webgpu-dominance-snapshot/v1';
  const RECORD_STRIDE=48;
  const DEFAULTS=Object.freeze({
    maxDominanceRecords:8704,
    silhouetteWeight:.52,
    lightExposureWeight:.18,
    pseudoHeightWeight:.18,
    frontDepthWeight:.10,
    strengthWeight:.02,
    hysteresisAbsolute:.055,
    hysteresisRatio:.10,
    relevancePadding:4
  });
  const FLAGS=Object.freeze({SWITCHED:1,HYSTERESIS_HELD:2,FIRST_OWNER:4});
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,STORAGE:0x0080});
  const MAP_MODE_READ=0x0001;
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const align=(v,m=4)=>Math.ceil(Math.max(0,Number(v)||0)/m)*m;
  const usage=names=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);
  const hash=value=>{let h=2166136261>>>0;for(const ch of String(value??'')){h^=ch.charCodeAt(0)&255;h=Math.imul(h,16777619)>>>0}return h>>>0};

  function unwrapClusterSnapshot(input){
    const snap=input?.snapshot?.schema===Clusters.SNAPSHOT_SCHEMA?input.snapshot:input;
    if(!snap||snap.schema!==Clusters.SNAPSHOT_SCHEMA)throw new Error(`SM-302 requires ${Clusters.SNAPSHOT_SCHEMA} input from SM-301`);
    return snap;
  }
  function unwrapOccluderSnapshot(input){
    const snap=input?.snapshot?.schema===Occluders.SNAPSHOT_SCHEMA?input.snapshot:input;
    if(!snap||snap.schema!==Occluders.SNAPSHOT_SCHEMA)throw new Error(`SM-302 requires ${Occluders.SNAPSHOT_SCHEMA} input from SM-300`);
    return snap;
  }
  function canonicalLights(input,settings={}){
    if(Array.isArray(input))return input.filter(Boolean).slice(0,Lighting.MAX_LIGHTS||17);
    return Lighting.buildCanonicalLights(input||{},settings||{});
  }
  function boundsCenter(bounds){return[(finite(bounds?.[0])+finite(bounds?.[2]))*.5,(finite(bounds?.[1])+finite(bounds?.[3]))*.5]}
  function normalize2(v,fallback=[1,0]){const x=finite(v?.[0],fallback[0]),y=finite(v?.[1],fallback[1]),d=Math.hypot(x,y);return d>1e-7?[x/d,y/d]:[...fallback]}
  function toLightVector(light,cluster){
    const cc=boundsCenter(cluster.bounds);
    if(Array.isArray(light?.toLight))return normalize2(light.toLight);
    if(Array.isArray(light?.position))return normalize2([finite(light.position[0])-cc[0],finite(light.position[1])-cc[1]]);
    if(Number.isFinite(Number(light?.x))||Number.isFinite(Number(light?.y)))return normalize2([finite(light.x)-cc[0],finite(light.y)-cc[1]]);
    if(Array.isArray(light?.direction)){const d=normalize2(light.direction);return[-d[0],-d[1]]}
    return[1,0];
  }
  function projectedEdge(bounds,axis){
    const [l,t,r,b]=bounds;return Math.max(l*axis[0]+t*axis[1],l*axis[0]+b*axis[1],r*axis[0]+t*axis[1],r*axis[0]+b*axis[1]);
  }
  function projectedExtent(bounds,axis){return Math.abs(axis[0])*(bounds[2]-bounds[0])+Math.abs(axis[1])*(bounds[3]-bounds[1])}
  function memberScore(record,cluster,toLight,options={}){
    const d={...DEFAULTS,...options},perp=[-toLight[1],toLight[0]],clusterFront=projectedEdge(cluster.bounds,toLight),memberFront=projectedEdge(record.bounds,toLight),clusterAlong=Math.max(1,projectedExtent(cluster.bounds,toLight));
    const lightExposure=clamp(1-(clusterFront-memberFront)/clusterAlong,0,1);
    const silhouetteSpan=clamp(projectedExtent(record.bounds,perp)/Math.max(1,projectedExtent(cluster.bounds,perp)),0,1);
    const exposedSilhouette=lightExposure*(.45+.55*silhouetteSpan);
    const zLo=finite(cluster.zRange?.[0]),zHi=finite(cluster.zRange?.[1]),z=finite(record.zRange?.[1]),pseudoHeight=zHi-zLo>1e-6?clamp((z-zLo)/(zHi-zLo),0,1):(z>0?1:0);
    const depth=finite(record.layer)*1024+finite(record.root?.[1]),depthLo=finite(cluster.depthRange?.[0]),depthHi=finite(cluster.depthRange?.[1]),frontDepth=depthHi-depthLo>1e-6?clamp((depth-depthLo)/(depthHi-depthLo),0,1):.5;
    const strength=clamp(finite(record.strength,1)/2,0,1);
    const score=exposedSilhouette*d.silhouetteWeight+lightExposure*d.lightExposureWeight+pseudoHeight*d.pseudoHeightWeight+frontDepth*d.frontDepthWeight+strength*d.strengthWeight;
    return{objectId:Number(record.objectId)>>>0,score,components:{exposedSilhouette,lightExposure,silhouetteSpan,pseudoHeight,frontDepth,strength},depth,zMax:z,bounds:[...record.bounds]};
  }
  function relevantLight(light,cluster,options={}){
    if(finite(light?.intensity,1)<=0)return false;
    if(!Array.isArray(light?.position)||!Number.isFinite(Number(light?.radius))||finite(light.radius)<=0)return true;
    const p=light.position,b=cluster.bounds,pad=finite(options.relevancePadding,DEFAULTS.relevancePadding),x=clamp(finite(p[0]),b[0]-pad,b[2]+pad),y=clamp(finite(p[1]),b[1]-pad,b[3]+pad),dist=Math.hypot(finite(p[0])-x,finite(p[1])-y);
    return dist<=finite(light.radius)+pad;
  }
  function scoreCluster(cluster,recordMap,light,options={}){
    const axis=toLightVector(light,cluster),scores=[];
    for(const id of cluster.memberIds||[]){const record=recordMap.get(Number(id)>>>0);if(record)scores.push(memberScore(record,cluster,axis,options))}
    scores.sort((a,b)=>b.score-a.score||b.zMax-a.zMax||b.depth-a.depth||a.objectId-b.objectId);
    return{axis,scores};
  }
  function historyKey(clusterId,lightIdHash){return`${Number(clusterId)>>>0}:${Number(lightIdHash)>>>0}`}
  function normalizeHistory(input){
    if(input instanceof Map)return new Map(input);
    const out=new Map();for(const [k,v] of Object.entries(input||{}))out.set(k,v);return out;
  }
  function packRecords(records=[]){
    const bytes=new Uint8Array(Math.max(RECORD_STRIDE,records.length*RECORD_STRIDE)),dv=new DataView(bytes.buffer);
    for(let i=0;i<records.length;i++){
      const r=records[i],o=i*RECORD_STRIDE,u=(n,v)=>dv.setUint32(o+n,Number(v)>>>0,true),f=(n,v)=>dv.setFloat32(o+n,finite(v,0),true);
      u(0,r.clusterId);u(4,r.lightIdHash);u(8,r.ownerObjectId);u(12,r.previousOwnerObjectId);f(16,r.ownerScore);f(20,r.previousOwnerScore);u(24,r.challengerObjectId);u(28,r.flags);f(32,r.hysteresisThreshold);f(36,r.challengerDelta);u(40,r.memberCount);u(44,0);
    }
    return bytes.subarray(0,Math.max(RECORD_STRIDE,records.length*RECORD_STRIDE));
  }
  function signatureFor(records){let h=2166136261>>>0;for(const v of packRecords(records)){h^=v;h=Math.imul(h,16777619)>>>0}return h>>>0}
  function buildDominanceSnapshot(clusterInput,occluderInput,lightsInput=[],previousHistory=new Map(),options={}){
    const clusters=unwrapClusterSnapshot(clusterInput),occluders=unwrapOccluderSnapshot(occluderInput);
    if(clusters.roomId!==occluders.roomId)throw new Error(`SM-302 room mismatch: clusters=${clusters.roomId} occluders=${occluders.roomId}`);
    const d={...DEFAULTS,...options},lights=canonicalLights(lightsInput,options.lightSettings||{}),recordMap=new Map(occluders.records.map(r=>[Number(r.objectId)>>>0,r])),history=normalizeHistory(previousHistory),nextHistory=new Map(),records=[];let switchCount=0,heldCount=0,skippedLights=0,overflow=0;
    outer:for(const cluster of clusters.clusters||[]){
      for(const light of lights){
        if(!relevantLight(light,cluster,d)){skippedLights++;continue}
        if(records.length>=d.maxDominanceRecords){overflow++;continue}
        const lightId=String(light.id||`light:${records.length}`),lightIdHash=hash(lightId),key=historyKey(cluster.clusterId,lightIdHash),rank=scoreCluster(cluster,recordMap,light,d);
        if(!rank.scores.length)continue;
        const best=rank.scores[0],prevEntry=history.get(key),prevId=Number(prevEntry?.ownerObjectId||0)>>>0,prevScoreEntry=rank.scores.find(s=>s.objectId===prevId),previousOwnerScore=prevScoreEntry?.score??0;
        let owner=best,flags=0,hysteresisThreshold=0,challengerDelta=0;
        if(!prevId||!prevScoreEntry){flags|=FLAGS.FIRST_OWNER}
        else if(best.objectId!==prevId){
          hysteresisThreshold=Math.max(d.hysteresisAbsolute,Math.abs(previousOwnerScore)*d.hysteresisRatio);challengerDelta=best.score-previousOwnerScore;
          if(challengerDelta<=hysteresisThreshold){owner=prevScoreEntry;flags|=FLAGS.HYSTERESIS_HELD;heldCount++}
          else{flags|=FLAGS.SWITCHED;switchCount++}
        }
        const nextBest=rank.scores.find(s=>s.objectId!==owner.objectId),ownerMargin=owner.score-(nextBest?.score??owner.score),entry={clusterId:Number(cluster.clusterId)>>>0,lightId,lightIdHash,ownerObjectId:owner.objectId,previousOwnerObjectId:prevId,ownerScore:owner.score,previousOwnerScore,hysteresisThreshold,challengerObjectId:best.objectId===owner.objectId?(nextBest?.objectId||0):best.objectId,challengerScore:best.objectId===owner.objectId?(nextBest?.score??0):best.score,challengerDelta,ownerMargin,flags,memberCount:rank.scores.length,toLight:rank.axis,memberScores:rank.scores};
        records.push(entry);nextHistory.set(key,{ownerObjectId:owner.objectId,ownerScore:owner.score,lightId,clusterId:Number(cluster.clusterId)>>>0});
      }
    }
    records.sort((a,b)=>a.clusterId-b.clusterId||a.lightIdHash-b.lightIdHash||a.ownerObjectId-b.ownerObjectId);
    const packed=packRecords(records),signature=signatureFor(records);
    return{schema:SNAPSHOT_SCHEMA,sourceClusterSchema:clusters.schema,sourceOccluderSchema:occluders.schema,roomId:clusters.roomId,records,packed,history:nextHistory,signature,diagnostics:{clusterCount:clusters.clusters.length,lightCount:lights.length,dominanceRecordCount:records.length,recordOverflow:overflow,irrelevantLightCount:skippedLights,switchCount,hysteresisHoldCount:heldCount,hysteresisAbsolute:d.hysteresisAbsolute,hysteresisRatio:d.hysteresisRatio,singleOwnerPerClusterLight:true,allMembersFullShadow:false}};
  }
  function debugDominanceOverlay(snapshot){
    return(snapshot.records||[]).map(r=>({clusterId:r.clusterId,lightId:r.lightId,lightIdHash:r.lightIdHash,ownerObjectId:r.ownerObjectId,previousOwnerObjectId:r.previousOwnerObjectId,ownerScore:r.ownerScore,ownerMargin:r.ownerMargin,hysteresisThreshold:r.hysteresisThreshold,challengerObjectId:r.challengerObjectId,challengerDelta:r.challengerDelta,heldByHysteresis:!!(r.flags&FLAGS.HYSTERESIS_HELD),switched:!!(r.flags&FLAGS.SWITCHED),toLight:[...r.toLight],scores:r.memberScores.map(s=>({objectId:s.objectId,score:s.score,...s.components}))}));
  }

  class WebGPUDominantOccluders{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUDominantOccluders requires GPUDevice');this.device=options.device;this.queue=options.queue||options.device.queue;this.options={...DEFAULTS,...options};this.registry=null;this.snapshot=null;this.history=new Map();this.valid=false;this.closed=false;this.generation=0;this.updateCount=0;this.uploadCount=0;this.invalidationCount=0;this.lastSignature=null;this.lastRoomId=null;this.lastInvalidationReason='uninitialized';this.configure();
    }
    _name(n){return`sm302:${n}`}
    configure(){if(this.closed)throw new Error('WebGPUDominantOccluders is closed');if(this.registry)this.registry.close();this.registry=new Resources.ResourceRegistry({device:this.device,queue:this.queue,width:1,height:1,labelPrefix:'SteelMothDominance'});this.registry.defineBuffer(this._name('records'),{size:this.options.maxDominanceRecords*RECORD_STRIDE,usage:usage(['STORAGE','COPY_DST','COPY_SRC'])});this.generation++;this.invalidate('configure',true);return true}
    resetDevice(device,queue=device?.queue){if(!device)throw new Error('resetDevice requires GPUDevice');this.device=device;this.queue=queue||device.queue;if(this.registry)this.registry.close();this.registry=null;this.generation++;this.configure();this.invalidate('device-reset',true);return this.generation}
    invalidate(reason='explicit',clearHistory=true){this.valid=false;this.snapshot=null;this.lastSignature=null;if(clearHistory)this.history.clear();this.invalidationCount++;this.lastInvalidationReason=String(reason||'explicit');return this.invalidationCount}
    _record(){if(!this.valid)throw new Error(`dominant occluders are invalid: ${this.lastInvalidationReason}`);return this.registry.require(this._name('records'))}
    bindings(){return{records:this._record().handle,recordCount:this.snapshot.records.length,generation:this.generation}}
    async update(clusterInput,occluderInput,lightsInput=[],options={}){
      const clusters=unwrapClusterSnapshot(clusterInput),roomId=String(clusters.roomId||'unknown-room');if(this.lastRoomId!==null&&roomId!==this.lastRoomId)this.invalidate('room-change',true);
      const snap=buildDominanceSnapshot(clusters,occluderInput,lightsInput,this.history,{...this.options,...options}),changed=!this.valid||this.lastSignature!==snap.signature;
      if(changed){this.queue.writeBuffer(this.registry.require(this._name('records')).handle,0,snap.packed);this.uploadCount++}
      if(typeof this.queue.onSubmittedWorkDone==='function'&&options.wait!==false)await this.queue.onSubmittedWorkDone();this.snapshot=snap;this.history=snap.history;this.valid=true;this.lastSignature=snap.signature;this.lastRoomId=roomId;this.lastInvalidationReason='';this.updateCount++;return this.diagnostics();
    }
    debugOverlay(){if(!this.valid)throw new Error(`dominant occluders are invalid: ${this.lastInvalidationReason}`);return debugDominanceOverlay(this.snapshot)}
    async readback(){if(!this.valid)throw new Error(`dominant occluders are invalid: ${this.lastInvalidationReason}`);const bytes=align(Math.max(RECORD_STRIDE,this.snapshot.records.length*RECORD_STRIDE),4),src=this.registry.require(this._name('records')).handle,map=this.device.createBuffer({label:'SteelMothDominanceReadback',size:bytes,usage:usage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder({label:'SteelMothDominanceReadbackEncoder'});encoder.copyBufferToBuffer(src,0,map,0,bytes);this.queue.submit([encoder.finish()]);await map.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const out=new Uint8Array(map.getMappedRange()).slice();map.unmap();map.destroy?.();return out}
    diagnostics(){return{schema:SCHEMA,valid:this.valid,generation:this.generation,roomId:this.lastRoomId,updateCount:this.updateCount,uploadCount:this.uploadCount,invalidationCount:this.invalidationCount,lastInvalidationReason:this.lastInvalidationReason,historySize:this.history.size,options:{maxDominanceRecords:this.options.maxDominanceRecords,hysteresisAbsolute:this.options.hysteresisAbsolute,hysteresisRatio:this.options.hysteresisRatio},snapshot:this.snapshot?{signature:this.snapshot.signature,...this.snapshot.diagnostics,records:debugDominanceOverlay(this.snapshot)}:null,resourceDiagnostics:this.registry?.diagnostics?.()||null,dominanceContract:'One stable primary macro-shadow owner per relevant light/cluster; challengers must clearly exceed hysteresis before ownership switches.',secondaryContract:'Non-owner cluster members remain available for later contour widening, upper structure, local shadow and Dark Bloom; SM-302 never promotes every member to a full macro shadow.'}}
    close(){if(this.registry)this.registry.close();this.registry=null;this.snapshot=null;this.history.clear();this.valid=false;this.closed=true}
  }

  return{SCHEMA,SNAPSHOT_SCHEMA,RECORD_STRIDE,DEFAULTS,FLAGS,hash,canonicalLights,toLightVector,relevantLight,memberScore,scoreCluster,buildDominanceSnapshot,packRecords,debugDominanceOverlay,WebGPUDominantOccluders};
});
