'use strict';

// CPU/API-ordering invariants only. This mock never executes shaders and is not
// GPU validation, output parity, visual evidence or a performance measurement.
const assert = require('node:assert/strict');
const SSGI = require('../engine/webgpu_ssgi.js');
const Validity = require('../engine/webgpu_gtao_stabilization.js');
const Depth = require('../engine/webgpu_depth_hierarchy.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(predicate, description) {
  for (let turn = 0; turn < 64; turn++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`Mock operation did not reach ${description}`);
}

function mockDevice(name = 'device-A') {
  const loss = deferred();
  const state = {
    name, textures: [], buffers: [], pipelines: [], bindGroups: [], commands: [],
    submits: [], waits: 0, compileCalls: 0, compilation: null, completion: null,
    failSubmit: false, failEncode: false, writes: [], scopes: [], loss
  };
  const device = {
    name, lost: loss.promise,
    pushErrorScope(type) { state.scopes.push(type); },
    async popErrorScope() { state.scopes.pop(); return null; },
    createTexture(descriptor) {
      const texture = {
        descriptor, device, destroyed: 0,
        createView() { return { texture, device, label: descriptor.label }; },
        destroy() { texture.destroyed++; }
      };
      state.textures.push(texture);
      return texture;
    },
    createBuffer(descriptor) {
      const buffer = {
        descriptor, device, destroyed: 0, data: new Uint8Array(descriptor.size),
        destroy() { buffer.destroyed++; },
        mapAsync() { throw new Error('Normal producer must not map diagnostics'); }
      };
      state.buffers.push(buffer);
      return buffer;
    },
    createShaderModule(descriptor) {
      return {
        descriptor, device,
        async getCompilationInfo() {
          state.compileCalls++;
          const gate = state.compilation;
          state.compilation = null;
          return gate ? gate.promise : { messages: [] };
        }
      };
    },
    createComputePipeline(descriptor) {
      assert.equal(descriptor.compute.module.device, device, 'Shader belongs to the active device');
      const pipeline = {
        descriptor, device,
        getBindGroupLayout(index) { return { pipeline, index, device }; }
      };
      state.pipelines.push(pipeline);
      return pipeline;
    },
    createBindGroup(descriptor) {
      assert.equal(descriptor.layout.device, device, 'A replacement device must not reuse an old pipeline layout');
      for (const { resource } of descriptor.entries) {
        assert.equal((resource.buffer || resource).device, device, 'A binding belongs to the active device');
      }
      const bind = { descriptor, device };
      state.bindGroups.push(bind);
      return bind;
    },
    createCommandEncoder() {
      const command = { device, passes: [] };
      return {
        beginComputePass(descriptor) {
          if (state.failEncode) throw new Error('Injected command encoding failure');
          const pass = { descriptor, pipeline: null, bind: null, dispatch: null };
          command.passes.push(pass);
          return {
            setPipeline(value) { assert.equal(value.device, device); pass.pipeline = value; },
            setBindGroup(_index, value) { assert.equal(value.device, device); pass.bind = value; },
            dispatchWorkgroups(...groups) { pass.dispatch = groups; },
            end() {}
          };
        },
        finish() { state.commands.push(command); return command; }
      };
    }
  };
  device.queue = {
    writeBuffer(buffer, offset, data) {
      assert.equal(buffer.device, device);
      assert.equal(buffer.destroyed, 0);
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      buffer.data.set(bytes, offset);
      state.writes.push(buffer.data.slice());
    },
    submit(commands) {
      if (state.failSubmit) throw new Error('Injected queue submission failure');
      for (const command of commands) assert.equal(command.device, device);
      state.submits.push(commands);
    },
    async onSubmittedWorkDone() {
      state.waits++;
      return state.completion ? state.completion.promise : undefined;
    }
  };
  return { device, state };
}

