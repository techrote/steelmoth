'use strict';

// SM-001/SM-002 bridge: adapt deterministic scene fixtures to the capture harness
// without changing gameplay or renderer semantics. Loaded only by render-test.html.
(() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const finite = value => Number.isFinite(Number(value));
  let sceneFixture = null;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    const url = typeof input === 'string' ? input : String(input?.url || '');
    if (!/render-tests\/fixtures\/[^/?#]+\.json(?:[?#]|$)/.test(url) || !response.ok) return response;

    let fixture;
    try { fixture = await response.clone().json(); }
    catch (_error) { return response; }
    if (fixture?.schema !== 'steelmoth-render-fixture/v1' || !fixture.scene) return response;

    sceneFixture = fixture;
    const light = fixture.light || {};
    const graphics = {...(fixture.graphics || {})};
    const mapGraphic = (source, target) => { if (finite(light[source])) graphics[target] = Number(light[source]); };
    mapGraphic('emissive', 'emissive');
    mapGraphic('light_radius', 'lightRadius');
    mapGraphic('player_omni_radius', 'playerOmniRadius');
    mapGraphic('player_omni_intensity', 'playerOmniIntensity');
    mapGraphic('player_cone_intensity', 'playerConeIntensity');
    mapGraphic('player_cone_inner_angle_deg', 'playerConeInnerAngle');
    mapGraphic('player_cone_outer_angle_deg', 'playerConeOuterAngle');

    const player = Array.isArray(fixture.camera?.player) ? fixture.camera.player : [320,160];
    const adapted = {
      ...fixture,
      id: fixture.id || fixture.name,
      room: fixture.room || {index:0},
      state: fixture.state || {completed:[],collectibles:[],companions:[],released:[]},
      player: fixture.player || {x:Number(player[0]),y:Number(player[1]),visible:true},
      render: {...(fixture.render || {}),hideDynamicActors:true},
      graphics
    };
    const headers = new Headers(response.headers);
    headers.set('content-type','application/json; charset=utf-8');
    return new Response(JSON.stringify(adapted), {status:response.status,statusText:response.statusText,headers});
  };

  function patchGame(game) {
    if (!game || game.__smSceneFixtureAdapter || typeof game.enterRoom !== 'function') return;
    game.__smSceneFixtureAdapter = true;
    const originalEnterRoom = game.enterRoom;
    game.enterRoom = function(index, entrySide) {
      const fixture = sceneFixture;
      if (fixture?.scene && index === 0) {
        const current = this.rooms?.[index];
        const fixtureId = fixture.id || fixture.name;
        if (current && current.__renderFixtureId !== fixtureId) {
          const spec = clone(current.spec);
          spec.objects = [];
          spec.previous_room = null;
          spec.next_room = null;
          spec.previous_side = null;
          spec.next_side = null;
          spec.previous_fraction = .5;
          spec.next_fraction = .5;
          const mapData = {rooms:{[spec.key]:clone(fixture.scene)}};
          const room = new current.constructor(index, spec, mapData);
          room.__renderFixtureId = fixtureId;
          if (typeof room.bindArt === 'function') room.bindArt(this.art);
          this.rooms[index] = room;
        }
      }
      return originalEnterRoom.call(this, index, entrySide);
    };
  }

  let gameValue;
  const existing = Object.getOwnPropertyDescriptor(window,'game');
  if (!existing || existing.configurable) {
    if (existing?.get) gameValue = existing.get.call(window);
    else if (existing && 'value' in existing) gameValue = existing.value;
    Object.defineProperty(window,'game',{
      configurable:true,
      enumerable:true,
      get(){ return gameValue; },
      set(value){ gameValue=value; patchGame(value); }
    });
    if (gameValue) patchGame(gameValue);
  }
})();
