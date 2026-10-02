'use strict';

// Research-only. Nothing in the production renderer imports this module.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SteelMothGTAOCounterStudy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SCHEMA = 'steelmoth-sm601-counter-study/v1';
  const BASELINE_SHA256 = '7241992d96d014e996eb826779f2f9f6b4c3360979120d7fee780502b07f00cc';
  const FIELDS = Object.freeze(['accepted', 'rejected', 'depthRejected', 'objectRejected', 'normalRejected', 'globalRejected']);
  const MAX_PIXELS = 16777216;
  const ENTRY = '@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u){';
  const EARLY_RETURN = 'if(gid.x>=params.extent.x||gid.y>=params.extent.y){return;}';

  async function sha256(text) {
    const crypto = globalThis.crypto || (typeof require === 'function' ? require('node:crypto').webcrypto : null);
    if (!crypto?.subtle) throw new Error('SHA-256 requires Web Crypto (serve the probe on localhost).');
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
  }

  function replaceOnce(text, before, after) {
    if (text.split(before).length !== 2) throw new Error('Unexpected baseline shader structure; rebase and review the study.');
    return text.replace(before, after);
  }

  async function createCandidate(baseline) {
    if (typeof baseline !== 'string' || await sha256(baseline) !== BASELINE_SHA256) {
      throw new Error('Unsupported temporal WGSL identity; do not silently apply the study to a different shader.');
    }
    let code = baseline;
    // Only change the address of the six diagnostic increments. Pixel math stays intact.
    for (let i = 0; i < FIELDS.length; i++) {
      code = replaceOnce(code, `atomicAdd(&stats.${FIELDS[i]},1u);`, `atomicAdd(&localStats[${i}],1u);`);
    }
    code = replaceOnce(code, ENTRY,
      'var<workgroup> localStats:array<atomic<u32>,6>;\n' +
      '@compute @workgroup_size(8,8) fn cs_main(@builtin(global_invocation_id) gid:vec3u, @builtin(local_invocation_index) lane:u32){\n' +
      '  if(lane<6u){atomicStore(&localStats[lane],0u);}\n  workgroupBarrier();');
    // All 64 lanes must reach both barriers, including padded edge lanes.
    code = replaceOnce(code, EARLY_RETURN, 'if(gid.x<params.extent.x&&gid.y<params.extent.y){');
    if (!code.endsWith('\n}')) throw new Error('Unexpected entry-point suffix.');
    const flush = FIELDS.map((name, i) =>
      `  if(lane==${i}u){let n=atomicLoad(&localStats[${i}]);if(n!=0u){atomicAdd(&stats.${name},n);}}`).join('\n');
    code = code.slice(0, -2) + '\n  }\n  workgroupBarrier();\n' + flush + '\n}';
    return {schema: SCHEMA, baselineSha256: BASELINE_SHA256, candidateSha256: await sha256(code), code};
  }

  function extent(width, height) {
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 8192) || width * height > MAX_PIXELS) {
      throw new RangeError('Study extents must be positive integers <=8192 and total pixels <=16777216.');
    }
    return {width, height, pixels: width * height, groupsX: Math.ceil(width / 8), groupsY: Math.ceil(height / 8)};
  }

  // Reason ABI: 0 accepted, 1 depth, 2 object, 3 normal, 4 global (including disabled).
  function aggregateModel(width, height, reasons) {
    const e = extent(width, height);
    if (!(reasons instanceof Uint8Array) || reasons.length !== e.pixels) throw new TypeError('One Uint8 reason per active pixel is required.');
    const direct = new Uint32Array(8), grouped = new Uint32Array(8);
    let baselineStorageAtomics = 0, candidateStorageAtomics = 0;
    for (const reason of reasons) {
      if (reason > 4) throw new RangeError('Unknown rejection reason.');
      if (reason === 0) { direct[0]++; baselineStorageAtomics++; }
      else { direct[1]++; direct[reason + 1]++; baselineStorageAtomics += 2; }
    }
    for (let gy = 0; gy < e.groupsY; gy++) for (let gx = 0; gx < e.groupsX; gx++) {
      const local = new Uint32Array(6);
      for (let lane = 0; lane < 64; lane++) {
        const x = gx * 8 + lane % 8, y = gy * 8 + Math.floor(lane / 8);
        if (x >= width || y >= height) continue;
        const reason = reasons[y * width + x];
        local[reason ? 1 : 0]++;
        if (reason) local[reason + 1]++;
      }
      for (let i = 0; i < 6; i++) if (local[i]) { grouped[i] += local[i]; candidateStorageAtomics++; }
    }
    return {...e, direct: Array.from(direct), grouped: Array.from(grouped), baselineStorageAtomics,
      candidateStorageAtomics, candidateWorkgroupAtomics: baselineStorageAtomics,
      workgroupBarriers: e.groupsX * e.groupsY * 2, workgroupStorageBytes: 24,
      evidenceBoundary: 'Operation counts only; not a timing or bandwidth measurement.'};
  }

  function makeFixture(width, height, pattern = 'mixed', sequence = 0) {
    const {pixels} = extent(width, height);
    const patterns = ['accepted', 'depth', 'object', 'normal', 'global', 'mixed', 'priority', 'disabled'];
    if (!patterns.includes(pattern) || !Number.isSafeInteger(sequence) || sequence < 0) throw new RangeError('Unknown fixture pattern or sequence.');
    const input = {width, height, current: new Float32Array(pixels), previous: new Float32Array(pixels),
      currentDepth: new Float32Array(pixels * 2), previousDepth: new Float32Array(pixels * 2),
      currentObject: new Uint32Array(pixels), previousObject: new Uint32Array(pixels),
      currentNormal: new Float32Array(pixels * 4), previousNormal: new Float32Array(pixels * 4),
      previousMeta: {roomId: 'study', deviceGeneration: 1, backendGeneration: 1},
      currentMeta: {roomId: 'study', deviceGeneration: 1, backendGeneration: 1}, historyValid: true};
    const reasons = new Uint8Array(pixels);
    for (let i = 0; i < pixels; i++) {
      input.current[i] = .15 + ((i * 17 + sequence * 11) % 73) / 100;
      input.previous[i] = i % 2 ? .99 : .01; // Forces both ends of the neighborhood/delta clamp.
      input.currentDepth.set([.4, .5], i * 2); input.previousDepth.set([.4, .5], i * 2);
      input.currentObject[i] = input.previousObject[i] = 0xf0000000 + (i % 31);
      input.currentNormal.set([.5, .5, 1, .75], i * 4); input.previousNormal.set([.5, .5, 1, 0], i * 4);
      let reason = pattern === 'mixed' ? (i + sequence) % 4 : ({depth: 1, object: 2, normal: 3, global: 4, disabled: 4, priority: 2}[pattern] || 0);
      if (reason === 1 || pattern === 'priority') input.previousDepth[i * 2 + 1] = .7;
      if (reason === 2) input.previousObject[i] ^= 1;
      if (reason === 3 || pattern === 'priority') input.previousNormal.set([1, .5, .5, 0], i * 4);
      reasons[i] = reason;
    }
    if (pattern === 'global') input.currentMeta.roomId = 'other-room';
    return {input, reasons, options: {quality: pattern === 'disabled' ? 'Low' : 'Medium'}, pattern, sequence};
  }

  return {SCHEMA, BASELINE_SHA256, FIELDS, MAX_PIXELS, sha256, createCandidate, extent, aggregateModel, makeFixture};
});
