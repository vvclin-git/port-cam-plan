const assert = require('node:assert/strict');
const test = require('node:test');

const Core = require('./portcam-core.js');
const Heading = require('./portcam-heading-interaction.js');

class FakeEventTarget {
  constructor(ownerDocument = null) {
    this.ownerDocument = ownerDocument;
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {setProperty(name, value) { this[name] = value; }};
    this.classNames = new Set();
    this.classList = {
      toggle: (name, force) => {
        const next = force === undefined ? !this.classNames.has(name) : Boolean(force);
        if (next) this.classNames.add(name); else this.classNames.delete(name);
        return next;
      },
      contains: name => this.classNames.has(name)
    };
    this.focusCount = 0;
    this.captured = new Set();
    this.released = [];
  }
  addEventListener(name, listener) {
    const values = this.listeners.get(name) || [];
    values.push(listener);
    this.listeners.set(name, values);
  }
  removeEventListener(name, listener) {
    const values = this.listeners.get(name) || [];
    this.listeners.set(name, values.filter(value => value !== listener));
  }
  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    if (!Object.hasOwn(event, 'defaultPrevented')) event.defaultPrevented = false;
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener(event);
    return !event.defaultPrevented;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setPointerCapture(pointerId) { this.captured.add(pointerId); }
  releasePointerCapture(pointerId) { this.captured.delete(pointerId); this.released.push(pointerId); }
  focus() { this.focusCount += 1; }
}

function event(type, values = {}) {
  return {
    type,
    ...values,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; }
  };
}

function createAdapter({kind = 'camera', heading = 359} = {}) {
  const windowObject = new FakeEventTarget();
  const documentObject = {defaultView: windowObject};
  const element = new FakeEventTarget(documentObject);
  const entity = {kind, heading};
  const state = {preview: null, commits: [], cancels: [], panEnabled: true};
  const interaction = Heading.createHeadingInteraction({
    element,
    window: windowObject,
    getCenter: () => ({x: 100, y: 100}),
    getPointerPoint: current => ({x: current.clientX, y: current.clientY}),
    getHeading: () => entity.heading,
    getProjectionKey: () => 'static-projection',
    canEdit: () => true,
    previewHeading: value => { state.preview = value; },
    commitHeading: (value, start) => {
      state.commits.push({kind: entity.kind, value, start});
      entity.heading = value;
      state.preview = null;
    },
    cancelHeading: () => {
      if (state.preview !== null) state.cancels.push(state.preview);
      state.preview = null;
    },
    getPanEnabled: () => state.panEnabled,
    setPanEnabled: value => { state.panEnabled = value; }
  });
  return {windowObject, element, entity, state, interaction};
}

test('headingFromPoints uses north-up clockwise degrees and ignores the hit center', () => {
  assert.equal(Heading.headingFromPoints({x: 0, y: 0}, {x: 0, y: -10}), 0);
  assert.equal(Heading.headingFromPoints({x: 0, y: 0}, {x: 10, y: 0}), 90);
  assert.equal(Heading.headingFromPoints({x: 0, y: 0}, {x: 0, y: 10}), 180);
  assert.equal(Heading.headingFromPoints({x: 0, y: 0}, {x: -10, y: 0}), 270);
  assert.equal(Heading.headingFromPoints({x: 0, y: 0}, {x: 1, y: 1}, 6), null);
});

test('camera adapter drag previews, wraps heading, restores pan, and commits exactly once', () => {
  const adapter = createAdapter({heading: 359});
  adapter.element.dispatchEvent(event('pointerdown', {pointerId: 7, isPrimary: true, button: 0, clientX: 99, clientY: 42}));
  assert.equal(adapter.interaction.isDragging(), true);
  assert.equal(adapter.state.panEnabled, false);
  assert.equal(adapter.element.captured.has(7), true);
  adapter.element.dispatchEvent(event('pointermove', {pointerId: 7, clientX: 101, clientY: 42}));
  assert.ok(adapter.state.preview >= 0 && adapter.state.preview < 360);
  adapter.element.dispatchEvent(event('pointerup', {pointerId: 7, clientX: 101, clientY: 42}));
  assert.equal(adapter.interaction.isDragging(), false);
  assert.equal(adapter.state.commits.length, 1);
  assert.equal(adapter.state.commits[0].start, 359);
  assert.ok(adapter.entity.heading < 5 || adapter.entity.heading > 355);
  assert.equal(adapter.state.preview, null);
  assert.equal(adapter.state.panEnabled, true);
  assert.deepEqual(adapter.element.released, [7]);
  assert.equal(adapter.element.getAttribute('aria-label'), '拖曳調整方向');
  assert.equal(adapter.element.getAttribute('aria-valuenow'), String(adapter.entity.heading));
});

