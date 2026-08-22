/* Versioned browser-local Camera Defaults repository. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamCameraDefaults = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 'camera-defaults/1.0';
  const STORAGE_KEY = 'port-cam-plan.camera-defaults';
  const FIELDS = ['heightM', 'tiltDownDeg', 'sensorWidthMm', 'sensorHeightMm', 'widthPx', 'heightPx', 'focalLengthMm'];
  const FACTORY_DEFAULTS = Object.freeze({
    heightM: 20,
    tiltDownDeg: 2,
    sensorWidthMm: 7.2,
    sensorHeightMm: 4.05,
    widthPx: 2560,
    heightPx: 1440,
    focalLengthMm: 147.5
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function fail(message, code) {
    return {ok: false, code: code || 'invalid', error: message};
  }

  function validateDefaults(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Camera Defaults 必須是物件。', 'invalid-shape');
    const keys = Object.keys(value).sort();
    const expected = FIELDS.slice().sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      return fail('Camera Defaults 欄位不完整或包含不支援欄位。', 'invalid-fields');
    }
    for (const field of FIELDS) {
      if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) return fail(`${field} 必須是有限數值。`, 'invalid-number');
    }
    for (const field of ['heightM', 'sensorWidthMm', 'sensorHeightMm', 'focalLengthMm', 'widthPx', 'heightPx']) {
      if (value[field] <= 0) return fail(`${field} 必須大於 0。`, 'invalid-positive');
    }
    for (const field of ['widthPx', 'heightPx']) {
      if (!Number.isInteger(value[field])) return fail(`${field} 必須是整數。`, 'invalid-integer');
    }
    return {ok: true, value: clone(value)};
  }

  function validatedOrFactory(value) {
    const checked = validateDefaults(value);
    return checked.ok ? checked.value : clone(FACTORY_DEFAULTS);
  }

  function createRepository(options) {
    const args = options || {};
    const storage = args.storage || null;
    const storageKey = args.storageKey || STORAGE_KEY;
    const factory = validatedOrFactory(args.factoryDefaults || FACTORY_DEFAULTS);
    let current = clone(factory);
    let loaded = false;
    let lastError = null;

    function read() {
      if (loaded) return {ok: !lastError, defaults: clone(current), error: lastError};
      loaded = true;
      lastError = null;
      if (!storage || typeof storage.getItem !== 'function') {
        lastError = {code: 'storage-unavailable', message: '瀏覽器本機儲存空間無法使用。'};
        return {ok: false, defaults: clone(current), error: clone(lastError), source: 'factory'};
      }
      try {
        const raw = storage.getItem(storageKey);
        if (raw == null || raw === '') return {ok: true, defaults: clone(current), source: 'factory'};
        const payload = JSON.parse(raw);
        if (!payload || payload.schemaVersion !== SCHEMA_VERSION) throw Object.assign(new Error('Camera Defaults 版本不相容。'), {code: 'invalid-version'});
        const checked = validateDefaults(payload.defaults);
        if (!checked.ok) throw Object.assign(new Error(checked.error), {code: checked.code});
        current = checked.value;
        return {ok: true, defaults: clone(current), source: 'storage'};
      } catch (error) {
        current = clone(factory);
        lastError = {code: error.code || 'storage-read', message: error.message || String(error)};
        return {ok: false, defaults: clone(current), error: clone(lastError), source: 'factory'};
      }
    }

    function getDefaults() {
      read();
      return clone(current);
    }

    function getStatus() {
      read();
      return {loaded, error: lastError && clone(lastError), defaults: clone(current)};
    }

    function save(value) {
      read();
      const checked = validateDefaults(value);
      if (!checked.ok) return {ok: false, error: {code: checked.code, message: checked.error}, defaults: clone(current)};
      if (!storage || typeof storage.setItem !== 'function') {
        return {ok: false, error: {code: 'storage-unavailable', message: '瀏覽器本機儲存空間無法使用。'}, defaults: clone(current)};
      }
      const payload = JSON.stringify({schemaVersion: SCHEMA_VERSION, defaults: checked.value});
      try {
        storage.setItem(storageKey, payload);
        current = clone(checked.value);
        lastError = null;
        return {ok: true, defaults: clone(current)};
      } catch (error) {
        return {ok: false, error: {code: error.code || 'storage-write', message: error.message || 'Camera Defaults 寫入失敗，原本設定已保留。'}, defaults: clone(current)};
      }
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      storageKey,
      factoryDefaults() { return clone(factory); },
      validate(value) { return validateDefaults(value); },
      read,
      getDefaults,
      getStatus,
      save
    };
  }

  return {SCHEMA_VERSION, STORAGE_KEY, FIELDS: FIELDS.slice(), FACTORY_DEFAULTS: clone(FACTORY_DEFAULTS), validateDefaults, createRepository};
}));
