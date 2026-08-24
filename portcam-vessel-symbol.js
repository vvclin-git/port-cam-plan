/* Pure SVG symbol factory for the two supported Target model types. */
(function (root, factory) {
  const api = factory(root.PortCamTargetCatalog || (typeof require === 'function' ? require('./portcam-target-catalog.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamVesselSymbol = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Catalog) {
  'use strict';
  if (!Catalog) throw new Error('PortCamVesselSymbol requires PortCamTargetCatalog');

  const SYMBOL_SIZE = 20;
  const GEOGRAPHIC_ZOOM = 10;
  function svgNumber(value) { return Number(value.toFixed(6)); }
  function normalizeHeading(value) { const n = Number(value); return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0; }
  function model(target) { return Catalog.get(target?.modelType) || Catalog.get('small-vessel'); }
  function geometry(target, options) {
    const item = model(target);
    const bridge = item.symbol.bridge;
    const geographic = options?.mode === 'geographic';
    const lengthM = Number(target?.lengthM), widthM = Number(target?.widthM);
    const dimensions = geographic && Number.isFinite(lengthM) && lengthM > 0 && Number.isFinite(widthM) && widthM > 0
      ? {length: lengthM, width: widthM} : {length: 104, width: 60};
    return {model: item, headingDeg: normalizeHeading(target?.headingDeg), bridge, geographic, dimensions};
  }
  function hullPoints(value) {
    const b = value.dimensions.width / 2, l = value.dimensions.length / 2, small = value.model.id === 'small-vessel';
    const points = small ? [[0,-l],[b,-.58*l],[.88*b,.48*l],[.52*b,.92*l],[-.52*b,.92*l],[-.88*b,.48*l],[-b,-.58*l]] : [[0,-l],[b,-.70*l],[b,.80*l],[.72*b,l],[-.72*b,l],[-b,.80*l],[-b,-.70*l]];
    return points.map(point => point.join(',')).join(' ');
  }
  function svg(target, options) {
    const value = geometry(target, options), {width, length} = value.dimensions;
    const bridgeW = width * value.bridge.widthRatio, bridgeH = length * value.bridge.lengthRatio, bridgeY = value.bridge.position * length / 2 - bridgeH / 2;
    const iconWidth = value.geographic ? Number(options?.widthPx) : SYMBOL_SIZE, iconHeight = value.geographic ? Number(options?.heightPx) : SYMBOL_SIZE;
    const viewBox = [-.65 * width, -.55 * length, 1.3 * width, 1.1 * length].map(svgNumber).join(' ');
    return `<svg class="vessel-symbol" viewBox="${viewBox}" width="${iconWidth}" height="${iconHeight}" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(${value.headingDeg})"><polygon class="vessel-hull vessel-hull-${value.model.id}" points="${hullPoints(value)}"/><rect class="vessel-bridge" x="${-bridgeW / 2}" y="${bridgeY}" width="${bridgeW}" height="${bridgeH}" rx="1"/></g></svg>`;
  }
  function iconOptions(target, options) {
    const geographic = options?.mode === 'geographic', widthPx = geographic ? Number(options?.widthPx) : SYMBOL_SIZE, heightPx = geographic ? Number(options?.heightPx) : SYMBOL_SIZE;
    if (!Number.isFinite(widthPx) || widthPx <= 0 || !Number.isFinite(heightPx) || heightPx <= 0) throw new Error('Vessel icon dimensions must be positive pixels.');
    const classes = ['target-marker']; if (options?.selected) classes.push('is-selected'); if (target?.locked) classes.push('is-locked'); if (target?.enabled === false) classes.push('is-disabled'); if (options?.preview) classes.push('is-preview');
    if (geographic) classes.push('is-geographic');
    return {className: 'entity-marker-wrapper', html: `<span class="${classes.join(' ')}">${svg(target, options)}</span>`, iconSize: [widthPx, heightPx], iconAnchor: [widthPx / 2, heightPx / 2]};
  }
  return {SYMBOL_SIZE, GEOGRAPHIC_ZOOM, normalizeHeading, geometry, svg, iconOptions};
}));
