/* Leaflet projection for normalized PortCam project state. */
(function (root, factory) {
  const api = factory(
    root.PortCamCore || (typeof require === 'function' ? require('./portcam-core.js') : null),
    root.PortCamVesselSymbol || (typeof require === 'function' ? require('./portcam-vessel-symbol.js') : null),
    root.PortCamHeadingInteraction || (typeof require === 'function' ? require('./portcam-heading-interaction.js') : null),
    root.PortCamCriteria || (typeof require === 'function' ? require('./portcam-criteria.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamMap = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, VesselSymbol, HeadingInteraction, Criteria) {
  'use strict';
  if (!Core) throw new Error('PortCamMap requires PortCamCore');
  if (!VesselSymbol) throw new Error('PortCamMap requires PortCamVesselSymbol');
  if (!HeadingInteraction) throw new Error('PortCamMap requires PortCamHeadingInteraction');
  if (!Criteria) throw new Error('PortCamMap requires PortCamCriteria');

  const clone = value => JSON.parse(JSON.stringify(value));
  const point = (L, position) => L.latLng(position.latitudeDeg, position.longitudeDeg);
  const positionFromLatLng = latlng => ({latitudeDeg: Number(latlng.lat), longitudeDeg: Number(latlng.lng)});
  const CAMERA_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#c2410c', '#15803d', '#be123c', '#a16207'];
  const COVERAGE_COLORS = {robust: '#15803d', usable: '#a16207', difficult: '#c2410c', notRecommended: '#b42318', identification: '#15803d', recognition: '#a16207', detection: '#c2410c', belowDetection: '#b42318'};
  const PANE_NAMES = {analysis: 'portcam-analysis-pane', camera: 'portcam-camera-marker-pane', target: 'portcam-target-marker-pane', headingHandle: 'portcam-heading-handle-pane', label: 'portcam-entity-label-pane'};
  const PANE_Z = {analysis: 400, camera: 650, target: 700, headingHandle: 680, label: 750};
  const HEADING_HANDLE_DISTANCE_PX = 58;
  const HEADING_HANDLE_HIT_RADIUS_PX = 22;

  function createEntityMarkerInteraction({kind, marker, store}) {
    if (!marker || !store || !['camera', 'target'].includes(kind)) throw new Error('createEntityMarkerInteraction requires camera or target marker and store');
    let dragId = null;
    let canonicalPosition = null;
    const getEntity = id => kind === 'camera' ? store.getCamera(id, false) : store.getTarget(id, false);
    const canDrag = id => {
      const state = store.getState();
      const entity = getEntity(id);
      return Boolean(entity && state.uiState?.interactionMode === 'navigate' && entity.visible !== false && entity.locked !== true && entity.position);
    };
    const onDragStart = () => {
      const id = marker.__portcamEntityId;
      if (!canDrag(id)) { dragId = null; canonicalPosition = null; return; }
      dragId = id;
      canonicalPosition = clone(getEntity(id).position);
      // A direct drag is also an explicit edit intent: focus the entity before
      // previewing its new position, without requiring a separate preliminary click.
      store.setFocusedEntity(kind, id);
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
      isDragging() { return dragId !== null; },
      getCanonicalPosition() { return clone(canonicalPosition); },
      destroy() { marker.off?.('dragstart', onDragStart); marker.off?.('drag', onDrag); marker.off?.('dragend', onDragEnd); }
    };
  }

  const DEFAULT_FILL_OPACITY = 0.16;
  function cameraFillOpacity(value, focused, preview) {
    const base = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_FILL_OPACITY;
    return Math.min(1, base * (focused ? 1.5 : 1)) * (preview ? 0.4 : 1);
  }

  function coverageBandRanges(camera, settings, options) {
    try {
      const planningTargetHeightM = Number(settings?.planningTargetHeightM ?? 2);
      const referenceSizeM = settings?.pixelCoverageReferenceSizeM ?? planningTargetHeightM;
      if (!Number.isFinite(referenceSizeM) || referenceSizeM <= 0) return [];
      const requestedProfileId = typeof options === 'string' ? options : options?.profileId;
      const profile = Criteria.getCriteriaProfile(requestedProfileId) || Criteria.getCriteriaProfile();
      const optics = Core.computeOptics(camera);
      const horizon = Core.computePlanningHorizon(camera.heightM, planningTargetHeightM);
      const envelope = Core.computeGroundEnvelope(camera, optics, {horizonDistanceM: horizon.distanceM});
      const horizonDistanceM = Number(horizon.distanceM);
      const near = Math.max(0, Number(envelope.nearDistanceM || 0));
      const far = Math.min(Number(envelope.farDistanceM || horizonDistanceM), horizonDistanceM, 30000);
      if (!Number.isFinite(near) || !Number.isFinite(far) || far <= near) return [];
      const clamp = value => Math.max(near, Math.min(far, Number(value)));
      const boundaries = [near,
        ...profile.levels.slice(0, -1).map(level => Core.rangeForPixels(referenceSizeM, camera.focalLengthMm, optics.pixelPitchMm, level.minPx)),
        far
      ].map(clamp);
      return profile.levels.map((level, index) => ({
        key: level.levelId,
        label: level.label,
        minPx: level.minPx,
        profileId: profile.profileId,
        color: COVERAGE_COLORS[level.levelId] || COVERAGE_COLORS.notRecommended,
        innerM: boundaries[index],
        outerM: boundaries[index + 1]
      })).filter(band => band.outerM > band.innerM);
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
    let targetPlacementPreviewDraft = null;
    let targetPlacementPreview = null;

    function ensurePanes() {
      if (!map.createPane) return;
      Object.entries(PANE_NAMES).forEach(([key, name]) => {
        const pane = map.getPane?.(name) || map.createPane(name);
        if (pane) { pane.style.zIndex = String(PANE_Z[key]); if (key === 'headingHandle') pane.style.pointerEvents = 'none'; }
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
    function mapPoint(value) { return L.point ? L.point(value.x, value.y) : value; }
    function mapContainerPoint(latlng) {
      if (map.latLngToContainerPoint) return map.latLngToContainerPoint(latlng);
      if (map.latLngToLayerPoint) return map.latLngToLayerPoint(latlng);
      return null;
    }
    function mapContainerLatLng(value) { return map.containerPointToLatLng ? map.containerPointToLatLng(mapPoint(value)) : null; }
    function pointerContainerPoint(event) {
      const container = map.getContainer?.(), rect = container?.getBoundingClientRect?.();
      return {x: Number(event.clientX) - Number(rect?.left || 0), y: Number(event.clientY) - Number(rect?.top || 0)};
    }
    function mapPanEnabled() {
      const dragging = map.dragging;
      if (!dragging) return null;
      if (typeof dragging.enabled === 'function') return Boolean(dragging.enabled());
      return dragging._enabled === false ? false : true;
    }
    function setMapPanEnabled(enabled) {
      const dragging = map.dragging;
      if (!dragging) return;
      if (enabled) dragging.enable?.(); else dragging.disable?.();
    }
    function headingHandleProjection(camera) {
      if (!camera?.position || !map.getSize || !mapContainerPoint || !mapContainerLatLng) return null;
      const centerValue = mapContainerPoint(point(L, camera.position));
      const size = map.getSize();
      const center = {x: Number(centerValue?.x), y: Number(centerValue?.y)};
      const width = Number(size?.x), height = Number(size?.y);
      if (![center.x, center.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
      const heading = Core.normalizeHeading(Number(camera.headingDeg) || 0);
      const radians = heading * Math.PI / 180;
      const handle = {x: center.x + Math.sin(radians) * HEADING_HANDLE_DISTANCE_PX, y: center.y - Math.cos(radians) * HEADING_HANDLE_DISTANCE_PX};
      const inside = (value, radius) => value.x >= radius && value.y >= radius && value.x <= width - radius && value.y <= height - radius;
      if (!inside(center, HEADING_HANDLE_HIT_RADIUS_PX) || !inside(handle, HEADING_HANDLE_HIT_RADIUS_PX)) return null;
      const latlng = mapContainerLatLng(handle);
      if (!latlng) return null;
      const key = [map.getZoom?.(), width, height, center.x, center.y].map(value => Number.isFinite(Number(value)) ? Number(value).toFixed(4) : String(value)).join(':');
      return {center, handle, latlng, key};
    }
    function headingHandleEditable(camera, state) {
      return Boolean(camera?.position && camera.lifecycle !== 'draft-unplaced' && camera.visible !== false && camera.locked !== true && state.uiState?.interactionMode === 'navigate' && state.uiState.focusedEntity?.kind === 'camera' && state.uiState.focusedEntity.id === camera.id);
    }
    function removeHeadingHandle(record) {
      if (!record?.headingHandle) return;
      record.headingHandle.interaction?.destroy?.();
      record.headingHandle.element?.remove?.();
      if (record.headingHandle.element?.parentNode?.removeChild) record.headingHandle.element.parentNode.removeChild(record.headingHandle.element);
      record.headingHandle = null;
    }
    function hideHeadingHandle(record) {
      const handle = record?.headingHandle;
      if (!handle?.element) return;
      handle.element.hidden = true;
      handle.element.style.display = 'none';
      handle.element.tabIndex = -1;
      handle.element.setAttribute?.('aria-hidden', 'true');
    }
    function ensureHeadingHandle(camera, record) {
      if (record.headingHandle || !map.getContainer) return record.headingHandle;
      const container = map.getContainer();
      const documentObject = container?.ownerDocument || (typeof document !== 'undefined' ? document : null);
      const pane = map.getPane?.(PANE_NAMES.headingHandle);
      if (!documentObject?.createElement || !pane?.appendChild) return null;
      const element = documentObject.createElement('button');
      element.type = 'button';
      element.className = 'fov-heading-handle';
      element.setAttribute('data-portcam-heading-handle', camera.id);
      element.setAttribute('aria-label', '拖曳調整方向');
      element.setAttribute('aria-valuemin', '0');
      element.setAttribute('aria-valuemax', '360');
      element.tabIndex = -1;
      element.hidden = true;
      element.style.position = 'absolute';
      element.style.display = 'none';
      element.style.pointerEvents = 'auto';
      element.style.touchAction = 'none';
      pane.appendChild(element);
      const interaction = HeadingInteraction.createHeadingInteraction({
        element,
        window: documentObject.defaultView,
        title: '拖曳調整方向',
        minimumDistance: 8,
        getCenter: () => {
          const current = store.getCamera(camera.id, false);
          return current?.position ? mapContainerPoint(point(L, current.position)) : null;
        },
        getPointerPoint: pointerContainerPoint,
        getProjectionKey: () => headingHandleProjection(store.getCamera(camera.id, false))?.key,
        getHeading: () => store.getCamera(camera.id)?.headingDeg,
        canEdit: () => headingHandleEditable(store.getCamera(camera.id, false), store.getState()),
        previewHeading: value => store.beginPreview('camera', camera.id, {headingDeg: value}),
        commitHeading: () => store.commitPreview('camera-heading-handle'),
        cancelHeading: () => store.cancelPreview(),
        getPanEnabled: mapPanEnabled,
        setPanEnabled: setMapPanEnabled
      });
      record.headingHandle = {element, interaction, projectionKey: null};
      return record.headingHandle;
    }
    function syncHeadingHandle(record, camera, state) {
      const handle = ensureHeadingHandle(camera, record);
      if (!handle) return;
      const editable = headingHandleEditable(camera, state);
      const projection = editable ? headingHandleProjection(camera) : null;
      if (handle.interaction.isDragging() && (!projection || handle.projectionKey !== projection.key)) handle.interaction.cancel();
      handle.projectionKey = projection?.key || null;
      if (!projection) { hideHeadingHandle(record); handle.interaction.refresh(camera?.headingDeg, false); return; }
      const color = camera.color || CAMERA_COLORS[Math.max(0, state.cameraOrder.indexOf(camera.id)) % CAMERA_COLORS.length];
      const heading = Core.normalizeHeading(Number(camera.headingDeg) || 0);
      const element = handle.element;
      element.hidden = false;
      element.style.display = 'grid';
      element.style.left = `${projection.handle.x}px`;
      element.style.top = `${projection.handle.y}px`;
      element.style.setProperty?.('--camera-color', color);
      element.style.setProperty?.('--heading-deg', `${heading}deg`);
      element.tabIndex = 0;
      element.setAttribute?.('aria-hidden', 'false');
      element.setAttribute?.('aria-label', '拖曳調整方向');
      handle.interaction.refresh(heading, true);
    }
    function cancelHeadingInteractions() { cameraLayers.forEach(record => record.headingHandle?.interaction?.cancel?.()); }
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
      const selected = !preview && state.uiState.focusedEntity?.kind === 'camera' && state.uiState.focusedEntity.id === camera.id;
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
        const poly = L.polygon(sector(center, camera.headingDeg, geometry.optics.horizontalFovDeg / 2, geometry.near, geometry.far), {color: envelopeColor, weight: preview ? 1.5 : (emphasized ? 3 : 1.2), opacity: outlineOpacity, fillColor: envelopeColor, fillOpacity: enabled ? cameraFillOpacity(state.uiState?.cameraFillOpacity, emphasized, preview) : 0, dashArray: enabled ? previewDash : '5,5', ...geometryOptions}).addTo(record.group);
        record.envelope.push(poly);
        record.centerline = L.polyline([center, L.latLng(Core.destinationPoint(center, camera.headingDeg, geometry.far))], {color: envelopeColor, weight: preview ? 1 : (emphasized ? 1.4 : .8), opacity: centerlineOpacity, dashArray:'5,5', ...geometryOptions}).addTo(record.group);
      } else {
        const poly = L.polygon(sector(center, camera.headingDeg, geometry.optics.horizontalFovDeg / 2, geometry.near, geometry.far), {color: neutralColor, weight: preview ? 1.5 : (emphasized ? 3 : 1.2), opacity: outlineOpacity, fillColor: neutralColor, fillOpacity: 0, dashArray: enabled ? previewDash : '5,5', ...geometryOptions}).addTo(record.group);
        record.envelope.push(poly);
        record.centerline = L.polyline([center, L.latLng(Core.destinationPoint(center, camera.headingDeg, geometry.far))], {color: neutralColor, weight: preview ? 1 : (emphasized ? 1.4 : .8), opacity: centerlineOpacity, dashArray:'5,5', ...geometryOptions}).addTo(record.group);
        if (enabled) coverageBandRanges(camera, state.settings, {profileId: state.uiState?.coverageCriteriaProfileId}).forEach(band => {
          record.bands.push(L.polygon(sector(center, camera.headingDeg, geometry.optics.horizontalFovDeg / 2, band.innerM, band.outerM), {color:band.color, weight:1, opacity: preview ? .55 : 1, fillColor:band.color, fillOpacity: preview ? .1 : .16, dashArray: preview ? '5,5' : null, ...geometryOptions}).addTo(record.group));
        });
      }
    }
    function ensureCamera(camera) {
      if (cameraLayers.has(camera.id)) return cameraLayers.get(camera.id);
      const group = layerGroup();
      // Leaflet only creates marker.dragging during construction when this is true.
      // syncCamera immediately disables it unless this Camera is the focused, movable entity.
      const marker = L.marker(point(L, camera.position), {draggable: true, pane: PANE_NAMES.camera, bubblingMouseEvents: false}).bindTooltip(camera.name || camera.id, entityTooltip());
      marker.__portcamEntityId = camera.id;
      marker.on('click', event => { event?.originalEvent?.stopPropagation?.(); store.selectCamera(camera.id); onCameraSelect?.(camera.id); });
      const record = {group, marker, envelope: [], bands: [], centerline: null, interaction: null, headingHandle: null, labelVisible: labels.camera};
      record.interaction = createEntityMarkerInteraction({kind: 'camera', marker, store});
      marker.addTo(group); setLabel(record, 'camera', labels.camera); cameraLayers.set(camera.id, record); ensureHeadingHandle(camera, record);
      return record;
    }
    function syncCamera(camera, state) {
      let record = cameraLayers.get(camera.id);
      const selected = state.uiState.focusedEntity?.kind === 'camera' && state.uiState.focusedEntity.id === camera.id;
      const visible = camera.visible !== false && camera.lifecycle !== 'draft-unplaced' && camera.position;
      if (!visible) { if (record) { record.headingHandle?.interaction?.cancel?.(); hideHeadingHandle(record); clear(record, 'envelope'); clear(record, 'bands'); removeLayer(record, 'centerline'); remove(record.group); } return; }
      record = record || ensureCamera(camera);
      if (!map.hasLayer || !map.hasLayer(record.group)) record.group.addTo(map);
      const center = point(L, camera.position);
      record.marker.setLatLng(center); record.marker.setTooltipContent?.(camera.name || camera.id); record.marker.setOpacity(camera.enabled === false ? .42 : 1); setLabel(record, 'camera', labels.camera);
      const canDrag = camera.visible !== false && camera.locked !== true && state.uiState.interactionMode === 'navigate';
      record.marker.options.draggable = canDrag;
      if (record.marker.dragging) canDrag ? record.marker.dragging.enable() : record.marker.dragging.disable();
      renderFov(record, camera, state);
      syncHeadingHandle(record, camera, state);
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
    function pixelsPerMeter(target) {
      // latLngToLayerPoint rounds to whole pixels.  At the geographic-symbol
      // threshold one metre is often sub-pixel, so use map.project when
      // available and measure a longer local baseline before normalizing.
      const sampleDistanceM = 100;
      const zoom = Number(map.getZoom?.());
      const project = map.project
        ? latlng => map.project(latlng, zoom)
        : map.latLngToLayerPoint
          ? latlng => map.latLngToLayerPoint(latlng)
          : null;
      if (!project || !target?.position) return null;
      const origin = point(L, target.position);
      const north = L.latLng(Core.destinationPoint(target.position, 0, sampleDistanceM));
      const east = L.latLng(Core.destinationPoint(target.position, 90, sampleDistanceM));
      const centerPx = project(origin), northPx = project(north), eastPx = project(east);
      const distance = (left, right) => left?.distanceTo ? left.distanceTo(right) : Math.hypot(Number(left?.x) - Number(right?.x), Number(left?.y) - Number(right?.y));
      const northScale = distance(centerPx, northPx), eastScale = distance(centerPx, eastPx);
      const scale = (northScale + eastScale) / (2 * sampleDistanceM);
      return Number.isFinite(scale) && scale > 0 ? scale : null;
    }
    function targetProjection(target) {
      const zoom = Number(map.getZoom?.());
      if (zoom >= VesselSymbol.GEOGRAPHIC_ZOOM) {
        const scale = pixelsPerMeter(target);
        if (scale) return {mode: 'geographic', widthPx: target.widthM * scale, heightPx: target.lengthM * scale, scale, zoom};
      }
      return {mode: 'symbol', zoom};
    }
    function targetIcon(target, selected, preview, projection) { return L.divIcon(VesselSymbol.iconOptions(target, {selected, preview, ...(projection || targetProjection(target))})); }
    function targetIconKey(target, selected, projection) { const value = projection || targetProjection(target); return `${value.mode}:${value.zoom}:${value.widthPx || 40}:${value.heightPx || 40}:${target.modelType||'small-vessel'}:${Number(target.lengthM)||0}:${Number(target.widthM)||0}:${Number(target.headingDeg)||0}:${selected ? 1 : 0}:${target.locked ? 1 : 0}:${target.enabled === false ? 1 : 0}`; }
    function ensureTarget(target) {
      if (targetLayers.has(target.id)) return targetLayers.get(target.id);
      const group = layerGroup();
      const projection = targetProjection(target);
      // See ensureCamera: initialize Leaflet's handler once, then gate it in syncTarget.
      const marker = L.marker(point(L, target.position), {draggable: true, pane: PANE_NAMES.target, bubblingMouseEvents: false, icon: targetIcon(target, false, false, projection)}).bindTooltip(target.name || target.id, entityTooltip());
      marker.__portcamEntityId = target.id;
      marker.on('click', event => { event?.originalEvent?.stopPropagation?.(); store.selectTarget(target.id); onTargetSelect?.(target.id); });
      const record = {group, marker, line: null, interaction: null, labelVisible: labels.target, iconKey: targetIconKey(target, false, projection)};
      record.interaction = createEntityMarkerInteraction({kind: 'target', marker, store});
      marker.addTo(group); setLabel(record, 'target', labels.target); targetLayers.set(target.id, record);
      return record;
    }
    function syncTarget(target, state) {
      if (!target.position) { const existing = targetLayers.get(target.id); if (existing) { removeLayer(existing, 'line'); remove(existing.group); } return; }
      const record = ensureTarget(target), selected = state.uiState.focusedEntity?.kind === 'target' && state.uiState.focusedEntity.id === target.id, current = state.uiState.selectedTargetId === target.id;
      if (target.visible === false) { record.marker.options.draggable = false; record.marker.dragging?.disable?.(); removeLayer(record, 'line'); remove(record.group); return; }
      if (!map.hasLayer || !map.hasLayer(record.group)) record.group.addTo(map);
      const projection = targetProjection(target), iconKey = targetIconKey(target, selected, projection);
      const dragActive = record.interaction?.isDragging?.();
      // Replacing a Leaflet marker icon while its drag handler owns the current
      // DOM node cancels the gesture before dragend. Geographic icon dimensions
      // vary slightly with latitude and focus styling can change on dragstart,
      // so defer either replacement until dragend commits the gesture.
      record.marker.setLatLng(point(L, target.position)); record.marker.setTooltipContent?.(target.name || target.id); record.marker.setOpacity(target.enabled === false ? .45 : 1); if (record.iconKey !== iconKey && !dragActive) { record.marker.setIcon?.(targetIcon(target, selected, false, projection)); record.iconKey = iconKey; } setLabel(record, 'target', labels.target);
      const canDrag = target.visible !== false && target.locked !== true && state.uiState.interactionMode === 'navigate';
      record.marker.options.draggable = canDrag;
      if (record.marker.dragging) canDrag ? record.marker.dragging.enable() : record.marker.dragging.disable();
      removeLayer(record, 'line');
      const camera = state.camerasById[state.uiState.selectedCameraId];
      if ((selected || current) && camera?.position) {
        const observation = store.getObservation(camera.id, target.id), isVisible = observation && observation.visibilityState === 'visible';
        record.line = L.polyline([point(L, camera.position), point(L, target.position)], {color:isVisible ? '#222' : '#777', weight:isVisible ? 2 : 1, dashArray:isVisible ? null : '5,5', opacity:observation && observation.calculationState === 'failed' ? .35 : .7, pane: PANE_NAMES.analysis, interactive: false, bubblingMouseEvents: false}).addTo(record.group);
      }
      if (selected && record.group.bringToFront) record.group.bringToFront();
    }
    function clearTargetPlacementPreview() { targetPlacementPreviewDraft=null; if(targetPlacementPreview){remove(targetPlacementPreview.group);targetPlacementPreview=null;} }
    function renderTargetPlacementPreview() { const target=targetPlacementPreviewDraft; if(!target?.position){clearTargetPlacementPreview();return;} const projection=targetProjection(target); if(!targetPlacementPreview){const group=layerGroup();const marker=L.marker(point(L,target.position),{interactive:false,draggable:false,pane:PANE_NAMES.target,icon:targetIcon(target,false,true,projection)}).addTo(group);targetPlacementPreview={group,marker,key:''};} const rec=targetPlacementPreview,key=targetIconKey(target,false,projection);rec.marker.setLatLng(point(L,target.position));if(rec.key!==key){rec.marker.setIcon(targetIcon(target,false,true,projection));rec.key=key;} }
    let presentationState = null;
    function sync(state) {
      if (destroyed) return;
      presentationState = state;
      const projected = {...state, camerasById: {...state.camerasById}, targetsById: {...state.targetsById}};
      if (state.preview?.kind === 'camera' && projected.camerasById[state.preview.id]) projected.camerasById[state.preview.id] = {...projected.camerasById[state.preview.id], ...clone(state.preview.patch)};
      if (state.preview?.kind === 'target' && projected.targetsById[state.preview.id]) projected.targetsById[state.preview.id] = {...projected.targetsById[state.preview.id], ...clone(state.preview.patch)};
      const wantedCameras = new Set(state.cameraOrder), wantedTargets = new Set(state.targetOrder);
      cameraLayers.forEach((record, id) => { if (!wantedCameras.has(id)) { record.interaction?.destroy(); remove(record.group); cameraLayers.delete(id); } });
      targetLayers.forEach((record, id) => { if (!wantedTargets.has(id)) { record.interaction?.destroy(); remove(record.group); targetLayers.delete(id); } });
      state.cameraOrder.forEach(id => syncCamera(projected.camerasById[id], projected)); state.targetOrder.forEach(id => syncTarget(projected.targetsById[id], projected));
      renderCameraPlacementPreview(projected);
      renderTargetPlacementPreview();
    }
    function snapshot(id, table) { const record = table.get(id); if (!record) return null; const visible = !map.hasLayer || map.hasLayer(record.group); return {markerPosition: visible && record.marker.getLatLng ? record.marker.getLatLng() : null, visible, markerType: record.marker.constructor?.name || 'marker'}; }
    function getCameraHeadingHandleSnapshot(id) {
      const element = cameraLayers.get(id)?.headingHandle?.element;
      if (!element) return null;
      return {
        visible: element.hidden !== true && element.style.display !== 'none',
        left: element.style.left || '',
        top: element.style.top || '',
        heading: element.getAttribute?.('aria-valuenow') || null,
        ariaLabel: element.getAttribute?.('aria-label') || null,
        ariaDisabled: element.getAttribute?.('aria-disabled') || null,
        title: element.getAttribute?.('title') || '',
        className: element.className || ''
      };
    }
    function getCameraLayerSnapshot(id) { const record = cameraLayers.get(id); if (!record) return null; return {...snapshot(id, cameraLayers), envelopeLayerCount: record.envelope.length, bandLayerCount: record.bands.length, centerlinePresent: Boolean(record.centerline), headingHandleVisible: Boolean(record.headingHandle?.element && !record.headingHandle.element.hidden && record.headingHandle.element.style.display !== 'none'), labelVisible: record.labelVisible}; }
    function getTargetLayerSnapshot(id) { const record = targetLayers.get(id); if (!record) return null; return {...snapshot(id, targetLayers), linePresent: Boolean(record.line), labelVisible: record.labelVisible, iconSize: record.marker.options.icon?.iconSize?.slice?.() || null, iconAnchor: record.marker.options.icon?.iconAnchor?.slice?.() || null}; }
    function fitCamera(id) { const record = cameraLayers.get(id); if (record) map.setView(record.marker.getLatLng(), Math.max(map.getZoom(), 15)); }
    function fitTarget(id) { const record = targetLayers.get(id); if (record) map.setView(record.marker.getLatLng(), Math.max(map.getZoom(), 15)); }
    function fitCameraFov(id) { const record = cameraLayers.get(id); if (record && record.envelope[0]?.getBounds) map.fitBounds(record.envelope[0].getBounds()); }
    function fitCameraAndTarget(cameraId, targetId) { const camera = cameraLayers.get(cameraId), target = targetLayers.get(targetId); if (camera && target && map.fitBounds) map.fitBounds([camera.marker.getLatLng(), target.marker.getLatLng()], {padding: [48, 48]}); }
    function getViewport() {
      const center = map.getCenter?.();
      const zoom = map.getZoom?.();
      if (!center || !Number.isFinite(Number(zoom))) return null;
      return {center: {latitudeDeg: Number(center.lat), longitudeDeg: Number(center.lng)}, zoom: Number(zoom)};
    }
    function setViewport(viewport) {
      if (!viewport || !map.setView) return false;
      map.setView([Number(viewport.center.latitudeDeg), Number(viewport.center.longitudeDeg)], Number(viewport.zoom), {animate: false});
      return true;
    }
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
    function handleMapMoveStart() { if (!destroyed) cancelHeadingInteractions(); }
    function handleMapResize() { if (!destroyed) { cancelHeadingInteractions(); sync(presentationState || store.getState()); } }
    function handleZoomStart() { if (!destroyed) cancelHeadingInteractions(); }
    function handleZoomEnd() { if (!destroyed) sync(presentationState || store.getState()); }
    ensurePanes(); bindWheel(); map.on?.('click', handleMapClick); map.on?.('mousemove', handleMapMove); map.on?.('movestart', handleMapMoveStart); map.on?.('zoomstart', handleZoomStart); map.on?.('zoomend', handleZoomEnd); map.on?.('resize', handleMapResize);
    return {sync, getCameraLayerSnapshot, getCameraHeadingHandleSnapshot, getTargetLayerSnapshot, getViewport, setViewport, fitCamera, fitCameraFov, fitTarget, fitCameraAndTarget, setLabelVisibility, setCameraPlacementPreview(cameraDraft) { placementPreviewDraft = cameraDraft ? clone(cameraDraft) : null; renderCameraPlacementPreview(presentationState || store.getState()); }, clearCameraPlacementPreview, setTargetPlacementPreview(targetDraft) { targetPlacementPreviewDraft=targetDraft?clone(targetDraft):null; renderTargetPlacementPreview(); }, clearTargetPlacementPreview, cancelInteraction() { cancelHeadingInteractions(); store.cancelPreview(); clearCameraPlacementPreview(); clearTargetPlacementPreview(); store.setInteractionMode('navigate'); }, destroy() { if (destroyed) return; cancelHeadingInteractions(); destroyed = true; map.off?.('click', handleMapClick); map.off?.('mousemove', handleMapMove); map.off?.('movestart', handleMapMoveStart); map.off?.('zoomstart', handleZoomStart); map.off?.('zoomend', handleZoomEnd); map.off?.('resize', handleMapResize); wheelContainer?.removeEventListener?.('wheel', wheelZoom, {passive: false}); clearCameraPlacementPreview(); clearTargetPlacementPreview(); cameraLayers.forEach(record => { record.interaction?.destroy(); removeHeadingHandle(record); remove(record.group); }); targetLayers.forEach(record => { record.interaction?.destroy(); remove(record.group); }); cameraLayers.clear(); targetLayers.clear(); }};
  }
  return {DEFAULT_FILL_OPACITY, cameraFillOpacity, createMapController, createEntityMarkerInteraction, coverageBandRanges, CAMERA_COLORS, COVERAGE_COLORS, PANE_NAMES};
}));
