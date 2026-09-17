'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothRenderScene=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SCHEMA='steelmoth-render-scene/v1';
  const SPRITE_SCHEMA='steelmoth-sprite-instance/v1';
  const MATERIAL_SCHEMA='steelmoth-material-instance/v1';
  const LIGHT_SCHEMA='steelmoth-light-instance/v1';
  const OCCLUDER_SCHEMA='steelmoth-occluder-instance/v1';
  const PROCEDURAL_SCHEMA='steelmoth-procedural-layer/v1';
  const CATEGORIES=Object.freeze(['static','ground','dynamic','foreground','top']);

  const clone=value=>{
    if(value==null)return value;
    if(typeof structuredClone==='function'){
      try{return structuredClone(value)}catch(_e){}
    }
    return JSON.parse(JSON.stringify(value));
  };
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const slug=value=>String(value??'unknown').replace(/[^a-zA-Z0-9_.:-]+/g,'-').replace(/^-+|-+$/g,'')||'unknown';
  const rgb=value=>{
    if(Array.isArray(value))return value.slice(0,3).map(v=>finite(v,0));
    let s=String(value||'#000000').replace('#','');
    if(s.length===3)s=s.split('').map(c=>c+c).join('');
    return [0,2,4].map(i=>(parseInt(s.slice(i,i+2),16)||0)/255);
  };

  function materialFromSprite(renderer,spriteId,mode='normal'){
    const meta=renderer?.hdArt?.regionMeta?.(spriteId)||{};
    const mv=meta.material_v2||{};
    return {
      schema:MATERIAL_SCHEMA,
      id:`material:${slug(spriteId)}:${slug(mode)}`,
      regionId:String(spriteId),
      materialClass:String(mv.material_class||meta.material||'unknown'),
      sourceMaterial:String(meta.material||'unknown'),
      atlases:{
        albedo:'assets/generated/sprite_runtime_atlas.png',
        normalRoughness:'assets/generated/sprite_material_normal_roughness.png',
        heightMaterial:'assets/generated/sprite_material_height_material.png'
      },
      rootAnchor:Array.isArray(mv.root_anchor)?mv.root_anchor.slice(0,2):[.5,1],
      heightScale:finite(mv.height_scale,1),
      heightBias:finite(mv.height_bias,0),
      overrides:{mode:String(mode)}
    };
  }

  function normalizeSprite(opts){
    const transform=opts.transform||{},style=opts.style||{};
    return {
      schema:SPRITE_SCHEMA,
      id:String(opts.id),
      stableIdBasis:String(opts.stableIdBasis||'scope-ordinal'),
      category:CATEGORIES.includes(opts.category)?opts.category:'dynamic',
      primitive:String(opts.primitive||'quad'),
      atlas:String(opts.atlas||'legacy'),
      spriteId:String(opts.spriteId||''),
      materialId:opts.materialId?String(opts.materialId):null,
      transform:{
        x:finite(transform.x,0),y:finite(transform.y,0),
        w:transform.w==null?null:finite(transform.w,0),
        h:transform.h==null?null:finite(transform.h,0),
        rotation:finite(transform.rotation,0),flip:!!transform.flip
      },
      root:clone(opts.root||{authority:'compatibility-input',anchorMode:'center',anchorNormalized:[.5,1]}),
      style:{
        color:style.color?rgb(style.color):null,
        tint:style.tint?rgb(style.tint):null,
        alpha:finite(style.alpha,1),glow:!!style.glow,
        blend:String(style.blend||((style.glow)?'additive':'alpha')),
        materialMode:String(style.materialMode||'normal'),
        tintStrength:style.tintStrength==null?null:finite(style.tintStrength,0)
      },
      subrect:opts.subrect?clone(opts.subrect):null,
      rooted:!!opts.rooted,
      sway:finite(opts.sway,0),
      coverageClass:String(opts.coverageClass||((style.glow)?'alpha-additive':'alpha-blend')),
      shadow:{cast:opts.shadow?.cast!==false,receive:opts.shadow?.receive!==false},
      materialClass:String(opts.materialClass||'unknown'),
      occluderClass:String(opts.occluderClass||'unknown')
    };
  }

  function normalizeLight(light,id,type='point',basis='group-ordinal'){
    const copy=clone(light||{})||{};
    return {
      schema:LIGHT_SCHEMA,id:String(id),stableIdBasis:basis,type:String(type),...copy,
      x:finite(copy.x,0),y:finite(copy.y,0),z:copy.z==null?null:finite(copy.z,0),
      radius:copy.radius==null?null:finite(copy.radius,0),
      intensity:copy.intensity==null?null:finite(copy.intensity,0),
      color:Array.isArray(copy.color)?rgb(copy.color):copy.color
    };
  }

  function normalizeOccluder(caster,id,basis='source-ordinal'){
    const copy=clone(caster||{})||{};
    const rect=Array.isArray(copy.rect)?copy.rect.slice(0,4).map(v=>finite(v,0)):null;
    let maxZ=0;
    for(const section of copy.sections||[])maxZ=Math.max(maxZ,finite(section?.z,0));
    return {
      schema:OCCLUDER_SCHEMA,id:String(id),stableIdBasis:basis,...copy,
      bounds:rect,
      root:{x:copy.x==null?(rect?(rect[0]+rect[2])*.5:0):finite(copy.x,0),y:copy.contactY==null?(rect?rect[3]:0):finite(copy.contactY,0)},
      zRange:[0,maxZ],materialClass:String(copy.kind||'unknown'),silhouetteClass:String(copy.kind||'unknown')
    };
  }

  function proceduralLayer(id,kind,order,descriptor,requirements=[]){
    return {
      schema:PROCEDURAL_SCHEMA,id:String(id),kind:String(kind),category:'procedural',order:String(order),
      visibilityMode:'compatibility-forward',requirements:Array.from(requirements,String),descriptor:clone(descriptor)
    };
  }

  class RenderSceneBuilder{
    constructor(context={}){
      this.context=clone(context)||{};
      this.sequence=finite(context.sequence,0);
      this.roomId=String(context.roomId||'unknown-room');
      this.scope='unscoped';
      this.scopeCounts=new Map();
      this.materials=new Map();
      this.sprites=[];
    }
    setScope(scope){this.scope=slug(scope||'unscoped');return this}
    withScope(scope,fn){const prev=this.scope;this.setScope(scope);try{return fn()}finally{this.scope=prev}}
    nextId(kind,scope=this.scope){const key=`${kind}:${slug(scope)}`,n=this.scopeCounts.get(key)||0;this.scopeCounts.set(key,n+1);return `${key}:${n}`}
    ensureMaterial(renderer,spriteId,mode){const material=materialFromSprite(renderer,spriteId,mode);if(!this.materials.has(material.id))this.materials.set(material.id,material);return material}
    captureStatic(staticSprites=[],renderer=null){
      for(let i=0;i<staticSprites.length;i++){
        const d=staticSprites[i]||{};if(!d.name)continue;
        const material=this.ensureMaterial(renderer,d.name,d.mode||'flat'),meta=renderer?.hdArt?.regionMeta?.(d.name)||{},mv=meta.material_v2||{};
        this.sprites.push(normalizeSprite({
          id:`sprite:static:${slug(this.roomId)}:${i}`,stableIdBasis:'room-static-ordinal',category:'static',primitive:'static-hd-material',atlas:'hd',spriteId:d.name,materialId:material.id,
          transform:{x:d.x,y:d.y,w:d.w,h:d.h,rotation:d.rot,flip:d.flip},
          root:{authority:'compatibility-recorded-foot',anchorMode:d.anchor||'compatibility',anchorNormalized:material.rootAnchor.slice(),x:d.footX??null,y:d.footY??null},
          style:{tint:d.tint||[1,1,1],alpha:d.alpha,glow:false,materialMode:d.mode||'flat',tintStrength:d.tintStrength},subrect:d.subrect||null,coverageClass:'alpha-cutout',
          shadow:{cast:meta.casts_shadow!==false,receive:true},materialClass:mv.material_class||meta.material||'unknown',occluderClass:meta.shadow_profile?.kind||'unknown'
        }));
      }
    }
    captureSprite(method,args,renderer){
      const a=Array.from(args||[]),id=this.nextId('sprite',this.scope),hdMeta=name=>renderer?.hdArt?.regionMeta?.(name)||{};
      const hdRecord=(name,category,primitive,transform,style,extra={})=>{
        const meta=hdMeta(name),mv=meta.material_v2||{},material=this.ensureMaterial(renderer,name,style.materialMode||'normal');
        return normalizeSprite({id,stableIdBasis:'render-scope-ordinal',category,primitive,atlas:'hd',spriteId:name,materialId:material.id,transform,
          root:extra.root||{authority:'compatibility-metadata',anchorMode:extra.anchorMode||'center',anchorNormalized:material.rootAnchor.slice()},style,subrect:extra.subrect||null,rooted:extra.rooted,sway:extra.sway,
          coverageClass:style.glow?'alpha-additive':'alpha-cutout',shadow:{cast:meta.casts_shadow!==false,receive:true},materialClass:mv.material_class||meta.material||'unknown',occluderClass:meta.shadow_profile?.kind||'unknown'});
      };
      let rec;
      if(method==='add'||method==='addGround'||method==='addTop'){
        const [name,x,y,w,h,color,alpha=1,glow=false,rot=0]=a;
        rec=normalizeSprite({id,stableIdBasis:'render-scope-ordinal',category:method==='addGround'?'ground':method==='addTop'?'top':'dynamic',primitive:'quad',atlas:'legacy',spriteId:name,transform:{x,y,w,h,rotation:rot,flip:false},style:{color,alpha,glow},shadow:{cast:false,receive:method!=='addTop'}});
      }else if(method==='addRootedGrass'){
        const [name,x,rootY,w,h,color,alpha=1,sway=0,front=false]=a;
        rec=normalizeSprite({id,stableIdBasis:'render-scope-ordinal',category:front?'foreground':'ground',primitive:'rooted-quad',atlas:'legacy',spriteId:name,transform:{x,y:rootY,w,h,rotation:0,flip:false},root:{authority:'explicit-root',anchorMode:'bottom',anchorNormalized:[.5,1],x:finite(x,0),y:finite(rootY,0)},style:{color,alpha,glow:false},rooted:true,sway,shadow:{cast:false,receive:true}});
      }else if(method==='addHDRootedGrass'){
        const [name,x,rootY,w,h,tint=[1,1,1],alpha=1,sway=0,front=false,flip=false]=a;
        rec=hdRecord(name,front?'foreground':'ground','rooted-hd-quad',{x,y:rootY,w,h,rotation:0,flip},{tint,alpha,glow:false,materialMode:'normal'},{root:{authority:'explicit-root',anchorMode:'bottom',anchorNormalized:[.5,1],x:finite(x,0),y:finite(rootY,0)},rooted:true,sway});
      }else if(method==='addHDForeground'){
        const [name,x,y,w,h=null,alpha=1,rot=0,tint=[1,1,1],flip=false]=a;rec=hdRecord(name,'foreground','hd-quad',{x,y,w,h,rotation:rot,flip},{tint,alpha,glow:false,materialMode:'normal'});
      }else if(method==='addHDSubrectForeground'){
        const [name,sx,sy,sw,sh,x,y,w,h,alpha=1,rot=0,tint=[1,1,1],flip=false]=a;rec=hdRecord(name,'foreground','hd-subrect',{x,y,w,h,rotation:rot,flip},{tint,alpha,glow:false,materialMode:'flat'},{subrect:{sx,sy,sw,sh}});
      }else if(method==='addHD'){
        const [name,x,y,w,h=null,alpha=1,glow=false,rot=0,tint=[1,1,1],flip=false]=a;rec=hdRecord(name,'dynamic','hd-quad',{x,y,w,h,rotation:rot,flip},{tint,alpha,glow,materialMode:'normal'});
      }else if(method==='addHDSubrect'){
        const [name,sx,sy,sw,sh,x,y,w,h,alpha=1,glow=false,rot=0,tint=[1,1,1],flip=false]=a;rec=hdRecord(name,'dynamic','hd-subrect',{x,y,w,h,rotation:rot,flip},{tint,alpha,glow,materialMode:'normal'},{subrect:{sx,sy,sw,sh}});
      }else if(method==='addHDTint'){
        const [name,x,y,w,h=null,alpha=1,glow=false,rot=0,tint=[1,1,1]]=a;rec=hdRecord(name,'dynamic','hd-quad',{x,y,w,h,rotation:rot,flip:false},{tint,alpha,glow,materialMode:'tint',tintStrength:1});
      }else throw new Error(`unsupported render submission method: ${method}`);
      this.sprites.push(rec);return rec;
    }
    finalize(frame={}){
      const lights=[],groupCounts=new Map();
      for(const raw of frame.lights||[]){const group=slug(raw?.group||'point'),n=groupCounts.get(group)||0;groupCounts.set(group,n+1);lights.push(normalizeLight(raw,`light:${group}:${n}`,String(raw?.group||'point'),'group-ordinal'))}
      let playerCone=null;if(frame.playerCone){playerCone=normalizeLight(frame.playerCone,'light:player-cone:0','cone','semantic-singleton');lights.push(playerCone)}
      const occluders=[],sourceCounts=new Map();
      for(const raw of frame.occluders||[]){const source=slug(raw?.source||raw?.kind||'occluder'),n=sourceCounts.get(source)||0;sourceCounts.set(source,n+1);occluders.push(normalizeOccluder(raw,`occluder:${source}:${n}`))}
      const proceduralLayers=[
        proceduralLayer('procedural:water','water','before-world',frame.water,['canonical-light','resolved-scene']),
        proceduralLayer('procedural:grass','grass','before-world',frame.grass,['canonical-light','resolved-scene']),
        proceduralLayer('procedural:foliage','foliage','split-background-foreground',frame.foliage,['canonical-light','resolved-scene','root-depth']),
        proceduralLayer('procedural:effects','effects','post-world',frame.effects||[],['canonical-light'])
      ].filter(layer=>layer.descriptor!=null);
      const categoryCounts=Object.fromEntries(CATEGORIES.map(c=>[c,0]));for(const s of this.sprites)categoryCounts[s.category]=(categoryCounts[s.category]||0)+1;
      const scene={schema:SCHEMA,frame:{sequence:this.sequence,roomId:this.roomId,logicalSize:Array.isArray(frame.logicalSize)?frame.logicalSize.slice(0,2):[640,360],timeMs:frame.timeMs==null?null:finite(frame.timeMs,0)},
        sprites:this.sprites.map(clone),materials:[...this.materials.values()].map(clone),lights,occluders,proceduralLayers,settings:clone(frame.settings||{}),post:{grade:Array.isArray(frame.grade)?frame.grade.slice(0,3):[1,1,1]},
        overlays:{guide:clone(frame.guide||null),objectiveMarker:clone(frame.objectiveMarker||null)},playerCone,
        stats:{spriteCategories:categoryCounts,spriteCount:this.sprites.length,materialCount:this.materials.size,lightCount:lights.length,occluderCount:occluders.length,proceduralLayerCount:proceduralLayers.length}};
      validateRenderScene(scene);return scene;
    }
  }

  function validateRenderScene(scene){
    if(!scene||scene.schema!==SCHEMA)throw new Error(`render scene schema must be ${SCHEMA}`);
    const seen=new Set(),checkId=(r,label)=>{if(!r?.id)throw new Error(`${label} missing stable id`);if(seen.has(r.id))throw new Error(`duplicate render scene id: ${r.id}`);seen.add(r.id)};
    const materials=new Set();for(const m of scene.materials||[]){if(m.schema!==MATERIAL_SCHEMA)throw new Error('invalid MaterialInstance schema');checkId(m,'material');materials.add(m.id)}
    for(const s of scene.sprites||[]){if(s.schema!==SPRITE_SCHEMA)throw new Error('invalid SpriteInstance schema');checkId(s,'sprite');if(!CATEGORIES.includes(s.category))throw new Error(`invalid sprite category: ${s.category}`);if(s.materialId&&!materials.has(s.materialId))throw new Error(`sprite ${s.id} references unknown material ${s.materialId}`)}
    for(const l of scene.lights||[]){if(l.schema!==LIGHT_SCHEMA)throw new Error('invalid LightInstance schema');checkId(l,'light')}
    for(const o of scene.occluders||[]){if(o.schema!==OCCLUDER_SCHEMA)throw new Error('invalid OccluderInstance schema');checkId(o,'occluder')}
    for(const p of scene.proceduralLayers||[]){if(p.schema!==PROCEDURAL_SCHEMA)throw new Error('invalid ProceduralLayer schema');checkId(p,'procedural layer')}
    return true;
  }

  return {SCHEMA,SPRITE_SCHEMA,MATERIAL_SCHEMA,LIGHT_SCHEMA,OCCLUDER_SCHEMA,PROCEDURAL_SCHEMA,CATEGORIES,RenderSceneBuilder,validateRenderScene,normalizeSprite,normalizeLight,normalizeOccluder,proceduralLayer};
});
