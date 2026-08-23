/* Canonical Target model catalog.  Project Targets keep only the selected type and dimensions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamTargetCatalog = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TYPES = Object.freeze(['small-vessel', 'large-vessel']);
  const MODELS = Object.freeze({
    'small-vessel': Object.freeze({id: 'small-vessel', name: 'Small Tug', dimensions: Object.freeze({lengthM: 30, widthM: 10, heightM: 12}), symbol: Object.freeze({hullProfile: 'tug', bridge: Object.freeze({lengthRatio: .35, widthRatio: .75, position: .10})}), threeScale: Object.freeze({hull: Object.freeze({length: 1, width: 1, height: 1}), bridge: Object.freeze({length: .35, width: .75, longitudinalOffset: .10})})}),
    'large-vessel': Object.freeze({id: 'large-vessel', name: 'Large Container Ship', dimensions: Object.freeze({lengthM: 300, widthM: 48, heightM: 40}), symbol: Object.freeze({hullProfile: 'cargo', bridge: Object.freeze({lengthRatio: .12, widthRatio: .85, position: .72})}), threeScale: Object.freeze({hull: Object.freeze({length: 1, width: 1, height: 1}), bridge: Object.freeze({length: .12, width: .85, longitudinalOffset: .72})})})
  });
  const clone = value => JSON.parse(JSON.stringify(value));
  function isModelType(value) { return TYPES.includes(value); }
  function get(value) { return isModelType(value) ? clone(MODELS[value]) : null; }
  function defaults(value) { const model = get(value || 'small-vessel'); return {modelType: model.id, ...model.dimensions}; }
  return {TYPES: TYPES.slice(), MODELS: clone(MODELS), isModelType, get, defaults};
}));
