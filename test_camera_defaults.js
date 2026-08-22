const test = require('node:test');
const assert = require('node:assert/strict');
const CameraDefaults = require('./portcam-camera-defaults.js');
const PortCamUI = require('./portcam-ui.js');

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem() { return value; },
    setItem(_key, next) { value = next; },
    raw() { return value; }
  };
}

function valid(overrides = {}) {
  return {...CameraDefaults.FACTORY_DEFAULTS, ...overrides};
}

test('defaultProject accepts validated camera defaults for the initial Camera A', () => {
  const defaults = valid({heightM: 33, tiltDownDeg: 8, sensorWidthMm: 6.4, sensorHeightMm: 3.6, widthPx: 3000, heightPx: 1688, focalLengthMm: 85});
  const project = PortCamUI.defaultProject({cameraDefaults: defaults});
  assert.deepEqual(Object.fromEntries(CameraDefaults.FIELDS.map(field => [field, project.cameras[0][field]])), defaults);
  assert.equal(project.cameras[0].headingDeg, 90);
});

test('factory defaults are complete, versioned, and defensively copied', () => {
  assert.equal(CameraDefaults.SCHEMA_VERSION, 'camera-defaults/1.0');
  assert.deepEqual(Object.keys(CameraDefaults.FACTORY_DEFAULTS).sort(), CameraDefaults.FIELDS.slice().sort());
  const repository = CameraDefaults.createRepository();
  const first = repository.getDefaults();
  first.heightM = 999;
  assert.equal(repository.getDefaults().heightM, 20);
  const factory = repository.factoryDefaults();
  factory.sensorWidthMm = 999;
  assert.equal(repository.factoryDefaults().sensorWidthMm, 7.2);
});

test('valid defaults read and write with the camera-defaults/1.0 payload', () => {
  const storage = memoryStorage();
  const repository = CameraDefaults.createRepository({storage});
  const next = valid({heightM: 31.5, tiltDownDeg: 12, widthPx: 3840, heightPx: 2160});
  const saved = repository.save(next);
  assert.equal(saved.ok, true);
  next.heightM = 1;
  assert.equal(repository.getDefaults().heightM, 31.5);
  assert.deepEqual(JSON.parse(storage.raw()), {schemaVersion: 'camera-defaults/1.0', defaults: valid({heightM: 31.5, tiltDownDeg: 12, widthPx: 3840, heightPx: 2160})});
  const reloaded = CameraDefaults.createRepository({storage});
  assert.deepEqual(reloaded.read().defaults, valid({heightM: 31.5, tiltDownDeg: 12, widthPx: 3840, heightPx: 2160}));
});

test('incomplete, version-mismatched, and illegal storage data falls back as one factory set', () => {
  const invalidPayloads = [
    '{',
    JSON.stringify({schemaVersion: 'camera-defaults/0.9', defaults: valid()}),
    JSON.stringify({schemaVersion: 'camera-defaults/1.0', defaults: {...valid(), heightM: 0}}),
    JSON.stringify({schemaVersion: 'camera-defaults/1.0', defaults: {...valid(), widthPx: 12.5}}),
    JSON.stringify({schemaVersion: 'camera-defaults/1.0', defaults: {...valid(), focalLengthMm: '147.5'}}),
    JSON.stringify({schemaVersion: 'camera-defaults/1.0', defaults: {...valid(), position: {latitudeDeg: 1}}}),
    JSON.stringify({schemaVersion: 'camera-defaults/1.0', defaults: {...valid(), heightM: null}})
  ];
  invalidPayloads.forEach(raw => {
    const result = CameraDefaults.createRepository({storage: memoryStorage(raw)}).read();
    assert.equal(result.ok, false);
    assert.deepEqual(result.defaults, CameraDefaults.FACTORY_DEFAULTS);
  });
});

test('storage read exception uses factory defaults and leaves the app recoverable', () => {
  const errorStorage = {getItem() { throw new Error('blocked by browser'); }, setItem() { throw new Error('blocked by browser'); }};
  const repository = CameraDefaults.createRepository({storage: errorStorage});
  const loaded = repository.read();
  assert.equal(loaded.ok, false);
  assert.equal(loaded.defaults.heightM, 20);
  assert.match(loaded.error.message, /blocked/);
  const saved = repository.save(valid({heightM: 40}));
  assert.equal(saved.ok, false);
  assert.equal(saved.defaults.heightM, 20);
});

test('missing storage is reported while factory defaults keep startup recoverable', () => {
  const repository = CameraDefaults.createRepository();
  const loaded = repository.read();
  assert.equal(loaded.ok, false);
  assert.equal(loaded.error.code, 'storage-unavailable');
  assert.deepEqual(loaded.defaults, CameraDefaults.FACTORY_DEFAULTS);
});

test('write exception preserves the previously loaded defaults', () => {
  let stored = JSON.stringify({schemaVersion: 'camera-defaults/1.0', defaults: valid({heightM: 25})});
  const storage = {getItem() { return stored; }, setItem() { throw new Error('quota exceeded'); }};
  const repository = CameraDefaults.createRepository({storage});
  assert.equal(repository.getDefaults().heightM, 25);
  const result = repository.save(valid({heightM: 50}));
  assert.equal(result.ok, false);
  assert.equal(repository.getDefaults().heightM, 25);
  assert.equal(JSON.parse(stored).defaults.heightM, 25);
});

test('validation rejects non-positive dimensions and non-integer resolution', () => {
  [
    {heightM: 0}, {sensorWidthMm: -1}, {sensorHeightMm: 0}, {focalLengthMm: -1}, {widthPx: 0}, {heightPx: 1.5}, {tiltDownDeg: Infinity}
  ].forEach(overrides => assert.equal(CameraDefaults.validateDefaults(valid(overrides)).ok, false));
  assert.equal(CameraDefaults.validateDefaults(valid({tiltDownDeg: -10})).ok, true);
});
