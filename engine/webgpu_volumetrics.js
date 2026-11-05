'use strict';

// SM-700 reference-only scattering oracle. Not a presentation renderer.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SteelMothWebGPUVolumetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const SCHEMA = 'steelmoth-webgpu-volumetrics-reference/v1';
  const QUARTER_SCALE = 4;
  const DEFAULTS = Object.freeze({enabled: false, steps: 16, strength: 0.06, density: 0.12});
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;

  function normalizeOptions(options = {}) {
    const o = {...DEFAULTS, ...options};
    return {
      enabled: o.enabled === true,
      steps: Math.round(clamp(finite(o.steps, DEFAULTS.steps), 12, 20)),
      strength: clamp(finite(o.strength, DEFAULTS.strength), 0, 0.12),
      density: clamp(finite(o.density, DEFAULTS.density), 0, 0.3)
    };
  }

  function dimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 512 * 512) {
      throw new RangeError('SM-700 CPU reference requires positive fixture dimensions at most 262144 pixels');
    }
    return {width, height, quarterWidth: Math.ceil(width / QUARTER_SCALE), quarterHeight: Math.ceil(height / QUARTER_SCALE)};
  }

  // The SM-203 level-zero pairs are (min,max), with (1,0) denoting empty.
  // An object pixel is a blocking *macro occluder* only when the canonical
  // DSO/SM-300 classification has explicitly marked it in occluderMask.
  function occupiedAt(input, x, y) {
    if (x < 0 || y < 0 || x >= input.width || y >= input.height) return false;
    const i = y * input.width + x, a = input.depthLevel0[i * 2], b = input.depthLevel0[i * 2 + 1];
    return input.occluderMask[i] !== 0 && input.objectIds[i] !== 0 && Number.isFinite(a) && Number.isFinite(b) && a <= b;
  }

  // Supercover raster traversal avoids skipping single-pixel macro occluders
  // that a sparse 12..20 sample-only shadow ray would otherwise miss.
  function rayBlocked(input, ax, ay, bx, by) {
    let x = Math.floor(ax), y = Math.floor(ay);
    const ex = Math.floor(bx), ey = Math.floor(by);
    const dx = bx - ax, dy = by - ay;
    if (!(dx || dy)) return occupiedAt(input, x, y);
    const stepX = Math.sign(dx), stepY = Math.sign(dy);
    const deltaX = stepX ? 1 / Math.abs(dx) : Infinity;
    const deltaY = stepY ? 1 / Math.abs(dy) : Infinity;
    let tX = stepX > 0 ? (x + 1 - ax) * deltaX : stepX < 0 ? (ax - x) * deltaX : Infinity;
    let tY = stepY > 0 ? (y + 1 - ay) * deltaY : stepY < 0 ? (ay - y) * deltaY : Infinity;
    // A missing/outside source is not silently interpreted as clear space.
    if (x < 0 || y < 0 || x >= input.width || y >= input.height) return true;
    const maxCells = input.width + input.height + 2;
    for (let count = 0; count < maxCells; count++) {
      if (occupiedAt(input, x, y)) return true;
      if (x === ex && y === ey) return false;
      if (tX < tY) {x += stepX; tX += deltaX;}
      else if (tY < tX) {y += stepY; tY += deltaY;}
      else {
        // Conservative corner supercover: both edge-adjacent cells can block.
        if (occupiedAt(input, x + stepX, y) || occupiedAt(input, x, y + stepY)) return true;
        x += stepX; y += stepY; tX += deltaX; tY += deltaY;
      }
      if (x < 0 || y < 0 || x >= input.width || y >= input.height) return true;
    }
    throw new Error('SM-700 supercover ray exceeded bounded fixture traversal');
  }

  function normalizeCone(light) {
    if (!light || (light.type !== 'cone' && light.typeValue !== 1)) throw new TypeError('SM-700 requires an SM-204 normalized cone light');
    const p = light.position, d = light.direction;
    if (!p || !d || ![p[0], p[1], d[0], d[1], light.radius, light.outerCos, light.innerCos, light.intensity].every(Number.isFinite)) throw new TypeError('SM-700 cone has invalid canonical fields');
    const length = Math.hypot(d[0], d[1]);
    if (length < 1e-6 || light.radius <= 0 || light.intensity < 0 || light.innerCos <= light.outerCos) throw new RangeError('SM-700 cone geometry or intensity is invalid');
    return {x: p[0], y: p[1], dx: d[0] / length, dy: d[1] / length, radius: light.radius, intensity: light.intensity, innerCos: light.innerCos, outerCos: light.outerCos};
  }

  // Deterministic low-frequency density, constant within a coarse 16px tile;
  // not temporal noise or a second source of light/geometry authority.
  function dust(x, y) {
    let n = ((Math.floor(x / 16) * 374761393) ^ (Math.floor(y / 16) * 668265263)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return 0.75 + ((n ^ (n >>> 16)) >>> 0) / 0xffffffff * 0.5;
  }
  function smooth(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function referenceScattering(input, overrides = {}) {
    const {width, height, quarterWidth, quarterHeight} = dimensions(input?.width, input?.height);
    const options = normalizeOptions(overrides);
    const count = width * height;
    const data = new Float32Array(quarterWidth * quarterHeight);
    const blocked = new Uint8Array(data.length);
    const diagnostics = {schema: SCHEMA, enabled: options.enabled, quarterWidth, quarterHeight, integrationSteps: options.steps, sampled: 0, occluded: 0, coneRejected: 0, maxScattering: 0, outputFormat: 'r32float-reference', runtimeIntegrated: false};
    if (!options.enabled) return {width: quarterWidth, height: quarterHeight, data, blocked, diagnostics};
    if (!input.depthLevel0 || input.depthLevel0.length !== count * 2 || !input.objectIds || input.objectIds.length !== count || !input.occluderMask || input.occluderMask.length !== count || !input.dsoLightVisibility || input.dsoLightVisibility.length !== count) {
      throw new RangeError('SM-700 needs same-frame SM-203 level-zero ranges, object IDs, macro-occluder mask and per-cone DSO visibility');
    }
    const light = normalizeCone(input.playerCone);
    const rayInput = {width, height, depthLevel0: input.depthLevel0, objectIds: input.objectIds, occluderMask: input.occluderMask};
    for (let qy = 0; qy < quarterHeight; qy++) for (let qx = 0; qx < quarterWidth; qx++) {
      const px = Math.min(width - 1, qx * 4 + 2), py = Math.min(height - 1, qy * 4 + 2);
      const k = qy * quarterWidth + qx, full = py * width + px;
      const vx = px + 0.5 - light.x, vy = py + 0.5 - light.y, dist = Math.hypot(vx, vy);
      if (dist < 0.5 || dist >= light.radius || light.intensity === 0) {diagnostics.coneRejected++; continue;}
      const cosine = (vx * light.dx + vy * light.dy) / dist;
      const cone = smooth(light.outerCos, light.innerCos, cosine);
      if (cone <= 0) {diagnostics.coneRejected++; continue;}
      // Do not infer that zero DSO visibility is clear; it is complete shadow.
      const visibility = clamp(finite(input.dsoLightVisibility[full], 0), 0, 1);
      if (visibility <= 0 || rayBlocked(rayInput, light.x, light.y, px + 0.5, py + 0.5)) {
        blocked[k] = 1; diagnostics.occluded++; continue;
      }
      let density = 0;
      for (let step = 0; step < options.steps; step++) {
        const f = (step + 0.5) / options.steps;
        density += dust(light.x + vx * f, light.y + vy * f);
      }
      const fade = Math.pow(Math.max(0, 1 - dist / light.radius), 0.42);
      const value = clamp(options.strength * options.density * (density / options.steps) * cone * fade * visibility * Math.min(1, light.intensity), 0, 0.12);
      data[k] = value; diagnostics.maxScattering = Math.max(diagnostics.maxScattering, value); diagnostics.sampled++;
    }
    return {width: quarterWidth, height: quarterHeight, data, blocked, diagnostics};
  }

  return {SCHEMA, QUARTER_SCALE, DEFAULTS, normalizeOptions, rayBlocked, normalizeCone, referenceScattering};
});
