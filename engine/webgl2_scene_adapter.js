'use strict';

(function(root,factory){
  let sceneApi=root?.SteelMothRenderScene;
  if(typeof module==='object'&&module.exports){sceneApi=require('./render_scene.js');module.exports=factory(sceneApi,root)}
  else{const api=factory(sceneApi,root);if(root)root.SteelMothWebGL2SceneAdapter=api}
})(typeof globalThis!=='undefined'?globalThis:this,function(Scene,root){
  if(!Scene)throw new Error('SteelMothRenderScene is required before the WebGL2 scene adapter');

  const CAPTURE_METHODS=Object.freeze(['add','addGround','addRootedGrass','addHDRootedGrass','addHDForeground','addHDSubrectForeground','addTop','addHD','addHDSubrect','addHDTint']);
  const clone=value=>{if(value==null)return value;if(typeof structuredClone==='function'){try{return structuredClone(value)}catch(_e){}}return JSON.parse(JSON.stringify(value))};
  const strip=(record,keys)=>{const out={};for(const [k,v] of Object.entries(record||{}))if(!keys.has(k))out[k]=clone(v);return out};

  class WebGL2SceneAdapter{
    constructor(renderer,originals){this.renderer=renderer;this.originals=originals}
    replaySprite(s){
      const t=s.transform||{},st=s.style||{},name=s.spriteId,r=this.originals;
      if(s.category==='static')return;
      if(s.atlas==='legacy'){
        if(s.primitive==='rooted-quad')return r.addRootedGrass(name,t.x,s.root?.y??t.y,t.w,t.h,st.color,st.alpha,s.sway,s.category==='foreground');
        if(s.category==='ground')return r.addGround(name,t.x,t.y,t.w,t.h,st.color,st.alpha,st.glow,t.rotation);
        if(s.category==='top')return r.addTop(name,t.x,t.y,t.w,t.h,st.color,st.alpha,st.glow,t.rotation);
        return r.add(name,t.x,t.y,t.w,t.h,st.color,st.alpha,st.glow,t.rotation);
      }
      if(s.primitive==='rooted-hd-quad')return r.addHDRootedGrass(name,t.x,s.root?.y??t.y,t.w,t.h,st.tint,st.alpha,s.sway,s.category==='foreground',t.flip);
      if(s.category==='foreground'&&s.subrect){const q=s.subrect;return r.addHDSubrectForeground(name,q.sx,q.sy,q.sw,q.sh,t.x,t.y,t.w,t.h,st.alpha,t.rotation,st.tint,t.flip)}
      if(s.category==='foreground')return r.addHDForeground(name,t.x,t.y,t.w,t.h,st.alpha,t.rotation,st.tint,t.flip);
      if(s.subrect){const q=s.subrect;return r.addHDSubrect(name,q.sx,q.sy,q.sw,q.sh,t.x,t.y,t.w,t.h,st.alpha,st.glow,t.rotation,st.tint,t.flip)}
      if(st.materialMode==='tint')return r.addHDTint(name,t.x,t.y,t.w,t.h,st.alpha,st.glow,t.rotation,st.tint);
      return r.addHD(name,t.x,t.y,t.w,t.h,st.alpha,st.glow,t.rotation,st.tint,t.flip);
    }
    pointLights(scene){const skip=new Set(['schema','id','stableIdBasis','type']);return (scene.lights||[]).filter(l=>l.id!=='light:player-cone:0').map(l=>strip(l,skip))}
    occluders(scene){const skip=new Set(['schema','id','stableIdBasis','bounds','root','zRange','materialClass','silhouetteClass']);return (scene.occluders||[]).map(o=>strip(o,skip))}
    descriptor(scene,kind){return clone((scene.proceduralLayers||[]).find(p=>p.kind===kind)?.descriptor??null)}
    playerCone(scene){return scene.playerCone?strip(scene.playerCone,new Set(['schema','id','stableIdBasis','type'])):null}
    consume(scene){
      Scene.validateRenderScene(scene);
      for(const sprite of scene.sprites||[])this.replaySprite(sprite);
      return this.originals.end(clone(scene.post?.grade||[1,1,1]),this.pointLights(scene),this.occluders(scene),clone(scene.settings||{}),this.descriptor(scene,'effects')||[],clone(scene.overlays?.guide||null),this.descriptor(scene,'water'),clone(scene.overlays?.objectiveMarker||null),this.descriptor(scene,'grass'),this.descriptor(scene,'foliage'),this.playerCone(scene));
    }
  }

  class RenderSceneBridge{
    constructor(game){
      if(!game?.renderer)throw new Error('RenderSceneBridge requires a game with a renderer');
      this.game=game;this.renderer=game.renderer;this.sequence=0;this.builder=null;this.active=false;this.disabled=false;this.lastScene=null;this.lastError='';this.failedFrames=0;this.pending=[];this.originals={};
      for(const name of ['begin','end',...CAPTURE_METHODS]){if(typeof this.renderer[name]!=='function')throw new Error(`renderer method missing: ${name}`);this.originals[name]=this.renderer[name].bind(this.renderer)}
      this.adapter=new WebGL2SceneAdapter(this.renderer,this.originals);this.installRendererHooks();this.installScopeHooks();this.renderer.renderSceneBridge=this;this.game.renderSceneBridge=this;
    }
    installRendererHooks(){const bridge=this;this.renderer.begin=function(...args){return bridge.begin(...args)};this.renderer.end=function(...args){return bridge.end(...args)};for(const method of CAPTURE_METHODS)this.renderer[method]=function(...args){return bridge.capture(method,args)}}
    wrapScope(obj,name,scope){if(!obj||typeof obj[name]!=='function')return;const marker=`__smRenderScope_${name}`;if(obj[marker])return;const bridge=this,original=obj[name];obj[name]=function(...args){return bridge.withScope(scope,()=>original.apply(this,args))};obj[marker]=true}
    installScopeHooks(){for(const [obj,name,scope] of [[this.game,'renderFloaterFX','floater'],[this.game,'renderHeroGrass','hero-grass'],[this.game,'renderTreesBack','trees-back'],[this.game,'renderObjectives','objectives'],[this.game,'renderMothPickups','moth-pickups'],[this.game,'renderMiniRobots','mini-robots'],[this.game,'renderPlayer','player'],[this.game,'renderForegroundScenery','foreground-scenery'],[this.game.fireflies,'render','fireflies'],[this.game.creatures,'render','creatures'],[this.game.followers,'render','followers'],[this.game.flock,'render','moths'],[this.game.particles,'render','particles']])this.wrapScope(obj,name,scope)}
    withScope(scope,fn){return this.builder?this.builder.withScope(scope,fn):fn()}
    begin(...args){
      const result=this.originals.begin(...args);if(this.disabled)return result;
      this.active=true;this.pending=[];this.lastError='';this.builder=new Scene.RenderSceneBuilder({sequence:this.sequence++,roomId:this.game.room?.key||`room-${this.game.room?.index??'unknown'}`});
      this.builder.captureStatic(this.renderer.staticMaterialSprites||[],this.renderer);return result;
    }
    capture(method,args){if(!this.active||this.disabled)return this.originals[method](...args);this.pending.push([method,args]);try{return this.builder.captureSprite(method,args,this.renderer)}catch(error){this.lastError=String(error?.stack||error);return null}}
    fallback(endArgs,error){this.failedFrames++;this.lastError=String(error?.stack||error);console.warn('Render Scene bridge disabled after capture failure; WebGL2 direct submission restored for this session.',error);for(const [method,args] of this.pending)this.originals[method](...args);this.disabled=true;this.active=false;this.builder=null;return this.originals.end(...endArgs)}
    end(...args){
      if(!this.active||this.disabled)return this.originals.end(...args);if(this.lastError)return this.fallback(args,new Error(this.lastError));
      try{
        const [grade,lights,occluders,settings,effects,guide,water,objectiveMarker,grass,foliage,playerCone]=args;
        const scene=this.builder.finalize({logicalSize:[640,360],grade,lights,occluders,settings,effects,guide,water,objectiveMarker,grass,foliage,playerCone});
        this.lastScene=scene;this.game.renderScene=scene;this.renderer.lastRenderScene=scene;if(root)root.steelMothLastRenderScene=scene;
        const result=this.adapter.consume(scene);this.active=false;this.builder=null;this.pending=[];return result;
      }catch(error){return this.fallback(args,error)}
    }
    diagnostics(){return {schema:Scene.SCHEMA,enabled:!this.disabled,failedFrames:this.failedFrames,lastError:this.lastError,sequence:this.sequence,lastStats:clone(this.lastScene?.stats||null)}}
  }

  function attachGame(game){
    if(!game?.renderer)return null;if(game.renderSceneBridge instanceof RenderSceneBridge)return game.renderSceneBridge;if(game.__smRenderSceneBridge)return game.__smRenderSceneBridge;
    try{const bridge=new RenderSceneBridge(game);game.__smRenderSceneBridge=bridge;return bridge}catch(error){console.warn('Render Scene bridge unavailable; continuing with direct WebGL2 submission.',error);game.__smRenderSceneBridgeError=String(error?.stack||error);return null}
  }

  function installWhenGameAvailable(target=root){
    if(!target)return null;if(target.__smRenderSceneInstall)return target.__smRenderSceneInstall;
    const install={attached:false,bridge:null};target.__smRenderSceneInstall=install;
    const attach=value=>{const bridge=attachGame(value);if(bridge){install.attached=true;install.bridge=bridge}return bridge};
    if(target.game)attach(target.game);
    const existing=Object.getOwnPropertyDescriptor(target,'game');
    if(!existing||existing.configurable){
      let local=existing&&'value'in existing?existing.value:undefined;
      const read=()=>existing?.get?existing.get.call(target):local,write=value=>{if(existing?.set)existing.set.call(target,value);else local=value};
      Object.defineProperty(target,'game',{configurable:true,enumerable:true,get(){return read()},set(value){write(value);attach(read()||value)}});const current=read();if(current)attach(current);
    }else if(!install.attached&&typeof target.setInterval==='function'){const timer=target.setInterval(()=>{if(target.game){attach(target.game);target.clearInterval(timer)}},16)}
    return install;
  }

  const api={CAPTURE_METHODS,WebGL2SceneAdapter,RenderSceneBridge,attachGame,installWhenGameAvailable};
  if(root&&root.window===root){root.SteelMothWebGL2SceneAdapter=api;installWhenGameAvailable(root)}
  return api;
});
