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
  const COVERAGE_COLORS = {robust: '#15803d', usable: '#a16207', difficult: '#c2410c', notRecommended: '#b42318'};
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

  function coverageBandRanges(camera, settings) {
    try {
      const planningTargetHeightM = Number(settings?.planningTargetHeightM || 2);
      const optics = Core.computeOptics(camera);
      const horizon = Core.computePlanningHorizon(camera.heightM, planningTargetHeightM);
      const envelope = Core.computeGroundEnvelope(camera, optics, {horizonDistanceM: horizon.distanceM});
      const horizonDistanceM = Number(horizon.distanceM);
      const near = Math.max(0, Number(envelope.nearDistanceM || 0));
      const far = Math.min(Number(envelope.farDistanceM || horizonDistanceM), horizonDistanceM, 30000);
      if (!Number.isFinite(near) || !Number.isFinite(far) || far <= near) return [];
      const clamp = value => Math.max(near, Math.min(far, Number(value)));
      const boundaries = [near,
        Core.rangeForPixels(planningTargetHeightM, camera.focalLengthMm, optics.pixelPitchMm, 32),
        Core.rangeForPixels(planningTargetHeightM, camera.focalLengthMm, optics.pixelPitchMm, 16),
        Core.rangeForPixels(planningTargetHeightM, camera.focalLengthMm, optics.pixelPitchMm, 8),
        far].map(clamp);
      const bands = [
        {key: 'robust', color: COVERAGE_COLORS.robust},
        {key: 'usable', color: COVERAGE_COLORS.usable},
        {key: 'difficult', color: COVERAGE_COLORS.difficult},
        {key: 'notRecommended', color: COVERAGE_COLORS.notRecommended}
      ];
      return bands.map((band, index) => ({...band, innerM: boundaries[index], outerM: boundaries[index + 1]})).filter(band => band.outerM > band.innerM);
    } catch (_) {
      return [];
    }
  }

  function createMapController({map, leaflet: L, store, onCameraDrag, onMapClick, onMapMove, onCameraSelect, onTargetSelect, labelVisibility}) {
    if (!map || !L || !store) throw new Error('createMapController requires map, Leaflet and store');
    const cameraLayers = new Map(), targetLayers = new Map();
    const labels = {camera: labelVisibility?.camera !== false, target: labelVisibility?.target !== false};
    let destroyed = false;
    let wheelContainer = null;
    let lastWheelDirection = 0;
    let lastWheelAt = -Infinity;
    let placementPreviewDraft = null;
    let placementPreview = null;

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
    function clearFovLayers(record) { clear(record, 'envelope'); clear(record, 'bands'); removeLayer(record, 'centerline'); }
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
    function cameraGeometry(camera, state) {
      try {
        const optics = Core.computeOptics(camera);
        const horizon = Core.computePlanningHorizon(camera.heightM, state.settings.planningTargetHeightM);
        const envelope = Core.computeGroundEnvelope(camera, optics, {horizonDistanceM: horizon.distanceM});
        const near = Math.max(0, envelope.nearDistanceM || 0), far = Math.min(envelope.farDistanceM || horizon.distanceM, horizon.distanceM, 30000);
        return far > near ? {optics, near, far} : null;
      } catch (_) {
        return null;
      }
    }
    function renderFov(record, camera, state, {preview = false} = {}) {
      clearFovLayers(record);
      if (!camera?.position) return;
      const geometry = cameraGeometry(camera, state);
      if (!geometry) return;
      const center = point(L, camera.position);
      const fovColorMode = state.uiState?.fovColorMode === 'camera' ? 'camera' : 'coverage';
      const cameraMode = fovColorMode === 'camera';
      const enabled = camera.enabled !== false;
      const selected = !preview && state.uiState.selectedCameraId === camera.id;
      const emphasized = selected && enabled;
      const color = camera.color || CAMERA_COLORS[Math.max(0, state.cameraOrder.indexOf(camera.id)) % CAMERA_COLORS.length];
      const neutralColor = '#566273';
      const geometryOptions = {pane: PANE_NAMES.analysis, interactive: false};
      const opacityScale = preview ? .55 : 1;
      const outlineOpacity = (enabled ? (emphasized ? .95 : .42) : .24) * opacityScale;
      const centerlineOpacity = (enabled ? (emphasized ? .85 : .35) : .2) * opacityScale;
      const previewDash = preview ? '5,5' : null;
      if (cameraMode) {
        const envelopeColor = enabled ? color : neutralColor;
        const poly = L.polygon(sector(center, camera.headingDeg, geometry.optics.horizontalFovDeg / 2, geometry.near, geometry.far), {color: envelopeColor, weight: preview ? 1.5 : (emphasized ? 3 : 1.2), opacity: outlineOpacity, fillColor: envelopeColor, fillOpacity: enabled ? (preview ? .04 : (emphasized ? .1 : .035)) : 0, dashArray: enabled ? previewDash : '5,5', ...geometryOptions}).addTo(record.group);
        record.envelope.push(poly);
        record.centerline = L.polyline([center, L.latLng(Core.destinationPoint(center, camera.headingDeg, geometry.far))], {color: envelopeColor, weight: preview ? 1 : (emphasized ? 1.4 : .8), opacity: centerlineOpacity, dashArray:'5,5', ...geometryOptions}).addTo(record.group);
      } else {
        const poly = L.polygon(sector(center, camera.headingDeg, geometry.optics.horizontalFovDeg / 2, geometry.near, geometry.far), {color: neutralColor, weight: preview ? 1.5 : (emphasized ? 3 : 1.2), opacity: outlineOpacity, fillColor: neutralColor, fillOpacity: 0, dashArray: enabled ? previewDash : '5,5', ...geometryOptions}).addTo(record.group);
        record.envelope.push(poly);
        record.centerline = L.polyline([center, L.latLng(Core.destinationPoint(center, camera.headingDeg, geometry.far))], {color: neutralColor, weight: preview ? 1 : (emphasized ? 1.4 : .8), opacity: centerlineOpacity, dashArray:'5,5', ...geometryOptions}).addTo(record.group);
        if (enabled) coverageBandRanges(camera, state.settings).forEach(band => {
          record.bands.push(L.polygon(sector(center, camera.headingDeg, geometry.optics.horizontalFovDeg / 2, band.innerM, band.outerM), {color:band.color, weight:1, opacity: preview ? .55 : 1, fillColor:band.color, fillOpacity: preview ? .1 : .16, dashArray: preview ? '5,5' : null, ...geometryOptions}).addTo(record.group));
        });
      }
    }
    function ensureCamera(camera) {
      if (cameraLayers.has(camera.id)) return cameraLayers.get(camera.id);
      const group = layerGroup();
      const marker = L.marker(point(L, camera.position), {draggable: false, pane: PANE_NAMES.camera, bubblingMouseEvents: false}).bindTooltip(camera.name || camera.id, entityTooltip());
      marker.__portcamEntityId = camera.id;
      marker.on('click', event => { event?.originalEvent?.stopPropagation?.(); store.selectCamera(camera.id); onCameraSelect?.(camera.id); });
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
      const center = point(L, camera.position);
      record.marker.setLatLng(center); record.marker.setTooltipContent?.(camera.name || camera.id); record.marker.setOpacity(camera.enabled === false ? .42 : 1); setLabel(record, 'camera', labels.camera);
      const canDrag = selected && camera.visible !== false && camera.locked !== true && state.uiState.interactionMode === 'navigate';
      record.marker.options.draggable = canDrag;
      if (record.marker.dragging) canDrag ? record.marker.dragging.enable() : record.marker.dragging.disable();
      renderFov(record, camera, state);
      if (selected && record.group.bringToFront) record.group.bringToFront();
    }
    function placementPreviewIcon() {
      return L.divIcon({className: 'camera-placement-preview-wrapper', html: '<span class="camera-placement-preview-marker" aria-hidden="true"></span>', iconSize: [28, 28], iconAnchor: [14, 14]});
    }
    function clearCameraPlacementPreview() {
      placementPreviewDraft = null;
      if (!placementPreview) return;
      clearFovLayers(placementPreview);
      remove(placementPreview.group);
      placementPreview = null;
    }
    function renderCameraPlacementPreview(state) {
      if (!placementPreviewDraft?.position) { clearCameraPlacementPreview(); return; }
      if (!placementPreview) {
        const group = layerGroup();
        const marker = L.marker(point(L, placementPreviewDraft.position), {draggable: false, interactive: false, pane: PANE_NAMES.camera, bubblingMouseEvents: false, icon: placementPreviewIcon()}).bindTooltip('Preview', {...entityTooltip(), permanent: true});
        marker.__portcamPlacementPreview = true;
        marker.addTo(group);
        marker.openTooltip?.();
        placementPreview = {group, marker, envelope: [], bands: [], centerline: null};
      }
      if (!map.hasLayer || !map.hasLayer(placementPreview.group)) placementPreview.group.addTo(map);
      placementPreview.marker.setLatLng(point(L, placementPreviewDraft.position));
      placementPreview.marker.setTooltipContent?.('Preview');
      renderFov(placementPreview, placementPreviewDraft, state, {preview: true});
    }
    function targetIcon(target, selected) {
      const classes = ['target-marker']; if (selected) classes.push('is-selected'); if (target.locked) classes.push('is-locked'); if (target.enabled === false) classes.push('is-disabled');
      return L.divIcon({className: 'entity-marker-wrapper', html: `<span class="${classes.join(' ')}" aria-hidden="true"></span>`, iconSize: [26, 26], iconAnchor: [13, 13]});
    }
    function targetIconKey(target, selected) { return `${selected ? 1 : 0}:${target.locked ? 1 : 0}:${target.enabled === false ? 1 : 0}`; }
    function ensureTarget(target) {
      if (targetLayers.has(target.id)) return targetLayers.get(target.id);
      const group = layerGroup();
      const marker = L.marker(point(L, target.position), {draggable: false, pane: PANE_NAMES.target, bubblingMouseEvents: false, icon: targetIcon(target, false)}).bindTooltip(target.name || target.id, entityTooltip());
      marker.__portcamEntityId = target.id;
      marker.on('click', event => { event?.originalEvent?.stopPropagation?.(); store.selectTarget(target.id); onTargetSelect?.(target.id); });
      const record = {group, marker, line: null, interaction: null, labelVisible: labels.target, iconKey: targetIconKey(target, false)};
      record.interaction = createEntityMarkerInteraction({kind: 'target', marker, store});
      marker.addTo(group); setLabel(record, 'target', labels.target); targetLayers.set(target.id, record);
      return record;
    }
    function syncTarget(target, state) {
      if (!target.position) { const existing = targetLayers.get(target.id); if (existing) { removeLayer(existing, 'line'); remove(existing.group); } return; }
      const record = ensureTarget(target), selected = state.uiState.selectedTargetId === target.id;
      if (target.visible === false) { record.marker.options.draggable = false; record.marker.dragging?.disable?.(); removeLayer(record, 'line'); remove(record.group); return; }
      if (!map.hasLayer || !map.hasLayer(record.group)) record.group.addTo(map);
      const iconKey = targetIconKey(target, selected);
      record.marker.setLatLng(point(L, target.position)); record.marker.setTooltipContent?.(target.name || target.id); record.marker.setOpacity(target.enabled === false ? .45 : 1); if (record.iconKey !== iconKey) { record.marker.setIcon?.(targetIcon(target, selected)); record.iconKey = iconKey; } setLabel(record, 'target', labels.target);
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
      renderCameraPlacementPreview(projected);
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
    function handleMapClick(event) { if (!destroyed && event?.latlng && onMapClick) onMapClick(event.latlng, event.originalEvent); }
    function handleMapMove(event) { if (!destroyed && event?.latlng && onMapMove) onMapMove(event.latlng, event.originalEvent); }
    ensurePanes(); bindWheel(); map.on?.('click', handleMapClick); map.on?.('mousemove', handleMapMove);
    return {sync, getCameraLayerSnapshot, getTargetLayerSnapshot, fitCamera, fitCameraFov, fitTarget, fitCameraAndTarget, setLabelVisibility, setCameraPlacementPreview(cameraDraft) { placementPreviewDraft = cameraDraft ? clone(cameraDraft) : null; renderCameraPlacementPreview(store.getState()); }, clearCameraPlacementPreview, cancelInteraction() { store.cancelPreview(); clearCameraPlacementPreview(); store.setInteractionMode('navigate'); }, destroy() { if (destroyed) return; destroyed = true; map.off?.('click', handleMapClick); map.off?.('mousemove', handleMapMove); wheelContainer?.removeEventListener?.('wheel', wheelZoom, {passive: false}); clearCameraPlacementPreview(); cameraLayers.forEach(record => { record.interaction?.destroy(); remove(record.group); }); targetLayers.forEach(record => { record.interaction?.destroy(); remove(record.group); }); cameraLayers.clear(); targetLayers.clear(); }};
  }
  return {createMapController, createEntityMarkerInteraction, coverageBandRanges, CAMERA_COLORS, COVERAGE_COLORS, PANE_NAMES};
}));
