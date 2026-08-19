const test = require('node:test');
const assert = require('node:assert/strict');
const {buildCameraComparison} = require('./portcam-comparison.js');
const {createProjectStore} = require('./portcam-store.js');

const target = {id:'target', name:'Target', position:{latitudeDeg:22.61, longitudeDeg:120.28}, lengthM:8, widthM:2.5, heightM:3};
const camera = (id, overrides = {}) => ({id, name:`Camera ${id}`, position:{latitudeDeg:22.60, longitudeDeg:120.28}, enabled:true, visible:true, ...overrides});
const observation = (visibilityState, shortSidePx, distanceM, overrides = {}) => ({calculationState:'current', visibilityState, yolo:{shortSidePx}, distanceM, azimuthDeg:90, pixelWidth:40, pixelHeight:20, ...overrides});

test('comparison includes enabled Cameras only and ranks visible before outside FOV', () => {
  const cameras = [
    camera('a'),
    camera('b', {visible:false}),
    camera('c'),
    camera('d'),
    camera('e'),
    camera('disabled', {enabled:false})
  ];
  const values = {
    a: observation('visible', 20, 100),
    b: observation('outside-hfov', 100, 1),
    c: observation('visible', 40, 200),
    d: observation('visible', 40, 100),
    e: observation('visible', 40, 100)
  };
  const calls = [];
  const result = buildCameraComparison({cameraOrder:cameras.map(item => item.id), camerasById:cameras, currentTarget:target, getObservation:(cameraId, targetId) => { calls.push([cameraId, targetId]); return values[cameraId]; }});

  assert.equal(result.enabledCount, 5);
  assert.equal(result.disabledCount, 1);
  assert.deepEqual(result.rows.map(row => row.cameraId), ['d','e','c','a','b']);
  assert.deepEqual(result.rows.map(row => row.rank), [1,2,3,4,5]);
  assert.deepEqual(calls.map(call => call[0]), ['a','b','c','d','e']);
  assert.equal(result.rows.find(row => row.cameraId === 'b').status.label, 'Outside HFOV');
});

test('comparison uses distance then cameraOrder for equal YOLO short side', () => {
  const cameras = [camera('first'), camera('second'), camera('third')];
  const values = {
    first: observation('visible', 32, 100),
    second: observation('visible', 32, 80),
    third: observation('visible', 32, 80)
  };
  const result = buildCameraComparison({cameraOrder:['first','second','third'], camerasById:cameras, currentTarget:target, getObservation:id => values[id]});
  assert.deepEqual(result.rows.map(row => row.cameraId), ['second','third','first']);
  assert.deepEqual(result.rows.map(row => row.rank), [1,2,3]);
});

test('Unavailable and Failed rows have no rank and remain below successful rows', () => {
  const cameras = [camera('unavailable', {lifecycle:'draft-unplaced', position:undefined}), camera('failed'), camera('visible')];
  const result = buildCameraComparison({cameraOrder:['unavailable','failed','visible'], camerasById:cameras, currentTarget:target, getObservation:id => id === 'failed' ? observation('unknown', 0, 0, {calculationState:'failed', error:'broken'}) : observation('visible', 20, 100)});
  assert.deepEqual(result.rows.map(row => row.cameraId), ['visible','unavailable','failed']);
  assert.equal(result.rows[0].rank, 1);
  assert.equal(result.rows[1].rank, null);
  assert.equal(result.rows[1].status.label, 'Unavailable');
  assert.equal(result.rows[2].rank, null);
  assert.equal(result.rows[2].status.label, 'Failed');
});

test('comparison derivation does not alter project, history, revision, or dirty state', () => {
  const s = createProjectStore({name:'Test', settings:{planningTargetHeightM:2}, cameras:[{id:'a', name:'A', position:{latitudeDeg:22.60, longitudeDeg:120.28}, heightM:20, headingDeg:0, tiltDownDeg:1, sensorWidthMm:7.2, sensorHeightMm:4.05, widthPx:2560, heightPx:1440, focalLengthMm:14}], targets:[target]}, {idFactory:() => 'generated'});
  s.markSaved();
  const beforeProject = s.toCameraProject();
  const beforeState = s.getState();
  const result = buildCameraComparison({cameraOrder:beforeState.cameraOrder, camerasById:beforeState.camerasById, currentTarget:s.getTarget('target'), getObservation:(cameraId, targetId) => s.getObservation(cameraId, targetId)});
  const afterState = s.getState();
  assert.equal(result.rows[0].status.label, 'Visible');
  assert.deepEqual(s.toCameraProject(), beforeProject);
  assert.deepEqual(afterState.history, beforeState.history);
  assert.equal(afterState.camerasById.a.revision, beforeState.camerasById.a.revision);
  assert.equal(s.isDirty(), false);
});

test('disabled Current Target keeps enabled Camera rows unavailable', () => {
  const cameras = [camera('a'), camera('b')];
  const disabledTarget = {...target, enabled:false};
  const result = buildCameraComparison({cameraOrder:['a','b'], camerasById:cameras, currentTarget:disabledTarget, getObservation:() => ({calculationState:'idle', visibilityState:'unavailable', reason:'disabled'})});
  assert.deepEqual(result.rows.map(row => row.status.label), ['Unavailable','Unavailable']);
  assert.deepEqual(result.rows.map(row => row.rank), [null,null]);
});
