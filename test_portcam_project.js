const test = require('node:test');
const assert = require('node:assert/strict');
const Project = require('./portcam-project.js');

const camera = (overrides = {}) => ({
  id: 'camera-a', name: 'Camera A', color: '#2563eb',
  position: {latitudeDeg: 22.6082, longitudeDeg: 120.2824},
  heightM: 20, tiltDownDeg: 2, sensorWidthMm: 7.2, sensorHeightMm: 4.05,
  widthPx: 2560, heightPx: 1440, focalLengthMm: 147.5, headingDeg: 90,
  visible: true, enabled: true, locked: false, revision: 0, ...overrides
});
const target = (overrides = {}) => ({
  id: 'target-a', name: 'Target A', position: {latitudeDeg: 22.61, longitudeDeg: 120.28},
  lengthM: 8, widthM: 2.5, heightM: 3, headingDeg: 0, anchor: 'bottom-center',
  visible: true, enabled: true, locked: false, revision: 0, ...overrides
});
const valid = (overrides = {}) => ({
  schemaVersion: Project.SCHEMA_VERSION, projectId: 'project-1', name: 'Harbor plan',
  settings: {planningTargetHeightM: 2, baseMapKey: 'osm', tileZoom: 18, surfaceVisible: true, coverageTargetDimension: 'short'},
  cameras: [camera()], targets: [target()], ...overrides
});

test('Project validator accepts camera-project/1.0 with optional map and returns a defensive canonical copy', () => {
  const input = valid({map: Project.DEFAULT_MAP});
  const checked = Project.validateProject(input);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.value.map, Project.DEFAULT_MAP);
  checked.value.cameras[0].position.latitudeDeg = 0;
  assert.equal(input.cameras[0].position.latitudeDeg, 22.6082);
});

test('Project validator accepts empty object lists and legacy projects without map', () => {
  const checked = Project.validateProject(valid({cameras: [], targets: []}));
  assert.equal(checked.ok, true);
  assert.equal('map' in checked.value, false);
});

test('Project validator rejects future/extra fields, duplicate IDs, invalid optics/status, coordinates, and map ranges', () => {
  const cases = [
    valid({schemaVersion: 'camera-project/2.0'}),
    valid({extra: true}),
    valid({cameras: [camera(), camera({id: 'camera-a', name: 'Duplicate'})]}),
    valid({targets: [target(), target({id: 'target-a', name: 'Duplicate'})]}),
    valid({cameras: [camera({widthPx: 12.5})]}),
    valid({cameras: [camera({locked: 'false'})]}),
    valid({cameras: [camera({position: {latitudeDeg: 91, longitudeDeg: 0}})]}),
    valid({map: {center: Project.DEFAULT_MAP.center, zoom: 23}})
  ];
  cases.forEach(value => assert.equal(Project.validateProject(value).ok, false));
});

test('Project map defaults are defensive and fixed to the harbor view contract', () => {
  const first = Project.DEFAULT_MAP;
  first.center.latitudeDeg = 0;
  assert.deepEqual(Project.DEFAULT_MAP, {center: {latitudeDeg: 22.61, longitudeDeg: 120.28}, zoom: 15});
});
