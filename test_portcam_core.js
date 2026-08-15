const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const Core = require('./portcam-core.js');

const source = {
  id: 'test-source',
  name: 'Test source',
  type: 'xyz',
  urlTemplate: 'https://example.invalid/{z}/{x}/{y}.png',
  crs: 'EPSG:3857',
  tileSizePx: 256,
  minZoom: 0,
  maxZoom: 19,
  urlCoordinateOrder: 'z-x-y',
  networkRequired: true,
  attribution: 'test'
};

const defaultCamera = {
  position: {latitudeDeg: 22.6082, longitudeDeg: 120.2824},
  heightM: 20,
  headingDeg: 90,
  tiltDownDeg: 2,
  sensorWidthMm: 7.2,
  sensorHeightMm: 4.05,
  widthPx: 2560,
  heightPx: 1440,
  focalLengthMm: 147.5
};

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

function observationCamera() {
  return {
    id: 'camera-a',
    position: {latitudeDeg: 22.6, longitudeDeg: 120.28},
    heightM: 10,
    headingDeg: 0,
    tiltDownDeg: 5.137,
    sensorWidthMm: 10,
    sensorHeightMm: 5,
    widthPx: 1000,
    heightPx: 500,
    focalLengthMm: 100,
    revision: 1
  };
}

function targetAt(bearingDeg, distanceM, overrides = {}) {
  const point = Core.destinationPoint(observationCamera(), bearingDeg, distanceM);
  return {
    id: overrides.id || 'target-a',
    position: {latitudeDeg: point.lat, longitudeDeg: point.lng},
    lengthM: 5,
    widthM: 2,
    heightM: 2,
    headingDeg: 0,
    revision: 1,
    ...overrides
  };
}

test('default optics, horizon, and spherical envelope retain the current model', () => {
  const optics = Core.computeOptics(defaultCamera);
  close(optics.pixelPitchMm, 0.0028125);
  close(optics.horizontalFovDeg, 2.7962557856336505);
  close(optics.verticalFovDeg, 1.5731073210512652);
  const horizon = Core.computePlanningHorizon(20, 2);
  close(horizon.distanceKm, 21.014267777020446);
  const envelope = Core.computeGroundEnvelope(defaultCamera, optics, {horizonDistanceM: horizon.distanceM});
  assert.equal(envelope.footprintStatus, 'finite');
  assert.equal(envelope.maximumRayDistanceM, horizon.distanceM);
});

test('heading normalization and circular angle differences cover cardinal and wraparound cases', () => {
  assert.equal(Core.normalizeHeading(0), 0);
  assert.equal(Core.normalizeHeading(90), 90);
  assert.equal(Core.normalizeHeading(180), 180);
  assert.equal(Core.normalizeHeading(270), 270);
  assert.equal(Core.normalizeHeading(360), 0);
  assert.equal(Core.angleDifference(359, 1), 2);
  assert.equal(Core.angleDifference(1, 359), 2);
  assert.equal(Core.angleDifference(180, 0), 180);
});

test('positive tilt is downward, negative tilt can have no ground intersection', () => {
  const optics = Core.computeOptics({...defaultCamera, focalLengthMm: 30});
  const positive = Core.computeGroundEnvelope({...defaultCamera, tiltDownDeg: 20}, optics, {horizonDistanceM: 1000});
  assert.ok(positive.envelopeNearDistanceM >= 0);
  const clipped = Core.computeGroundEnvelope({...defaultCamera, tiltDownDeg: 1}, optics, {horizonDistanceM: 1000});
  assert.equal(clipped.footprintStatus, 'horizon-clipped');
  assert.equal(clipped.maximumRayDistanceM, 1000);
  const upward = Core.computeGroundEnvelope({...defaultCamera, tiltDownDeg: -30}, optics, {horizonDistanceM: 1000});
  assert.equal(upward.footprintStatus, 'no-ground-intersection');
  assert.equal(upward.envelopeNearDistanceM, null);
});

