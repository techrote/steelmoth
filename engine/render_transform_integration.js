'use strict';

// Compatibility interposition for the imported v1.2.3 runtime. The baseline
// game/renderer source remains byte-identical while active root/foot/editor/
// shadow queries are redirected to the shared SM-101 transform authority.
(function(root){
  const T=root?.SteelMothRenderTransform;
  if(!T)throw new Error('SteelMothRenderTransform must load before render_transform_integration.js');
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const TILE=16; // accepted v1.2.3 logical tile size

  const baseline={
    getSpriteFootAnchor:root.getSpriteFootAnchor,
    spriteShadowFootRect:root.spriteShadowFootRect,
    spriteShadowSections:root.spriteShadowSections,
    setupWysiwygEditor:root.setupWysiwygEditor
  };

  root.getSpriteFootAnchor=function(art,name,x,y,w,h,anchor='center',subrect=null){return T.legacyFootAnchor(art,name,x,y,w,h,anchor,subrect)};
  root.spriteShadowFootRect=function(meta,x,bottomY,w,h,fw=null,fh=null){return T.shadowFootRect(meta,x,bottomY,w,h,fw,fh)};
  root.spriteShadowSections=function(meta,x,bottomY,w,h){return T.shadowSections(meta,x,bottomY,w,h)};

  function patchEditor(editor){
    if(!editor||editor.__sm101SharedTransform)return editor;
    editor.__sm101SharedTransform=true;
    editor.spriteBBox=function(sprite,x,y,bottomAnchor=false,scale=1){return T.editorBounds(this.game.art,sprite,x,y,bottomAnchor,scale)};
    editor.drawSpriteGhost=function(ctx,e,x,y,alpha=.56){
      if(!e?.sprite||!this.game.art.regions[e.sprite])return;
      const r=this.game.art.region(e.sprite),sz=this.game.art.worldSize(e.sprite),scale=e.kind==='robot'?.84:e.kind==='lamp'?.66:1,w=sz[0]*scale,h=sz[1]*scale,b=T.frameBounds({x,y,w,h,anchor:'bottom'});
      ctx.save();ctx.globalAlpha=alpha;ctx.imageSmoothingEnabled=true;ctx.drawImage(this.game.art.img,r[0],r[1],r[2],r[3],b.left,b.top,w,h);ctx.restore();
    };
    return editor;
  }

  function rootInfoFromTransform(q,contactX,contactY){
    return {root:q.root,contact:{x:contactX,y:contactY},contactOffset:{x:contactX-q.root.x,y:contactY-q.root.y}};
  }

  function patchCasterCollection(game){
    if(!game||game.__sm101SharedCasterCollection||typeof game.collectCasters!=='function')return game;
    game.__sm101SharedCasterCollection=true;
    game.__sm101BaselineCollectCasters=game.collectCasters.bind(game);
    game.collectCasters=function(){
      const a=[],max=192;
      const addCaster=(rect,kind='terrain',strength=1,source='terrain',sections=null,placement=null)=>{
        if(!rect||a.length>=max)return;let [l,t,r,b]=rect;if(!(r>l&&b>t))return;
        const defaultRoot={x:(l+r)*.5,y:b,authority:'explicit-occluder-contact',normalized:[.5,1],metadataSource:'occluder-rect'},ri=placement?.root||defaultRoot,contact=placement?.contact||{x:(l+r)*.5,y:b},offset=placement?.contactOffset||{x:contact.x-ri.x,y:contact.y-ri.y};
        a.push({rect:[l,t,r,b],x:(l+r)*.5,y:(t+b)*.5,contactY:b,kind,strength:clamp(Number(strength)||1,0,2),source,sections:Array.isArray(sections)&&sections.length?sections:null,rootX:ri.x,rootY:ri.y,rootAuthority:ri.authority||'shared-render-transform/v1',shadowContactX:contact.x,shadowContactY:contact.y,shadowContactOffsetX:offset.x,shadowContactOffsetY:offset.y});
      };
      const addSpriteCaster=(name,opts,kind='terrain',strength=1,source='sprite')=>{
        if(a.length>=max||!name||!this.art.regions[name])return;
        const p=T.shadowPlacement(this.art,name,opts);addCaster(p.rect,kind,strength,source,p.sections,p);
      };
      addCaster([this.x-3.6,this.y+4,this.x+3.6,this.y+10],'player',.72,'player');
      for(const key of this.room.walls){if(a.length>=max)break;const [tx,ty]=key.split(',').map(Number),rect=this.room.collisionRect(tx,ty),style=this.room.blockerStyles[key]||{},name=style.sprite;if(name&&this.art.regions[name]){const [w,h]=this.art.worldSize(name),x=tx*TILE+TILE/2,b=ty*TILE+TILE+2;addSpriteCaster(name,{x,y:b,w,h,anchor:'bottom',contactX:x,contactY:b},'terrain',1,`wall:${key}:${name}`)}else if(rect)addCaster(rect,'terrain',1,`wall:${key}`)}
      for(const c of this.room.decorColliders||[]){if(c?.name&&Number.isFinite(c.x)&&Number.isFinite(c.bottomY)&&Number.isFinite(c.w)&&Number.isFinite(c.h))addSpriteCaster(c.name,{x:c.x,y:c.bottomY,w:c.w,h:c.h,anchor:'bottom',contactX:c.x,contactY:c.bottomY},'terrain',1,`${c.source||'decor'}:${c.name||''}`);else addCaster(c.rect,'terrain',1,`${c.source||'decor'}:${c.name||''}`)}
      for(const d of this.room.editorDecor||[]){if(a.length>=max)break;const meta=this.art.regionMeta(d.sprite)||{};if(!meta.casts_shadow||meta.solid||!this.art.regions[d.sprite])continue;const [ow,oh]=this.art.worldSize(d.sprite),sc=clamp(Number(d.scale??1),.25,4),w=ow*sc,h=oh*sc,x=Number(d.x)||0,b=Number(d.y)||0;addSpriteCaster(d.sprite,{x,y:b,w,h,anchor:'bottom',contactX:x,contactY:b},'decor',.88,`editor:${d.sprite}`)}
      const addRobot=(u,scale)=>{if(a.length>=max)return;const frames=(this.art.roles.robot_variants||{})[u.variant||u.kind]||(this.art.roles.robot_variants||{}).maintenance||{},name=frames.idle||'hex_maintenance_idle_0';if(!this.art.regions[name])return;const [ow,oh]=this.art.worldSize(name),w=ow*scale,h=oh*scale,fw=Math.max(8,w*.62),fh=Math.max(5,h*.26),b=u.y+h*.42,q=T.resolve(this.art,name,{x:u.x,y:u.y,w,h,anchor:'center'}),p=rootInfoFromTransform(q,u.x,b);addCaster([u.x-fw*.5,b-fh,u.x+fw*.5,b],'robot',.92,'robot',null,p)};
      for(const u of this.followers.units||[])addRobot(u,.84);for(const u of this.creatures?.units||[])addRobot(u,1.755);
      for(const d of this.room.decorRobots||[]){if(a.length>=max||!d.id||this.state.hasRobot(d.id)||this.state.isReleased?.(d.id))continue;const [x,y]=this.room.center(d.tile);addRobot({x,y:y+10,variant:d.variant||'maintenance'},.84)}
      const objectiveRole=this.art.roles.objective||{};for(const obj of this.room.spec.objects||[]){if(a.length>=max)break;const tile=this.room.objects[obj.object_id],name=objectiveRole[obj.kind]||objectiveRole.generic;if(!tile||!name||!this.art.regions[name])continue;const [x,y]=this.room.center(tile),[ow,oh]=this.art.worldSize(name),b=y+12;addSpriteCaster(name,{x,y,w:ow,h:oh,anchor:'center',contactX:x,contactY:b},'objective',.72,`objective:${obj.object_id}`)}
      return a.slice(0,max);
    };
    return game;
  }

  if(typeof baseline.setupWysiwygEditor==='function')root.setupWysiwygEditor=function(game){return patchEditor(baseline.setupWysiwygEditor.call(this,game))};
  if(root.rmfEditor)patchEditor(root.rmfEditor);

  function patchExistingGame(game){
    if(!game)return game;
    if(!game.__sm101SharedTransform){
      game.__sm101SharedTransform=true;game.renderTransform=T;
      // If async module loading lost the race with Game construction, rebuild the
      // static descriptor cache once. The shared resolver intentionally reproduces
      // the old coordinates, so this changes authority rather than placement.
      try{if(game.renderer&&typeof game.ensureBackground==='function'){game.bgKey='';game.ensureBackground(true)}}catch(error){console.warn('SM-101 static-root cache refresh failed; direct rendering remains available.',error)}
    }
    patchCasterCollection(game);patchEditor(root.rmfEditor);return game;
  }
  if(root.game)patchExistingGame(root.game);

  root.SteelMothRenderTransformIntegration={schema:'steelmoth-render-transform-integration/v1',authority:T.SCHEMA,baseline,patchEditor,patchCasterCollection,patchExistingGame};
})(typeof globalThis!=='undefined'?globalThis:window);
