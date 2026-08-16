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

  const CAMERA_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#c2410c', '#15803d', '#be123c', '#a16207'];

  function createMapController({map, leaflet: L, store, onCameraDrag, onMapClick, onTargetSelect}) {
    const cameraLayers = new Map(), targetLayers = new Map();
    let destroyed = false;
    function layerGroup() { return L.layerGroup().addTo(map); }
    function remove(group) { if (group) map.removeLayer(group); }
    function sector(center, heading, halfAngle, innerM, outerM) {
      const pts = [], steps = 24, start = heading - halfAngle, end = heading + halfAngle;
      if (innerM <= 0) pts.push(center);
      for (let i = 0; i <= steps; i++) pts.push(L.latLng(Core.destinationPoint(center, start + (end - start) * i / steps, outerM)));
      if (innerM > 0) for (let i = steps; i >= 0; i--) pts.push(L.latLng(Core.destinationPoint(center, start + (end - start) * i / steps, innerM)));
      return pts;
    }
    function ensureCamera(camera) {
      if (cameraLayers.has(camera.id)) return cameraLayers.get(camera.id);
      const group = layerGroup();
      const marker = L.marker(point(L, camera.position), {draggable: false}).bindTooltip(camera.name || camera.id);
      marker.on('click', () => store.selectCamera(camera.id));
      marker.on('dragend', e => onCameraDrag && onCameraDrag(camera.id, e.target.getLatLng()));
      marker.addTo(group);
      const record = {group, marker, envelope: [], bands: [], centerline: null};
      cameraLayers.set(camera.id, record); return record;
    }
    function clear(record, key) { record[key].forEach(layer => record.group.removeLayer(layer)); record[key] = []; }
    function syncCamera(camera, state) {
      let record = cameraLayers.get(camera.id); const selected = state.uiState.selectedCameraId === camera.id;
      const visible = camera.visible !== false && camera.lifecycle !== 'draft-unplaced' && camera.position;
      if (!visible) { if (record) { clear(record, 'envelope'); clear(record, 'bands'); if (record.centerline) { record.group.removeLayer(record.centerline); record.centerline = null; } remove(record.group); } return; }
      record = record || ensureCamera(camera);
      if (!map.hasLayer || !map.hasLayer(record.group)) record.group.addTo(map);
      const center = point(L, camera.position), color = camera.color || CAMERA_COLORS[Math.max(0, state.cameraOrder.indexOf(camera.id)) % CAMERA_COLORS.length];
      record.marker.setLatLng(center); record.marker.setOpacity(camera.enabled === false ? .42 : 1);
      record.marker.options.draggable = selected && !camera.locked;
      if (record.marker.dragging) camera.locked || !selected ? record.marker.dragging.disable() : record.marker.dragging.enable();
      clear(record, 'envelope'); clear(record, 'bands'); if (record.centerline) record.group.removeLayer(record.centerline);
      const optics = Core.computeOptics(camera), horizon = Core.computePlanningHorizon(camera.heightM, state.settings.planningTargetHeightM);
      const envelope = Core.computeGroundEnvelope(camera, optics, {horizonDistanceM:horizon.distanceM});
      const near = Math.max(0, envelope.nearDistanceM || 0), far = Math.min(envelope.farDistanceM || horizon.distanceM, horizon.distanceM, 30000);
      if (far > near) {
        const poly = L.polygon(sector(center, camera.headingDeg, optics.horizontalFovDeg / 2, near, far), {color, weight:selected ? 3 : 1.2, opacity:selected ? .95 : .42, fillColor:color, fillOpacity:selected ? .1 : .035, dashArray:camera.enabled === false ? '5,5' : null}).addTo(record.group);
        record.envelope.push(poly);
        record.centerline = L.polyline([center, L.latLng(Core.destinationPoint(center, camera.headingDeg, far))], {color, weight:selected ? 1.4 : .8, opacity:selected ? .85 : .35, dashArray:'5,5'}).addTo(record.group);
        if (selected && camera.enabled !== false) {
          const targetM = state.settings.planningTargetHeightM || 2, pitch = optics.pixelPitchMm;
          [[0,32,'#1f9d55'],[32,16,'#d99a00'],[16,8,'#e56b00']].forEach(([a,b,bandColor]) => {
            const inner = a ? Core.rangeForPixels(targetM, camera.focalLengthMm, pitch, a) : 0;
            const outer = Math.min(Core.rangeForPixels(targetM, camera.focalLengthMm, pitch, b), far);
            if (outer > inner) record.bands.push(L.polygon(sector(center, camera.headingDeg, optics.horizontalFovDeg / 2, Math.max(inner, near), outer), {color:bandColor, weight:1, fillColor:bandColor, fillOpacity:.16}).addTo(record.group));
          });
        }
      }
      if (selected && record.group.bringToFront) record.group.bringToFront();
    }
    function ensureTarget(target) {
      if (targetLayers.has(target.id)) return targetLayers.get(target.id);
      const group = layerGroup(), marker = L.circleMarker(point(L, target.position), {radius:6, color:'#111', weight:2, fillColor:'#fff', fillOpacity:.9}).addTo(group);
      marker.on('click', () => { store.selectTarget(target.id); if (onTargetSelect) onTargetSelect(target.id); }); const record = {group, marker, line:null}; targetLayers.set(target.id, record); return record;
    }
    function syncTarget(target, state) {
      if (!target.position) { const existing = targetLayers.get(target.id); if (existing) { if (existing.line) { existing.group.removeLayer(existing.line); existing.line = null; } remove(existing.group); } return; }
      const record = ensureTarget(target); if (target.visible === false) { if (record.line) { record.group.removeLayer(record.line); record.line = null; } remove(record.group); return; }
      if (!map.hasLayer || !map.hasLayer(record.group)) record.group.addTo(map); record.marker.setLatLng(point(L, target.position));
      if (record.line) record.group.removeLayer(record.line); const camera = state.camerasById[state.uiState.selectedCameraId];
      if (camera && camera.position) { const observation = store.getObservation(camera.id, target.id); const isVisible = observation && observation.visibilityState === 'visible'; record.line = L.polyline([point(L, camera.position), point(L, target.position)], {color:isVisible ? '#222' : '#777', weight:isVisible ? 2 : 1, dashArray:isVisible ? null : '5,5', opacity:observation && observation.calculationState === 'failed' ? .35 : .7}).addTo(record.group); }
    }
    function sync(state) {
      if (destroyed) return;
      const projected = {...state, camerasById: {...state.camerasById}, targetsById: {...state.targetsById}};
      if (state.preview && state.preview.kind === 'camera' && projected.camerasById[state.preview.id]) projected.camerasById[state.preview.id] = {...projected.camerasById[state.preview.id], ...clone(state.preview.patch)};
      if (state.preview && state.preview.kind === 'target' && projected.targetsById[state.preview.id]) projected.targetsById[state.preview.id] = {...projected.targetsById[state.preview.id], ...clone(state.preview.patch)};
      const wantedCameras = new Set(state.cameraOrder), wantedTargets = new Set(state.targetOrder);
      cameraLayers.forEach((record, id) => { if (!wantedCameras.has(id)) { remove(record.group); cameraLayers.delete(id); } });
      targetLayers.forEach((record, id) => { if (!wantedTargets.has(id)) { remove(record.group); targetLayers.delete(id); } });
      state.cameraOrder.forEach(id => syncCamera(projected.camerasById[id], projected)); state.targetOrder.forEach(id => syncTarget(projected.targetsById[id], projected));
    }
    const clickHandler = e => onMapClick && onMapClick(e.latlng);
    map.on('click', clickHandler);
    function snapshot(id) { const r = cameraLayers.get(id); if (!r) return null; const visible = map.hasLayer ? map.hasLayer(r.group) : true; const position = visible && r.marker.getLatLng(); return {markerPosition:position && {lat:position.lat, lng:position.lng}, envelopeLayerCount:r.envelope.length, bandLayerCount:r.bands.length, visible}; }
    function fitTarget(id) { const record = targetLayers.get(id); if (record) map.setView(record.marker.getLatLng(), Math.max(map.getZoom(), 15)); }
    function fitCameraAndTarget(cameraId, targetId) {
      const camera = cameraLayers.get(cameraId), target = targetLayers.get(targetId);
      if (!camera || !target) return;
      if (map.fitBounds) map.fitBounds([camera.marker.getLatLng(), target.marker.getLatLng()], {padding: [48, 48]});
    }
    return {sync, destroy() { if (destroyed) return; destroyed = true; map.off('click', clickHandler); cameraLayers.forEach(r => remove(r.group)); targetLayers.forEach(r => remove(r.group)); cameraLayers.clear(); targetLayers.clear(); }, getCameraLayerSnapshot:snapshot, fitCamera(id) { const r = cameraLayers.get(id); if (r) map.setView(r.marker.getLatLng(), Math.max(map.getZoom(), 15)); }, fitCameraFov(id) { const r = cameraLayers.get(id); if (r && r.envelope[0] && r.envelope[0].getBounds) map.fitBounds(r.envelope[0].getBounds()); }, fitTarget, fitCameraAndTarget, cancelInteraction() { store.cancelPreview(); store.setInteractionMode('navigate'); }};
  }
  return {createMapController};
}));
