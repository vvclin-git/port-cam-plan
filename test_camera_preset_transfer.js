const test = require('node:test');
const assert = require('node:assert/strict');
const CameraDefaults = require('./portcam-camera-defaults.js');
const CameraPresets = require('./portcam-camera-presets.js');
const Transfer = require('./portcam-camera-preset-transfer.js');

function settings(overrides = {}) { return {...CameraDefaults.FACTORY_DEFAULTS, ...overrides}; }
function preset(id, name, overrides = {}) { return {id, name, settings: settings(overrides)}; }
function storage() {
  const values = new Map();
  let failureKey = null;
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { if (key === failureKey) throw new Error(`blocked ${key}`); values.set(key, value); },
    failKey(key) { failureKey = key; },
    allowWrites() { failureKey = null; }
  };
}
function repositories(sharedStorage = storage()) {
  return {
    storage: sharedStorage,
    defaults: CameraDefaults.createRepository({storage: sharedStorage}),
    presets: CameraPresets.createRepository({storage: sharedStorage})
  };
}

test('bundle round-trip is strict, deterministic, defensive, and excludes Factory Defaults', () => {
  const input = {
    cameraDefaults: settings({heightM: 12}),
    presets: [
      {id: CameraPresets.FACTORY_PRESET_ID, name: CameraPresets.FACTORY_PRESET_NAME, settings: settings()},
      preset('z-id', 'Zulu', {focalLengthMm: 50}),
      preset('a-id', 'Alpha', {focalLengthMm: 35})
    ],
    exportedAt: '2026-08-22T12:00:00.000Z'
  };
  const first = Transfer.buildBundle(input);
  const second = Transfer.buildBundle(input);
  assert.equal(first.ok, true);
  assert.deepEqual(first.bundle, second.bundle);
  assert.deepEqual(first.bundle.presets.map(item => item.name), ['Alpha', 'Zulu']);
  assert.equal(first.bundle.presets.some(item => item.id === CameraPresets.FACTORY_PRESET_ID), false);
  const roundTrip = Transfer.validateBundle(JSON.parse(JSON.stringify(first.bundle)));
  assert.deepEqual(roundTrip, first);
  first.bundle.cameraDefaults.heightM = 999;
  first.bundle.presets[0].settings.heightM = 999;
  assert.equal(input.cameraDefaults.heightM, 12);
  assert.equal(input.presets[2].settings.heightM, 20);
});

test('bundle validation rejects malformed, extra, duplicate, factory, and illegal content', () => {
  const valid = Transfer.buildBundle({cameraDefaults: settings(), presets: [], exportedAt: '2026-08-22T12:00:00.000Z'}).bundle;
  const invalids = [
    '{',
    {...valid, schemaVersion: 'camera-preset-library/0.9'},
    {...valid, extra: true},
    {...valid, cameraDefaults: {...valid.cameraDefaults, extra: true}},
    {...valid, presets: [preset('factory-defaults', 'Spoof', {heightM: 4})]},
    {...valid, presets: [preset('a', 'A'), preset('b', 'a')]},
    {...valid, presets: [preset('a', 'A', {heightM: 0})]}
  ];
  invalids.forEach(value => assert.equal(Transfer.validateBundle(value).ok, false));
  assert.equal(Transfer.validateBundle({...valid, exportedAt: 'not-a-date'}).ok, false);
});

test('bulk replace validates once and keeps the built-in Factory entry outside storage', () => {
  const repo = CameraPresets.createRepository({storage: storage()});
  const replaced = repo.replacePresets([preset('new-id', 'New')]);
  assert.equal(replaced.ok, true);
  assert.deepEqual(repo.list().map(item => item.id), ['factory-defaults', 'new-id']);
  const invalid = repo.replacePresets([preset('bad', 'Bad', {widthPx: 12.5})]);
  assert.equal(invalid.ok, false);
  assert.deepEqual(repo.list().map(item => item.id), ['factory-defaults', 'new-id']);
});

