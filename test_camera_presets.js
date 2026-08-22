const test = require('node:test');
const assert = require('node:assert/strict');
const CameraDefaults = require('./portcam-camera-defaults.js');
const CameraPresets = require('./portcam-camera-presets.js');

function memoryStorage(initial = null) {
  const values = new Map();
  if (initial !== null) values.set(CameraPresets.STORAGE_KEY, initial);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, next) { values.set(key, next); },
    raw(key = CameraPresets.STORAGE_KEY) { return values.get(key) ?? null; }
  };
}

function settings(overrides = {}) { return {...CameraDefaults.FACTORY_DEFAULTS, ...overrides}; }
function custom(name, overrides = {}) { return {name, settings: settings(overrides)}; }

test('factory preset is built-in, read-only, and separate from storage', () => {
  const storage = memoryStorage();
  const repository = CameraPresets.createRepository({storage});
  const factory = repository.list()[0];
  assert.deepEqual(factory, {id: 'factory-defaults', name: 'Factory Defaults', settings: CameraDefaults.FACTORY_DEFAULTS});
  assert.equal(storage.raw(), null);
  const copied = repository.factoryPreset();
  copied.settings.heightM = 999;
  assert.equal(repository.factoryPreset().settings.heightM, 20);
  assert.equal(repository.deletePreset('factory-defaults').ok, false);
  assert.equal(repository.renamePreset('factory-defaults', 'Other').ok, false);
  assert.equal(repository.updatePreset('factory-defaults', settings({heightM: 4})).ok, false);
});

test('valid presets persist with defensive copies and deterministic name sorting', () => {
  const storage = memoryStorage();
  const repository = CameraPresets.createRepository({storage});
  const beta = repository.createPreset(custom('beta'));
  const alpha = repository.createPreset(custom('Alpha', {heightM: 12}));
  assert.equal(beta.ok, true);
  assert.equal(alpha.ok, true);
  assert.deepEqual(repository.list().map(preset => preset.name), ['Factory Defaults', 'Alpha', 'beta']);
  beta.preset.settings.heightM = 999;
  assert.equal(repository.get(beta.preset.id).settings.heightM, 20);
  const reloaded = CameraPresets.createRepository({storage});
  assert.deepEqual(reloaded.list(), repository.list());
  assert.deepEqual(JSON.parse(storage.raw()).schemaVersion, 'camera-presets/1.0');
});

test('create, rename, update, duplicate, and delete preserve IDs and reject invalid names', () => {
  const repository = CameraPresets.createRepository({storage: memoryStorage()});
  const created = repository.createPreset(custom('Port Entrance'));
  assert.equal(created.ok, true);
  const id = created.preset.id;
  assert.equal(repository.createPreset(custom(' port entrance ')).ok, false);
  assert.equal(repository.createPreset(custom('   ')).ok, false);
  assert.equal(repository.createPreset(custom('factory defaults')).ok, false);
  assert.equal(repository.renamePreset(id, 'Long Lens').preset.id, id);
  assert.equal(repository.get(id).name, 'Long Lens');
  assert.equal(repository.updatePreset(id, {settings: settings({focalLengthMm: 50})}).preset.id, id);
  assert.equal(repository.get(id).settings.focalLengthMm, 50);
  const duplicate = repository.duplicatePreset(id);
  assert.equal(duplicate.ok, true);
  assert.notEqual(duplicate.preset.id, id);
  assert.equal(duplicate.preset.name, 'Long Lens Copy');
  assert.equal(repository.deletePreset(id).ok, true);
  assert.equal(repository.get(id), null);
  assert.equal(repository.get(duplicate.preset.id).name, 'Long Lens Copy');
});

test('invalid payload discards all custom presets without touching camera defaults storage', () => {
  const storage = memoryStorage(JSON.stringify({
    schemaVersion: 'camera-presets/1.0',
    presets: [{id: 'bad', name: 'Bad', settings: settings({heightM: 0})}]
  }));
  const repository = CameraPresets.createRepository({storage});
  const result = repository.read();
  assert.equal(result.ok, false);
  assert.deepEqual(repository.list().map(preset => preset.id), ['factory-defaults']);
  const cameraDefaults = CameraDefaults.createRepository({storage, storageKey: 'camera-defaults'});
  assert.deepEqual(cameraDefaults.getDefaults(), CameraDefaults.FACTORY_DEFAULTS);
});

test('storage exception retains the previous library and invalid settings never partially apply', () => {
  let raw = null;
  const workingStorage = {getItem() { return raw; }, setItem(_key, value) { raw = value; }};
  const repository = CameraPresets.createRepository({storage: workingStorage});
  const created = repository.createPreset(custom('Working'));
  assert.equal(created.ok, true);
  const before = repository.list();
  const failingStorage = {getItem() { return raw; }, setItem() { throw new Error('quota exceeded'); }};
  const failing = CameraPresets.createRepository({storage: failingStorage});
  assert.deepEqual(failing.list(), before);
  const failed = failing.updatePreset(created.preset.id, {settings: settings({widthPx: 12.5})});
  assert.equal(failed.ok, false);
  assert.deepEqual(failing.list(), before);
  assert.match(failing.createPreset(custom('working')).error.message, /重複/);
});

test('storage read exception falls back to Factory Defaults without throwing', () => {
  const repository = CameraPresets.createRepository({storage: {getItem() { throw new Error('blocked'); }}});
  const result = repository.read();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'storage-read');
  assert.deepEqual(result.presets.map(preset => preset.id), ['factory-defaults']);
  assert.deepEqual(repository.getStatus().presets.map(preset => preset.id), ['factory-defaults']);
});

test('malformed, wrong-version, and duplicate-name payloads fall back to Factory Defaults', () => {
  const payloads = [
    '{',
    JSON.stringify({schemaVersion: 'camera-presets/0.9', presets: []}),
    JSON.stringify({schemaVersion: 'camera-presets/1.0', presets: [{id: 'a', name: 'A', settings: settings()}, {id: 'b', name: 'a', settings: settings()}]}),
    JSON.stringify({schemaVersion: 'camera-presets/1.0', presets: [{id: 'a', name: 'A', settings: {...settings(), extra: true}}]})
  ];
  payloads.forEach(raw => {
    const repository = CameraPresets.createRepository({storage: memoryStorage(raw)});
    assert.equal(repository.read().ok, false);
    assert.deepEqual(repository.list().map(preset => preset.id), ['factory-defaults']);
  });
});
