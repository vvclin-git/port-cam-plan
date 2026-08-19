/* Pure, non-persistent Camera Comparison derivation for port-cam-plan. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamComparison = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const OUTSIDE_STATES = new Set(['outside-hfov', 'outside-vfov', 'outside-fov']);

  function finiteNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function positioned(entity) {
    const position = entity?.position;
    return position && finiteNumber(position.latitudeDeg) !== null && finiteNumber(position.longitudeDeg) !== null;
  }

  function statusFor(observation, camera, target) {
    if (observation?.calculationState === 'failed') {
      return {key: 'failed', label: 'Failed', className: 'error', rankable: false, group: null};
    }
    if (!camera || !target || !observation) return {key: 'unavailable', label: 'Unavailable', className: 'neutral', rankable: false, group: null};
    if (observation.visibilityState === 'unavailable' || observation.calculationState !== 'current') {
      return {key: 'unavailable', label: 'Unavailable', className: 'neutral', rankable: false, group: null};
    }
    if (observation.visibilityState === 'visible') {
      return {key: 'visible', label: 'Visible', className: 'ready', rankable: true, group: 0};
    }
    if (OUTSIDE_STATES.has(observation.visibilityState)) {
      const label = observation.visibilityState === 'outside-hfov'
        ? 'Outside HFOV'
        : observation.visibilityState === 'outside-vfov'
          ? 'Outside VFOV'
          : 'Outside FOV';
      return {key: observation.visibilityState, label, className: 'draft', rankable: true, group: 1};
    }
    return {key: 'unavailable', label: 'Unavailable', className: 'neutral', rankable: false, group: null};
  }

  function unavailableObservation(camera, target, reason = 'draft-unplaced') {
    return {
      cameraId: camera?.id ?? null,
      targetId: target?.id ?? null,
      calculationState: 'idle',
      visibilityState: 'unavailable',
      reason
    };
  }

  function failedObservation(camera, target, error) {
    return {
      cameraId: camera?.id ?? null,
      targetId: target?.id ?? null,
      calculationState: 'failed',
      visibilityState: 'unknown',
      error: error?.message || String(error || 'Unknown calculation error')
    };
  }

  function cameraEntries(cameraOrder, camerasById) {
    const table = Array.isArray(camerasById)
      ? Object.fromEntries(camerasById.filter(Boolean).map(camera => [camera.id, camera]))
      : (camerasById || {});
    const orderedIds = Array.isArray(cameraOrder) ? cameraOrder : [];
    const seen = new Set();
    const entries = [];
    orderedIds.forEach(id => {
      if (seen.has(id) || !table[id]) return;
      seen.add(id);
      entries.push({id, camera: table[id], orderIndex: entries.length});
    });
    Object.keys(table).forEach(id => {
      if (seen.has(id)) return;
      seen.add(id);
      entries.push({id, camera: table[id], orderIndex: entries.length});
    });
    return entries;
  }

  function buildCameraComparison(options = {}) {
    const currentTarget = options.currentTarget || null;
    const entries = cameraEntries(options.cameraOrder, options.camerasById || options.cameras);
    const disabledCount = entries.filter(entry => entry.camera.enabled === false).length;
    const enabledEntries = entries.filter(entry => entry.camera.enabled !== false);
    const getObservation = typeof options.getObservation === 'function' ? options.getObservation : null;

    const rows = enabledEntries.map(entry => {
      const camera = entry.camera;
      let observation = null;
      if (currentTarget) {
        if (!positioned(camera) || !positioned(currentTarget) || camera.lifecycle === 'draft-unplaced' || currentTarget.lifecycle === 'draft-unplaced') {
          observation = unavailableObservation(camera, currentTarget);
        } else if (getObservation) {
          try {
            observation = getObservation(camera.id, currentTarget.id);
          } catch (error) {
            observation = failedObservation(camera, currentTarget, error);
          }
        }
      }
      const status = currentTarget ? statusFor(observation, camera, currentTarget) : statusFor(null, camera, currentTarget);
      return {
        cameraId: camera.id,
        camera,
        observation,
        status,
        rank: null,
        orderIndex: entry.orderIndex,
        active: camera.id === options.activeCameraId
      };
    });

    const ranked = rows.filter(row => row.status.rankable);
    ranked.sort((left, right) => {
      const groupDifference = left.status.group - right.status.group;
      if (groupDifference) return groupDifference;
      const leftShortSide = finiteNumber(left.observation?.yolo?.shortSidePx);
      const rightShortSide = finiteNumber(right.observation?.yolo?.shortSidePx);
      const shortSideDifference = (rightShortSide ?? Number.NEGATIVE_INFINITY) - (leftShortSide ?? Number.NEGATIVE_INFINITY);
      if (shortSideDifference) return shortSideDifference;
      const distanceDifference = (finiteNumber(left.observation?.distanceM) ?? Number.POSITIVE_INFINITY) - (finiteNumber(right.observation?.distanceM) ?? Number.POSITIVE_INFINITY);
      if (distanceDifference) return distanceDifference;
      return left.orderIndex - right.orderIndex;
    });
    ranked.forEach((row, index) => { row.rank = index + 1; });

    return {
      currentTargetId: currentTarget?.id ?? null,
      enabledCount: enabledEntries.length,
      disabledCount,
      rows: ranked.concat(rows.filter(row => !row.status.rankable))
    };
  }

  return {buildCameraComparison, statusFor};
}));
