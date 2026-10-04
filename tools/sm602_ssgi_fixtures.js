'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SteelMothSM602Fixtures=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const META=Object.freeze({roomId:'sm602-bounce-room',deviceGeneration:1,backendGeneration:1,cameraRevision:1,lightRevision:1});
  function createFixture(width=67,height=51,kind='bounce',donorOffset=0){
    const n=width*height,depth=new Float32Array(n*2),object=new Uint32Array(n),normal=new Float32Array(n*4),albedo=new Float32Array(n*4),material=new Float32Array(n*4),colour=new Float32Array(n*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,o=i*4;
      const donor=kind==='dense'?((Math.floor(x/16)+Math.floor(y/16))%3===0):(x>=Math.floor(width/2)+donorOffset&&x<Math.floor(width/2)+donorOffset+16);
      const occupied=kind!=='empty',z=donor?32:0;
      // Canonical static/dynamic layer zero: depth=(3072-(rasterY+worldZ))/5120.
      // Numeric G2.R is local height; it is never used as the ownership depth.
      const d=(3072-y-z)/5120;depth[i*2]=occupied?d:1;depth[i*2+1]=occupied?d:0;
      object[i]=occupied?(donor?8:7):0;
      normal.set([.5,.5,1,.6],o);albedo.set(donor?[.65,.35,.2,1]:[.32,.34,.36,1],o);
      material.set([z/64,0,1,0],o);colour.set(donor?[3,.4,.1,1]:[.09,.11,.12,1],o);
    }
    return{width,height,depth,object,normal,albedo,material,colour,metadata:{kind,extent:{width,height},source:'deterministic synthetic canonical layer-zero ownership/material/linear-HDR attachments',light:'fixed warm machinery source; colour stored as direct-only pre-SSGI linear HDR',camera:'stationary',pseudoDepth:'(3072 - rasterY - worldZ) / 5120',donorWorldZ:32,receiverWorldZ:0,layer:0}};
  }
  function coarseBoundaryFixture(){
    const f=createFixture(17,17,'empty');
    const put=(x,y,id,z,rgb)=>{const i=y*f.width+x;f.object[i]=id;const d=(3072-y-z)/5120;f.depth[i*2]=f.depth[i*2+1]=d;f.material[i*4]=z/64;f.colour.set([...rgb,1],i*4);};
    put(10,10,7,0,[.09,.11,.12]);put(11,11,8,4,[3,.4,.1]);
    f.metadata={...f.metadata,kind:'thin-donor-coarse-boundary',receiver:[10,10],donor:[11,11],firstStepEndpoint:[13,13],coarseCoverage:4,boundary:'An early fine donor is in a different coarse cell from the empty step endpoint.'};
    return f;
  }
  function materialBoundaryFixture(){
    const f=createFixture(),y=22,x=28;
    f.albedo.set([0,0,0,1],(y*f.width+x)*4);
    f.albedo.set([.8,0,0,1],(y*f.width+x+1)*4);
    f.material[(y*f.width+x+2)*4+1]=1;
    f.albedo.set([.5,.5,.5,1],(y*f.width+x+3)*4);
    f.metadata={...f.metadata,kind:'native-material-subregions',testPixels:[[x,y],[x+1,y],[x+2,y],[x+3,y]],boundary:'One quarter cell, one receiver object, matching normal/depth, native black/red/metal/grey texels.'};
    return f;
  }
  function movingRadianceFixture(frame=0){
    const f=createFixture(),centerX=34+frame*1.5,amplitude=.2+frame*.09;
    for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
      const i=y*f.width+x;if(f.object[i]!==8)continue;
      const lit=amplitude*Math.exp(-(((x-centerX)/7)**2));
      f.colour.set([.2+2.8*lit,.04+.35*lit,.01+.09*lit,1],i*4);
    }
    f.metadata={...f.metadata,kind:'translated-ramped-direct-radiance',frame,lightCenterX:centerX,amplitude,geometryUnchanged:true,metadataRevisionsUnchanged:true,boundary:'Synthetic direct-only donor radiance moves smoothly and ramps while canonical geometry and revision metadata remain fixed; this is not a canonical direct-light pass or SM-603 campaign.'};
    return f;
  }
  function translatedDonorFixture(offset=0){
    const f=createFixture(67,51,'bounce',offset);
    f.metadata={...f.metadata,kind:'translated-donor-coverage',offset,donorStartX:Math.floor(f.width/2)+offset,donorWidth:16,metadataRevisionsUnchanged:true,boundary:'The same donor object moves in 4-pixel steps; vacated pixels become floor with canonical floor depth/material and current direct colour.'};
    return f;
  }
  const copy=f=>({...f,depth:f.depth.slice(),object:f.object.slice(),normal:f.normal.slice(),albedo:f.albedo.slice(),material:f.material.slice(),colour:f.colour.slice()});
  function input(current,previous=current,options={}){return{width:current.width,height:current.height,currentDepth:current.depth,currentObject:current.object,currentNormal:current.normal,currentAlbedo:current.albedo,currentMaterial:current.material,currentColour:current.colour,previousDepth:previous.depth,previousObject:previous.object,previousNormal:previous.normal,previousColour:previous.colour,previousIndirect:options.previousIndirect,previousDonorCoordinates:options.previousDonorCoordinates,historyValid:options.historyValid??true,currentMeta:options.currentMeta||{...META},previousMeta:options.previousMeta||{...META}};}
  const rgbMax=data=>{let v=0;for(let i=0;i<data.length;i++)if(i%4!==3)v=Math.max(v,data[i]);return v;};
  const rgbEnergy=data=>{let sum=0;for(let i=0;i<data.length;i++)if(i%4!==3)sum+=data[i];return sum;};
  const finiteRGB=data=>Array.from(data).every(Number.isFinite)&&Array.from(data).every(v=>v>=0);
  return{META,createFixture,coarseBoundaryFixture,materialBoundaryFixture,movingRadianceFixture,translatedDonorFixture,copy,input,rgbMax,rgbEnergy,finiteRGB};
});
