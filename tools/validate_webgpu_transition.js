'use strict';
const fs=require('fs');
const path=require('path');
const A=require('../engine/webgpu_transition_state.js');
let checks=0;
function ok(value,message){checks++;if(!value)throw new Error(`FAIL ${message}`)}
function eq(a,b,message){checks++;const aa=JSON.stringify(a),bb=JSON.stringify(b);if(aa!==bb)throw new Error(`FAIL ${message}: ${aa} !== ${bb}`)}
function probe(name){return{name,valid:true,history:true,calls:[],invalidate(reason,clearHistory){this.calls.push([String(reason),!!clearHistory]);this.valid=false;if(clearHistory)this.history=false}}}
const maps=JSON.parse(fs.readFileSync(path.join(__dirname,'..','game_data','maps.json'),'utf8'));
const roomKeys=Object.keys(maps.rooms||{});

(async()=>{
  eq(A.SCHEMA,'steelmoth-webgpu-transition-state/v1','schema');
  ok(roomKeys.length>=3,'fixture uses the real multi-room project');
  ok(A.PROFILES['room-change'].includes('objectId')&&A.PROFILES['room-change'].includes('clusters')&&A.PROFILES['room-change'].includes('darkBloomTemporal'),'room transition covers ownership, cluster and history state');
  ok(A.PROFILES.resize.includes('objectId')&&A.PROFILES.resize.includes('depthHierarchy')&&!A.PROFILES.resize.includes('clusters')&&!A.PROFILES.resize.includes('occluders'),'resize invalidates target-size state but preserves geometry topology');
  ok(A.PROFILES['backend-reconfigure'].length===A.STAGES.length,'backend reconfigure covers all derived renderer state');

  const graph=new A.RenderTransitionInvalidationGraph({roomId:roomKeys[0],backend:'webgpu',extent:{width:640,height:360,dpr:1}}),targets={};
  for(const name of A.STAGES){targets[name]=probe(name);graph.register(name,targets[name])}
  eq(graph.diagnostics().registered.length,A.STAGES.length,'all transition stages registered');
  ok(graph.diagnostics().contract.blanketReset===false,'contract rejects blanket resetEverything');

  const game={
    state:{room:0},rooms:roomKeys.map(key=>({key,spec:{id:key}})),room:null,renderScene:{stale:true},renderer:{lastRenderScene:{stale:true}},renderSceneBridge:{lastScene:{stale:true},transitionRevision:0},
    enterRoom(index){this.state.room=index;this.room=this.rooms[index];this.renderScene={room:this.room.key}},
    resetAllProgress(){this.state.room=0;this.room=this.rooms[0];this.renderScene={room:this.room.key}}
  };
  game.room=game.rooms[0];A.installGameIntegration(game,graph);
  ok(game.webgpuTransitionState===graph,'game owns canonical transition graph');

  let priorRoom=roomKeys[0],expectedRoomEvents=0;
  for(let cycle=0;cycle<2;cycle++){
    for(let i=0;i<roomKeys.length;i++){
      graph.markRebuilt();for(const t of Object.values(targets)){t.valid=true;t.history=true}
      graph.recordDerived('objectId',{room:priorRoom,ids:[`${priorRoom}:object`]});
      graph.recordDerived('clusters',{room:priorRoom,ids:[`${priorRoom}:cluster`]});
      graph.recordDerived('darkBloomTemporal',{room:priorRoom,energy:0.75});
      const oldStamp=graph.currentStamp('pre-transition');game.renderScene={room:priorRoom,stale:true};game.renderer.lastRenderScene={room:priorRoom};game.renderSceneBridge.lastScene={room:priorRoom};
      game.enterRoom(i,'WEST');expectedRoomEvents++;
      eq(graph.roomId,roomKeys[i],`room ${roomKeys[i]} becomes graph authority`);
      ok(graph.lastEvent.reason==='room-change'&&graph.lastEvent.fromRoomId===priorRoom,'room event records transition endpoints');
      ok(game.renderer.lastRenderScene===null&&game.renderSceneBridge.lastScene===null,'transition clears old renderer/bridge scene captures');
      ok(graph.readDerived('objectId')===null&&graph.readDerived('clusters')===null&&graph.readDerived('darkBloomTemporal')===null,'old object/cluster/history records cannot cross room boundary');
      ok(!graph.isCurrentStamp(oldStamp),'pre-transition stamp rejected after room epoch change');
      ok(A.ROOM_DERIVED.every(name=>graph.dirty[name]===true),'all room-derived classes marked dirty');
      ok(targets.dominance.history===false&&targets.darkBloomTemporal.history===false,'owner and temporal history explicitly cleared');
      ok(targets.depthHierarchy.calls.at(-1)[0].startsWith('sm404:room-change:'),'production invalidator receives SM-404 room token');
      graph.markRebuilt();graph.recordDerived('objectId',{room:roomKeys[i],ids:[`${roomKeys[i]}:object`]});graph.recordDerived('clusters',{room:roomKeys[i],ids:[`${roomKeys[i]}:cluster`]});
      eq(graph.readDerived('objectId').room,roomKeys[i],'rebuilt ownership state belongs to current room');
      priorRoom=roomKeys[i];
    }
  }
  eq(graph.events.filter(e=>e.reason==='room-change').length,expectedRoomEvents,'every repeated room transition recorded');

  graph.markRebuilt();for(const t of Object.values(targets)){t.valid=true;t.history=true}
  graph.recordDerived('clusters',{ids:['geometry-stable']});graph.recordDerived('occluders',{ids:['geometry-stable']});graph.recordDerived('objectId',{ids:['surface-sized']});
  const clusterCalls=targets.clusters.calls.length,occluderCalls=targets.occluders.calls.length,roomEpoch=graph.roomEpoch;
  graph.invalidate('resize',{extent:{width:1280,height:720,dpr:1}});
  eq(graph.roomEpoch,roomEpoch,'resize does not advance room epoch');
  ok(graph.surfaceEpoch>0&&graph.extent.width===1280,'resize advances surface epoch and extent');
  ok(graph.readDerived('clusters')?.ids?.[0]==='geometry-stable'&&graph.readDerived('occluders')?.ids?.[0]==='geometry-stable','resize preserves geometry-only derived records');
  ok(graph.readDerived('objectId')===null&&graph.dirty.objectId===true,'resize rejects target-size object-ID state');
  ok(graph.dirty.clusters===false&&graph.dirty.occluders===false,'resize leaves geometry topology clean');
  eq(targets.clusters.calls.length,clusterCalls,'resize does not invalidate clusters');eq(targets.occluders.calls.length,occluderCalls,'resize does not invalidate occluders');
  ok(targets.darkBloomTemporal.history===false,'resize clears temporal history');

  graph.markRebuilt();for(const t of Object.values(targets)){t.valid=true;t.history=true}
  graph.recordDerived('clusters',{ids:['old-device-cluster']});const backendEpoch=graph.backendEpoch;
  graph.invalidate('backend-reconfigure',{fromBackend:'webgpu',toBackend:'webgl2',extent:{width:1280,height:720,dpr:1}});
  ok(graph.backendEpoch===backendEpoch+1&&graph.backend==='webgl2','backend transition advances backend epoch');
  ok(graph.readDerived('clusters')===null&&graph.dirty.clusters===true,'backend change invalidates geometry GPU representation');
  ok(targets.dominance.history===false&&targets.darkBloomTemporal.history===false,'backend change rejects all ownership/history state');

  graph.markRebuilt();graph.recordDerived('objectId',{ids:['before-project-reload']});game.renderScene={stale:true};game.resetAllProgress();
  ok(graph.lastEvent.reason==='project-reload'&&graph.readDerived('objectId')===null,'project reload uses room-wide invalidation profile');

  const backend={
    activeBackend:'webgpu',manager:{configuration:{width:640,height:360,dpr:1}},infrastructure:{resize(){return true}},
    async select(mode){this.activeBackend=mode;return{activeBackend:mode}},
    async resizeProbe(width,height,dpr=1){this.manager.configuration={width,height,dpr};return{width,height,dpr,infrastructureResized:true}},
    _deviceLost(){this.activeBackend='webgl2';return'fallback'}
  };
  A.installBackendIntegration(backend,graph);const beforeSelect=graph.revision;await backend.select('webgpu',{persist:false});
  ok(graph.revision===beforeSelect+1&&graph.lastEvent.reason==='backend-reconfigure','backend select is wrapped by canonical invalidation graph');
  graph.markRebuilt();const staticStamp=graph.recordDerived('clusters',{ids:['same-geometry']});const beforeResize=graph.revision;await backend.resizeProbe(800,450,1);
  ok(graph.revision===beforeResize+1&&graph.lastEvent.reason==='resize','backend resize emits selective resize event');
  ok(graph.readDerived('clusters')?.ids?.[0]==='same-geometry','backend resize wrapper preserves geometry record');
  await backend.resizeProbe(800,450,1);eq(graph.revision,beforeResize+1,'identical resize does not emit redundant event');
  backend._deviceLost(null,{reason:'destroyed'});ok(graph.lastEvent.reason==='device-rebuild'&&graph.backend==='webgl2','device loss emits full backend/device invalidation');
  ok(!graph.isCurrentStamp(staticStamp,{roomSensitive:true,sizeSensitive:false,backendSensitive:true}),'pre-device GPU stamp rejected');

  const diag=graph.diagnostics();ok(diag.events.length>roomKeys.length&&diag.events.at(-1).reason==='device-rebuild','diagnostics retain bounded transition event history');
  ok(diag.contract.staleDerivedStateRejected&&diag.contract.roomStaticRebuilt&&diag.contract.resizePreservesGeometry,'diagnostics publish SM-404 invariants');
  console.log(`SM-404 TRANSITION INVALIDATION PASS: ${checks} assertions, rooms=${roomKeys.length}, events=${diag.events.length}, revision=${diag.revision}`);
})().catch(error=>{console.error(error.stack||error);process.exitCode=1});
