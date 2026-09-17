'use strict';
const assert=require('node:assert/strict');
const T=require('../engine/render_transform.js');
const Scene=require('../engine/render_scene.js');
require('../engine/render_transform_scene_adapter.js');

const regions={crate:[0,0,20,10],offset:[20,0,40,20]};
const metadata={
  crate:{material_v2:{root_anchor:[.5,1]},shadow_profile:{footprint:{left:-.2,right:.2,top:-.1,bottom:0},height_ratio:.8}},
  offset:{material_v2:{root_anchor:[.25,.8]}}
};
const art={regions,regionMeta:name=>metadata[name]||{},worldSize:name=>regions[name]?[regions[name][2],regions[name][3]]:[16,16]};
const renderer={hdArt:art};

function oldFoot(art,name,x,y,w,h,anchor='center',subrect=null){
  const m=art?.regionMeta?.(name)?.material_v2||{},root=Array.isArray(m.root_anchor)?m.root_anchor:[.5,1],rx=Number(root[0]??.5),ry=Number(root[1]??1),r=art?.regions?.[name];
  if(subrect&&r){const sx=Number(subrect.sx||0),sy=Number(subrect.sy||0),sw=Math.max(1,Number(subrect.sw||r[2])),sh=Math.max(1,Number(subrect.sh||r[3])),scaleX=w/sw,scaleY=h/sh,fullW=r[2]*scaleX,fullH=r[3]*scaleY,left=x-w*.5-sx*scaleX,top=y-h*.5-sy*scaleY;return{x:left+rx*fullW,y:top+ry*fullH,rootX:rx,rootY:ry,fullW,fullH}}
  const top=anchor==='bottom'?y-h:anchor==='top'?y:y-h*.5;return{x:x+(rx-.5)*w,y:top+ry*h,rootX:rx,rootY:ry,fullW:w,fullH:h};
}

// Bottom, centre and top inputs describing the same rectangle converge on one root.
const center=T.resolve(art,'crate',{x:100,y:80,w:40,h:20,anchor:'center'});
const bottom=T.resolve(art,'crate',{x:100,y:90,w:40,h:20,anchor:'bottom'});
const top=T.resolve(art,'crate',{x:100,y:70,w:40,h:20,anchor:'top'});
assert.deepEqual(center.root.x,bottom.root.x);assert.deepEqual(center.root.y,bottom.root.y);
assert.deepEqual(center.root.x,top.root.x);assert.deepEqual(center.root.y,top.root.y);
assert.equal(center.root.y,90);

// Preserve every accepted v1.2.3 numeric foot result, including its historical
// subrect-centre convention and non-central metadata root anchors.
for(const f of [
  ['crate',100,80,40,20,'center',null],
  ['crate',100,90,40,20,'bottom',null],
  ['offset',120,70,80,40,'center',null],
  ['offset',120,90,80,40,'bottom',null],
  ['offset',55,42,20,8,'bottom',{sx:5,sy:4,sw:10,sh:8}],
]) assert.deepEqual(T.legacyFootAnchor(art,...f),oldFoot(art,...f));

// v1 root semantics intentionally stay invariant under rendering rotation/flip;
// those alter texel orientation, not ground-contact ordering.
const rf=T.resolve(art,'offset',{x:120,y:70,w:80,h:40,anchor:'center',rotation:1.234,flip:true});
assert.equal(rf.root.x,T.resolve(art,'offset',{x:120,y:70,w:80,h:40,anchor:'center'}).root.x);
assert.equal(rf.root.y,T.resolve(art,'offset',{x:120,y:70,w:80,h:40,anchor:'center'}).root.y);
assert.equal(rf.rotation,1.234);assert.equal(rf.flip,true);

// Editor hit bounds and bottom-anchored preview share the same placement authority.
assert.deepEqual(T.editorBounds(art,'crate',100,90,true,2),{x0:80,y0:70,x1:120,y1:90,w:40,h:20,root:{x:100,y:90,normalized:[.5,1],metadataSource:'material-v2-metadata',authority:'shared-render-transform/v1'}});
const centredEditor=T.editorBounds(art,'crate',100,80,false,2);assert.equal(centredEditor.y0,70);assert.equal(centredEditor.y1,90);assert.equal(centredEditor.root.y,90);

// Shadow geometry retains its accepted contact point while that contact is now
// represented explicitly as an offset from the canonical sprite root.
assert.deepEqual(T.shadowFootRect(metadata.crate,100,90,40,20),[92,88,108,90]);
const sections=T.shadowSections(metadata.crate,100,90,40,20);assert.equal(sections.length,1);assert.equal(sections[0].z,0);
const shadow=T.shadowPlacement(art,'offset',{x:120,y:70,w:80,h:40,anchor:'center',contactX:120,contactY:86});
assert.deepEqual(shadow.root,{x:100,y:82,normalized:[.25,.8],metadataSource:'material-v2-metadata',authority:'shared-render-transform/v1'});
assert.deepEqual(shadow.contact,{x:120,y:86});assert.deepEqual(shadow.contactOffset,{x:20,y:4});
assert.equal(shadow.rect[3],86); // old fallback shadow contact remains byte-equivalent

// RenderScene static/dynamic/foreground copies canonicalize to the same numeric root.
const b=new Scene.RenderSceneBuilder({sequence:1,roomId:'fixture'});
b.captureStatic([{name:'crate',x:100,y:90,w:40,h:20,alpha:1,anchor:'bottom',mode:'flat'}],renderer);
b.withScope('player',()=>b.captureSprite('addHD',['crate',100,80,40,20,1,false,0,[1,1,1],false],renderer));
b.withScope('foreground',()=>b.captureSprite('addHDForeground',['crate',100,80,40,20,1,0,[1,1,1],false],renderer));
const scene=b.finalize({logicalSize:[640,360],occluders:[{source:'offset-test',rect:[112,80,128,86],x:120,y:83,contactY:86,rootX:100,rootY:82,rootAuthority:'shared-render-transform/v1',shadowContactX:120,shadowContactY:86,shadowContactOffsetX:20,shadowContactOffsetY:4}]});
assert.equal(scene.transformAuthority.schema,T.SCHEMA);assert.equal(scene.transformAuthority.shadowContactPolicy,'explicit-offset-from-shared-root');
for(const s of scene.sprites){assert.equal(s.root.authority,'shared-render-transform/v1');assert.equal(s.root.x,100);assert.equal(s.root.y,90)}
assert.deepEqual(scene.stats.spriteCategories,{static:1,ground:0,dynamic:1,foreground:1,top:0});
assert.equal(scene.occluders[0].root.x,100);assert.equal(scene.occluders[0].root.y,82);assert.equal(scene.occluders[0].root.authority,'shared-render-transform/v1');
assert.deepEqual(scene.occluders[0].shadowContact,{x:120,y:86,offsetX:20,offsetY:4});

// Future WebGPU consumers can query stable numeric roots directly; no backend-specific
// transform reconstruction is required.
assert.ok(scene.sprites.every(s=>Number.isFinite(s.root.x)&&Number.isFinite(s.root.y)));
console.log('SM-101 render-transform parity: PASS');
