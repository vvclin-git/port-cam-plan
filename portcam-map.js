/* Leaflet projection for normalized PortCam project state. */
(function (root, factory) {
  const api = factory(root.PortCamCore || (typeof require === 'function' ? require('./portcam-core.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamMap = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  if (!Core) throw new Error('PortCamMap requires PortCamCore');

  const clone = value => JSON.parse(JSON.stringify(value));
  const point = (L, position) => L.latLng(position.latitudeDeg, position.longitudeDeg);
  const positionFromLatLng = latlng => ({latitudeDeg: Number(latlng.lat), longitudeDeg: Number(latlng.lng)});
  const CAMERA_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#c2410c', '#15803d', '#be123c', '#a16207'];
  const PANE_NAMES = {analysis: 'portcam-analysis-pane', camera: 'portcam-camera-marker-pane', target: 'portcam-target-marker-pane', label: 'portcam-entity-label-pane'};
  const PANE_Z = {analysis: 400, camera: 650, target: 700, label: 750};

  function createEntityMarkerInteraction({kind, marker, store}) {
    if (!marker || !store || !['camera', 'target'].includes(kind)) throw new Error('createEntityMarkerInteraction requires camera or target marker and store');
    let dragId = null;
    let canonicalPosition = null;
    const getEntity = id => kind === 'camera' ? store.getCamera(id, false) : store.getTarget(id, false);
    const canDrag = id => {
      const state = store.getState();
      const entity = getEntity(id);
      return Boolean(entity && state.uiState?.interactionMode === 'navigate' && state.uiState?.[kind === 'camera' ? 'selectedCameraId' : 'selectedTargetId'] === id && entity.visible !== false && entity.locked !== true && entity.position);
    };
    const onDragStart = () => {
      const id = marker.__portcamEntityId;
      if (!canDrag(id)) { dragId = null; canonicalPosition = null; return; }
      dragId = id;
      canonicalPosition = clone(getEntity(id).position);
    };
    const onDrag = event => {
      if (!dragId || !canDrag(dragId)) return;
      const latlng = event?.target?.getLatLng?.() || marker.getLatLng?.();
      if (!latlng) return;
      store.beginPreview(kind, dragId, {position: positionFromLatLng(latlng)});
    };
    const onDragEnd = () => {
      if (!dragId) return;
      const id = dragId;
      dragId = null;
      canonicalPosition = null;
      if (store.getState().preview?.kind === kind && store.getState().preview.id === id) store.commitPreview(`${kind}-drag`);
      else store.cancelPreview();
    };
    marker.on('dragstart', onDragStart);
    marker.on('drag', onDrag);
    marker.on('dragend', onDragEnd);
    return {
      canDrag,
      getCanonicalPosition() { return clone(canonicalPosition); },
      destroy() { marker.off?.('dragstart', onDragStart); marker.off?.('drag', onDrag); marker.off?.('dragend', onDragEnd); }
    };
  }

  function createMapController({map, leaflet: L, store, onCameraDrag, onMapClick, onTargetSelect, labelVisibility}) {
    if (!map || !L || !store) throw new Error('createMapController requires map, Leaflet and store');
    const cameraLayers = new Map(), targetLayers = new Map();
    const labels = {camera: labelVisibility?.camera !== false, target: labelVisibility?.target !== false};
    let destroyed = false;
    let wheelContainer = null;
    let lastWheelDirection = 0;
    let lastWheelAt = -Infinity;

    function ensurePanes() {
      if (!map.createPane) return;
      Object.entries(PANE_NAMES).forEach(([key, name]) => {
        const pane = map.getPane?.(name) || map.createPane(name);
        if (pane) pane.style.zIndex = String(PANE_Z[key]);
      });
    }
    function layerGroup() { return L.layerGroup().addTo(map); }
    function remove(group) { if (group) map.removeLayer(group); }
    function removeLayer(record, key) { if (record[key]) { record.group.removeLayer(record[key]); record[key] = null; } }
    function clear(record, key) { (record[key] || []).forEach(layer => record.group.removeLayer(layer)); record[key] = []; }
    function setLabel(record, kind, visible) {
      record.labelVisible = visible;
      if (visible) record.marker.openTooltip?.();
      else record.marker.closeTooltip?.();
    }
    function sector(center, heading, halfAngle, innerM, outerM) {
      const pts = [], steps = 24, start = heading - halfAngle, end = heading + halfAngle;
      if (innerM <= 0) pts.push(center);
      for (let i = 0; i <= steps; i++) pts.push(L.latLng(Core.destinationPoint(center, start + (end - start) * i / steps, outerM)));
      if (innerM > 0) for (let i = steps; i >= 0; i--) pts.push(L.latLng(Core.destinationPoint(center, start + (end - start) * i / steps, innerM)));
      return pts;
    }
    function entityTooltip() { return {permanent: true, direction: 'top', className: 'entity-label', pane: PANE_NAMES.label, interactive: false, offset: [0, -9]}; }
    function ensureCamera(camera) {
      if (cameraLayers.has(camera.id)) return cameraLayers.get(camera.id);
      const group = layerGroup();
      const marker = L.marker(point(L, camera.position), {draggable: false, pane: PANE_NAMES.camera, bubblingMouseEvents: false}).bindTooltip(camera.name || camera.id, entityTooltip());
      marker.__portcamEntityId = camera.id;
      marker.on('click', event => { event?.originalEvent?.stopPropagation?.(); store.selectCamera(camera.id); });
      const record = {group, marker, envelope: [], bands: [], centerline: null, interaction: null, labelVisible: labels.camera};
      record.interaction = createEntityMarkerInteraction({kind: 'camera', marker, store});
      marker.addTo(group); setLabel(record, 'camera', labels.camera); cameraLayers.set(camera.id, record);
      return record;
    }
    function syncCamera(camera, state) {
      let record = cameraLayers.get(camera.id);
      const selected = state.uiState.selectedCameraId === camera.id;
      const visible = camera.visible !== false && camera.lifecycle !== 'draft-unplaced' && camera.position;
      if (!visible) { if (record) { clear(record, 'envelope'); clear(record, 'bands'); removeLayer(record, 'centerline'); remove(record.group); } return; }
      record = record || ensureCamera(camera);
      if (!map.hasLayer || !map.hasLayer(record.group)) record.group.addTo(map);
      const center = point(L, camera.position), color = camera.color || CAMERA_COLORS[Math.max(0, state.cameraOrder.indexOf(camera.id)) % CAMERA_COLORS.length];
      record.marker.setLatLng(center); record.marker.setTooltipContent?.(camera.name || camera.id); record.marker.setOpacity(camera.enabled === false ? .42 : 1); setLabel(record, 'camera', labels.camera);
      const canDrag = selected && camera.visible !== false && camera.locked !== true && state.uiState.interactionMode === 'navigate';
      record.marker.options.draggable = canDrag;
      if (record.marker.dragging) canDrag ? record.marker.dragging.enable() : record.marker.dragging.disable();
      clear(record, 'envelope'); clear(record, 'bands'); removeLayer(record, 'centerline');
      let optics, horizon, envelope;
      try { optics = Core.computeOptics(camera); horizon = Core.computePlanningHorizon(camera.heightM, state.settings.planningTargetHeightM); envelope = Core.computeGroundEnvelope(camera, optics, {horizonDistanceM: horizon.distanceM}); } catch (_) { return; }
      const near = Math.max(0, envelope.nearDistanceM || 0), far = Math.min(envelope.farDistanceM || horizon.distanceM, horizon.distanceM, 30000);
      if (far <= near) return;
      const geometryOptions = {pane: PANE_NAMES.analysis, interactive: false};
      const poly = L.polygon(sector(center, camera.headingDeg, optics.horizontalFovDeg / 2, near, far), {color, weight:selected ? 3 : 1.2, opacity:selected ? .95 : .42, fillColor:color, fillOpacity:selected ? .1 : .035, dashArray:camera.enabled === false ? '5,5' : null, ...geometryOptions}).addTo(record.group);
      record.envelope.push(poly);
      record.centerline = L.polyline([center, L.latLng(Core.destinationPoint(center, camera.headingDeg, far))], {color, weight:selected ? 1.4 : .8, opacity:selected ? .85 : .35, dashArray:'5,5', ...geometryOptions}).addTo(record.group);
      if (selected && camera.enabled !== false) {
        const targetM = state.settings.planningTargetHeightM || 2, pitch = optics.pixelPitchMm;
        [[0,32,'#1f9d55'],[32,16,'#d99a00'],[16,8,'#e56b00']].forEach(([a,b,bandColor]) => {
          const inner = a ? Core.rangeForPixels(targetM, camera.focalLengthMm, pitch, a) : 0, outer = Math.min(Core.rangeForPixels(targetM, camera.focalLengthMm, pitch, b), far);
          if (outer > inner) record.bands.push(L.polygon(sector(center, camera.headingDeg, optics.horizontalFovDeg / 2, Math.max(inner, near), outer), {color:bandColor, weight:1, fillColor:bandColor, fillOpacity:.16, ...geometryOptions}).addTo(record.group));
        });
      }
      if (selected && record.group.bringToFront) record.group.bringToFront();
    }
    function targetIcon(target, selected) {
      const classes = ['target-marker']; if (selected) classes.push('is-selected'); if (target.locked) classes.push('is-locked'); if (target.enabled === false) classes.push('is-disabled');
      return L.divIcon({className: 'entity-marker-wrapper', html: `<span class="${classes.join(' ')}" aria-hidden="true"></span>`, iconSize: [26, 26], iconAnchor: [13, 13]});
    }
    function ensureTarget(target) {
      if (targetLayers.has(target.id)) return targetLayers.get(target.id);
      const group = layerGroup();
      const marker = L.marker(point(L, target.position), {draggable: false, pane: PANE_NAMES.target, bubblingMouseEvents: false, icon: targetIcon(target, false)}).bindTooltip(target.name || target.id, entityTooltip());
      marker.__portcamEntityId = target.id;
      marker.on('click', event => { event?.originalEvent?.stopPropagation?.(); store.selectTarget(target.id); onTargetSelect?.(target.id); });
      const record = {group, marker, line: null, interaction: null, labelVisible: labels.target};
      record.interaction = createEntityMarkerInteraction({kind: 'target', marker, store});
      marker.addTo(group); setLabel(record, 'target', labels.target); targetLayers.set(target.id, record);
      return record;
    }
    function syncTarget(target, state) {
      if (!target.position) { const existing = targetLayers.get(target.id); if (existing) { removeLayer(existing, 'line'); remove(existing.group); } return; }
      const record = ensureTarget(target), selected = state.uiState.selectedTargetId === target.id;
      if (target.visible === false) { removeLayer(record, 'line'); remove(record.group); return; }
      if (!map.hasLayer || !map.hasLayer(record.group)) record.group.addTo(map);
      record.marker.setLatLng(point(L, target.position)); record.marker.setTooltipContent?.(target.name || target.id); record.marker.setOpacity(target.enabled === false ? .45 : 1); record.marker.setIcon?.(targetIcon(target, selected)); setLabel(record, 'target', labels.target);
      const canDrag = selected && target.visible !== false && target.locked !== true && state.uiState.interactionMode === 'navigate';
      record.marker.options.draggable = canDrag;
      if (record.marker.dragging) canDrag ? record.marker.dragging.enable() : record.marker.dragging.disable();
      removeLayer(record, 'line');
      const camera = state.camerasById[state.uiState.selectedCameraId];
      if (selected && camera?.position) {
        const observation = store.getObservation(camera.id, target.id), isVisible = observation && observation.visibilityState === 'visible';
        record.line = L.polyline([point(L, camera.position), point(L, target.position)], {color:isVisible ? '#222' : '#777', weight:isVisible ? 2 : 1, dashArray:isVisible ? null : '5,5', opacity:observation && observation.calculationState === 'failed' ? .35 : .7, pane: PANE_NAMES.analysis, interactive: false, bubblingMouseEvents: false}).addTo(record.group);
      }
      if (selected && record.group.bringToFront) record.group.bringToFront();
    }
    function sync(state) {
      if (destroyed) return;
      const projected = {...state, camerasById: {...state.camerasById}, targetsById: {...state.targetsById}};
      if (state.preview?.kind === 'camera' && projected.camerasById[state.preview.id]) projected.camerasById[state.preview.id] = {...projected.camerasById[state.preview.id], ...clone(state.preview.patch)};
      if (state.preview?.kind === 'target' && projected.targetsById[state.preview.id]) projected.targetsById[state.preview.id] = {...projected.targetsById[state.preview.id], ...clone(state.preview.patch)};
      const wantedCameras = new Set(state.cameraOrder), wantedTargets = new Set(state.targetOrder);
      cameraLayers.forEach((record, id) => { if (!wantedCameras.has(id)) { record.interaction?.destroy(); remove(record.group); cameraLayers.delete(id); } });
      targetLayers.forEach((record, id) => { if (!wantedTargets.has(id)) { record.interaction?.destroy(); remove(record.group); targetLayers.delete(id); } });
      state.cameraOrder.forEach(id => syncCamera(projected.camerasById[id], projected)); state.targetOrder.forEach(id => syncTarget(projected.targetsById[id], projected));
    }
    function snapshot(id, table) { const record = table.get(id); if (!record) return null; const visible = !map.hasLayer || map.hasLayer(record.group); return {markerPosition: visible && record.marker.getLatLng ? record.marker.getLatLng() : null, visible, markerType: record.marker.constructor?.name || 'marker'}; }
    function getCameraLayerSnapshot(id) { const record = cameraLayers.get(id); if (!record) return null; return {...snapshot(id, cameraLayers), envelopeLayerCount: record.envelope.length, bandLayerCount: record.bands.length, centerlinePresent: Boolean(record.centerline), labelVisible: record.labelVisible}; }
    function getTargetLayerSnapshot(id) { const record = targetLayers.get(id); if (!record) return null; return {...snapshot(id, targetLayers), linePresent: Boolean(record.line), labelVisible: record.labelVisible}; }
    function fitCamera(id) { const record = cameraLayers.get(id); if (record) map.setView(record.marker.getLatLng(), Math.max(map.getZoom(), 15)); }
    function fitTarget(id) { const record = targetLayers.get(id); if (record) map.setView(record.marker.getLatLng(), Math.max(map.getZoom(), 15)); }
    function fitCameraFov(id) { const record = cameraLayers.get(id); if (record && record.envelope[0]?.getBounds) map.fitBounds(record.envelope[0].getBounds()); }
    function fitCameraAndTarget(cameraId, targetId) { const camera = cameraLayers.get(cameraId), target = targetLayers.get(targetId); if (camera && target && map.fitBounds) map.fitBounds([camera.marker.getLatLng(), target.marker.getLatLng()], {padding: [48, 48]}); }
    function setLabelVisibility(next) { if (next && typeof next.camera === 'boolean') labels.camera = next.camera; if (next && typeof next.target === 'boolean') labels.target = next.target; cameraLayers.forEach(record => setLabel(record, 'camera', labels.camera)); targetLayers.forEach(record => setLabel(record, 'target', labels.target)); }
    function normalizeWheelDelta(event) { const mode = Number(event.deltaMode || 0); if (mode === 1) return Number(event.deltaY || 0) * 16; if (mode === 2) return Number(event.deltaY || 0) * (wheelContainer?.clientHeight || map.getSize?.().y || 800); return Number(event.deltaY || 0); }
    function wheelZoom(event) {
      if (event.ctrlKey) return;
      const delta = normalizeWheelDelta(event); if (!delta) return;
      event.preventDefault?.();
      const direction = delta > 0 ? 1 : -1, now = Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now();
      if (direction === lastWheelDirection && now - lastWheelAt < 180) return;
      const current = Number(map.getZoom?.() ?? 0), min = Number(map.getMinZoom?.() ?? map.options?.minZoom ?? -Infinity), max = Number(map.getMaxZoom?.() ?? map.options?.maxZoom ?? Infinity), next = Math.max(min, Math.min(max, current - direction));
      lastWheelDirection = direction; lastWheelAt = now;
      if (next !== current && map.setZoom) map.setZoom(next);
    }
    function bindWheel() { map.scrollWheelZoom?.disable?.(); wheelContainer = map.getContainer?.(); if (wheelContainer?.addEventListener) wheelContainer.addEventListener('wheel', wheelZoom, {passive: false}); }
    function handleMapClick(event) { if (!destroyed && event?.latlng && onMapClick) onMapClick(event.latlng); }
    ensurePanes(); bindWheel(); map.on?.('click', handleMapClick);
    return {sync, getCameraLayerSnapshot, getTargetLayerSnapshot, fitCamera, fitCameraFov, fitTarget, fitCameraAndTarget, setLabelVisibility, cancelInteraction() { store.cancelPreview(); store.setInteractionMode('navigate'); }, destroy() { if (destroyed) return; destroyed = true; map.off?.('click', handleMapClick); wheelContainer?.removeEventListener?.('wheel', wheelZoom, {passive: false}); cameraLayers.forEach(record => { record.interaction?.destroy(); remove(record.group); }); targetLayers.forEach(record => { record.interaction?.destroy(); remove(record.group); }); cameraLayers.clear(); targetLayers.clear(); }};
  }
  return {createMapController, createEntityMarkerInteraction, PANE_NAMES};
}));
