const test = require('node:test');
const assert = require('node:assert/strict');
const {buildYoloCoverage, classifyYoloTier, classificationFor} = require('./portcam-yolo-coverage.js');

const target = {id:'target', name:'Target', position:{latitudeDeg:22.61, longitudeDeg:120.28}, lengthM:8, widthM:2.5, heightM:3};
const camera = (id, overrides = {}) => ({id, name:`Camera ${id}`, position:{latitudeDeg:22.60, longitudeDeg:120.28}, enabled:true, visible:true, ...overrides});
const observation = (visibilityState, shortSidePx, overrides = {}) => ({calculationState:'current', visibilityState, yolo:{shortSidePx, p3Cells:shortSidePx / 8, p4Cells:shortSidePx / 16, p5Cells:shortSidePx / 32}, ...overrides});

test('YOLO tier boundaries include 32, 16, and 8 px in the upper tier', () => {
  assert.equal(classifyYoloTier(32).key, 'robust');
  assert.equal(classifyYoloTier(16).key, 'usable');
  assert.equal(classifyYoloTier(8).key, 'difficult');
  assert.equal(classifyYoloTier(7.999).key, 'notRecommended');
  assert.equal(classifyYoloTier(0).key, 'notRecommended');
});

test('only visible successful Observations receive a YOLO tier', () => {
  assert.equal(classificationFor(observation('visible', 32)).tier.key, 'robust');
  assert.equal(classificationFor(observation('outside-fov', 100)).tier, null);
  assert.equal(classificationFor({calculationState:'idle', visibilityState:'unavailable', yolo:{shortSidePx:100}}).observationKey, 'unavailable');
  assert.equal(classificationFor({calculationState:'failed', visibilityState:'unknown', yolo:{shortSidePx:100}}).observationKey, 'failed');
});

test('coverage uses enabled-only ordered Camera rows, includes hidden Cameras, and aggregates classifications', () => {
  const cameras = [
    camera('robust'),
    camera('usable', {visible:false}),
    camera('difficult'),
    camera('not-recommended'),
    camera('outside'),
    camera('failed'),
    camera('draft', {lifecycle:'draft-unplaced', position:undefined}),
    camera('disabled', {enabled:false})
  ];
  const values = {
    robust: observation('visible', 32),
    usable: observation('visible', 16),
    difficult: observation('visible', 8),
    'not-recommended': observation('visible', 7.999),
    outside: observation('outside-hfov', 128),
    failed: {calculationState:'failed', visibilityState:'unknown', error:'broken'}
  };
  const calls = [];
  const result = buildYoloCoverage({cameraOrder:cameras.map(item => item.id), camerasById:cameras, currentTarget:target, getObservation:(cameraId, targetId) => { calls.push([cameraId, targetId]); return values[cameraId]; }});

  assert.equal(result.enabledCount, 7);
  assert.equal(result.disabledCount, 1);
  assert.deepEqual(calls.map(call => call[0]), ['robust','usable','difficult','not-recommended','outside','failed']);
  assert.deepEqual(result.counts, {robust:1, usable:1, difficult:1, notRecommended:1, outsideFov:1, unavailableFailed:2, unavailable:1, failed:1});
  assert.equal(result.rows.find(row => row.cameraId === 'usable').yolo.tier.key, 'usable');
  assert.equal(result.rows.find(row => row.cameraId === 'outside').yolo.tier, null);
  assert.equal(result.rows.find(row => row.cameraId === 'outside').yolo.observationLabel, 'Outside FOV');
  assert.equal(result.rows.find(row => row.cameraId === 'failed').yolo.observationLabel, 'Failed');
  assert.equal(result.rows.find(row => row.cameraId === 'draft').yolo.observationLabel, 'Unavailable');
  assert.equal(result.rows.some(row => row.cameraId === 'disabled'), false);
});

test('disabled Current Target retains enabled Camera rows as Unavailable', () => {
  const cameras = [camera('a'), camera('b', {visible:false})];
  const result = buildYoloCoverage({cameraOrder:['a','b'], camerasById:cameras, currentTarget:{...target, enabled:false}, getObservation:() => ({calculationState:'idle', visibilityState:'unavailable', reason:'disabled'})});
  assert.deepEqual(result.rows.map(row => row.yolo.observationLabel), ['Unavailable','Unavailable']);
  assert.equal(result.counts.unavailableFailed, 2);
  assert.equal(result.rows.every(row => row.yolo.tier === null), true);
});

test('derivation can reuse a Phase 4.1 comparison result without another Observation callback', () => {
  let calls = 0;
  const comparison = {
    currentTargetId: 'target', enabledCount: 1, disabledCount: 0,
    rows: [{cameraId:'a', camera:camera('a'), observation:observation('visible', 20), status:{}, rank:1, active:true}]
  };
  const result = buildYoloCoverage({comparison, getObservation:() => { calls += 1; return observation('visible', 32); }});
  assert.equal(calls, 0);
  assert.equal(result.rows[0].yolo.tier.key, 'usable');
  assert.equal(result.rows[0].active, true);
});
