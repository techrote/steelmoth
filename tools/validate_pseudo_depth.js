'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const Depth=require('../engine/pseudo_depth.js');

const ROOT=path.resolve(__dirname,'..');
const EPS=1e-9;
const approx=(a,b,msg='')=>assert.ok(Math.abs(Number(a)-Number(b))<=EPS,`${msg} expected ${b}, got ${a}`);
const loadJson=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));

function validateVectors(){
  const vectors=loadJson('render-tests/pseudo-depth/vectors.json');
  assert.strictEqual(vectors.model,Depth.SCHEMA);
  for(const vector of vectors.vectors){
    const got=Depth.projectFragment(vector.input),exp=vector.expected;
    if('covered' in exp)assert.strictEqual(got.covered,exp.covered,vector.id);
    if(exp.covered===false){assert.strictEqual(got.depth01,null,vector.id);continue;}
    if('projectedGroundY' in exp)approx(got.projectedGroundY,exp.projectedGroundY,`${vector.id}: projectedGroundY`);
    if('visibilityKey' in exp)approx(got.visibilityKey,exp.visibilityKey,`${vector.id}: visibilityKey`);
    assert.ok(got.depth01>=0&&got.depth01<=1,`${vector.id}: depth01 range`);
  }
}

function validateGeometry(){
  approx(Depth.worldZFromLocalHeight(.3125),20,'height units');
  approx(Depth.worldZFromLocalHeight(2),64,'height clamp');
  assert.strictEqual(Depth.layerFor('static'),Depth.layerFor('dynamic'),'static/dynamic must share world lane');
  assert.ok(Depth.layerFor('foreground')>Depth.layerFor('dynamic'),'foreground lane must be closer');
  assert.ok(Depth.layerFor('ground')<Depth.layerFor('dynamic'),'ground lane must be behind');
  assert.strictEqual(Depth.sampleU(.2,true),.8,'flip mirrors atlas U only');

  const root=Depth.projectFragment({rootY:180,fragmentScreenY:180,localHeight:0,category:'dynamic'});
  const mid=Depth.projectFragment({rootY:180,fragmentScreenY:160,localHeight:.3125,category:'dynamic'});
  const top=Depth.projectFragment({rootY:180,fragmentScreenY:120,localHeight:.9375,category:'dynamic'});
  approx(root.visibilityKey,mid.visibilityKey,'vertical mid cancellation');
  approx(root.visibilityKey,top.visibilityKey,'vertical top cancellation');

  const moved=Depth.projectFragment({rootY:180.25,fragmentScreenY:160.25,localHeight:.3125,category:'dynamic'});
  approx(moved.visibilityKey-root.visibilityKey,.25,'subpixel monotonicity');

  const rear=Depth.projectFragment({rootY:166,fragmentScreenY:146,localHeight:.3125,category:'dynamic'});
  const front=Depth.projectFragment({rootY:181,fragmentScreenY:161,localHeight:.3125,category:'dynamic'});
  assert.strictEqual(Depth.compare(front,rear),1,'larger root/projected Y must be nearer');
  assert.ok(front.depth01<rear.depth01,'nearer visibility key must map to smaller hardware depth');

  const fg=Depth.projectFragment({rootY:20,fragmentScreenY:20,localHeight:0,category:'foreground'});
  const world=Depth.projectFragment({rootY:400,fragmentScreenY:400,localHeight:0,category:'dynamic'});
  assert.strictEqual(Depth.compare(fg,world),1,'foreground lane must dominate world-Y range');

  const sprite={category:'dynamic',root:{y:180},transform:{x:100,y:170,w:20,h:40,rotation:Math.PI/2,flip:false}};
  const p=Depth.fragmentScreenPosition(sprite,.5,0);
  approx(p.y,170,'rotation uses actual raster position around draw centre');
  const rotated=Depth.projectSpriteFragment(sprite,{u:.5,v:0,localHeight:10/64});
  approx(rotated.projectedGroundY,180,'rotated fragment reconstructs ground depth');
  const flipped={...sprite,transform:{...sprite.transform,flip:true}};
  approx(Depth.fragmentScreenPosition(flipped,.5,0).y,p.y,'flip does not move geometry/root');

  const lit0=Depth.projectFragment({rootY:181,fragmentScreenY:161,localHeight:.3125,category:'dynamic',lightAngle:0});
  const lit180=Depth.projectFragment({rootY:181,fragmentScreenY:161,localHeight:.3125,category:'dynamic',lightAngle:180});
  assert.deepStrictEqual(lit0,lit180,'light parameters must not affect ownership depth');
}

