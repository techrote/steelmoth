'use strict';

(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SteelMothWebGPUEditorState=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  const SCHEMA='steelmoth-webgpu-editor-state/v1';
  const EVENT_SCHEMA='steelmoth-webgpu-editor-invalidation/v1';
  const PERSISTENT_STAGES=Object.freeze(['depthHierarchy','occluders','clusters','dominance','dso','dsoHierarchy','darkBloom','darkBloomTemporal']);
  const FRAME_LOCAL_STAGES=Object.freeze(['renderScene','instances','materials','ownershipDepth','objectId','localShadows','contact','visibility']);
  const EDIT_REASONS=Object.freeze(['place','move','delete','undo','redo','paste','erase','editor-rebuild','reload','room-change']);
  const clone=value=>{if(value==null)return value;if(typeof structuredClone==='function'){try{return structuredClone(value)}catch(_e){}}return JSON.parse(JSON.stringify(value))};
  const stable=value=>{
    if(value==null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  };
  const hashText=text=>{let h=2166136261>>>0;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0}return h.toString(16).padStart(8,'0')};
  const canonicalHash=value=>hashText(stable(value));
  const roomIdOf=(game,editor)=>String(editor?.roomKey?.()??game?.room?.key??`room-${game?.state?.room??'unknown'}`);

  function stableEditorDecorIds(room){
    const rows=Array.isArray(room?.editor_decor)?room.editor_decor:[];
    const used=new Set();let next=1,assigned=0,repaired=0;
    const allocate=()=>{let id;do{id=`decor_${next++}`}while(used.has(id));return id};
    for(const row of rows){
      let id=typeof row?.editor_id==='string'&&row.editor_id.trim()?row.editor_id.trim():'';
      if(!id||used.has(id)){if(id)repaired++;id=allocate();if(row)row.editor_id=id;assigned++;}
      used.add(id);
      const m=/^decor_(\d+)$/.exec(id);if(m)next=Math.max(next,Number(m[1])+1);
    }
    return{count:rows.length,assigned,repaired,nextDecorId:next,ids:rows.map(r=>String(r.editor_id))};
  }

  function captureEditorIdentity(room,roomId='room'){
    const decor=(room?.editor_decor||[]).map((d,index)=>({authorId:String(d.editor_id||`decor:${index}`),sprite:String(d.sprite||''),x:Number(d.x)||0,y:Number(d.y)||0,renderOrdinal:index,renderId:`sprite:static:${roomId}:${index}`}));
    return{schema:'steelmoth-editor-identity/v1',roomId:String(roomId),decor,hash:canonicalHash({roomId:String(roomId),decor})};
  }

  class EditorRenderInvalidationHub{
    constructor(options={}){
      this.schema=SCHEMA;this.revision=0;this.targets=new Map();this.events=[];this.maxEvents=Math.max(8,Number(options.maxEvents)||64);this.lastReason='uninitialized';this.lastRoomId=null;this.lastRoomHash=null;this.lastMapHash=null;this.lastSavedMapHash=null;this.reloadMatchesSaved=null;this.dirty={};this._markAllDirty();
    }
    _markAllDirty(){for(const name of [...PERSISTENT_STAGES,...FRAME_LOCAL_STAGES])this.dirty[name]=true}
    register(name,target,options={}){
      name=String(name||'');if(!name)throw new Error('editor invalidation target requires a name');
      const persistent=options.persistent??PERSISTENT_STAGES.includes(name);
      if(persistent&&typeof target?.invalidate!=='function')throw new Error(`persistent editor target ${name} must expose invalidate(reason)`);
      this.targets.set(name,{target,persistent,clearHistory:options.clearHistory??(name==='dominance'||name==='darkBloomTemporal')});return target;
    }
    unregister(name){return this.targets.delete(String(name))}
    registerProductionTargets(targets={}){
      for(const name of PERSISTENT_STAGES)if(targets[name])this.register(name,targets[name],{persistent:true});
      for(const name of FRAME_LOCAL_STAGES)if(targets[name])this.register(name,targets[name],{persistent:false});
      return this.diagnostics();
    }
    invalidate(reason='editor-rebuild',meta={}){
      const token=`sm403:${String(reason||'editor-rebuild')}`;const invoked=[];this.revision++;this.lastReason=String(reason||'editor-rebuild');this.lastRoomId=meta.roomId==null?this.lastRoomId:String(meta.roomId);this.lastRoomHash=meta.room==null?this.lastRoomHash:canonicalHash(meta.room);this._markAllDirty();
      for(const [name,entry] of this.targets){
        if(!entry.persistent)continue;
        if(entry.clearHistory)entry.target.invalidate(token,true);else entry.target.invalidate(token);
        invoked.push(name);
      }
      const event={schema:EVENT_SCHEMA,revision:this.revision,reason:this.lastReason,roomId:this.lastRoomId,roomHash:this.lastRoomHash,invalidatedPersistent:invoked,frameLocalDirty:[...FRAME_LOCAL_STAGES]};
      this.events.push(event);if(this.events.length>this.maxEvents)this.events.splice(0,this.events.length-this.maxEvents);return clone(event);
    }
    markRebuilt(names=[...PERSISTENT_STAGES,...FRAME_LOCAL_STAGES]){for(const name of names)this.dirty[String(name)]=false;return this.diagnostics()}
    recordSave(maps){this.lastSavedMapHash=canonicalHash(maps);try{root?.sessionStorage?.setItem?.('steelmoth-sm403-saved-map-hash',this.lastSavedMapHash)}catch(_e){}return this.lastSavedMapHash}
    recordLoadedMaps(maps){this.lastMapHash=canonicalHash(maps);let saved=null;try{saved=root?.sessionStorage?.getItem?.('steelmoth-sm403-saved-map-hash')||null}catch(_e){}this.reloadMatchesSaved=saved?this.lastMapHash===saved:null;return{hash:this.lastMapHash,savedHash:saved,matchesSaved:this.reloadMatchesSaved}}
    diagnostics(){return{schema:SCHEMA,revision:this.revision,lastReason:this.lastReason,lastRoomId:this.lastRoomId,lastRoomHash:this.lastRoomHash,lastMapHash:this.lastMapHash,lastSavedMapHash:this.lastSavedMapHash,reloadMatchesSaved:this.reloadMatchesSaved,registered:[...this.targets.keys()].sort(),dirty:{...this.dirty},events:this.events.map(clone),contract:{persistentInvalidators:[...PERSISTENT_STAGES],frameLocalRebuild:[...FRAME_LOCAL_STAGES],gpuIdsPersisted:false,webgl2FallbackPreserved:true}}}
  }

  function invalidateSceneCapture(game,reason='editor-rebuild'){
    const bridge=game?.renderSceneBridge||game?.__smRenderSceneBridge||game?.renderer?.renderSceneBridge||null;
    if(bridge){bridge.editorRevision=(Number(bridge.editorRevision)||0)+1;bridge.lastEditorInvalidationReason=String(reason);bridge.lastScene=null;}
    if(game)game.renderScene=null;
    if(game?.renderer)game.renderer.lastRenderScene=null;
    if(root&&root.steelMothLastRenderScene)root.steelMothLastRenderScene=null;
    return{bridge:!!bridge,editorRevision:Number(bridge?.editorRevision)||0};
  }

  function withReason(editor,name,reason){
    if(!editor||typeof editor[name]!=='function'||editor[`__sm403_${name}`])return;
    const original=editor[name];editor[name]=function(...args){const prior=this.__sm403Reason;this.__sm403Reason=reason;try{return original.apply(this,args)}finally{this.__sm403Reason=prior}};editor[`__sm403_${name}`]=true;
  }

  function patchMovingDecorIdentity(editor){
    if(!editor||typeof editor.pasteDataItem!=='function'||editor.__sm403PasteDataItem)return;
    const original=editor.pasteDataItem;editor.pasteDataItem=function(c,dx,dy,moving=false){
      if(!(moving&&c?.kind==='pixel'&&c?.type==='decor'&&c?.data?.editor_id))return original.call(this,c,dx,dy,moving);
      const room=this.rawRoom?.(),before=Array.isArray(room?.editor_decor)?room.editor_decor.length:0,next=this.nextDecorId,result=original.call(this,c,dx,dy,moving),rows=room?.editor_decor||[];
      if(rows.length>before)rows[rows.length-1].editor_id=String(c.data.editor_id);
      this.nextDecorId=next;return result;
    };editor.__sm403PasteDataItem=true;
  }

  function installEditorIntegration(game,editor){
    if(!game||!editor)return null;if(editor.__sm403Integration)return editor.__sm403Integration;
    const hub=game.webgpuEditorState instanceof EditorRenderInvalidationHub?game.webgpuEditorState:new EditorRenderInvalidationHub();game.webgpuEditorState=hub;
    const initialRoom=editor.rawRoom?.();if(initialRoom)stableEditorDecorIds(initialRoom);hub.recordLoadedMaps(game.maps||{});
    patchMovingDecorIdentity(editor);
    for(const [name,reason] of [['undoOne','undo'],['redoOne','redo'],['deleteSelection','delete'],['applyMove','move'],['pasteClipboard','paste'],['paintAt','place'],['eraseAt','erase']])withReason(editor,name,reason);
    if(typeof editor.rebuildRoom==='function'&&!editor.__sm403RebuildRoom){const original=editor.rebuildRoom;editor.rebuildRoom=function(...args){const room=this.rawRoom?.();if(room)stableEditorDecorIds(room);const reason=this.__sm403Reason||'editor-rebuild',roomId=roomIdOf(game,this);invalidateSceneCapture(game,reason);hub.invalidate(reason,{roomId,room});const result=original.apply(this,args);const stages=game.webgpuStages||game.renderer?.webgpuStages;if(stages)hub.registerProductionTargets(stages);return result};editor.__sm403RebuildRoom=true}
    if(typeof editor.saveProject==='function'&&!editor.__sm403SaveProject){const original=editor.saveProject;editor.saveProject=async function(...args){for(const room of Object.values(game.maps?.rooms||{}))stableEditorDecorIds(room);hub.recordSave(game.maps||{});return original.apply(this,args)};editor.__sm403SaveProject=true}
    if(typeof editor.downloadMaps==='function'&&!editor.__sm403DownloadMaps){const original=editor.downloadMaps;editor.downloadMaps=function(...args){for(const room of Object.values(game.maps?.rooms||{}))stableEditorDecorIds(room);hub.recordSave(game.maps||{});return original.apply(this,args)};editor.__sm403DownloadMaps=true}
    const stages=game.webgpuStages||game.renderer?.webgpuStages;if(stages)hub.registerProductionTargets(stages);
    editor.__sm403Integration={schema:SCHEMA,hub,game};return editor.__sm403Integration;
  }

  function installWhenEditorAvailable(target=root){
    if(!target)return null;if(target.__sm403EditorInstall)return target.__sm403EditorInstall;
    const state={schema:SCHEMA,installed:false,editor:null};target.__sm403EditorInstall=state;
    const attach=(game,editor)=>{if(!game||!editor)return null;const result=installEditorIntegration(game,editor);if(result){state.installed=true;state.editor=editor}return result};
    if(target.rmfEditor)attach(target.rmfEditor.game||target.game,target.rmfEditor);
    const setup=target.setupWysiwygEditor;if(typeof setup==='function'&&!setup.__sm403Wrapped){const wrapped=function(game){const editor=setup.apply(this,arguments);attach(game,editor);return editor};wrapped.__sm403Wrapped=true;wrapped.__sm403Original=setup;target.setupWysiwygEditor=wrapped;}
    if(!state.installed&&typeof target.setInterval==='function'){let attempts=0;const timer=target.setInterval(()=>{attempts++;if(target.rmfEditor&&attach(target.rmfEditor.game||target.game,target.rmfEditor)||attempts>625)target.clearInterval(timer)},16)}
    return state;
  }

  const api={SCHEMA,EVENT_SCHEMA,PERSISTENT_STAGES,FRAME_LOCAL_STAGES,EDIT_REASONS,canonicalHash,stableEditorDecorIds,captureEditorIdentity,EditorRenderInvalidationHub,invalidateSceneCapture,installEditorIntegration,installWhenEditorAvailable};
  if(root&&root.window===root)installWhenEditorAvailable(root);
  return api;
});