test('changing planning target height does not change the camera envelope, while target dimensions change coverage', () => {
  const optics = Core.computeOptics(defaultCamera);
  const horizon = Core.computePlanningHorizon(20, 2);
  const firstEnvelope = Core.computeGroundEnvelope(defaultCamera, optics, {horizonDistanceM: horizon.distanceM});
  const secondEnvelope = Core.computeGroundEnvelope(defaultCamera, optics, {horizonDistanceM: horizon.distanceM});
  assert.deepEqual(secondEnvelope, firstEnvelope);
  const camera = observationCamera();
  const small = targetAt(0, 100, {id: 'small', lengthM: 5, widthM: 2, heightM: 2});
  const large = targetAt(0, 100, {id: 'large', lengthM: 20, widthM: 8, heightM: 8});
  const smallObservation = Core.computeObservation(camera, small);
  const largeObservation = Core.computeObservation(camera, large);
  assert.ok(largeObservation.pixelWidth > smallObservation.pixelWidth);
  assert.ok(largeObservation.yolo.shortSidePx > smallObservation.yolo.shortSidePx);
});

test('observation reports visible, outside HFOV, outside VFOV, and outside FOV', () => {
  const camera = observationCamera();
  assert.equal(Core.computeObservation(camera, targetAt(0, 100)).visibilityState, 'visible');
  assert.equal(Core.computeObservation(camera, targetAt(90, 100, {id: 'hfov'})).visibilityState, 'outside-hfov');
  assert.equal(Core.computeObservation(camera, targetAt(0, 100, {id: 'vfov', elevationM: 20})).visibilityState, 'outside-vfov');
  assert.equal(Core.computeObservation(camera, targetAt(90, 100, {id: 'both', elevationM: 20})).visibilityState, 'outside-fov');
});

test('camera-scene golden comparison excludes only the timestamp', () => {
  const camera = {
    position: {latitudeDeg: 22.6082, longitudeDeg: 120.2824},
    heightM: 10,
    headingDeg: 0,
    tiltDownDeg: 45,
    sensorWidthMm: 10,
    sensorHeightMm: 5,
    widthPx: 4,
    heightPx: 2,
    focalLengthMm: 10
  };
  const actual = Core.buildCameraScene(camera, {
    planningTargetHeightM: 1.7,
    tileZoom: 1,
    footprintSteps: 1,
    exportedAt: '2026-01-01T00:00:00.000Z'
  }, source);
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'testdata', 'camera-scene-core-golden.json'), 'utf8'));
  assert.deepEqual(actual, expected);
  assert.equal('cameras' in actual, false);
  const changedTimestamp = {...actual, exportedAt: '2099-12-31T23:59:59.000Z'};
  assert.deepEqual({...changedTimestamp, exportedAt: expected.exportedAt}, expected);
});

test('project schema omits derived observations by default and preview/commit keep their contracts', () => {
  const project = Core.buildCameraProject({
    projectId: 'p1',
    name: 'Test',
    cameras: [{id: 'camera-a', revision: 4}],
    targets: [{id: 'target-a', revision: 2}],
    observations: [{cameraId: 'camera-a', targetId: 'target-a'}]
  });
  assert.equal(project.schemaVersion, 'camera-project/1.0');
  assert.equal('observations' in project, false);
  const preview = Core.previewCameraPatch({id: 'camera-a', revision: 4}, {headingDeg: 30});
  assert.equal(preview.revision, 4);
  assert.equal(preview.dirty, false);
  const committed = Core.commitCameraPatch({id: 'camera-a', revision: 4}, {headingDeg: 30});
  assert.equal(committed.camera.revision, 5);
  assert.equal(committed.camera.dirty, true);
  assert.equal(committed.transaction.before.revision, 4);
});

test('no-ground scene uses the effective horizon-clipped ray distance', () => {
  const scene = Core.buildCameraScene(
    {...defaultCamera, tiltDownDeg: -30},
    {planningTargetHeightM: 2, tileZoom: 1, exportedAt: '2026-01-01T00:00:00.000Z'},
    source
  );
  assert.equal(scene.tileSelection.footprintStatus, 'no-ground-intersection');
  assert.equal(scene.tileSelection.maximumRayDistanceM, scene.derivedPlanningValues.horizonDistanceM);
  assert.equal(scene.tileSelection.hardMaximumRayDistanceM, 30000);
  assert.deepEqual(scene.tileSelection.tiles, []);
});
