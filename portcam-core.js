/*
 * Pure calculation and schema helpers for port-cam-plan.
 *
 * This file intentionally has no DOM, Leaflet, fetch, or browser-only
 * dependencies.  The browser adapter in index.html converts form values and
 * Leaflet LatLng objects to these plain data structures.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EARTH_RADIUS_M = 6371000;
  const HARD_MAXIMUM_RAY_DISTANCE_M = 30000;
  const TILE_PADDING = 1;
  const WEB_MERCATOR_MAX_LAT = 85.0511287798;
  const CAMERA_SCENE_SCHEMA = 'camera-scene/1.1';
  const CAMERA_PROJECT_SCHEMA = 'camera-project/1.0';
  const CALCULATOR_MODEL_VERSION = 'spherical-v1';

  function d2r(degrees) { return degrees * Math.PI / 180; }
  function r2d(radians) { return radians * 180 / Math.PI; }
  function finite(value, name) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
    return value;
  }
  function positive(value, name) {
    finite(value, name);
    if (!(value > 0)) throw new Error(`${name} must be positive`);
    return value;
  }
  function normalizeHeading(degrees) {
    return ((degrees % 360) + 360) % 360;
  }
  function angleDifference(first, second) {
    return Math.abs(((first - second + 540) % 360) - 180);
  }
  function angleDiff(first, second) { return angleDifference(first, second); }

  function readPosition(value) {
    const position = value && value.position ? value.position : value;
    if (!position) throw new Error('position is required');
    const latitudeDeg = Number(position.latitudeDeg ?? position.lat ?? position.latitude);
    const longitudeDeg = Number(position.longitudeDeg ?? position.lng ?? position.lon ?? position.longitude);
    finite(latitudeDeg, 'latitudeDeg');
    finite(longitudeDeg, 'longitudeDeg');
    if (latitudeDeg < -90 || latitudeDeg > 90) throw new Error('latitudeDeg out of range');
    if (longitudeDeg < -180 || longitudeDeg > 180) throw new Error('longitudeDeg out of range');
    return { latitudeDeg, longitudeDeg };
  }

  function readCameraHeight(camera) {
    return positive(Number(
      camera.heightM ??
      (camera.position && camera.position.heightM) ??
      camera.height ??
      camera.altitudeM
    ), 'camera heightM');
  }

  function readTilt(camera) {
    return finite(Number(
      camera.tiltDownDeg ??
      (camera.orientation && camera.orientation.tiltDownDeg) ??
      camera.tilt ?? 0
    ), 'tiltDownDeg');
  }

  function readHeading(camera) {
    return finite(Number(
      camera.headingDeg ??
      (camera.orientation && camera.orientation.headingDeg) ??
      camera.heading ?? 0
    ), 'headingDeg');
  }

  function readOpticsInput(camera) {
    const optics = camera.optics || camera;
    return {
      sensorWidthMm: positive(Number(optics.sensorWidthMm ?? optics.sensorW), 'sensorWidthMm'),
      sensorHeightMm: positive(Number(optics.sensorHeightMm ?? optics.sensorH), 'sensorHeightMm'),
      widthPx: positive(Number(optics.widthPx ?? optics.resolutionWidthPx ?? camera.resW ?? camera.imageWidthPx), 'widthPx'),
      heightPx: positive(Number(optics.heightPx ?? optics.resolutionHeightPx ?? camera.resH ?? camera.imageHeightPx), 'heightPx'),
      focalLengthMm: positive(Number(optics.focalLengthMm ?? optics.focalMm ?? camera.focalLengthMm ?? camera.focal), 'focalLengthMm')
    };
  }

  function computeOptics(camera) {
    const input = readOpticsInput(camera);
    const pixelPitchMm = input.sensorWidthMm / input.widthPx;
    const horizontalFovDeg = 2 * r2d(Math.atan(input.sensorWidthMm / (2 * input.focalLengthMm)));
    const verticalFovDeg = 2 * r2d(Math.atan(input.sensorHeightMm / (2 * input.focalLengthMm)));
    return {
      sensorWidthMm: input.sensorWidthMm,
      sensorHeightMm: input.sensorHeightMm,
      widthPx: input.widthPx,
      heightPx: input.heightPx,
      focalLengthMm: input.focalLengthMm,
      pixelPitchMm,
      pitchMm: pixelPitchMm,
      horizontalFovDeg,
      verticalFovDeg,
      hfov: horizontalFovDeg,
      vfov: verticalFovDeg,
      distortionModel: 'none'
    };
  }

  function computePlanningHorizon(cameraHeightM, planningTargetHeightM) {
    const cameraHeight = positive(Number(cameraHeightM), 'cameraHeightM');
    const targetHeight = positive(Number(planningTargetHeightM), 'planningTargetHeightM');
    const distanceKm = 3.57 * (Math.sqrt(cameraHeight) + Math.sqrt(targetHeight));
    return { distanceKm, distanceM: distanceKm * 1000 };
  }

  function computeGroundEnvelope(camera, optics, limits) {
    const heightM = readCameraHeight(camera);
    const tiltDownDeg = readTilt(camera);
    const verticalFovDeg = Number(optics.verticalFovDeg ?? optics.vfov);
    positive(verticalFovDeg, 'verticalFovDeg');
    const horizonDistanceM = positive(Number(limits.horizonDistanceM ?? limits.horizonM), 'horizonDistanceM');
    const hardMaximumRayDistanceM = Number(limits.hardMaximumRayDistanceM ?? HARD_MAXIMUM_RAY_DISTANCE_M);
    positive(hardMaximumRayDistanceM, 'hardMaximumRayDistanceM');
    const maximumRayDistanceM = Math.min(horizonDistanceM, hardMaximumRayDistanceM);
    const nearAngleDeg = tiltDownDeg + verticalFovDeg / 2;
    const farAngleDeg = tiltDownDeg - verticalFovDeg / 2;
    const nearDistanceM = nearAngleDeg > 0 ? heightM / Math.tan(d2r(nearAngleDeg)) : null;
    const farDistanceM = farAngleDeg > 0 ? heightM / Math.tan(d2r(farAngleDeg)) : null;
    const nearM = nearDistanceM === null ? 0 : Math.max(0, nearDistanceM);
    const farM = Math.min(maximumRayDistanceM, farDistanceM === null ? maximumRayDistanceM : farDistanceM);
    let footprintStatus = 'finite';
    if (!(maximumRayDistanceM > 0) || nearAngleDeg <= 0 || !(farM > nearM)) {
      footprintStatus = 'no-ground-intersection';
    } else if (farAngleDeg <= 0 || farDistanceM > horizonDistanceM) {
      footprintStatus = 'horizon-clipped';
    }
    return {
      nearAngleDeg,
      farAngleDeg,
      nearDistanceM,
      farDistanceM,
      envelopeNearDistanceM: footprintStatus === 'no-ground-intersection' ? null : nearM,
      envelopeFarDistanceM: footprintStatus === 'no-ground-intersection' ? null : farM,
      horizonDistanceM,
      maximumRayDistanceM,
      hardMaximumRayDistanceM,
      footprintStatus
    };
  }

  function destinationPoint(origin, bearingDeg, distanceM) {
    const position = readPosition(origin);
    const bearing = d2r(bearingDeg);
    const angularDistance = Number(distanceM) / EARTH_RADIUS_M;
    finite(angularDistance, 'distanceM');
    const lat1 = d2r(position.latitudeDeg);
    const lon1 = d2r(position.longitudeDeg);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );
    return { lat: r2d(lat2), lng: r2d(lon2) };
  }

  function bearingBetween(first, second) {
    const a = readPosition(first);
    const b = readPosition(second);
    const lat1 = d2r(a.latitudeDeg);
    const lat2 = d2r(b.latitudeDeg);
    const dLon = d2r(b.longitudeDeg - a.longitudeDeg);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return normalizeHeading(r2d(Math.atan2(y, x)));
  }

  function distanceBetween(first, second) {
    const a = readPosition(first);
    const b = readPosition(second);
    const lat1 = d2r(a.latitudeDeg);
    const lat2 = d2r(b.latitudeDeg);
    const dLat = lat2 - lat1;
    const dLon = d2r(b.longitudeDeg - a.longitudeDeg);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  function rangeForPixels(targetM, focalMm, pixelPitchMm, pixels) {
    return (Number(targetM) * Number(focalMm)) / (Number(pixels) * Number(pixelPitchMm));
  }

  function targetDimensions(target) {
    const geometry = target.geometry || target;
    return {
      lengthM: positive(Number(geometry.lengthM ?? geometry.length ?? target.lengthM), 'target.lengthM'),
      widthM: positive(Number(geometry.widthM ?? geometry.width ?? target.widthM), 'target.widthM'),
      heightM: positive(Number(geometry.heightM ?? geometry.height ?? target.heightM), 'target.heightM'),
      headingDeg: finite(Number(target.headingDeg ?? target.heading ?? geometry.headingDeg ?? 0), 'target.headingDeg'),
      anchor: geometry.anchor || target.anchor || 'bottom-center'
    };
  }

  function computeObservation(camera, target, opticsInput) {
    const cameraPosition = readPosition(camera);
    const targetPosition = readPosition(target);
    const optics = opticsInput && opticsInput.pixelPitchMm ? opticsInput : computeOptics(camera);
    const dimensions = targetDimensions(target);
    const distanceM = Math.max(1e-9, distanceBetween(cameraPosition, targetPosition));
    const azimuthDeg = bearingBetween(cameraPosition, targetPosition);
    const headingDeg = normalizeHeading(readHeading(camera));
    const tiltDownDeg = readTilt(camera);
    const horizontalRelativeAngleDeg = ((azimuthDeg - headingDeg + 540) % 360) - 180;
    const targetElevationM = Number(target.elevationM ?? target.position?.elevationM ?? target.position?.altitudeM ?? 0);
    const cameraHeightM = readCameraHeight(camera);
    const targetCenterHeightM = targetElevationM + dimensions.heightM / 2;
    const downAngleDeg = r2d(Math.atan2(cameraHeightM - targetCenterHeightM, distanceM));
    const verticalRelativeAngleDeg = downAngleDeg - tiltDownDeg;
    const inHFOV = Math.abs(horizontalRelativeAngleDeg) <= optics.horizontalFovDeg / 2;
    const inVFOV = Math.abs(verticalRelativeAngleDeg) <= optics.verticalFovDeg / 2;
    const visibilityState = inHFOV && inVFOV
      ? 'visible'
      : !inHFOV && !inVFOV ? 'outside-fov'
        : !inHFOV ? 'outside-hfov' : 'outside-vfov';
    const pixelWidth = (dimensions.lengthM * optics.focalLengthMm) / (distanceM * optics.pixelPitchMm);
    const pixelHeight = (dimensions.heightM * optics.focalLengthMm) / (distanceM * optics.pixelPitchMm);
    const shortSidePx = (Math.min(dimensions.lengthM, dimensions.widthM) * optics.focalLengthMm) /
      (distanceM * optics.pixelPitchMm);
    const coveragePixels = {
      length: (dimensions.lengthM * optics.focalLengthMm) / (distanceM * optics.pixelPitchMm),
      width: (dimensions.widthM * optics.focalLengthMm) / (distanceM * optics.pixelPitchMm),
      height: (dimensions.heightM * optics.focalLengthMm) / (distanceM * optics.pixelPitchMm)
    };
    return {
      cameraId: camera.id ?? null,
      targetId: target.id ?? null,
      distanceM,
      azimuthDeg,
      headingDeg,
      horizontalRelativeAngleDeg,
      downAngleDeg,
      verticalRelativeAngleDeg,
      inHFOV,
      inVFOV,
      visibilityState,
      pixelWidth,
      pixelHeight,
      estimatedPixelWidth: pixelWidth,
      estimatedPixelHeight: pixelHeight,
      coveragePixels,
      yolo: {
        shortSidePx,
        p3Cells: shortSidePx / 8,
        p4Cells: shortSidePx / 16,
        p5Cells: shortSidePx / 32
      },
      targetDimensions: dimensions,
      calculatorModelVersion: CALCULATOR_MODEL_VERSION
    };
  }

  function makeSector(center, headingDeg, halfAngleDeg, innerDistanceM, outerDistanceM, steps = 48) {
    const points = [];
    const start = headingDeg - halfAngleDeg;
    const end = headingDeg + halfAngleDeg;
    if (innerDistanceM <= 0) {
      points.push({ lat: center.lat, lng: center.lng });
      for (let index = 0; index <= steps; index++) {
        points.push(destinationPoint(center, start + (end - start) * index / steps, outerDistanceM));
      }
      return points;
    }
    for (let index = 0; index <= steps; index++) {
      points.push(destinationPoint(center, start + (end - start) * index / steps, outerDistanceM));
    }
    for (let index = steps; index >= 0; index--) {
      points.push(destinationPoint(center, start + (end - start) * index / steps, innerDistanceM));
    }
    return points;
  }

  function longitudeToTileX(longitude, zoom) {
    const n = 2 ** zoom;
    const wrapped = ((longitude + 180) % 360 + 360) % 360;
    return Math.min(n - 1, Math.max(0, Math.floor(wrapped / 360 * n)));
  }
  function latitudeToTileY(latitude, zoom) {
    const n = 2 ** zoom;
    const lat = Math.max(-WEB_MERCATOR_MAX_LAT, Math.min(WEB_MERCATOR_MAX_LAT, latitude));
    const radians = d2r(lat);
    const normalized = (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
    return Math.min(n - 1, Math.max(0, Math.floor(normalized * n)));
  }
  function tileXToLongitude(x, zoom) { return x / (2 ** zoom) * 360 - 180; }
  function tileYToLatitude(y, zoom) { return r2d(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (2 ** zoom))))); }
  function expandTileUrl(template, z, x, y) {
    return String(template).replaceAll('{z}', String(z)).replaceAll('{x}', String(x)).replaceAll('{y}', String(y));
  }
  function tileBounds(z, x, y) {
    return {
      west: tileXToLongitude(x, z),
      south: tileYToLatitude(y + 1, z),
      east: tileXToLongitude(x + 1, z),
      north: tileYToLatitude(y, z)
    };
  }
  function buildTileManifest(ring, source, zoom, padding = TILE_PADDING) {
    const points = ring.slice(0, -1);
    if (!points.length) return [];
    const projected = points.map(point => ({x: longitudeToTileX(point[0], zoom), y: latitudeToTileY(point[1], zoom)}));
    const n = 2 ** zoom;
    const minX = Math.max(0, Math.min(...projected.map(point => point.x)) - padding);
    const maxX = Math.min(n - 1, Math.max(...projected.map(point => point.x)) + padding);
    const minY = Math.max(0, Math.min(...projected.map(point => point.y)) - padding);
    const maxY = Math.min(n - 1, Math.max(...projected.map(point => point.y)) + padding);
    const tiles = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        tiles.push({
          z: zoom, x, y,
          url: expandTileUrl(source.urlTemplate, zoom, x, y),
          bounds: tileBounds(zoom, x, y)
        });
      }
    }
    return tiles;
  }

  function normalizeTileSource(source) {
    if (!source || typeof source !== 'object') throw new Error('tileSource is required');
    if (!source.id || !source.urlTemplate) throw new Error('tileSource.id and tileSource.urlTemplate are required');
    return {...source};
  }

  function buildCameraScene(camera, projectSettings, tileSource) {
    const settings = projectSettings || {};
    const source = normalizeTileSource(tileSource || settings.tileSource);
    const position = readPosition(camera);
    const cameraHeightM = readCameraHeight(camera);
    const planningTargetHeightM = positive(Number(
      settings.planningTargetHeightM ?? settings.targetHeightM ?? camera.planningTargetHeightM ?? camera.targetHeightM ?? 2
    ), 'planningTargetHeightM');
    const optics = computeOptics(camera);
    const headingDeg = normalizeHeading(readHeading(camera));
    const tiltDownDeg = readTilt(camera);
    const horizon = computePlanningHorizon(cameraHeightM, planningTargetHeightM);
    const zoom = Number(settings.tileZoom ?? settings.zoom ?? 18);
    if (!Number.isInteger(zoom) || zoom < Number(source.minZoom ?? 0) || zoom > Number(source.maxZoom ?? 22)) {
      throw new Error(`tile zoom must be between ${source.minZoom ?? 0} and ${source.maxZoom ?? 22}`);
    }
    const envelope = computeGroundEnvelope(
      {...camera, heightM: cameraHeightM, tiltDownDeg},
      optics,
      {horizonDistanceM: horizon.distanceM, hardMaximumRayDistanceM: HARD_MAXIMUM_RAY_DISTANCE_M}
    );
    const base = {
      schemaVersion: CAMERA_SCENE_SCHEMA,
      exportedAt: settings.exportedAt || new Date().toISOString(),
      application: settings.application || {name: 'port-cam-plan', version: '0.7.2', exportType: 'camera-scene'},
      camera: {
        position: {
          latitudeDeg: position.latitudeDeg,
          longitudeDeg: position.longitudeDeg,
          heightM: cameraHeightM,
          heightReference: 'intersection-plane',
          intersectionPlaneElevationM: Number(camera.intersectionPlaneElevationM ?? settings.intersectionPlaneElevationM ?? 0),
          verticalDatum: 'local-planning-datum'
        },
        orientation: {headingDeg, tiltDownDeg, rollDeg: 0}
      },
      image: {
        widthPx: optics.widthPx,
        heightPx: optics.heightPx,
        principalPointPx: {x: optics.widthPx / 2, y: optics.heightPx / 2},
        pixelCenterConvention: 'half-pixel'
      },
      optics: {
        sensorWidthMm: optics.sensorWidthMm,
        sensorHeightMm: optics.sensorHeightMm,
        focalLengthMm: optics.focalLengthMm,
        pixelPitchMm: optics.pixelPitchMm,
        horizontalFovDeg: optics.horizontalFovDeg,
        verticalFovDeg: optics.verticalFovDeg,
        distortionModel: 'none'
      },
      coordinateSystem: {
        horizontalCrs: 'EPSG:4326', earthModel: 'WGS84', imageOrigin: 'top-left',
        headingConvention: 'clockwise-from-true-north',
        tiltConvention: 'positive-down-from-horizontal',
        cameraFrame: {right: '+X', down: '+Y', forward: '+Z'}
      },
      intersectionSurface: {
        type: 'horizontal-plane', elevationM: baseElevation(camera, settings),
        elevationReference: 'local-planning-datum'
      },
      tileSource: source,
      tileSelection: {
        method: 'conservative-fov-envelope',
        zoom,
        paddingTiles: Number(settings.tilePadding ?? TILE_PADDING),
        maximumRayDistanceM: envelope.maximumRayDistanceM,
        hardMaximumRayDistanceM: HARD_MAXIMUM_RAY_DISTANCE_M,
        footprintStatus: envelope.footprintStatus,
        footprint: null,
        tiles: []
      },
      derivedPlanningValues: {
        horizonDistanceM: horizon.distanceM,
        vfovNearDistanceM: envelope.nearDistanceM,
        vfovFarDistanceM: envelope.farDistanceM,
        envelopeNearDistanceM: envelope.envelopeNearDistanceM,
        envelopeFarDistanceM: envelope.envelopeFarDistanceM,
        horizontalEnvelopeHalfAngleDeg: optics.horizontalFovDeg / 2,
        targetHeightM: planningTargetHeightM
      },
      assumptions: [
        'The intersection surface is a horizontal plane at local planning datum elevation 0 m.',
        'Camera height is relative to the intersection plane and is not true altitude.',
        'The footprint is a conservative near/far FOV envelope, not per-pixel ray-casting truth.',
        'The envelope is limited by the lesser of the existing horizon-distance model and 30 km.',
        'Rays above the horizon are clipped at the horizon distance.',
        'Roll is fixed at 0 degrees; lens distortion is not modeled; the principal point is the image center; pixel centers use pixel + 0.5.',
        'The tile manifest includes one tile of padding and is a conservative download range, not a geometric ground-truth result.'
      ]
    };
    if (envelope.footprintStatus !== 'no-ground-intersection') {
      const center = {lat: position.latitudeDeg, lng: position.longitudeDeg};
      const footprintSteps = Number(settings.footprintSteps ?? 48);
      const points = makeSector(center, headingDeg, optics.horizontalFovDeg / 2,
        envelope.envelopeNearDistanceM, envelope.envelopeFarDistanceM, footprintSteps);
      const ring = points.map(point => [point.lng, point.lat]);
      if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([...ring[0]]);
      base.tileSelection.footprint = {type: 'Polygon', coordinates: [ring]};
      base.tileSelection.tiles = buildTileManifest(ring, source, zoom, base.tileSelection.paddingTiles);
    }
    if (envelope.footprintStatus === 'no-ground-intersection') {
      base.assumptions = [
        'The intersection surface is a horizontal plane at local planning datum elevation 0 m.',
        'Camera height is relative to the intersection plane and is not true altitude.',
        'The vertical FOV has no valid ground intersection for the current tilt and height.',
        'Roll is fixed at 0 degrees; lens distortion is not modeled; the principal point is the image center.'
      ];
    }
    return base;
  }

  function baseElevation(camera, settings) {
    return Number(camera.intersectionPlaneElevationM ?? settings.intersectionPlaneElevationM ?? 0);
  }

  function buildCameraProject(project) {
    const value = project || {};
    const cameras = Array.isArray(value.cameras) ? value.cameras : [];
    const targets = Array.isArray(value.targets) ? value.targets : [];
    return {
      schemaVersion: CAMERA_PROJECT_SCHEMA,
      projectId: value.projectId ?? null,
      name: value.name ?? 'Untitled project',
      settings: {...(value.settings || {})},
      cameras: cameras.map(camera => ({...camera})),
      targets: targets.map(target => ({...target})),
      ...(value.map ? {map: {...value.map}} : {})
    };
  }

  function getObservationCacheKey(cameraId, targetId) {
    return `${cameraId}:${targetId}`;
  }

  function buildObservationCacheEntry(camera, target, observation, generatedAt = new Date().toISOString()) {
    return {
      key: getObservationCacheKey(camera.id, target.id),
      cameraId: camera.id,
      targetId: target.id,
      cameraRevision: Number(camera.revision ?? 0),
      targetRevision: Number(target.revision ?? 0),
      calculatorModelVersion: CALCULATOR_MODEL_VERSION,
      generatedAt,
      calculationState: 'current',
      visibilityState: observation.visibilityState,
      ...observation
    };
  }

  function previewCameraPatch(camera, patch) {
    return {...camera, ...patch, revision: Number(camera.revision ?? 0), dirty: false, preview: true};
  }

  function commitCameraPatch(camera, patch) {
    const before = {...camera};
    const after = {...camera, ...patch, revision: Number(camera.revision ?? 0) + 1, dirty: true, preview: false};
    return {camera: after, transaction: {type: 'camera-patch', before, after}};
  }

  return {
    EARTH_RADIUS_M,
    HARD_MAXIMUM_RAY_DISTANCE_M,
    TILE_PADDING,
    CAMERA_SCENE_SCHEMA,
    CAMERA_PROJECT_SCHEMA,
    CALCULATOR_MODEL_VERSION,
    d2r,
    r2d,
    normalizeHeading,
    angleDifference,
    angleDiff,
    computeOptics,
    computePlanningHorizon,
    computeGroundEnvelope,
    computeObservation,
    bearingBetween,
    distanceBetween,
    destinationPoint,
    rangeForPixels,
    buildCameraScene,
    buildCameraProject,
    buildTileManifest,
    longitudeToTileX,
    latitudeToTileY,
    tileXToLongitude,
    tileYToLatitude,
    getObservationCacheKey,
    buildObservationCacheEntry,
    previewCameraPatch,
    commitCameraPatch
  };
}));
