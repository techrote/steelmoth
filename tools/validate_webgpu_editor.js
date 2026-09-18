'use strict';
const A=require('../engine/webgpu_editor_state.js');
let checks=0;
function ok(value,message){checks++;if(!value)throw new Error(`FAIL ${message}`)}
function eq(a,b,message){checks++;const aa=JSON.stringify(a),bb=JSON.stringify(b);if(aa!==bb)throw new Error(`FAIL ${message}: ${aa} !== ${bb}`)}
const clone=v=>JSON.parse(JSON.stringify(v));

function probe(name){return{name,valid:true,history:true,calls:[],invalidate(reason,clearHistory){this.calls.push([String(reason),clearHistory]);this.valid=false;if(clearHistory)this.history=false;return this.calls.length}}}

(async()=>{
  eq(A.SCHEMA,'steelmoth-webgpu-editor-state/v1','schema');
  ok(A.PERSISTENT_STAGES.includes('depthHierarchy')&&A.PERSISTENT_STAGES.includes('darkBloomTemporal'),'persistent stage contract');
  ok(A.FRAME_LOCAL_STAGES.includes('objectId')&&A.FRAME_LOCAL_STAGES.includes('contact'),'frame-local stage contract');

  const legacy={editor_decor:[{sprite:'a'},{editor_id:'decor_1',sprite:'b'},{editor_id:'decor_1',sprite:'c'}]};
  const normalized=A.stableEditorDecorIds(legacy);
  ok(normalized.assigned===3&&normalized.repaired===2,'missing/duplicate author ids normalized deterministically');
  ok(new Set(normalized.ids).size===3,'author ids unique');
  eq(A.stableEditorDecorIds(legacy).assigned,0,'normalization idempotent');

  const room={editor_decor:[]};
  const game={
    state:{room:0},maps:{rooms:{bin:room}},room:{key:'bin'},renderScene:{stale:true},
    renderer:{backend:'webgl2',lastRenderScene:{stale:true}},
    renderSceneBridge:{lastScene:{stale:true},editorRevision:0}
  };
  const editor={
    game,nextDecorId:1,rebuilds:0,undoState:null,redoState:null,
    roomKey(){return'bin'},rawRoom(){return game.maps.rooms.bin},
    rebuildRoom(){this.rebuilds++},
    paintAt(d){this.rawRoom().editor_decor.push(clone(d));this.nextDecorId=Math.max(this.nextDecorId,3);this.rebuildRoom()},
    pasteDataItem(c,dx,dy,moving=false){const d=clone(c.data);d.x=c.x+dx;d.y=c.y+dy;if(c.type==='decor'){d.editor_id=`decor_${this.nextDecorId++}`;this.rawRoom().editor_decor.push(d)}},
    applyMove(id,x,y){const rows=this.rawRoom().editor_decor,i=rows.findIndex(d=>d.editor_id===id),d=clone(rows[i]);rows.splice(i,1);this.pasteDataItem({type:'decor',kind:'pixel',data:d,x:d.x,y:d.y},x-d.x,y-d.y,true);this.rebuildRoom()},
    deleteSelection(id='decor_2'){this.undoState=clone(this.rawRoom());this.redoState=null;this.rawRoom().editor_decor=this.rawRoom().editor_decor.filter(d=>d.editor_id!==id);this.rebuildRoom()},
    undoOne(){if(!this.undoState)return;this.redoState=clone(this.rawRoom());game.maps.rooms.bin=clone(this.undoState);this.rebuildRoom()},
    redoOne(){if(!this.redoState)return;this.undoState=clone(this.rawRoom());game.maps.rooms.bin=clone(this.redoState);this.rebuildRoom()},
    pasteClipboard(){this.rawRoom().editor_decor.push({editor_id:`decor_${this.nextDecorId++}`,sprite:'paste',x:9,y:9});this.rebuildRoom()},
    eraseAt(){this.rawRoom().editor_decor.shift();this.rebuildRoom()},
    async saveProject(){this.savedBody=JSON.stringify(game.maps);return this.savedBody},
    downloadMaps(){this.downloadedBody=JSON.stringify(game.maps);return this.downloadedBody}
  };

  const integration=A.installEditorIntegration(game,editor),hub=integration.hub;
  ok(integration.schema===A.SCHEMA&&game.webgpuEditorState===hub,'integration installs hub');
  const targets={};for(const name of A.PERSISTENT_STAGES)targets[name]=probe(name);
  for(const name of A.FRAME_LOCAL_STAGES)targets[name]={name};
  hub.registerProductionTargets(targets);
  eq(hub.diagnostics().registered.length,A.PERSISTENT_STAGES.length+A.FRAME_LOCAL_STAGES.length,'all production state classes registered');

  editor.paintAt({editor_id:'decor_1',sprite:'bin_a',x:20,y:30});
  editor.paintAt({editor_id:'decor_2',sprite:'bin_b',x:26,y:32});
  ok(hub.events.at(-1).reason==='place','place reason reaches invalidation hub');
  ok(A.PERSISTENT_STAGES.every(n=>targets[n].valid===false),'place invalidates every persistent derived stage');
  ok(hub.diagnostics().dirty.objectId&&hub.diagnostics().dirty.contact,'place dirties frame-local object/contact outputs');
  hub.markRebuilt();for(const name of A.PERSISTENT_STAGES){targets[name].valid=true;targets[name].history=true}

  const preMove=A.captureEditorIdentity(editor.rawRoom(),'bin'),nextBefore=editor.nextDecorId;
  editor.applyMove('decor_2',40,44);
  const moved=editor.rawRoom().editor_decor.find(d=>d.sprite==='bin_b');
  eq(moved.editor_id,'decor_2','moving decor preserves author id instead of allocating transient id');
  eq(editor.nextDecorId,nextBefore,'move does not consume author id counter');
  ok(hub.events.at(-1).reason==='move','move reason reaches invalidation hub');
  ok(game.renderScene===null&&game.renderer.lastRenderScene===null&&game.renderSceneBridge.lastScene===null,'move clears stale canonical/WebGL2 scene snapshots');
  ok(game.renderSceneBridge.editorRevision>=3,'scene bridge editor revision advances across edits');
  ok(targets.dominance.history===false&&targets.darkBloomTemporal.history===false,'move drops owner/temporal history explicitly');
  ok(targets.depthHierarchy.calls.at(-1)[0]==='sm403:move','production invalidator receives namespaced reason');
  ok(preMove.decor.find(d=>d.authorId==='decor_2').authorId===moved.editor_id,'author identity survives move');

  hub.markRebuilt();for(const name of A.PERSISTENT_STAGES)targets[name].valid=true;
  editor.deleteSelection('decor_2');
  ok(!editor.rawRoom().editor_decor.some(d=>d.editor_id==='decor_2'),'delete removes edited object');
  ok(hub.events.at(-1).reason==='delete'&&targets.dso.valid===false,'delete invalidates DSO state');
  editor.undoOne();
  ok(editor.rawRoom().editor_decor.some(d=>d.editor_id==='decor_2'),'undo restores author object');
  ok(hub.events.at(-1).reason==='undo','undo invalidation reason');
  const undoIdentity=A.captureEditorIdentity(editor.rawRoom(),'bin');
  editor.redoOne();
  ok(!editor.rawRoom().editor_decor.some(d=>d.editor_id==='decor_2'),'redo reapplies delete');
  ok(hub.events.at(-1).reason==='redo','redo invalidation reason');
  editor.undoOne();
  eq(A.captureEditorIdentity(editor.rawRoom(),'bin').hash,undoIdentity.hash,'undo restoration is deterministic');

  await editor.saveProject();
  const savedHash=hub.lastSavedMapHash,savedIdentity=A.captureEditorIdentity(editor.rawRoom(),'bin'),serialized=JSON.stringify(game.maps),reloaded=JSON.parse(serialized);
  eq(A.canonicalHash(reloaded),savedHash,'save/reload canonical map hash identical');
  eq(A.captureEditorIdentity(reloaded.rooms.bin,'bin').hash,savedIdentity.hash,'save/reload author/render identity identical');
  ok(!serialized.includes('sm403:')&&!serialized.includes('darkBloomTemporal'),'GPU invalidation state is not persisted into maps');
  editor.downloadMaps();
  eq(hub.lastSavedMapHash,A.canonicalHash(game.maps),'download path records same canonical save identity');

  const beforeFallback=editor.rebuilds;game.renderer.backend='webgl2';editor.rebuildRoom();
  eq(editor.rebuilds,beforeFallback+1,'WebGL2 fallback editor rebuild still executes');
  eq(game.renderer.backend,'webgl2','SM-403 does not switch fallback backend');
  ok(hub.diagnostics().contract.webgl2FallbackPreserved===true,'diagnostics declare fallback preservation');
  ok(hub.diagnostics().contract.gpuIdsPersisted===false,'diagnostics reject persistent GPU ids');
  ok(hub.events.length>=8,'canonical edit sequence produced invalidation evidence');
  console.log(`SM-403 EDITOR INVALIDATION PASS: ${checks} assertions, revision=${hub.revision}, roomHash=${hub.lastRoomHash}`);
})().catch(error=>{console.error(error.stack||error);process.exitCode=1});
