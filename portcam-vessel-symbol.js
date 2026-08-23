/* Pure SVG symbol factory for the two supported Target model types. */
(function (root, factory) {
  const api = factory(root.PortCamTargetCatalog || (typeof require === 'function' ? require('./portcam-target-catalog.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamVesselSymbol = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Catalog) {
  'use strict';
  if (!Catalog) throw new Error('PortCamVesselSymbol requires PortCamTargetCatalog');

  const SYMBOL_SIZE = 40;
  function normalizeHeading(value) { const n = Number(value); return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0; }
  function model(target) { return Catalog.get(target?.modelType) || Catalog.get('small-vessel'); }
  function geometry(target) {
    const item = model(target);
    const bridge = item.symbol.bridge;
    return {model: item, headingDeg: normalizeHeading(target?.headingDeg), bridge};
  }
  function svg(target) {
    const value = geometry(target), small = value.model.id === 'small-vessel';
    const hull = small
      ? '0,-48 17,-28 15,25 9,46 -9,46 -15,25 -17,-28'
      : '0,-49 11,-35 11,40 8,48 -8,48 -11,40 -11,-35';
    const bridgeW = (small ? 34 : 19) * value.bridge.widthRatio;
    const bridgeH = (small ? 28 : 18) * value.bridge.lengthRatio;
    const bridgeY = value.bridge.position * 42 - bridgeH / 2;
    return `<svg class="vessel-symbol" viewBox="-30 -52 60 104" width="40" height="40" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(${value.headingDeg})"><polygon class="vessel-hull vessel-hull-${value.model.id}" points="${hull}"/><rect class="vessel-bridge" x="${-bridgeW / 2}" y="${bridgeY}" width="${bridgeW}" height="${bridgeH}" rx="1"/></g></svg>`;
  }
  function iconOptions(target, options) {
    const classes = ['target-marker']; if (options?.selected) classes.push('is-selected'); if (target?.locked) classes.push('is-locked'); if (target?.enabled === false) classes.push('is-disabled'); if (options?.preview) classes.push('is-preview');
    return {className: 'entity-marker-wrapper', html: `<span class="${classes.join(' ')}">${svg(target)}</span>`, iconSize: [SYMBOL_SIZE, SYMBOL_SIZE], iconAnchor: [SYMBOL_SIZE / 2, SYMBOL_SIZE / 2]};
  }
  return {SYMBOL_SIZE, normalizeHeading, geometry, svg, iconOptions};
}));
