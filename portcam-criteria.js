/* Shared, DOM/Store-free pixel-criteria profiles for map and future audits. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamCriteria = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_PROFILE_ID = 'pixel-heuristic-v1';
  const PROFILES = {
    [DEFAULT_PROFILE_ID]: {
      profileId: DEFAULT_PROFILE_ID,
      label: 'Pixel heuristic (8/16/32 px)',
      assumption: 'Pixel thresholds are site-planning heuristics, not guaranteed YOLO detection performance.',
      referenceDescription: 'Map reference size only; actual Target dimensions drive Observation and Coverage Audit.',
      levels: [
        {levelId: 'robust', label: 'Robust', thresholdLabel: '≥ 32 px', minPx: 32},
        {levelId: 'usable', label: 'Usable', thresholdLabel: '16–<32 px', minPx: 16},
        {levelId: 'difficult', label: 'Difficult', thresholdLabel: '8–<16 px', minPx: 8},
        {levelId: 'notRecommended', label: 'Not recommended', thresholdLabel: '< 8 px', minPx: 0}
      ]
    },
    'johnson-dri-2px-v1': {
      profileId: 'johnson-dri-2px-v1',
      label: 'Johnson DRI (approx.)',
      assumption: 'Johnson-inspired sampling estimate; not a performance guarantee.',
      referenceDescription: 'Reference size is a critical dimension approximation; it is not automatically vessel length or height.',
      levels: [
        {levelId: 'identification', label: 'Identification', thresholdLabel: '≥ 12.8 px', minPx: 12.8},
        {levelId: 'recognition', label: 'Recognition', thresholdLabel: '8 ≤ px < 12.8', minPx: 8},
        {levelId: 'detection', label: 'Detection', thresholdLabel: '2 ≤ px < 8', minPx: 2},
        {levelId: 'belowDetection', label: 'Below detection threshold', thresholdLabel: '0 ≤ px < 2', minPx: 0}
      ]
    }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getCriteriaProfile(profileId) {
    const id = profileId === undefined ? DEFAULT_PROFILE_ID : profileId;
    const profile = PROFILES[id];
    return profile ? clone({...profile, levelOrder: profile.levels.map(level => level.levelId)}) : null;
  }

  function invalidResult(profileId, px, reason) {
    return {valid: false, profileId, levelId: null, px, meetsThreshold: false, reason};
  }

  function evaluateCoverage(px, options = {}) {
    const profileId = options.profileId === undefined ? DEFAULT_PROFILE_ID : options.profileId;
    const profile = PROFILES[profileId];
    if (!profile) return invalidResult(profileId, null, 'unknown-profile');
    if (typeof px !== 'number' || !Number.isFinite(px) || px < 0) return invalidResult(profileId, null, 'invalid-pixels');
    const level = profile.levels.find(item => px >= item.minPx);
    if (!level) return invalidResult(profileId, px, 'unclassified-pixels');

    const hasMinimumLevel = Object.prototype.hasOwnProperty.call(options, 'minimumLevel') && options.minimumLevel !== undefined;
    if (!hasMinimumLevel) return {valid: true, profileId, levelId: level.levelId, px, meetsThreshold: null, reason: null};
    const minimum = profile.levels.find(item => item.levelId === options.minimumLevel);
    if (!minimum) return invalidResult(profileId, px, 'unknown-minimum-level');
    return {valid: true, profileId, levelId: level.levelId, px, meetsThreshold: px >= minimum.minPx, reason: null};
  }

  return {DEFAULT_PROFILE_ID, getCriteriaProfile, evaluateCoverage};
}));