test('Merge skips exact duplicates and renames ID/name conflicts with deterministic Imported suffixes', () => {
  const local = [
    preset('local-harbor', 'Harbor', {focalLengthMm: 50}),
    preset('local-other', 'Other', {focalLengthMm: 55}),
    preset('local-other-imported', 'Other (Imported)', {focalLengthMm: 60}),
    preset('local-unique-id', 'Local Unique', {focalLengthMm: 65})
  ];
  const bundle = Transfer.buildBundle({
    cameraDefaults: settings(),
    presets: [
      preset('local-harbor', 'harbor', {focalLengthMm: 50}),
      preset('local-harbor', 'Duplicate ID', {focalLengthMm: 60}),
      preset('incoming-other', 'Other', {focalLengthMm: 70}),
      preset('incoming-new', 'New Preset', {focalLengthMm: 80})
    ],
    exportedAt: '2026-08-22T12:00:00.000Z'
  });
  assert.equal(bundle.ok, false, 'bundle validation must reject duplicate incoming IDs');

  const validBundle = Transfer.buildBundle({
    cameraDefaults: settings(),
    presets: [
      preset('local-harbor', 'harbor', {focalLengthMm: 50}),
      preset('local-unique-id', 'Unique ID', {focalLengthMm: 70}),
      preset('incoming-other', 'Other', {focalLengthMm: 75}),
      preset('incoming-new', 'New Preset', {focalLengthMm: 80})
    ],
    exportedAt: '2026-08-22T12:00:00.000Z'
  });
  assert.equal(validBundle.ok, true);
  const planned = Transfer.planImport(validBundle.bundle, {
    mode: 'merge',
    currentDefaults: settings(),
    currentPresets: local,
    idFactory: index => `imported-id-${index + 1}`
  });
  assert.equal(planned.ok, true);
  assert.equal(planned.plan.summary.added, 3);
  assert.equal(planned.plan.summary.skipped, 1);
  assert.equal(planned.plan.summary.renamed, 2);
  assert.deepEqual(planned.plan.summary.skippedNames, ['harbor']);
  assert.deepEqual(planned.plan.summary.renamedNames, ['Other (Imported 2)', 'Unique ID (Imported)']);
  assert.deepEqual(planned.plan.nextPresets.map(item => item.name), ['Harbor', 'Local Unique', 'New Preset', 'Other', 'Other (Imported 2)', 'Other (Imported)', 'Unique ID (Imported)']);
  assert.equal(planned.plan.nextPresets.some(item => item.id === 'incoming-new'), true);
});

test('Replace and defaults checkbox produce a write-ready plan with removal counts', () => {
  const plan = Transfer.planImport(Transfer.buildBundle({
    cameraDefaults: settings({heightM: 12}),
    presets: [preset('incoming', 'Incoming')],
    exportedAt: '2026-08-22T12:00:00.000Z'
  }).bundle, {
    mode: 'replace',
    applyCameraDefaults: false,
    currentDefaults: settings({heightM: 20}),
    currentPresets: [preset('local', 'Local')]
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.plan.nextDefaults, settings({heightM: 20}));
  assert.deepEqual(plan.plan.summary, {
    mode: 'replace', added: 1, skipped: 0, renamed: 0, removed: 1,
    defaultsSelected: false, defaultsChanged: false, defaultsApplied: 0,
    addedNames: ['Incoming'], skippedNames: [], renamedNames: [], removedNames: ['Local']
  });
});

test('coordinator applies a plan without Project mutation and rolls back on either storage failure', () => {
  const shared = storage();
  const repos = repositories(shared);
  assert.equal(repos.defaults.save(settings({heightM: 20})).ok, true);
  assert.equal(repos.presets.createPreset(preset('local', 'Local')).ok, true);
  const coordinator = Transfer.createCoordinator({cameraDefaultsRepository: repos.defaults, cameraPresetsRepository: repos.presets, idFactory: () => 'imported-id'});
  const bundle = Transfer.buildBundle({
    cameraDefaults: settings({heightM: 12}),
    presets: [preset('incoming', 'Incoming')],
    exportedAt: '2026-08-22T12:00:00.000Z'
  });
  const beforeDefaults = repos.defaults.getDefaults();
  const beforePresets = repos.presets.list();

  const defaultsFailurePlan = coordinator.planImport(bundle.bundle);
  shared.failKey(CameraDefaults.STORAGE_KEY);
  const defaultsFailure = coordinator.applyImport(defaultsFailurePlan.plan);
  assert.equal(defaultsFailure.ok, false);
  assert.deepEqual(repos.defaults.getDefaults(), beforeDefaults);
  assert.deepEqual(repos.presets.list(), beforePresets);

  shared.allowWrites();
  const presetFailurePlan = coordinator.planImport(bundle.bundle);
  shared.failKey(CameraPresets.STORAGE_KEY);
  const presetFailure = coordinator.applyImport(presetFailurePlan.plan);
  assert.equal(presetFailure.ok, false);
  assert.deepEqual(repos.defaults.getDefaults(), beforeDefaults);
  assert.deepEqual(repos.presets.list(), beforePresets);

  shared.allowWrites();
  const appliedPlan = coordinator.planImport(bundle.bundle);
  const applied = coordinator.applyImport(appliedPlan.plan);
  assert.equal(applied.ok, true);
  assert.equal(repos.defaults.getDefaults().heightM, 12);
  assert.deepEqual(repos.presets.list().map(item => item.name), ['Factory Defaults', 'Incoming', 'Local']);
});

test('coordinator rejects stale plans and refuses export when repository read fell back', () => {
  const shared = storage();
  const repos = repositories(shared);
  const coordinator = Transfer.createCoordinator({cameraDefaultsRepository: repos.defaults, cameraPresetsRepository: repos.presets});
  const bundle = coordinator.buildBundle();
  assert.equal(bundle.ok, true);
  const plan = coordinator.planImport(bundle.bundle);
  assert.equal(repos.presets.createPreset(preset('new', 'New')).ok, true);
  assert.equal(coordinator.applyImport(plan.plan).error.code, 'stale-plan');

  const broken = repositories({getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }});
  const brokenCoordinator = Transfer.createCoordinator({cameraDefaultsRepository: broken.defaults, cameraPresetsRepository: broken.presets});
  assert.equal(brokenCoordinator.buildBundle().ok, false);
});
