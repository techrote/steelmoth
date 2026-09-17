'use strict';

// SM-002 deterministic renderer capture harness. Loaded before game.js so test-mode
// randomness and persisted settings are isolated before the runtime is constructed.
(() => {
  const params = new URLSearchParams(location.search);
  const truthy = v => /^(1|true|yes|on)$/i.test(String(v || ''));
  const enabled = truthy(params.get('renderTest') || params.get('render_test'));
  const includeCanvasData = truthy(params.get('includeCanvasData'));
  const ANGLES = Object.freeze([0,45,90,135,180,225,270,315]);
  const num = (name, fallback, lo, hi) => {
    const raw = Number(params.get(name));
    const v = Number.isFinite(raw) ? raw : fallback;
    return Math.max(lo, Math.min(hi, v));
  };
  const cleanId = (value, fallback='harness-smoke') => /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value || '') ? value : fallback;
  const requestedAngle = num('lightAngle', 0, -3600, 3600);
  const normalizedAngle = ((requestedAngle % 360) + 360) % 360;
  const quality = String(params.get('quality') || 'high').toLowerCase();
  const config = Object.freeze({
    schema: 'steelmoth-render-test-config/v1',
    fixture: cleanId(params.get('fixture')),
    backend: String(params.get('backend') || 'webgl2').toLowerCase(),
    quality: ['low','medium','high','ultra','runtime-default'].includes(quality) ? quality : 'high',
    width: Math.round(num('width', 640, 160, 3840)),
    height: Math.round(num('height', 360, 90, 2160)),
    dpr: num('dpr', 1, 1, 4),
    lightAngle: normalizedAngle,
    seed: (Math.round(num('seed', 1397572098, 1, 4294967295)) >>> 0) || 1,
    fixedTimeMs: num('fixedTimeMs', 12000, 0, 3600000),
    settleFrames: Math.round(num('settleFrames', 4, 2, 20))
  });

  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  let lastResult = null;
  let fixture = null;

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+stableStringify(value[k])).join(',') + '}';
  }
  function fnv1a(text) {
    let h = 0x811c9dc5;
    for (let i=0;i<text.length;i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8,'0');
  }
  async function sha256Blob(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  function canvasBlob(canvas) {
    return new Promise((resolve,reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas.toBlob returned null')), 'image/png'));
  }
  function blobDataUrl(blob) {
    return new Promise((resolve,reject) => {
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||''));
      reader.onerror=()=>reject(reader.error||new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }
  function writeResult(result) {
    lastResult = result;
    let node = document.getElementById('renderTestResult');
    if (!node) { node = document.createElement('script'); node.id='renderTestResult'; node.type='application/json'; document.body.appendChild(node); }
    node.textContent = JSON.stringify(result);
  }
  function installIsolation() {
    // Do not clear or mutate a real player's persisted state/settings. Test mode sees
    // pristine state through a narrow Storage shim and ignores writes to those keys.
    const isolated = new Set(['signalOrchardStateV103','signalOrchardGraphicsV123']);
    const gp = Storage.prototype.getItem, sp = Storage.prototype.setItem, rp = Storage.prototype.removeItem;
    Storage.prototype.getItem = function(k){ return isolated.has(String(k)) ? null : gp.call(this,k); };
    Storage.prototype.setItem = function(k,v){ if (!isolated.has(String(k))) return sp.call(this,k,v); };
    Storage.prototype.removeItem = function(k){ if (!isolated.has(String(k))) return rp.call(this,k); };
    let state = config.seed >>> 0;
    Math.random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  }
  function installCanvasLayout() {
    const canvas = document.getElementById('game');
    if (!canvas) return;
    const cssW = config.width / config.dpr, cssH = config.height / config.dpr;
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    const frame = document.getElementById('frame');
    if (frame) { frame.style.width=cssW+'px'; frame.style.height=cssH+'px'; frame.style.margin='0'; frame.style.border='0'; }
    document.documentElement.style.background = '#000';
    document.body.classList.add('render-test-mode');
    document.body.style.margin='0'; document.body.style.padding='0'; document.body.style.overflow='hidden';
    const style = document.createElement('style');
    style.textContent = `body.render-test-mode #editorOverlay,body.render-test-mode #wysiwygEditor,body.render-test-mode #roomHeader,body.render-test-mode #objectiveHud,body.render-test-mode #collectibleHud,body.render-test-mode #levelButton,body.render-test-mode #fxButton,body.render-test-mode #gearButton,body.render-test-mode #toast,body.render-test-mode #pauseBadge,body.render-test-mode #runtimeStatus,body.render-test-mode #fps,body.render-test-mode .modal,body.render-test-mode .floating{display:none!important}body.render-test-mode #app,body.render-test-mode #frame{padding:0!important;margin:0!important;box-shadow:none!important}`;
    document.head.appendChild(style);
  }
  function qualityPatch(name) {
    const table = {
      low:{terrainOcclusionQuality:1,selfShadowQuality:1,contactShadowQuality:1,waterQuality:1,grassQuality:1,foliageQuality:1},
      medium:{terrainOcclusionQuality:2,selfShadowQuality:2,contactShadowQuality:2,waterQuality:2,grassQuality:2,foliageQuality:2},
      high:{terrainOcclusionQuality:3,selfShadowQuality:3,contactShadowQuality:2,waterQuality:3,grassQuality:3,foliageQuality:3},
      ultra:{terrainOcclusionQuality:3,selfShadowQuality:4,contactShadowQuality:3,waterQuality:4,grassQuality:4,foliageQuality:3},
      'runtime-default':{}
    };
    return table[name] || table.high;
  }
  async function loadFixture() {
    const r = await fetch(`render-tests/fixtures/${config.fixture}.json`, {cache:'no-store'});
    if (!r.ok) throw new Error(`fixture ${config.fixture}: HTTP ${r.status}`);
    const f = await r.json();
    if (f.schema !== 'steelmoth-render-fixture/v1') throw new Error(`fixture ${config.fixture}: unsupported schema ${f.schema}`);
    if (f.id !== config.fixture) throw new Error(`fixture id ${f.id} does not match URL fixture ${config.fixture}`);
    return f;
  }
  function clearDynamic(game, f) {
    if (!f.render?.hideDynamicActors) return;
    if (game.flock?.m) game.flock.m.length=0;
    if (game.followers?.units) game.followers.units.length=0;
    if (game.miniGuides?.units) game.miniGuides.units.length=0;
    if (game.creatures?.units) game.creatures.units.length=0;
    if (game.fireflies?.f) game.fireflies.f.length=0;
    for (const key of ['p','items','particles']) if (Array.isArray(game.particles?.[key])) game.particles[key].length=0;
    if (Array.isArray(game.fx?.items)) game.fx.items.length=0;
    if (f.player?.visible === false && typeof game.renderPlayer === 'function') game.renderPlayer = () => {};
    if (typeof game.renderMothPickups === 'function') game.renderMothPickups = () => {};
    if (typeof game.renderMiniRobots === 'function') game.renderMiniRobots = () => {};
  }
  function applyState(game, f) {
    if (!game?.state || !Array.isArray(game.rooms)) throw new Error('game state unavailable');
    game.state.save = () => {};
    const st=f.state||{};
    game.state.completed=new Set(st.completed||[]);
    game.state.moths=new Set(st.collectibles||[]);
    game.state.robots=new Set(st.companions||[]);
    game.state.released=new Set(st.released||[]);
    game.state.shown=new Set(game.storyData.rooms.map(r=>r.key));
    const idx = Number.isInteger(f.room?.index) ? f.room.index : game.storyData.rooms.findIndex(r=>r.key===f.room?.key);
    if (!(idx>=0 && idx<game.rooms.length)) throw new Error(`fixture ${f.id}: invalid room`);
    game.enterRoom(idx, null);
    if (Number.isFinite(f.player?.x) && Number.isFinite(f.player?.y)) { game.x=f.player.x; game.y=f.player.y; game.vx=0; game.vy=0; }
    game.paused = true; game.keys?.clear?.(); game.mousePath=[]; game.mousePathI=0; game.pendingRoomTransition=null; game.transitionCooldown=999;
    game.pulseLight=0; game.playerActionUntil=0; game.playerActionKind='';
    Object.assign(game.graphics, qualityPatch(config.quality), {
      grain:0, maxFPS:60, forceCompleteLight:false, portalFX:false, magicFX:false,
      foliageFreezeWind:true, grassWindSpeed:0, waterWaveSpeed:0,
      companionLightIntensity:0,fragmentLightIntensity:0,orbiterLightIntensity:0,
      ambientLifeLightIntensity:0,fireflyLightIntensity:0,objectiveLightIntensity:0
    }, f.graphics||{});
    const diag=f.diagnostic||{};
    if (Number.isFinite(diag.ambient)) { game.graphics.ambientInitial=diag.ambient; game.graphics.ambientComplete=diag.ambient; game.ambientLevel=diag.ambient; }
    if (Number.isFinite(diag.coneIntensity)) game.graphics.playerConeIntensity=diag.coneIntensity;
    if (Number.isFinite(diag.coneRange)) game.graphics.playerConeRange=diag.coneRange;
    if (Number.isFinite(diag.omniIntensity)) game.graphics.playerOmniIntensity=diag.omniIntensity;
    const a=config.lightAngle*Math.PI/180, origin=game.playerLightOrigin(), radius=240;
    game.mouseAimActive=true; game.mouseAimX=origin.x+Math.cos(a)*radius; game.mouseAimY=origin.y+Math.sin(a)*radius;
    game.playerFacing=Math.cos(a)<0?-1:1;
    clearDynamic(game,f);
    game.bgKey=''; game.ensureBackground(true); game.updateUI();
    document.querySelectorAll('.modal,.floating').forEach(e=>e.classList.add('hidden'));
    const originalRender=game.render.bind(game);
    game.render = () => originalRender(config.fixedTimeMs);
  }
  async function buildResult(game) {
    // Force one deterministic presentation after all asynchronous renderer modules
    // have settled. The browser-parity runner may request the exact PNG bytes used
    // for this hash so it never has to race a later animation-frame redraw.
    game.render();
    const canvas=document.getElementById('game'), blob=await canvasBlob(canvas), diag=game.diagnostics(), canvasHash=await sha256Blob(blob);
    const actualDpr=Number(window.devicePixelRatio||1), scene={fixture:fixture.id,room:game.room?.key||null,roomIndex:game.room?.index??null,position:[game.x,game.y],completed:[...game.state.completed].sort(),collectibles:[...game.state.moths].sort(),companions:[...game.state.robots].sort(),lightAngle:config.lightAngle,quality:config.quality,seed:config.seed,fixedTimeMs:config.fixedTimeMs};
    const metadata={schema:'steelmoth-render-capture/v1',buildVersion:diag.version||null,backend:'webgl2',fixture:fixture.id,fixtureSchema:fixture.schema,config,scene,viewport:{requestedNative:[config.width,config.height],actualNative:diag.renderer?.native||[canvas.width,canvas.height],dprRequested:config.dpr,dprActual:actualDpr,dprMatched:Math.abs(actualDpr-config.dpr)<.01},renderer:diag.renderer||null,diagnosticLight:game.playerLightCone(),environment:{userAgent:navigator.userAgent,platform:navigator.platform||null},limitations:['WebGPU is not implemented in the v1.2.3 baseline; backend=webgl2 is the only accepted backend in SM-002.']};
    const stable={config:metadata.config,scene:metadata.scene,viewport:{requestedNative:metadata.viewport.requestedNative,actualNative:metadata.viewport.actualNative,dprRequested:metadata.viewport.dprRequested,dprActual:metadata.viewport.dprActual},renderer:{materialPipeline:metadata.renderer?.materialPipeline||null,gBuffer:metadata.renderer?.gBuffer?{size:metadata.renderer.gBuffer.size,float:metadata.renderer.gBuffer.float}:null}};
    const canvasPng={bytes:blob.size,sha256:canvasHash};
    if(includeCanvasData)canvasPng.dataUrl=await blobDataUrl(blob);
    const result={ok:true,metadata,sceneFingerprint:fnv1a(stableStringify(stable)),canvasPng,performance:{gpuTimingAvailable:!!diag.renderer?.gpuTimerQueries,gpuTimesMs:diag.renderer?.gpuTimesMs||null,note:'Values are evidence only for the actual browser/adapter used. Headless or software rendering is not hardware performance evidence.'}};
    // Freeze presentation after the accepted frame. requestAnimationFrame continues,
    // but cannot replace the pixels between hash acceptance and CDP screenshot.
    game.render=()=>{};
    writeResult(result); document.body.dataset.renderTestReady='1'; return result;
  }
  async function capture() {
    if (!lastResult?.ok) await ready;
    const canvas=document.getElementById('game'), blob=await canvasBlob(canvas);
    return {blob,dataUrl:canvas.toDataURL('image/png'),diagnostics:lastResult};
  }
  async function start() {
    if (!enabled) { readyResolve({ok:false,disabled:true}); return; }
    try {
      if (config.backend !== 'webgl2') throw new Error(`backend ${config.backend} is unavailable in baseline v1.2.3; use webgl2`);
      installCanvasLayout(); fixture=await loadFixture();
      const deadline=performance.now()+15000;
      while ((!window.game || document.body.dataset.ready!=='1') && performance.now()<deadline) await new Promise(r=>setTimeout(r,25));
      if (!window.game) throw new Error('game did not become ready within 15 seconds');
      // SM-100/101 compatibility modules load asynchronously from webapp.js. A
      // parity capture taken before that promise resolves tests a race, not the
      // accepted renderer path, so require the bridge to settle first.
      if(globalThis.steelMothRenderSceneReady&&typeof globalThis.steelMothRenderSceneReady.then==='function')await globalThis.steelMothRenderSceneReady;
      if(!window.game.renderSceneBridge)throw new Error('render scene compatibility bridge did not attach before capture');
      if(!globalThis.steelMothRenderTransformBaseline&&!window.game.renderTransform)throw new Error('SM-101 shared transform authority did not attach before capture');
      applyState(window.game,fixture);
      for(let i=0;i<config.settleFrames;i++) await new Promise(r=>requestAnimationFrame(r));
      const result=await buildResult(window.game); readyResolve(result);
    } catch (error) {
      const result={ok:false,error:String(error?.stack||error),config}; writeResult(result); document.body.dataset.renderTestError='1'; readyResolve(result);
    }
  }

  if (enabled) installIsolation();
  window.SteelMothRenderHarness={enabled,config,angles:ANGLES,ready,capture,get result(){return lastResult;}};
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