function source(device, width = 20, height = 16) {
  const view = name => ({ device, label: name });
  const level0 = view('shared level zero'), coarse = view('shared coarse range');
  const hierarchy = {
    width, height, valid: true,
    levelView(level) { if (!this.valid) throw new Error('Shared hierarchy is invalid'); return level ? coarse : level0; },
    levelForFootprint() { return 2; },
    levelInfo(level) { return { coverage: 2 ** level }; }
  };
  return {
    width, height, depthHierarchy: hierarchy, depthRangeView: view('untrusted caller alias'),
    normalView: view('G1'), albedoView: view('G0'), materialView: view('G2'),
    objectView: view('Object ID'), currentResolvedColourView: view('pre-indirect colour')
  };
}

const metadata = { roomId: 'fixture-room', deviceGeneration: 1, backendGeneration: 1, cameraRevision: 1, lightRevision: 1 };
const enabled = { enabled: true, quality: 'Medium', meta: metadata };
const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('normal frames reuse resources, pipelines and bounded bind groups without diagnostic waits', async () => {
  const { device, state } = mockDevice(), producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 }), input = source(device);
  for (let frame = 0; frame < 40; frame++) await producer.update(input, enabled);
  assert.equal(state.textures.length, 12);
  assert.equal(state.buffers.length, 1);
  assert.equal(state.pipelines.length, 4);
  assert.equal(state.bindGroups.length, 7);
  assert.equal(state.waits, 0);
  assert.equal(producer.diagnostics().resourceDiagnostics.resourceCount, 13);
  assert.equal(state.buffers[0].descriptor.size, 96);
  assert.equal(state.buffers[0].descriptor.size, SSGI.parameterBytes(20, 16, enabled).byteLength, 'Uniform allocation exactly fits the producer parameters');
  const donorCoordinates = state.textures.filter(texture => texture.descriptor.format === 'rgba32uint');
  assert.equal(donorCoordinates.length, 2);
  assert.ok(donorCoordinates.every(texture => texture.descriptor.size.depthOrArrayLayers === 2), 'Bounded eight-slot donor coordinates use two array layers');
  assert.equal(producer.snapshot.historyUsed, true);
  const trace = state.bindGroups.find(bind => /trace(?::[01])?-bind/.test(bind.descriptor.label));
  assert.equal(trace.descriptor.entries[0].resource, input.depthHierarchy.levelView(0), 'Hierarchy L0 overrides a caller alias');
  producer.close();
  assert.ok([...state.textures, ...state.buffers].every(item => item.destroyed === 1));
});

test('SM-500 scope covers exactly the four producer passes in one submission', async () => {
  const { device, state } = mockDevice(), producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 });
  const submissions = [];
  const scope = { submit(commands, info) { submissions.push({ commands, info }); device.queue.submit(commands); } };
  await producer.update(source(device), { ...enabled, performanceTimingScope: scope });
  assert.equal(submissions.length, 1);
  assert.equal(state.submits.length, 1);
  assert.equal(submissions[0].commands.length, 1);
  assert.deepEqual(submissions[0].commands[0].passes.map(pass => pass.descriptor.label.split(':').at(-1)), ['trace', 'resolve', 'compose', 'snapshot']);
  assert.equal(submissions[0].info.commandCoverage, 'complete');
  producer.close();
});

test('quality-only transitions apply the selected preset and reject prior settings history', async () => {
  const { device } = mockDevice(), producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 }), input = source(device);
  await producer.update(input, enabled);
  await producer.update(input, enabled);
  await producer.update(input, { enabled: true, quality: 'High', meta: metadata });
  assert.equal(producer.options.rays, SSGI.QUALITY_PRESETS.High.rays);
  assert.equal(producer.options.steps, SSGI.QUALITY_PRESETS.High.steps);
  assert.equal(producer.options.radius, SSGI.QUALITY_PRESETS.High.radius);
  assert.equal(producer.options.historyWeight, SSGI.QUALITY_PRESETS.High.historyWeight);
  assert.equal(producer.snapshot.historyUsed, false);
  await producer.update(input, { enabled: true, quality: 'High', meta: metadata });
  assert.equal(producer.snapshot.historyUsed, true);
  await producer.update(input, { enabled: true, quality: 'Low', meta: metadata });
  assert.equal(producer.options.enabled, false);
  assert.equal(producer.historyValid, false);
  producer.close();
});

