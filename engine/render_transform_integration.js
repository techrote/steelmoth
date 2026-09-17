'use strict';

// Compatibility interposition for the imported v1.2.3 runtime. The baseline
// game/renderer source remains byte-identical while active root/foot/editor/
// shadow queries are redirected to the shared SM-101 transform authority.
(function(root){
  const T=root?.SteelMothRenderTransform;
  if(!T)throw new Error('SteelMothRenderTransform must load before render_transform_integration.js');

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

  if(typeof baseline.setupWysiwygEditor==='function')root.setupWysiwygEditor=function(game){return patchEditor(baseline.setupWysiwygEditor.call(this,game))};
  if(root.rmfEditor)patchEditor(root.rmfEditor);

  function patchExistingGame(game){
    if(!game||game.__sm101SharedTransform)return game;
    game.__sm101SharedTransform=true;game.renderTransform=T;
    // If async module loading lost the race with Game construction, rebuild the
    // static descriptor cache once. The shared resolver intentionally reproduces
    // the old coordinates, so this changes authority rather than placement.
    try{if(game.renderer&&typeof game.ensureBackground==='function'){game.bgKey='';game.ensureBackground(true)}}catch(error){console.warn('SM-101 static-root cache refresh failed; direct rendering remains available.',error)}
    patchEditor(root.rmfEditor);
    return game;
  }
  if(root.game)patchExistingGame(root.game);

  root.SteelMothRenderTransformIntegration={schema:'steelmoth-render-transform-integration/v1',authority:T.SCHEMA,baseline,patchEditor,patchExistingGame};
})(typeof globalThis!=='undefined'?globalThis:window);
