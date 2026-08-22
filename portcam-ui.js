/* App Shell and Store-driven DOM projection for port-cam-plan. */
(function (root, factory) {
  const api = factory(
    root.PortCamCore || (typeof require === 'function' ? require('./portcam-core.js') : null),
    root.PortCamMap || (typeof require === 'function' ? require('./portcam-map.js') : null),
    root.PortCamComparison || (typeof require === 'function' ? require('./portcam-comparison.js') : null),
    root.PortCamYoloCoverage || (typeof require === 'function' ? require('./portcam-yolo-coverage.js') : null),
    root.PortCamCameraDefaults || (typeof require === 'function' ? require('./portcam-camera-defaults.js') : null),
    root.PortCamCameraPresets || (typeof require === 'function' ? require('./portcam-camera-presets.js') : null),
    root.PortCamCameraPresetTransfer || (typeof require === 'function' ? require('./portcam-camera-preset-transfer.js') : null),
    root.PortCamProject || (typeof require === 'function' ? require('./portcam-project.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, MapApi, Comparison, YoloCoverage, CameraDefaults, CameraPresets, CameraPresetTransfer, Project) {
  'use strict';
  if (!Core) throw new Error('PortCamUI requires PortCamCore');
  if (!Comparison) throw new Error('PortCamUI requires PortCamComparison');
  if (!YoloCoverage) throw new Error('PortCamUI requires PortCamYoloCoverage');
  if (!CameraDefaults) throw new Error('PortCamUI requires PortCamCameraDefaults');
  if (!CameraPresets) throw new Error('PortCamUI requires PortCamCameraPresets');
  if (!CameraPresetTransfer) throw new Error('PortCamUI requires PortCamCameraPresetTransfer');
  if (!Project) throw new Error('PortCamUI requires PortCamProject');

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
    ...CameraDefaults.FACTORY_DEFAULTS, headingDeg: 90
  };
  const tileSourceByKey = {
    osm: {id: 'osm', name: 'OpenStreetMap', type: 'xyz', urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', crs: 'EPSG:3857', tileSizePx: 256, minZoom: 0, maxZoom: 19, urlCoordinateOrder: 'z-x-y', networkRequired: true, attribution: '© OpenStreetMap contributors'},
    nlscEmap: {id: 'nlscEmap', name: 'NLSC 通用電子地圖', type: 'wmts-google-maps-compatible', urlTemplate: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', crs: 'EPSG:3857', tileMatrixSet: 'GoogleMapsCompatible', tileSizePx: 256, minZoom: 0, maxZoom: 19, urlCoordinateOrder: 'z-y-x', networkRequired: true, attribution: '© 國土測繪中心 NLSC'},
    nlscPhoto: {id: 'nlscPhoto', name: 'NLSC 正射影像', type: 'wmts-google-maps-compatible', urlTemplate: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}', crs: 'EPSG:3857', tileMatrixSet: 'GoogleMapsCompatible', tileSizePx: 256, minZoom: 0, maxZoom: 19, urlCoordinateOrder: 'z-y-x', networkRequired: true, attribution: '© 國土測繪中心 NLSC'}
  };

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function finite(value) { return Number.isFinite(Number(value)); }
  function num(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
  function normalizeHeading(value) { const parsed = Number(value); if (!Number.isFinite(parsed)) return null; const wrapped = ((parsed % 360) + 360) % 360; return Math.round(wrapped * 10) / 10; }
  function fmtM(value) { if (!Number.isFinite(value)) return '∞'; return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${value.toFixed(0)} m`; }
  function fmtDeg(value) { return Number.isFinite(value) ? `${value.toFixed(2)}°` : '—'; }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[char])); }
  function cameraColor(camera, order) { return camera.color || CAMERA_COLORS[Math.max(0, order.indexOf(camera.id)) % CAMERA_COLORS.length]; }
  function newProjectId() {
    const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return `project-${cryptoObject.randomUUID()}`;
    return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function defaultProject(options) {
    const cameraDefaults = options?.cameraDefaults && CameraDefaults.validateDefaults(options.cameraDefaults).ok
      ? clone(options.cameraDefaults)
      : CameraDefaults.FACTORY_DEFAULTS;
    return {
      projectId: options?.projectId || newProjectId(),
      name: 'Untitled project',
      settings: {planningTargetHeightM: 2, baseMapKey: 'osm', tileZoom: 18, surfaceVisible: true, coverageTargetDimension: 'short'},
      cameras: [{id: 'camera-a', name: 'Camera A', color: CAMERA_COLORS[0], position: {latitudeDeg: 22.6082, longitudeDeg: 120.2824}, ...cameraDefaults, headingDeg: DEFAULT_CAMERA.headingDeg}],
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
    const cameraDefaultsRepository = args.cameraDefaultsRepository || CameraDefaults.createRepository({storage: args.cameraDefaultsStorage || null, factoryDefaults: args.cameraDefaults || CameraDefaults.FACTORY_DEFAULTS});
    const cameraPresetsRepository = args.cameraPresetsRepository || CameraPresets.createRepository({storage: args.cameraPresetsStorage || null});
    const cameraPresetCoordinator = args.cameraPresetCoordinator || CameraPresetTransfer.createCoordinator({cameraDefaultsRepository, cameraPresetsRepository});
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
    let contextRenderKey = null;
    let overflowMenu = null;
    let legendMarkupKey = null;
    let legendClampFrame = null;
    const legendPosition = {left: null, top: null};
    let legendPositionUserSet = false;
    let legendDrag = null;
    let pendingCameraPlacement = null;
    let cameraPlacementDefaultsSnapshot = null;
    let headingDrag = null;
    let projectSettingsOpen = false;
    let projectSettingsDraft = null;
    let projectSettingsSensorMode = null;
    let projectSettingsResolutionMode = null;
    let projectSettingsAccordion = {camera: true, target: false};
    let projectSettingsPresetId = CameraPresets.FACTORY_PRESET_ID;
    let inspectorPresetSelectionId = CameraPresets.FACTORY_PRESET_ID;
    let projectImportBundle = null;
    let projectImportPlan = null;
    let projectImportFileName = '';
    let projectImportMode = 'merge';
    let projectImportApplyDefaults = true;
    let projectImportRequest = 0;
    let projectSettingsRestoreFocus = null;
    let projectMenuOpen = false;
    let projectMenuRestoreFocus = null;
    let projectGuardOpen = false;
    let projectGuardRestoreFocus = null;
    let projectGuardAction = null;
    let projectRenameOpen = false;
    let projectRenameRestoreFocus = null;
    let projectOpenRequest = 0;
    const labelVisibility = {camera: true, target: true};

    const els = {
      appShell: args.root && args.root.nodeType === 1 ? args.root : $('appShell'),
      cameraRailItems: $('cameraRailItems'), cameraSelect: $('cameraSelect'),
      inspector: $('inspectorPanel'),
      inspectorContent: $('inspectorContent'), resultContent: $('contextDynamicContent'), contextTabs: $('contextInspectorTabs'),
      resultTabs: null, workspace: $('bottomWorkspace'), workspaceContent: $('workspaceContent'), workspaceTabs: $('workspaceTabs'), workspaceSummary: $('workspaceSummary'),
      mapLegend: $('mapLegend'), mapWorkspace: rootElement.querySelector?.('.map-workspace'),
      projectName: $('projectName'), dirty: $('dirtyState'), undo: $('undoButton'), redo: $('redoButton'),
      projectMenuToggle: $('projectMenuToggle'), projectMenu: $('projectMenu'), projectOpenFile: $('projectOpenFile'),
      projectGuardModal: $('projectGuardModal'), projectGuardDialog: $('projectGuardDialog'), projectGuardError: $('projectGuardError'),
      projectRenameModal: $('projectRenameModal'), projectRenameDialog: $('projectRenameDialog'), projectRenameInput: $('projectRenameInput'), projectRenameError: $('projectRenameError'),
      status: $('status'), mapError: $('mapError'), instruction: $('instructionBanner'), instructionText: $('instructionText'),
      mapSettingsPopover: $('mapSettingsPopover'), mapSettingsToggle: $('mapSettingsToggle'),
      baseMapSelect: $('baseMapSelect'), surfaceToggle: $('surfaceToggle'), surfaceState: $('surfaceState'), surfaceHelp: $('surfaceHelp'),
      tileZoomSelect: $('tileZoomSelect'), tileZoomHelp: $('tileZoomHelp'),
      cameraLabelsToggle: $('cameraLabelsToggle'), targetLabelsToggle: $('targetLabelsToggle'),
      targetFormError: $('targetFormError'), exportState: $('exportState'), exportError: $('exportError'), headingScrubber: $('headingScrubber')
      ,projectSettingsModal: $('projectSettingsModal'), projectSettingsDialog: $('projectSettingsDialog'), projectSettingsClose: $('projectSettingsClose')
      ,projectSettingsError: $('projectSettingsError'), projectSettingsStatus: $('projectSettingsStatus')
      ,projectPresetImportFile: $('projectPresetImportFile'), projectPresetImportPanel: $('projectPresetImportPanel'), projectPresetImportFileName: $('projectPresetImportFileName')
      ,projectPresetImportSummary: $('projectPresetImportSummary'), projectPresetImportMerge: $('projectPresetImportMerge'), projectPresetImportReplace: $('projectPresetImportReplace'), projectPresetImportDefaults: $('projectPresetImportDefaults'), projectPresetImportApply: $('projectPresetImportApply'), projectPresetImportCancel: $('projectPresetImportCancel'), projectPresetImportError: $('projectPresetImportError')
      ,cameraPresetSelect: $('cameraPresetSelect'), cameraPresetApply: $('cameraPresetApply'), cameraPresetStatus: $('cameraPresetStatus')
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
    function focusableIn(element) {
      return Array.from(element?.querySelectorAll?.('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])
        .filter(node => !node.hidden && node.offsetParent !== null);
    }
    function renderProjectMenu() {
      if (els.projectMenu) els.projectMenu.hidden = !projectMenuOpen;
      if (els.projectMenuToggle) els.projectMenuToggle.setAttribute('aria-expanded', projectMenuOpen ? 'true' : 'false');
    }
    function openProjectMenu() {
      projectMenuRestoreFocus = doc.activeElement;
      projectMenuOpen = true;
      renderProjectMenu();
      const first = els.projectMenu?.querySelector?.('[role="menuitem"]');
      first?.focus?.({preventScroll: true});
    }
    function closeProjectMenu({restoreFocus = true} = {}) {
      if (!projectMenuOpen) return;
      projectMenuOpen = false;
      renderProjectMenu();
      const focus = projectMenuRestoreFocus;
      projectMenuRestoreFocus = null;
      if (restoreFocus && focus?.isConnected && typeof focus.focus === 'function') focus.focus({preventScroll: true});
    }
    function openProjectGuard(action, restoreFocus) {
      projectGuardRestoreFocus = restoreFocus || doc.activeElement;
      projectGuardAction = action;
      projectGuardOpen = true;
      if (els.projectGuardError) els.projectGuardError.textContent = '';
      if (els.projectGuardModal) {
        els.projectGuardModal.hidden = false;
        els.projectGuardModal.setAttribute('aria-hidden', 'false');
      }
      const first = els.projectGuardDialog?.querySelector?.('#projectGuardSave') || els.projectGuardDialog?.querySelector?.('button:not([disabled])');
      first?.focus?.({preventScroll: true});
    }
    function closeProjectGuard({restoreFocus = true} = {}) {
      if (!projectGuardOpen) return;
      projectGuardOpen = false;
      projectGuardAction = null;
      if (els.projectGuardModal) {
        els.projectGuardModal.hidden = true;
        els.projectGuardModal.setAttribute('aria-hidden', 'true');
      }
      const focus = projectGuardRestoreFocus;
      projectGuardRestoreFocus = null;
      if (restoreFocus && focus?.isConnected && typeof focus.focus === 'function') focus.focus({preventScroll: true});
    }
    function openProjectRename() {
      projectRenameRestoreFocus = doc.activeElement;
      projectRenameOpen = true;
      if (els.projectRenameInput) els.projectRenameInput.value = store.getState().name || 'Untitled project';
      if (els.projectRenameError) els.projectRenameError.textContent = '';
      if (els.projectRenameModal) {
        els.projectRenameModal.hidden = false;
        els.projectRenameModal.setAttribute('aria-hidden', 'false');
      }
      const focus = () => { els.projectRenameInput?.focus?.({preventScroll: true}); els.projectRenameInput?.select?.(); };
      (view.requestAnimationFrame || (callback => view.setTimeout(callback, 0)))(focus);
    }
    function closeProjectRename({restoreFocus = true} = {}) {
      if (!projectRenameOpen) return;
      projectRenameOpen = false;
      if (els.projectRenameModal) {
        els.projectRenameModal.hidden = true;
        els.projectRenameModal.setAttribute('aria-hidden', 'true');
      }
      const focus = projectRenameRestoreFocus;
      projectRenameRestoreFocus = null;
      if (restoreFocus && focus?.isConnected && typeof focus.focus === 'function') focus.focus({preventScroll: true});
    }
    function sanitizeProjectFilename(name) {
      const cleaned = String(name || 'Untitled project').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '');
      return `${cleaned || 'Untitled project'}.portcam.json`;
    }
    function currentMapViewport() {
      const viewport = mapController?.getViewport?.();
      if (viewport) return viewport;
      const center = map?.getCenter?.();
      const zoom = map?.getZoom?.();
      if (center && Number.isFinite(Number(zoom))) return {center: {latitudeDeg: Number(center.lat), longitudeDeg: Number(center.lng)}, zoom: Number(zoom)};
      return Project.DEFAULT_MAP;
    }
    function setMapViewport(viewport) {
      if (mapController?.setViewport?.(viewport)) return true;
      if (!map?.setView || !viewport) return false;
      map.setView([viewport.center.latitudeDeg, viewport.center.longitudeDeg], viewport.zoom, {animate: false});
      return true;
    }
    function fitProjectObjects(project) {
      const points = [...(project.cameras || []), ...(project.targets || [])].map(entity => entity.position).filter(Boolean).map(position => [position.latitudeDeg, position.longitudeDeg]);
      if (points.length && map?.fitBounds) {
        map.fitBounds(points.length === 1 ? [points[0], points[0]] : points, {padding: [48, 48], maxZoom: 15});
        return true;
      }
      return setMapViewport(Project.DEFAULT_MAP);
    }
    function applyProjectMap(project) {
      if (project.map) return setMapViewport(project.map);
      return fitProjectObjects(project);
    }
    function projectForSave() {
      store.cancelPreview();
      const candidate = Project.withMap(store.toCameraProject(), currentMapViewport());
      const checked = Project.validateProject(candidate);
      if (!checked.ok) throw new Error(checked.error.message);
      return checked.value;
    }
    function downloadProject(project, filename) {
      if (!view.Blob || !view.URL?.createObjectURL) throw new Error('瀏覽器不支援下載檔案。');
      const blob = new view.Blob([JSON.stringify(project, null, 2)], {type: 'application/json'});
      const url = view.URL.createObjectURL(blob);
      const anchor = doc.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      doc.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      view.setTimeout?.(() => view.URL.revokeObjectURL(url), 0);
    }
    async function saveProjectFile() {
      let project;
      try { project = projectForSave(); }
      catch (error) { setStatus(`Project 儲存失敗：${error.message || error}`); return false; }
      const filename = sanitizeProjectFilename(project.name);
      const hasNativePicker = typeof view.showSaveFilePicker === 'function';
      if (hasNativePicker) {
        try {
          const handle = await view.showSaveFilePicker({suggestedName: filename, types: [{description: 'PortCam Project', accept: {'application/json': ['.portcam.json', '.json']}}]});
          const writable = await handle.createWritable();
          await writable.write(JSON.stringify(project, null, 2));
          await writable.close();
          store.markSaved(project);
          setStatus(`Project 已儲存：${filename}。`);
          return true;
        } catch (error) {
          if (error?.name === 'AbortError') setStatus('已取消 Project 儲存；目前 Project 仍未儲存。');
          else setStatus(`Project 儲存失敗：${error.message || error} 原本 Project 已保留。`);
          return false;
        }
      }
      try {
        downloadProject(project, filename);
        store.markSaved(project);
        setStatus(`下載已啟動：${filename}。`);
        return true;
      } catch (error) {
        setStatus(`Project 下載失敗：${error.message || error} 原本 Project 已保留。`);
        return false;
      }
    }
    function applyOpenedProject(project) {
      try {
        cancelPlacementInteraction();
        store.replaceProject(project);
        applyProjectMap(project);
        setStatus(`已開啟 Project「${project.name}」。`);
        return true;
      } catch (error) {
        setStatus(`Project 開啟失敗：${error.message || error} 目前 Project 已保留。`);
        return false;
      }
    }
    function requestProjectChange(action) {
      closeProjectMenu({restoreFocus: false});
      if (!store.isDirty()) return Promise.resolve(action());
      openProjectGuard(action, els.projectMenuToggle);
      return Promise.resolve(false);
    }
    function createNewProject() {
      const raw = defaultProject({cameraDefaults: cameraDefaultsRepository.getDefaults(), projectId: newProjectId()});
      const project = Project.validateProject(Project.withMap(raw, Project.DEFAULT_MAP));
      if (!project.ok) { setStatus(`New Project 失敗：${project.error.message}`); return false; }
      cancelPlacementInteraction();
      store.replaceProject(project.value);
      setMapViewport(project.value.map);
      setStatus('已建立新的 Untitled project。');
      return true;
    }
    async function continueAfterGuardSave() {
      const action = projectGuardAction;
      if (!action) return;
      const saved = await saveProjectFile();
      if (!saved) {
        if (els.projectGuardError) els.projectGuardError.textContent = els.status?.textContent || 'Save 失敗；目前 Project 已保留。';
        return;
      }
      closeProjectGuard({restoreFocus: false});
      await action();
    }
    function discardAndContinueProjectChange() {
      const action = projectGuardAction;
      closeProjectGuard({restoreFocus: false});
      if (action) Promise.resolve(action());
    }
    async function handleProjectFile(file) {
      const request = ++projectOpenRequest;
      if (!file) return;
      let project;
      try {
        project = JSON.parse(await file.text());
      } catch (error) {
        setStatus(`Project 開啟失敗：檔案不是有效 JSON。${error.message || ''}`);
        return;
      }
      if (request !== projectOpenRequest) return;
      const checked = Project.validateProject(project);
      if (!checked.ok) {
        setStatus(`Project 開啟失敗：${checked.error.message} 目前 Project 已保留。`);
        return;
      }
      requestProjectChange(() => applyOpenedProject(checked.value));
    }
    async function chooseProjectFile() {
      closeProjectMenu({restoreFocus: false});
      if (typeof view.showOpenFilePicker === 'function') {
        try {
          const handles = await view.showOpenFilePicker({multiple: false, types: [{description: 'PortCam Project', accept: {'application/json': ['.portcam.json', '.json']}}]});
          if (handles?.[0]) await handleProjectFile(await handles[0].getFile());
        } catch (error) {
          if (error?.name === 'AbortError') setStatus('已取消開啟 Project。');
          else setStatus(`Project 開啟失敗：${error.message || error} 目前 Project 已保留。`);
        }
        return;
      }
      if (els.projectOpenFile) { els.projectOpenFile.value = ''; els.projectOpenFile.click(); }
    }
    function renameProjectFromDialog() {
      const value = String(els.projectRenameInput?.value || '').trim();
      if (!value) { if (els.projectRenameError) els.projectRenameError.textContent = 'Project name 不可為空。'; return false; }
      try {
        const changed = store.renameProject(value);
        closeProjectRename();
        setStatus(changed ? `Project 已重新命名為「${value}」。` : 'Project name 未變更。');
        return true;
      } catch (error) {
        if (els.projectRenameError) els.projectRenameError.textContent = error.message || String(error);
        return false;
      }
    }
    function onBeforeUnload(event) {
      if (!store.isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    }
    const projectSettingsFieldMap = {
      projectCameraHeight: 'heightM', projectCameraTilt: 'tiltDownDeg', projectSensorW: 'sensorWidthMm', projectSensorH: 'sensorHeightMm',
      projectResW: 'widthPx', projectResH: 'heightPx', projectFocal: 'focalLengthMm'
    };
    function cameraDefaultsFromCamera(camera) {
      if (!camera) return null;
      const defaults = {};
      CameraDefaults.FIELDS.forEach(field => { defaults[field] = camera[field]; });
      return defaults;
    }
    function projectSettingsDefaultsFromForm() {
      const value = {};
      Object.entries(projectSettingsFieldMap).forEach(([id, field]) => { value[field] = num($(id)?.value); });
      return value;
    }
    function sensorPresetKey(defaults) { return Object.keys(SENSOR_PRESETS).find(key => Math.abs(defaults.sensorWidthMm - SENSOR_PRESETS[key].w) < .001 && Math.abs(defaults.sensorHeightMm - SENSOR_PRESETS[key].h) < .001) || 'custom'; }
    function resolutionPresetKey(defaults) { return Object.keys(RESOLUTION_PRESETS).find(key => defaults.widthPx === RESOLUTION_PRESETS[key].w && defaults.heightPx === RESOLUTION_PRESETS[key].h) || 'custom'; }
    function syncProjectSettingsForm(defaults) {
      if (!defaults) return;
      Object.entries(projectSettingsFieldMap).forEach(([id, field]) => setValue($(id), defaults[field]));
      const sensorKey = projectSettingsSensorMode || sensorPresetKey(defaults);
      const resolutionKey = projectSettingsResolutionMode || resolutionPresetKey(defaults);
      setValue($('projectSensorFormat'), sensorKey); setValue($('projectResolutionPreset'), resolutionKey);
      const customSensor = sensorKey === 'custom', customResolution = resolutionKey === 'custom';
      if ($('projectSensorW')) $('projectSensorW').readOnly = !customSensor;
      if ($('projectSensorH')) $('projectSensorH').readOnly = !customSensor;
      if ($('projectResW')) $('projectResW').readOnly = !customResolution;
      if ($('projectResH')) $('projectResH').readOnly = !customResolution;
    }
    function setProjectSettingsError(message) { if (els.projectSettingsError) els.projectSettingsError.textContent = message || ''; }
    function setProjectSettingsStatus(message) { if (els.projectSettingsStatus) els.projectSettingsStatus.textContent = message || ''; }
    function updateProjectSettingsDraftFromForm() { if (projectSettingsOpen) projectSettingsDraft = projectSettingsDefaultsFromForm(); }
    function applyProjectSensorPreset() {
      const key = $('projectSensorFormat')?.value || 'custom';
      const preset = SENSOR_PRESETS[key];
      projectSettingsSensorMode = preset ? key : 'custom';
      if (preset) { if ($('projectSensorW')) $('projectSensorW').value = preset.w.toFixed(2); if ($('projectSensorH')) $('projectSensorH').value = preset.h.toFixed(2); }
      updateProjectSettingsDraftFromForm();
      if ($('projectSensorW')) $('projectSensorW').readOnly = Boolean(preset);
      if ($('projectSensorH')) $('projectSensorH').readOnly = Boolean(preset);
    }
    function applyProjectResolutionPreset() {
      const key = $('projectResolutionPreset')?.value || 'custom';
      const preset = RESOLUTION_PRESETS[key];
      projectSettingsResolutionMode = preset ? key : 'custom';
      if (preset) { if ($('projectResW')) $('projectResW').value = preset.w; if ($('projectResH')) $('projectResH').value = preset.h; }
      updateProjectSettingsDraftFromForm();
      if ($('projectResW')) $('projectResW').readOnly = Boolean(preset);
      if ($('projectResH')) $('projectResH').readOnly = Boolean(preset);
    }
    function projectPresetList() { return cameraPresetsRepository.list(); }
    function selectedProjectPreset() {
      const id = $('projectPresetSelect')?.value || projectSettingsPresetId;
      return cameraPresetsRepository.get(id);
    }
    function syncProjectPresetLibrary() {
      const select = $('projectPresetSelect');
      if (!select) return;
      const presets = projectPresetList();
      const available = presets.some(preset => preset.id === projectSettingsPresetId);
      if (!available) projectSettingsPresetId = CameraPresets.FACTORY_PRESET_ID;
      select.replaceChildren();
      presets.forEach(preset => {
        const option = doc.createElement('option');
        option.value = preset.id;
        option.textContent = preset.id === CameraPresets.FACTORY_PRESET_ID ? `${preset.name} · built-in` : preset.name;
        select.appendChild(option);
      });
      select.value = projectSettingsPresetId;
      const factory = projectSettingsPresetId === CameraPresets.FACTORY_PRESET_ID;
      ['projectPresetUpdate', 'projectPresetRename', 'projectPresetDelete'].forEach(id => { const button = $(id); if (button) button.disabled = factory; });
      renderInspectorPresetOptions(selectedCamera());
    }
    function setProjectSettingsDraftFromPreset(preset, message) {
      if (!preset) { setProjectSettingsError('找不到指定 Camera Preset。'); return false; }
      projectSettingsPresetId = preset.id;
      projectSettingsDraft = clone(preset.settings);
      projectSettingsSensorMode = sensorPresetKey(projectSettingsDraft);
      projectSettingsResolutionMode = resolutionPresetKey(projectSettingsDraft);
      setProjectSettingsError('');
      setProjectSettingsStatus(message || `已載入 ${preset.name}；仍需按 Save Defaults 才會更新目前 defaults。`);
      syncProjectSettingsForm(projectSettingsDraft);
      syncProjectPresetLibrary();
      return true;
    }
    function promptPresetName(defaultName) {
      const value = view.prompt('Camera Preset 名稱', defaultName || 'New Camera Preset');
      return value == null ? null : String(value).trim();
    }
    function reportPresetFailure(result) {
      setProjectSettingsError(`Camera Preset 操作失敗：${result?.error?.message || '未知錯誤'} 原本已儲存的 Preset 清單已保留。`);
      return false;
    }
    function createProjectPresetFromSettings(settingsValue, sourceLabel) {
      const checked = CameraDefaults.validateDefaults(settingsValue);
      if (!checked.ok) { setProjectSettingsError(`無法建立 Preset：${checked.error}`); return false; }
      const name = promptPresetName(sourceLabel || 'New Camera Preset');
      if (name === null) return false;
      if (!name) { setProjectSettingsError('Preset 名稱不可為空。'); return false; }
      const result = cameraPresetsRepository.createPreset({name, settings: checked.value});
      if (!result.ok) return reportPresetFailure(result);
      projectSettingsPresetId = result.preset.id;
      syncProjectPresetLibrary();
      setProjectSettingsError('');
      setProjectSettingsStatus(`已建立 Preset「${result.preset.name}」。`);
      return true;
    }
    function loadProjectPreset() { return setProjectSettingsDraftFromPreset(selectedProjectPreset()); }
    function setProjectPresetAsDefault() {
      const preset = selectedProjectPreset();
      if (!preset) return setProjectSettingsError('找不到指定 Camera Preset。');
      const result = cameraDefaultsRepository.save(preset.settings);
      if (!result.ok) { setProjectSettingsError(`Camera Defaults 儲存失敗：${result.error.message} 原本已儲存值已保留；請確認瀏覽器網站資料權限後再試。`); return false; }
      projectSettingsDraft = clone(result.defaults);
      projectSettingsSensorMode = sensorPresetKey(projectSettingsDraft);
      projectSettingsResolutionMode = resolutionPresetKey(projectSettingsDraft);
      setProjectSettingsError('');
      setProjectSettingsStatus(`已將 Preset「${preset.name}」設為目前 Camera Defaults；此動作已直接保存，Cancel 不會回復。`);
      syncProjectSettingsForm(projectSettingsDraft);
      return true;
    }
    function updateProjectPreset() {
      const preset = selectedProjectPreset();
      if (!preset || preset.id === CameraPresets.FACTORY_PRESET_ID) { setProjectSettingsError('Factory Defaults 不可更新。'); return false; }
      const result = cameraPresetsRepository.updatePreset(preset.id, {settings: projectSettingsDefaultsFromForm()});
      if (!result.ok) return reportPresetFailure(result);
      syncProjectPresetLibrary();
      setProjectSettingsError('');
      setProjectSettingsStatus(`已更新 Preset「${result.preset.name}」；目前 Camera Defaults 未自動變更。`);
      return true;
    }
    function renameProjectPreset() {
      const preset = selectedProjectPreset();
      if (!preset || preset.id === CameraPresets.FACTORY_PRESET_ID) { setProjectSettingsError('Factory Defaults 不可重新命名。'); return false; }
      const name = promptPresetName(preset.name);
      if (name === null) return false;
      if (!name) { setProjectSettingsError('Preset 名稱不可為空。'); return false; }
      const result = cameraPresetsRepository.renamePreset(preset.id, name);
      if (!result.ok) return reportPresetFailure(result);
      syncProjectPresetLibrary();
      setProjectSettingsError('');
      setProjectSettingsStatus(`已重新命名 Preset 為「${result.preset.name}」。`);
      return true;
    }
    function duplicateProjectPreset() {
      const preset = selectedProjectPreset();
      if (!preset) return setProjectSettingsError('找不到指定 Camera Preset。');
      const result = cameraPresetsRepository.duplicatePreset(preset.id);
      if (!result.ok) return reportPresetFailure(result);
      projectSettingsPresetId = result.preset.id;
      syncProjectPresetLibrary();
      setProjectSettingsError('');
      setProjectSettingsStatus(`已複製為 Preset「${result.preset.name}」。`);
      return true;
    }
    function deleteProjectPreset() {
      const preset = selectedProjectPreset();
      if (!preset || preset.id === CameraPresets.FACTORY_PRESET_ID) { setProjectSettingsError('Factory Defaults 不可刪除。'); return false; }
      if (!view.confirm(`刪除 Preset「${preset.name}」？`)) return false;
      const result = cameraPresetsRepository.deletePreset(preset.id);
      if (!result.ok) return reportPresetFailure(result);
      projectSettingsPresetId = CameraPresets.FACTORY_PRESET_ID;
      syncProjectPresetLibrary();
      setProjectSettingsError('');
      setProjectSettingsStatus(`已刪除 Preset「${preset.name}」。`);
      return true;
    }
    function importSummaryText(summary, applied) {
      if (!summary) return '';
      const prefix = summary.mode === 'replace' ? 'Replace' : 'Merge';
      const parts = summary.mode === 'replace'
        ? [`移除 ${summary.removed}`, `加入 ${summary.added}`]
        : [`新增 ${summary.added}`, `跳過 ${summary.skipped}`, `重新命名 ${summary.renamed}`];
      parts.push(summary.defaultsSelected ? (applied ? `Camera Defaults 套用 ${summary.defaultsApplied ? 1 : 0}` : 'Camera Defaults 將套用 1') : '保留本機 Camera Defaults');
      return `${prefix}：${parts.join('、')}。${applied ? '已寫入本機。' : '尚未寫入本機。'}`;
    }
    function resetProjectImportState() {
      projectImportRequest += 1;
      projectImportBundle = null;
      projectImportPlan = null;
      projectImportFileName = '';
      projectImportMode = 'merge';
      projectImportApplyDefaults = true;
      if (els.projectPresetImportFile) els.projectPresetImportFile.value = '';
      if (els.projectPresetImportError) els.projectPresetImportError.textContent = '';
    }
    function renderProjectImport() {
      const visible = Boolean(projectImportBundle || projectImportErrorText());
      if (els.projectPresetImportPanel) els.projectPresetImportPanel.hidden = !visible;
      if (els.projectPresetImportFileName) els.projectPresetImportFileName.textContent = projectImportFileName ? `檔案：${projectImportFileName}` : '';
      if (els.projectPresetImportMerge) els.projectPresetImportMerge.checked = projectImportMode === 'merge';
      if (els.projectPresetImportReplace) els.projectPresetImportReplace.checked = projectImportMode === 'replace';
      if (els.projectPresetImportDefaults) els.projectPresetImportDefaults.checked = projectImportApplyDefaults;
      if (els.projectPresetImportSummary) els.projectPresetImportSummary.textContent = projectImportPlan ? importSummaryText(projectImportPlan.summary, false) : '';
      if (els.projectPresetImportApply) els.projectPresetImportApply.disabled = !projectImportPlan;
      if (els.projectPresetImportError) els.projectPresetImportError.textContent = projectImportErrorText();
    }
    function projectImportErrorText() { return els.projectPresetImportError?.textContent || ''; }
    function setProjectImportError(message) { if (els.projectPresetImportError) els.projectPresetImportError.textContent = message || ''; }
    function replanProjectImport() {
      if (!projectImportBundle) { projectImportPlan = null; renderProjectImport(); return false; }
      const result = cameraPresetCoordinator.planImport(projectImportBundle, {mode: projectImportMode, applyCameraDefaults: projectImportApplyDefaults});
      if (!result.ok) {
        projectImportPlan = null;
        setProjectImportError(`無法建立匯入摘要：${result.error.message}`);
        renderProjectImport();
        return false;
      }
      projectImportPlan = result.plan;
      setProjectImportError('');
      renderProjectImport();
      return true;
    }
    async function handleProjectImportFile(file) {
      const request = ++projectImportRequest;
      projectImportBundle = null;
      projectImportPlan = null;
      projectImportFileName = file?.name || '';
      setProjectImportError('');
      renderProjectImport();
      if (!file) return;
      try {
        const result = cameraPresetCoordinator.validateBundle(await file.text());
        if (request !== projectImportRequest) return;
        if (!result.ok) {
          setProjectImportError(`無法匯入：${result.error.message}`);
          renderProjectImport();
          return;
        }
        projectImportBundle = result.bundle;
        projectImportMode = 'merge';
        projectImportApplyDefaults = true;
        replanProjectImport();
      } catch (error) {
        if (request !== projectImportRequest) return;
        setProjectImportError(`無法讀取匯入檔案：${error.message || error}`);
        renderProjectImport();
      }
    }
    function exportProjectPresetLibrary() {
      const result = cameraPresetCoordinator.buildBundle();
      if (!result.ok) {
        setProjectSettingsError(`無法匯出 Preset Library：${result.error.message} 請先確認本機儲存資料可讀取。`);
        return false;
      }
      try {
        const date = new Date(result.bundle.exportedAt);
        const pad = value => String(value).padStart(2, '0');
        const filename = `camera-preset-library-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}.json`;
        const blob = new view.Blob([JSON.stringify(result.bundle, null, 2)], {type: 'application/json'});
        const url = view.URL.createObjectURL(blob);
        const anchor = doc.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';
        doc.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        view.setTimeout(() => view.URL.revokeObjectURL(url), 0);
        setProjectSettingsError('');
        setProjectSettingsStatus(`已匯出 Preset Library：${filename}。`);
        return true;
      } catch (error) {
        setProjectSettingsError(`無法建立匯出檔案：${error.message || error}`);
        return false;
      }
    }
    function applyProjectImport() {
      if (!projectImportPlan) { setProjectImportError('請先選取有效的匯入檔案。'); renderProjectImport(); return false; }
      if (projectImportPlan.mode === 'replace') {
        const confirmed = view.confirm(`Replace Library 將移除 ${projectImportPlan.summary.removed} 個本機 Preset，並加入 ${projectImportPlan.summary.added} 個匯入 Preset。此動作不可由 Cancel 回復，確定繼續？`);
        if (!confirmed) return false;
      }
      const result = cameraPresetCoordinator.applyImport(projectImportPlan);
      if (!result.ok) {
        setProjectImportError(`匯入失敗：${result.error.message}`);
        renderProjectImport();
        return false;
      }
      const message = importSummaryText(result.summary, true);
      resetProjectImportState();
      setProjectSettingsError('');
      setProjectSettingsStatus(`匯入完成：${message}`);
      syncProjectPresetLibrary();
      renderProjectSettings();
      return true;
    }
    function ensureInspectorPresetControls() {
      let mount = $('cameraPresetMount');
      const body = rootElement.querySelector?.('[data-section-body="lens"]');
      if (!body) return false;
      if (!mount) {
        mount = doc.createElement('div');
        mount.id = 'cameraPresetMount';
        mount.className = 'camera-preset-inspector';
        mount.innerHTML = '<div class="preset-apply-row"><div class="field"><label class="field-label" for="cameraPresetSelect">Camera Preset</label><select class="field-control" id="cameraPresetSelect"></select></div><button class="action-button" id="cameraPresetApply" type="button">Apply</button></div><div class="tiny" id="cameraPresetStatus" role="status" aria-live="polite"></div>';
        body.insertBefore(mount, body.firstChild);
      }
      els.cameraPresetSelect = $('cameraPresetSelect');
      els.cameraPresetApply = $('cameraPresetApply');
      els.cameraPresetStatus = $('cameraPresetStatus');
      return true;
    }
    function renderInspectorPresetOptions(camera) {
      if (!ensureInspectorPresetControls()) return;
      const select = els.cameraPresetSelect;
      if (!select) return;
      const presets = cameraPresetsRepository.list();
      if (!presets.some(preset => preset.id === inspectorPresetSelectionId)) inspectorPresetSelectionId = CameraPresets.FACTORY_PRESET_ID;
      select.replaceChildren();
      presets.forEach(preset => { const option = doc.createElement('option'); option.value = preset.id; option.textContent = preset.id === CameraPresets.FACTORY_PRESET_ID ? `${preset.name} · built-in` : preset.name; select.appendChild(option); });
      select.value = inspectorPresetSelectionId;
      select.disabled = !camera;
      if (els.cameraPresetApply) els.cameraPresetApply.disabled = !camera || camera.locked === true || !cameraPresetsRepository.get(inspectorPresetSelectionId);
      const status = cameraPresetsRepository.getStatus();
      if (status.error && els.cameraPresetStatus && !els.cameraPresetStatus.textContent) els.cameraPresetStatus.textContent = `Preset Library 使用 Factory Defaults：${status.error.message}`;
    }
    function applyInspectorPreset() {
      const camera = selectedCamera();
      const presetId = els.cameraPresetSelect?.value || inspectorPresetSelectionId;
      const preset = cameraPresetsRepository.get(presetId);
      if (!camera) { if (els.cameraPresetStatus) els.cameraPresetStatus.textContent = '請先選取 Camera。'; return false; }
      if (camera.locked) { if (els.cameraPresetStatus) els.cameraPresetStatus.textContent = 'Locked Camera 不可套用 Preset。'; return false; }
      if (!preset) { if (els.cameraPresetStatus) els.cameraPresetStatus.textContent = '找不到指定 Camera Preset。'; return false; }
      const result = store.patchCamera(camera.id, preset.settings, 'camera-preset-apply');
      if (result === false) { if (els.cameraPresetStatus) els.cameraPresetStatus.textContent = 'Camera 已鎖定或已不存在，Preset 未套用。'; return false; }
      inspectorPresetSelectionId = preset.id;
      if (els.cameraPresetStatus) els.cameraPresetStatus.textContent = `已套用 Preset「${preset.name}」。`;
      return true;
    }
    function renderProjectSettingsAccordion() {
      const controls = {camera: $('projectCameraAccordionToggle'), target: $('projectTargetAccordionToggle')};
      const panels = {camera: $('projectCameraAccordionPanel'), target: $('projectTargetAccordionPanel')};
      Object.keys(controls).forEach(key => {
        const expanded = projectSettingsAccordion[key] === true;
        controls[key]?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        if (panels[key]) panels[key].hidden = !expanded;
      });
    }
    function renderProjectSettings() {
      if (!els.projectSettingsModal) return;
      els.projectSettingsModal.hidden = !projectSettingsOpen;
      els.projectSettingsModal.setAttribute('aria-hidden', projectSettingsOpen ? 'false' : 'true');
      if (!projectSettingsOpen) return;
      renderProjectSettingsAccordion();
      syncProjectSettingsForm(projectSettingsDraft);
      syncProjectPresetLibrary();
      renderProjectImport();
      const status = cameraDefaultsRepository.getStatus();
      if (status.error && els.projectSettingsError && !els.projectSettingsError.textContent) {
        els.projectSettingsError.textContent = `無法讀取本機 Camera Defaults，已使用 Factory Defaults。${status.error.message} 請確認瀏覽器網站資料權限後重試。`;
      }
      const presetStatus = cameraPresetsRepository.getStatus();
      if (presetStatus.error && els.projectSettingsError && !els.projectSettingsError.textContent) {
        els.projectSettingsError.textContent = `無法讀取 Camera Preset Library，已保留 Factory Defaults。${presetStatus.error.message} 請確認瀏覽器網站資料權限後重試。`;
      }
    }
    function openProjectSettings() {
      cancelPlacementInteraction();
      projectSettingsRestoreFocus = doc.activeElement;
      projectSettingsDraft = cameraDefaultsRepository.getDefaults();
      projectSettingsSensorMode = sensorPresetKey(projectSettingsDraft);
      projectSettingsResolutionMode = resolutionPresetKey(projectSettingsDraft);
      projectSettingsAccordion = {camera: true, target: false};
      projectSettingsPresetId = CameraPresets.FACTORY_PRESET_ID;
      resetProjectImportState();
      projectSettingsOpen = true;
      setProjectSettingsError('');
      setProjectSettingsStatus('');
      renderProjectSettings();
      const focus = () => { const first = $('projectCameraHeight') || els.projectSettingsClose; first?.focus?.({preventScroll: true}); };
      (view.requestAnimationFrame || (callback => view.setTimeout(callback, 0)))(focus);
    }
    function closeProjectSettings({restoreFocus = true} = {}) {
      if (!projectSettingsOpen) return;
      projectSettingsOpen = false; projectSettingsDraft = null; projectSettingsSensorMode = null; projectSettingsResolutionMode = null; projectSettingsPresetId = CameraPresets.FACTORY_PRESET_ID; resetProjectImportState(); renderProjectSettings();
      const focus = projectSettingsRestoreFocus;
      projectSettingsRestoreFocus = null;
      if (restoreFocus && focus?.isConnected && typeof focus.focus === 'function') focus.focus({preventScroll: true});
    }
    function saveProjectSettings() {
      const result = cameraDefaultsRepository.save(projectSettingsDefaultsFromForm());
      if (!result.ok) {
        setProjectSettingsError(`Camera Defaults 儲存失敗：${result.error.message} 原本已儲存值已保留；請修正欄位或確認瀏覽器網站資料權限後再試。`);
        return false;
      }
      closeProjectSettings();
      return true;
    }
    function useSelectedCameraForProjectSettings() {
      const defaults = cameraDefaultsFromCamera(selectedCamera());
      const checked = CameraDefaults.validateDefaults(defaults);
      if (!checked.ok) { setProjectSettingsError(`選取的 Camera 參數無法套用：${checked.error}`); return; }
      projectSettingsDraft = checked.value; projectSettingsSensorMode = sensorPresetKey(projectSettingsDraft); projectSettingsResolutionMode = resolutionPresetKey(projectSettingsDraft); projectSettingsPresetId = CameraPresets.FACTORY_PRESET_ID; setProjectSettingsError(''); setProjectSettingsStatus('已將選取 Camera 的參數載入表單；仍需按 Save Defaults 才會保存。'); syncProjectSettingsForm(projectSettingsDraft); syncProjectPresetLibrary();
    }
    function scheduleInvalidate() {
      if (!map || !map.invalidateSize) return;
      clearTimeout(resizeTimer);
      scheduleLegendClamp();
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
    function leaveFocusMapMode() { if (store.getState().uiState.focusMapMode) store.setFocusMapMode(false); }
    function showInspector() { setPanel('inspector', true); }
    function showDetails(kind, id) { leaveFocusMapMode(); store.setFocusedEntity(kind, id); store.setInspectorTab('details'); showInspector(); }
    function showObservation() { store.setInspectorTab('observation'); showInspector(); }
    function closeInspector() { setPanel('inspector', false); }
    function togglePanel(panel) {
      const state = store.getState();
      if (state.uiState.focusMapMode) { leaveFocusMapMode(); return setPanel(panel, true); }
      return setPanel(panel, state.uiState.panelOpen?.[panel] !== true);
    }
    function toggleFocusMap() {
      const state = store.getState();
      if (state.uiState.focusMapMode) { store.setFocusMapMode(false); scheduleInvalidate(); return; }
      store.clearFocusedEntity(); store.setFocusMapMode(true); scheduleInvalidate();
    }
    function renderPanelVisibility(state) {
      const panels = state.uiState.panelOpen || {}, focusMap = state.uiState.focusMapMode === true;
      const objectManagerOpen = panels.objectManager !== false && !focusMap;
      const inspectorOpen = panels.inspector !== false && !focusMap;
      if (els.inspector) { els.inspector.classList.toggle('is-closed', !inspectorOpen); els.inspector.setAttribute('aria-hidden', inspectorOpen ? 'false' : 'true'); }
      const rail = $('cameraRail'); if (rail) { rail.classList.toggle('is-closed', !objectManagerOpen); rail.setAttribute('aria-hidden', objectManagerOpen ? 'false' : 'true'); }
      if (els.mapSettingsPopover) els.mapSettingsPopover.hidden = panels.mapSettings !== true;
      if (els.workspace) { els.workspace.classList.toggle('is-open', panels.workspace === true && !focusMap); els.workspace.classList.toggle('is-closed', focusMap); }
      if (els.mapSettingsToggle) els.mapSettingsToggle.setAttribute('aria-expanded', panels.mapSettings === true ? 'true' : 'false');
      if ($('workspaceToggle')) { $('workspaceToggle').setAttribute('aria-expanded', panels.workspace === true ? 'true' : 'false'); $('workspaceToggle').textContent = panels.workspace === true ? 'Collapse' : 'Expand'; }
      if ($('toggleObjectManager')) { $('toggleObjectManager').setAttribute('aria-pressed', panels.objectManager !== false ? 'true' : 'false'); $('toggleObjectManager').setAttribute('aria-expanded', panels.objectManager !== false ? 'true' : 'false'); }
      if ($('openInspector')) { $('openInspector').setAttribute('aria-pressed', panels.inspector !== false ? 'true' : 'false'); $('openInspector').setAttribute('aria-expanded', panels.inspector !== false ? 'true' : 'false'); }
      if ($('focusMapButton')) $('focusMapButton').setAttribute('aria-pressed', focusMap ? 'true' : 'false');
      if (els.appShell) { els.appShell.dataset.objectManagerOpen = panels.objectManager !== false ? 'true' : 'false'; els.appShell.dataset.inspectorOpen = panels.inspector !== false ? 'true' : 'false'; els.appShell.dataset.workspaceOpen = panels.workspace === true ? 'true' : 'false'; els.appShell.dataset.focusMap = focusMap ? 'true' : 'false'; }
    }

    function renderTopBar(state) {
      if (els.projectName) els.projectName.textContent = state.name || 'Untitled project';
      if (els.dirty) { els.dirty.textContent = state.dirty ? '尚未儲存的變更' : 'Clean baseline'; els.dirty.classList.toggle('is-dirty', state.dirty); }
      if (els.undo) els.undo.disabled = !state.history || state.history.index <= 0;
      if (els.redo) els.redo.disabled = !state.history || state.history.index >= state.history.length;
      renderProjectMenu();
    }

    function renderRail(state) {
      if (overflowMenu) closeOverflowMenu();
      const managerKind = state.uiState.objectManagerTab === 'targets' ? 'targets' : 'cameras';
      Array.from($('objectManagerTabs')?.querySelectorAll?.('[data-manager-tab]') || []).forEach(tab => tab.setAttribute('aria-selected', tab.dataset.managerTab === managerKind ? 'true' : 'false'));
      setValue($('objectManagerSearch'), managerKind === 'cameras' ? state.uiState.cameraSearchQuery : state.uiState.targetSearchQuery);
      if ($('addCamera')) $('addCamera').hidden = managerKind !== 'cameras'; if ($('addTargetManager')) $('addTargetManager').hidden = managerKind !== 'targets';
      if (els.cameraRailItems) {
        const scrollTop = els.cameraRailItems.scrollTop;
        els.cameraRailItems.replaceChildren();
        const kind = state.uiState.objectManagerTab === 'targets' ? 'target' : 'camera', order = kind === 'camera' ? state.cameraOrder : state.targetOrder, table = kind === 'camera' ? state.camerasById : state.targetsById, query = String(kind === 'camera' ? state.uiState.cameraSearchQuery : state.uiState.targetSearchQuery || '').toLowerCase();
        order.map(id => table[id]).filter(Boolean).filter(entity => !query || `${entity.name} ${entity.position?.latitudeDeg || ''} ${entity.position?.longitudeDeg || ''}`.toLowerCase().includes(query)).forEach(entity => {
          const item = doc.createElement('div'); item.className = 'camera-rail-item manager-row'; item.tabIndex = 0; item.setAttribute('role','button'); item.dataset.entityKind = kind; item.dataset.entityId = entity.id; item.setAttribute('aria-current', state.uiState.focusedEntity?.kind === kind && state.uiState.focusedEntity.id === entity.id ? 'true':'false');
          const identity = doc.createElement('span'); identity.className = kind === 'camera' ? 'camera-color' : 'target-row-identity'; if (kind === 'camera') identity.style.backgroundColor = cameraColor(entity,state.cameraOrder); item.appendChild(identity);
          const top = doc.createElement('span'); top.className='manager-row-top';
          const name = doc.createElement('span'); name.className='camera-short-name'; name.textContent=entity.name||entity.id; name.title=entity.name||entity.id; top.appendChild(name);
          const overflow = doc.createElement('button'); const overflowId=`manager-overflow-${kind}-${encodeURIComponent(entity.id)}`; overflow.type='button'; overflow.className='rail-icon manager-overflow-button'; overflow.textContent='…'; overflow.dataset.entityOverflow='true'; overflow.dataset.entityKind=kind; overflow.dataset.entityId=entity.id; overflow.setAttribute('aria-label',`${entity.name || entity.id} 的更多操作`); overflow.title=`${entity.name || entity.id} 的更多操作`; overflow.setAttribute('aria-expanded','false'); overflow.setAttribute('aria-controls',overflowId); top.appendChild(overflow); item.appendChild(top);
          const bottom = doc.createElement('span'); bottom.className='manager-row-bottom';
          const pos = doc.createElement('span'); pos.className='rail-state manager-position'; pos.textContent=entity.position ? `${Number(entity.position.latitudeDeg).toFixed(3)}, ${Number(entity.position.longitudeDeg).toFixed(3)}` : 'Draft'; bottom.appendChild(pos);
          const controls = doc.createElement('span'); controls.className='manager-status-controls'; [['visible',entity.visible!==false,entity.visible!==false?'◉':'○'],['enabled',entity.enabled!==false,entity.enabled!==false?'✓':'×'],['locked',entity.locked,entity.locked?'🔒':'🔓']].forEach(([action,pressed,label]) => { const b=doc.createElement('button'); const entityName=entity.name||entity.id; const actionLabel=action==='visible'?(pressed?'隱藏':'顯示'):action==='enabled'?(pressed?'停用':'啟用'):pressed?'解除鎖定':'鎖定'; b.type='button'; b.className='rail-icon'; b.textContent=label; b.dataset.entityAction=action; b.dataset.entityKind=kind; b.dataset.entityId=entity.id; b.setAttribute('aria-pressed',pressed?'true':'false'); b.setAttribute('aria-label',`${actionLabel} ${entityName}`); b.title=`${actionLabel} ${entityName}`; controls.appendChild(b); }); bottom.appendChild(controls); item.appendChild(bottom); els.cameraRailItems.appendChild(item);
        });
        if (!els.cameraRailItems.children.length) { const empty=doc.createElement('div'); empty.className='rail-empty'; empty.textContent=`尚無符合的 ${kind}`; els.cameraRailItems.appendChild(empty); }
        els.cameraRailItems.scrollTop = scrollTop;
        const focused = Array.from(els.cameraRailItems.querySelectorAll('[data-entity-id]')).find(item => item.dataset.entityKind === state.uiState.focusedEntity?.kind && item.dataset.entityId === state.uiState.focusedEntity?.id); if (!scrollTop) focused?.scrollIntoView?.({block:'nearest'});
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
      const sensorKey = Object.keys(SENSOR_PRESETS).find(key => camera && Math.abs(camera.sensorWidthMm - SENSOR_PRESETS[key].w) < .001 && Math.abs(camera.sensorHeightMm - SENSOR_PRESETS[key].h) < .001);
      setValue($('sensorFormat'), sensorKey || 'custom');
      const resolutionKey = Object.keys(RESOLUTION_PRESETS).find(key => camera && camera.widthPx === RESOLUTION_PRESETS[key].w && camera.heightPx === RESOLUTION_PRESETS[key].h);
      setValue($('resolutionPreset'), resolutionKey || 'custom');
      const customSensor = $('sensorFormat')?.value === 'custom'; if ($('sensorW')) $('sensorW').readOnly = !customSensor; if ($('sensorH')) $('sensorH').readOnly = !customSensor;
      const customResolution = $('resolutionPreset')?.value === 'custom'; if ($('resW')) $('resW').readOnly = !customResolution; if ($('resH')) $('resH').readOnly = !customResolution;
    }
    function renderHeadingScrubber(camera) {
      const scrubber = els.headingScrubber; if (!scrubber) return;
      const value = normalizeHeading(camera?.headingDeg ?? 0) ?? 0, disabled = !camera || camera.locked === true;
      scrubber.classList.toggle('is-disabled', disabled); scrubber.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      scrubber.setAttribute('aria-valuenow', String(value)); scrubber.setAttribute('aria-valuetext', `${value.toFixed(1)}°`);
      const indicator = scrubber.querySelector('.heading-scrubber-indicator'); if (indicator) indicator.style.left = `${(value / 360) * 100}%`;
    }
    function renderInspector(state) {
      const camera = selectedCamera(state);
      if ($('cameraInspectorName')) $('cameraInspectorName').textContent = camera?.name || '沒有選取 Camera';
      if ($('cameraInspectorSub')) $('cameraInspectorSub').textContent = camera ? (camera.position ? 'Selected Camera' : 'Draft · 尚未定位') : '從 Rail 選取 Camera';
      if ($('cameraLifecycle')) { $('cameraLifecycle').textContent = !camera ? 'None' : camera.lifecycle === 'draft-unplaced' ? 'Draft' : camera.locked ? 'Locked' : camera.enabled === false ? 'Disabled' : 'Placed'; $('cameraLifecycle').className = `status-badge ${!camera ? '' : camera.lifecycle === 'draft-unplaced' ? 'draft' : camera.locked ? '' : camera.enabled === false ? '' : 'placed'}`; }
      syncCameraFieldValues(camera);
      renderInspectorPresetOptions(camera);
      renderHeadingScrubber(camera);
      const metrics = computeMetrics(camera, state);
      const metricValues = metrics && !metrics.error ? {pixelPitch: `${(metrics.optics.pixelPitchMm * 1000).toFixed(2)} µm`, hfov: fmtDeg(metrics.optics.horizontalFovDeg), vfov: fmtDeg(metrics.optics.verticalFovDeg), horizon: `${metrics.horizon.distanceKm.toFixed(2)} km`, nearR: fmtM(metrics.envelope.nearDistanceM), farR: fmtM(metrics.envelope.farDistanceM)} : {pixelPitch: '—', hfov: '—', vfov: '—', horizon: '—', nearR: '—', farR: '—'};
      Object.entries(metricValues).forEach(([id, value]) => { const element = $(id); if (element) element.textContent = value; });
      ['fitCamera', 'fitFov'].forEach(id => { const element = $(id); if (element) element.disabled = !camera; });
      if ($('resetCamera')) $('resetCamera').disabled = !camera || camera.locked === true;
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
      if ($('targetFormTitle')) $('targetFormTitle').textContent = target ? 'Selected Target' : '尚未選取 Target';
      if ($('createTarget')) $('createTarget').textContent = '建立 Target';
    }
    function targetPositionFieldsMarkup() { return '<div class="field-grid"><div class="field"><label class="field-label" for="targetLat">Latitude</label><input class="field-control" id="targetLat" type="number" step="0.000001" data-target-field="targetLat" /></div><div class="field"><label class="field-label" for="targetLng">Longitude</label><input class="field-control" id="targetLng" type="number" step="0.000001" data-target-field="targetLng" /></div><div class="field"><label class="field-label" for="targetHeading">Heading</label><input class="field-control" id="targetHeading" type="number" step="0.1" data-target-field="targetHeading" /></div><div class="field"><label class="field-label">Anchor</label><input class="field-control" value="bottom-center" readonly /></div></div>'; }
    function targetDimensionFieldsMarkup() { return '<div class="field-grid"><div class="field"><label class="field-label" for="targetLong">Length</label><input class="field-control" id="targetLong" type="number" step="0.1" data-target-field="targetLong" /></div><div class="field"><label class="field-label" for="targetShort">Width</label><input class="field-control" id="targetShort" type="number" step="0.1" data-target-field="targetShort" /></div><div class="field"><label class="field-label" for="targetHeight">Visible height</label><input class="field-control" id="targetHeight" type="number" step="0.1" data-target-field="targetHeight" /></div><div class="field"><label class="field-label" for="orientation">Coverage reference</label><select class="field-control" id="orientation"><option value="short">short side / 船寬</option><option value="long">long side / 船長</option></select></div></div>'; }
    function targetFieldsMarkup() { return `${targetPositionFieldsMarkup()}${targetDimensionFieldsMarkup()}`; }
    function renderTargetCreation(state) { const key='target-create'; if (contextRenderKey !== key) { els.resultContent.innerHTML = `<div class="result-state neutral"><strong>尚未選取 Target</strong>請由 Object Manager 的 Add Target 放置，或輸入座標建立。</div><section class="panel-section">${targetFieldsMarkup()}<button class="action-button primary" id="createTarget" type="button" style="width:100%;margin-top:9px">建立 Target</button><div class="form-error" id="targetFormError"></div></section>`; contextRenderKey=key; } renderTargetForm(null,state); }
    function renderTargetDetails(state, target) { const key=`target:${target.id}:details`; if (contextRenderKey !== key) { els.resultContent.innerHTML = `<section class="panel-section"><button class="section-toggle" data-section-toggle="target-position" aria-expanded="true">Position &amp; Orientation</button><div class="section-body" data-section-body="target-position">${targetPositionFieldsMarkup()}</div></section><section class="panel-section"><button class="section-toggle" data-section-toggle="target-dimensions" aria-expanded="true">Dimensions &amp; Coverage</button><div class="section-body" data-section-body="target-dimensions">${targetDimensionFieldsMarkup()}</div></section><section class="panel-section"><button class="section-toggle" data-section-toggle="target-actions" aria-expanded="true">Actions</button><div class="section-body" data-section-body="target-actions"><div class="inspector-actions"><button class="action-button" id="fitTarget">Fit Target</button><button class="action-button" id="duplicateTarget">Duplicate</button><button class="action-button" id="renameTarget">Rename</button><button class="action-button danger" id="deleteTarget">Delete</button></div><div class="tiny" id="targetLockedHint"></div></div></section>`; contextRenderKey=key; } renderTargetForm(target,state); if ($('targetLockedHint')) $('targetLockedHint').textContent=target.locked?'Target 已鎖定，請從 Object Manager 解除鎖定。':''; }
    function observationStatusBadge(observation, camera, target) { if (!camera || !target || !observation || observation.visibilityState === 'unavailable') return {label:'Unavailable', className:'neutral'}; if (observation.calculationState === 'failed') return {label:'Failed', className:'error'}; if (observation.visibilityState === 'visible') return {label:'Visible', className:'ready'}; if (['outside-hfov','outside-vfov','outside-fov'].includes(observation.visibilityState)) return {label:'Outside FOV', className:'draft'}; return {label:'Unavailable', className:'neutral'}; }
    function observationEmptyMarkup(camera, target) { if (!camera && !target) return '<div class="result-state neutral"><strong>尚未選取 Camera 或 Target</strong>請先選擇 Active Camera 與 Current Target。</div>'; if (!camera) return '<div class="result-state neutral"><strong>尚未選取 Active Camera</strong>請選擇 Active Camera 以觀測目前 Target。</div>'; return '<div class="result-state neutral"><strong>尚未選取 Current Target</strong>請選擇 Current Target 以查看 Active Camera 的觀測結果。</div>'; }
    function renderObservation(state) { const camera=selectedCamera(state), target=selectedTarget(state), key='observation'; if(contextRenderKey!==key){els.resultContent.innerHTML='<div id="observationMount"></div>';contextRenderKey=key;} const mount=$('observationMount'); if(!mount)return; const observation=camera&&target?store.getObservation(camera.id,target.id):null; const context=camera&&target?`<div class="result-state neutral"><strong>${escapeHtml(target.name||target.id)}</strong>Observed by ${escapeHtml(camera.name||camera.id)}。</div>${observationMarkup(camera,target,observation,state)}`:observationEmptyMarkup(camera,target); mount.innerHTML=`${context}<div class="result-actions"><button class="action-button" id="fitTarget" ${target?'':'disabled'}>Fit Target</button><button class="action-button" id="fitCameraTarget" ${camera&&target?'':'disabled'}>Fit Camera + Target</button></div>`; }
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
    function comparisonNumber(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
    function comparisonDistance(observation) { const value = comparisonNumber(observation?.distanceM); return value === null ? '—' : fmtM(value); }
    function comparisonAzimuth(observation) { const value = comparisonNumber(observation?.azimuthDeg); return value === null ? '—' : fmtDeg(value); }
    function comparisonPixelSize(observation, rankable) {
      const width = comparisonNumber(observation?.pixelWidth), height = comparisonNumber(observation?.pixelHeight);
      return rankable && width !== null && height !== null ? `${width.toFixed(1)} × ${height.toFixed(1)} px` : '—';
    }
    function comparisonShortSide(observation, rankable) {
      const value = comparisonNumber(observation?.yolo?.shortSidePx);
      return rankable && value !== null ? `${value.toFixed(1)} px` : '—';
    }
    function comparisonMarkup(state, target) {
      const comparison = Comparison.buildCameraComparison({
        cameraOrder: state.cameraOrder,
        camerasById: state.camerasById,
        currentTarget: target,
        activeCameraId: state.uiState.selectedCameraId,
        getObservation: (cameraId, targetId) => store.getObservation(cameraId, targetId)
      });
      if (!comparison.enabledCount) return '<div class="comparison-empty result-state neutral"><strong>No enabled Cameras</strong>Enable or create a Camera to compare this Target.</div>';
      const disabledTargetNotice = target.enabled === false ? '<div class="comparison-notice result-state neutral"><strong>Current Target is disabled</strong>All enabled Cameras are shown as Unavailable.</div>' : '';
      const rows = comparison.rows.map(row => {
        const observation = row.observation;
        const statusTitle = observation?.error ? ` title="${escapeHtml(observation.error)}"` : '';
        return `<tr class="comparison-row${row.active ? ' is-active' : ''}" data-comparison-camera-id="${escapeHtml(row.cameraId)}"><td class="comparison-rank">${row.rank ?? '—'}</td><th scope="row" class="comparison-camera"><button class="comparison-camera-button" type="button" data-comparison-camera-id="${escapeHtml(row.cameraId)}" aria-current="${row.active ? 'true' : 'false'}"><span class="comparison-camera-name">${escapeHtml(row.camera.name || row.camera.id)}</span>${row.active ? '<span class="comparison-active-label">Active Camera</span>' : ''}</button></th><td><span class="status-badge ${row.status.className}"${statusTitle}>${escapeHtml(row.status.label)}</span></td><td class="comparison-number">${comparisonDistance(observation)}</td><td class="comparison-number">${comparisonAzimuth(observation)}</td><td class="comparison-number">${comparisonPixelSize(observation, row.status.rankable)}</td><td class="comparison-number">${comparisonShortSide(observation, row.status.rankable)}</td></tr>`;
      }).join('');
      return `${disabledTargetNotice}<div class="comparison-table-scroll" role="region" aria-label="Camera Comparison table"><table class="comparison-table"><caption class="sr-only">Camera observations for ${escapeHtml(target.name || target.id)}</caption><thead><tr><th scope="col">Rank</th><th scope="col">Camera</th><th scope="col">Observation status</th><th scope="col">Distance</th><th scope="col">Azimuth</th><th scope="col">Target pixel size</th><th scope="col">YOLO short side</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    function renderMapFovControl(state) {
      const mode = state.uiState.fovColorMode === 'camera' ? 'camera' : 'coverage';
      rootElement.querySelectorAll('[data-fov-color-mode]').forEach(button => {
        button.setAttribute('aria-pressed', button.dataset.fovColorMode === mode ? 'true' : 'false');
      });
    }
    function yoloValue(value, digits, suffix = '') {
      const parsed = comparisonNumber(value);
      return parsed === null ? '—' : `${parsed.toFixed(digits)}${suffix}`;
    }
    function yoloCoverageMarkup(state, target) {
      if (!target) return '<div class="yolo-empty result-state neutral"><strong>No Current Target</strong>Select a Target from Object Manager or the map.</div>';
      const comparison = Comparison.buildCameraComparison({
        cameraOrder: state.cameraOrder,
        camerasById: state.camerasById,
        currentTarget: target,
        activeCameraId: state.uiState.selectedCameraId,
        getObservation: (cameraId, targetId) => store.getObservation(cameraId, targetId)
      });
      const coverage = YoloCoverage.buildYoloCoverage({comparison});
      const counts = coverage.counts;
      const summary = `<section class="yolo-summary" aria-label="YOLO Coverage summary"><div class="yolo-summary-heading"><strong>${escapeHtml(target.name || target.id)}</strong><span>Current Target · ${coverage.enabledCount} enabled Cameras · ${coverage.disabledCount} disabled excluded</span></div><div class="yolo-summary-grid"><div><span>≥ 32 px · Robust</span><b>${counts.robust}</b></div><div><span>16–&lt;32 px · Usable</span><b>${counts.usable}</b></div><div><span>8–&lt;16 px · Difficult</span><b>${counts.difficult}</b></div><div><span>&lt; 8 px · Not recommended</span><b>${counts.notRecommended}</b></div><div><span>Outside FOV</span><b>${counts.outsideFov}</b></div><div><span>Unavailable / Failed</span><b>${counts.unavailableFailed}</b></div></div></section>`;
      const warning = '<div class="yolo-warning result-state neutral">Pixel thresholds are site-planning heuristics, not guaranteed YOLO detection performance.</div>';
      const referenceSize = comparisonNumber(state.settings.planningTargetHeightM);
      const dataNote = `<div class="yolo-data-note">Workspace table uses Current Target Observation <code>yolo.shortSidePx</code>. Map bands use Project planning reference size${referenceSize === null ? '' : ` (${referenceSize.toFixed(1)} m)`}.</div>`;
      if (!coverage.enabledCount) return `${summary}${warning}${dataNote}<div class="yolo-empty result-state neutral"><strong>No enabled Cameras</strong>Enable or create a Camera to analyze this Target.</div>`;
      const disabledTargetNotice = target.enabled === false ? '<div class="comparison-notice result-state neutral"><strong>Current Target is disabled</strong>Camera rows are retained and shown as Unavailable.</div>' : '';
      const rows = coverage.rows.map(row => {
        const observation = row.observation;
        const yolo = row.yolo;
        const statusTitle = observation?.error ? ` title="${escapeHtml(observation.error)}"` : '';
        const tierClass = yolo.tier ? ` yolo-tier-${yolo.tier.key}` : '';
        return `<tr class="yolo-row${row.active ? ' is-active' : ''}" data-yolo-camera-id="${escapeHtml(row.cameraId)}"><th scope="row" class="yolo-camera"><button class="yolo-camera-button" type="button" data-yolo-camera-id="${escapeHtml(row.cameraId)}" aria-current="${row.active ? 'true' : 'false'}"><span class="yolo-camera-identity" style="background:${escapeHtml(cameraColor(row.camera, state.cameraOrder))}"></span><span class="yolo-camera-name">${escapeHtml(row.camera.name || row.camera.id)}</span>${row.active ? '<span class="yolo-active-label">Active Camera</span>' : ''}</button></th><td><span class="status-badge ${yolo.observationClassName}"${statusTitle}>${yolo.observationLabel}</span></td><td><span class="yolo-tier${tierClass}">${yolo.tier ? yolo.tier.label : '—'}</span></td><td class="comparison-number">${yolo.tier ? yoloValue(observation?.yolo?.shortSidePx, 1, ' px') : '—'}</td><td class="comparison-number">${yolo.tier ? yoloValue(observation?.yolo?.p3Cells, 2) : '—'}</td><td class="comparison-number">${yolo.tier ? yoloValue(observation?.yolo?.p4Cells, 2) : '—'}</td><td class="comparison-number">${yolo.tier ? yoloValue(observation?.yolo?.p5Cells, 2) : '—'}</td></tr>`;
      }).join('');
      return `${summary}${warning}${dataNote}${disabledTargetNotice}<div class="yolo-table-scroll" role="region" aria-label="YOLO Coverage table"><table class="yolo-table"><caption class="sr-only">YOLO Coverage observations for ${escapeHtml(target.name || target.id)}</caption><thead><tr><th scope="col">Camera</th><th scope="col">Observation status</th><th scope="col">YOLO tier</th><th scope="col">Short side</th><th scope="col">P3 cells</th><th scope="col">P4 cells</th><th scope="col">P5 cells</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    function renderWorkspace(state) {
      if (!els.workspaceContent) return;
      const active = state.uiState.activeWorkspaceTab === 'yolo' ? 'yolo' : 'comparison';
      if (els.workspaceTabs) Array.from(els.workspaceTabs.querySelectorAll('[data-workspace-tab]')).forEach(tab => tab.setAttribute('aria-selected', tab.dataset.workspaceTab === active ? 'true' : 'false'));
      const targetId = state.uiState.selectedTargetId;
      const targetFromState = targetId ? state.targetsById[targetId] : null;
      const target = selectedTarget(state);
      const enabledCount = state.cameraOrder.filter(id => state.camerasById[id]?.enabled !== false).length;
      const disabledCount = state.cameraOrder.filter(id => state.camerasById[id]?.enabled === false).length;
      if (els.workspaceSummary) els.workspaceSummary.textContent = `Current Target: ${targetFromState?.name || '—'} · ${enabledCount} enabled Cameras · ${disabledCount} disabled excluded`;
      if (state.uiState.panelOpen?.workspace !== true) {
        els.workspaceContent.innerHTML = `<div class="empty-next"><strong>${active === 'yolo' ? 'YOLO Coverage' : 'Camera Comparison'}</strong>Expand the workspace to load Observations.</div>`;
        return;
      }
      if (active === 'yolo') {
        els.workspaceContent.innerHTML = `<div class="yolo-view">${yoloCoverageMarkup(state, target)}</div>`;
        return;
      }
      if (!target) {
        els.workspaceContent.innerHTML = '<div class="comparison-empty result-state neutral"><strong>No Current Target</strong>Select a Target from Object Manager or the map.</div>';
        return;
      }
      els.workspaceContent.innerHTML = `<div class="comparison-view">${comparisonMarkup(state, target)}</div>`;
    }
    function renderMapSettings(state) {
      if (els.baseMapSelect) setValue(els.baseMapSelect, state.settings.baseMapKey || 'osm');
      if (els.surfaceToggle) { setChecked(els.surfaceToggle, state.settings.surfaceVisible !== false); els.surfaceToggle.disabled = surfaceLoadState !== 'ready'; }
      setChecked(els.cameraLabelsToggle, labelVisibility.camera); setChecked(els.targetLabelsToggle, labelVisibility.target);
      syncTileZoomOptions(state);
      if (els.surfaceState) els.surfaceState.textContent = surfaceLoadState === 'ready' ? '已載入' : surfaceLoadState === 'failed' ? '無法判定' : '載入中';
      if (els.surfaceHelp) els.surfaceHelp.textContent = surfaceLoadState === 'ready' ? '關閉視覺圖層不會停用 water／land／unknown 點擊分類。' : surfaceLoadState === 'failed' ? '請用 localhost 啟動；既有地圖與 Camera 計算仍可使用。' : '固定 GeoJSON 載入中。';
    }
    function legendMetrics() {
      const workspace = els.mapWorkspace, legend = els.mapLegend;
      if (!workspace || !legend || legend.hidden) return null;
      const workspaceRect = workspace.getBoundingClientRect?.() || {width: workspace.clientWidth, height: workspace.clientHeight, left: 0, top: 0, right: workspace.clientWidth, bottom: workspace.clientHeight};
      const legendRect = legend.getBoundingClientRect?.() || {width: legend.offsetWidth, height: legend.offsetHeight};
      const width = Math.max(0, Number(workspace.clientWidth) || Number(workspaceRect.width) || 0);
      const height = Math.max(0, Number(workspace.clientHeight) || Number(workspaceRect.height) || 0);
      const legendWidth = Math.max(0, Number(legend.offsetWidth) || Number(legendRect.width) || 0);
      const legendHeight = Math.max(0, Number(legend.offsetHeight) || Number(legendRect.height) || 0);
      return {workspace, legend, workspaceRect, width, height, legendWidth, legendHeight};
    }
    function legendDefaultPosition(metrics) {
      const zoom = metrics.workspace.querySelector?.('.leaflet-control-zoom');
      let bottomReserve = 56;
      if (zoom?.getBoundingClientRect) {
        const zoomRect = zoom.getBoundingClientRect();
        const zoomTop = Number(zoomRect.top) - Number(metrics.workspaceRect.top || 0);
        if (Number.isFinite(zoomTop)) bottomReserve = Math.max(8, metrics.height - zoomTop + 8);
      }
      const top = zoom?.getBoundingClientRect ? (Number(zoom.getBoundingClientRect().top) - Number(metrics.workspaceRect.top || 0) - metrics.legendHeight - 8) : metrics.height - metrics.legendHeight - bottomReserve;
      return {left: 8, top};
    }
    function clampLegendPosition(forceDefault = false) {
      const metrics = legendMetrics();
      if (!metrics || !metrics.width || !metrics.height) return;
      const maxLeft = Math.max(8, metrics.width - metrics.legendWidth - 8);
      const maxTop = Math.max(8, metrics.height - metrics.legendHeight - 8);
      const clamp = (value, max) => Math.max(8, Math.min(max, Number(value)));
      if (forceDefault || !legendPositionUserSet || legendPosition.left == null || legendPosition.top == null) {
        const position = legendDefaultPosition(metrics);
        legendPosition.left = clamp(position.left, maxLeft);
        legendPosition.top = clamp(position.top, maxTop);
      } else {
        legendPosition.left = clamp(legendPosition.left, maxLeft);
        legendPosition.top = clamp(legendPosition.top, maxTop);
      }
      metrics.legend.style.left = `${Math.round(legendPosition.left)}px`;
      metrics.legend.style.top = `${Math.round(legendPosition.top)}px`;
    }
    function scheduleLegendClamp() {
      if (legendClampFrame != null) return;
      const frame = view.requestAnimationFrame || (callback => view.setTimeout(callback, 0));
      legendClampFrame = frame(() => { legendClampFrame = null; if (!destroyed) clampLegendPosition(); });
    }
    function finishLegendDrag() {
      if (!legendDrag) return;
      try { legendDrag.handle.releasePointerCapture?.(legendDrag.pointerId); } catch (_) { /* capture may already be released */ }
      els.mapLegend?.classList.remove('is-dragging');
      legendDrag = null;
    }
    function cancelLegendDrag() {
      if (!legendDrag) return false;
      legendPosition.left = legendDrag.startLeft;
      legendPosition.top = legendDrag.startTop;
      finishLegendDrag();
      clampLegendPosition();
      return true;
    }
    function onLegendPointerDown(event) {
      const handle = event.target.closest?.('[data-legend-handle]');
      if (!handle || !els.mapLegend?.contains?.(handle) || event.isPrimary === false || (event.button != null && event.button !== 0)) {
        event.stopPropagation();
        return;
      }
      clampLegendPosition();
      event.preventDefault(); event.stopPropagation();
      legendDrag = {pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startLeft: legendPosition.left, startTop: legendPosition.top, handle};
      els.mapLegend.classList.add('is-dragging');
      handle.focus?.({preventScroll: true});
      try { handle.setPointerCapture?.(event.pointerId); } catch (_) { /* synthetic events may not have an active pointer */ }
    }
    function onLegendPointerMove(event) {
      if (!legendDrag || legendDrag.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      legendPosition.left = legendDrag.startLeft + event.clientX - legendDrag.startX;
      legendPosition.top = legendDrag.startTop + event.clientY - legendDrag.startY;
      legendPositionUserSet = true;
      clampLegendPosition();
    }
    function onLegendPointerUp(event) {
      if (!legendDrag || legendDrag.pointerId !== event.pointerId) { event.stopPropagation(); return; }
      event.preventDefault(); event.stopPropagation(); finishLegendDrag(); clampLegendPosition();
    }
    function onLegendClick(event) {
      event.stopPropagation();
      const reset = event.target.closest?.('[data-legend-reset]');
      if (reset && els.mapLegend?.contains?.(reset)) { event.preventDefault(); legendPosition.left = null; legendPosition.top = null; legendPositionUserSet = false; clampLegendPosition(true); }
    }
    function onLegendKeydown(event) {
      const handle = event.target.closest?.('[data-legend-handle]');
      if (event.key === 'Escape' && legendDrag) { event.preventDefault(); event.stopPropagation(); cancelLegendDrag(); return; }
      if (!handle || !els.mapLegend?.contains?.(handle)) return;
      const delta = event.shiftKey ? 24 : 8;
      const moves = {ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta]};
      if (!moves[event.key]) return;
      event.preventDefault(); event.stopPropagation(); clampLegendPosition();
      legendPositionUserSet = true;
      legendPosition.left += moves[event.key][0]; legendPosition.top += moves[event.key][1]; clampLegendPosition();
    }
    function renderMapLegend(state) {
      if (!els.mapLegend) return;
      const mode = state.uiState.fovColorMode === 'camera' ? 'camera' : 'coverage';
      if (mode === 'camera') {
        finishLegendDrag();
        els.mapLegend.hidden = true;
        return;
      }
      els.mapLegend.hidden = false;
      const referenceSize = comparisonNumber(state.settings.planningTargetHeightM);
      const markupKey = `coverage:${referenceSize == null ? '' : referenceSize}`;
      if (legendMarkupKey !== markupKey) {
        els.mapLegend.innerHTML = `<button class="map-legend-title" type="button" data-legend-handle aria-label="Drag Pixel coverage legend" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight">Pixel coverage</button><div class="map-legend-content"><div class="legend-item"><span class="legend-swatch" style="background:${YoloCoverage.COVERAGE_COLORS.robust}"></span>≥ 32 px</div><div class="legend-item"><span class="legend-swatch" style="background:${YoloCoverage.COVERAGE_COLORS.usable}"></span>16–&lt;32 px</div><div class="legend-item"><span class="legend-swatch" style="background:${YoloCoverage.COVERAGE_COLORS.difficult}"></span>8–&lt;16 px</div><div class="legend-item"><span class="legend-swatch" style="background:${YoloCoverage.COVERAGE_COLORS.notRecommended}"></span>&lt; 8 px</div><div class="tiny map-legend-help">Pixel thresholds are site-planning heuristics, not guaranteed YOLO detection performance.</div><div class="tiny map-legend-help">Based on Project planning reference size${referenceSize === null ? '' : ` (${referenceSize.toFixed(1)} m)`}.</div><button class="action-button map-legend-reset" type="button" data-legend-reset>重設位置</button></div>`;
        legendMarkupKey = markupKey;
      }
      clampLegendPosition();
    }
    function renderContextInspector(state) {
      const focused = state.uiState.focusedEntity, observation = state.uiState.inspectorTab === 'observation';
      if (els.contextTabs) Array.from(els.contextTabs.querySelectorAll('[data-inspector-tab]')).forEach(tab => tab.setAttribute('aria-selected', tab.dataset.inspectorTab === (observation ? 'observation' : 'details') ? 'true' : 'false'));
      const showCameraDetails = !observation && focused?.kind === 'camera';
      if (els.inspectorContent) els.inspectorContent.hidden = !showCameraDetails;
      if (els.resultContent) els.resultContent.hidden = showCameraDetails;
      if (showCameraDetails) { contextRenderKey = null; renderInspector(state); return; }
      const target = focused?.kind === 'target' ? state.targetsById[focused.id] : selectedTarget(state);
      const camera = selectedCamera(state);
      const currentObservation = observation && camera && target ? store.getObservation(camera.id, target.id) : null;
      if ($('cameraInspectorName')) $('cameraInspectorName').textContent = observation ? 'Observation' : (target?.name || 'Target');
      if ($('cameraInspectorSub')) $('cameraInspectorSub').textContent = observation ? 'Current Target observed by Active Camera' : 'Focused Target';
      if ($('cameraLifecycle')) { const badge = observation ? observationStatusBadge(currentObservation, camera, target) : {label: target?.locked ? 'Locked' : target?.enabled === false ? 'Disabled' : 'Target', className:''}; $('cameraLifecycle').textContent = badge.label; $('cameraLifecycle').className=`status-badge ${badge.className}`; }
      if (observation) renderObservation(state); else if (target) renderTargetDetails(state, target); else renderTargetCreation(state);
    }
    function renderInteraction(state) {
      const mode = state.uiState.interactionMode;
      rootElement.querySelectorAll('[data-mode]').forEach(button => { const active = button.dataset.mode === mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active ? 'true' : 'false'); });
      if (els.instruction) {
        els.instruction.hidden = mode === 'navigate';
        if (els.instructionText) {
          els.instructionText.textContent = mode === 'place-camera'
            ? (pendingCameraPlacement ? 'Step 2 of 2 · Point the Camera and click to confirm' : 'Step 1 of 2 · Click the Camera location')
            : 'Click the Target location';
        }
      }
      if (mode === 'place-camera') setStatus(pendingCameraPlacement ? 'Step 2 of 2 · Point the Camera and click to confirm' : 'Step 1 of 2 · Click the Camera location');
      else if (mode === 'place-target') setStatus('Click the Target location');
      else setStatus(surfaceLoadState === 'failed' ? 'Navigate：水陸圖資無法載入，分類結果會保留 unknown。' : 'Navigate：選取 Camera 後可拖曳未鎖定 marker。');
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
      if (mapFields[field]) { const value = field === 'heading' ? normalizeHeading(readCameraField(field)) : readCameraField(field); return value == null ? null : {[mapFields[field]]: value}; }
      if (field === 'cameraLat' || field === 'cameraLng') { const camera = selectedCamera(); const latitudeDeg = field === 'cameraLat' ? readCameraField(field) : camera?.position?.latitudeDeg; const longitudeDeg = field === 'cameraLng' ? readCameraField(field) : camera?.position?.longitudeDeg; return latitudeDeg == null || longitudeDeg == null ? null : {position: {latitudeDeg, longitudeDeg}, lifecycle: 'placed'}; }
      return null;
    }
    function commitCameraField(field) {
      const id = selectedCameraId(); if (!id) return;
      const patch = cameraPatchForField(field); if (!patch) { renderInspector(store.getState()); setStatus(`${field} 必須是有限數值。`); return; }
      const state = store.getState(); if (state.preview?.kind === 'camera' && state.preview.id === id) store.commitPreview(`camera-${field}`); else store.patchCamera(id, patch, `camera-${field}`);
    }
    function previewCameraField(field) { const id = selectedCameraId(); const patch = cameraPatchForField(field); if (id && patch) store.beginPreview('camera', id, patch); }
    function commitCameraForm() { const id = selectedCameraId(); if (!id) return; const fields = ['sensorW', 'sensorH', 'resW', 'resH', 'focal', 'camHeight', 'heading', 'tilt']; const patch = {}; fields.forEach(field => { const value = field === 'heading' ? normalizeHeading(readCameraField(field)) : readCameraField(field); const key = {sensorW: 'sensorWidthMm', sensorH: 'sensorHeightMm', resW: 'widthPx', resH: 'heightPx', focal: 'focalLengthMm', camHeight: 'heightM', heading: 'headingDeg', tilt: 'tiltDownDeg'}[field]; if (value != null) patch[key] = value; }); if (Object.keys(patch).length) { store.cancelPreview(); store.patchCamera(id, patch, 'camera-form'); } }
    function headingFromPointer(event) {
      const rect = els.headingScrubber?.getBoundingClientRect?.(); if (!rect || !rect.width) return null;
      const ratio = Math.max(0, Math.min(1, (Number(event.clientX) - rect.left) / rect.width)); return normalizeHeading(ratio * 360);
    }
    function finishHeadingDrag(commit) {
      if (!headingDrag) return false;
      const drag = headingDrag; headingDrag = null;
      try { drag.scrubber.releasePointerCapture?.(drag.pointerId); } catch (_) { /* capture may already be released */ }
      if (commit) store.commitPreview('camera-heading-scrub'); else store.cancelPreview();
      drag.scrubber.classList.remove('is-dragging');
      return true;
    }
    function onHeadingPointerDown(event) {
      const camera = selectedCamera(), scrubber = els.headingScrubber;
      if (!scrubber || !camera || camera.locked === true || event.isPrimary === false || (event.button != null && event.button !== 0)) return;
      const value = headingFromPointer(event); if (value == null) return;
      event.preventDefault(); event.stopPropagation(); store.cancelPreview();
      headingDrag = {pointerId: event.pointerId, cameraId: camera.id, scrubber, startHeading: normalizeHeading(camera.headingDeg) ?? 0};
      scrubber.classList.add('is-dragging'); scrubber.focus({preventScroll: true});
      try { scrubber.setPointerCapture?.(event.pointerId); } catch (_) { /* synthetic events may not have an active pointer */ }
      store.beginPreview('camera', camera.id, {headingDeg: value});
    }
    function onHeadingPointerMove(event) {
      if (!headingDrag || headingDrag.pointerId !== event.pointerId) return;
      const value = headingFromPointer(event); if (value == null) return;
      event.preventDefault(); event.stopPropagation(); store.beginPreview('camera', headingDrag.cameraId, {headingDeg: value});
    }
    function onHeadingPointerUp(event) {
      if (!headingDrag || headingDrag.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation(); finishHeadingDrag(event.type !== 'pointercancel');
    }
    function onHeadingKeydown(event) {
      const scrubber = els.headingScrubber; if (!scrubber || event.target !== scrubber) return;
      const camera = selectedCamera(); if (!camera || camera.locked === true) return;
      const current = normalizeHeading(camera.headingDeg) ?? 0; let next = null;
      if (event.key === 'Home') next = 0; else if (event.key === 'End') next = 359; else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { const delta = event.shiftKey ? 10 : 1; next = normalizeHeading(current + (event.key === 'ArrowRight' ? delta : -delta)); }
      if (next == null) return;
      event.preventDefault(); event.stopPropagation(); store.beginPreview('camera', camera.id, {headingDeg: next}); store.commitPreview('camera-heading-key');
    }
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
    function addTargetFromDraft(targetDraft) {
      const state = store.getState();
      const id = store.addTarget({name: `Target ${state.targetOrder.length + 1}`, anchor: 'bottom-center', lifecycle: 'placed', visible: true, enabled: true, locked: false, ...targetDraft});
      store.selectTarget(id);
      setInteractionMode('navigate');
      setTargetError('');
      showObservation();
      return id;
    }
    function createTargetFromForm() {
      const latitude = num($('targetLat')?.value); const longitude = num($('targetLng')?.value); const lengthM = num($('targetLong')?.value); const widthM = num($('targetShort')?.value); const heightM = num($('targetHeight')?.value); const headingDeg = num($('targetHeading')?.value);
      if (![latitude, longitude, lengthM, widthM, heightM, headingDeg].every(value => value != null)) { setTargetError('請輸入有效的 latitude、longitude、尺寸與 heading。'); return null; }
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || lengthM <= 0 || widthM <= 0 || heightM <= 0) { setTargetError('座標必須在合法範圍，尺寸必須大於 0。'); return null; }
      return addTargetFromDraft({position: {latitudeDeg: latitude, longitudeDeg: longitude}, lengthM, widthM, heightM, headingDeg});
    }
    function createTargetFromMap(latlng) {
      const state = store.getState();
      return addTargetFromDraft({position: {latitudeDeg: latlng.lat, longitudeDeg: latlng.lng}, lengthM: 5, widthM: 2, heightM: state.settings.planningTargetHeightM || 2, headingDeg: 0});
    }
    function targetFormValuesForSelected() { return {latitudeDeg: num($('targetLat')?.value), longitudeDeg: num($('targetLng')?.value)}; }

    function clearPendingCameraPlacement() {
      pendingCameraPlacement = null;
      cameraPlacementDefaultsSnapshot = null;
      mapController?.clearCameraPlacementPreview?.();
    }
    function setInteractionMode(mode) {
      if (mode !== 'navigate') leaveFocusMapMode();
      if (mode !== 'place-camera') clearPendingCameraPlacement();
      store.cancelPreview();
      store.setInteractionMode(mode);
      renderInteraction(store.getState());
    }
    function beginCameraPlacement() {
      leaveFocusMapMode();
      clearPendingCameraPlacement();
      store.cancelPreview();
      cameraPlacementDefaultsSnapshot = cameraDefaultsRepository.getDefaults();
      store.setObjectManagerTab('cameras');
      store.setInteractionMode('place-camera');
      renderInteraction(store.getState());
    }
    function cameraPlacementDraft(anchor, cameraDefaults) {
      const state = store.getState();
      return {name: `Camera ${state.cameraOrder.length + 1}`, ...cameraDefaults, headingDeg: DEFAULT_CAMERA.headingDeg, color: CAMERA_COLORS[state.cameraOrder.length % CAMERA_COLORS.length], position: {latitudeDeg: anchor.latitudeDeg, longitudeDeg: anchor.longitudeDeg}, lifecycle: 'placed', visible: true, enabled: true, locked: false};
    }
    function placementDistancePx(anchor, latlng, originalEvent) {
      if (!map || !originalEvent || !map.mouseEventToContainerPoint || !map.latLngToContainerPoint || !L?.latLng) return Infinity;
      const cursorPoint = map.mouseEventToContainerPoint(originalEvent), anchorPoint = map.latLngToContainerPoint(L.latLng(anchor.latitudeDeg, anchor.longitudeDeg));
      if (cursorPoint?.distanceTo) return cursorPoint.distanceTo(anchorPoint);
      return Math.hypot(Number(cursorPoint?.x) - Number(anchorPoint?.x), Number(cursorPoint?.y) - Number(anchorPoint?.y));
    }
    function beginCameraDirection(latlng) {
      const anchor = {latitudeDeg: Number(latlng.lat), longitudeDeg: Number(latlng.lng)};
      pendingCameraPlacement = {step: 'direction', anchor, headingDeg: DEFAULT_CAMERA.headingDeg, cameraDraft: cameraPlacementDraft(anchor, cameraPlacementDefaultsSnapshot || cameraDefaultsRepository.getDefaults())};
      mapController.setCameraPlacementPreview?.(pendingCameraPlacement.cameraDraft);
      renderInteraction(store.getState());
      setStatus('Step 2 of 2 · Point the Camera and click to confirm');
    }
    function handleMapMove(latlng) {
      const state = store.getState();
      if (state.uiState.interactionMode !== 'place-camera' || !pendingCameraPlacement?.anchor) return;
      const cursor = {latitudeDeg: Number(latlng.lat), longitudeDeg: Number(latlng.lng)};
      const headingDeg = Core.bearingBetween(pendingCameraPlacement.anchor, cursor);
      pendingCameraPlacement.headingDeg = headingDeg;
      pendingCameraPlacement.cameraDraft = {...pendingCameraPlacement.cameraDraft, headingDeg};
      mapController.setCameraPlacementPreview?.(pendingCameraPlacement.cameraDraft);
    }
    function handleMapClick(latlng, originalEvent) {
      const state = store.getState();
      if (state.uiState.interactionMode === 'place-camera') {
        if (!pendingCameraPlacement) { beginCameraDirection(latlng); return; }
        if (placementDistancePx(pendingCameraPlacement.anchor, latlng, originalEvent) < 8) { setStatus('Move the cursor at least 8 px from the Camera location before confirming.'); return; }
        const cursor = {latitudeDeg: Number(latlng.lat), longitudeDeg: Number(latlng.lng)};
        const headingDeg = Core.bearingBetween(pendingCameraPlacement.anchor, cursor);
        const cameraDraft = {...pendingCameraPlacement.cameraDraft, position: pendingCameraPlacement.anchor, headingDeg, lifecycle: 'placed'};
        clearPendingCameraPlacement();
        const id = store.addCamera(cameraDraft);
        store.selectCamera(id);
        store.setObjectManagerTab('cameras');
        store.setInspectorTab('details');
        setInteractionMode('navigate');
        showDetails('camera', id);
        return;
      }
      if (state.uiState.interactionMode === 'place-target') createTargetFromMap(latlng);
      else if (state.uiState.interactionMode === 'navigate' && !state.uiState.panelOpen.mapSettings && !legendDrag) { store.clearFocusedEntity(); closeInspector(); }
    }
    function handleCameraDrag(id, latlng) { store.beginPreview('camera', id, {position: {latitudeDeg: latlng.lat, longitudeDeg: latlng.lng}}); store.commitPreview('camera-drag'); }
    function handleCameraSelect(id) { store.setObjectManagerTab?.('cameras'); showDetails('camera', id); }
    function handleTargetSelect(id) { store.setObjectManagerTab?.('targets'); showDetails('target', id); }

    if (!mapController && map && L && MapApi) mapController = MapApi.createMapController({map, leaflet: L, store, onMapClick: handleMapClick, onMapMove: handleMapMove, onCameraSelect: handleCameraSelect, onTargetSelect: handleTargetSelect, labelVisibility});
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
      lastState = state; renderTopBar(state); renderPanelVisibility(state); renderRail(state); renderContextInspector(state); renderWorkspace(state); renderMapSettings(state); renderMapFovControl(state); renderMapLegend(state); renderInteraction(state); renderProjectSettings(); syncMapBaseLayer(state); syncSurfaceLayer(state); mapController.sync(state);
    }
    const unsubscribe = store.subscribe(render);

    function closeOverflowMenu({restoreFocus = false} = {}) {
      if (!overflowMenu) return;
      const {button, menu} = overflowMenu;
      if (button?.isConnected) { button.setAttribute('aria-expanded', 'false'); if (restoreFocus) button.focus(); }
      menu?.remove(); overflowMenu = null;
    }
    function positionOverflowMenu(menu, button) {
      const rect = button.getBoundingClientRect(), margin = 8, width = menu.offsetWidth || 176, height = menu.offsetHeight || 180;
      const left = Math.max(margin, Math.min(rect.right - width, (view.innerWidth || 0) - width - margin));
      const top = rect.bottom + height + margin <= (view.innerHeight || 0) ? rect.bottom + 4 : Math.max(margin, rect.top - height - 4);
      menu.style.left = `${left}px`; menu.style.top = `${top}px`;
    }
    function openOverflowMenu(button, kind, id) {
      if (overflowMenu?.button === button) { closeOverflowMenu({restoreFocus: true}); return; }
      closeOverflowMenu();
      const entity = kind === 'camera' ? store.getCamera(id) : store.getTarget(id); if (!entity) return;
      const menu = doc.createElement('div'); menu.id = button.getAttribute('aria-controls'); menu.className = 'manager-overflow-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', `${entity.name || entity.id} 的操作`);
      [['rename', 'Rename'], ['fit', 'Fit on map'], ['duplicate', 'Duplicate']].forEach(([action, label]) => { const option = doc.createElement('button'); option.type='button'; option.textContent=label; option.dataset.overflowAction=action; option.dataset.entityKind=kind; option.dataset.entityId=id; option.setAttribute('role','menuitem'); menu.appendChild(option); });
      const divider = doc.createElement('div'); divider.className='manager-overflow-divider'; divider.setAttribute('role','separator'); menu.appendChild(divider);
      const remove = doc.createElement('button'); remove.type='button'; remove.textContent='Delete'; remove.className='danger'; remove.dataset.overflowAction='delete'; remove.dataset.entityKind=kind; remove.dataset.entityId=id; remove.setAttribute('role','menuitem'); menu.appendChild(remove);
      doc.body.appendChild(menu); button.setAttribute('aria-expanded','true'); overflowMenu = {button, menu}; positionOverflowMenu(menu, button);
    }
    function performEntityAction(kind, id, verb) {
      const entity=kind==='camera'?store.getCamera(id):store.getTarget(id); if(!entity)return;
      if (verb === 'rename') { const name=view.prompt(`${kind} 名稱`,entity.name||kind); if(name&&name.trim()) return kind==='camera'?store.patchCamera(id,{name:name.trim()},`${kind}-rename`):store.patchTarget(id,{name:name.trim()},`${kind}-rename`); }
      if (verb === 'fit') return kind==='camera'?mapController.fitCamera?.(id):mapController.fitTarget?.(id);
      if (verb === 'duplicate') return kind==='camera'?store.duplicateCamera(id):store.duplicateTarget(id);
      if (verb === 'delete' && view.confirm(`刪除 ${entity.name||id}？`)) return kind==='camera'?store.removeCamera(id):store.removeTarget(id);
    }
    function onCameraRailClick(event) {
      const action = event.target.closest?.('[data-entity-action]'), item = event.target.closest?.('[data-entity-id]');
      const overflow = event.target.closest?.('[data-entity-overflow]');
      if (overflow) { event.stopPropagation(); openOverflowMenu(overflow, overflow.dataset.entityKind, overflow.dataset.entityId); return; }
      if (action) { event.stopPropagation(); closeOverflowMenu(); const kind=action.dataset.entityKind, id=action.dataset.entityId, entity=kind==='camera'?store.getCamera(id):store.getTarget(id); if(!entity)return; const verb=action.dataset.entityAction; if(['visible','enabled','locked'].includes(verb)) return kind==='camera'?store.patchCamera(id,{[verb]:verb==='locked'?!entity.locked:!(entity[verb]!==false)},`${kind}-${verb}`):store.patchTarget(id,{[verb]:verb==='locked'?!entity.locked:!(entity[verb]!==false)},`${kind}-${verb}`); }
      if (item) { closeOverflowMenu(); store.cancelPreview(); if (item.dataset.entityKind === 'camera') store.selectCamera(item.dataset.entityId); else store.selectTarget(item.dataset.entityId); showDetails(item.dataset.entityKind, item.dataset.entityId); }
    }
    function onCameraRailKeydown(event) { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-entity-id]')) { event.preventDefault(); closeOverflowMenu(); store.cancelPreview(); if (event.target.dataset.entityKind === 'camera') store.selectCamera(event.target.dataset.entityId); else store.selectTarget(event.target.dataset.entityId); showDetails(event.target.dataset.entityKind,event.target.dataset.entityId); } }
    function onOverflowClick(event) { const option = event.target.closest?.('[data-overflow-action]'); if (!option) return; event.stopPropagation(); const {entityKind: kind, entityId: id, overflowAction: verb} = option.dataset; closeOverflowMenu(); performEntityAction(kind, id, verb); }
    function onInspectorClick(event) { const button = event.target.closest?.('button'); if (!button) return; const id = button.id; const state = store.getState(); const camera = selectedCamera(state), target = selectedTarget(state); if (id === 'closeInspector') return closeInspector(); if (id === 'fitCamera') return camera && mapController.fitCamera?.(camera.id); if (id === 'fitFov') return camera && mapController.fitCameraFov?.(camera.id); if (id === 'duplicateCamera') { if (camera) { store.duplicateCamera(camera.id); store.setInspectorTab('details'); } return; } if (id === 'renameCamera') { if (camera) { const next = view.prompt('Camera 名稱', camera.name || 'Camera'); if (next && next.trim()) store.patchCamera(camera.id, {name: next.trim()}, 'camera-rename'); } return; } if (id === 'deleteCamera') { if (camera && view.confirm(`刪除 ${camera.name || camera.id}？`)) store.removeCamera(camera.id); return; } if (id === 'resetCamera') { if (camera && !camera.locked) store.patchCamera(camera.id, cameraDefaultsRepository.getDefaults(), 'camera-reset'); return; } if (id === 'fitTarget') return target && mapController.fitTarget?.(target.id); if (id === 'fitCameraTarget') return camera && target && mapController.fitCameraAndTarget?.(camera.id,target.id); if (id === 'duplicateTarget') { if (target) { store.duplicateTarget(target.id); store.setInspectorTab('details'); } return; } if (id === 'renameTarget') { if (target) { const next=view.prompt('Target 名稱',target.name||'Target'); if(next&&next.trim())store.patchTarget(target.id,{name:next.trim()},'target-rename'); } return; } if (id === 'deleteTarget' && target && view.confirm(`刪除 ${target.name||target.id}？`)) { store.removeTarget(target.id); store.setInspectorTab('details'); return; } if (id === 'downloadCameraScene') return downloadScene(); if (id === 'copyCameraScene') return copyScene(); }
    function activateWorkspaceCamera(id, workspaceTab, selector) {
      const camera = store.getCamera(id);
      if (!camera || camera.enabled === false) return;
      leaveFocusMapMode();
      store.cancelPreview();
      store.setActiveWorkspaceTab(workspaceTab);
      store.selectCamera(id);
      setPanel('workspace', true);
      showInspector();
      const focus = () => Array.from(rootElement.querySelectorAll(selector)).find(button => (button.dataset.comparisonCameraId || button.dataset.yoloCameraId) === id)?.focus();
      (view.requestAnimationFrame || (callback => view.setTimeout(callback, 0)))(focus);
    }
    function activateComparisonCamera(id) { activateWorkspaceCamera(id, 'comparison', '.comparison-camera-button'); }
    function activateYoloCoverageCamera(id) { activateWorkspaceCamera(id, 'yolo', '.yolo-camera-button'); }
    function onShellClick(event) {
      if (event.target.closest?.('#projectMenuToggle')) { if (projectMenuOpen) closeProjectMenu(); else openProjectMenu(); return; }
      if (event.target.closest?.('#newProjectMenuItem')) { requestProjectChange(createNewProject); return; }
      if (event.target.closest?.('#openProjectMenuItem')) { chooseProjectFile(); return; }
      if (event.target.closest?.('#saveProjectMenuItem')) { closeProjectMenu({restoreFocus: false}); saveProjectFile(); return; }
      if (event.target.closest?.('#renameProjectMenuItem')) { closeProjectMenu({restoreFocus: false}); openProjectRename(); return; }
      if (event.target === els.projectGuardModal) { closeProjectGuard(); return; }
      if (event.target.closest?.('#projectGuardSave')) { continueAfterGuardSave(); return; }
      if (event.target.closest?.('#projectGuardDiscard')) { discardAndContinueProjectChange(); return; }
      if (event.target.closest?.('#projectGuardCancel')) { closeProjectGuard(); return; }
      if (event.target === els.projectRenameModal) { closeProjectRename(); return; }
      if (event.target.closest?.('#projectRenameClose')) { closeProjectRename(); return; }
      if (event.target.closest?.('#projectRenameConfirm')) { renameProjectFromDialog(); return; }
      if (event.target.closest?.('#projectRenameCancel')) { closeProjectRename(); return; }
      if (event.target.closest?.('#toggleObjectManager')) { togglePanel('objectManager'); return; }
      if (event.target.closest?.('#openInspector')) { togglePanel('inspector'); return; }
      if (event.target.closest?.('#focusMapButton')) { toggleFocusMap(); return; }
      if (event.target.closest?.('#closeObjectManager')) { setPanel('objectManager', false); return; }
      const comparisonCamera = event.target.closest?.('[data-comparison-camera-id]');
      if (comparisonCamera) { activateComparisonCamera(comparisonCamera.dataset.comparisonCameraId); return; }
      const yoloCamera = event.target.closest?.('[data-yolo-camera-id]');
      if (yoloCamera) { activateYoloCoverageCamera(yoloCamera.dataset.yoloCameraId); return; }
      const fovColorMode = event.target.closest?.('[data-fov-color-mode]');
      if (fovColorMode) { store.setFovColorMode(fovColorMode.dataset.fovColorMode); return; }
      const modeButton = event.target.closest?.('[data-mode]');
      if (modeButton) { const mode = modeButton.dataset.mode; if (mode === 'place-camera') beginCameraPlacement(); else setInteractionMode(mode); return; }
      if (event.target.closest?.('#cancelPlacement')) { cancelPlacementInteraction(); return; }
      const sectionToggle = event.target.closest?.('[data-section-toggle]');
      if (sectionToggle) { const body = rootElement.querySelector(`[data-section-body="${sectionToggle.dataset.sectionToggle}"]`); const expanded = sectionToggle.getAttribute('aria-expanded') !== 'false'; sectionToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true'); if (body) body.hidden = expanded; return; }
      const managerTab = event.target.closest?.('[data-manager-tab]'); if (managerTab) { closeOverflowMenu(); store.setObjectManagerTab(managerTab.dataset.managerTab); return; }
      const inspectorTab = event.target.closest?.('[data-inspector-tab]'); if (inspectorTab) { store.setInspectorTab(inspectorTab.dataset.inspectorTab); return; }
      const workspaceTab = event.target.closest?.('[data-workspace-tab]');
      if (workspaceTab) { store.setActiveWorkspaceTab(workspaceTab.dataset.workspaceTab); return; }
      if (event.target.closest?.('#workspaceToggle')) { setPanel('workspace', !(store.getState().uiState.panelOpen.workspace)); return; }
      if (event.target.closest?.('#openProjectSettings')) { openProjectSettings(); return; }
      if (event.target.closest?.('#mapSettingsToggle')) { setPanel('mapSettings', !(store.getState().uiState.panelOpen.mapSettings)); return; }
      if (event.target.closest?.('#closeMapSettings')) { setPanel('mapSettings', false); return; }
    }
    function onGlobalClick(event) { if (overflowMenu && !event.target.closest?.('.manager-overflow-menu, [data-entity-overflow]')) closeOverflowMenu(); if (projectMenuOpen && !event.target.closest?.('.project-menu')) closeProjectMenu({restoreFocus: false}); if (els.mapSettingsPopover && !els.mapSettingsPopover.hidden && !event.target.closest?.('#mapSettingsAnchor')) setPanel('mapSettings', false); }
    function onProjectSettingsClick(event) {
      if (event.target === els.projectSettingsModal) return closeProjectSettings();
      const button = event.target.closest?.('button');
      if (!button) return;
      const accordionKey = button.dataset.settingsAccordion;
      if (accordionKey && Object.prototype.hasOwnProperty.call(projectSettingsAccordion, accordionKey)) {
        projectSettingsAccordion[accordionKey] = !projectSettingsAccordion[accordionKey];
        renderProjectSettings();
        return;
      }
      if (button.id === 'projectSettingsClose' || button.id === 'projectSettingsCancel') return closeProjectSettings();
      if (button.id === 'projectUseSelectedCamera') return useSelectedCameraForProjectSettings();
      if (button.id === 'projectRestoreFactory') { projectSettingsDraft = cameraDefaultsRepository.factoryDefaults(); projectSettingsSensorMode = sensorPresetKey(projectSettingsDraft); projectSettingsResolutionMode = resolutionPresetKey(projectSettingsDraft); projectSettingsPresetId = CameraPresets.FACTORY_PRESET_ID; setProjectSettingsError(''); setProjectSettingsStatus(''); syncProjectSettingsForm(projectSettingsDraft); syncProjectPresetLibrary(); return; }
      if (button.id === 'projectPresetLoad') return loadProjectPreset();
      if (button.id === 'projectPresetSetDefault') return setProjectPresetAsDefault();
      if (button.id === 'projectPresetCreateFromForm') return createProjectPresetFromSettings(projectSettingsDefaultsFromForm(), 'New Camera Preset');
      if (button.id === 'projectPresetCreateFromCamera') return createProjectPresetFromSettings(cameraDefaultsFromCamera(selectedCamera()), selectedCamera()?.name || 'Camera Preset');
      if (button.id === 'projectPresetUpdate') return updateProjectPreset();
      if (button.id === 'projectPresetRename') return renameProjectPreset();
      if (button.id === 'projectPresetDuplicate') return duplicateProjectPreset();
      if (button.id === 'projectPresetDelete') return deleteProjectPreset();
      if (button.id === 'projectPresetExport') return exportProjectPresetLibrary();
      if (button.id === 'projectPresetImport') { els.projectPresetImportFile?.click(); return; }
      if (button.id === 'projectPresetImportApply') return applyProjectImport();
      if (button.id === 'projectPresetImportCancel') { resetProjectImportState(); setProjectSettingsStatus('已取消匯入；尚未套用任何變更。'); renderProjectImport(); return; }
      if (button.id === 'projectSaveDefaults') return saveProjectSettings();
    }
    function cancelPlacementInteraction() { clearPendingCameraPlacement(); store.cancelPreview(); if (store.getState().uiState.interactionMode !== 'navigate') store.setInteractionMode('navigate'); renderInteraction(store.getState()); }
    function onKeydown(event) {
      if (projectSettingsOpen) {
        if (event.key === 'Escape') { event.preventDefault(); closeProjectSettings(); return; }
        if (event.key === 'Tab') {
          const focusable = Array.from(els.projectSettingsDialog?.querySelectorAll?.('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []).filter(element => !element.hidden && element.offsetParent !== null);
          if (!focusable.length) { event.preventDefault(); return; }
          const current = focusable.indexOf(doc.activeElement);
          const next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : (current === focusable.length - 1 ? 0 : current + 1);
          event.preventDefault(); focusable[next].focus();
        }
        return;
      }
      if (projectGuardOpen) {
        if (event.key === 'Escape') { event.preventDefault(); closeProjectGuard(); return; }
        if (event.key === 'Tab') {
          const focusable = focusableIn(els.projectGuardDialog);
          if (!focusable.length) { event.preventDefault(); return; }
          const current = focusable.indexOf(doc.activeElement);
          const next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : (current === focusable.length - 1 ? 0 : current + 1);
          event.preventDefault(); focusable[next].focus();
        }
        return;
      }
      if (projectRenameOpen) {
        if (event.key === 'Escape') { event.preventDefault(); closeProjectRename(); return; }
        if (event.key === 'Enter' && doc.activeElement === els.projectRenameInput) { event.preventDefault(); renameProjectFromDialog(); return; }
        if (event.key === 'Tab') {
          const focusable = focusableIn(els.projectRenameDialog);
          if (!focusable.length) { event.preventDefault(); return; }
          const current = focusable.indexOf(doc.activeElement);
          const next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : (current === focusable.length - 1 ? 0 : current + 1);
          event.preventDefault(); focusable[next].focus();
        }
        return;
      }
      if (projectMenuOpen) {
        if (event.key === 'Escape') { event.preventDefault(); closeProjectMenu(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const items = Array.from(els.projectMenu?.querySelectorAll?.('[role="menuitem"]') || []);
          if (items.length) {
            const current = Math.max(0, items.indexOf(doc.activeElement));
            const offset = event.key === 'ArrowDown' ? 1 : -1;
            items[(current + offset + items.length) % items.length].focus();
            event.preventDefault();
          }
        }
        return;
      }
      if ((event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') && doc.activeElement === els.projectMenuToggle) {
        event.preventDefault();
        openProjectMenu();
        return;
      }
      if (event.key !== 'Escape') return;
      if (legendDrag && cancelLegendDrag()) { event.preventDefault(); event.stopPropagation(); return; }
      if (headingDrag && finishHeadingDrag(false)) { event.preventDefault(); event.stopPropagation(); return; }
      if (overflowMenu) { closeOverflowMenu({restoreFocus: true}); return; }
      const state = store.getState(); if (state.uiState.interactionMode !== 'navigate') { event.preventDefault(); cancelPlacementInteraction(); return; } if (state.uiState.panelOpen.mapSettings) return setPanel('mapSettings', false); if (state.uiState.focusMapMode) { event.preventDefault(); store.setFocusMapMode(false); return; } if (state.uiState.focusedEntity) { event.preventDefault(); store.clearFocusedEntity(); closeInspector(); return; } const narrow = Number(view.innerWidth || 1920) < 1366 || Number(view.devicePixelRatio || 1) >= 2; if (narrow && state.uiState.panelOpen.inspector) closeInspector();
    }
    function onInput(event) { const element = event.target; if (Object.prototype.hasOwnProperty.call(projectSettingsFieldMap, element.id)) { updateProjectSettingsDraftFromForm(); return; } if (element.id === 'objectManagerSearch') { const kind=store.getState().uiState.objectManagerTab === 'targets'?'target':'camera'; (kind==='camera'?store.setCameraSearchQuery:store.setTargetSearchQuery)(element.value); return; } if (element.id === 'targetSearch') { store.setTargetSearchQuery(element.value); return; } if (element.dataset.cameraField) previewCameraField(element.dataset.cameraField); if (element.dataset.targetField) previewTargetField(element.dataset.targetField); }
    function onChange(event) { const element = event.target; if (element.id === 'projectSensorFormat') return applyProjectSensorPreset(); if (element.id === 'projectResolutionPreset') return applyProjectResolutionPreset(); if (element.id === 'projectPresetSelect') { projectSettingsPresetId = element.value; syncProjectPresetLibrary(); return; } if (element.id === 'projectPresetImportMerge' || element.id === 'projectPresetImportReplace') { projectImportMode = element.value; return replanProjectImport(); } if (element.id === 'projectPresetImportDefaults') { projectImportApplyDefaults = element.checked; return replanProjectImport(); } if (element.id === 'cameraPresetSelect') { inspectorPresetSelectionId = element.value; if (els.cameraPresetApply) els.cameraPresetApply.disabled = !selectedCamera() || selectedCamera()?.locked === true; return; } if (Object.prototype.hasOwnProperty.call(projectSettingsFieldMap, element.id)) { updateProjectSettingsDraftFromForm(); return; } if (element.dataset.cameraField) commitCameraField(element.dataset.cameraField); if (element.dataset.targetField) commitTargetField(element.dataset.targetField); if (element.id === 'sensorFormat') applySensorPreset(); if (element.id === 'resolutionPreset') applyResolutionPreset(); if (element.id === 'orientation') store.patchSettings({coverageTargetDimension: element.value}, 'coverage-dimension'); if (element.id === 'baseMapSelect') store.patchSettings({baseMapKey: element.value}, 'base-map'); if (element.id === 'surfaceToggle') store.patchSettings({surfaceVisible: element.checked}, 'surface-visibility'); if (element.id === 'tileZoomSelect') store.patchSettings({tileZoom: Number(element.value)}, 'tile-zoom'); if (element.id === 'cameraLabelsToggle') { labelVisibility.camera = element.checked; mapController.setLabelVisibility?.({camera: element.checked}); } if (element.id === 'targetLabelsToggle') { labelVisibility.target = element.checked; mapController.setLabelVisibility?.({target: element.checked}); } }
    function onBlur(event) { const element = event.target; if (element.dataset.cameraField) commitCameraField(element.dataset.cameraField); if (element.dataset.targetField) commitTargetField(element.dataset.targetField); }
    function onEnter(event) { if (event.key === 'Enter') { const element = event.target; if (element.dataset.cameraField) { event.preventDefault(); commitCameraField(element.dataset.cameraField); } if (element.dataset.targetField) { event.preventDefault(); commitTargetField(element.dataset.targetField); } } }
    function onFormClick(event) { if (event.target.id === 'createTarget') createTargetFromForm(); if (event.target.closest?.('#cameraPresetApply')) applyInspectorPreset(); }

    listen(els.cameraRailItems, 'click', onCameraRailClick); listen(els.cameraRailItems, 'keydown', onCameraRailKeydown); listen(els.cameraRailItems, 'scroll', () => closeOverflowMenu()); listen(els.cameraSelect, 'change', event => { store.cancelPreview(); store.selectCamera(event.target.value); });
    listen(els.mapLegend, 'pointerdown', onLegendPointerDown); listen(els.mapLegend, 'pointermove', onLegendPointerMove); listen(els.mapLegend, 'pointerup', onLegendPointerUp); listen(els.mapLegend, 'pointercancel', onLegendPointerUp); listen(els.mapLegend, 'click', onLegendClick); listen(els.mapLegend, 'keydown', onLegendKeydown);
    listen(els.headingScrubber, 'pointerdown', onHeadingPointerDown); listen(els.headingScrubber, 'pointermove', onHeadingPointerMove); listen(els.headingScrubber, 'pointerup', onHeadingPointerUp); listen(els.headingScrubber, 'pointercancel', onHeadingPointerUp); listen(els.headingScrubber, 'keydown', onHeadingKeydown);
    listen(els.inspector, 'click', onInspectorClick); listen(els.projectSettingsModal, 'click', onProjectSettingsClick); listen(els.projectPresetImportFile, 'change', event => handleProjectImportFile(event.target.files?.[0] || null)); listen(els.projectOpenFile, 'change', event => handleProjectFile(event.target.files?.[0] || null)); listen(els.appShell, 'click', onShellClick); listen(els.appShell, 'click', onFormClick); listen(doc, 'click', onOverflowClick); listen(doc, 'click', onGlobalClick); listen(doc, 'keydown', onKeydown); listen(els.appShell, 'input', onInput); listen(els.appShell, 'change', onChange); listen(els.appShell, 'blur', onBlur, true); listen(els.appShell, 'keydown', onEnter); listen(view, 'beforeunload', onBeforeUnload);
    listen($('addCamera'), 'click', beginCameraPlacement);
    listen($('addTargetManager'), 'click', () => { setInteractionMode('place-target'); });
    listen($('undoButton'), 'click', () => store.undo()); listen($('redoButton'), 'click', () => store.redo());
    if (view.ResizeObserver) { resizeObserver = new view.ResizeObserver(scheduleInvalidate); if (els.appShell) resizeObserver.observe(els.appShell); if (els.inspector) resizeObserver.observe(els.inspector); if (els.mapWorkspace) resizeObserver.observe(els.mapWorkspace); }
    listen(view, 'resize', scheduleInvalidate);
    loadSurface();
    render(store.getState());
    scheduleInvalidate();

    const publicApi = {store, mapController, cameraDefaultsRepository, cameraPresetsRepository, cameraPresetCoordinator, render, openProjectSettings, closeProjectSettings, saveProjectFile, chooseProjectFile, createNewProject, openProjectRename, applyOpenedProject, destroy() { if (destroyed) return; destroyed = true; pendingCameraPlacement = null; cameraPlacementDefaultsSnapshot = null; closeProjectSettings({restoreFocus: false}); closeProjectGuard({restoreFocus: false}); closeProjectRename({restoreFocus: false}); closeProjectMenu({restoreFocus: false}); finishLegendDrag(); closeOverflowMenu(); unsubscribe(); listeners.splice(0).forEach(cleanup => cleanup()); resizeObserver?.disconnect(); clearTimeout(resizeTimer); if (legendClampFrame != null && view.cancelAnimationFrame) view.cancelAnimationFrame(legendClampFrame); legendClampFrame = null; mapController.destroy(); if (surfaceLayer && map?.hasLayer?.(surfaceLayer)) map.removeLayer(surfaceLayer); }, buildCameraScene, serializeCameraScene() { return JSON.stringify(buildCameraScene(), null, 2); }, classifySurfacePoint, pointInGeometry};
    const testWindow = view || root; testWindow.projectStoreForTest = store; testWindow.mapControllerForTest = mapController; testWindow.cameraSceneExportForTest = {buildCameraScene: publicApi.buildCameraScene, serializeCameraScene: publicApi.serializeCameraScene}; testWindow.surfaceLayerForTest = {classifySurfacePoint, pointInGeometry}; testWindow.cameraMarkerForTest = {getLatLng() { const id = selectedCameraId(); const snapshot = id && mapController.getCameraLayerSnapshot(id); return snapshot?.markerPosition && L?.latLng ? L.latLng(snapshot.markerPosition.lat, snapshot.markerPosition.lng) : snapshot?.markerPosition || null; }};
    return publicApi;
  }

  return {createAppController, defaultProject, tileSourceByKey, SENSOR_PRESETS, RESOLUTION_PRESETS, buildCameraComparison: Comparison.buildCameraComparison, buildYoloCoverage: YoloCoverage.buildYoloCoverage};
}));
