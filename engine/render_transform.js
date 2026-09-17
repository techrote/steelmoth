'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothRenderTransform=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SCHEMA='steelmoth-render-transform/v1';
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function rootMetadata(art,name){
    const meta=art?.regionMeta?.(name)||{},mv=meta.material_v2||{},raw=Array.isArray(mv.root_anchor)?mv.root_anchor:[.5,1];
    return {x:finite(raw[0],.5),y:finite(raw[1],1),source:Array.isArray(mv.root_anchor)?'material-v2-metadata':'default-bottom-centre'};
  }

  function sourceRegion(art,name){
    const r=art?.regions?.[name];
    return Array.isArray(r)&&r.length>=4?{x:finite(r[0]),y:finite(r[1]),w:Math.max(1,finite(r[2],1)),h:Math.max(1,finite(r[3],1))}:null;
  }

  function frameBounds({x=0,y=0,w=0,h=0,anchor='center'}={}){
    x=finite(x);y=finite(y);w=finite(w);h=finite(h);
    const top=anchor==='bottom'?y-h:anchor==='top'?y:y-h*.5;
    return {left:x-w*.5,top,right:x+w*.5,bottom:top+h,width:w,height:h,centerX:x,centerY:top+h*.5,anchorMode:String(anchor||'center')};
  }

  // Root/foot semantics deliberately preserve the accepted v1.2.3 placement contract.
  // Rotation and horizontal flip change texel orientation, not the ground-contact root.
  // The historical material-subrect path treated x/y as the subrect centre even when
  // the source draw was bottom anchored; retaining that behavior is required for parity.
  function resolve(art,name,opts={}){
    const x=finite(opts.x),y=finite(opts.y),w=finite(opts.w),h=finite(opts.h),anchor=String(opts.anchor||'center'),rotation=finite(opts.rotation),flip=!!opts.flip,metaRoot=rootMetadata(art,name),region=sourceRegion(art,name),subrect=opts.subrect||null;
    let rootX,rootY,fullW=w,fullH=h,bounds=frameBounds({x,y,w,h,anchor});
    if(subrect&&region){
      // Match imported getSpriteFootAnchor exactly: falsy sw/sh fall back to the
      // full source region before the >=1 clamp.
      const sx=finite(subrect.sx||0),sy=finite(subrect.sy||0),sw=Math.max(1,finite(subrect.sw||region.w,region.w)),sh=Math.max(1,finite(subrect.sh||region.h,region.h)),scaleX=w/sw,scaleY=h/sh;
      fullW=region.w*scaleX;fullH=region.h*scaleY;
      const left=x-w*.5-sx*scaleX,top=y-h*.5-sy*scaleY;
      rootX=left+metaRoot.x*fullW;rootY=top+metaRoot.y*fullH;
    }else{
      rootX=x+(metaRoot.x-.5)*w;rootY=bounds.top+metaRoot.y*h;
    }
    if(opts.explicitRoot&&Number.isFinite(Number(opts.explicitRoot.x))&&Number.isFinite(Number(opts.explicitRoot.y))){rootX=Number(opts.explicitRoot.x);rootY=Number(opts.explicitRoot.y)}
    return {
      schema:SCHEMA,name:String(name||''),input:{x,y,w,h,anchor,rotation,flip,subrect:subrect?{...subrect}:null},
      root:{x:rootX,y:rootY,normalized:[metaRoot.x,metaRoot.y],metadataSource:metaRoot.source,authority:opts.explicitRoot?'explicit-shared-root':'shared-render-transform/v1'},
      frame:{...bounds,fullW,fullH},rotation,flip
    };
  }

  function legacyFootAnchor(art,name,x,y,w,h,anchor='center',subrect=null){
    const q=resolve(art,name,{x,y,w,h,anchor,subrect});
    return{x:q.root.x,y:q.root.y,rootX:q.root.normalized[0],rootY:q.root.normalized[1],fullW:q.frame.fullW,fullH:q.frame.fullH};
  }

  function shadowFootRect(meta,contactX,contactY,w,h,fw=null,fh=null){
    contactX=finite(contactX);contactY=finite(contactY);w=finite(w);h=finite(h);
    const foot=meta?.shadow_profile?.footprint;
    if(foot)return[contactX+w*finite(foot.left,-.25),contactY+h*finite(foot.top,-.16),contactX+w*finite(foot.right,.25),contactY+h*finite(foot.bottom,0)];
    const footW=Math.max(3,finite(fw,0)||w*finite(meta?.shadow_foot_width_factor??meta?.collision_width_factor,.52)),footH=Math.max(2.5,finite(fh,0)||h*finite(meta?.shadow_foot_height_factor??meta?.collision_height_factor,.14));
    return[contactX-footW*.5,contactY-footH,contactX+footW*.5,contactY];
  }

  function shadowSections(meta,contactX,contactY,w,h){
    const out=[],profile=meta?.shadow_profile||{},foot=profile.footprint||{},groundY=finite(contactY)+finite(h)*((finite(foot.top,-.16)+finite(foot.bottom,0))*.5),heightWorld=Math.max(2,finite(h)*clamp(finite(profile.height_ratio,.72),.04,1.2));
    const pushSpan=(span,alt)=>{const left=finite(contactX)+finite(w)*finite(span.left,-.2),right=finite(contactX)+finite(w)*finite(span.right,.2);if(right-left<1.25)return;out.push({a:[left,groundY],b:[right,groundY],alpha:clamp(finite(span.alpha,1),.15,1.25),extend:clamp(finite(span.extend,1),.5,2),altitude:alt,z:heightWorld*alt})};
    if(Array.isArray(profile.slices)&&profile.slices.length){for(const slice of profile.slices){const alt=clamp(finite(slice.altitude,0),0,1);for(const span of slice.spans||[])pushSpan(span,alt)}}
    else if(Array.isArray(profile.segments)&&profile.segments.length){for(const seg of profile.segments)pushSpan(seg,clamp(finite(seg.altitude,0),0,1))}
    if(out.length)return out;
    const r=shadowFootRect(meta,contactX,contactY,w,h),cy=(r[1]+r[3])*.5;
    return[{a:[r[0],cy],b:[r[2],cy],alpha:1,extend:1,altitude:0,z:0}];
  }

  // Shadow silhouettes historically used a visual-bottom/contact point that was
  // sometimes offset from Material-v2 root metadata (notably robot footprints).
  // Preserve that visual contact as an explicit offset while making the sprite
  // root itself canonical. Later shadow/depth work can therefore consume one root
  // authority without silently shifting accepted v1.2.3 shadows.
  function shadowPlacement(art,name,opts={}){
    const q=resolve(art,name,opts),meta=art?.regionMeta?.(name)||{},w=finite(opts.w),h=finite(opts.h),cx=Number.isFinite(Number(opts.contactX))?Number(opts.contactX):q.root.x,cy=Number.isFinite(Number(opts.contactY))?Number(opts.contactY):q.root.y;
    return {
      transform:q,
      root:{...q.root},
      contact:{x:cx,y:cy},
      contactOffset:{x:cx-q.root.x,y:cy-q.root.y},
      rect:shadowFootRect(meta,cx,cy,w,h,opts.footW,opts.footH),
      sections:shadowSections(meta,cx,cy,w,h)
    };
  }

  function editorBounds(art,name,x,y,bottomAnchor=false,scale=1){
    let w=16,h=16;
    try{const wh=art?.worldSize?.(name);if(Array.isArray(wh)){w=finite(wh[0],16);h=finite(wh[1],16)}}catch(_e){}
    scale=Math.max(.01,finite(scale,1));w*=scale;h*=scale;
    const b=frameBounds({x,y,w,h,anchor:bottomAnchor?'bottom':'center'});
    return{x0:b.left,y0:b.top,x1:b.right,y1:b.bottom,w,h,root:resolve(art,name,{x,y,w,h,anchor:bottomAnchor?'bottom':'center'}).root};
  }

  return{SCHEMA,rootMetadata,sourceRegion,frameBounds,resolve,legacyFootAnchor,shadowFootRect,shadowSections,shadowPlacement,editorBounds};
});