test('transport and metadata objects do not enter the rendering-settings signature', async () => {
  const { device } = mockDevice(), producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 }), input = source(device);
  await producer.update(input, enabled);
  await producer.update(input, { ...enabled, wait: false, timestampWrites: {}, performanceTimingScope: { submit: commands => device.queue.submit(commands) } });
  assert.equal(producer.snapshot.historyUsed, true);
  assert.ok(!('meta' in producer.options));
  assert.ok(!('timestampWrites' in producer.options));
  await producer.update(input, { ...enabled, strength: .15 });
  assert.equal(producer.snapshot.historyUsed, false);
  producer.close();
});

test('resize during deferred compilation rejects stale publication and recovers on new extent', async () => {
  const { device, state } = mockDevice();
  state.compilation = deferred();
  const gate = state.compilation, producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 });
  const pending = producer.update(source(device), enabled);
  await until(() => state.compileCalls > 0, 'deferred shader compilation');
  const oldTextures = [...state.textures];
  producer.resize(32, 24);
  gate.resolve({ messages: [] });
  await assert.rejects(pending, /lifecycle|invalid/i);
  assert.equal(producer.valid, false);
  assert.equal(state.submits.length, 0);
  assert.ok(oldTextures.every(texture => texture.destroyed === 1));
  await producer.update(source(device, 32, 24), enabled);
  assert.equal(producer.valid, true);
  assert.equal(producer.snapshot.historyUsed, false);
  assert.equal(producer.diagnostics().resourceDiagnostics.resourceCount, 13);
  producer.close();
});

test('close during deferred compilation releases resources and late pipeline references', async () => {
  const { device, state } = mockDevice();
  state.compilation = deferred();
  const gate = state.compilation, producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 });
  const pending = producer.update(source(device), enabled);
  await until(() => state.compileCalls > 0, 'deferred shader compilation');
  producer.close();
  gate.resolve({ messages: [] });
  await assert.rejects(pending, /lifecycle|closed|invalid/i);
  assert.equal(producer.valid, false);
  assert.equal(state.submits.length, 0);
  assert.equal(producer.pipelines.diagnostics().count, 0);
  assert.ok([...state.textures, ...state.buffers].every(item => item.destroyed === 1));
  await assert.rejects(producer.update(source(device), enabled), /closed/i);
});

test('reset during deferred compilation cannot populate the replacement-device pipeline cache', async () => {
  const original = mockDevice('original'), replacement = mockDevice('replacement');
  original.state.compilation = deferred();
  const gate = original.state.compilation, producer = new SSGI.WebGPUSSGI({ device: original.device, width: 20, height: 16 });
  const oldCache = producer.pipelines, pending = producer.update(source(original.device), enabled);
  await until(() => original.state.compileCalls > 0, 'deferred shader compilation');
  producer.resetDevice(replacement.device);
  gate.resolve({ messages: [] });
  await assert.rejects(pending, /lifecycle|invalid/i);
  assert.notEqual(producer.pipelines, oldCache);
  assert.equal(oldCache.diagnostics().count, 0);
  await producer.update(source(replacement.device), enabled);
  assert.equal(producer.valid, true);
  assert.equal(replacement.state.pipelines.length, 4);
  assert.equal(original.state.submits.length, 0);
  assert.equal(replacement.state.submits.length, 1);
  producer.close();
});

test('concurrent update refuses a second history writer without cancelling the first', async () => {
  const { device, state } = mockDevice();
  state.compilation = deferred();
  const gate = state.compilation, producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 }), input = source(device);
  const pending = producer.update(input, enabled);
  await until(() => state.compileCalls > 0, 'deferred shader compilation');
  await assert.rejects(producer.update(input, enabled), /concurrent/i);
  gate.resolve({ messages: [] });
  await pending;
  assert.equal(producer.valid, true);
  assert.equal(producer.updateCount, 1);
  assert.equal(state.submits.length, 1);
  producer.close();
});

