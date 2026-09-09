const assert = require('node:assert/strict');
const test = require('node:test');

const Core = require('./portcam-core.js');
const Criteria = require('./portcam-criteria.js');
const MapApi = require('./portcam-map.js');

const camera = {
  id: 'camera-a',
  position: {latitudeDeg: 22.6, longitudeDeg: 120.28},
  heightM: 20,
  headingDeg: 0,
  tiltDownDeg: 20,
  sensorWidthMm: 7.2,
  sensorHeightMm: 4.05,
  widthPx: 2560,
  heightPx: 1440,
  focalLengthMm: 14,
  revision: 0
};

test('criteria profiles expose stable defensive data with explicit level order', () => {
  const heuristic = Criteria.getCriteriaProfile();
  const johnson = Criteria.getCriteriaProfile('johnson-dri-2px-v1');
  assert.equal(heuristic.profileId, 'pixel-heuristic-v1');
  assert.deepEqual(heuristic.levelOrder, ['robust', 'usable', 'difficult', 'notRecommended']);
  assert.deepEqual(heuristic.levels.map(level => level.minPx), [32, 16, 8, 0]);
  assert.deepEqual(johnson.levelOrder, ['identification', 'recognition', 'detection', 'belowDetection']);
  assert.deepEqual(johnson.levels.map(level => level.minPx), [12.8, 8, 2, 0]);

  heuristic.levels[0].minPx = -1;
  heuristic.levelOrder.push('mutated');
  assert.equal(Criteria.getCriteriaProfile().levels[0].minPx, 32);
  assert.deepEqual(Criteria.getCriteriaProfile().levelOrder, ['robust', 'usable', 'difficult', 'notRecommended']);
  assert.equal(Criteria.getCriteriaProfile('unknown-profile'), null);
});

test('evaluateCoverage keeps exact Johnson DRI boundaries and rejects coercion', () => {
  const profileId = 'johnson-dri-2px-v1';
  const cases = [
    [0, 'belowDetection'],
    [1.999, 'belowDetection'],
    [2, 'detection'],
    [7.999, 'detection'],
    [8, 'recognition'],
    [12.799, 'recognition'],
    [12.8, 'identification'],
    [100, 'identification']
  ];
  for (const [px, levelId] of cases) {
    assert.deepEqual(Criteria.evaluateCoverage(px, {profileId}), {
      valid: true,
      profileId,
      levelId,
      px,
      meetsThreshold: null,
      reason: null
    });
  }
  assert.equal(Criteria.evaluateCoverage(8, {profileId, minimumLevel: 'recognition'}).meetsThreshold, true);
  assert.equal(Criteria.evaluateCoverage(8, {profileId, minimumLevel: 'identification'}).meetsThreshold, false);
  assert.equal(Criteria.evaluateCoverage(8, {profileId, minimumLevel: 'missing'}).reason, 'unknown-minimum-level');
  assert.equal(Criteria.evaluateCoverage(16).levelId, 'usable');

  for (const px of ['8', NaN, Infinity, -0.001]) {
    const result = Criteria.evaluateCoverage(px, {profileId});
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'invalid-pixels');
  }
  assert.equal(Criteria.evaluateCoverage(8, {profileId: 'missing'}).reason, 'unknown-profile');
});

test('criteria evaluates real Observation coveragePixels without changing the Observation model', () => {
  const targetPosition = Core.destinationPoint(camera.position, 0, 50);
  const observation = Core.computeObservation(camera, {
    id: 'target-a',
    position: targetPosition,
    lengthM: 8,
    widthM: 2.5,
    heightM: 3,
    headingDeg: 0
  });
  assert.equal(observation.visibilityState, 'visible');
  assert.ok(Object.hasOwn(observation, 'coveragePixels'));
  const evaluated = Criteria.evaluateCoverage(observation.coveragePixels.height, {profileId: 'johnson-dri-2px-v1'});
  assert.equal(evaluated.valid, true);
  assert.equal(evaluated.px, observation.coveragePixels.height);
  assert.ok(['identification', 'recognition', 'detection', 'belowDetection'].includes(evaluated.levelId));
});

test('map coverage bands consume shared Johnson thresholds while heuristic geometry stays compatible', () => {
  const mapCamera = {...camera, tiltDownDeg: 5};
  const settings = {planningTargetHeightM: 2, pixelCoverageReferenceSizeM: 2};
  const heuristic = MapApi.coverageBandRanges(mapCamera, settings);
  const johnson = MapApi.coverageBandRanges(mapCamera, settings, {profileId: 'johnson-dri-2px-v1'});
  assert.deepEqual(heuristic.map(band => band.key), ['robust', 'usable', 'difficult', 'notRecommended']);
  assert.deepEqual(johnson.map(band => band.key), ['identification', 'recognition', 'detection', 'belowDetection']);
  assert.ok(johnson.every(band => band.profileId === 'johnson-dri-2px-v1'));
  assert.deepEqual(johnson.map(band => band.minPx), [12.8, 8, 2, 0]);
  assert.ok(johnson.every(band => band.innerM >= 0 && band.outerM <= 30000 && band.outerM > band.innerM));
  assert.equal(MapApi.coverageBandRanges(mapCamera, settings, {profileId: 'unknown-profile'}).length, heuristic.length);
});
