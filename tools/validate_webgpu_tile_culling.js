'use strict';
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const G=require(path.join(ROOT,'engine/webgpu_gbuffer.js'));
const O=require(path.join(ROOT,'engine/webgpu_occluders.js'));
const L=require(path.join(ROOT,'engine/webgpu_lighting.js'));
const C=require(path.join(ROOT,'engine/webgpu_clusters.js'));
const D=require(path.join(ROOT,'engine/webgpu_dominance.js'));
const H=require(path.join(ROOT,'engine/webgpu_dso.js'));
const T=require(path.join(ROOT,'engine/webgpu_tile_culling.js'));
let checks=0;const assert=(ok,msg)=>{checks++;if(!ok)throw new Error(msg)};

assert(T.SNAPSHOT_SCHEMA==='steelmoth-webgpu-tile-culling-snapshot/v1','snapshot schema pinned');
assert(T.TILE_RECORD_STRIDE===16,'tile record ABI pinned');
assert(T.RESERVED_CONSUMERS.join(',')==='gtao,ssgi,volumetrics','future consumers reserved without implementation');

const scene={frame:{roomId:'sm504-fixture',logicalSize:[256,128]},occluders:[
  {id:'static-machine',rect:[30,28,74,86],root:{x:52,y:86},kind:'machine',dynamic:false,majorOccluder:true,sections:[{z:24}]},
  {id:'dynamic-robot',rect:[176,52,204,92],root:{x:190,y:92},kind:'robot',dynamic:true,majorOccluder:true,sections:[{z:18}]}
]};
const occ=O.buildOccluderSnapshot(scene,{tileSize:32,maxOccluders:64,maxPerTile:16,maxTileRefs:512});
const settings={lighting:true,ambient:.3,emissive:1,lightRadius:1,normalStrength:1,heightStrength:1,roughnessScale:1,metalnessScale:1,materialAOStrength:.62,pbrSpecularStrength:.70};
const lightScene={lights:[
  {id:'left',x:50,y:50,z:20,radius:58,intensity:1,color:[1,.9,.8]},
  {id:'right',x:210,y:78,z:18,radius:46,intensity:.8,color:[.7,.85,1]}
]};
const lights=L.buildCanonicalLights(lightScene,settings);assert(lights.length===2,'canonical two-light fixture');
let tiles=T.buildSharedTileSnapshot(occ,lights,{maxLightRefs:512});
assert(T.sameGrid(tiles.grid,occ.grid),'SM-300 grid is reused verbatim');
assert(tiles.diagnostics.lightCount===2,'canonical light count recorded');
assert(tiles.diagnostics.occupiedTiles>0&&tiles.diagnostics.dynamicTiles>0,'static/dynamic occupancy classified');
assert(tiles.diagnostics.droppedLightRefs===0,'bounded fixture has no light-list overflow');
assert(tiles.diagnostics.workReduction>.45,`light relevance materially reduces pixel-light candidates (${tiles.diagnostics.workReduction})`);
assert(tiles.diagnostics.reservedConsumers.length===3,'future pass interfaces only reserved');

const sample={g0:[.34,.42,.50,1],g1:[.5,.5,1,.78],g2:[.14,.25,1,0]};let maxError=0,points=0;
for(let y=4;y<128;y+=8)for(let x=4;x<256;x+=8){const full=L.shadePixelReference(sample,lights,settings,[x+.5,y+.5],'final'),culled=T.shadePixelReferenceCulled(sample,lights,tiles,settings,[x+.5,y+.5],'final');for(let c=0;c<4;c++)maxError=Math.max(maxError,Math.abs(full[c]-culled[c]));points++}
assert(maxError<2e-6,`conservative tile light lists preserve direct-light reference (${maxError})`);
assert(points>=500,'representative raster sample count retained');
const left=T.lightsForPoint(tiles,lights,32,32).map(l=>l.id),middle=T.lightsForPoint(tiles,lights,128,64).map(l=>l.id);assert(left.includes('left'),'left tile contains relevant left light');assert(!middle.includes('left')&&!middle.includes('right'),'unlit middle region has zero listed lights');

const clusters=C.buildClusterSnapshot(occ);assert(clusters.clusters.length===2,'separated fixture remains two clusters');
const dsoLight={id:'player-light',position:[52,-80,24],radius:500,intensity:1};const dom=D.buildDominanceSnapshot(clusters,occ,[dsoLight]);const plan=H.buildDSOPlan(clusters,occ,dom,{lightId:dsoLight.id,maxJobs:64,maxMembers:128,maxTileRefs:512});assert(plan.jobs.length>0,'DSO plan has work');
tiles=T.withDSORelevance(tiles,plan);const work=T.buildDSOWork(plan,tiles,8);assert(work.activeTileCount===plan.diagnostics.nonEmptyTiles,'shared DSO relevance exactly matches authoritative DSO tile headers');assert(work.workReduction>.20,`DSO compact work plan skips unaffected workgroups (${work.workReduction})`);assert(work.exactCoverage,'DSO work plan declares exact coverage only');
for(let i=0;i<tiles.grid.count;i++){const flag=!!(tiles.tileRecords[i*4]&T.FLAGS.DSO_RELEVANT),count=!!plan.tileHeaders[i*2+1];assert(flag===count,`DSO relevance parity tile ${i}`)}
const mask=H.rasterizeDSOReference(plan),metrics=H.connectedMetrics(mask,tiles.grid.width,tiles.grid.height);assert(metrics.totalArea>0,'existing DSO structural output remains non-empty');
const overlay=T.debugTileOverlay(tiles);assert(overlay.some(t=>t.dsoRelevant),'debug overlay exposes DSO-relevant tiles');assert(overlay.some(t=>t.lights>0),'debug overlay exposes lit tiles');

let mismatchRejected=false;try{T.lightsForPoint(tiles,[...lights].reverse(),10,10)}catch(_e){mismatchRejected=true}assert(mismatchRejected,'stale/reordered canonical light identity fails closed');
let gridRejected=false;try{T.buildDSOWork({...plan,grid:{...plan.grid,tileSize:64}},tiles)}catch(_e){gridRejected=true}assert(gridRejected,'incompatible DSO grid fails closed');

console.log(`SM-504 TILE CULLING PASS: checks=${checks} sampled=${points} maxDirectError=${maxError} lightWorkReduction=${tiles.diagnostics.workReduction.toFixed(3)} dsoWorkReduction=${work.workReduction.toFixed(3)} lightRefs=${tiles.diagnostics.lightRefCount} dsoTiles=${work.activeTileCount}/${tiles.grid.count}`);
