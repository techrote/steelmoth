'use strict';

(function(root,factory){
  const Resources=root?.SteelMothWebGPUResources||((typeof module==='object'&&module.exports)?require('./webgpu_resources.js'):null);
  const Occluders=root?.SteelMothWebGPUOccluders||((typeof module==='object'&&module.exports)?require('./webgpu_occluders.js'):null);
  const api=factory(Resources,Occluders,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUClusters=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Resources,Occluders,root){
  if(!Resources)throw new Error('SteelMothWebGPUResources is required before webgpu_clusters');
  if(!Occluders)throw new Error('SteelMothWebGPUOccluders is required before webgpu_clusters');

  const SCHEMA='steelmoth-webgpu-clusters/v1';
  const SNAPSHOT_SCHEMA='steelmoth-webgpu-cluster-snapshot/v1';
  const CLUSTER_RECORD_STRIDE=64;
  const MEMBERSHIP_STRIDE=8;
  const DEFAULTS=Object.freeze({
    adjacencyPx:2,
    crossClassAdjacencyPx:1,
    groundYThreshold:8,
    depthProximity:24,
    zProximity:16,
    layerEpsilon:0.001,
    tinyConnectorArea:96,
    tinyConnectorOverlapRatio:0.20,
    maxCandidatePerTile:32,
    maxCandidatePairs:8192,
    maxClusters:512,
    maxMembers:512
  });
  const FLAGS=Object.freeze({HAS_MULTIPLE_MEMBERS:1,HAS_MULTIPLE_PROFILES:2,CANDIDATE_OVERFLOW:4});
  const FALLBACK_BUFFER_USAGE=Object.freeze({MAP_READ:0x0001,COPY_SRC:0x0004,COPY_DST:0x0008,STORAGE:0x0080});
  const MAP_MODE_READ=0x0001;
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const align=(v,m=4)=>Math.ceil(Math.max(0,Number(v)||0)/m)*m;
  const usage=names=>names.reduce((v,n)=>v|Number(root?.GPUBufferUsage?.[n]??FALLBACK_BUFFER_USAGE[n]??0),0);
  const area=r=>Math.max(0,(r.bounds[2]-r.bounds[0])*(r.bounds[3]-r.bounds[1]));
  const explicitMajor=r=>(Number(r.flags) & Number(Occluders.FLAGS?.EXPLICIT_MAJOR||64))!==0;
  const compareRecords=(a,b)=>Number(a.objectId)-Number(b.objectId)||String(a.id).localeCompare(String(b.id));

  function unwrapOccluderSnapshot(input){
    const snap=input?.snapshot?.schema===Occluders.SNAPSHOT_SCHEMA?input.snapshot:input;
    if(!snap||snap.schema!==Occluders.SNAPSHOT_SCHEMA)throw new Error(`SM-301 requires ${Occluders.SNAPSHOT_SCHEMA} input from SM-300`);
    return snap;
  }
  function gap1D(a0,a1,b0,b1){return Math.max(0,Math.max(a0,b0)-Math.min(a1,b1))}
  function overlap1D(a0,a1,b0,b1){return Math.max(0,Math.min(a1,b1)-Math.max(a0,b0))}
  function zGap(a,b){
    const a0=finite(a.zRange?.[0]),a1=finite(a.zRange?.[1]),b0=finite(b.zRange?.[0]),b1=finite(b.zRange?.[1]);
    return Math.max(0,Math.max(a0,b0)-Math.min(a1,b1));
  }
  function relationFor(a,b,options={}){
    const d={...DEFAULTS,...options};
    const ax0=a.bounds[0],ay0=a.bounds[1],ax1=a.bounds[2],ay1=a.bounds[3],bx0=b.bounds[0],by0=b.bounds[1],bx1=b.bounds[2],by1=b.bounds[3];
    const gapX=gap1D(ax0,ax1,bx0,bx1),gapY=gap1D(ay0,ay1,by0,by1),overlapX=overlap1D(ax0,ax1,bx0,bx1),overlapY=overlap1D(ay0,ay1,by0,by1),overlapArea=overlapX*overlapY;
    const classMatch=Number(a.profileHash)===Number(b.profileHash),adjacency=classMatch?d.adjacencyPx:d.crossClassAdjacencyPx;
    const rootYDelta=Math.abs(finite(a.root?.[1])-finite(b.root?.[1]));
    const layerDelta=Math.abs(finite(a.layer)-finite(b.layer));
    const depthAnchorA=finite(a.layer)*1024+finite(a.root?.[1]),depthAnchorB=finite(b.layer)*1024+finite(b.root?.[1]),depthDelta=Math.abs(depthAnchorA-depthAnchorB);
    const projectedClose=gapX<=adjacency&&gapY<=adjacency;
    const groundClose=gapX<=adjacency&&rootYDelta<=d.groundYThreshold;
    const depthClose=layerDelta<=d.layerEpsilon&&depthDelta<=d.depthProximity&&zGap(a,b)<=d.zProximity;
    const aa=area(a),ba=area(b),small=aa<=ba?a:b,smallArea=Math.min(aa,ba),smallRatio=smallArea>0?overlapArea/smallArea:0;
    const smallConnector=smallArea<d.tinyConnectorArea&&!explicitMajor(small);
    const connectorSafe=!smallConnector||smallRatio>=d.tinyConnectorOverlapRatio;
    const accepted=!!(depthClose&&connectorSafe&&(overlapArea>0||projectedClose||groundClose));
    return{accepted,classMatch,adjacency,gapX,gapY,overlapX,overlapY,overlapArea,rootYDelta,layerDelta,depthDelta,zGap:zGap(a,b),projectedClose,groundClose,depthClose,smallConnector,smallRatio,connectorSafe};
  }
  function expandedTileRange(record,grid,pad){
    const b=record.bounds;return Occluders.tileRange([b[0]-pad,b[1]-pad,b[2]+pad,b[3]+pad],grid);
  }
  function buildCandidatePairs(records,grid,options={}){
    const d={...DEFAULTS,...options},lists=Array.from({length:grid.count},()=>[]),tileOverflow=new Uint8Array(grid.count),candidatePad=Math.max(d.adjacencyPx,d.groundYThreshold);let droppedTileMembers=0;
    records.forEach((r,index)=>{
      const q=expandedTileRange(r,grid,candidatePad);
      for(let y=q.y0;y<=q.y1;y++)for(let x=q.x0;x<=q.x1;x++){
        const ti=y*grid.columns+x,l=lists[ti];
        if(l.length>=d.maxCandidatePerTile){tileOverflow[ti]=1;droppedTileMembers++;continue}
        l.push(index);
      }
    });
    const pairSet=new Set(),pairs=[];let droppedPairs=0;
    for(let ti=0;ti<lists.length;ti++){
      const l=lists[ti];
      for(let i=0;i<l.length;i++)for(let j=i+1;j<l.length;j++){
        const a=Math.min(l[i],l[j]),b=Math.max(l[i],l[j]),key=`${a}:${b}`;
        if(pairSet.has(key))continue;
        if(pairs.length>=d.maxCandidatePairs){droppedPairs++;continue}
        pairSet.add(key);pairs.push([a,b]);
      }
    }
    pairs.sort((p,q)=>p[0]-q[0]||p[1]-q[1]);
    return{pairs,tileOverflow,droppedTileMembers,droppedPairs,nonEmptyCandidateTiles:lists.reduce((n,l)=>n+(l.length?1:0),0),maxCandidateTileOccupancy:lists.reduce((n,l)=>Math.max(n,l.length),0)};
  }
  function unionFind(count){
    const parent=Array.from({length:count},(_,i)=>i);
    const find=i=>{let r=i;while(parent[r]!==r)r=parent[r];while(parent[i]!==i){const n=parent[i];parent[i]=r;i=n}return r};
    const join=(a,b)=>{a=find(a);b=find(b);if(a===b)return a;const lo=Math.min(a,b),hi=Math.max(a,b);parent[hi]=lo;return lo};
    return{parent,find,join};
  }
  function summarizeCluster(members,memberOffset,candidateOverflow){
    members.sort(compareRecords);
    let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity,zMin=Infinity,zMax=-Infinity,depthMin=Infinity,depthMax=-Infinity;
    const profiles=new Set();
    for(const m of members){l=Math.min(l,m.bounds[0]);t=Math.min(t,m.bounds[1]);r=Math.max(r,m.bounds[2]);b=Math.max(b,m.bounds[3]);zMin=Math.min(zMin,m.zRange[0]);zMax=Math.max(zMax,m.zRange[1]);const depth=finite(m.layer)*1024+finite(m.root?.[1]);depthMin=Math.min(depthMin,depth);depthMax=Math.max(depthMax,depth);profiles.add(Number(m.profileHash)>>>0)}
    const clusterId=Number(members[0]?.objectId||0)>>>0,memberIds=members.map(m=>Number(m.objectId)>>>0);
    let flags=(members.length>1?FLAGS.HAS_MULTIPLE_MEMBERS:0)|(profiles.size>1?FLAGS.HAS_MULTIPLE_PROFILES:0)|(candidateOverflow?FLAGS.CANDIDATE_OVERFLOW:0);
    return{clusterId,memberOffset,memberCount:members.length,memberIds,flags,bounds:[l,t,r,b],zRange:[zMin,zMax],maxZ:zMax,depthRange:[depthMin,depthMax],dominantObjectId:0,profileCount:profiles.size,minObjectId:clusterId};
  }
  function packClusters(clusters=[]){
    const bytes=new Uint8Array(Math.max(CLUSTER_RECORD_STRIDE,clusters.length*CLUSTER_RECORD_STRIDE)),dv=new DataView(bytes.buffer);
    for(let i=0;i<clusters.length;i++){
      const c=clusters[i],o=i*CLUSTER_RECORD_STRIDE,u=(n,v)=>dv.setUint32(o+n,Number(v)>>>0,true),f=(n,v)=>dv.setFloat32(o+n,finite(v,0),true);
      u(0,c.clusterId);u(4,c.memberOffset);u(8,c.memberCount);u(12,c.flags);c.bounds.forEach((v,j)=>f(16+j*4,v));f(32,c.zRange[0]);f(36,c.zRange[1]);f(40,c.depthRange[0]);f(44,c.depthRange[1]);u(48,c.dominantObjectId||0);u(52,c.profileCount);u(56,c.minObjectId);u(60,0);
    }
    return bytes.subarray(0,Math.max(CLUSTER_RECORD_STRIDE,clusters.length*CLUSTER_RECORD_STRIDE));
  }
  function packMembers(memberIds=[]){const out=new Uint32Array(Math.max(1,memberIds.length));memberIds.forEach((id,i)=>out[i]=Number(id)>>>0);return out}
  function packMembership(clusters=[]){
    const count=clusters.reduce((n,c)=>n+c.memberCount,0),bytes=new Uint8Array(Math.max(MEMBERSHIP_STRIDE,count*MEMBERSHIP_STRIDE)),dv=new DataView(bytes.buffer);let i=0;
    for(const c of clusters)for(const id of c.memberIds){const o=i++*MEMBERSHIP_STRIDE;dv.setUint32(o,Number(id)>>>0,true);dv.setUint32(o+4,Number(c.clusterId)>>>0,true)}
    return bytes.subarray(0,Math.max(MEMBERSHIP_STRIDE,count*MEMBERSHIP_STRIDE));
  }
  function signatureFor(clusters,memberIds){let h=2166136261>>>0;const bytes=packClusters(clusters);for(const v of bytes){h^=v;h=Math.imul(h,16777619)>>>0}for(const id of memberIds){for(let s=0;s<32;s+=8){h^=(id>>>s)&255;h=Math.imul(h,16777619)>>>0}}return h>>>0}
  function buildClusterSnapshot(input,options={}){
    const source=unwrapOccluderSnapshot(input),d={...DEFAULTS,...options};
    const substantial=source.records.filter(r=>r.substantial).slice().sort(compareRecords),overflowMembers=Math.max(0,substantial.length-d.maxMembers),records=substantial.slice(0,d.maxMembers),candidate=buildCandidatePairs(records,source.grid,d),uf=unionFind(records.length);let acceptedEdges=0,rejectedPairs=0;
    const relations=[];
    for(const [a,b] of candidate.pairs){const rel=relationFor(records[a],records[b],d);if(rel.accepted){uf.join(a,b);acceptedEdges++}else rejectedPairs++;if(options.captureRelations===true)relations.push({a,b,...rel})}
    const components=new Map();for(let i=0;i<records.length;i++){const r=uf.find(i);if(!components.has(r))components.set(r,[]);components.get(r).push(records[i])}
    let groups=[...components.values()].map(g=>g.sort(compareRecords));groups.sort((a,b)=>compareRecords(a[0],b[0]));const clusterOverflow=Math.max(0,groups.length-d.maxClusters);groups=groups.slice(0,d.maxClusters);
    const candidateOverflow=candidate.droppedPairs>0||candidate.droppedTileMembers>0;let memberOffset=0;const clusters=[];for(const group of groups){const c=summarizeCluster(group,memberOffset,candidateOverflow);clusters.push(c);memberOffset+=c.memberCount}
    const memberIds=clusters.flatMap(c=>c.memberIds),packedClusters=packClusters(clusters),packedMembers=packMembers(memberIds),packedMembership=packMembership(clusters),largest=clusters.reduce((best,c)=>!best||c.memberCount>best.memberCount||(c.memberCount===best.memberCount&&c.clusterId<best.clusterId)?c:best,null),signature=signatureFor(clusters,memberIds);
    return{schema:SNAPSHOT_SCHEMA,sourceSchema:source.schema,roomId:source.roomId,grid:source.grid,clusters,memberIds,packedClusters,packedMembers,packedMembership,signature,relations:options.captureRelations===true?relations:undefined,diagnostics:{sourceRecordCount:source.records.length,substantialInputCount:substantial.length,memberCount:memberIds.length,memberOverflow:overflowMembers,clusterCount:clusters.length,clusterOverflow,candidatePairCount:candidate.pairs.length,candidatePairOverflow:candidate.droppedPairs,candidateTileOverflow:candidate.droppedTileMembers,overflowCandidateTileCount:Array.from(candidate.tileOverflow).filter(Boolean).length,nonEmptyCandidateTiles:candidate.nonEmptyCandidateTiles,maxCandidateTileOccupancy:candidate.maxCandidateTileOccupancy,acceptedEdges,rejectedPairs,isolatedClusterCount:clusters.filter(c=>c.memberCount===1).length,largestCluster:largest?{clusterId:largest.clusterId,memberCount:largest.memberCount,bounds:largest.bounds,memberIds:largest.memberIds}:null,lightIndependent:true,dominantOwnerDeferred:true}};
  }
  function canonicalMembership(snapshot){return snapshot.clusters.map(c=>({clusterId:c.clusterId,memberIds:[...c.memberIds]}))}
  function compareMembership(a,b){
    const am=new Map(),bm=new Map();for(const c of a.clusters)for(const id of c.memberIds)am.set(id,c.clusterId);for(const c of b.clusters)for(const id of c.memberIds)bm.set(id,c.clusterId);const ids=[...new Set([...am.keys(),...bm.keys()])].sort((x,y)=>x-y),changed=ids.filter(id=>am.get(id)!==bm.get(id));return{stable:changed.length===0,total:ids.length,changedCount:changed.length,changedObjectIds:changed};
  }
  function debugClusterOverlay(snapshot){return snapshot.clusters.map(c=>({clusterId:c.clusterId,rect:[...c.bounds],memberCount:c.memberCount,memberIds:[...c.memberIds],zRange:[...c.zRange],depthRange:[...c.depthRange],colorIndex:c.clusterId%17,dominantObjectId:0}))}

  class WebGPUOccluderClusters{
    constructor(options={}){
      if(!options.device)throw new Error('WebGPUOccluderClusters requires GPUDevice');this.device=options.device;this.queue=options.queue||options.device.queue;this.options={...DEFAULTS,...options};this.width=Math.max(1,Math.round(options.width||640));this.height=Math.max(1,Math.round(options.height||360));this.registry=null;this.snapshot=null;this.valid=false;this.closed=false;this.generation=0;this.updateCount=0;this.uploadCount=0;this.invalidationCount=0;this.lastSignature=null;this.lastRoomId=null;this.lastInvalidationReason='uninitialized';this.configure(this.width,this.height);
    }
    _name(n){return`sm301:${n}`}
    configure(width,height){
      if(this.closed)throw new Error('WebGPUOccluderClusters is closed');width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));if(this.registry&&width===this.width&&height===this.height)return false;if(this.registry)this.registry.close();this.width=width;this.height=height;this.registry=new Resources.ResourceRegistry({device:this.device,queue:this.queue,width,height,labelPrefix:'SteelMothClusters'});const storage=usage(['STORAGE','COPY_DST','COPY_SRC']);this.registry.defineBuffer(this._name('clusters'),{size:this.options.maxClusters*CLUSTER_RECORD_STRIDE,usage:storage});this.registry.defineBuffer(this._name('members'),{size:Math.max(4,this.options.maxMembers*4),usage:storage});this.registry.defineBuffer(this._name('membership'),{size:Math.max(MEMBERSHIP_STRIDE,this.options.maxMembers*MEMBERSHIP_STRIDE),usage:storage});this.generation++;this.invalidate('configure');return true;
    }
    resize(width,height){return this.configure(width,height)}
    resetDevice(device,queue=device?.queue){if(!device)throw new Error('resetDevice requires GPUDevice');this.device=device;this.queue=queue||device.queue;if(this.registry)this.registry.close();this.registry=null;this.generation++;this.configure(this.width,this.height);this.invalidate('device-reset');return this.generation}
    invalidate(reason='explicit'){this.valid=false;this.snapshot=null;this.lastSignature=null;this.invalidationCount++;this.lastInvalidationReason=String(reason||'explicit');return this.invalidationCount}
    _record(name){if(!this.valid)throw new Error(`occluder clusters are invalid: ${this.lastInvalidationReason}`);return this.registry.require(this._name(name))}
    bindings(){return{clusters:this._record('clusters').handle,members:this._record('members').handle,membership:this._record('membership').handle,clusterCount:this.snapshot.clusters.length,memberCount:this.snapshot.memberIds.length,generation:this.generation}}
    async update(input,options={}){
      const source=unwrapOccluderSnapshot(input),grid=source.grid;if(grid.width!==this.width||grid.height!==this.height)this.configure(grid.width,grid.height);if(this.lastRoomId!==null&&source.roomId!==this.lastRoomId)this.invalidate('room-change');const snap=buildClusterSnapshot(source,{...this.options,...options}),changed=!this.valid||this.lastSignature!==snap.signature;
      if(changed){this.queue.writeBuffer(this.registry.require(this._name('clusters')).handle,0,snap.packedClusters);this.queue.writeBuffer(this.registry.require(this._name('members')).handle,0,snap.packedMembers);this.queue.writeBuffer(this.registry.require(this._name('membership')).handle,0,snap.packedMembership);this.uploadCount++}
      if(typeof this.queue.onSubmittedWorkDone==='function'&&options.wait!==false)await this.queue.onSubmittedWorkDone();this.snapshot=snap;this.valid=true;this.lastSignature=snap.signature;this.lastRoomId=source.roomId;this.lastInvalidationReason='';this.updateCount++;return this.diagnostics();
    }
    debugOverlay(){if(!this.valid)throw new Error(`occluder clusters are invalid: ${this.lastInvalidationReason}`);return debugClusterOverlay(this.snapshot)}
    async _readBuffer(record,bytes){bytes=align(bytes,4);if(bytes<=0)return new Uint8Array();const map=this.device.createBuffer({label:'SteelMothClusterReadback',size:bytes,usage:usage(['COPY_DST','MAP_READ'])}),encoder=this.device.createCommandEncoder({label:'SteelMothClusterReadbackEncoder'});encoder.copyBufferToBuffer(record.handle,0,map,0,bytes);this.queue.submit([encoder.finish()]);await map.mapAsync(Number(root?.GPUMapMode?.READ??MAP_MODE_READ));const out=new Uint8Array(map.getMappedRange()).slice();map.unmap();map.destroy?.();return out}
    async readback(){if(!this.valid)throw new Error(`occluder clusters are invalid: ${this.lastInvalidationReason}`);return{clusters:await this._readBuffer(this.registry.require(this._name('clusters')),Math.max(4,this.snapshot.clusters.length*CLUSTER_RECORD_STRIDE)),members:await this._readBuffer(this.registry.require(this._name('members')),Math.max(4,this.snapshot.memberIds.length*4)),membership:await this._readBuffer(this.registry.require(this._name('membership')),Math.max(MEMBERSHIP_STRIDE,this.snapshot.memberIds.length*MEMBERSHIP_STRIDE))}}
    diagnostics(){return{schema:SCHEMA,valid:this.valid,generation:this.generation,extent:[this.width,this.height],roomId:this.lastRoomId,updateCount:this.updateCount,uploadCount:this.uploadCount,invalidationCount:this.invalidationCount,lastInvalidationReason:this.lastInvalidationReason,options:{adjacencyPx:this.options.adjacencyPx,crossClassAdjacencyPx:this.options.crossClassAdjacencyPx,groundYThreshold:this.options.groundYThreshold,depthProximity:this.options.depthProximity,zProximity:this.options.zProximity,maxCandidatePerTile:this.options.maxCandidatePerTile,maxCandidatePairs:this.options.maxCandidatePairs,maxClusters:this.options.maxClusters,maxMembers:this.options.maxMembers},snapshot:this.snapshot?{signature:this.snapshot.signature,...this.snapshot.diagnostics,clusters:this.snapshot.clusters.map(c=>({clusterId:c.clusterId,memberCount:c.memberCount,bounds:c.bounds,memberIds:c.memberIds,zRange:c.zRange,depthRange:c.depthRange,dominantObjectId:0}))}:null,resourceDiagnostics:this.registry?.diagnostics?.()||null,clusteringContract:'Geometry-only SM-301 clustering consumes bounded SM-300 occluder records and tile-local candidates; light-dependent dominance is deferred to SM-302.',dominanceContract:'dominantObjectId is reserved as zero in SM-301 and must not be inferred from cluster order.'}}
    close(){if(this.registry)this.registry.close();this.registry=null;this.snapshot=null;this.valid=false;this.closed=true}
  }

  return{SCHEMA,SNAPSHOT_SCHEMA,CLUSTER_RECORD_STRIDE,MEMBERSHIP_STRIDE,DEFAULTS,FLAGS,unwrapOccluderSnapshot,relationFor,buildCandidatePairs,buildClusterSnapshot,canonicalMembership,compareMembership,packClusters,packMembers,packMembership,debugClusterOverlay,WebGPUOccluderClusters};
});