function decorSignature(fixture){
  return (fixture.scene?.editor_decor||[]).map(d=>({id:d.editor_id,sprite:d.sprite,x:Number(d.x),y:Number(d.y),scale:Number(d.scale??1),flip:!!d.flip}));
}
function fixtureProbe(fixture){
  const objects=decorSignature(fixture).map(d=>{
    const root=Depth.projectFragment({rootY:d.y,fragmentScreenY:d.y,localHeight:0,category:'dynamic'});
    const vertical=Depth.projectFragment({rootY:d.y,fragmentScreenY:d.y-16*d.scale,localHeight:(16*d.scale)/Depth.MAX_WORLD_Z,category:'dynamic'});
    approx(vertical.visibilityKey,root.visibilityKey,`${fixture.name}:${d.id}: vertical prototype`);
    return{...d,rootKey:root.visibilityKey,verticalKey:vertical.visibilityKey,depth01:root.depth01};
  });
  const frontToBack=[...objects].sort((a,b)=>b.rootKey-a.rootKey||String(a.id).localeCompare(String(b.id))).map(o=>o.id);
  return{name:fixture.name,lightAngle:Number(fixture.light?.angle_deg),objects,frontToBack};
}
function xml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function fixtureSvg(reports){
  const width=760,rowH=210,height=40+reports.length*rowH;
  let out=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<rect width="100%" height="100%" fill="#101418"/>\n<style>text{font:12px monospace;fill:#e8edf2}.muted{fill:#94a3ad}.root{fill:#fff}.vert{stroke:#76b7ff;stroke-width:2}.guide{stroke:#3d4952;stroke-width:1}</style>\n`;
  reports.forEach((r,ri)=>{
    const oy=30+ri*rowH;out+=`<text x="16" y="${oy}" font-weight="bold">${xml(r.name)} · light ${r.lightAngle}° · front→back ${xml(r.frontToBack.join(' > '))}</text>\n`;
    out+=`<line class="guide" x1="16" y1="${oy+165}" x2="744" y2="${oy+165}"/>\n`;
    for(const o of r.objects){const x=40+(o.x-270)*3.2,y=oy+150-(o.y-145)*2.2,top=y-35*o.scale;out+=`<line class="vert" x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${x.toFixed(2)}" y2="${top.toFixed(2)}"/>\n<circle class="root" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4"/>\n<text x="${(x+7).toFixed(2)}" y="${(y-5).toFixed(2)}">${xml(o.id)} K=${o.rootKey.toFixed(2)}</text>\n<text class="muted" x="${(x+7).toFixed(2)}" y="${(top+2).toFixed(2)}">screenY↓ + worldZ↑ = same K</text>\n`;}
  });
  return out+'</svg>\n';
}

function validateFixtures(){
  const names=['binsright','binsleft','binsup','binsupleft','box-pair'];
  const fixtures=names.map(n=>loadJson(`render-tests/fixtures/${n}.json`));
  const binSig=JSON.stringify(decorSignature(fixtures[0]));
  for(const f of fixtures.slice(1,4))assert.strictEqual(JSON.stringify(decorSignature(f)),binSig,`${f.name}: bin geometry must match while light angle changes`);
  const reports=fixtures.map(f=>fixtureProbe(f));
  for(const r of reports.slice(0,4))assert.deepStrictEqual(r.frontToBack,['bin-front','bin-rear','bin-side'],`${r.name}: stable bin ownership ordering`);
  assert.deepStrictEqual(reports[4].frontToBack,['box-a','box-b'],'box-pair: stable control ordering');
  assert.deepStrictEqual(reports.slice(0,4).map(r=>r.frontToBack.join('|')),Array(4).fill('bin-front|bin-rear|bin-side'),'light-angle invariant bin order');
  const artifactDir=path.join(ROOT,'artifacts');fs.mkdirSync(artifactDir,{recursive:true});
  const payload={schema:'steelmoth-pseudo-depth-debug/v1',model:Depth.diagnostics(),note:'Geometric prototype probes use fixture-declared editor roots and vertical-face cancellation. They are model/debug evidence, not production depth writes or human screenshot parity.',fixtures:reports};
  fs.writeFileSync(path.join(artifactDir,'pseudo-depth-debug.json'),JSON.stringify(payload,null,2)+'\n');
  fs.writeFileSync(path.join(artifactDir,'pseudo-depth-fixtures.svg'),fixtureSvg(reports));
  return reports;
}

validateVectors();
validateGeometry();
const reports=validateFixtures();
console.log(`Pseudo-depth model PASS: ${Depth.SCHEMA}; ${reports.length} fixture prototypes; production depth writes remain deferred to SM-202.`);
