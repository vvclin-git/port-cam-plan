/* Versioned browser-local Camera Preset Library repository. */
(function (root, factory) {
  const api = factory(
    root.PortCamCameraDefaults || (typeof require === 'function' ? require('./portcam-camera-defaults.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamCameraPresets = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (CameraDefaults) {
  'use strict';
  if (!CameraDefaults) throw new Error('PortCamCameraPresets requires PortCamCameraDefaults');

  const SCHEMA_VERSION = 'camera-presets/1.0';
  const STORAGE_KEY = 'port-cam-plan.camera-presets';
  const FACTORY_PRESET_ID = 'factory-defaults';
  const FACTORY_PRESET_NAME = 'Factory Defaults';
  let idCounter = 0;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function fail(message, code, presets) { return {ok: false, error: {code: code || 'invalid', message}, presets: presets ? clone(presets) : undefined}; }
  function normalizedName(name) { return typeof name === 'string' ? name.trim() : ''; }
  function nameKey(name) { return normalizedName(name).toLowerCase(); }
  function idKey(id) { return typeof id === 'string' ? id.trim() : ''; }
  function generatedId() {
    const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return `preset-${cryptoObject.randomUUID()}`;
    idCounter += 1;
    return `preset-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function factoryPreset(factoryDefaults) { return {id: FACTORY_PRESET_ID, name: FACTORY_PRESET_NAME, settings: clone(factoryDefaults)}; }
  function sortedPresets(presets) {
    return presets.slice().sort((left, right) => nameKey(left.name).localeCompare(nameKey(right.name)) || idKey(left.id).localeCompare(idKey(right.id)));
  }
  function publicList(custom, factoryDefaults) { return [factoryPreset(factoryDefaults), ...sortedPresets(custom)].map(clone); }
  function hasName(custom, name, exceptId) { const key = nameKey(name); return custom.some(preset => preset.id !== exceptId && nameKey(preset.name) === key); }
  function uniqueName(custom, base) {
    const initial = normalizedName(base) || 'Camera Preset';
    if (!hasName(custom, initial)) return initial;
    let index = 2;
    while (hasName(custom, `${initial} ${index}`)) index += 1;
    return `${initial} ${index}`;
  }
  function validateCustomPreset(value, context) {
    const args = context || {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {ok: false, error: 'Preset 必須是物件。', code: 'invalid-shape'};
    const keys = Object.keys(value).sort();
    if (keys.length !== 3 || keys[0] !== 'id' || keys[1] !== 'name' || keys[2] !== 'settings') return {ok: false, error: 'Preset 欄位不完整或包含不支援欄位。', code: 'invalid-fields'};
    const id = idKey(value.id), name = normalizedName(value.name);
    if (!id || id === FACTORY_PRESET_ID) return {ok: false, error: 'Preset ID 不可為空或使用 Factory Defaults ID。', code: 'invalid-id'};
    if (!name) return {ok: false, error: 'Preset 名稱不可為空。', code: 'invalid-name'};
    if (nameKey(name) === nameKey(FACTORY_PRESET_NAME)) return {ok: false, error: 'Preset 名稱不可與 Factory Defaults 重複。', code: 'duplicate-name'};
    if (hasName(args.existing || [], name, args.exceptId)) return {ok: false, error: 'Preset 名稱不可重複（不分大小寫）。', code: 'duplicate-name'};
    const checked = CameraDefaults.validateDefaults(value.settings);
    if (!checked.ok) return {ok: false, error: checked.error, code: `invalid-settings-${checked.code}`};
    return {ok: true, value: {id, name, settings: checked.value}};
  }
  function validatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {ok: false, error: 'Preset 儲存格式無效。', code: 'invalid-shape'};
    const keys = Object.keys(payload).sort();
    if (keys.length !== 2 || keys[0] !== 'presets' || keys[1] !== 'schemaVersion') return {ok: false, error: 'Preset 儲存欄位無效。', code: 'invalid-fields'};
    if (payload.schemaVersion !== SCHEMA_VERSION) return {ok: false, error: 'Preset 版本不相容。', code: 'invalid-version'};
    if (!Array.isArray(payload.presets)) return {ok: false, error: 'Preset 清單格式無效。', code: 'invalid-list'};
    const custom = [];
    const ids = new Set();
    for (const raw of payload.presets) {
      const checked = validateCustomPreset(raw, {existing: custom});
      if (!checked.ok) return checked;
      if (ids.has(checked.value.id)) return {ok: false, error: 'Preset ID 不可重複。', code: 'duplicate-id'};
      ids.add(checked.value.id);
      custom.push(checked.value);
    }
    return {ok: true, value: sortedPresets(custom)};
  }

  function createRepository(options) {
    const args = options || {};
    const storage = args.storage || null;
    const storageKey = args.storageKey || STORAGE_KEY;
    const checkedFactory = CameraDefaults.validateDefaults(args.factoryDefaults || CameraDefaults.FACTORY_DEFAULTS);
    const factoryDefaults = checkedFactory.ok ? checkedFactory.value : clone(CameraDefaults.FACTORY_DEFAULTS);
    let custom = [];
    let loaded = false;
    let lastError = null;

    function snapshot() { return publicList(custom, factoryDefaults); }
    function read() {
      if (loaded) return {ok: !lastError, presets: snapshot(), error: lastError && clone(lastError)};
      loaded = true;
      lastError = null;
      if (!storage || typeof storage.getItem !== 'function') {
        lastError = {code: 'storage-unavailable', message: '瀏覽器本機 Preset 儲存空間無法使用。'};
        return {ok: false, presets: snapshot(), error: clone(lastError), source: 'factory'};
      }
      try {
        const raw = storage.getItem(storageKey);
        if (raw == null || raw === '') return {ok: true, presets: snapshot(), source: 'factory'};
        const payload = JSON.parse(raw);
        const checked = validatePayload(payload);
        if (!checked.ok) throw Object.assign(new Error(checked.error), {code: checked.code});
        custom = checked.value;
        return {ok: true, presets: snapshot(), source: 'storage'};
      } catch (error) {
        custom = [];
        lastError = {code: error.code || 'storage-read', message: error.message || String(error)};
        return {ok: false, presets: snapshot(), error: clone(lastError), source: 'factory'};
      }
    }
    function persist(next) {
      read();
      if (!storage || typeof storage.setItem !== 'function') return fail('瀏覽器本機 Preset 儲存空間無法使用。', 'storage-unavailable', snapshot());
      try {
        storage.setItem(storageKey, JSON.stringify({schemaVersion: SCHEMA_VERSION, presets: sortedPresets(next)}));
        custom = sortedPresets(next).map(clone);
        lastError = null;
        return {ok: true, presets: snapshot()};
      } catch (error) {
        return fail(error.message || 'Preset 儲存失敗，原本清單已保留。', error.code || 'storage-write', snapshot());
      }
    }
    function getPreset(id) { read(); return snapshot().find(preset => preset.id === id) || null; }
    function createPreset(input, settingsArgument) {
      read();
      const value = typeof input === 'string' ? {name: input, settings: settingsArgument} : input || {};
      const name = normalizedName(value.name);
      if (!name) return fail('Preset 名稱不可為空。', 'invalid-name', snapshot());
      const checked = validateCustomPreset({id: generatedId(), name, settings: value.settings}, {existing: custom});
      if (!checked.ok) return fail(checked.error, checked.code, snapshot());
      const result = persist([...custom, checked.value]);
      return result.ok ? {...result, preset: clone(checked.value)} : result;
    }
    function renamePreset(id, name) {
      read();
      if (id === FACTORY_PRESET_ID) return fail('Factory Defaults 不可重新命名。', 'factory-readonly', snapshot());
      const current = custom.find(preset => preset.id === id);
      if (!current) return fail('找不到指定 Preset。', 'not-found', snapshot());
      const nextName = normalizedName(name);
      if (!nextName) return fail('Preset 名稱不可為空。', 'invalid-name', snapshot());
      if (hasName(custom, nextName, id)) return fail('Preset 名稱不可重複（不分大小寫）。', 'duplicate-name', snapshot());
      const next = custom.map(preset => preset.id === id ? {...preset, name: nextName} : preset);
      const result = persist(next);
      return result.ok ? {...result, preset: clone(next.find(preset => preset.id === id))} : result;
    }
    function updatePreset(id, input) {
      read();
      if (id === FACTORY_PRESET_ID) return fail('Factory Defaults 不可更新。', 'factory-readonly', snapshot());
      const current = custom.find(preset => preset.id === id);
      if (!current) return fail('找不到指定 Preset。', 'not-found', snapshot());
      const value = input && Object.prototype.hasOwnProperty.call(input, 'settings') ? input.settings : input;
      const checked = validateCustomPreset({id, name: current.name, settings: value}, {existing: custom, exceptId: id});
      if (!checked.ok) return fail(checked.error, checked.code, snapshot());
      const next = custom.map(preset => preset.id === id ? checked.value : preset);
      const result = persist(next);
      return result.ok ? {...result, preset: clone(checked.value)} : result;
    }
    function duplicatePreset(id) {
      const source = getPreset(id);
      if (!source) return fail('找不到指定 Preset。', 'not-found', snapshot());
      return createPreset({name: uniqueName(custom, `${source.name} Copy`), settings: source.settings});
    }
    function deletePreset(id) {
      read();
      if (id === FACTORY_PRESET_ID) return fail('Factory Defaults 不可刪除。', 'factory-readonly', snapshot());
      if (!custom.some(preset => preset.id === id)) return fail('找不到指定 Preset。', 'not-found', snapshot());
      return persist(custom.filter(preset => preset.id !== id));
    }
    function replacePresets(nextPresets) {
      read();
      if (!Array.isArray(nextPresets)) return fail('Preset 清單格式無效。', 'invalid-list', snapshot());
      const checked = validatePayload({schemaVersion: SCHEMA_VERSION, presets: nextPresets});
      if (!checked.ok) return fail(checked.error, checked.code, snapshot());
      return persist(checked.value);
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      storageKey,
      factoryPreset() { return factoryPreset(factoryDefaults); },
      validate(value, context) { return validateCustomPreset(value, context); },
      read,
      list() { read(); return snapshot(); },
      getPresets() { read(); return snapshot(); },
      get(id) { return getPreset(id); },
      getStatus() { read(); return {loaded, error: lastError && clone(lastError), presets: snapshot()}; },
      create: createPreset,
      createPreset,
      rename: renamePreset,
      renamePreset,
      update: updatePreset,
      updatePreset,
      duplicate: duplicatePreset,
      duplicatePreset,
      remove: deletePreset,
      delete: deletePreset,
      deletePreset,
      replacePresets,
      replaceCustomPresets: replacePresets
    };
  }

  return {SCHEMA_VERSION, STORAGE_KEY, FACTORY_PRESET_ID, FACTORY_PRESET_NAME, validateCustomPreset, validatePayload, createRepository};
}));
