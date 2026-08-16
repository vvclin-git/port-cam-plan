/* App Shell and Store-driven DOM projection for port-cam-plan. */
(function (root, factory) {
  const api = factory(
    root.PortCamCore || (typeof require === 'function' ? require('./portcam-core.js') : null),
    root.PortCamMap || (typeof require === 'function' ? require('./portcam-map.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, MapApi) {
  'use strict';
  if (!Core) throw new Error('PortCamUI requires PortCamCore');

  const CAMERA_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#c2410c', '#15803d', '#be123c', '#a16207'];
  const TILE_PADDING = 1;
  const SENSOR_PRESETS = {
    '1/4': {w: 3.60, h: 2.03}, '1/3': {w: 4.80, h: 2.70}, '1/2.8': {w: 5.57, h: 3.13},
    '1/2.5': {w: 5.76, h: 3.24}, '1/2': {w: 6.40, h: 3.60}, '1/1.8': {w: 7.20, h: 4.05},
    '1/1.7': {w: 7.60, h: 4.28}, '2/3': {w: 8.80, h: 4.95}, '1': {w: 12.80, h: 7.20}
  };
  const RESOLUTION_PRESETS = {
    '640x480': {w: 640, h: 480}, '1280x720': {w: 1280, h: 720}, '1920x1080': {w: 1920, h: 1080},
    '2304x1296': {w: 2304, h: 1296}, '2560x1440': {w: 2560, h: 1440}, '2880x1620': {w: 2880, h: 1620},
    '3840x2160': {w: 3840, h: 2160}, '4096x2160': {w: 4096, h: 2160}
  };
  const DEFAULT_CAMERA = {
    sensorWidthMm: 7.2, sensorHeightMm: 4.05, widthPx: 2560, heightPx: 1440,
    focalLengthMm: 147.5, heightM: 20, headingDeg: 90, tiltDownDeg: 2
  };
  const tileSourceByKey = {
    osm: {id: 'osm', name: 'OpenStreetMap', type: 'xyz', urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', crs: 'EPSG:3857', tileSizePx: 256, minZoom: 0, maxZoom: 19, urlCoordinateOrder: 'z-x-y', networkRequired: true, attribution: '© OpenStreetMap contributors'},
    nlscEmap: {id: 'nlscEmap', name: 'NLSC 通用電子地圖', type: 'wmts-google-maps-compatible', urlTemplate: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', crs: 'EPSG:3857', tileMatrixSet: 'GoogleMapsCompatible', tileSizePx: 256, minZoom: 0, maxZoom: 19, urlCoordinateOrder: 'z-y-x', networkRequired: true, attribution: '© 國土測繪中心 NLSC'},
    nlscPhoto: {id: 'nlscPhoto', name: 'NLSC 正射影像', type: 'wmts-google-maps-compatible', urlTemplate: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}', crs: 'EPSG:3857', tileMatrixSet: 'GoogleMapsCompatible', tileSizePx: 256, minZoom: 0, maxZoom: 19, urlCoordinateOrder: 'z-y-x', networkRequired: true, attribution: '© 國土測繪中心 NLSC'}
  };

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function finite(value) { return Number.isFinite(Number(value)); }
  function num(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
  function fmtM(value) { if (!Number.isFinite(value)) return '∞'; return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${value.toFixed(0)} m`; }
  function fmtDeg(value) { return Number.isFinite(value) ? `${value.toFixed(2)}°` : '—'; }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[char])); }
  function cameraColor(camera, order) { return camera.color || CAMERA_COLORS[Math.max(0, order.indexOf(camera.id)) % CAMERA_COLORS.length]; }
  function defaultProject() {
    return {
      name: 'Untitled project',
      settings: {planningTargetHeightM: 2, baseMapKey: 'osm', tileZoom: 18, surfaceVisible: true, coverageTargetDimension: 'short'},
      cameras: [{id: 'camera-a', name: 'Camera A', color: CAMERA_COLORS[0], position: {latitudeDeg: 22.6082, longitudeDeg: 120.2824}, ...DEFAULT_CAMERA}],
      targets: []
    };
  }

  function createTileLayers(L, map) {
    if (!L || !L.tileLayer) return {};
    const osm = L.tileLayer(tileSourceByKey.osm.urlTemplate, {maxZoom: 19, attribution: tileSourceByKey.osm.attribution, crossOrigin: true});
    const nlscEmap = L.tileLayer(tileSourceByKey.nlscEmap.urlTemplate, {maxZoom: 19, attribution: tileSourceByKey.nlscEmap.attribution, crossOrigin: true});
    const nlscPhoto = L.tileLayer(tileSourceByKey.nlscPhoto.urlTemplate, {maxZoom: 19, attribution: tileSourceByKey.nlscPhoto.attribution, crossOrigin: true});
    return {osm, nlscEmap, nlscPhoto};
  }

  function createAppController(options) {
    const args = options || {};
    const store = args.store;
    if (!store) throw new Error('PortCamUI.createAppController requires store');
    const rootElement = args.root && args.root.nodeType ? args.root : (typeof document !== 'undefined' ? document : null);
    if (!rootElement) throw new Error('PortCamUI.createAppController requires a DOM root');
    const doc = rootElement.ownerDocument || rootElement;
    const view = doc.defaultView || (typeof window !== 'undefined' ? window : root);
    const $ = id => doc.getElementById(id);
    const L = args.leaflet || root.L;
    const map = args.map;
    const mapLayers = args.baseMapLayers || createTileLayers(L, map);
    const baseMapByKey = {osm: mapLayers.osm, nlscEmap: mapLayers.nlscEmap, nlscPhoto: mapLayers.nlscPhoto};
    const listeners = [];
    let destroyed = false;
    let activeBaseMapKey = null;
    let surfaceFeatures = [];
    let surfaceBbox = null;
    let surfaceLayer = null;
    let surfaceLoadState = 'loading';
    let lastState = null;
    let resizeObserver = null;
    let resizeTimer = null;
    let mapController = args.mapController || null;
    const labelVisibility = {camera: true, target: true};

    const els = {
      appShell: args.root && args.root.nodeType === 1 ? args.root : $('appShell'),
      cameraRailItems: $('cameraRailItems'), cameraSelect: $('cameraSelect'),
      inspector: $('inspectorPanel'), resultDrawer: $('resultDrawer'),
      inspectorContent: $('inspectorContent'), resultContent: $('contextDynamicContent'), contextTabs: $('contextInspectorTabs'),
      resultTabs: null, workspace: $('bottomWorkspace'), workspaceContent: $('workspaceContent'), workspaceTabs: $('workspaceTabs'),
      projectName: $('projectName'), dirty: $('dirtyState'), undo: $('undoButton'), redo: $('redoButton'),
      status: $('status'), mapError: $('mapError'), instruction: $('instructionBanner'), instructionText: $('instructionText'),
      mapSettingsPopover: $('mapSettingsPopover'), mapSettingsToggle: $('mapSettingsToggle'),
      baseMapSelect: $('baseMapSelect'), surfaceToggle: $('surfaceToggle'), surfaceState: $('surfaceState'), surfaceHelp: $('surfaceHelp'),
      tileZoomSelect: $('tileZoomSelect'), tileZoomHelp: $('tileZoomHelp'),
      cameraLabelsToggle: $('cameraLabelsToggle'), targetLabelsToggle: $('targetLabelsToggle'),
      targetFormError: $('targetFormError'), exportState: $('exportState'), exportError: $('exportError')
    };

    function listen(target, event, handler, options) {
      if (!target || !target.addEventListener) return;
      target.addEventListener(event, handler, options);
      listeners.push(() => target.removeEventListener(event, handler, options));
    }
    function selectedCameraId(state = store.getState()) { return state.uiState.selectedCameraId; }
    function selectedTargetId(state = store.getState()) { return state.uiState.selectedTargetId; }
    function selectedCamera(state = store.getState()) { return selectedCameraId(state) ? store.getCamera(selectedCameraId(state)) : null; }
    function selectedTarget(state = store.getState()) { return selectedTargetId(state) ? store.getTarget(selectedTargetId(state)) : null; }
    function setStatus(message) { if (els.status) els.status.textContent = message; }
    function setValue(element, value) {
      if (!element || doc.activeElement === element) return;
      element.value = value == null ? '' : String(value);
    }
    function setChecked(element, value) { if (element && doc.activeElement !== element) element.checked = Boolean(value); }
    function scheduleInvalidate() {
      if (!map || !map.invalidateSize) return;
      clearTimeout(resizeTimer);
      const frame = view.requestAnimationFrame || (callback => view.setTimeout(callback, 0));
      frame(() => { if (!destroyed) map.invalidateSize({pan: false}); });
      resizeTimer = view.setTimeout(() => { if (!destroyed) map.invalidateSize({pan: false}); }, 260);
    }
    function setPanel(panel, open) {
      if (!store.setPanelOpen) return;
      const state = store.getState();
      const narrow = Number(view.innerWidth || 1920) < 1366 || Number(view.devicePixelRatio || 1) >= 2;
      if (open && narrow && panel === 'result' && state.uiState.panelOpen.inspector) store.setPanelOpen('inspector', false);
      if (open && narrow && panel === 'inspector' && state.uiState.panelOpen.result) store.setPanelOpen('result', false);
      store.setPanelOpen(panel, open);
      scheduleInvalidate();
    }
    function openResult() { store.setInspectorTab?.('observation'); setPanel('inspector', true); }
    function closeResult() { store.setInspectorTab?.('details'); }
    function openInspector() { setPanel('inspector', true); }
    function closeInspector() { setPanel('inspector', false); }
    function renderPanelVisibility(state) {
      const panels = state.uiState.panelOpen || {};
      if (els.inspector) { els.inspector.classList.toggle('is-closed', panels.inspector === false); els.inspector.setAttribute('aria-hidden', panels.inspector === false ? 'true' : 'false'); }
      if (els.resultDrawer) { els.resultDrawer.classList.toggle('is-closed', panels.result !== true); els.resultDrawer.setAttribute('aria-hidden', panels.result === true ? 'false' : 'true'); }
      if (els.mapSettingsPopover) els.mapSettingsPopover.hidden = panels.mapSettings !== true;
      if (els.workspace) els.workspace.classList.toggle('is-open', panels.workspace === true);
      if (els.mapSettingsToggle) els.mapSettingsToggle.setAttribute('aria-expanded', panels.mapSettings === true ? 'true' : 'false');
      if ($('workspaceToggle')) { $('workspaceToggle').setAttribute('aria-expanded', panels.workspace === true ? 'true' : 'false'); $('workspaceToggle').textContent = panels.workspace === true ? 'Collapse' : 'Expand'; }
      if (els.appShell) { els.appShell.dataset.resultOpen = panels.result === true ? 'true' : 'false'; els.appShell.dataset.inspectorOpen = panels.inspector === true ? 'true' : 'false'; els.appShell.dataset.workspaceOpen = panels.workspace === true ? 'true' : 'false'; }
    }

    function renderTopBar(state) {
      if (els.projectName) els.projectName.textContent = state.name || 'Untitled project';
      if (els.dirty) { els.dirty.textContent = state.dirty ? '尚未儲存的變更' : 'Clean baseline'; els.dirty.classList.toggle('is-dirty', state.dirty); }
      if (els.undo) els.undo.disabled = !state.history || state.history.index <= 0;
      if (els.redo) els.redo.disabled = !state.history || state.history.index >= state.history.length;
    }

    function renderRail(state) {
      const managerKind = state.uiState.objectManagerTab === 'targets' ? 'targets' : 'cameras';
      Array.from($('objectManagerTabs')?.querySelectorAll?.('[data-manager-tab]') || []).forEach(tab => tab.setAttribute('aria-selected', tab.dataset.managerTab === managerKind ? 'true' : 'false'));
      setValue($('objectManagerSearch'), managerKind === 'cameras' ? state.uiState.cameraSearchQuery : state.uiState.targetSearchQuery);
      if ($('addCamera')) $('addCamera').hidden = managerKind !== 'cameras'; if ($('addTargetManager')) $('addTargetManager').hidden = managerKind !== 'targets';
      if (els.cameraRailItems) {
        els.cameraRailItems.replaceChildren();
        const kind = state.uiState.objectManagerTab === 'targets' ? 'target' : 'camera', order = kind === 'camera' ? state.cameraOrder : state.targetOrder, table = kind === 'camera' ? state.camerasById : state.targetsById, query = String(kind === 'camera' ? state.uiState.cameraSearchQuery : state.uiState.targetSearchQuery || '').toLowerCase();
        order.map(id => table[id]).filter(Boolean).filter(entity => !query || `${entity.name} ${entity.position?.latitudeDeg || ''} ${entity.position?.longitudeDeg || ''}`.toLowerCase().includes(query)).forEach(entity => {
          const item = doc.createElement('div'); item.className = 'camera-rail-item manager-row'; item.tabIndex = 0; item.setAttribute('role','button'); item.dataset.entityKind = kind; item.dataset.entityId = entity.id; item.setAttribute('aria-current', state.uiState.focusedEntity?.kind === kind && state.uiState.focusedEntity.id === entity.id ? 'true':'false');
          const color = doc.createElement('span'); color.className = 'camera-color'; color.style.backgroundColor = kind === 'camera' ? cameraColor(entity,state.cameraOrder) : '#fff'; item.appendChild(color);
          const name = doc.createElement('span'); name.className='camera-short-name'; name.textContent=entity.name||entity.id; item.appendChild(name);
          const pos = doc.createElement('span'); pos.className='rail-state'; pos.textContent=entity.position ? `${Number(entity.position.latitudeDeg).toFixed(3)}, ${Number(entity.position.longitudeDeg).toFixed(3)}` : 'Draft'; item.appendChild(pos);
          const controls = doc.createElement('span'); controls.className='rail-state'; [['visible',entity.visible!==false,entity.visible!==false?'◉':'○'],['enabled',entity.enabled!==false,entity.enabled!==false?'✓':'×'],['locked',entity.locked,entity.locked?'🔒':'🔓'],['rename',false,'Rename'],['fit',false,'Fit'],['duplicate',false,'Copy'],['delete',false,'Delete']].forEach(([action,pressed,label]) => { const b=doc.createElement('button'); b.type='button'; b.className='rail-icon'; b.textContent=label; b.dataset.entityAction=action; b.dataset.entityKind=kind; b.dataset.entityId=entity.id; b.setAttribute('aria-pressed',pressed?'true':'false'); controls.appendChild(b); }); item.appendChild(controls); els.cameraRailItems.appendChild(item);
        });
        if (!els.cameraRailItems.children.length) { const empty=doc.createElement('div'); empty.className='rail-empty'; empty.textContent=`尚無符合的 ${kind}`; els.cameraRailItems.appendChild(empty); }
        const focused = Array.from(els.cameraRailItems.querySelectorAll('[data-entity-id]')).find(item => item.dataset.entityKind === state.uiState.focusedEntity?.kind && item.dataset.entityId === state.uiState.focusedEntity?.id); focused?.scrollIntoView?.({block:'nearest'});
      }
      if (els.cameraSelect) {
        els.cameraSelect.replaceChildren();
        state.cameraOrder.forEach(id => { const option = doc.createElement('option'); option.value = id; option.textContent = state.camerasById[id]?.name || id; option.selected = id === state.uiState.selectedCameraId; els.cameraSelect.appendChild(option); });
        els.cameraSelect.disabled = !state.cameraOrder.length;
      }
    }

    function computeMetrics(camera, state) {
      if (!camera || !camera.position) return null;
      try {
        const optics = Core.computeOptics(camera);
        const horizon = Core.computePlanningHorizon(camera.heightM, state.settings.planningTargetHeightM || 2);
        const envelope = Core.computeGroundEnvelope(camera, optics, {horizonDistanceM: horizon.distanceM});
        return {optics, horizon, envelope};
      } catch (error) { return {error}; }
    }
    function syncCameraFieldValues(camera) {
      const fields = {cameraLat: camera?.position?.latitudeDeg, cameraLng: camera?.position?.longitudeDeg, sensorW: camera?.sensorWidthMm, sensorH: camera?.sensorHeightMm, resW: camera?.widthPx, resH: camera?.heightPx, focal: camera?.focalLengthMm, camHeight: camera?.heightM, heading: camera?.headingDeg, tilt: camera?.tiltDownDeg};
      Object.entries(fields).forEach(([id, value]) => setValue($(id), value));
      const locked = !camera || camera.locked === true;
      ['cameraLat', 'cameraLng', 'sensorFormat', 'sensorW', 'sensorH', 'resolutionPreset', 'resW', 'resH', 'focal', 'camHeight', 'heading', 'tilt'].forEach(id => { const element = $(id); if (element) element.disabled = locked; });
      setChecked($('cameraVisible'), camera && camera.visible !== false); setChecked($('cameraEnabled'), camera && camera.enabled !== false); setChecked($('cameraLocked'), camera && camera.locked === true);
      ['cameraVisible', 'cameraEnabled', 'cameraLocked'].forEach(id => { const element = $(id); if (element) element.disabled = !camera; });
      const sensorKey = Object.keys(SENSOR_PRESETS).find(key => camera && Math.abs(camera.sensorWidthMm - SENSOR_PRESETS[key].w) < .001 && Math.abs(camera.sensorHeightMm - SENSOR_PRESETS[key].h) < .001);
      setValue($('sensorFormat'), sensorKey || 'custom');
      const resolutionKey = Object.keys(RESOLUTION_PRESETS).find(key => camera && camera.widthPx === RESOLUTION_PRESETS[key].w && camera.heightPx === RESOLUTION_PRESETS[key].h);
      setValue($('resolutionPreset'), resolutionKey || 'custom');
      const customSensor = $('sensorFormat')?.value === 'custom'; if ($('sensorW')) $('sensorW').readOnly = !customSensor; if ($('sensorH')) $('sensorH').readOnly = !customSensor;
      const customResolution = $('resolutionPreset')?.value === 'custom'; if ($('resW')) $('resW').readOnly = !customResolution; if ($('resH')) $('resH').readOnly = !customResolution;
    }
    function renderInspector(state) {
      const camera = selectedCamera(state);
      if ($('cameraInspectorName')) $('cameraInspectorName').textContent = camera?.name || '沒有選取 Camera';
      if ($('cameraInspectorSub')) $('cameraInspectorSub').textContent = camera ? (camera.position ? 'Selected Camera' : 'Draft · 尚未定位') : '從 Rail 選取 Camera';
      if ($('cameraLifecycle')) { $('cameraLifecycle').textContent = !camera ? 'None' : camera.lifecycle === 'draft-unplaced' ? 'Draft' : camera.locked ? 'Locked' : camera.enabled === false ? 'Disabled' : 'Placed'; $('cameraLifecycle').className = `status-badge ${!camera ? '' : camera.lifecycle === 'draft-unplaced' ? 'draft' : camera.locked ? '' : camera.enabled === false ? '' : 'placed'}`; }
      syncCameraFieldValues(camera);
      const metrics = computeMetrics(camera, state);
      const metricValues = metrics && !metrics.error ? {pixelPitch: `${(metrics.optics.pixelPitchMm * 1000).toFixed(2)} µm`, hfov: fmtDeg(metrics.optics.horizontalFovDeg), vfov: fmtDeg(metrics.optics.verticalFovDeg), horizon: `${metrics.horizon.distanceKm.toFixed(2)} km`, nearR: fmtM(metrics.envelope.nearDistanceM), farR: fmtM(metrics.envelope.farDistanceM)} : {pixelPitch: '—', hfov: '—', vfov: '—', horizon: '—', nearR: '—', farR: '—'};
      Object.entries(metricValues).forEach(([id, value]) => { const element = $(id); if (element) element.textContent = value; });
      const disabled = !camera || camera.locked;
      ['relocateCamera', 'fitCamera', 'fitFov', 'resetCamera'].forEach(id => { const element = $(id); if (element) element.disabled = !camera || (id === 'relocateCamera' && camera.locked); });
      ['duplicateCamera', 'renameCamera', 'deleteCamera', 'downloadCameraScene', 'copyCameraScene'].forEach(id => { const element = $(id); if (element) element.disabled = !camera; });
      if ($('lockedHint')) $('lockedHint').textContent = camera?.locked ? 'Camera 已鎖定；先解除鎖定才能修改位置或計算參數。' : '';
      if ($('inspectorEmpty')) $('inspectorEmpty').hidden = Boolean(camera);
    }

    function targetMetricsMarkup(target) {
      return `<div class="metric-list"><div class="metric"><span>位置</span><b>${target.position ? `${Number(target.position.latitudeDeg).toFixed(6)}, ${Number(target.position.longitudeDeg).toFixed(6)}` : '尚未定位'}</b></div><div class="metric"><span>Length × width</span><b>${Number(target.lengthM || 0).toFixed(1)} × ${Number(target.widthM || 0).toFixed(1)} m</b></div><div class="metric"><span>Height</span><b>${Number(target.heightM || 0).toFixed(1)} m</b></div><div class="metric"><span>Heading</span><b>${fmtDeg(Number(target.headingDeg || 0))}</b></div><div class="metric"><span>Anchor</span><b>${escapeHtml(target.anchor || 'bottom-center')}</b></div></div>`;
    }
    function observationMarkup(camera, target, observation, state) {
      if (!observation || observation.visibilityState === 'unavailable') {
        const reason = observation?.reason === 'disabled' ? 'Camera 或 Target 已停用。' : observation?.reason === 'draft-unplaced' ? 'Camera 尚未完成定位。' : '目前沒有可用的 Camera。';
        return `<div class="result-state neutral"><strong>目前無法計算 Observation</strong>${reason}<br><span class="tiny">請啟用並完成定位後再試。</span></div>`;
      }
      if (observation.calculationState === 'failed') return `<div class="result-state red"><strong>Calculation failed</strong>${escapeHtml(observation.error || '未知計算錯誤。')}</div>`;
      const visible = observation.visibilityState === 'visible';
      const outside = observation.visibilityState === 'outside-hfov' || observation.visibilityState === 'outside-vfov' || observation.visibilityState === 'outside-fov';
      const stateMarkup = visible ? `<div class="result-state green"><strong>Target 可由目前 Camera 觀測</strong>目前落在 HFOV 與 VFOV 內。</div>` : outside ? `<div class="result-state amber"><strong>Target已建立；目前Camera無法觀測此Target</strong>原因：${observation.visibilityState === 'outside-hfov' ? '超出 HFOV' : observation.visibilityState === 'outside-vfov' ? '超出 VFOV' : '同時超出 HFOV 與 VFOV'}。這是規劃資訊，不是系統錯誤。</div>` : `<div class="result-state neutral"><strong>Observation 狀態</strong>${escapeHtml(observation.visibilityState || 'unknown')}</div>`;
      const optics = camera ? computeMetrics(camera, state)?.optics : null;
      const yolo = observation.yolo || {};
      return `${stateMarkup}<div class="result-section-title">Observation</div><div class="metric-list"><div class="metric"><span>Distance</span><b>${fmtM(observation.distanceM)}</b></div><div class="metric"><span>Azimuth</span><b>${fmtDeg(observation.azimuthDeg)}</b></div><div class="metric"><span>Horizontal relative</span><b>${fmtDeg(observation.horizontalRelativeAngleDeg)}</b></div><div class="metric"><span>Vertical relative</span><b>${fmtDeg(observation.verticalRelativeAngleDeg)}</b></div><div class="metric"><span>HFOV / VFOV</span><b>${optics ? `${fmtDeg(optics.horizontalFovDeg)} / ${fmtDeg(optics.verticalFovDeg)}` : '—'}</b></div><div class="metric"><span>Pixel size</span><b>${Number(observation.pixelWidth).toFixed(1)} × ${Number(observation.pixelHeight).toFixed(1)} px</b></div><div class="metric"><span>YOLO short side</span><b>${Number(yolo.shortSidePx || 0).toFixed(1)} px</b></div><div class="metric"><span>P3 / P4 / P5</span><b>${Number(yolo.p3Cells || 0).toFixed(2)} / ${Number(yolo.p4Cells || 0).toFixed(2)} / ${Number(yolo.p5Cells || 0).toFixed(2)}</b></div></div>`;
    }
    function renderTargetForm(target, state) {
      const position = target?.position;
      setValue($('targetLat'), position?.latitudeDeg); setValue($('targetLng'), position?.longitudeDeg); setValue($('targetLong'), target?.lengthM ?? 5); setValue($('targetShort'), target?.widthM ?? 2); setValue($('targetHeight'), target?.heightM ?? state.settings.planningTargetHeightM ?? 2); setValue($('targetHeading'), target?.headingDeg ?? 0);
      setValue($('orientation'), state.settings.coverageTargetDimension || 'short');
      ['targetLat', 'targetLng', 'targetLong', 'targetShort', 'targetHeight', 'targetHeading'].forEach(id => { const element = $(id); if (element) element.disabled = Boolean(target?.locked); });
      if ($('createTarget')) $('createTarget').disabled = Boolean(target?.locked);
      if ($('targetFormTitle')) $('targetFormTitle').textContent = target ? '編輯 selected Target' : '以座標建立 Target';
      if ($('createTarget')) $('createTarget').textContent = target ? '套用 Target 變更' : '建立 Target';
    }
    function renderResult(state) {
      const target = selectedTarget(state); const camera = selectedCamera(state);
      renderTargetForm(target, state);
      if ($('resultTitle')) $('resultTitle').textContent = target ? (target.name || 'Target') : 'Result Drawer';
      if ($('resultSub')) $('resultSub').textContent = target ? (camera ? `${camera.name || 'Camera'} · Observation` : 'Target-only') : 'Target observation';
      if (els.resultTabs) Array.from(els.resultTabs.querySelectorAll('[data-result-tab]')).forEach(tab => { tab.setAttribute('aria-selected', tab.dataset.resultTab === (state.uiState.activeResultTab || 'observation') ? 'true' : 'false'); });
      if (!els.resultContent) return;
      if (!target) {
        els.resultContent.innerHTML = '<div class="result-state neutral"><strong>尚未選取 Target</strong>請使用地圖 Place Target，或在下方輸入座標建立 Target。</div><div id="targetFormMount"></div>';
        mountTargetForm();
        return;
      }
      const observation = camera ? store.getObservation(camera.id, target.id) : null;
      const activeTab = state.uiState.activeResultTab || 'observation';
      const body = activeTab === 'target' || !camera ? `<div class="result-state neutral"><strong>${escapeHtml(target.name || 'Target')}</strong>${camera ? 'Target 資料與操作。' : '目前沒有 selected Camera；Target 仍可獨立建立與編輯。'}</div>${targetMetricsMarkup(target)}` : observationMarkup(camera, target, observation, state);
      els.resultContent.innerHTML = `${body}<div class="result-actions"><button type="button" class="action-button" id="fitTarget">Fit Target</button><button type="button" class="action-button" id="fitCameraTarget" ${camera ? '' : 'disabled'}>Fit Camera + Target</button><button type="button" class="action-button" id="renameTarget">Rename</button><button type="button" class="action-button danger" id="deleteTarget">Delete Target</button></div><div class="result-section-title">Target details</div><div id="targetFormMount"></div>`;
      mountTargetForm();
    }
    function mountTargetForm() {
      const mount = $('targetFormMount'); if (!mount) return;
      const form = $('targetFormTemplate'); if (form) mount.appendChild(form.content.cloneNode(true));
      const state = lastState || store.getState(); renderTargetForm(selectedTarget(state), state);
    }
    function targetObservationStatus(target, state) {
      const camera = selectedCamera(state);
      if (!camera) return {label: '無 selected Camera', className: 'neutral'};
      const observation = store.getObservation(camera.id, target.id);
      if (!observation || observation.visibilityState === 'unavailable') return {label: '不可用', className: 'neutral'};
      if (observation.calculationState === 'failed') return {label: '計算失敗', className: 'error'};
      if (observation.visibilityState === 'visible') return {label: 'Visible', className: 'ready'};
      if (observation.visibilityState === 'occluded') return {label: 'Occluded', className: 'draft'};
      return {label: observation.visibilityState || observation.calculationState || 'Unknown', className: 'neutral'};
    }
    function renderTargetRows(state) {
      const rows = els.workspaceContent?.querySelector('#targetRows'); if (!rows) return;
      const query = String(state.uiState.targetSearchQuery || '').trim().toLowerCase();
      const targets = state.targetOrder.map(id => state.targetsById[id]).filter(Boolean).filter(target => {
        if (!query) return true;
        const haystack = `${target.name || ''} ${target.id || ''} ${target.position?.latitudeDeg || ''} ${target.position?.longitudeDeg || ''}`.toLowerCase();
        return haystack.includes(query);
      });
      rows.replaceChildren();
      if (!targets.length) { const empty = doc.createElement('div'); empty.className = 'target-list-empty'; empty.textContent = state.targetOrder.length ? '沒有符合搜尋條件的 Target。' : '尚無 Target；可使用地圖 Place Target。'; rows.appendChild(empty); return; }
      targets.forEach(target => {
        const row = doc.createElement('div'); row.className = 'target-row'; row.dataset.targetRowId = target.id; row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-current', target.id === state.uiState.selectedTargetId ? 'true' : 'false');
        const position = target.position ? `${Number(target.position.latitudeDeg).toFixed(5)}, ${Number(target.position.longitudeDeg).toFixed(5)}` : '尚未定位';
        const observation = targetObservationStatus(target, state);
        row.innerHTML = `<div class="target-row-main"><strong>${escapeHtml(target.name || target.id)}</strong><span>${position}</span><span class="target-row-badges"><span class="status-badge ${target.visible === false ? 'neutral' : 'ready'}">${target.visible === false ? 'Hidden' : 'Visible'}</span><span class="status-badge ${target.enabled === false ? 'neutral' : 'ready'}">${target.enabled === false ? 'Disabled' : 'Enabled'}</span><span class="status-badge ${target.locked ? 'draft' : 'neutral'}">${target.locked ? 'Locked' : 'Unlocked'}</span><span class="status-badge ${observation.className}">${escapeHtml(observation.label)}</span></span></div><div class="target-row-actions"><button type="button" class="mini-button" data-target-action="visible" data-target-id="${escapeHtml(target.id)}" aria-label="${target.visible === false ? '顯示' : '隱藏'} ${escapeHtml(target.name || target.id)}">${target.visible === false ? '◌' : '◉'}</button><button type="button" class="mini-button" data-target-action="enabled" data-target-id="${escapeHtml(target.id)}" aria-label="${target.enabled === false ? '啟用' : '停用'} ${escapeHtml(target.name || target.id)}">${target.enabled === false ? '×' : '✓'}</button><button type="button" class="mini-button" data-target-action="locked" data-target-id="${escapeHtml(target.id)}" aria-label="${target.locked ? '解除鎖定' : '鎖定'} ${escapeHtml(target.name || target.id)}">${target.locked ? '🔒' : '🔓'}</button><button type="button" class="mini-button" data-target-action="rename" data-target-id="${escapeHtml(target.id)}">Rename</button><button type="button" class="mini-button" data-target-action="fit" data-target-id="${escapeHtml(target.id)}">Fit</button><button type="button" class="mini-button" data-target-action="duplicate" data-target-id="${escapeHtml(target.id)}">Copy</button><button type="button" class="mini-button danger" data-target-action="delete" data-target-id="${escapeHtml(target.id)}">Delete</button></div>`;
        rows.appendChild(row);
      });
    }
    function renderWorkspace(state) {
      if (!els.workspaceContent) return;
      const active = state.uiState.activeWorkspaceTab === 'yolo' ? 'yolo' : 'comparison';
      if (els.workspaceTabs) Array.from(els.workspaceTabs.querySelectorAll('[data-workspace-tab]')).forEach(tab => tab.setAttribute('aria-selected', tab.dataset.workspaceTab === active ? 'true' : 'false'));
      if (false) {
        if (!els.workspaceContent.querySelector('#targetListRoot')) els.workspaceContent.innerHTML = '<div id="targetListRoot" class="target-list-root"><div class="target-list-toolbar"><label for="targetSearch">Search Targets</label><input id="targetSearch" class="field-control" type="search" placeholder="名稱、ID 或座標" autocomplete="off" /></div><div id="targetRows" class="target-rows"></div></div>';
        setValue($('targetSearch'), state.uiState.targetSearchQuery || '');
        renderTargetRows(state);
        return;
      }
      const copy = {comparison: ['Camera Comparison', 'Comparison table 與排名安排在 Phase 4，Phase 3 不顯示假資料。'], yolo: ['YOLO Coverage', 'Coverage summary 與跨 Camera 分析安排在 Phase 4，Phase 3 不顯示假資料。']}[active] || ['Workspace', 'Coming next phase.'];
      els.workspaceContent.innerHTML = `<div class="empty-next"><strong>${copy[0]}</strong>${copy[1]}</div>`;
    }
    function renderMapSettings(state) {
      if (els.baseMapSelect) setValue(els.baseMapSelect, state.settings.baseMapKey || 'osm');
      if (els.surfaceToggle) { setChecked(els.surfaceToggle, state.settings.surfaceVisible !== false); els.surfaceToggle.disabled = surfaceLoadState !== 'ready'; }
      setChecked(els.cameraLabelsToggle, labelVisibility.camera); setChecked(els.targetLabelsToggle, labelVisibility.target);
      syncTileZoomOptions(state);
      if (els.surfaceState) els.surfaceState.textContent = surfaceLoadState === 'ready' ? '已載入' : surfaceLoadState === 'failed' ? '無法判定' : '載入中';
      if (els.surfaceHelp) els.surfaceHelp.textContent = surfaceLoadState === 'ready' ? '關閉視覺圖層不會停用 water／land／unknown 點擊分類。' : surfaceLoadState === 'failed' ? '請用 localhost 啟動；既有地圖與 Camera 計算仍可使用。' : '固定 GeoJSON 載入中。';
    }
    function renderContext(state) {
      const focused = state.uiState.focusedEntity, observation = state.uiState.inspectorTab === 'observation';
      if (els.contextTabs) Array.from(els.contextTabs.querySelectorAll('[data-inspector-tab]')).forEach(tab => tab.setAttribute('aria-selected', tab.dataset.inspectorTab === (observation ? 'observation' : 'details') ? 'true' : 'false'));
      const showCameraDetails = !observation && focused?.kind === 'camera';
      if (els.inspectorContent) els.inspectorContent.hidden = !showCameraDetails;
      if (els.resultContent) els.resultContent.hidden = showCameraDetails;
      if (showCameraDetails) { renderInspector(state); return; }
      const target = focused?.kind === 'target' ? state.targetsById[focused.id] : selectedTarget(state);
      const camera = selectedCamera(state);
      if ($('cameraInspectorName')) $('cameraInspectorName').textContent = observation ? 'Observation' : (target?.name || 'Target');
      if ($('cameraInspectorSub')) $('cameraInspectorSub').textContent = observation ? 'Selected Camera × Target' : 'Focused Target';
      if ($('cameraLifecycle')) { $('cameraLifecycle').textContent = observation ? 'Pairing' : target?.locked ? 'Locked' : target?.enabled === false ? 'Disabled' : 'Target'; $('cameraLifecycle').className='status-badge'; }
      renderResult({...state, uiState:{...state.uiState, activeResultTab: observation ? 'observation' : 'target'}});
    }
    function renderInteraction(state) {
      const mode = state.uiState.interactionMode;
      rootElement.querySelectorAll('[data-mode]').forEach(button => { const active = button.dataset.mode === mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active ? 'true' : 'false'); });
      if (els.instruction) { els.instruction.hidden = mode === 'navigate'; if (els.instructionText) els.instructionText.textContent = mode === 'place-camera' ? '請在地圖上點選 Camera 安裝位置；Escape 可取消。' : '請在地圖上點選 Target；完成後會開啟 Result Drawer。'; }
      if (mode === 'navigate') setStatus(surfaceLoadState === 'failed' ? 'Navigate：水陸圖資無法載入，分類結果會保留 unknown。' : 'Navigate：選取 Camera 後可拖曳未鎖定 marker。');
    }
    function syncTileZoomOptions(state) {
      if (!els.tileZoomSelect) return;
      const source = tileSourceByKey[state.settings.baseMapKey] || tileSourceByKey.osm; const current = Number(state.settings.tileZoom ?? 18); const options = [];
      for (let zoom = source.minZoom; zoom <= source.maxZoom; zoom++) { const option = doc.createElement('option'); option.value = zoom; option.textContent = `z${zoom}`; option.selected = zoom === current; options.push(option); }
      els.tileZoomSelect.replaceChildren(...options); if (els.tileZoomHelp) els.tileZoomHelp.textContent = `${source.name} · z${source.minZoom}–z${source.maxZoom}`;
    }
    function switchBaseMap(key) {
      if (!map) return;
      Object.values(baseMapByKey).forEach(layer => { if (layer && map.hasLayer && map.hasLayer(layer)) map.removeLayer(layer); });
      const next = baseMapByKey[key] || baseMapByKey.osm; if (next && next.addTo) next.addTo(map); activeBaseMapKey = key;
    }
    function syncMapBaseLayer(state) { const key = state.settings.baseMapKey || 'osm'; if (activeBaseMapKey !== key) switchBaseMap(key); }

    function pointOnSegment(point, start, end) { const [x, y] = point, [x1, y1] = start, [x2, y2] = end; const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1); if (Math.abs(cross) > 1e-10) return false; return x >= Math.min(x1, x2) - 1e-10 && x <= Math.max(x1, x2) + 1e-10 && y >= Math.min(y1, y2) - 1e-10 && y <= Math.max(y1, y2) + 1e-10; }
    function pointInRing(point, ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if (pointOnSegment(point, a, b)) return {inside: true, boundary: true}; const intersects = ((a[1] > point[1]) !== (b[1] > point[1])) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / ((b[1] - a[1]) || Number.EPSILON) + a[0]; if (intersects) inside = !inside; } return {inside, boundary: false}; }
    function pointInPolygon(point, rings) { const outer = pointInRing(point, rings[0]); if (!outer.inside) return outer; for (let i = 1; i < rings.length; i++) { const hole = pointInRing(point, rings[i]); if (hole.boundary) return {inside: true, boundary: true}; if (hole.inside) return {inside: false, boundary: false}; } return outer; }
    function pointInGeometry(point, geometry) { if (!geometry) return {inside: false, boundary: false}; if (geometry.type === 'Polygon') return pointInPolygon(point, geometry.coordinates); if (geometry.type === 'MultiPolygon') { for (const polygon of geometry.coordinates) { const result = pointInPolygon(point, polygon); if (result.inside) return result; } } return {inside: false, boundary: false}; }
    function classifySurfacePoint(lng, lat) { if (!surfaceFeatures.length) return 'unknown'; if (surfaceBbox && (lng < surfaceBbox[0] || lng > surfaceBbox[2] || lat < surfaceBbox[1] || lat > surfaceBbox[3])) return 'unknown'; let water = false, land = false; for (const feature of surfaceFeatures) { const hit = pointInGeometry([lng, lat], feature.geometry); if (hit.inside || hit.boundary) { if (feature.properties.surface === 'water') water = true; if (feature.properties.surface === 'land') land = true; } } return water ? 'water' : land ? 'land' : 'unknown'; }
    function validateSurfaceData(data) { if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Surface GeoJSON must be a FeatureCollection.'); data.features.forEach(feature => { if (!feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type) || !['water', 'land'].includes(feature.properties?.surface)) throw new Error('Surface GeoJSON contains an unsupported feature.'); }); return data; }
    function surfaceStyle(feature) { const water = feature.properties.surface === 'water'; return {color: water ? '#247ebe' : '#85745b', weight: 0.7, fillColor: water ? '#247ebe' : '#85745b', fillOpacity: water ? .38 : .2}; }
    function syncSurfaceLayer(state) { if (!surfaceLayer || !map) return; const visible = state.settings.surfaceVisible !== false; if (visible && map.addLayer && !map.hasLayer(surfaceLayer)) surfaceLayer.addTo(map); if (!visible && map.hasLayer && map.hasLayer(surfaceLayer)) map.removeLayer(surfaceLayer); }
    function loadSurface() {
      if (!map || !L || !L.geoJSON) return;
      if (map.createPane && !map.getPane('surface-pane')) { map.createPane('surface-pane'); map.getPane('surface-pane').style.zIndex = 350; }
      const fetcher = view.fetch || root.fetch;
      if (!fetcher) { surfaceLoadState = 'failed'; renderMapSettings(store.getState()); return; }
      fetcher('./data/kaohsiung-harbor-surface.geojson').then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).then(data => { validateSurfaceData(data); surfaceBbox = data.bbox; surfaceFeatures = data.features; surfaceLayer = L.geoJSON(data, {pane: 'surface-pane', interactive: false, style: surfaceStyle}); surfaceLoadState = 'ready'; syncSurfaceLayer(store.getState()); renderMapSettings(store.getState()); }).catch(error => { surfaceLoadState = 'failed'; if (els.mapError) { els.mapError.style.display = 'none'; } if (els.surfaceHelp) els.surfaceHelp.textContent = '請用 start-host.cmd 或 localhost 開啟；分類失敗會回傳 unknown。'; setStatus(`水陸圖資無法載入：${error.message || error}`); renderMapSettings(store.getState()); });
    }

    function readCameraField(field) { const element = $(field); return element ? num(element.value) : null; }
    function cameraPatchForField(field) {
      const mapFields = {sensorW: 'sensorWidthMm', sensorH: 'sensorHeightMm', resW: 'widthPx', resH: 'heightPx', focal: 'focalLengthMm', camHeight: 'heightM', heading: 'headingDeg', tilt: 'tiltDownDeg'};
      if (mapFields[field]) { const value = readCameraField(field); return value == null ? null : {[mapFields[field]]: value}; }
      if (field === 'cameraLat' || field === 'cameraLng') { const camera = selectedCamera(); const latitudeDeg = field === 'cameraLat' ? readCameraField(field) : camera?.position?.latitudeDeg; const longitudeDeg = field === 'cameraLng' ? readCameraField(field) : camera?.position?.longitudeDeg; return latitudeDeg == null || longitudeDeg == null ? null : {position: {latitudeDeg, longitudeDeg}, lifecycle: 'placed'}; }
      return null;
    }
    function commitCameraField(field) {
      const id = selectedCameraId(); if (!id) return;
      const patch = cameraPatchForField(field); if (!patch) { renderInspector(store.getState()); setStatus(`${field} 必須是有限數值。`); return; }
      const state = store.getState(); if (state.preview?.kind === 'camera' && state.preview.id === id) store.commitPreview(`camera-${field}`); else store.patchCamera(id, patch, `camera-${field}`);
    }
    function previewCameraField(field) { const id = selectedCameraId(); const patch = cameraPatchForField(field); if (id && patch) store.beginPreview('camera', id, patch); }
    function commitCameraForm() { const id = selectedCameraId(); if (!id) return; const fields = ['sensorW', 'sensorH', 'resW', 'resH', 'focal', 'camHeight', 'heading', 'tilt']; const patch = {}; fields.forEach(field => { const value = readCameraField(field); const key = {sensorW: 'sensorWidthMm', sensorH: 'sensorHeightMm', resW: 'widthPx', resH: 'heightPx', focal: 'focalLengthMm', camHeight: 'heightM', heading: 'headingDeg', tilt: 'tiltDownDeg'}[field]; if (value != null) patch[key] = value; }); if (Object.keys(patch).length) { store.cancelPreview(); store.patchCamera(id, patch, 'camera-form'); } }
    function applySensorPreset() { const key = $('sensorFormat')?.value; const preset = SENSOR_PRESETS[key]; if ($('sensorW')) { $('sensorW').readOnly = !preset; if (preset) $('sensorW').value = preset.w.toFixed(2); } if ($('sensorH')) { $('sensorH').readOnly = !preset; if (preset) $('sensorH').value = preset.h.toFixed(2); } commitCameraForm(); }
    function applyResolutionPreset() { const key = $('resolutionPreset')?.value; const preset = RESOLUTION_PRESETS[key]; if ($('resW')) { $('resW').readOnly = !preset; if (preset) $('resW').value = preset.w; } if ($('resH')) { $('resH').readOnly = !preset; if (preset) $('resH').value = preset.h; } commitCameraForm(); }
    function targetPatchForField(field) {
      const mapFields = {targetLong: 'lengthM', targetShort: 'widthM', targetHeight: 'heightM', targetHeading: 'headingDeg'};
      if (mapFields[field]) { const value = num($(field)?.value); return value == null ? null : {[mapFields[field]]: value}; }
      if (field === 'targetLat' || field === 'targetLng') { const target = selectedTarget(); const latitudeDeg = field === 'targetLat' ? num($(field)?.value) : target?.position?.latitudeDeg; const longitudeDeg = field === 'targetLng' ? num($(field)?.value) : target?.position?.longitudeDeg; return latitudeDeg == null || longitudeDeg == null ? null : {position: {latitudeDeg, longitudeDeg}}; }
      return null;
    }
    function commitTargetField(field) { const id = selectedTargetId(); if (!id) return; const patch = targetPatchForField(field); if (!patch) { setTargetError(`${field} 必須是有限數值。`); return; } const state = store.getState(); if (state.preview?.kind === 'target' && state.preview.id === id) store.commitPreview(`target-${field}`); else store.patchTarget(id, patch, `target-${field}`); if (field === 'targetHeight') store.patchSettings({planningTargetHeightM: patch.heightM}, 'target-height-setting'); }
    function previewTargetField(field) { const id = selectedTargetId(); const patch = targetPatchForField(field); if (id && patch) store.beginPreview('target', id, patch); }
    function setTargetError(message) { const targetError = els.targetFormError || $('targetFormError'); if (targetError) targetError.textContent = message || ''; }
    function createTarget(position) {
      const latitude = position ? position.lat : num($('targetLat')?.value); const longitude = position ? position.lng : num($('targetLng')?.value); const lengthM = num($('targetLong')?.value); const widthM = num($('targetShort')?.value); const heightM = num($('targetHeight')?.value); const headingDeg = num($('targetHeading')?.value);
      if (![latitude, longitude, lengthM, widthM, heightM, headingDeg].every(value => value != null)) { setTargetError('請輸入有效的 latitude、longitude、尺寸與 heading。'); return null; }
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || lengthM <= 0 || widthM <= 0 || heightM <= 0) { setTargetError('座標必須在合法範圍，尺寸必須大於 0。'); return null; }
      const state = store.getState(); const id = store.addTarget({name: `Target ${state.targetOrder.length + 1}`, position: {latitudeDeg: latitude, longitudeDeg: longitude}, lengthM, widthM, heightM, headingDeg, anchor: 'bottom-center', lifecycle: 'placed'}); store.selectTarget(id); store.setInteractionMode('navigate'); setTargetError(''); openResult(); return id;
    }
    function targetFormValuesForSelected() { return {latitudeDeg: num($('targetLat')?.value), longitudeDeg: num($('targetLng')?.value)}; }

    function handleMapClick(latlng) {
      const state = store.getState();
      if (state.uiState.interactionMode === 'place-camera') { const id = state.uiState.selectedCameraId; if (id) { store.patchCamera(id, {position: {latitudeDeg: latlng.lat, longitudeDeg: latlng.lng}, lifecycle: 'placed'}, 'camera-place'); store.setInteractionMode('navigate'); openInspector(); } return; }
      if (state.uiState.interactionMode === 'place-target') createTarget(latlng);
    }
    function handleCameraDrag(id, latlng) { store.beginPreview('camera', id, {position: {latitudeDeg: latlng.lat, longitudeDeg: latlng.lng}}); store.commitPreview('camera-drag'); }
    function handleTargetSelect(id) { store.setObjectManagerTab?.('targets'); store.setFocusedEntity?.('target', id); openInspector(); }

    if (!mapController && map && L && MapApi) mapController = MapApi.createMapController({map, leaflet: L, store, onMapClick: handleMapClick, onTargetSelect: handleTargetSelect, labelVisibility});
    if (!mapController) throw new Error('PortCamUI requires mapController or map + Leaflet');

    function selectedObservation(state) { const camera = selectedCamera(state), target = selectedTarget(state); return camera && target ? store.getObservation(camera.id, target.id) : null; }
    function buildCameraScene() {
      const state = store.getState(); const camera = selectedCamera(state); if (!camera || !camera.position) throw new Error('請先選取並定位 Camera。');
      const source = tileSourceByKey[state.settings.baseMapKey] || tileSourceByKey.osm; const zoom = Number(state.settings.tileZoom ?? 18);
      if (!Number.isInteger(zoom) || zoom < source.minZoom || zoom > source.maxZoom) throw new Error(`Tile zoom 必須介於 ${source.minZoom} 與 ${source.maxZoom}。`);
      return Core.buildCameraScene(camera, {...state.settings, planningTargetHeightM: Number(state.settings.planningTargetHeightM || 2), tileZoom: zoom, tilePadding: TILE_PADDING}, source);
    }
    function localTimestamp(date = new Date()) { const pad = value => String(value).padStart(2, '0'); return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`; }
    function setExportState(message, error) { if (els.exportState) els.exportState.textContent = message; if (els.exportError) els.exportError.textContent = error || ''; }
    function downloadScene() { try { const json = JSON.stringify(buildCameraScene(), null, 2); const timestamp = localTimestamp(); const filename = `camera-scene-${timestamp}.json`; const url = view.URL.createObjectURL(new Blob([json], {type: 'application/json'})); const link = doc.createElement('a'); link.href = url; link.download = filename; doc.body.appendChild(link); link.click(); link.remove(); view.setTimeout(() => view.URL.revokeObjectURL(url), 0); setExportState(`已下載 ${filename}。`); } catch (error) { setExportState('匯出失敗。', error.message || String(error)); } }
    async function copyScene() { try { const json = JSON.stringify(buildCameraScene(), null, 2); if (view.navigator.clipboard && view.isSecureContext) await view.navigator.clipboard.writeText(json); else { const textarea = doc.createElement('textarea'); textarea.value = json; textarea.setAttribute('readonly', ''); textarea.className = 'visually-hidden'; doc.body.appendChild(textarea); textarea.select(); if (!doc.execCommand('copy')) throw new Error('瀏覽器不允許存取剪貼簿。'); textarea.remove(); } setExportState('Camera Scene JSON 已複製。'); } catch (error) { setExportState('匯出失敗。', error.message || String(error)); } }

    function render(state) {
      if (destroyed) return;
      lastState = state; renderTopBar(state); renderPanelVisibility(state); renderRail(state); renderContext(state); renderWorkspace(state); renderMapSettings(state); renderInteraction(state); syncMapBaseLayer(state); syncSurfaceLayer(state); mapController.sync(state);
    }
    const unsubscribe = store.subscribe(render);

    function onCameraRailClick(event) {
      const action = event.target.closest?.('[data-entity-action]'), item = event.target.closest?.('[data-entity-id]');
      if (action) { event.stopPropagation(); const kind=action.dataset.entityKind, id=action.dataset.entityId, entity=kind==='camera'?store.getCamera(id):store.getTarget(id); if(!entity)return; const verb=action.dataset.entityAction; if(['visible','enabled','locked'].includes(verb)) return kind==='camera'?store.patchCamera(id,{[verb]:verb==='locked'?!entity.locked:!(entity[verb]!==false)},`${kind}-${verb}`):store.patchTarget(id,{[verb]:verb==='locked'?!entity.locked:!(entity[verb]!==false)},`${kind}-${verb}`); if(verb==='rename') { const name=view.prompt(`${kind} 名稱`,entity.name||kind); if(name&&name.trim()) return kind==='camera'?store.patchCamera(id,{name:name.trim()},`${kind}-rename`):store.patchTarget(id,{name:name.trim()},`${kind}-rename`); } if(verb==='fit') return kind==='camera'?mapController.fitCamera?.(id):mapController.fitTarget?.(id); if(verb==='duplicate') return kind==='camera'?store.duplicateCamera(id):store.duplicateTarget(id); if(verb==='delete'&&view.confirm(`刪除 ${entity.name||id}？`)) return kind==='camera'?store.removeCamera(id):store.removeTarget(id); }
      if (item) { store.cancelPreview(); store.setFocusedEntity(item.dataset.entityKind, item.dataset.entityId); openInspector(); }
    }
    function onCameraRailKeydown(event) { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-entity-id]')) { event.preventDefault(); store.cancelPreview(); store.setFocusedEntity(event.target.dataset.entityKind,event.target.dataset.entityId); openInspector(); } }
    function onResultClick(event) { const tab = event.target.closest?.('[data-result-tab]'); if (tab) { store.setActiveResultTab(tab.dataset.resultTab); return; } const id = event.target.id; const state = store.getState(); const target = selectedTarget(state); const camera = selectedCamera(state); if (id === 'closeResultDrawer') return closeResult(); if (id === 'clearTarget') { store.selectTarget(null); closeResult(); return; } if (!target) return; if (id === 'fitTarget') return mapController.fitTarget?.(target.id); if (id === 'fitCameraTarget') return camera && mapController.fitCameraAndTarget?.(camera.id, target.id); if (id === 'renameTarget') { const next = view.prompt('Target 名稱', target.name || 'Target'); if (next && next.trim()) store.patchTarget(target.id, {name: next.trim()}, 'target-rename'); return; } if (id === 'deleteTarget' && view.confirm(`刪除 ${target.name || target.id}？`)) { store.removeTarget(target.id); if (store.getState().uiState.selectedTargetId) openResult(); else closeResult(); } }
    function onInspectorClick(event) { const button = event.target.closest?.('button'); if (!button) return; const id = button.id; const state = store.getState(); const camera = selectedCamera(state); if (id === 'closeInspector') return closeInspector(); if (id === 'openResult' || id === 'openResultFromInspector') return openResult(); if (id === 'relocateCamera') { if (camera && !camera.locked) store.setInteractionMode('place-camera'); return; } if (id === 'fitCamera') return camera && mapController.fitCamera?.(camera.id); if (id === 'fitFov') return camera && mapController.fitCameraFov?.(camera.id); if (id === 'duplicateCamera') { if (camera) store.duplicateCamera(camera.id); return; } if (id === 'renameCamera') { if (camera) { const next = view.prompt('Camera 名稱', camera.name || 'Camera'); if (next && next.trim()) store.patchCamera(camera.id, {name: next.trim()}, 'camera-rename'); } return; } if (id === 'deleteCamera') { if (camera && view.confirm(`刪除 ${camera.name || camera.id}？`)) store.removeCamera(camera.id); return; } if (id === 'resetCamera') { if (camera && !camera.locked) store.patchCamera(camera.id, {...DEFAULT_CAMERA}, 'camera-reset'); return; } if (id === 'downloadCameraScene') return downloadScene(); if (id === 'copyCameraScene') return copyScene(); }
    function onShellClick(event) {
      const modeButton = event.target.closest?.('[data-mode]');
      if (modeButton) { store.setInteractionMode(modeButton.dataset.mode); return; }
      if (event.target.closest?.('#cancelPlacement')) { mapController.cancelInteraction(); return; }
      const sectionToggle = event.target.closest?.('[data-section-toggle]');
      if (sectionToggle) { const body = rootElement.querySelector(`[data-section-body="${sectionToggle.dataset.sectionToggle}"]`); const expanded = sectionToggle.getAttribute('aria-expanded') !== 'false'; sectionToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true'); if (body) body.hidden = expanded; return; }
      const managerTab = event.target.closest?.('[data-manager-tab]'); if (managerTab) { store.setObjectManagerTab(managerTab.dataset.managerTab); return; }
      const inspectorTab = event.target.closest?.('[data-inspector-tab]'); if (inspectorTab) { store.setInspectorTab(inspectorTab.dataset.inspectorTab); return; }
      const workspaceTab = event.target.closest?.('[data-workspace-tab]');
      if (workspaceTab) { store.setActiveWorkspaceTab(workspaceTab.dataset.workspaceTab); return; }
      const targetAction = event.target.closest?.('[data-target-action]');
      if (targetAction) {
        event.stopPropagation();
        const id = targetAction.dataset.targetId, target = store.getTarget(id); if (!target) return;
        const action = targetAction.dataset.targetAction;
        if (action === 'fit') return mapController.fitTarget?.(id);
        if (action === 'duplicate') { store.duplicateTarget(id); return; }
        if (action === 'delete') { if (view.confirm(`刪除 ${target.name || id}？`)) { store.removeTarget(id); if (!store.getState().uiState.selectedTargetId) closeResult(); } return; }
        if (action === 'rename') { const next = view.prompt('Target 名稱', target.name || 'Target'); if (next && next.trim()) store.patchTarget(id, {name: next.trim()}, 'target-rename'); return; }
        if (['visible', 'enabled', 'locked'].includes(action)) { store.patchTarget(id, {[action]: action === 'locked' ? !target.locked : !(target[action] !== false)}, `target-${action}`); return; }
      }
      const targetRow = event.target.closest?.('[data-target-row-id]');
      if (targetRow) { store.cancelPreview(); store.selectTarget(targetRow.dataset.targetRowId); openResult(); return; }
      if (event.target.closest?.('#workspaceToggle')) { setPanel('workspace', !(store.getState().uiState.panelOpen.workspace)); return; }
      if (event.target.closest?.('#mapSettingsToggle') || event.target.closest?.('#openProjectSettings')) { setPanel('mapSettings', !(store.getState().uiState.panelOpen.mapSettings)); return; }
      if (event.target.closest?.('#closeMapSettings')) { setPanel('mapSettings', false); return; }
    }
    function onGlobalClick(event) { if (els.mapSettingsPopover && !els.mapSettingsPopover.hidden && !event.target.closest?.('#mapSettingsAnchor')) setPanel('mapSettings', false); }
    function onKeydown(event) { if (event.key !== 'Escape') return; const state = store.getState(); if (state.uiState.interactionMode !== 'navigate') { mapController.cancelInteraction(); return; } if (state.uiState.panelOpen.mapSettings) return setPanel('mapSettings', false); if (state.uiState.panelOpen.result) return closeResult(); const narrow = Number(view.innerWidth || 1920) < 1366 || Number(view.devicePixelRatio || 1) >= 2; if (narrow && state.uiState.panelOpen.inspector) closeInspector(); }
    function onInput(event) { const element = event.target; if (element.id === 'objectManagerSearch') { const kind=store.getState().uiState.objectManagerTab === 'targets'?'target':'camera'; (kind==='camera'?store.setCameraSearchQuery:store.setTargetSearchQuery)(element.value); return; } if (element.id === 'targetSearch') { store.setTargetSearchQuery(element.value); return; } if (element.dataset.cameraField) previewCameraField(element.dataset.cameraField); if (element.dataset.targetField) previewTargetField(element.dataset.targetField); }
    function onChange(event) { const element = event.target; if (element.dataset.cameraField) commitCameraField(element.dataset.cameraField); if (element.dataset.targetField) commitTargetField(element.dataset.targetField); if (element.id === 'cameraVisible' || element.id === 'cameraEnabled' || element.id === 'cameraLocked') { const field = {cameraVisible: 'visible', cameraEnabled: 'enabled', cameraLocked: 'locked'}[element.id]; const id = selectedCameraId(); if (id) store.patchCamera(id, {[field]: element.checked}, `camera-${field}`); } if (element.id === 'sensorFormat') applySensorPreset(); if (element.id === 'resolutionPreset') applyResolutionPreset(); if (element.id === 'orientation') store.patchSettings({coverageTargetDimension: element.value}, 'coverage-dimension'); if (element.id === 'baseMapSelect') store.patchSettings({baseMapKey: element.value}, 'base-map'); if (element.id === 'surfaceToggle') store.patchSettings({surfaceVisible: element.checked}, 'surface-visibility'); if (element.id === 'tileZoomSelect') store.patchSettings({tileZoom: Number(element.value)}, 'tile-zoom'); if (element.id === 'cameraLabelsToggle') { labelVisibility.camera = element.checked; mapController.setLabelVisibility?.({camera: element.checked}); } if (element.id === 'targetLabelsToggle') { labelVisibility.target = element.checked; mapController.setLabelVisibility?.({target: element.checked}); } }
    function onBlur(event) { const element = event.target; if (element.dataset.cameraField) commitCameraField(element.dataset.cameraField); if (element.dataset.targetField) commitTargetField(element.dataset.targetField); }
    function onEnter(event) { if (event.key === 'Enter') { const element = event.target; if (element.matches?.('[data-target-row-id]')) { event.preventDefault(); store.selectTarget(element.dataset.targetRowId); openResult(); return; } if (element.dataset.cameraField) { event.preventDefault(); commitCameraField(element.dataset.cameraField); } if (element.dataset.targetField) { event.preventDefault(); commitTargetField(element.dataset.targetField); } } }
    function onFormClick(event) { if (event.target.id === 'createTarget') { const target = selectedTarget(); if (target) { const fields = ['targetLat', 'targetLng', 'targetLong', 'targetShort', 'targetHeight', 'targetHeading']; const patch = {}; fields.forEach(field => Object.assign(patch, targetPatchForField(field) || {})); store.cancelPreview(); if (Object.keys(patch).length) store.patchTarget(target.id, patch, 'target-form'); if (patch.heightM != null) store.patchSettings({planningTargetHeightM: patch.heightM}, 'target-height-setting'); setTargetError(''); openResult(); } else createTarget(); } }

    listen(els.cameraRailItems, 'click', onCameraRailClick); listen(els.cameraRailItems, 'keydown', onCameraRailKeydown); listen(els.cameraSelect, 'change', event => { store.cancelPreview(); store.selectCamera(event.target.value); });
    listen(els.inspector, 'click', onInspectorClick); listen(els.resultDrawer, 'click', onResultClick); listen(els.appShell, 'click', onShellClick); listen(els.appShell, 'click', onFormClick); listen(doc, 'click', onGlobalClick); listen(doc, 'keydown', onKeydown); listen(els.appShell, 'input', onInput); listen(els.appShell, 'change', onChange); listen(els.appShell, 'blur', onBlur, true); listen(els.appShell, 'keydown', onEnter);
    listen($('addCamera'), 'click', () => { const state = store.getState(); const id = store.addCamera({name: `Camera ${state.cameraOrder.length + 1}`, lifecycle: 'draft-unplaced', visible: true, enabled: true, locked: false, ...DEFAULT_CAMERA}); store.selectCamera(id); store.setInteractionMode('place-camera'); openInspector(); });
    listen($('addTargetManager'), 'click', () => { store.setInteractionMode('place-target'); store.setObjectManagerTab('targets'); });
    listen($('undoButton'), 'click', () => store.undo()); listen($('redoButton'), 'click', () => store.redo()); listen($('openInspector'), 'click', openInspector); listen($('openResult'), 'click', openResult); listen($('clearTarget'), 'click', () => { store.selectTarget(null); closeResult(); }); listen($('createTarget'), 'click', onFormClick); listen($('downloadCameraScene'), 'click', downloadScene); listen($('copyCameraScene'), 'click', copyScene);
    if (view.ResizeObserver) { resizeObserver = new view.ResizeObserver(scheduleInvalidate); if (els.appShell) resizeObserver.observe(els.appShell); if (els.inspector) resizeObserver.observe(els.inspector); if (els.resultDrawer) resizeObserver.observe(els.resultDrawer); }
    listen(view, 'resize', scheduleInvalidate);
    loadSurface();
    render(store.getState());
    scheduleInvalidate();

    const publicApi = {store, mapController, render, destroy() { if (destroyed) return; destroyed = true; unsubscribe(); listeners.splice(0).forEach(cleanup => cleanup()); resizeObserver?.disconnect(); clearTimeout(resizeTimer); mapController.destroy(); if (surfaceLayer && map?.hasLayer?.(surfaceLayer)) map.removeLayer(surfaceLayer); }, buildCameraScene, serializeCameraScene() { return JSON.stringify(buildCameraScene(), null, 2); }, classifySurfacePoint, pointInGeometry};
    const testWindow = view || root; testWindow.projectStoreForTest = store; testWindow.mapControllerForTest = mapController; testWindow.cameraSceneExportForTest = {buildCameraScene: publicApi.buildCameraScene, serializeCameraScene: publicApi.serializeCameraScene}; testWindow.surfaceLayerForTest = {classifySurfacePoint, pointInGeometry}; testWindow.cameraMarkerForTest = {getLatLng() { const id = selectedCameraId(); const snapshot = id && mapController.getCameraLayerSnapshot(id); return snapshot?.markerPosition && L?.latLng ? L.latLng(snapshot.markerPosition.lat, snapshot.markerPosition.lng) : snapshot?.markerPosition || null; }};
    return publicApi;
  }

  return {createAppController, defaultProject, tileSourceByKey, SENSOR_PRESETS, RESOLUTION_PRESETS};
}));
