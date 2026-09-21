'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUQuality=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SCHEMA='steelmoth-webgpu-quality/v1';
  const STORAGE_KEY='steelmoth-webgpu-quality-preset-v1';
  const NAMES=Object.freeze(['Low','Medium','High','Ultra']);
  const clone=value=>JSON.parse(JSON.stringify(value));

  // Core representation is deliberately invariant across quality levels. The
  // only scalable work in SM-501 is secondary visibility/effect work.
  const CORE=Object.freeze({
    renderScale:1,
    gbufferScale:1,
    ownershipDepthScale:1,
    objectIdScale:1,
    albedoSampling:'nearest',
    invariant:true
  });

  const PRESETS=Object.freeze({
    Low:Object.freeze({
      localShadows:Object.freeze({selfShadowQuality:1,selfShadowSamples:8,selfShadowLightCount:1,selfShadowMaxDistance:112,contactShadowQuality:1,contactShadowSamples:4,contactShadowDistance:16}),
      dso:Object.freeze({hardCore:'full',hierarchyQuality:'Low',maxJobs:512,maxMembers:512,maxPerTile:32,maxTileRefs:16384}),
      darkBloom:Object.freeze({enabled:true,quality:'Low'}),
      reserved:Object.freeze({gtao:Object.freeze({implemented:true,enabled:false,quality:'off',owner:'SM-601',acceptanceScope:'excluded-from-sm501-initial-release'}),ssgi:Object.freeze({implemented:false,enabled:false,quality:'off'}),volumetrics:Object.freeze({implemented:false,enabled:false,quality:'off'})})
    }),
    Medium:Object.freeze({
      localShadows:Object.freeze({selfShadowQuality:2,selfShadowSamples:12,selfShadowLightCount:2,selfShadowMaxDistance:144,contactShadowQuality:2,contactShadowSamples:8,contactShadowDistance:20}),
      dso:Object.freeze({hardCore:'full',hierarchyQuality:'Medium',maxJobs:512,maxMembers:512,maxPerTile:32,maxTileRefs:16384}),
      darkBloom:Object.freeze({enabled:true,quality:'Medium'}),
      reserved:Object.freeze({gtao:Object.freeze({implemented:true,enabled:false,quality:'off',owner:'SM-601',acceptanceScope:'excluded-from-sm501-initial-release'}),ssgi:Object.freeze({implemented:false,enabled:false,quality:'optional-low'}),volumetrics:Object.freeze({implemented:false,enabled:false,quality:'low'})})
    }),
    High:Object.freeze({
      localShadows:Object.freeze({selfShadowQuality:3,selfShadowSamples:16,selfShadowLightCount:3,selfShadowMaxDistance:176,contactShadowQuality:3,contactShadowSamples:12,contactShadowDistance:28}),
      dso:Object.freeze({hardCore:'full',hierarchyQuality:'High',maxJobs:512,maxMembers:512,maxPerTile:32,maxTileRefs:16384}),
      darkBloom:Object.freeze({enabled:true,quality:'High'}),
      reserved:Object.freeze({gtao:Object.freeze({implemented:true,enabled:false,quality:'off',owner:'SM-601',acceptanceScope:'excluded-from-sm501-initial-release'}),ssgi:Object.freeze({implemented:false,enabled:false,quality:'medium'}),volumetrics:Object.freeze({implemented:false,enabled:false,quality:'medium'})})
    }),
    Ultra:Object.freeze({
      localShadows:Object.freeze({selfShadowQuality:4,selfShadowSamples:28,selfShadowLightCount:4,selfShadowMaxDistance:176,contactShadowQuality:3,contactShadowSamples:12,contactShadowDistance:36}),
      dso:Object.freeze({hardCore:'full',hierarchyQuality:'Ultra',maxJobs:512,maxMembers:512,maxPerTile:32,maxTileRefs:16384}),
      darkBloom:Object.freeze({enabled:true,quality:'Ultra'}),
      reserved:Object.freeze({gtao:Object.freeze({implemented:true,enabled:false,quality:'off',owner:'SM-601',acceptanceScope:'excluded-from-sm501-initial-release'}),ssgi:Object.freeze({implemented:false,enabled:false,quality:'high'}),volumetrics:Object.freeze({implemented:false,enabled:false,quality:'high'})})
    })
  });

  function normalizeName(value){
    const text=String(value??'Medium').trim().toLowerCase();
    return NAMES.find(name=>name.toLowerCase()===text)||'Medium';
  }

  function resolvePreset(value='Medium'){
    const name=normalizeName(value),preset=PRESETS[name];
    return {schema:SCHEMA,name,core:clone(CORE),...clone(preset)};
  }

  function localShadowSettings(value='Medium',base={}){
    const p=resolvePreset(value).localShadows;
    return {...base,selfShadowing:true,selfShadowQuality:p.selfShadowQuality,selfShadowLightCount:p.selfShadowLightCount,selfShadowMaxDistance:p.selfShadowMaxDistance,contactShadows:true,contactShadowQuality:p.contactShadowQuality,contactShadowDistance:p.contactShadowDistance};
  }

  function dsoOptions(value='Medium',base={}){
    const p=resolvePreset(value).dso;
    return {...base,maxJobs:p.maxJobs,maxMembers:p.maxMembers,maxPerTile:p.maxPerTile,maxTileRefs:p.maxTileRefs};
  }

  function dsoHierarchyOptions(value='Medium',base={}){
    const p=resolvePreset(value).dso;
    return {...base,quality:p.hierarchyQuality,maxJobs:p.maxJobs,maxMembers:p.maxMembers,maxPerTile:p.maxPerTile,maxTileRefs:p.maxTileRefs};
  }

  function darkBloomOptions(value='Medium',base={}){
    const p=resolvePreset(value).darkBloom;
    return {...base,quality:p.quality,enabled:p.enabled};
  }

  function workloadMetadata(value='Medium'){
    const p=resolvePreset(value);
    return {qualityPreset:p.name,coreScale:p.core.renderScale,selfShadowSamples:p.localShadows.selfShadowSamples,contactShadowSamples:p.localShadows.contactShadowSamples,dsoHierarchyQuality:p.dso.hierarchyQuality,darkBloomQuality:p.darkBloom.quality,reservedEffects:{...p.reserved}};
  }

  function diagnostics(value='Medium'){
    const p=resolvePreset(value);
    return {schema:SCHEMA,preset:p.name,core:p.core,localShadows:p.localShadows,dso:p.dso,darkBloom:p.darkBloom,reserved:p.reserved,policy:'Quality scaling is restricted to bounded secondary work; albedo, object-ID and primary ownership depth stay native/full resolution. GTAO is implemented by SM-600/601 but remains disabled and excluded from the SM-501 initial-release benchmark; later effects remain disabled until their owning issues implement and validate them.'};
  }

  function createRuntime(options={}){
    const target=options.root||null,storage=options.storage||target?.localStorage||null,locationRef=options.location||target?.location||null;
    let source='default',preset='Medium';
    try{
      const q=new URLSearchParams(locationRef?.search||'').get('webgpuQuality');
      if(q){preset=normalizeName(q);source='query'}
      else{const stored=storage?.getItem?.(STORAGE_KEY);if(stored){preset=normalizeName(stored);source='storage'}}
    }catch(_error){}
    const runtime={
      schema:`${SCHEMA}/runtime`,source,
      get preset(){return preset},
      setPreset(value,{persist=true,source:nextSource='runtime'}={}){preset=normalizeName(value);runtime.source=nextSource;if(persist)try{storage?.setItem?.(STORAGE_KEY,preset)}catch(_error){}runtime.updateControls();return runtime.diagnostics()},
      settings(){return resolvePreset(preset)},
      workloadMetadata(){return workloadMetadata(preset)},
      diagnostics(){return {...diagnostics(preset),selectionSource:runtime.source}},
      installControls(){
        const doc=target?.document;if(!doc)return false;const grid=doc.querySelector?.('#graphicsMenu .settingsGrid');if(!grid)return false;
        let section=doc.querySelector?.('#webgpuQualitySettings');
        if(!section){section=doc.createElement('section');section.id='webgpuQualitySettings';section.innerHTML='<h3>WEBGPU QUALITY</h3><label>Static preset <select id="webgpuQualitySelect"></select></label><div class="settingsNote" id="webgpuQualityStatus"></div>';const backend=doc.querySelector?.('#backendSettings');if(backend?.parentNode===grid&&backend.nextSibling)grid.insertBefore(section,backend.nextSibling);else grid.insertBefore(section,grid.firstChild);const select=section.querySelector('#webgpuQualitySelect');for(const name of NAMES)select.add(new Option(name,name));select.addEventListener('change',()=>runtime.setPreset(select.value,{persist:true,source:'ui'}));}
        runtime.updateControls();return true;
      },
      updateControls(){const doc=target?.document;if(!doc)return;const select=doc.querySelector?.('#webgpuQualitySelect'),status=doc.querySelector?.('#webgpuQualityStatus');if(select&&select.value!==preset)select.value=preset;if(status){const p=resolvePreset(preset);status.textContent=`${preset}: self ${p.localShadows.selfShadowSamples} taps · contact ${p.localShadows.contactShadowSamples} · DSO ${p.dso.hierarchyQuality} · Dark Bloom ${p.darkBloom.quality}. Core albedo/object/depth stay native.`}},
    };
    return runtime;
  }

  function installRuntimeIntegration(target=typeof globalThis!=='undefined'?globalThis:null,options={}){
    if(!target)return null;if(target.steelMothWebGPUQualityRuntime?.schema===`${SCHEMA}/runtime`)return target.steelMothWebGPUQualityRuntime;
    const runtime=createRuntime({...options,root:target});target.steelMothWebGPUQualityRuntime=runtime;
    const attach=()=>{runtime.installControls();if(target.game?.graphics)target.game.graphics.webgpuQualityPreset=runtime.preset};attach();
    if(typeof target.setInterval==='function'){let n=0;const timer=target.setInterval(()=>{attach();if(target.document?.querySelector?.('#webgpuQualitySettings')||++n>600)target.clearInterval?.(timer)},16)}
    return runtime;
  }

  return {SCHEMA,STORAGE_KEY,NAMES,CORE,PRESETS,normalizeName,resolvePreset,localShadowSettings,dsoOptions,dsoHierarchyOptions,darkBloomOptions,workloadMetadata,diagnostics,createRuntime,installRuntimeIntegration};
});
