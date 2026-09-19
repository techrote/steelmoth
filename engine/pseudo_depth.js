'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothPseudoDepth=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SCHEMA='steelmoth-pseudo-depth/v1';
  const MAX_WORLD_Z=64;
  const Z_TO_SCREEN_Y=1;
  const LAYER_STRIDE=1024;
  const DEPTH_KEY_MIN=-2048;
  const DEPTH_KEY_MAX=3072;
  const DEFAULT_ALPHA_CUTOFF=.12;
  const CATEGORY_LAYER=Object.freeze({ground:-1,static:0,dynamic:0,foreground:1,top:2});
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  // SM-503 names the Material-v2 height meaning explicitly. HM.R is authored
  // world-Z / MAX_WORLD_Z; G2.R is that same quantity after the renderer's uniform
  // sprite-size compatibility factor. Ownership and self/contact shadows therefore
  // decode exactly one shared height field rather than inventing private scales.
  function worldZFromMaterialHeight(encodedHeight,renderScale=1,heightBiasWorld=0){
    const encoded=clamp(finite(encodedHeight,0),0,1);
    const scale=clamp(finite(renderScale,1),0,4.5);
    return encoded*MAX_WORLD_Z*scale+finite(heightBiasWorld,0);
  }

  // Compatibility name retained for SM-201/202 callers. `localHeight` is the
  // normalized Material-v2/G2 encoded world-height sample, not a colour-derived bump.
  function worldZFromLocalHeight(localHeight){
    return worldZFromMaterialHeight(localHeight,1,0);
  }

  function layerFor(category,explicitLayer=null){
    if(explicitLayer!=null&&Number.isFinite(Number(explicitLayer)))return Number(explicitLayer);
    return CATEGORY_LAYER[String(category||'dynamic')]??0;
  }

  function sampleU(u,flip=false){
    u=clamp(finite(u,.5),0,1);return flip?1-u:u;
  }

  function fragmentScreenPosition(sprite,u=.5,v=.5){
    const t=sprite?.transform||{},w=finite(t.w,0),h=finite(t.h,0),x=finite(t.x,0),y=finite(t.y,0),r=finite(t.rotation,0);
    const dx=(clamp(finite(u,.5),0,1)-.5)*w,dy=(clamp(finite(v,.5),0,1)-.5)*h,co=Math.cos(r),si=Math.sin(r);
    return{x:x+dx*co-dy*si,y:y+dx*si+dy*co};
  }

  function projectFragment(opts={}){
    const alpha=finite(opts.alpha,1),alphaCutoff=clamp(finite(opts.alphaCutoff,DEFAULT_ALPHA_CUTOFF),0,1);
    if(alpha<alphaCutoff)return{schema:SCHEMA,covered:false,depth01:null,visibilityKey:null,projectedGroundY:null,worldZ:null,layer:null};
    const rootY=finite(opts.rootY,0),fragmentScreenY=finite(opts.fragmentScreenY,rootY),localFromRootY=fragmentScreenY-rootY,worldZ=worldZFromMaterialHeight(opts.localHeight),projectedGroundY=rootY+localFromRootY+worldZ*Z_TO_SCREEN_Y;
    const layer=layerFor(opts.category,opts.layer),bias=finite(opts.bias,0),visibilityKey=layer*LAYER_STRIDE+projectedGroundY+bias;
    const span=DEPTH_KEY_MAX-DEPTH_KEY_MIN,depth01=clamp((DEPTH_KEY_MAX-visibilityKey)/span,0,1);
    return{schema:SCHEMA,covered:true,rootY,fragmentScreenY,localFromRootY,localHeight:clamp(finite(opts.localHeight,0),0,1),worldZ,projectedGroundY,layer,bias,visibilityKey,depth01};
  }

  function projectSpriteFragment(sprite,sample={}){
    const p=fragmentScreenPosition(sprite,sample.u,sample.v),rootY=finite(sprite?.root?.y,p.y);
    return projectFragment({rootY,fragmentScreenY:p.y,localHeight:sample.localHeight,alpha:sample.alpha,alphaCutoff:sample.alphaCutoff,category:sprite?.category,layer:sample.layer??sprite?.depthLayer,bias:sample.bias??sprite?.depthBias});
  }

  function compare(a,b,epsilon=1e-7){
    const ka=a?.visibilityKey,kb=b?.visibilityKey;if(!Number.isFinite(ka)||!Number.isFinite(kb))return 0;
    if(Math.abs(ka-kb)<=Math.max(0,finite(epsilon,1e-7)))return 0;
    return ka>kb?1:-1;
  }

  function diagnostics(){return{schema:SCHEMA,maxWorldZ:MAX_WORLD_Z,zToScreenY:Z_TO_SCREEN_Y,layerStride:LAYER_STRIDE,depthKeyRange:[DEPTH_KEY_MIN,DEPTH_KEY_MAX],categoryLayer:{...CATEGORY_LAYER},alphaCutoff:DEFAULT_ALPHA_CUTOFF,materialHeightEncoding:'G2.R * MAX_WORLD_Z after uniform render-scale compatibility',materialHeightSemantics:'SM-503/v1',productionDepthWrites:true,productionOwner:'SM-202',productionModule:'engine/webgpu_ownership.js'};}

  return{SCHEMA,MAX_WORLD_Z,Z_TO_SCREEN_Y,LAYER_STRIDE,DEPTH_KEY_MIN,DEPTH_KEY_MAX,DEFAULT_ALPHA_CUTOFF,CATEGORY_LAYER,worldZFromMaterialHeight,worldZFromLocalHeight,layerFor,sampleU,fragmentScreenPosition,projectFragment,projectSpriteFragment,compare,diagnostics};
});