test('explicit invalidation during a pending queue wait cannot resurrect history', async () => {
  const { device, state } = mockDevice(), producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 }), input = source(device);
  await producer.update(input, enabled);
  state.completion = deferred();
  const pending = producer.update(input, { ...enabled, wait: true });
  await until(() => state.waits > 0, 'queue completion wait');
  producer.invalidate('editor-delete');
  state.completion.resolve();
  await assert.rejects(pending, /lifecycle|invalid/i);
  assert.equal(producer.valid, false);
  assert.equal(producer.historyValid, false);
  assert.throws(() => producer.bindings(), /invalid/i);
  state.completion = null;
  await producer.update(input, enabled);
  assert.equal(producer.snapshot.historyUsed, false);
  producer.close();
});

for (const failure of ['failSubmit', 'failEncode']) {
  test(`${failure} after a valid frame invalidates stale producer output and permits recovery`, async () => {
    const { device, state } = mockDevice(), producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 }), input = source(device);
    await producer.update(input, enabled);
    state[failure] = true;
    await assert.rejects(producer.update(input, enabled), /Injected/);
    assert.equal(producer.valid, false);
    assert.equal(producer.historyValid, false);
    assert.throws(() => producer.bindings(), /invalid/i);
    state[failure] = false;
    await producer.update(input, enabled);
    assert.equal(producer.snapshot.historyUsed, false);
    producer.close();
  });
}

test('stale hierarchy and recursive colour inputs invalidate output instead of exposing an old frame', async () => {
  const { device } = mockDevice(), producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 }), input = source(device);
  await producer.update(input, enabled);
  input.depthHierarchy.valid = false;
  await assert.rejects(producer.update(input, enabled), /stale|invalid/i);
  assert.equal(producer.valid, false);
  input.depthHierarchy.valid = true;
  await producer.update(input, enabled);
  await assert.rejects(producer.update({ ...input, currentResolvedColourView: producer.bindings().composed }, enabled), /precede|composed|history/i);
  assert.equal(producer.valid, false);
  producer.close();
});

function visibilityProducer(device) {
  const state = { calls: 0, view: { device, label: 'canonical ambient visibility generation0' } };
  const producer = {
    device, width: 20, height: 16, generation: 0, valid: true, closed: false, deviceLost: false,
    bindings() { state.calls++; return { visibility: state.view, format: 'rgba16float', channels: { b: 'ambient' } }; },
    reconfigure() { this.generation++; state.view = { device, label: `canonical ambient visibility generation${this.generation}` }; }
  };
  return { producer, state };
}

test('canonical visibility view is reused by generation and rebinds only after producer reconfiguration', async () => {
  const { device, state } = mockDevice(), producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 });
  const visibility = visibilityProducer(device), input = { ...source(device), visibilityProducer: visibility.producer };
  for (let frame = 0; frame < 24; frame++) await producer.update(input, enabled);
  assert.equal(visibility.state.calls, 1, 'Stable canonical producer must not allocate a fresh view every frame');
  assert.equal(state.bindGroups.length, 7);
  visibility.producer.reconfigure();
  await producer.update(input, enabled);
  await producer.update(input, enabled);
  assert.equal(visibility.state.calls, 2);
  assert.equal(Object.keys(producer.bindCache).length, 7, 'Reconfigured views replace bounded cache entries');
  assert.ok(state.bindGroups.filter(bind => bind.descriptor.label.includes('compose:')).slice(-2)
    .every(bind => bind.descriptor.entries.some(entry => entry.resource === visibility.state.view)));
  producer.close();
});

