/* Strict camera-project/1.0 validation and portable Project helpers. */
(function (root, factory) {
  const api = factory(
    root.PortCamCore || (typeof require === 'function' ? require('./portcam-core.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamProject = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  if (!Core) throw new Error('PortCamProject requires PortCamCore');

  const SCHEMA_VERSION = Core.CAMERA_PROJECT_SCHEMA || 'camera-project/1.0';
  const DEFAULT_MAP = Object.freeze({
    center: Object.freeze({latitudeDeg: 22.61, longitudeDeg: 120.28}),
    zoom: 15
  });
  const TOP_LEVEL_FIELDS = ['cameras', 'name', 'projectId', 'schemaVersion', 'settings', 'targets'];
  const TOP_LEVEL_WITH_MAP = TOP_LEVEL_FIELDS.concat('map');
  const SETTINGS_FIELDS = [
    'baseMapKey', 'coverageTargetDimension', 'footprintSteps', 'intersectionPlaneElevationM',
    'planningTargetHeightM', 'surfaceVisible', 'tilePadding', 'tileZoom', 'coverageAuditDimension', 'coverageAuditMinimumTier', 'coverageAuditRequiredCameras'
  ];
  const CAMERA_FIELDS = [
    'color', 'enabled', 'focalLengthMm', 'headingDeg', 'heightM', 'heightReference',
    'intersectionPlaneElevationM', 'lifecycle',
    'locked', 'name', 'position', 'revision', 'sensorHeightMm', 'sensorWidthMm',
    'tiltDownDeg', 'verticalDatum', 'visible', 'widthPx', 'heightPx', 'id'
  ];
  const TARGET_FIELDS = ['anchor', 'enabled', 'headingDeg', 'heightM', 'lengthM', 'locked', 'modelType', 'name', 'position', 'revision', 'visible', 'widthM', 'id'];

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return Object.freeze(value);
  }
  function fail(message, code, path) { return {ok: false, error: {code: code || 'invalid-project', message, path: path || null}}; }
  function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
  function finite(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} 必須是有限數值。`);
    return value;
  }
  function positive(value, path) {
    finite(value, path);
    if (!(value > 0)) throw new Error(`${path} 必須大於 0。`);
    return value;
  }
  function integer(value, path) {
    finite(value, path);
    if (!Number.isInteger(value)) throw new Error(`${path} 必須是整數。`);
    return value;
  }
  function text(value, path) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} 不可為空。`);
    return value.trim();
  }
  function exactKeys(value, allowed, required, path) {
    if (!isObject(value)) throw new Error(`${path} 必須是物件。`);
    const allowedSet = new Set(allowed);
    Object.keys(value).forEach(key => { if (!allowedSet.has(key)) throw new Error(`${path}.${key} 包含不支援欄位。`); });
    (required || []).forEach(key => { if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${path}.${key} 缺少必要欄位。`); });
  }
  function validatePosition(value, path) {
    exactKeys(value, ['latitudeDeg', 'longitudeDeg'], ['latitudeDeg', 'longitudeDeg'], path);
    const latitudeDeg = finite(value.latitudeDeg, `${path}.latitudeDeg`);
    const longitudeDeg = finite(value.longitudeDeg, `${path}.longitudeDeg`);
    if (latitudeDeg < -90 || latitudeDeg > 90) throw new Error(`${path}.latitudeDeg 超出範圍。`);
    if (longitudeDeg < -180 || longitudeDeg > 180) throw new Error(`${path}.longitudeDeg 超出範圍。`);
    return {latitudeDeg, longitudeDeg};
  }
  function validateHeading(value, path) {
    const headingDeg = finite(value, path);
    if (headingDeg < 0 || headingDeg >= 360) throw new Error(`${path} 必須介於 0（含）與 360（不含）。`);
    return headingDeg;
  }
  function validateBoolean(value, path) {
    if (typeof value !== 'boolean') throw new Error(`${path} 必須是 boolean。`);
    return value;
  }
  function optional(value, key, fn, path, fallback) {
    return Object.prototype.hasOwnProperty.call(value, key) ? fn(value[key], `${path}.${key}`) : fallback;
  }
  function validateSettings(value) {
    exactKeys(value, SETTINGS_FIELDS, [], 'settings');
    const settings = {};
    if (Object.prototype.hasOwnProperty.call(value, 'baseMapKey')) {
      if (!['osm', 'nlscEmap', 'nlscPhoto'].includes(value.baseMapKey)) throw new Error('settings.baseMapKey 不支援。');
      settings.baseMapKey = value.baseMapKey;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'coverageTargetDimension')) {
      if (!['short', 'long'].includes(value.coverageTargetDimension)) throw new Error('settings.coverageTargetDimension 不支援。');
      settings.coverageTargetDimension = value.coverageTargetDimension;
    }
    settings.coverageAuditDimension = Object.prototype.hasOwnProperty.call(value, 'coverageAuditDimension') ? value.coverageAuditDimension : 'width';
    if (!['length','width','height'].includes(settings.coverageAuditDimension)) throw new Error('settings.coverageAuditDimension 不支援。');
    settings.coverageAuditMinimumTier = Object.prototype.hasOwnProperty.call(value, 'coverageAuditMinimumTier') ? value.coverageAuditMinimumTier : 'usable';
    if (!['robust','usable','difficult','notRecommended'].includes(settings.coverageAuditMinimumTier)) throw new Error('settings.coverageAuditMinimumTier 不支援。');
    settings.coverageAuditRequiredCameras = Object.prototype.hasOwnProperty.call(value, 'coverageAuditRequiredCameras') ? integer(value.coverageAuditRequiredCameras, 'settings.coverageAuditRequiredCameras') : 1;
    if (settings.coverageAuditRequiredCameras < 1) throw new Error('settings.coverageAuditRequiredCameras 必須至少為 1。');
    if (Object.prototype.hasOwnProperty.call(value, 'planningTargetHeightM')) settings.planningTargetHeightM = positive(value.planningTargetHeightM, 'settings.planningTargetHeightM');
    if (Object.prototype.hasOwnProperty.call(value, 'surfaceVisible')) settings.surfaceVisible = validateBoolean(value.surfaceVisible, 'settings.surfaceVisible');
    if (Object.prototype.hasOwnProperty.call(value, 'tileZoom')) {
      const zoom = integer(value.tileZoom, 'settings.tileZoom');
      if (zoom < 0 || zoom > 19) throw new Error('settings.tileZoom 超出範圍。');
      settings.tileZoom = zoom;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'footprintSteps')) {
      const steps = integer(value.footprintSteps, 'settings.footprintSteps');
      if (steps < 1 || steps > 720) throw new Error('settings.footprintSteps 超出範圍。');
      settings.footprintSteps = steps;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'intersectionPlaneElevationM')) settings.intersectionPlaneElevationM = finite(value.intersectionPlaneElevationM, 'settings.intersectionPlaneElevationM');
    if (Object.prototype.hasOwnProperty.call(value, 'tilePadding')) {
      const padding = integer(value.tilePadding, 'settings.tilePadding');
      if (padding < 0 || padding > 8) throw new Error('settings.tilePadding 超出範圍。');
      settings.tilePadding = padding;
    }
    return settings;
  }
  function validateCamera(value, index) {
    const path = `cameras[${index}]`;
    exactKeys(value, CAMERA_FIELDS, ['id', 'name', 'position', 'heightM', 'tiltDownDeg', 'sensorWidthMm', 'sensorHeightMm', 'widthPx', 'heightPx', 'focalLengthMm', 'headingDeg'], path);
    const camera = {
      id: text(value.id, `${path}.id`),
      name: text(value.name, `${path}.name`),
      position: validatePosition(value.position, `${path}.position`),
      heightM: positive(value.heightM, `${path}.heightM`),
      tiltDownDeg: finite(value.tiltDownDeg, `${path}.tiltDownDeg`),
      sensorWidthMm: positive(value.sensorWidthMm, `${path}.sensorWidthMm`),
      sensorHeightMm: positive(value.sensorHeightMm, `${path}.sensorHeightMm`),
      widthPx: integer(value.widthPx, `${path}.widthPx`),
      heightPx: integer(value.heightPx, `${path}.heightPx`),
      focalLengthMm: positive(value.focalLengthMm, `${path}.focalLengthMm`),
      headingDeg: validateHeading(value.headingDeg, `${path}.headingDeg`)
    };
    if (camera.widthPx <= 0 || camera.heightPx <= 0) throw new Error(`${path} resolution 必須大於 0。`);
    if (Object.prototype.hasOwnProperty.call(value, 'color')) camera.color = text(value.color, `${path}.color`);
    if (Object.prototype.hasOwnProperty.call(value, 'visible')) camera.visible = validateBoolean(value.visible, `${path}.visible`);
    if (Object.prototype.hasOwnProperty.call(value, 'enabled')) camera.enabled = validateBoolean(value.enabled, `${path}.enabled`);
    if (Object.prototype.hasOwnProperty.call(value, 'locked')) camera.locked = validateBoolean(value.locked, `${path}.locked`);
    if (Object.prototype.hasOwnProperty.call(value, 'revision')) {
      const revision = integer(value.revision, `${path}.revision`);
      if (revision < 0) throw new Error(`${path}.revision 不可為負數。`);
      camera.revision = revision;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'lifecycle')) {
      if (!['placed', 'draft-unplaced'].includes(value.lifecycle)) throw new Error(`${path}.lifecycle 不支援。`);
      camera.lifecycle = value.lifecycle;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'heightReference')) camera.heightReference = text(value.heightReference, `${path}.heightReference`);
    if (Object.prototype.hasOwnProperty.call(value, 'verticalDatum')) camera.verticalDatum = text(value.verticalDatum, `${path}.verticalDatum`);
    if (Object.prototype.hasOwnProperty.call(value, 'intersectionPlaneElevationM')) camera.intersectionPlaneElevationM = finite(value.intersectionPlaneElevationM, `${path}.intersectionPlaneElevationM`);
    return camera;
  }
  function validateTarget(value, index) {
    const path = `targets[${index}]`;
    exactKeys(value, TARGET_FIELDS, ['id', 'name', 'position', 'lengthM', 'widthM', 'heightM', 'headingDeg'], path);
    const target = {
      id: text(value.id, `${path}.id`),
      name: text(value.name, `${path}.name`),
      position: validatePosition(value.position, `${path}.position`),
      lengthM: positive(value.lengthM, `${path}.lengthM`),
      widthM: positive(value.widthM, `${path}.widthM`),
      heightM: positive(value.heightM, `${path}.heightM`),
      headingDeg: validateHeading(value.headingDeg, `${path}.headingDeg`),
      modelType: Object.prototype.hasOwnProperty.call(value, 'modelType') ? value.modelType : 'small-vessel'
    };
    if (!['small-vessel', 'large-vessel'].includes(target.modelType)) throw new Error(`${path}.modelType 不支援。`);
    if (Object.prototype.hasOwnProperty.call(value, 'anchor')) {
      if (value.anchor !== 'bottom-center') throw new Error(`${path}.anchor 不支援。`);
      target.anchor = value.anchor;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'visible')) target.visible = validateBoolean(value.visible, `${path}.visible`);
    if (Object.prototype.hasOwnProperty.call(value, 'enabled')) target.enabled = validateBoolean(value.enabled, `${path}.enabled`);
    if (Object.prototype.hasOwnProperty.call(value, 'locked')) target.locked = validateBoolean(value.locked, `${path}.locked`);
    if (Object.prototype.hasOwnProperty.call(value, 'revision')) {
      const revision = integer(value.revision, `${path}.revision`);
      if (revision < 0) throw new Error(`${path}.revision 不可為負數。`);
      target.revision = revision;
    }
    return target;
  }
  function validateMap(value) {
    exactKeys(value, ['center', 'zoom'], ['center', 'zoom'], 'map');
    const center = validatePosition(value.center, 'map.center');
    const zoom = finite(value.zoom, 'map.zoom');
    if (zoom < 0 || zoom > 22) throw new Error('map.zoom 超出範圍。');
    return {center, zoom};
  }
  function validateProject(input) {
    if (!isObject(input)) return fail('Project 檔案必須是物件。', 'invalid-shape');
    try {
      exactKeys(input, TOP_LEVEL_WITH_MAP, TOP_LEVEL_FIELDS, 'Project');
      if (input.schemaVersion !== SCHEMA_VERSION) throw new Error('Project schema version 不相容。');
      if (!Array.isArray(input.cameras) || !Array.isArray(input.targets)) throw new Error('Project cameras 與 targets 必須是陣列。');
      const projectId = text(input.projectId, 'projectId');
      const name = text(input.name, 'name');
      const settings = validateSettings(input.settings);
      const cameras = input.cameras.map(validateCamera);
      const targets = input.targets.map(validateTarget);
      const cameraIds = new Set(), targetIds = new Set();
      cameras.forEach((camera, index) => { if (cameraIds.has(camera.id)) throw new Error(`cameras[${index}].id 與其他 Camera 重複。`); cameraIds.add(camera.id); });
      targets.forEach((target, index) => { if (targetIds.has(target.id)) throw new Error(`targets[${index}].id 與其他 Target 重複。`); targetIds.add(target.id); });
      const project = {schemaVersion: SCHEMA_VERSION, projectId, name, settings, cameras, targets};
      if (Object.prototype.hasOwnProperty.call(input, 'map')) project.map = validateMap(input.map);
      return {ok: true, value: project};
    } catch (error) {
      return fail(error.message || String(error), 'invalid-project');
    }
  }
  function buildProject(project, options) {
    const value = Core.buildCameraProject(project);
    if (options && options.map !== undefined) value.map = clone(options.map);
    return value;
  }
  function withMap(project, map) {
    const candidate = buildProject(project);
    if (map === undefined) delete candidate.map;
    else candidate.map = clone(map);
    return candidate;
  }

  return {
    SCHEMA_VERSION,
    DEFAULT_MAP: deepFreeze(clone(DEFAULT_MAP)),
    SETTINGS_FIELDS: SETTINGS_FIELDS.slice(),
    validateProject,
    validate: validateProject,
    buildProject,
    withMap
  };
}));
