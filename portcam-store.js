/* Normalized, DOM/Leaflet-free project state for port-cam-plan. */
(function (root, factory) {
  const api = factory(root.PortCamCore || (typeof require === 'function' ? require('./portcam-core.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamStore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  if (!Core) throw new Error('PortCamStore requires PortCamCore');
  const CALCULATOR_MODEL_VERSION = Core.CALCULATOR_MODEL_VERSION || 'spherical-v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const keyFor = (cameraId, targetId) => Core.getObservationCacheKey(cameraId, targetId);
  const defaultIdFactory = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    throw new Error('crypto.randomUUID is required; inject idFactory in non-browser tests');
  };
  const isCalculationCameraField = field => !['id', 'name', 'visible', 'enabled', 'locked', 'revision', 'lifecycle'].includes(field);
  const isCalculationTargetField = field => !['id', 'name', 'visible', 'enabled', 'locked', 'revision'].includes(field);
  const nextSelection = (order, removedIndex) => order[removedIndex] || order[removedIndex - 1] || null;

  function createProjectStore(initialProject, options) {
    const opts = options || {};
    const idFactory = opts.idFactory || defaultIdFactory;
    const listeners = new Set();
    let preview = null;
    let history = [], historyIndex = 0;
    let state = normalize(initialProject || {}, idFactory);
    let baseline = canonical(state);

    function normalize(project, makeId) {
      const input = Core.buildCameraProject(project);
      const camerasById = {}, targetsById = {}, cameraOrder = [], targetOrder = [];
      input.cameras.forEach(raw => {
        const item = {...clone(raw), id: raw.id || makeId(), revision: Number(raw.revision || 0), lifecycle: raw.lifecycle || 'placed', visible: raw.visible !== false, enabled: raw.enabled !== false, locked: raw.locked === true};
        camerasById[item.id] = item; cameraOrder.push(item.id);
      });
      input.targets.forEach(raw => {
        const item = {...clone(raw), id: raw.id || makeId(), revision: Number(raw.revision || 0), visible: raw.visible !== false, enabled: raw.enabled !== false, locked: raw.locked === true};
        targetsById[item.id] = item; targetOrder.push(item.id);
      });
      return {projectId: input.projectId || makeId(), name: input.name, settings: input.settings || {}, map: input.map || null,
        camerasById, cameraOrder, targetsById, targetOrder,
        uiState: {selectedCameraId: cameraOrder[0] || null, selectedTargetId: targetOrder[0] || null, interactionMode: 'target'},
        observationsByKey: {}};
    }
    function publicState() { return clone({...state, preview: preview && clone(preview), dirty: isDirty(), history: {index: historyIndex, length: history.length}}); }
    function emit() { const snapshot = publicState(); listeners.forEach(listener => listener(snapshot)); }
    function canonical(source) {
      return Core.buildCameraProject({projectId: source.projectId, name: source.name, settings: source.settings,
        cameras: source.cameraOrder.map(id => source.camerasById[id]).filter(Boolean).map(cleanEntity),
        targets: source.targetOrder.map(id => source.targetsById[id]).filter(Boolean).map(cleanEntity), ...(source.map ? {map: source.map} : {})});
    }
    function cleanEntity(entity) { const result = clone(entity); delete result.lifecycle; return result; }
    function isDirty() { return JSON.stringify(canonical(state)) !== JSON.stringify(baseline); }
    function transaction(label, mutate) {
      const before = canonical(state);
      mutate();
      const after = canonical(state);
      if (JSON.stringify(before) === JSON.stringify(after)) return false;
      history = history.slice(0, historyIndex); history.push({label, before, after}); historyIndex = history.length;
      emit(); return true;
    }
    function restore(project) {
      const ui = state.uiState;
      const restored = normalize(project, idFactory);
      restored.uiState = ui; state = restored; preview = null;
    }
    function invalidateCamera(id) { Object.keys(state.observationsByKey).forEach(key => { if (state.observationsByKey[key].cameraId === id) delete state.observationsByKey[key]; }); }
    function invalidateTarget(id) { Object.keys(state.observationsByKey).forEach(key => { if (state.observationsByKey[key].targetId === id) delete state.observationsByKey[key]; }); }
    function addCamera(camera) { let id; transaction('camera-add', () => { id = camera && camera.id || idFactory(); const item = {...clone(camera || {}), id, revision: 0, lifecycle: camera && camera.lifecycle || 'placed', visible: !(camera && camera.visible === false), enabled: !(camera && camera.enabled === false), locked: Boolean(camera && camera.locked)}; state.camerasById[id] = item; state.cameraOrder.push(id); if (!state.uiState.selectedCameraId) state.uiState.selectedCameraId = id; }); return id; }
    function addTarget(target) { let id; transaction('target-add', () => { id = target && target.id || idFactory(); const item = {...clone(target || {}), id, revision: 0, visible: !(target && target.visible === false), enabled: !(target && target.enabled === false), locked: Boolean(target && target.locked)}; state.targetsById[id] = item; state.targetOrder.push(id); if (!state.uiState.selectedTargetId) state.uiState.selectedTargetId = id; }); return id; }
    function patchEntity(kind, id, patch, label) {
      const table = kind === 'camera' ? state.camerasById : state.targetsById; const entity = table[id]; if (!entity) throw new Error(`${kind} not found: ${id}`);
      const calc = Object.keys(patch).some(kind === 'camera' ? isCalculationCameraField : isCalculationTargetField);
      if (entity.locked && calc) return false;
      return transaction(label || `${kind}-patch`, () => { Object.assign(entity, clone(patch)); if (calc) { entity.revision += 1; kind === 'camera' ? invalidateCamera(id) : invalidateTarget(id); } });
    }
    function removeEntity(kind, id) { const table = kind === 'camera' ? state.camerasById : state.targetsById; const orderName = kind === 'camera' ? 'cameraOrder' : 'targetOrder'; if (!table[id]) return false; return transaction(`${kind}-remove`, () => { const index = state[orderName].indexOf(id); delete table[id]; state[orderName].splice(index, 1); kind === 'camera' ? invalidateCamera(id) : invalidateTarget(id); const selectionName = kind === 'camera' ? 'selectedCameraId' : 'selectedTargetId'; if (state.uiState[selectionName] === id) state.uiState[selectionName] = nextSelection(state[orderName], index); }); }
    function duplicateEntity(kind, id) { const table = kind === 'camera' ? state.camerasById : state.targetsById; const entity = table[id]; if (!entity) throw new Error(`${kind} not found: ${id}`); const copy = clone(entity); delete copy.id; copy.name = `${entity.name || kind} copy`; return kind === 'camera' ? addCamera(copy) : addTarget(copy); }
    function setSelection(kind, id) { const exists = !id || (kind === 'camera' ? state.camerasById[id] : state.targetsById[id]); if (!exists) throw new Error(`${kind} not found: ${id}`); state.uiState[kind === 'camera' ? 'selectedCameraId' : 'selectedTargetId'] = id || null; emit(); }
    function setInteractionMode(mode) { state.uiState.interactionMode = mode; emit(); }
    function beginPreview(kind, id, patch) { const entity = (kind === 'camera' ? state.camerasById : state.targetsById)[id]; if (!entity) throw new Error(`${kind} not found: ${id}`); if (entity.locked && Object.keys(patch).some(kind === 'camera' ? isCalculationCameraField : isCalculationTargetField)) return false; preview = {kind, id, patch: {...(preview && preview.kind === kind && preview.id === id ? preview.patch : {}), ...clone(patch)}}; emit(); return true; }
    function cancelPreview() { if (!preview) return; preview = null; emit(); }
    function commitPreview(label) { if (!preview) return false; const value = preview; preview = null; return patchEntity(value.kind, value.id, value.patch, label || `${value.kind}-gesture`); }
    function getEntity(kind, id, includePreview) { const value = (kind === 'camera' ? state.camerasById : state.targetsById)[id]; if (!value) return null; return includePreview !== false && preview && preview.kind === kind && preview.id === id ? {...value, ...preview.patch} : value; }
    function getObservation(cameraId, targetId, previewOptions) { const camera = getEntity('camera', cameraId, !(previewOptions && previewOptions.committedOnly)); const target = getEntity('target', targetId, !(previewOptions && previewOptions.committedOnly)); if (!camera || !target || camera.lifecycle === 'draft-unplaced') return null; const key = keyFor(cameraId, targetId); const cached = state.observationsByKey[key]; const usingPreview = Boolean(preview && ((preview.kind === 'camera' && preview.id === cameraId) || (preview.kind === 'target' && preview.id === targetId)));
      if (!usingPreview && cached && cached.cameraRevision === camera.revision && cached.targetRevision === target.revision && cached.calculatorModelVersion === CALCULATOR_MODEL_VERSION) return clone(cached);
      try { const observation = Core.computeObservation(camera, target); const entry = Core.buildObservationCacheEntry(camera, target, observation); if (!usingPreview) state.observationsByKey[key] = entry; return clone(entry); } catch (error) { const failed = {key, cameraId, targetId, cameraRevision: camera.revision, targetRevision: target.revision, calculatorModelVersion: CALCULATOR_MODEL_VERSION, generatedAt: new Date().toISOString(), calculationState: 'failed', visibilityState: 'unknown', error: error.message}; if (!usingPreview) state.observationsByKey[key] = failed; return clone(failed); }
    }
    return {getState: publicState, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, toCameraProject() { return clone(canonical(state)); }, isDirty, addCamera, addTarget, patchCamera(id, patch, label) { return patchEntity('camera', id, patch, label); }, patchTarget(id, patch, label) { return patchEntity('target', id, patch, label); }, patchSettings(patch, label) { return transaction(label || 'settings-patch', () => { Object.assign(state.settings, clone(patch)); }); }, removeCamera(id) { return removeEntity('camera', id); }, removeTarget(id) { return removeEntity('target', id); }, duplicateCamera(id) { return duplicateEntity('camera', id); }, duplicateTarget(id) { return duplicateEntity('target', id); }, selectCamera(id) { setSelection('camera', id); }, selectTarget(id) { setSelection('target', id); }, setInteractionMode, beginPreview, cancelPreview, commitPreview, getCamera(id, includePreview) { const value = getEntity('camera', id, includePreview); return value && clone(value); }, getTarget(id, includePreview) { const value = getEntity('target', id, includePreview); return value && clone(value); }, getObservation, markSaved() { baseline = canonical(state); emit(); }, undo() { if (!historyIndex) return false; restore(history[--historyIndex].before); emit(); return true; }, redo() { if (historyIndex >= history.length) return false; restore(history[historyIndex++].after); emit(); return true; }};
  }
  return {createProjectStore};
}));
