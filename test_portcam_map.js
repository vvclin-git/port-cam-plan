const test = require('node:test');
const assert = require('node:assert/strict');
const {createProjectStore} = require('./portcam-store.js');
const {createMapController} = require('./portcam-map.js');

function fakeLeaflet() {
  class Layer { addTo(parent) { parent.addLayer(this); return this; } }
  class Group extends Layer { constructor() { super(); this.layers = new Set(); } addLayer(layer) { this.layers.add(layer); return this; } removeLayer(layer) { this.layers.delete(layer); } bringToFront() {} }
  class Marker extends Layer { constructor(value, options={}) { super(); this.value=value; this.events={}; this.options={...options}; this.tooltip={}; this.tooltipOpen=false; this.opacity=1; this.dragging={enabled:false,enable:()=>{this.dragging.enabled=true;},disable:()=>{this.dragging.enabled=false;}}; } bindTooltip(content, options={}){ this.tooltip={content, options}; return this; } setTooltipContent(content){this.tooltip.content=content; return this;} openTooltip(){this.tooltipOpen=true; return this;} closeTooltip(){this.tooltipOpen=false; return this;} on(name, fn){this.events[name]=fn; return this;} off(name){delete this.events[name]; return this;} setLatLng(value){this.value=value; return this;} getLatLng(){return this.value;} setOpacity(value){this.opacity=value; return this;} setIcon(icon){this.options.icon=icon; return this;} }
  class Shape extends Layer { constructor(points, options={}) { super(); this.points=points; this.options=options; } getBounds(){return {points:this.points};} }
  return {latLng(a,b) { return typeof a === 'object' ? {lat:a.lat, lng:a.lng} : {lat:a,lng:b}; }, layerGroup(){return new Group();}, marker(v, options){return new Marker(v, options);}, divIcon(options){return options;}, circleMarker(v, options){return new Marker(v, options);}, polygon(v, options){return new Shape(v, options);}, polyline(v, options){return new Shape(v, options);} };
}
function fakeMap() { const layers=new Set(), events={}, panes={}, wheelListeners=new Set(), container={clientHeight:600, addEventListener(name, fn){if(name==='wheel') wheelListeners.add(fn);}, removeEventListener(name, fn){if(name==='wheel') wheelListeners.delete(fn);}, dispatchWheel(event){wheelListeners.forEach(fn=>fn(event));}}; let zoom=13; return {layers, events, panes, container, wheelListeners, options:{minZoom:10,maxZoom:16}, scrollWheelZoom:{disabled:false,disable(){this.disabled=true;}}, addLayer(layer){layers.add(layer); return this;}, removeLayer(layer){layers.delete(layer);}, hasLayer(layer){return layers.has(layer);}, on(name, fn){events[name]=fn;}, off(name){delete events[name];}, createPane(name){return panes[name]={style:{}};}, getPane(name){return panes[name];}, getContainer(){return container;}, getSize(){return {y:600};}, getZoom(){return zoom;}, setZoom(value){zoom=value;}, getMinZoom(){return 10;}, getMaxZoom(){return 16;}, setView(){}, fitBounds(){}}; }
function markerFor(map, id) { for (const group of map.layers) for (const layer of group.layers || []) if (layer.__portcamEntityId === id) return layer; return null; }
const cam = (id, lat, extra={}) => ({id, name:id, position:{latitudeDeg:lat,longitudeDeg:120.28},heightM:20,headingDeg:90,tiltDownDeg:20,sensorWidthMm:7.2,sensorHeightMm:4.05,widthPx:2560,heightPx:1440,focalLengthMm:14,...extra});
const target = (id, lat, extra={}) => ({id, name:id, position:{latitudeDeg:lat,longitudeDeg:120.281},lengthM:8,widthM:2.5,heightM:3,headingDeg:0,...extra});

test('projection keeps three independent camera groups and undo restores marker geometry', () => {
  const store = createProjectStore({settings:{planningTargetHeightM:2}, cameras:[cam('a',22.60),cam('b',22.61),cam('c',22.62)], targets:[]}, {idFactory:()=> 'generated'});
  const map=fakeMap(), controller=createMapController({map,leaflet:fakeLeaflet(),store}); const render=state=>controller.sync(state); store.subscribe(render); render(store.getState());
  assert.equal(controller.getCameraLayerSnapshot('a').envelopeLayerCount, 1); assert.equal(controller.getCameraLayerSnapshot('b').bandLayerCount, 0);
  store.patchCamera('a',{position:{latitudeDeg:22.70,longitudeDeg:120.28}},'move'); assert.equal(controller.getCameraLayerSnapshot('a').markerPosition.lat,22.70);
  store.undo(); assert.equal(controller.getCameraLayerSnapshot('a').markerPosition.lat,22.60);
  store.patchCamera('b',{visible:false}); assert.equal(controller.getCameraLayerSnapshot('b').visible,false);
  const draft = store.addCamera({...cam('draft', 22.63), lifecycle:'draft-unplaced'}); assert.equal(controller.getCameraLayerSnapshot(draft), null);
  store.patchCamera(draft, {lifecycle:'placed', position:{latitudeDeg:22.631,longitudeDeg:120.28}}); assert.equal(controller.getCameraLayerSnapshot(draft).envelopeLayerCount, 1);
  controller.destroy(); assert.equal(map.events.click, undefined);
});

