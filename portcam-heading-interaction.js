/* Small entity-independent heading gesture lifecycle. */
(function (root, factory) {
  const api = factory(root.PortCamCore || (typeof require === 'function' ? require('./portcam-core.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamHeadingInteraction = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  if (!Core) throw new Error('PortCamHeadingInteraction requires PortCamCore');

  const normalizeHeading = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Core.normalizeHeading(parsed) : null;
  };
  const pointValue = value => {
    if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))) return null;
    return {x: Number(value.x), y: Number(value.y)};
  };

  function headingFromPoints(center, pointer, minimumDistance = 6) {
    const origin = pointValue(center), target = pointValue(pointer);
    if (!origin || !target) return null;
    const dx = target.x - origin.x, dy = target.y - origin.y;
    if (Math.hypot(dx, dy) < minimumDistance) return null;
    return normalizeHeading(Core.r2d(Math.atan2(dx, -dy)));
  }

  function createHeadingInteraction(options = {}) {
    const element = options.element;
    if (!element || typeof element.addEventListener !== 'function') throw new Error('createHeadingInteraction requires an element');
    const documentObject = element.ownerDocument;
    const windowObject = options.window || documentObject?.defaultView || (typeof window !== 'undefined' ? window : null);
    const getPointerPoint = options.getPointerPoint || (event => ({x: event.clientX, y: event.clientY}));
    const minimumDistance = Number.isFinite(Number(options.minimumDistance)) ? Number(options.minimumDistance) : 6;
    const title = options.title || '拖曳調整方向';
    let drag = null;
    let panWasEnabled = null;
    let destroyed = false;

    function setClass(active) { element.classList?.toggle?.('is-dragging', Boolean(active)); }
    function readHeading() { return normalizeHeading(options.getHeading?.()) ?? 0; }
    function updateAccessibility(heading, active = false) {
      const value = normalizeHeading(heading) ?? 0;
      element.setAttribute?.('aria-label', options.ariaLabel || title);
      element.setAttribute?.('aria-valuenow', String(value));
      element.setAttribute?.('aria-valuetext', active ? `Heading ${value.toFixed(1)}°` : `${value.toFixed(1)}°`);
      element.setAttribute?.('data-heading', active ? `Heading ${value.toFixed(1)}°` : `${value.toFixed(1)}°`);
      element.setAttribute?.('title', active ? `Heading ${value.toFixed(1)}°` : title);
    }
    function stopEvent(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
    }
    function readPanState() {
      try { return options.getPanEnabled ? Boolean(options.getPanEnabled()) : null; } catch (_) { return null; }
    }
    function setPanEnabled(enabled) {
      try { options.setPanEnabled?.(Boolean(enabled)); } catch (_) { /* Map cleanup must continue. */ }
    }
    function restorePan() {
      if (panWasEnabled !== null) setPanEnabled(panWasEnabled);
      panWasEnabled = null;
    }
    function removeWindowListeners() { windowObject?.removeEventListener?.('blur', onWindowBlur); }
    function releaseCapture(pointerId) {
      try { element.releasePointerCapture?.(pointerId); } catch (_) { /* capture may already be released */ }
    }
    function cancelActive() {
      if (!drag) return false;
      const active = drag;
      drag = null;
      setClass(false);
      removeWindowListeners();
      options.cancelHeading?.(active.startHeading);
      releaseCapture(active.pointerId);
      restorePan();
      updateAccessibility(options.getHeading?.(), false);
      return true;
    }
    function commitActive() {
      if (!drag) return false;
      const active = drag;
      drag = null;
      setClass(false);
      removeWindowListeners();
      if (active.changed) options.commitHeading?.(active.lastHeading, active.startHeading);
      else options.cancelHeading?.(active.startHeading);
      releaseCapture(active.pointerId);
      restorePan();
      updateAccessibility(options.getHeading?.(), false);
      return true;
    }
    function onWindowBlur() { cancelActive(); }
    function onPointerDown(event) {
      if (destroyed || drag || options.canEdit?.() === false || event.isPrimary === false || (event.button != null && event.button !== 0)) return;
      stopEvent(event);
      options.cancelHeading?.();
      const startHeading = readHeading();
      drag = {pointerId: event.pointerId, startHeading, lastHeading: startHeading, changed: false, projectionKey: options.getProjectionKey?.()};
      panWasEnabled = readPanState();
      if (panWasEnabled !== null) setPanEnabled(false);
      setClass(true);
      element.focus?.({preventScroll: true});
      windowObject?.addEventListener?.('blur', onWindowBlur);
      try { element.setPointerCapture?.(event.pointerId); } catch (_) { /* synthetic events may not have active capture */ }
      updateAccessibility(startHeading, true);
      const next = headingFromPoints(options.getCenter?.(), getPointerPoint(event), minimumDistance);
      if (next !== null && next !== startHeading) {
        drag.lastHeading = next;
        drag.changed = true;
        options.previewHeading?.(next);
        updateAccessibility(next, true);
      }
    }
    function onPointerMove(event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      stopEvent(event);
      if (options.canEdit?.() === false || (drag.projectionKey !== undefined && drag.projectionKey !== options.getProjectionKey?.())) { cancelActive(); return; }
      const next = headingFromPoints(options.getCenter?.(), getPointerPoint(event), minimumDistance);
      if (next === null || next === drag.lastHeading) return;
      drag.lastHeading = next;
      drag.changed = normalizeHeading(next) !== normalizeHeading(drag.startHeading);
      options.previewHeading?.(next);
      updateAccessibility(next, true);
    }
    function onPointerUp(event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      stopEvent(event);
      if (event.type === 'pointercancel') cancelActive();
      else commitActive();
    }
    function onLostPointerCapture(event) { if (drag && drag.pointerId === event.pointerId) cancelActive(); }
    function onKeyDown(event) {
      if (destroyed || event.defaultPrevented) return;
      if (event.key === 'Escape' && drag) {
        stopEvent(event);
        cancelActive();
        return;
      }
      if (options.canEdit?.() === false) return;
      const current = readHeading();
      let next = null;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 359;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const step = event.shiftKey ? 10 : 1;
        next = normalizeHeading(current + (event.key === 'ArrowRight' ? step : -step));
      }
      if (next === null || next === current) return;
      stopEvent(event);
      options.cancelHeading?.();
      options.previewHeading?.(next);
      options.commitHeading?.(next, current);
      updateAccessibility(options.getHeading?.(), false);
    }
    function stopClick(event) { event.stopPropagation?.(); }

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    element.addEventListener('lostpointercapture', onLostPointerCapture);
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('click', stopClick);
    element.addEventListener('dblclick', stopClick);
    updateAccessibility(options.getHeading?.(), false);

    return {
      isDragging() { return drag !== null; },
      cancel: cancelActive,
      refresh(heading, editable) {
        element.setAttribute?.('aria-disabled', editable ? 'false' : 'true');
        updateAccessibility(heading, Boolean(drag));
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cancelActive();
        element.removeEventListener?.('pointerdown', onPointerDown);
        element.removeEventListener?.('pointermove', onPointerMove);
        element.removeEventListener?.('pointerup', onPointerUp);
        element.removeEventListener?.('pointercancel', onPointerUp);
        element.removeEventListener?.('lostpointercapture', onLostPointerCapture);
        element.removeEventListener?.('keydown', onKeyDown);
        element.removeEventListener?.('click', stopClick);
        element.removeEventListener?.('dblclick', stopClick);
      }
    };
  }

  return {headingFromPoints, createHeadingInteraction};
}));
