'use strict';
// Diagnostic oracle only. Production rendering and exact candidate A/B are unchanged.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SteelMothGTAONeutralProbe=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SCHEMA='steelmoth-sm601-canonical-neutral-probe/v1';
  const ORDINARY_PLANE_ABSOLUTE_BOUND=2e-6;
  function evaluate({pattern,enabled,raw,visibility,depth}){
    const required=enabled===false||pattern==='plane'||pattern==='empty';
    const kind=enabled===false||pattern==='empty'?'literal-neutral':pattern==='plane'?'occupied-plane-reconstruction':'not-neutral-control';
    if(!required)return{schema:SCHEMA,required:false,ok:true,kind};
    const failures=[];let maxAbsoluteError=0,occupiedPixels=0,literalPixels=0;
    if(!raw||raw.length===0||raw.length%4!==0||!visibility||visibility.length===0||!depth||depth.length!==visibility.length*2)return{schema:SCHEMA,required:true,ok:false,kind,failures:[{reason:'invalid-control-extents'}]};
    for(let i=0;i<raw.length;i+=4)if(raw[i]!==1)failures.push({reason:'raw-visibility-must-be-exact-one',rawIndex:i/4,value:raw[i]});
    for(let i=0;i<visibility.length;i++){
      if(!Number.isFinite(depth[i*2])||!Number.isFinite(depth[i*2+1])){failures.push({reason:'nonfinite-control-depth',index:i});continue;}
      const value=visibility[i],occupied=depth[i*2]<=depth[i*2+1],ordinary=enabled===true&&pattern==='plane'&&occupied,error=Math.abs(value-1);
      maxAbsoluteError=Math.max(maxAbsoluteError,error);
      if(ordinary){occupiedPixels++;if(!Number.isFinite(value)||value>1||error>ORDINARY_PLANE_ABSOLUTE_BOUND)failures.push({reason:'occupied-plane-reconstruction-outside-existing-bound',index:i,value,error})}
      else{literalPixels++;if(value!==1)failures.push({reason:'literal-neutral-must-be-exact-one',index:i,value})}
    }
    return{schema:SCHEMA,required:true,ok:failures.length===0,kind,absoluteBound:kind==='occupied-plane-reconstruction'?ORDINARY_PLANE_ABSOLUTE_BOUND:0,maxAbsoluteError,occupiedPixels,literalPixels,failures};
  }
  return{SCHEMA,ORDINARY_PLANE_ABSOLUTE_BOUND,evaluate};
});
