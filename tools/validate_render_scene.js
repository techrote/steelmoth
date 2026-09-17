'use strict';

const assert = require('assert');
const Scene = require('../engine/render_scene.js');
const Adapter = require('../engine/webgl2_scene_adapter.js');

function makeRenderer(log){
  const methods=['begin','end',...Adapter.CAPTURE_METHODS];
  const renderer={
    staticMaterialSprites:[{name:'cargo_crate',x:44,y:80,w:24,h:28,alpha:1,rot:0,tint:[1,1,1],flip:false,mode:'flat',anchor:'bottom',footX:44,footY:80}],
    hdArt:{
      worldScale:.12,
      regionMeta(name){return {material:'metal',casts_shadow:true,shadow_profile:{kind:name==='cargo_crate'?'box':'character'},material_v2:{material_class:name==='cargo_crate'?'box':'character',root_anchor:[.5,1],height_scale:22,height_bias:0}}},
      region(){return [0,0,32,32]}
    },
    foliageFX:{ready:true}
  };
  for(const name of methods){
    renderer[name]=(...args)=>{log.push({name,args});return name==='end'?'presented':undefined};
  }
  return renderer;
}

function makeGame(renderer){
  return {
    renderer,
    room:{key:'fixture-room',index:0},
    state:{completed:['keep-gameplay-authority']},
    renderFloaterFX(){},renderHeroGrass(){},renderTreesBack(){},renderObjectives(){},renderMothPickups(){},renderMiniRobots(){},renderPlayer(){},renderForegroundScenery(){},
    fireflies:{render(){}},creatures:{render(){}},followers:{render(){}},flock:{render(){}},particles:{render(){}}
  };
}

function submitFrame(game,variant=0){
  const r=game.renderer,bridge=game.renderSceneBridge;
  r.begin();
  bridge.withScope('player',()=>{
    r.addHD(variant?'player_walk_0':'player_idle_0',320+variant,170,22,26,1,false,0,[.8,.9,1],false);
    r.add('spark',322+variant,160,2,2,[1,.8,.4],.7,true,0);
  });
  bridge.withScope('foreground-scenery',()=>r.addHDForeground('tree_canopy',400,120,72,96,.99,0,[.7,.9,.8],false));
  const light={group:'objective',x:100,y:120,z:18,radius:72,intensity:.2,color:[1,.8,.4]};
  const caster={rect:[32,50,56,80],x:44,y:65,contactY:80,kind:'decor',strength:.8,source:'fixture-crate',sections:[{z:18,a:[32,75],b:[56,75]}]};
  const cone={enabled:true,x:320,y:170,dx:1,dy:0,z:22,range:248,intensity:2,color:[1,1,1]};
  return r.end([1,1,1],[light],[caster],{lighting:true,materialV2:true},[{kind:1,x:20,y:30,age:0,life:1,color:[1,1,1]}],{x:320,y:170,color:[1,1,1],visible:false},{time:0,color:[.1,.3,.5]},{x:80,y:90,color:[1,.7,.2]},{time:0,baseColor:[.1,.2,.1],tipColor:[.2,.4,.2],highlightColor:[.3,.5,.4],interactions:[]},{time:0,baseColor:[.2,.4,.2],highlightColor:[.4,.6,.4]},cone);
}

const log=[];
const renderer=makeRenderer(log);
const game=makeGame(renderer);
const originalState=JSON.stringify(game.state);
const bridge=Adapter.attachGame(game);
assert(bridge instanceof Adapter.RenderSceneBridge);
assert.strictEqual(submitFrame(game,0),'presented');
assert.strictEqual(JSON.stringify(game.state),originalState,'render bridge mutated gameplay state');

const scene1=game.renderScene;
assert(Scene.validateRenderScene(scene1));
assert.strictEqual(scene1.schema,'steelmoth-render-scene/v1');
assert.strictEqual(scene1.frame.roomId,'fixture-room');
assert.strictEqual(scene1.stats.spriteCount,4);
assert.strictEqual(scene1.stats.spriteCategories.static,1);
assert.strictEqual(scene1.stats.spriteCategories.dynamic,2);
assert.strictEqual(scene1.stats.spriteCategories.foreground,1);
assert.strictEqual(scene1.stats.lightCount,2);
assert.strictEqual(scene1.stats.occluderCount,1);
assert.strictEqual(scene1.stats.proceduralLayerCount,4);
assert(scene1.materials.some(m=>m.id==='material:player_idle_0:normal'));
assert(scene1.sprites.some(s=>s.id==='sprite:player:0'&&s.spriteId==='player_idle_0'));
assert(scene1.sprites.some(s=>s.id==='sprite:player:1'&&s.spriteId==='spark'));
assert(scene1.sprites.some(s=>s.category==='static'&&s.id==='sprite:static:fixture-room:0'));
assert(scene1.lights.some(l=>l.id==='light:player-cone:0'));
assert(scene1.occluders.some(o=>o.id==='occluder:fixture-crate:0'));
assert(scene1.proceduralLayers.some(p=>p.id==='procedural:water'&&p.category==='procedural'));

const firstReplay=log.map(x=>x.name);
assert.deepStrictEqual(firstReplay,['begin','addHD','add','addHDForeground','end'],'WebGL2 replay order changed');
log.length=0;
assert.strictEqual(submitFrame(game,1),'presented');
const scene2=game.renderScene;
assert(Scene.validateRenderScene(scene2));
const dynamicIds=s=>s.sprites.filter(x=>x.category!=='static').map(x=>x.id);
assert.deepStrictEqual(dynamicIds(scene2),dynamicIds(scene1),'stable render-scope IDs changed when animation/transform changed');
assert.strictEqual(scene2.sprites.find(s=>s.id==='sprite:player:0').spriteId,'player_walk_0');
assert.deepStrictEqual(log.map(x=>x.name),['begin','addHD','add','addHDForeground','end']);
assert.strictEqual(bridge.diagnostics().enabled,true);
assert.strictEqual(bridge.diagnostics().failedFrames,0);

console.log('RENDER SCENE PASS: typed scene validates; static/dynamic/foreground/procedural categories explicit; stable scope IDs retained; WebGL2 replay order preserved; gameplay state untouched');
