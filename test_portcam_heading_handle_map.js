const assert = require('node:assert/strict');
const test = require('node:test');

const {createProjectStore} = require('./portcam-store.js');
const {createMapController, PANE_NAMES} = require('./portcam-map.js');

class FakeElement {
  constructor(ownerDocument, tagName = 'div') {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {setProperty(name, value) { this[name] = value; }};
    this.classList = {toggle() {}};
    this.hidden = false;
    this.tabIndex = 0;
    this.clientHeight = 600;
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter(value => value !== child); child.parentNode = null; return child; }
  remove() { this.parentNode?.removeChild?.(this); }
  addEventListener(name, listener) { const list = this.listeners.get(name) || []; list.push(listener); this.listeners.set(name, list); }
  removeEventListener(name, listener) { this.listeners.set(name, (this.listeners.get(name) || []).filter(value => value !== listener)); }
  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    if (!Object.hasOwn(event, 'defaultPrevented')) event.defaultPrevented = false;
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener(event);
    return !event.defaultPrevented;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() {}
  getBoundingClientRect() { return {left: 0, top: 0}; }
}

class FakeDocument {
  constructor() { this.defaultView = new FakeElement(this, 'window'); }
  createElement(tagName) { return new FakeElement(this, tagName); }
}

function fakeLeaflet() {
  class Layer {
    addTo(parent) { parent.addLayer(this); return this; }
  }
  class Group extends Layer {
    constructor() { super(); this.layers = new Set(); }
    addLayer(layer) { this.layers.add(layer); return this; }
    removeLayer(layer) { this.layers.delete(layer); }
    bringToFront() {}
  }
  class Marker extends Layer {
    constructor(value, options = {}) {
      super();
      this.value = value;
      this.options = {...options};
      this.events = {};
      this.tooltip = {};
      this.dragging = options.draggable ? {
        _enabled: false,
        enabled() { return this._enabled; },
        enable() { this._enabled = true; },
        disable() { this._enabled = false; }
      } : undefined;
    }
    bindTooltip(content, options = {}) { this.tooltip = {content, options}; return this; }
    setTooltipContent(content) { this.tooltip.content = content; return this; }
    openTooltip() { this.tooltip.open = true; return this; }
    closeTooltip() { this.tooltip.open = false; return this; }
    on(name, handler) { this.events[name] = handler; return this; }
    off(name) { delete this.events[name]; return this; }
    setLatLng(value) { this.value = value; return this; }
    getLatLng() { return this.value; }
    setOpacity(value) { this.opacity = value; return this; }
    setIcon(icon) { this.options.icon = icon; return this; }
  }
  class Shape extends Layer {
    constructor(points, options = {}) { super(); this.points = points; this.options = options; }
    getBounds() { return {points: this.points}; }
  }
  return {
    latLng(a, b) { return typeof a === 'object' ? {lat: a.lat, lng: a.lng} : {lat: a, lng: b}; },
    point(x, y) { return {x, y}; },
    layerGroup() { return new Group(); },
    marker(value, options) { return new Marker(value, options); },
    divIcon(options) { return options; },
    polygon(points, options) { return new Shape(points, options); },
    polyline(points, options) { return new Shape(points, options); }
  };
}

function fakeMap(documentObject) {
  const panes = {};
  const layers = new Set();
  const events = {};
  const container = documentObject.createElement('div');
  container.clientHeight = 600;
  let zoom = 13;
  const map = {
    panes,
    layers,
    events,
    container,
    options: {minZoom: 10, maxZoom: 16},
    scrollWheelZoom: {disable() {}},
    dragging: {
      _enabled: true,
      enabled() { return this._enabled; },
      enable() { this._enabled = true; },
      disable() { this._enabled = false; }
    },
    addLayer(layer) { layers.add(layer); return this; },
    removeLayer(layer) { layers.delete(layer); },
    hasLayer(layer) { return layers.has(layer); },
    on(name, handler) { events[name] = handler; },
    off(name) { delete events[name]; },
    createPane(name) { return panes[name] = documentObject.createElement('div'); },
    getPane(name) { return panes[name]; },
    getContainer() { return container; },
    getSize() { return {x: 800, y: 600}; },
    getZoom() { return zoom; },
    setZoom(value) { zoom = value; },
    getMinZoom() { return 10; },
    getMaxZoom() { return 16; },
    latLngToContainerPoint(value) { return {x: 400 + (value.lng - 120.28) * 100000, y: 300 - (value.lat - 22.6) * 100000}; },
    containerPointToLatLng(value) { return {lat: 22.6 - value.y / 100000 + 300 / 100000, lng: 120.28 + (value.x - 400) / 100000}; },
    setView() {},
    fitBounds() {}
  };
  container.addEventListener = (name, handler) => { events[`container:${name}`] = handler; };
  container.removeEventListener = name => { delete events[`container:${name}`]; };
  return map;
}

function camera(extra = {}) {
  return {
    id: 'camera-a',
    name: 'Camera A',
    position: {latitudeDeg: 22.6, longitudeDeg: 120.28},
    heightM: 20,
    headingDeg: 90,
    tiltDownDeg: 20,
    sensorWidthMm: 7.2,
    sensorHeightMm: 4.05,
    widthPx: 2560,
    heightPx: 1440,
    focalLengthMm: 14,
    ...extra
  };
}

function event(type, values = {}) {
  return {type, ...values, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }};
}

