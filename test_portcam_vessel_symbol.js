const test = require('node:test');
const assert = require('node:assert/strict');
const Catalog = require('./portcam-target-catalog.js');
const Symbols = require('./portcam-vessel-symbol.js');

test('catalog fixes the two supported Target model defaults and bridge geometry', () => {
  assert.deepEqual(Catalog.defaults('small-vessel'), {modelType: 'small-vessel', lengthM: 30, widthM: 10, heightM: 12});
  assert.deepEqual(Catalog.defaults('large-vessel'), {modelType: 'large-vessel', lengthM: 300, widthM: 48, heightM: 40});
  assert.equal(Catalog.get('small-vessel').symbol.bridge.position, .10);
  assert.equal(Catalog.get('large-vessel').symbol.bridge.position, .72);
});

test('SVG symbol keeps heading rotation inside the SVG and projects state outside the vessel', () => {
  const target = {modelType: 'large-vessel', headingDeg: 450, locked: true, enabled: false};
  const markup = Symbols.svg(target);
  const icon = Symbols.iconOptions(target, {selected: true});
  assert.match(markup, /<g transform="rotate\(90\)">/);
  assert.match(markup, /vessel-hull-large-vessel/);
  assert.equal(icon.iconSize[0], Symbols.SYMBOL_SIZE);
  assert.match(icon.html, /is-selected/);
  assert.match(icon.html, /is-locked/);
  assert.match(icon.html, /is-disabled/);
  assert.doesNotMatch(icon.html, /style="[^\"]*rotate/);
});

test('geographic symbols use real Target length and width while retaining SVG heading rotation', () => {
  const target = {modelType: 'large-vessel', lengthM: 300, widthM: 48, headingDeg: 90};
  const icon = Symbols.iconOptions(target, {mode: 'geographic', widthPx: 96, heightPx: 600});
  assert.deepEqual(icon.iconSize, [96, 600]);
  assert.deepEqual(icon.iconAnchor, [48, 300]);
  assert.match(icon.html, /viewBox="-31\.2 -165 62\.4 330"/);
  assert.match(icon.html, /rotate\(90\)/);
  assert.match(icon.html, /is-geographic/);
});