test('canonical visibility invalidated during deferred compilation cannot be submitted', async () => {
  const { device, state } = mockDevice(); state.compilation = deferred();
  const gate = state.compilation, producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 });
  const visibility = visibilityProducer(device), input = { ...source(device), visibilityProducer: visibility.producer };
  const pending = producer.update(input, enabled);
  await until(() => state.compileCalls > 0, 'visibility deferred compilation');
  visibility.producer.valid = false;
  gate.resolve({ messages: [] });
  await assert.rejects(pending, /visibility|stale/i);
  assert.equal(state.submits.length, 0);
  assert.equal(producer.historyValid, false);
  visibility.producer.valid = true;
  await producer.update(input, enabled);
  assert.equal(producer.snapshot.historyUsed, false);
  producer.close();
});

for (const change of ['invalidate', 'reconfigure']) {
  test(`canonical visibility ${change} during a submitted queue wait clears overwritten snapshots before cold recovery`, async () => {
    const { device, state } = mockDevice(), producer = new SSGI.WebGPUSSGI({ device, width: 20, height: 16 });
    const visibility = visibilityProducer(device), input = { ...source(device), visibilityProducer: visibility.producer };
    await producer.update(input, enabled);
    await producer.update(input, enabled);
    assert.equal(producer.snapshot.historyUsed, true);
    state.completion = deferred();
    const pending = producer.update(input, { ...enabled, wait: true });
    await until(() => state.waits > 0, 'submitted visibility queue wait');
    if (change === 'invalidate') visibility.producer.valid = false;
    else visibility.producer.reconfigure();
    state.completion.resolve();
    await assert.rejects(pending, /visibility|stale|changed/i);
    assert.equal(producer.valid, false);
    assert.equal(producer.historyValid, false);
    assert.equal(producer.previousMeta, null);
    assert.throws(() => producer.bindings(), /invalid/i);
    state.completion = null;
    visibility.producer.valid = true;
    await producer.update(input, enabled);
    assert.equal(producer.snapshot.historyUsed, false, 'Overwritten snapshot textures must never reuse old history state');
    producer.close();
  });
}

test('device loss rejects output while obsolete device-loss callbacks cannot invalidate a reset device', async () => {
  const original = mockDevice('original'), replacement = mockDevice('replacement');
  const producer = new SSGI.WebGPUSSGI({ device: original.device, width: 20, height: 16 });
  await producer.update(source(original.device), enabled);
  producer.resetDevice(replacement.device);
  await producer.update(source(replacement.device), enabled);
  original.state.loss.resolve({ reason: 'destroyed', message: 'retired original' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(producer.valid, true);
  replacement.state.loss.resolve({ reason: 'unknown', message: 'active device lost' });
  await until(() => producer.deviceLost, 'active device-loss callback');
  assert.equal(producer.valid, false);
  assert.throws(() => producer.bindings(), /invalid|lost/i);
  await assert.rejects(producer.update(source(replacement.device), enabled), /lost|loss/i);
  producer.close();
});

test('shader policy embeds adopted shared validity and occupied-range helpers', async () => {
  assert.ok(SSGI.TRACE_WGSL.includes(Validity.PIXEL_VALIDITY_WGSL));
  assert.ok(SSGI.RESOLVE_WGSL.includes(Validity.PIXEL_VALIDITY_WGSL));
  assert.ok(SSGI.COMPOSE_WGSL.includes(Validity.PIXEL_VALIDITY_WGSL));
  assert.ok(SSGI.TRACE_WGSL.includes(Depth.RANGE_HELPERS_WGSL));
});

(async () => {
  const failed = [];
  for (const { name, run } of tests) {
    try { await run(); }
    catch (error) { failed.push({ name, message: error.stack || String(error) }); }
  }
  console.log(`SM-602 LIFECYCLE ${failed.length ? 'FAIL' : 'PASS'}: ${tests.length - failed.length}/${tests.length} CPU/API-ordering cases; no GPU execution`);
  for (const failure of failed) console.error(`${failure.name}\n${failure.message}`);
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