function setup() {
  const documentObject = new FakeDocument();
  const map = fakeMap(documentObject);
  const store = createProjectStore({settings: {planningTargetHeightM: 2}, cameras: [camera()], targets: []}, {idFactory: () => 'generated'});
  const controller = createMapController({map, leaflet: fakeLeaflet(), store});
  store.subscribe(state => controller.sync(state));
  controller.sync(store.getState());
  return {documentObject, map, store, controller, handle: map.getPane(PANE_NAMES.headingHandle).children[0]};
}

test('focused Camera gets a stable screen-space heading handle with one preview and one commit', () => {
  const fixture = setup();
  const {store, map, controller, handle} = fixture;
  const before = store.getState();
  const beforeCamera = store.getCamera('camera-a', false);
  const beforeSnapshot = controller.getCameraHeadingHandleSnapshot('camera-a');
  assert.equal(beforeSnapshot.visible, true);
  assert.equal(beforeSnapshot.heading, '90');
  assert.equal(beforeSnapshot.ariaLabel, '拖曳調整方向');

  handle.dispatchEvent(event('pointerdown', {pointerId: 11, isPrimary: true, button: 0, clientX: 458, clientY: 300}));
  handle.dispatchEvent(event('pointermove', {pointerId: 11, clientX: 400, clientY: 242}));
  const preview = store.getState();
  assert.equal(preview.preview.kind, 'camera');
  assert.equal(store.getCamera('camera-a', false).headingDeg, 90);
  assert.equal(store.getCamera('camera-a', true).headingDeg, 0);
  assert.equal(preview.camerasById['camera-a'].revision, before.camerasById['camera-a'].revision);
  assert.equal(preview.history.length, before.history.length);
  assert.equal(preview.dirty, before.dirty);
  assert.equal(map.dragging.enabled(), false);
  assert.strictEqual(map.getPane(PANE_NAMES.headingHandle).children[0], handle);

  handle.dispatchEvent(event('pointerup', {pointerId: 11, clientX: 400, clientY: 242}));
  const committed = store.getState();
  assert.equal(committed.preview, null);
  assert.equal(committed.camerasById['camera-a'].headingDeg, 0);
  assert.equal(committed.camerasById['camera-a'].revision, before.camerasById['camera-a'].revision + 1);
  assert.equal(committed.history.length, before.history.length + 1);
  assert.equal(committed.dirty, true);
  assert.deepEqual(committed.camerasById['camera-a'].position, beforeCamera.position);
  assert.equal(map.dragging.enabled(), true);
  assert.strictEqual(map.getPane(PANE_NAMES.headingHandle).children[0], handle);
  assert.equal(controller.getCameraHeadingHandleSnapshot('camera-a').visible, true);

  store.undo();
  assert.equal(store.getCamera('camera-a', false).headingDeg, 90);
  store.redo();
  assert.equal(store.getCamera('camera-a', false).headingDeg, 0);
  controller.destroy();
});

test('heading handle remains editable for disabled Camera and hides for lock, mode, focus, or offscreen state', () => {
  const fixture = setup();
  const {store, map, controller} = fixture;
  store.patchCamera('camera-a', {enabled: false});
  assert.equal(controller.getCameraHeadingHandleSnapshot('camera-a').visible, true);
  assert.equal(controller.getCameraHeadingHandleSnapshot('camera-a').ariaDisabled, 'false');

  store.patchCamera('camera-a', {locked: true});
  assert.equal(controller.getCameraHeadingHandleSnapshot('camera-a').visible, false);
  store.patchCamera('camera-a', {locked: false});
  assert.equal(controller.getCameraHeadingHandleSnapshot('camera-a').visible, true);

  store.setInteractionMode('place-target');
  assert.equal(controller.getCameraHeadingHandleSnapshot('camera-a').visible, false);
  store.setInteractionMode('navigate');
  assert.equal(controller.getCameraHeadingHandleSnapshot('camera-a').visible, true);

  store.clearFocusedEntity();
  assert.equal(controller.getCameraHeadingHandleSnapshot('camera-a').visible, false);
  store.setFocusedEntity('camera', 'camera-a');
  assert.equal(controller.getCameraHeadingHandleSnapshot('camera-a').visible, true);

  map.events.movestart();
  assert.equal(controller.getCameraHeadingHandleSnapshot('camera-a').visible, true);
  controller.destroy();
});

test('no-change pointerup and Escape leave Camera revision/history unchanged', () => {
  const fixture = setup();
  const {store, controller, handle, map} = fixture;
  const before = store.getState();
  handle.dispatchEvent(event('pointerdown', {pointerId: 12, isPrimary: true, button: 0, clientX: 458, clientY: 300}));
  handle.dispatchEvent(event('pointerup', {pointerId: 12, clientX: 458, clientY: 300}));
  assert.equal(store.getState().history.length, before.history.length);
  assert.equal(store.getCamera('camera-a', false).revision, before.camerasById['camera-a'].revision);
  assert.equal(store.getState().preview, null);

  const stable = store.getState();
  handle.dispatchEvent(event('pointerdown', {pointerId: 13, isPrimary: true, button: 0, clientX: 458, clientY: 300}));
  handle.dispatchEvent(event('pointermove', {pointerId: 13, clientX: 400, clientY: 242}));
  const escape = event('keydown', {key: 'Escape'});
  handle.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(store.getCamera('camera-a', false).headingDeg, stable.camerasById['camera-a'].headingDeg);
  assert.equal(store.getState().history.length, stable.history.length);
  assert.equal(store.getState().preview, null);
  assert.equal(map.dragging.enabled(), true);
  assert.equal(controller.getCameraHeadingHandleSnapshot('camera-a').visible, true);
  controller.destroy();
});
