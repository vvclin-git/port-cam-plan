const test = require('node:test');
const assert = require('node:assert/strict');
const {createProjectStore} = require('./portcam-store.js');

let sequence = 0;
const ids = () => `id-${++sequence}`;
const camera = (overrides = {}) => ({name:'A', position:{latitudeDeg:22.6082, longitudeDeg:120.2824}, heightM:20, headingDeg:0, tiltDownDeg:20, sensorWidthMm:7.2, sensorHeightMm:4.05, widthPx:2560, heightPx:1440, focalLengthMm:14, ...overrides});
const target = (overrides = {}) => ({name:'T', position:{latitudeDeg:22.61, longitudeDeg:120.2824}, lengthM:8, widthM:2.5, heightM:3, ...overrides});
function store() { return createProjectStore({name:'Test', settings:{planningTargetHeightM:2}, cameras:[camera({id:'a'}),camera({id:'b', position:{latitudeDeg:22.6,longitudeDeg:120.28}})], targets:[target({id:'t1'}),target({id:'t2'})]}, {idFactory:ids}); }

test('normalizes entities and exports only camera-project data', () => {
  const s = store(), state = s.getState(), project = s.toCameraProject();
  assert.deepEqual(state.cameraOrder, ['a','b']); assert.equal(state.uiState.selectedCameraId, 'a');
  assert.equal(project.schemaVersion, 'camera-project/1.0'); assert.equal(project.cameras.length, 2);
  assert.equal(JSON.stringify(project).includes('observationsByKey'), false); assert.equal(JSON.stringify(project).includes('uiState'), false);
});
test('camera and target selection remain independent, and deletion selects next then previous', () => {
  const s = store(); s.selectCamera('b'); s.selectTarget('t2'); s.removeCamera('b'); s.removeTarget('t2');
  assert.equal(s.getState().uiState.selectedCameraId, 'a'); assert.equal(s.getState().uiState.selectedTargetId, 't1');
  s.removeCamera('a'); assert.equal(s.getState().uiState.selectedCameraId, null);
});
test('visible/enabled are metadata while locked rejects calculation changes', () => {
  const s = store(); s.patchCamera('a', {visible:false, enabled:false});
  assert.equal(s.getState().camerasById.a.revision, 0); s.patchCamera('a', {locked:true});
  assert.equal(s.patchCamera('a', {headingDeg:32}), false); assert.equal(s.getState().camerasById.a.headingDeg, 0);
});
test('draft lifecycle has no observation until placed', () => {
  const s = store(); const id = s.addCamera(camera({lifecycle:'draft-unplaced'}));
  assert.deepEqual(s.getObservation(id, 't1').calculationState, 'idle'); assert.equal(Object.keys(s.getState().observationsByKey).length, 0); s.patchCamera(id, {lifecycle:'placed'});
  assert.equal(s.getObservation(id, 't1').calculationState, 'current');
});
test('formal interaction modes and disabled observations stay outside the cache', () => {
  const s = store(); assert.equal(s.getState().uiState.interactionMode, 'navigate');
  assert.throws(() => s.setInteractionMode('target'), /invalid interaction mode/); s.patchCamera('a', {enabled:false});
  const result = s.getObservation('a', 't1'); assert.equal(result.visibilityState, 'unavailable'); assert.equal(result.reason, 'disabled');
  assert.equal(Object.keys(s.getState().observationsByKey).length, 0);
});
test('preview is not dirty/history/revision and a committed gesture is one transaction', () => {
  const s = store(); s.markSaved(); s.beginPreview('camera','a',{headingDeg:10}); s.beginPreview('camera','a',{headingDeg:20});
  assert.equal(s.getCamera('a').headingDeg, 20); assert.equal(s.getState().camerasById.a.revision, 0); assert.equal(s.isDirty(), false);
  s.cancelPreview(); assert.equal(s.getCamera('a').headingDeg, 0); s.beginPreview('camera','a',{headingDeg:20}); s.commitPreview('drag');
  assert.equal(s.getState().camerasById.a.revision, 1); assert.equal(s.getState().history.length, 1); assert.equal(s.isDirty(), true);
  s.undo(); assert.equal(s.isDirty(), false); s.redo(); assert.equal(s.getCamera('a').headingDeg, 20);
});
test('observations are lazy, isolated, stale on relevant changes, and cleaned up', () => {
  const s = store(); const first = s.getObservation('a','t1'); assert.equal(first.calculationState, 'current');
  assert.equal(Object.keys(s.getState().observationsByKey).length, 1); s.patchCamera('b',{headingDeg:20});
  assert.equal(Object.keys(s.getState().observationsByKey).length, 1); s.patchTarget('t1',{lengthM:9});
  assert.equal(Object.keys(s.getState().observationsByKey).length, 0); const next = s.getObservation('a','t1'); assert.equal(next.targetRevision, 1);
  s.removeTarget('t1'); assert.equal(Object.keys(s.getState().observationsByKey).length, 0);
});
test('duplicate makes a separate entity and metadata-only changes make dirty without calculation revision', () => {
  const s = store(); s.markSaved(); const copy = s.duplicateCamera('a'); s.patchCamera(copy,{name:'B'});
  assert.notEqual(copy,'a'); assert.equal(s.getState().camerasById[copy].revision,0); assert.equal(s.isDirty(),true);
});
test('target duplicate copies placement and metadata but unlocks and selects the new target', () => {
  const s = store(); s.patchTarget('t1', {locked:true}); const before = s.getTarget('t1'); const copy = s.duplicateTarget('t1'); const next = s.getTarget(copy);
  assert.notEqual(copy, 't1'); assert.equal(next.name, 'T copy'); assert.deepEqual(next.position, before.position); assert.equal(next.locked, false); assert.equal(s.getState().uiState.selectedTargetId, copy);
});
test('UI-only panel and tab state does not affect project dirty state or history', () => {
  const s = store(); s.markSaved(); const before = s.getState();
  s.setPanelOpen('result', true); s.setPanelOpen('workspace', true); s.setActiveResultTab('target'); s.setActiveWorkspaceTab('comparison');
  const after = s.getState();
  assert.equal(after.uiState.panelOpen.result, true);
  assert.equal(after.uiState.panelOpen.workspace, true);
  assert.equal(after.uiState.activeResultTab, 'target');
  assert.equal(after.uiState.activeWorkspaceTab, 'comparison');
  assert.deepEqual(after.history, before.history);
  assert.equal(s.isDirty(), false);
  assert.equal(JSON.stringify(s.toCameraProject()).includes('panelOpen'), false);
  assert.throws(() => s.setPanelOpen('missing', true), /invalid panel/);
  assert.throws(() => s.setActiveResultTab('missing'), /invalid result tab/);
  assert.throws(() => s.setActiveWorkspaceTab('missing'), /invalid workspace tab/);
});
test('Target search is UI-only and remains out of project/history/dirty state', () => {
  const s = store(); s.markSaved(); const before = s.getState(); s.setTargetSearchQuery('harbor'); const after = s.getState();
  assert.equal(after.uiState.targetSearchQuery, 'harbor'); assert.deepEqual(after.history, before.history); assert.equal(after.dirty, false); assert.equal(JSON.stringify(s.toCameraProject()).includes('harbor'), false);
});
test('Object Manager focus, tabs, and independent searches stay UI-only while preserving observation pairing', () => {
  const s = store(); s.markSaved(); const before=s.getState(); s.setFocusedEntity('target','t2'); s.setObjectManagerTab('cameras'); s.setInspectorTab('observation'); s.setCameraSearchQuery('camera'); s.setTargetSearchQuery('target'); const after=s.getState();
  assert.deepEqual(after.uiState.focusedEntity,{kind:'camera',id:'a'}); assert.equal(after.uiState.selectedCameraId,'a'); assert.equal(after.uiState.selectedTargetId,'t2'); assert.equal(after.uiState.inspectorTab,'observation'); assert.equal(after.uiState.cameraSearchQuery,'camera'); assert.deepEqual(after.history,before.history); assert.equal(after.dirty,false); assert.equal(JSON.stringify(s.toCameraProject()).includes('focusedEntity'),false);
  s.setFocusedEntity('target','t2'); s.removeTarget('t2'); assert.deepEqual(s.getState().uiState.focusedEntity,{kind:'target',id:'t1'}); s.undo(); assert.equal(s.getState().uiState.focusedEntity.id,'t1');
});
