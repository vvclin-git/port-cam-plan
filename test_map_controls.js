const test = require('node:test');
const assert = require('node:assert/strict');
const Project = require('./portcam-project');
const Core = require('./portcam-core');
const Audit = require('./portcam-coverage-audit');
const MapApi = require('./portcam-map');
const {createProjectStore} = require('./portcam-store');
const camera = {id:'a',name:'A',position:{latitudeDeg:22.6082,longitudeDeg:120.2824},heightM:20,tiltDownDeg:0,sensorWidthMm:7.2,sensorHeightMm:4.05,widthPx:2560,heightPx:1440,focalLengthMm:14,headingDeg:90};
const target = {id:'t',name:'T',position:{latitudeDeg:22.6082,longitudeDeg:120.284},lengthM:8,widthM:2,heightM:3,headingDeg:0};
const project = settings => ({schemaVersion:'camera-project/1.0',projectId:'p',name:'P',settings,cameras:[camera],targets:[target]});
const makeStore = settings => createProjectStore(project(settings),{idFactory:()=> 'generated'});

test('reference size resolves legacy height once, defaults to 2, round-trips and starts clean', () => {
  for (const [settings,expected] of [[{},2],[{planningTargetHeightM:7},7],[{planningTargetHeightM:7,pixelCoverageReferenceSizeM:3},3]]) {
    const checked=Project.validateProject(project(settings)); assert.equal(checked.ok,true);
    assert.equal(checked.value.settings.pixelCoverageReferenceSizeM,expected);
    const store=makeStore(settings); assert.equal(store.isDirty(),false); assert.equal(store.getState().history.length,0);
    store.replaceProject(JSON.parse(JSON.stringify(store.toCameraProject())));
    assert.equal(store.getState().settings.pixelCoverageReferenceSizeM,expected); assert.equal(store.isDirty(),false);
    store.patchSettings({planningTargetHeightM:9}); assert.equal(store.getState().settings.pixelCoverageReferenceSizeM,expected);
  }
});
test('invalid reference sizes and legacy heights reject atomically', () => {
  const store=makeStore({}); const before=store.toCameraProject();
  for (const invalid of [null,'2','',0,-1,NaN,Infinity,-Infinity]) {
    assert.equal(Project.validateProject(project({pixelCoverageReferenceSizeM:invalid})).ok,false);
    assert.throws(()=>store.replaceProject(project({pixelCoverageReferenceSizeM:invalid})));
    assert.throws(()=>store.patchSettings({pixelCoverageReferenceSizeM:invalid}));
    assert.equal(Project.validateProject(project({planningTargetHeightM:invalid,pixelCoverageReferenceSizeM:2})).ok,false);
    assert.deepEqual(store.toCameraProject(),before);
  }
});
test('reference size scales only pixel boundaries and preserves clipping, Scene, revisions and Observation', () => {
  const store=makeStore({planningTargetHeightM:2});
  const observation=store.getObservation('a','t');
  const scene=()=> { const result=Core.buildCameraScene(camera,{...store.getState().settings,tileZoom:10},{id:'osm',urlTemplate:'https://tile.openstreetmap.org/{z}/{x}/{y}.png'}); delete result.exportedAt; return result; };
  const audit=()=>Audit.buildCoverageAudit({...store.getState(),getObservation:store.getObservation});
  const beforeAudit=audit();
  const beforeScene=scene(); const beforeState=store.getState();
  const first=MapApi.coverageBandRanges(camera,beforeState.settings);
  store.patchSettings({pixelCoverageReferenceSizeM:4});
  const second=MapApi.coverageBandRanges(camera,store.getState().settings);
  for (let i=0;i<3;i++) assert.equal(second[i].outerM,first[i].outerM*2);
  assert.equal(second.at(-1).outerM,first.at(-1).outerM);
  assert.ok(second.at(-1).outerM<=30000);
  const clipped=MapApi.coverageBandRanges({...camera,heightM:100},{planningTargetHeightM:100,pixelCoverageReferenceSizeM:10000});
  assert.equal(clipped.at(-1).outerM,30000);
  assert.equal(clipped.length,1);
  assert.deepEqual(store.getObservation('a','t'),observation);
  assert.deepEqual(scene(),beforeScene);
  assert.deepEqual(audit(),beforeAudit);
  assert.deepEqual(store.getState().camerasById,beforeState.camerasById);
  assert.deepEqual(store.getState().targetsById,beforeState.targetsById);
  assert.equal(store.getState().history.length,1);
  assert.equal(store.patchSettings({pixelCoverageReferenceSizeM:4}),false);
  store.undo(); assert.equal(store.getState().settings.pixelCoverageReferenceSizeM,2); assert.equal(store.isDirty(),false);
  store.redo(); assert.equal(store.getState().settings.pixelCoverageReferenceSizeM,4);
  assert.deepEqual(MapApi.coverageBandRanges(camera,{planningTargetHeightM:2,pixelCoverageReferenceSizeM:0}),[]);
});
test('identity fill derives focus and preview from a single bounded preference, including zero', () => {
  for (const value of [0,0.16,0.5,1]) for (const focused of [false,true]) for (const preview of [false,true]) {
    const opacity=MapApi.cameraFillOpacity(value,focused,preview);
    assert.ok(opacity>=0 && opacity<=1);
    if(value===0) assert.equal(opacity,0);
  }
  assert.equal(MapApi.cameraFillOpacity(0.16,true,false),0.24);
  assert.equal(MapApi.cameraFillOpacity(NaN,false,false),MapApi.DEFAULT_FILL_OPACITY);
});