test('Camera and Target share one drag preview/commit contract and map projections', () => {
  const store = createProjectStore({settings:{planningTargetHeightM:2}, cameras:[cam('a',22.60)], targets:[target('t',22.601)]}, {idFactory:()=> 'generated'});
  const map=fakeMap(), controller=createMapController({map,leaflet:fakeLeaflet(),store}); store.subscribe(state=>controller.sync(state)); controller.sync(store.getState());
  const cameraMarker = markerFor(map, 'a'), targetMarker = markerFor(map, 't');
  assert.equal(cameraMarker.options.bubblingMouseEvents, false); assert.equal(targetMarker.options.bubblingMouseEvents, false);
  assert.equal(targetMarker.options.draggable, true); assert.equal(controller.getTargetLayerSnapshot('t').markerType, 'Marker'); assert.equal(controller.getTargetLayerSnapshot('t').linePresent, true);
  const before = store.getState();
  targetMarker.events.dragstart(); targetMarker.setLatLng({lat:22.605,lng:120.285}); targetMarker.events.drag({target:targetMarker});
  let preview = store.getState(); assert.equal(preview.preview.kind, 'target'); assert.equal(preview.targetsById.t.revision, before.targetsById.t.revision); assert.equal(preview.history.length, before.history.length); assert.equal(preview.dirty, before.dirty);
  targetMarker.events.dragend();
  const committed = store.getState(); assert.equal(committed.preview, null); assert.equal(committed.targetsById.t.revision, before.targetsById.t.revision + 1); assert.equal(committed.history.length, before.history.length + 1); assert.equal(controller.getTargetLayerSnapshot('t').markerPosition.lat, 22.605);
  store.undo(); assert.equal(controller.getTargetLayerSnapshot('t').markerPosition.lat, 22.601); store.redo(); assert.equal(controller.getTargetLayerSnapshot('t').markerPosition.lat, 22.605);
  const fov = map.layers.values().next().value.layers; const geometry = [...fov].filter(layer => layer.options?.pane === 'portcam-analysis-pane'); assert.ok(geometry.length > 0); assert.ok(geometry.every(layer => layer.options.interactive === false));
  store.patchTarget('t', {locked:true}); assert.equal(targetMarker.options.draggable, false); store.patchTarget('t', {locked:false, visible:false}); assert.equal(targetMarker.options.draggable, false); store.patchTarget('t', {visible:true}); store.selectTarget(null); assert.equal(targetMarker.options.draggable, false);
  controller.destroy();
});

test('wheel zoom normalizes delta modes, enforces cooldown/bounds, preserves Ctrl, and cleans up', () => {
  const store = createProjectStore({settings:{planningTargetHeightM:2}, cameras:[cam('a',22.60)], targets:[]}, {idFactory:()=> 'generated'});
  const map=fakeMap(), controller=createMapController({map,leaflet:fakeLeaflet(),store});
  const event = (deltaY, deltaMode, timeStamp, ctrlKey=false) => { let prevented=false; map.container.dispatchWheel({deltaY, deltaMode, timeStamp, ctrlKey, preventDefault(){prevented=true;}}); return prevented; };
  assert.equal(map.scrollWheelZoom.disabled, true); assert.equal(event(100,0,10), true); assert.equal(map.getZoom(),12); assert.equal(event(100,0,100), true); assert.equal(map.getZoom(),12); assert.equal(event(100,0,200), true); assert.equal(map.getZoom(),11);
  assert.equal(event(-1,1,300), true); assert.equal(map.getZoom(),12); assert.equal(event(-1,2,500), true); assert.equal(map.getZoom(),13); assert.equal(event(100,0,600,true), false); assert.equal(map.getZoom(),13);
  controller.destroy(); assert.equal(map.wheelListeners.size,0); map.container.dispatchWheel({deltaY:100,deltaMode:0,timeStamp:800,preventDefault(){throw new Error('destroyed handler');}}); const recreated=createMapController({map,leaflet:fakeLeaflet(),store}); assert.equal(map.wheelListeners.size,1); recreated.destroy();
});