test('Escape, pointercancel, lost capture, and blur cancel without history-equivalent commit', () => {
  const adapter = createAdapter({heading: 30});
  adapter.element.dispatchEvent(event('pointerdown', {pointerId: 1, isPrimary: true, button: 0, clientX: 129, clientY: 50}));
  adapter.element.dispatchEvent(event('pointermove', {pointerId: 1, clientX: 100, clientY: 42}));
  assert.notEqual(adapter.state.preview, null);
  const escape = event('keydown', {key: 'Escape'});
  adapter.element.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(adapter.entity.heading, 30);
  assert.equal(adapter.state.commits.length, 0);
  assert.equal(adapter.state.cancels.length, 1);
  assert.equal(adapter.state.panEnabled, true);

  adapter.element.dispatchEvent(event('pointerdown', {pointerId: 2, isPrimary: true, button: 0, clientX: 129, clientY: 50}));
  adapter.element.dispatchEvent(event('pointermove', {pointerId: 2, clientX: 100, clientY: 42}));
  adapter.element.dispatchEvent(event('pointercancel', {pointerId: 2}));
  assert.equal(adapter.entity.heading, 30);
  assert.equal(adapter.state.commits.length, 0);

  adapter.element.dispatchEvent(event('pointerdown', {pointerId: 3, isPrimary: true, button: 0, clientX: 129, clientY: 50}));
  adapter.element.dispatchEvent(event('pointermove', {pointerId: 3, clientX: 100, clientY: 42}));
  adapter.element.dispatchEvent(event('lostpointercapture', {pointerId: 3}));
  assert.equal(adapter.entity.heading, 30);
  assert.equal(adapter.state.commits.length, 0);

  adapter.element.dispatchEvent(event('pointerdown', {pointerId: 4, isPrimary: true, button: 0, clientX: 129, clientY: 50}));
  adapter.element.dispatchEvent(event('pointermove', {pointerId: 4, clientX: 100, clientY: 42}));
  adapter.windowObject.dispatchEvent(event('blur'));
  assert.equal(adapter.entity.heading, 30);
  assert.equal(adapter.state.commits.length, 0);
  assert.equal(adapter.state.panEnabled, true);

  adapter.element.dispatchEvent(event('keydown', {key: 'Escape'}));
  assert.equal(adapter.state.commits.length, 0);
});

test('keyboard heading edits retain existing 1 degree and Shift 10 degree semantics', () => {
  const adapter = createAdapter({heading: 359});
  adapter.element.dispatchEvent(event('keydown', {key: 'ArrowRight'}));
  assert.equal(adapter.entity.heading, 0);
  adapter.element.dispatchEvent(event('keydown', {key: 'ArrowLeft', shiftKey: true}));
  assert.equal(adapter.entity.heading, 350);
  adapter.element.dispatchEvent(event('keydown', {key: 'Home'}));
  assert.equal(adapter.entity.heading, 0);
  adapter.element.dispatchEvent(event('keydown', {key: 'End'}));
  assert.equal(adapter.entity.heading, 359);
  assert.equal(adapter.state.commits.length, 4);
});

test('the same lifecycle accepts a Target adapter without any Camera-specific state', () => {
  const adapter = createAdapter({kind: 'target', heading: 90});
  adapter.element.dispatchEvent(event('pointerdown', {pointerId: 9, isPrimary: true, button: 0, clientX: 158, clientY: 100}));
  adapter.element.dispatchEvent(event('pointermove', {pointerId: 9, clientX: 100, clientY: 158}));
  adapter.element.dispatchEvent(event('pointerup', {pointerId: 9, clientX: 100, clientY: 158}));
  assert.equal(adapter.state.commits.length, 1);
  assert.equal(adapter.state.commits[0].kind, 'target');
  assert.equal(adapter.entity.heading, 180);
  adapter.interaction.destroy();
});

test('projection changes cancel the active gesture before a map layout move can commit', () => {
  const adapter = createAdapter({heading: 0});
  let projectionKey = 'before';
  adapter.interaction.destroy();
  const recreated = Heading.createHeadingInteraction({
    element: adapter.element,
    window: adapter.windowObject,
    getCenter: () => ({x: 100, y: 100}),
    getPointerPoint: current => ({x: current.clientX, y: current.clientY}),
    getHeading: () => adapter.entity.heading,
    getProjectionKey: () => projectionKey,
    canEdit: () => true,
    previewHeading: value => { adapter.state.preview = value; },
    commitHeading: value => { adapter.state.commits.push(value); adapter.entity.heading = value; },
    cancelHeading: () => { adapter.state.preview = null; adapter.state.cancels.push('projection'); },
    getPanEnabled: () => adapter.state.panEnabled,
    setPanEnabled: value => { adapter.state.panEnabled = value; }
  });
  adapter.element.dispatchEvent(event('pointerdown', {pointerId: 10, isPrimary: true, button: 0, clientX: 100, clientY: 42}));
  adapter.element.dispatchEvent(event('pointermove', {pointerId: 10, clientX: 158, clientY: 100}));
  projectionKey = 'after';
  adapter.element.dispatchEvent(event('pointermove', {pointerId: 10, clientX: 158, clientY: 100}));
  assert.equal(adapter.state.commits.length, 0);
  assert.equal(adapter.state.preview, null);
  assert.equal(adapter.state.panEnabled, true);
  recreated.destroy();
});

assert.equal(Core.normalizeHeading(360), 0);
