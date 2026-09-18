'use strict';

(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUTransitionState=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  const SCHEMA='steelmoth-webgpu-transition-state/v1';
  const EVENT_SCHEMA='steelmoth-webgpu-transition-event/v1';
  const STAGES=Object.freeze([
    'renderScene','instances','materials','ownershipDepth','objectId','localShadows','contact','visibility',
    'depthHierarchy','occluders','clusters','dominance','dso','dsoHierarchy','darkBloom','darkBloomTemporal',
    'water','foliage','transparentFx','ordering'
  ]);
  const ROOM_DERIVED=Object.freeze([...STAGES]);
  const SIZE_DERIVED=Object.freeze([
    'ownershipDepth','objectId','localShadows','contact','visibility','depthHierarchy','dso','dsoHierarchy',
    'darkBloom','darkBloomTemporal','water','foliage','transparentFx','ordering'
  ]);
  const BACKEND_DERIVED=Object.freeze([...STAGES]);
  const HISTORY_STAGES=Object.freeze(['dominance','darkBloomTemporal']);
  const PROFILES=Object.freeze({
    'room-change':ROOM_DERIVED,
    'room-load':ROOM_DERIVED,
    'project-reload':ROOM_DERIVED,
    'resize':SIZE_DERIVED,
    'backend-reconfigure':BACKEND_DERIVED,
    'device-rebuild':BACKEND_DERIVED
  });
  const clone=value=>{if(value==null)return value;try{return typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value))}catch(_e){return null}};
  const cleanId=value=>value==null?null:String(value);
  const roomIdOf=(game,index=null)=>{
    const room=index==null?game?.room:game?.rooms?.[index];
    return cleanId(room?.key??room?.spec?.id??room?.spec?.key??(index==null?game?.state?.room:index));
  };
  const extentOf=runtime=>{
    const cfg=runtime?.manager?.configuration||runtime?.infrastructure?.registry?.diagnostics?.()?.extent||runtime?.infrastructure?.diagnostics?.()?.resources?.extent||null;
    if(!cfg)return null;
    const width=Number(cfg.width)||0,height=Number(cfg.height)||0,dpr=Number(cfg.dpr)||1;
    return width&&height?{width,height,dpr}:null;
  };
  const targetInvalidator=(target,token,clearHistory)=>{
    if(typeof target?.invalidate==='function'){target.invalidate(token,!!clearHistory);return'invalidate'}
    if(typeof target?.clearHistory==='function'&&clearHistory){target.clearHistory(token);return'clearHistory'}
    return'dirty-only';
  };

  function clearSceneCapture(game,reason='room-change'){
    if(!game)return{bridge:false,editorRevision:0};
    const bridge=game.renderSceneBridge||game.__smRenderSceneBridge||game.renderer?.renderSceneBridge||null;
    if(bridge){bridge.transitionRevision=(Number(bridge.transitionRevision)||0)+1;bridge.lastTransitionInvalidationReason=String(reason);bridge.lastScene=null;}
    game.renderScene=null;
    if(game.renderer)game.renderer.lastRenderScene=null;
    if(root&&root.steelMothLastRenderScene)root.steelMothLastRenderScene=null;
    return{bridge:!!bridge,transitionRevision:Number(bridge?.transitionRevision)||0};
  }

  class RenderTransitionInvalidationGraph{
    constructor(options={}){
      this.schema=SCHEMA;this.revision=0;this.roomEpoch=0;this.surfaceEpoch=0;this.backendEpoch=0;this.roomId=cleanId(options.roomId);this.backend=cleanId(options.backend)||'unknown';this.extent=options.extent?{...options.extent}:null;
      this.targets=new Map();this.dirty={};this.records=new Map();this.events=[];this.maxEvents=Math.max(8,Number(options.maxEvents)||96);this.lastReason='uninitialized';this.lastEvent=null;
      for(const name of STAGES)this.dirty[name]=true;
    }
    register(name,target,options={}){
      name=String(name||'');if(!name)throw new Error('transition invalidation target requires a name');
      const history=options.history??HISTORY_STAGES.includes(name),roomSensitive=options.roomSensitive!==false,sizeSensitive=options.sizeSensitive??SIZE_DERIVED.includes(name),backendSensitive=options.backendSensitive!==false;
      this.targets.set(name,{target,history,roomSensitive,sizeSensitive,backendSensitive});if(!(name in this.dirty))this.dirty[name]=true;return target;
    }
    unregister(name){return this.targets.delete(String(name))}
    registerProductionTargets(targets={}){
      for(const name of STAGES)if(targets[name])this.register(name,targets[name]);
      return this.diagnostics();
    }
    affected(reason){
      reason=String(reason||'room-change');const profile=PROFILES[reason];if(!profile)throw new Error(`unknown transition invalidation reason: ${reason}`);return [...profile];
    }
    currentStamp(name='derived'){
      return{schema:'steelmoth-webgpu-transition-stamp/v1',name:String(name),revision:this.revision,roomEpoch:this.roomEpoch,surfaceEpoch:this.surfaceEpoch,backendEpoch:this.backendEpoch,roomId:this.roomId,backend:this.backend,extent:this.extent?{...this.extent}:null};
    }
    isCurrentStamp(stamp,options={}){
      if(!stamp)return false;
      const roomSensitive=options.roomSensitive!==false,sizeSensitive=options.sizeSensitive!==false,backendSensitive=options.backendSensitive!==false;
      return (!roomSensitive||(stamp.roomEpoch===this.roomEpoch&&stamp.roomId===this.roomId))&&(!sizeSensitive||stamp.surfaceEpoch===this.surfaceEpoch)&&(!backendSensitive||(stamp.backendEpoch===this.backendEpoch&&stamp.backend===this.backend));
    }
    recordDerived(name,value,options={}){
      name=String(name);const entry={stamp:this.currentStamp(name),value:clone(value),roomSensitive:options.roomSensitive!==false,sizeSensitive:options.sizeSensitive??SIZE_DERIVED.includes(name),backendSensitive:options.backendSensitive!==false};this.records.set(name,entry);this.dirty[name]=false;return clone(entry);
    }
    readDerived(name){
      const entry=this.records.get(String(name));if(!entry)return null;
      if(!this.isCurrentStamp(entry.stamp,entry)){this.records.delete(String(name));return null}
      return clone(entry.value);
    }
    markRebuilt(names=STAGES){for(const name of names)this.dirty[String(name)]=false;return this.diagnostics()}
    invalidate(reason='room-change',meta={}){
      reason=String(reason||'room-change');const affected=this.affected(reason);this.revision++;this.lastReason=reason;
      const roomEvent=reason==='room-change'||reason==='room-load'||reason==='project-reload',surfaceEvent=reason==='resize'||reason==='backend-reconfigure'||reason==='device-rebuild',backendEvent=reason==='backend-reconfigure'||reason==='device-rebuild';
      if(roomEvent){this.roomEpoch++;if(meta.toRoomId!=null)this.roomId=cleanId(meta.toRoomId);else if(meta.roomId!=null)this.roomId=cleanId(meta.roomId)}
      if(surfaceEvent){this.surfaceEpoch++;if(meta.extent)this.extent={width:Number(meta.extent.width)||1,height:Number(meta.extent.height)||1,dpr:Number(meta.extent.dpr)||1}}
      if(backendEvent){this.backendEpoch++;if(meta.toBackend!=null)this.backend=cleanId(meta.toBackend)}
      const token=`sm404:${reason}:${this.revision}`,invoked=[];
      for(const name of affected){
        this.dirty[name]=true;this.records.delete(name);
        const entry=this.targets.get(name);if(!entry)continue;
        const mode=targetInvalidator(entry.target,token,entry.history);invoked.push({name,mode,clearHistory:!!entry.history});
      }
      const event={schema:EVENT_SCHEMA,revision:this.revision,reason,token,fromRoomId:cleanId(meta.fromRoomId),toRoomId:this.roomId,fromBackend:cleanId(meta.fromBackend),toBackend:this.backend,extent:this.extent?{...this.extent}:null,epochs:{room:this.roomEpoch,surface:this.surfaceEpoch,backend:this.backendEpoch},affected:[...affected],invoked,meta:clone(meta.extra||null)};
      this.events.push(event);if(this.events.length>this.maxEvents)this.events.splice(0,this.events.length-this.maxEvents);this.lastEvent=event;return clone(event);
    }
    diagnostics(){
      return{schema:SCHEMA,revision:this.revision,lastReason:this.lastReason,roomId:this.roomId,backend:this.backend,extent:this.extent?{...this.extent}:null,epochs:{room:this.roomEpoch,surface:this.surfaceEpoch,backend:this.backendEpoch},registered:[...this.targets.keys()].sort(),dirty:{...this.dirty},liveRecords:[...this.records.keys()].sort(),events:this.events.map(clone),contract:{profiles:Object.fromEntries(Object.entries(PROFILES).map(([k,v])=>[k,[...v]])),historyStages:[...HISTORY_STAGES],blanketReset:false,staleDerivedStateRejected:true,roomStaticRebuilt:true,resizePreservesGeometry:!SIZE_DERIVED.includes('occluders')&&!SIZE_DERIVED.includes('clusters')}};
    }
  }

  function bindProductionTargets(game,graph){
    const stages=game?.webgpuStages||game?.renderer?.webgpuStages||null;if(stages)graph.registerProductionTargets(stages);return stages;
  }

  function installGameIntegration(game,graph=null){
    if(!game)return null;if(game.__sm404TransitionIntegration)return game.__sm404TransitionIntegration;
    graph=graph instanceof RenderTransitionInvalidationGraph?graph:new RenderTransitionInvalidationGraph({roomId:roomIdOf(game)});game.webgpuTransitionState=graph;bindProductionTargets(game,graph);
    if(typeof game.enterRoom==='function'&&!game.__sm404EnterRoom){
      const original=game.enterRoom;game.enterRoom=function(index,entrySide){
        bindProductionTargets(this,graph);const fromRoomId=roomIdOf(this),toRoomId=roomIdOf(this,index);clearSceneCapture(this,'room-change');graph.invalidate('room-change',{fromRoomId,toRoomId,extra:{index:Number(index),entrySide:entrySide??null}});const result=original.apply(this,arguments);graph.roomId=roomIdOf(this);return result
      };game.__sm404EnterRoom=true;
    }
    if(typeof game.resetAllProgress==='function'&&!game.__sm404ResetAll){
      const original=game.resetAllProgress;game.resetAllProgress=function(){bindProductionTargets(this,graph);const fromRoomId=roomIdOf(this);clearSceneCapture(this,'project-reload');graph.invalidate('project-reload',{fromRoomId,toRoomId:'0',extra:{source:'resetAllProgress'}});const result=original.apply(this,arguments);graph.roomId=roomIdOf(this);return result};game.__sm404ResetAll=true;
    }
    game.__sm404TransitionIntegration={schema:SCHEMA,graph,game};return game.__sm404TransitionIntegration;
  }

  function installBackendIntegration(runtime,graph){
    if(!runtime||!graph)return null;if(runtime.__sm404TransitionIntegration)return runtime.__sm404TransitionIntegration;
    if(typeof runtime.select==='function'&&!runtime.__sm404Select){
      const original=runtime.select;runtime.select=async function(mode,options){const fromBackend=cleanId(this.activeBackend),toBackend=cleanId(mode);graph.invalidate('backend-reconfigure',{fromBackend,toBackend,extent:extentOf(this),extra:{requested:toBackend}});const result=await original.apply(this,arguments);graph.backend=cleanId(this.activeBackend);graph.extent=extentOf(this)||graph.extent;return result};runtime.__sm404Select=true;
    }
    if(typeof runtime.resizeProbe==='function'&&!runtime.__sm404Resize){
      const original=runtime.resizeProbe;runtime.resizeProbe=async function(width,height,dpr=1){const before=extentOf(this),result=await original.apply(this,arguments),after=result?{width:Number(result.width)||Number(width)||1,height:Number(result.height)||Number(height)||1,dpr:Number(result.dpr)||Number(dpr)||1}:extentOf(this);if(result&&(!before||before.width!==after.width||before.height!==after.height||before.dpr!==after.dpr))graph.invalidate('resize',{extent:after,extra:{before}});return result};runtime.__sm404Resize=true;
    }
    if(typeof runtime._deviceLost==='function'&&!runtime.__sm404DeviceLost){
      const original=runtime._deviceLost;runtime._deviceLost=function(manager,info){graph.invalidate('device-rebuild',{fromBackend:cleanId(this.activeBackend),toBackend:'webgl2',extent:extentOf(this),extra:{reason:cleanId(info?.reason)||'unknown'}});return original.apply(this,arguments)};runtime.__sm404DeviceLost=true;
    }
    runtime.__sm404TransitionIntegration={schema:SCHEMA,graph,runtime};return runtime.__sm404TransitionIntegration;
  }

  function installRuntimeIntegration(target=root){
    if(!target)return null;if(target.__sm404RuntimeInstall)return target.__sm404RuntimeInstall;
    const graph=target.game?.webgpuTransitionState instanceof RenderTransitionInvalidationGraph?target.game.webgpuTransitionState:new RenderTransitionInvalidationGraph({roomId:roomIdOf(target.game),backend:target.steelMothBackendRuntime?.activeBackend,extent:extentOf(target.steelMothBackendRuntime)});
    const state={schema:SCHEMA,graph,gameInstalled:false,backendInstalled:false};target.__sm404RuntimeInstall=state;
    const attach=()=>{if(target.game&&!state.gameInstalled){installGameIntegration(target.game,graph);state.gameInstalled=true}if(target.steelMothBackendRuntime&&!state.backendInstalled){installBackendIntegration(target.steelMothBackendRuntime,graph);state.backendInstalled=true}return state.gameInstalled&&state.backendInstalled};
    attach();if(!(state.gameInstalled&&state.backendInstalled)&&typeof target.setInterval==='function'){let attempts=0;const timer=target.setInterval(()=>{attempts++;if(attach()||attempts>625)target.clearInterval(timer)},16)}return state;
  }

  const api={SCHEMA,EVENT_SCHEMA,STAGES,ROOM_DERIVED,SIZE_DERIVED,BACKEND_DERIVED,HISTORY_STAGES,PROFILES,RenderTransitionInvalidationGraph,clearSceneCapture,bindProductionTargets,installGameIntegration,installBackendIntegration,installRuntimeIntegration};
  return api;
});
