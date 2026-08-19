/* Pure, non-persistent YOLO Coverage derivation for port-cam-plan. */
(function (root, factory) {
  const api = factory(root.PortCamComparison || (typeof require === 'function' ? require('./portcam-comparison.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamYoloCoverage = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Comparison) {
  'use strict';
  if (!Comparison) throw new Error('PortCamYoloCoverage requires PortCamComparison');

  const OUTSIDE_STATES = new Set(['outside-hfov', 'outside-vfov', 'outside-fov']);
  const COVERAGE_COLORS = Object.freeze({robust: '#15803d', usable: '#a16207', difficult: '#c2410c', notRecommended: '#b42318'});
  const TIER_DEFINITIONS = Object.freeze([
    Object.freeze({key: 'robust', label: 'Robust', thresholdLabel: '≥ 32 px', minPx: 32}),
    Object.freeze({key: 'usable', label: 'Usable', thresholdLabel: '16–<32 px', minPx: 16}),
    Object.freeze({key: 'difficult', label: 'Difficult', thresholdLabel: '8–<16 px', minPx: 8}),
    Object.freeze({key: 'notRecommended', label: 'Not recommended', thresholdLabel: '< 8 px', minPx: 0})
  ]);

  function finiteNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function classifyYoloTier(shortSidePx) {
    const value = finiteNumber(shortSidePx);
    if (value === null || value < 0) return null;
    return TIER_DEFINITIONS.find(tier => value >= tier.minPx) || null;
  }

  function classificationFor(observation) {
    if (observation?.calculationState === 'failed') {
      return {observationKey: 'failed', observationLabel: 'Failed', observationClassName: 'error', tier: null};
    }
    if (!observation || observation.calculationState !== 'current' || observation.visibilityState === 'unavailable') {
      return {observationKey: 'unavailable', observationLabel: 'Unavailable', observationClassName: 'neutral', tier: null};
    }
    if (OUTSIDE_STATES.has(observation.visibilityState)) {
      return {observationKey: 'outside-fov', observationLabel: 'Outside FOV', observationClassName: 'draft', tier: null};
    }
    if (observation.visibilityState !== 'visible') {
      return {observationKey: 'unavailable', observationLabel: 'Unavailable', observationClassName: 'neutral', tier: null};
    }
    const tier = classifyYoloTier(observation.yolo?.shortSidePx);
    if (!tier) return {observationKey: 'unavailable', observationLabel: 'Unavailable', observationClassName: 'neutral', tier: null};
    return {observationKey: 'visible', observationLabel: 'Visible', observationClassName: 'ready', tier};
  }

  function buildYoloCoverage(options = {}) {
    const comparison = options.comparison || Comparison.buildCameraComparison({
      cameraOrder: options.cameraOrder,
      camerasById: options.camerasById || options.cameras,
      currentTarget: options.currentTarget || null,
      activeCameraId: options.activeCameraId,
      getObservation: options.getObservation
    });
    const counts = {robust: 0, usable: 0, difficult: 0, notRecommended: 0, outsideFov: 0, unavailableFailed: 0, unavailable: 0, failed: 0};
    const rows = comparison.rows.map(row => {
      const classification = classificationFor(row.observation);
      if (classification.tier) counts[classification.tier.key] += 1;
      else if (classification.observationKey === 'outside-fov') counts.outsideFov += 1;
      else {
        counts.unavailableFailed += 1;
        counts[classification.observationKey] += 1;
      }
      return {...row, yolo: classification};
    });
    return {
      currentTargetId: comparison.currentTargetId,
      enabledCount: comparison.enabledCount,
      disabledCount: comparison.disabledCount,
      counts,
      rows
    };
  }

  return {COVERAGE_COLORS, TIER_DEFINITIONS, classifyYoloTier, classificationFor, buildYoloCoverage};
}));
