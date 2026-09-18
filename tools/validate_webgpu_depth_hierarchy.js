'use strict';
const assert=require('assert');
const H=require('../engine/webgpu_depth_hierarchy.js');

const dims=H.levelDimensions(5,3);
assert.deepStrictEqual(dims.map(q=>[q.width,q.height]),[[5,3],[3,2],[2,1],[1,1]]);
assert.deepStrictEqual(dims.map(q=>q.coverage),[1,2,4,8]);
assert.strictEqual(H.FORMAT,'rg32float');
assert.deepStrictEqual([H.EMPTY_MIN,H.EMPTY_MAX],[1,0]);

const depths=[
  .9,.7,.2,.4,.8,
  .6,.5,.3,.1,.75,
  .95,.65,.45,.25,.05
];
const ids=[
  0,1,1,0,1,
  1,0,1,1,0,
  1,1,0,1,1
];
const levels=H.buildCPUHierarchy(depths,ids,5,3);
assert.strictEqual(levels.length,4);
const pair=(level,x,y)=>{const i=(y*level.width+x)*2;return [level.data[i],level.data[i+1]]};
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;
const same=(actual,expected,msg)=>{assert(near(actual[0],expected[0])&&near(actual[1],expected[1]),`${msg}: ${actual} != ${expected}`)};

same(pair(levels[0],0,0),[1,0],'empty base texel uses invalid min/max sentinel');
same(pair(levels[0],1,0),[.7,.7],'occupied base texel stores identical min/max');
same(pair(levels[1],0,0),[.6,.7],'2x2 reduction ignores empty sentinel');
same(pair(levels[1],2,0),[.8,.8],'odd right edge reduces only valid child texels');
same(pair(levels[1],2,1),[.05,.05],'odd bottom-right edge is retained');
same(pair(levels[2],0,0),[.1,.95],'coarse reduction preserves occupied min/max envelope');
same(pair(levels[3],0,0),[.05,.95],'1x1 root covers every occupied source texel');

const empty=H.buildCPUHierarchy(new Array(15).fill(.4),new Array(15).fill(0),5,3);
for(const level of empty)for(let i=0;i<level.data.length;i+=2)same([level.data[i],level.data[i+1]],[1,0],'all-empty hierarchy keeps empty sentinel');
assert.strictEqual(H.rangeOccupied([.2,.8]),true);
assert.strictEqual(H.rangeOccupied([1,0]),false);
assert.strictEqual(H.chooseLevelForFootprint(1,3),0);
assert.strictEqual(H.chooseLevelForFootprint(2,3),1);
assert.strictEqual(H.chooseLevelForFootprint(7.9,3),2);
assert.strictEqual(H.chooseLevelForFootprint(64,3),3);
assert(H.RANGE_HELPERS_WGSL.includes('smDepthRangeOccupied'));
assert(H.INIT_WGSL.includes('texture_depth_2d')&&H.INIT_WGSL.includes('texture_2d<u32>'));
assert(H.REDUCE_WGSL.includes('texture_storage_2d<rg32float,write>'));
assert(H.REDUCE_WGSL.includes('p.x>=inSize.x||p.y>=inSize.y'));
console.log('SM-203 depth hierarchy deterministic tests: PASS');
