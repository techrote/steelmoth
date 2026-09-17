'use strict';

(function(root,factory){
  let Scene=root?.SteelMothRenderScene,T=root?.SteelMothRenderTransform;
  if(typeof module==='object'&&module.exports){Scene=require('./render_scene.js');T=require('./render_transform.js');module.exports=factory(Scene,T,root)}
  else{const api=factory(Scene,T,root);if(root)root.SteelMothRenderTransformSceneAdapter=api}
})(typeof globalThis!=='undefined'?globalThis:this,function(Scene,T,root){
  if(!Scene||!T)throw new Error('RenderScene and RenderTransform are required');
  const P=Scene.RenderSceneBuilder?.prototype;
  if(!P)throw new Error('RenderSceneBuilder unavailable');

  function dimensions(renderer,rec){
    let w=Number(rec?.transform?.w),h=rec?.transform?.h==null?null:Number(rec.transform.h);
    if(!Number.isFinite(w))w=0;
    if(h==null||!Number.isFinite(h)){
      const r=renderer?.hdArt?.regions?.[rec.spriteId];
      h=Array.isArray(r)&&r[2]?w*Number(r[3])/Number(r[2]):0;
    }
    return[w,h];
  }

  function canonicalize(rec,renderer,{anchor='center',explicitRoot=null}={}){
    if(!rec)return rec;
    const [w,h]=dimensions(renderer,rec),tr=rec.transform||{},q=T.resolve(rec.atlas==='hd'?renderer?.hdArt:null,rec.spriteId,{x:tr.x,y:tr.y,w,h,anchor,subrect:rec.subrect||null,rotation:tr.rotation,flip:tr.flip,explicitRoot});
    rec.transform.w=w;rec.transform.h=h;
    rec.root={authority:q.root.authority,anchorMode:anchor,anchorNormalized:q.root.normalized.slice(),metadataSource:q.root.metadataSource,x:q.root.x,y:q.root.y};
    return rec;
  }

  function install(){
    if(P.__sm101SharedTransformInstalled)return false;
    P.__sm101SharedTransformInstalled=true;
    const captureStatic=P.captureStatic,captureSprite=P.captureSprite,finalize=P.finalize;
    P.captureStatic=function(staticSprites=[],renderer=null){
      const before=this.sprites.length,result=captureStatic.call(this,staticSprites,renderer),added=this.sprites.slice(before);
      for(const rec of added){
        const ordinal=Number(String(rec.id||'').split(':').pop()),d=Number.isInteger(ordinal)?(staticSprites[ordinal]||{}):{};
        canonicalize(rec,renderer,{anchor:d.anchor||'bottom'});
      }
      return result;
    };
    P.captureSprite=function(method,args,renderer){
      const rec=captureSprite.call(this,method,args,renderer);
      if(!rec)return rec;
      if(method==='addRootedGrass'||method==='addHDRootedGrass')canonicalize(rec,renderer,{anchor:'bottom',explicitRoot:{x:rec.transform.x,y:rec.transform.y}});
      else canonicalize(rec,renderer,{anchor:'center'});
      return rec;
    };
    P.finalize=function(frame={}){
      const scene=finalize.call(this,frame);
      for(const o of scene.occluders||[]){
        const x=Number(o.rootX),y=Number(o.rootY),hasShared=Number.isFinite(x)&&Number.isFinite(y);
        o.root={...(o.root||{}),x:hasShared?x:o.root?.x,y:hasShared?y:o.root?.y,authority:hasShared?String(o.rootAuthority||'shared-render-transform/v1'):'explicit-occluder-contact',anchorMode:hasShared?'shared-caster-root':'explicit-caster-contact'};
        if(hasShared)o.shadowContact={x:Number.isFinite(Number(o.shadowContactX))?Number(o.shadowContactX):o.root.x,y:Number.isFinite(Number(o.shadowContactY))?Number(o.shadowContactY):o.root.y,offsetX:Number(o.shadowContactOffsetX)||0,offsetY:Number(o.shadowContactOffsetY)||0};
      }
      scene.transformAuthority={schema:T.SCHEMA,rootConvention:'unrotated-ground-contact',rotationAffectsRoot:false,flipAffectsRoot:false,shadowContactPolicy:'explicit-offset-from-shared-root'};
      return scene;
    };
    return true;
  }

  install();
  const api={schema:'steelmoth-render-transform-scene-adapter/v1',install,canonicalize};
  if(root)root.SteelMothRenderTransformSceneAdapter=api;
  return api;
});
