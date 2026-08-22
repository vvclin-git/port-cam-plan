/* Camera Preset Library transfer bundle and import coordinator. */
(function (root, factory) {
  const api = factory(
    root.PortCamCameraDefaults || (typeof require === 'function' ? require('./portcam-camera-defaults.js') : null),
    root.PortCamCameraPresets || (typeof require === 'function' ? require('./portcam-camera-presets.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamCameraPresetTransfer = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (CameraDefaults, CameraPresets) {
  'use strict';
  if (!CameraDefaults) throw new Error('PortCamCameraPresetTransfer requires PortCamCameraDefaults');
  if (!CameraPresets) throw new Error('PortCamCameraPresetTransfer requires PortCamCameraPresets');

  const SCHEMA_VERSION = 'camera-preset-library/1.0';
  const PLAN_VERSION = 'camera-preset-import-plan/1.0';
  const FIELDS = CameraDefaults.FIELDS.slice();

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function fail(message, code, extra) { return {ok: false, error: {code: code || 'invalid', message}, ...(extra || {})}; }
  function text(value) { return typeof value === 'string' ? value.trim() : ''; }
  function nameKey(value) { return text(value).toLowerCase(); }
  function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
  function sortCustomPresets(presets) {
    return presets.slice().sort((left, right) => compareText(nameKey(left.name), nameKey(right.name)) || compareText(text(left.id), text(right.id)));
  }
  function settingsEqual(left, right) { return FIELDS.every(field => left?.[field] === right?.[field]); }
  function presetEqual(left, right) {
    return left?.id === right?.id && nameKey(left?.name) === nameKey(right?.name) && settingsEqual(left?.settings, right?.settings);
  }
  function presetListsEqual(left, right) {
    const a = sortCustomPresets(left || []), b = sortCustomPresets(right || []);
    return a.length === b.length && a.every((preset, index) => presetEqual(preset, b[index]));
  }
  function canonicalTimestamp(value) {
    if (typeof value !== 'string' || !value) return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  }
  function parseBundleInput(input) {
    if (typeof input !== 'string') return {ok: true, value: input};
    try { return {ok: true, value: JSON.parse(input)}; }
    catch (error) { return fail(error.message || '匯入檔案不是有效 JSON。', 'invalid-json'); }
  }
  function validateCustomList(value) {
    if (!Array.isArray(value)) return fail('Preset 清單格式無效。', 'invalid-list');
    const checked = CameraPresets.validatePayload({schemaVersion: CameraPresets.SCHEMA_VERSION, presets: value});
    if (!checked.ok) return fail(checked.error, checked.code);
    return {ok: true, value: sortCustomPresets(checked.value)};
  }
  function customOnly(value) {
    if (!Array.isArray(value)) return value;
    return value.filter(preset => preset?.id !== CameraPresets.FACTORY_PRESET_ID);
  }

  function validateBundle(input) {
    const parsed = parseBundleInput(input);
    if (!parsed.ok) return parsed;
    const value = parsed.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('匯入 bundle 必須是物件。', 'invalid-shape');
    const keys = Object.keys(value).sort();
    const expected = ['cameraDefaults', 'exportedAt', 'presets', 'schemaVersion'];
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return fail('匯入 bundle 欄位不完整或包含不支援欄位。', 'invalid-fields');
    if (value.schemaVersion !== SCHEMA_VERSION) return fail('匯入 bundle 版本不相容。', 'invalid-version');
    if (!canonicalTimestamp(value.exportedAt)) return fail('匯入 bundle exportedAt 必須是標準 ISO 時間。', 'invalid-exported-at');
    const defaults = CameraDefaults.validateDefaults(value.cameraDefaults);
    if (!defaults.ok) return fail(`匯入 Camera Defaults 無效：${defaults.error}`, `invalid-defaults-${defaults.code}`);
    const presets = validateCustomList(value.presets);
    if (!presets.ok) return presets;
    return {ok: true, bundle: {schemaVersion: SCHEMA_VERSION, exportedAt: value.exportedAt, cameraDefaults: defaults.value, presets: presets.value}};
  }

  function buildBundle(options) {
    const args = options || {};
    const defaults = CameraDefaults.validateDefaults(args.cameraDefaults);
    if (!defaults.ok) return fail(`匯出 Camera Defaults 無效：${defaults.error}`, `invalid-defaults-${defaults.code}`);
    if (!Array.isArray(args.presets)) return fail('匯出 Preset 清單格式無效。', 'invalid-list');
    const exportedAt = args.exportedAt || new Date().toISOString();
    const candidate = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      cameraDefaults: defaults.value,
      presets: customOnly(args.presets)
    };
    const checked = validateBundle(candidate);
    return checked.ok ? {ok: true, bundle: checked.bundle} : checked;
  }

  function generatedId() {
    const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return `preset-${cryptoObject.randomUUID()}`;
    return `preset-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function makeUniqueId(usedIds, idFactory) {
    for (let index = 0; index < 100; index += 1) {
      const raw = typeof idFactory === 'function' ? idFactory(index) : generatedId();
      const candidate = text(raw);
      if (candidate && candidate !== CameraPresets.FACTORY_PRESET_ID && !usedIds.has(candidate)) return candidate;
      if (typeof idFactory === 'function' && index === 0) idFactory = null;
    }
    let fallback = `preset-import-${Date.now().toString(36)}`;
    let suffix = 2;
    while (usedIds.has(fallback) || fallback === CameraPresets.FACTORY_PRESET_ID) fallback = `preset-import-${Date.now().toString(36)}-${suffix++}`;
    return fallback;
  }
  function makeImportedName(base, usedNames) {
    const initial = `${text(base)} (Imported)`;
    if (!usedNames.has(nameKey(initial))) return initial;
    let index = 2;
    while (usedNames.has(nameKey(`${text(base)} (Imported ${index})`))) index += 1;
    return `${text(base)} (Imported ${index})`;
  }
  function currentCustomPresets(value) {
    const checked = validateCustomList(customOnly(value));
    return checked.ok ? checked : fail(checked.error, checked.code);
  }

  function planImport(input, options) {
    const args = options || {};
    const checkedBundle = validateBundle(input);
    if (!checkedBundle.ok) return checkedBundle;
    const currentDefaults = CameraDefaults.validateDefaults(args.currentDefaults);
    if (!currentDefaults.ok) return fail(`目前 Camera Defaults 無效：${currentDefaults.error}`, `invalid-current-defaults-${currentDefaults.code}`);
    const currentPresets = currentCustomPresets(args.currentPresets);
    if (!currentPresets.ok) return currentPresets;
    const mode = args.mode === undefined ? 'merge' : args.mode;
    if (mode !== 'merge' && mode !== 'replace') return fail('匯入模式必須是 Merge 或 Replace。', 'invalid-mode');
    const applyCameraDefaults = args.applyCameraDefaults !== false;
    const local = currentPresets.value.map(clone);
    const next = mode === 'replace' ? [] : local.map(clone);
    const usedIds = new Set(next.map(preset => preset.id));
    const usedNames = new Set(next.map(preset => nameKey(preset.name)));
    const skippedNames = [], addedNames = [], renamedNames = [];

    if (mode === 'replace') {
      checkedBundle.bundle.presets.forEach(preset => { next.push(clone(preset)); addedNames.push(preset.name); });
    } else {
      checkedBundle.bundle.presets.forEach(source => {
        const duplicate = local.some(existing => presetEqual(existing, source));
        if (duplicate) { skippedNames.push(source.name); return; }
        const imported = clone(source);
        if (usedIds.has(imported.id) || usedNames.has(nameKey(imported.name))) {
          imported.id = makeUniqueId(usedIds, args.idFactory);
          imported.name = makeImportedName(imported.name, usedNames);
          renamedNames.push(imported.name);
        }
        usedIds.add(imported.id);
        usedNames.add(nameKey(imported.name));
        next.push(imported);
        addedNames.push(imported.name);
      });
    }

    const nextPresets = sortCustomPresets(next);
    const nextDefaults = applyCameraDefaults ? checkedBundle.bundle.cameraDefaults : currentDefaults.value;
    const summary = {
      mode,
      added: addedNames.length,
      skipped: skippedNames.length,
      renamed: renamedNames.length,
      removed: mode === 'replace' ? local.length : 0,
      defaultsSelected: applyCameraDefaults,
      defaultsChanged: !settingsEqual(currentDefaults.value, nextDefaults),
      defaultsApplied: 0,
      addedNames,
      skippedNames,
      renamedNames,
      removedNames: mode === 'replace' ? local.map(preset => preset.name) : []
    };
    return {
      ok: true,
      plan: {
        kind: PLAN_VERSION,
        mode,
        applyCameraDefaults,
        bundle: clone(checkedBundle.bundle),
        currentSnapshot: {cameraDefaults: currentDefaults.value, presets: local},
        nextDefaults: clone(nextDefaults),
        nextPresets: clone(nextPresets),
        summary
      }
    };
  }

  function readVerifiedRepositories(cameraDefaultsRepository, cameraPresetsRepository) {
    if (!cameraDefaultsRepository || !cameraPresetsRepository) return fail('Camera Defaults 與 Preset repository 必須同時提供。', 'missing-repository');
    const defaultsStatus = cameraDefaultsRepository.getStatus();
    if (defaultsStatus.error) return fail(`目前 Camera Defaults 無法安全使用：${defaultsStatus.error.message}`, defaultsStatus.error.code || 'defaults-unavailable');
    const presetsStatus = cameraPresetsRepository.getStatus();
    if (presetsStatus.error) return fail(`目前 Preset Library 無法安全使用：${presetsStatus.error.message}`, presetsStatus.error.code || 'presets-unavailable');
    const defaults = CameraDefaults.validateDefaults(defaultsStatus.defaults);
    if (!defaults.ok) return fail(`目前 Camera Defaults 無效：${defaults.error}`, `invalid-current-defaults-${defaults.code}`);
    const presets = currentCustomPresets(presetsStatus.presets);
    if (!presets.ok) return presets;
    return {ok: true, cameraDefaults: defaults.value, presets: presets.value};
  }

  function applyImportPlan(plan, options) {
    const args = options || {};
    const cameraDefaultsRepository = args.cameraDefaultsRepository;
    const cameraPresetsRepository = args.cameraPresetsRepository || args.presetsRepository;
    const current = readVerifiedRepositories(cameraDefaultsRepository, cameraPresetsRepository);
    if (!current.ok) return current;
    if (!plan || plan.kind !== PLAN_VERSION) return fail('Import plan 無效或已過期。', 'invalid-plan');
    const checkedBundle = validateBundle(plan.bundle);
    if (!checkedBundle.ok) return checkedBundle;
    const checkedNextDefaults = CameraDefaults.validateDefaults(plan.nextDefaults);
    if (!checkedNextDefaults.ok) return fail(`Import plan Camera Defaults 無效：${checkedNextDefaults.error}`, 'invalid-plan-defaults');
    const checkedNextPresets = currentCustomPresets(plan.nextPresets);
    if (!checkedNextPresets.ok) return fail('Import plan Preset 清單無效。', 'invalid-plan-presets');
    const expectedCurrentDefaults = CameraDefaults.validateDefaults(plan.currentSnapshot?.cameraDefaults);
    const expectedCurrentPresets = currentCustomPresets(plan.currentSnapshot?.presets);
    if (!expectedCurrentDefaults.ok || !expectedCurrentPresets.ok) return fail('Import plan 的原始 snapshot 無效。', 'invalid-plan-snapshot');
    if (!settingsEqual(current.cameraDefaults, expectedCurrentDefaults.value) || !presetListsEqual(current.presets, expectedCurrentPresets.value)) return fail('Import plan 已過期，請重新選取匯入檔案。', 'stale-plan');

    const nextDefaults = checkedNextDefaults.value;
    const nextPresets = checkedNextPresets.value;
    const defaultsChanged = !settingsEqual(current.cameraDefaults, nextDefaults);
    const presetsChanged = !presetListsEqual(current.presets, nextPresets);
    let defaultsApplied = false;
    if (defaultsChanged) {
      const savedDefaults = cameraDefaultsRepository.save(nextDefaults);
      if (!savedDefaults.ok) return fail(`Camera Defaults 匯入寫入失敗：${savedDefaults.error.message}`, 'import-write-defaults', {rolledBack: true});
      defaultsApplied = true;
    }
    if (presetsChanged) {
      const replaced = cameraPresetsRepository.replacePresets(nextPresets);
      if (!replaced.ok) {
        let rollback = {ok: true};
        if (defaultsApplied) rollback = cameraDefaultsRepository.save(current.cameraDefaults);
        const rollbackText = rollback.ok ? '已回復匯入前設定。' : '回復也失敗，請立即確認瀏覽器儲存空間。';
        return fail(`Preset Library 匯入寫入失敗：${replaced.error.message} ${rollbackText}`, 'import-write-presets', {rolledBack: rollback.ok});
      }
    }
    const summary = {...clone(plan.summary), defaultsApplied: defaultsApplied ? 1 : 0, defaultsChanged, presetsChanged};
    return {ok: true, summary, cameraDefaults: cameraDefaultsRepository.getDefaults(), presets: cameraPresetsRepository.list()};
  }

  function createCoordinator(options) {
    const args = options || {};
    const cameraDefaultsRepository = args.cameraDefaultsRepository;
    const cameraPresetsRepository = args.cameraPresetsRepository || args.presetsRepository;
    function buildFromRepositories() {
      const current = readVerifiedRepositories(cameraDefaultsRepository, cameraPresetsRepository);
      if (!current.ok) return current;
      const exportedAt = typeof args.now === 'function' ? args.now() : undefined;
      return buildBundle({cameraDefaults: current.cameraDefaults, presets: current.presets, exportedAt});
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      buildBundle: buildFromRepositories,
      validateBundle,
      planImport(input, planOptions) {
        const current = readVerifiedRepositories(cameraDefaultsRepository, cameraPresetsRepository);
        if (!current.ok) return current;
        const mergedOptions = {...(planOptions || {}), currentDefaults: current.cameraDefaults, currentPresets: current.presets, idFactory: planOptions?.idFactory || args.idFactory};
        return planImport(input, mergedOptions);
      },
      applyImport(plan) { return applyImportPlan(plan, {cameraDefaultsRepository, cameraPresetsRepository}); }
    };
  }

  function applyImport(plan, options) { return applyImportPlan(plan, options); }

  return {SCHEMA_VERSION, PLAN_VERSION, buildBundle, validateBundle, planImport, applyImport, createCoordinator};
}));
