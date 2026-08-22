const test = require('node:test');
const assert = require('node:assert/strict');
const {createProjectStore} = require('./portcam-store.js');
const {createMapController, coverageBandRanges} = require('./portcam-map.js');

function fakeLeaflet() {
  class Layer { addTo(parent) { parent.addLayer(this); return this; } }
  class Group extends Layer { constructor() { super(); this.layers = new Set(); } addLayer(layer) { this.layers.add(layer); return this; } removeLayer(layer) { this.layers.delete(layer); } bringToFront() {} }
  class Marker extends Layer { constructor(value, options={}) { super(); this.value=value; this.events={}; this.options={...options}; this.tooltip={}; this.tooltipOpen=false; this.opacity=1; this.setIconCalls=0; this.dragging={enabled:false,enable:()=>{this.dragging.enabled=true;},disable:()=>{this.dragging.enabled=false;}}; } bindTooltip(content, options={}){ this.tooltip={content, options}; return this; } setTooltipContent(content){this.tooltip.content=content; return this;} openTooltip(){this.tooltipOpen=true; return this;} closeTooltip(){this.tooltipOpen=false; return this;} on(name, fn){this.events[name]=fn; return this;} off(name){delete this.events[name]; return this;} setLatLng(value){this.value=value; return this;} getLatLng(){return this.value;} setOpacity(value){this.opacity=value; return this;} setIcon(icon){this.setIconCalls++; this.options.icon=icon; return this;} }
  class Shape extends Layer { constructor(points, options={}) { super(); this.points=points; this.options=options; } getBounds(){return {points:this.points};} }
  return {latLng(a,b) { return typeof a === 'object' ? {lat:a.lat, lng:a.lng} : {lat:a,lng:b}; }, layerGroup(){return new Group();}, marker(v, options){return new Marker(v, options);}, divIcon(options){return options;}, circleMarker(v, options){return new Marker(v, options);}, polygon(v, options){return new Shape(v, options);}, polyline(v, options){return new Shape(v, options);} };
}
function fakeMap() { const layers=new Set(), events={}, panes={}, wheelListeners=new Set(), container={clientHeight:600, addEventListener(name, fn){if(name==='wheel') wheelListeners.add(fn);}, removeEventListener(name, fn){if(name==='wheel') wheelListeners.delete(fn);}, dispatchWheel(event){wheelListeners.forEach(fn=>fn(event));}}; let zoom=13; return {layers, events, panes, container, wheelListeners, options:{minZoom:10,maxZoom:16}, scrollWheelZoom:{disabled:false,disable(){this.disabled=true;}}, addLayer(layer){layers.add(layer); return this;}, removeLayer(layer){layers.delete(layer);}, hasLayer(layer){return layers.has(layer);}, on(name, fn){events[name]=fn;}, off(name){delete events[name];}, createPane(name){return panes[name]={style:{}};}, getPane(name){return panes[name];}, getContainer(){return container;}, getSize(){return {y:600};}, getZoom(){return zoom;}, setZoom(value){zoom=value;}, getMinZoom(){return 10;}, getMaxZoom(){return 16;}, setView(){}, fitBounds(){}}; }
function markerFor(map, id) { for (const group of map.layers) for (const layer of group.layers || []) if (layer.__portcamEntityId === id) return layer; return null; }
function analysisLayersFor(map, id) { for (const group of map.layers) { if ([...(group.layers || [])].some(layer => layer.__portcamEntityId === id)) return [...group.layers].filter(layer => layer.options?.pane === 'portcam-analysis-pane'); } return []; }
const cam = (id, lat, extra={}) => ({id, name:id, position:{latitudeDeg:lat,longitudeDeg:120.28},heightM:20,headingDeg:90,tiltDownDeg:20,sensorWidthMm:7.2,sensorHeightMm:4.05,widthPx:2560,heightPx:1440,focalLengthMm:14,...extra});
const target = (id, lat, extra={}) => ({id, name:id, position:{latitudeDeg:lat,longitudeDeg:120.281},lengthM:8,widthM:2.5,heightM:3,headingDeg:0,...extra});

test('projection keeps three independent camera groups and undo restores marker geometry', () => {
  const store = createProjectStore({settings:{planningTargetHeightM:2}, cameras:[cam('a',22.60),cam('b',22.61),cam('c',22.62)], targets:[]}, {idFactory:()=> 'generated'});
  const map=fakeMap(), controller=createMapController({map,leaflet:fakeLeaflet(),store}); const render=state=>controller.sync(state); store.subscribe(render); render(store.getState());
  assert.equal(controller.getCameraLayerSnapshot('a').envelopeLayerCount, 1); assert.ok(controller.getCameraLayerSnapshot('a').bandLayerCount > 0); assert.ok(controller.getCameraLayerSnapshot('b').bandLayerCount > 0);
  store.patchCamera('a',{position:{latitudeDeg:22.70,longitudeDeg:120.28}},'move'); assert.equal(controller.getCameraLayerSnapshot('a').markerPosition.lat,22.70);
  store.undo(); assert.equal(controller.getCameraLayerSnapshot('a').markerPosition.lat,22.60);
  store.patchCamera('b',{visible:false}); assert.equal(controller.getCameraLayerSnapshot('b').visible,false);
  const draft = store.addCamera({...cam('draft', 22.63), lifecycle:'draft-unplaced'}); assert.equal(controller.getCameraLayerSnapshot(draft), null);
  store.patchCamera(draft, {lifecycle:'placed', position:{latitudeDeg:22.631,longitudeDeg:120.28}}); assert.equal(controller.getCameraLayerSnapshot(draft).envelopeLayerCount, 1);
  controller.destroy(); assert.equal(map.events.click, undefined);
});

test('Coverage and Camera colors are mutually exclusive for every eligible Camera', () => {
  const store = createProjectStore({settings:{planningTargetHeightM:2}, cameras:[cam('a',22.60,{tiltDownDeg:5}),cam('b',22.61,{tiltDownDeg:5}),cam('disabled',22.62,{enabled:false}),cam('hidden',22.63,{visible:false}),cam('draft',22.64,{lifecycle:'draft-unplaced'}),cam('unlocated',22.65,{position:null})], targets:[]}, {idFactory:()=> 'generated'});
  const map=fakeMap(), controller=createMapController({map,leaflet:fakeLeaflet(),store}); store.subscribe(state=>controller.sync(state)); controller.sync(store.getState());
  const ranges = coverageBandRanges(store.getCamera('a'), store.getState().settings);
  assert.equal(ranges.length, 4);
  assert.ok(ranges.every(range => range.innerM >= 0 && range.outerM <= 30000 && range.outerM > range.innerM));
  assert.deepEqual(ranges.map(range => range.key), ['robust','usable','difficult','notRecommended']);
  assert.equal(controller.getCameraLayerSnapshot('a').bandLayerCount, 4);
  assert.equal(controller.getCameraLayerSnapshot('b').bandLayerCount, 4);
  assert.equal(controller.getCameraLayerSnapshot('disabled').bandLayerCount, 0);
  assert.equal(controller.getCameraLayerSnapshot('disabled').envelopeLayerCount, 1);
  assert.equal(controller.getCameraLayerSnapshot('hidden'), null);
  assert.equal(controller.getCameraLayerSnapshot('draft'), null);
  assert.equal(controller.getCameraLayerSnapshot('unlocated'), null);
  const coverageEnvelope = analysisLayersFor(map, 'a').find(layer => layer.options?.fillOpacity === 0);
  assert.equal(coverageEnvelope.options.color, '#566273');
  assert.equal(coverageEnvelope.options.fillColor, '#566273');
  store.setFovColorMode('camera');
  assert.equal(controller.getCameraLayerSnapshot('a').bandLayerCount, 0);
  assert.equal(controller.getCameraLayerSnapshot('b').bandLayerCount, 0);
  assert.equal(controller.getCameraLayerSnapshot('disabled').bandLayerCount, 0);
  const cameraModeEnvelope = analysisLayersFor(map, 'a').find(layer => layer.options?.fillOpacity > 0);
  assert.equal(cameraModeEnvelope.options.color, '#2563eb');
  assert.equal(cameraModeEnvelope.options.fillColor, '#2563eb');
  store.setFovColorMode('bad-value');
  assert.equal(store.getState().uiState.fovColorMode, 'coverage');
  assert.equal(controller.getCameraLayerSnapshot('a').bandLayerCount, 4);
  assert.equal(controller.getCameraLayerSnapshot('b').bandLayerCount, 4);
  controller.destroy();
});

test('Camera and Target share one drag preview/commit contract and map projections', () => {
  const store = createProjectStore({settings:{planningTargetHeightM:2}, cameras:[cam('a',22.60)], targets:[target('t',22.601)]}, {idFactory:()=> 'generated'});
  store.selectTarget('t');
  const map=fakeMap(), controller=createMapController({map,leaflet:fakeLeaflet(),store}); store.subscribe(state=>controller.sync(state)); controller.sync(store.getState());
  const cameraMarker = markerFor(map, 'a'), targetMarker = markerFor(map, 't');
  assert.equal(cameraMarker.options.bubblingMouseEvents, false); assert.equal(targetMarker.options.bubblingMouseEvents, false);
  assert.equal(targetMarker.options.draggable, true); assert.equal(controller.getTargetLayerSnapshot('t').markerType, 'Marker'); assert.equal(controller.getTargetLayerSnapshot('t').linePresent, true);
  const before = store.getState(), iconCallsBeforeDrag = targetMarker.setIconCalls;
  targetMarker.events.dragstart(); targetMarker.setLatLng({lat:22.603,lng:120.283}); targetMarker.events.drag({target:targetMarker}); targetMarker.setLatLng({lat:22.605,lng:120.285}); targetMarker.events.drag({target:targetMarker});
  let preview = store.getState(); assert.equal(preview.preview.kind, 'target'); assert.equal(preview.targetsById.t.revision, before.targetsById.t.revision); assert.equal(preview.history.length, before.history.length); assert.equal(preview.dirty, before.dirty); assert.equal(targetMarker.setIconCalls, iconCallsBeforeDrag);
  targetMarker.events.dragend();
  const committed = store.getState(); assert.equal(committed.preview, null); assert.equal(committed.targetsById.t.revision, before.targetsById.t.revision + 1); assert.equal(committed.history.length, before.history.length + 1); assert.equal(targetMarker.setIconCalls, iconCallsBeforeDrag); assert.equal(controller.getTargetLayerSnapshot('t').markerPosition.lat, 22.605);
  store.undo(); assert.equal(controller.getTargetLayerSnapshot('t').markerPosition.lat, 22.601); store.redo(); assert.equal(controller.getTargetLayerSnapshot('t').markerPosition.lat, 22.605);
  const fov = map.layers.values().next().value.layers; const geometry = [...fov].filter(layer => layer.options?.pane === 'portcam-analysis-pane'); assert.ok(geometry.length > 0); assert.ok(geometry.every(layer => layer.options.interactive === false));
  const iconCallsBeforeStyleChange = targetMarker.setIconCalls;
  store.patchTarget('t', {locked:true}); assert.equal(targetMarker.options.draggable, false); assert.equal(targetMarker.setIconCalls, iconCallsBeforeStyleChange + 1);
  store.patchTarget('t', {locked:false}); assert.equal(targetMarker.setIconCalls, iconCallsBeforeStyleChange + 2);
  store.patchTarget('t', {visible:false}); assert.equal(targetMarker.options.draggable, false); assert.equal(targetMarker.setIconCalls, iconCallsBeforeStyleChange + 2);
  store.patchTarget('t', {visible:true, enabled:false}); assert.equal(targetMarker.setIconCalls, iconCallsBeforeStyleChange + 3);
  store.selectTarget(null); assert.equal(targetMarker.options.draggable, false); assert.equal(targetMarker.setIconCalls, iconCallsBeforeStyleChange + 4);
  controller.destroy();
});

test('focusedEntity controls marker drag and FOV emphasis independently from Active and Current selections', () => {
  const store = createProjectStore({settings:{planningTargetHeightM:2}, cameras:[cam('a',22.60),cam('b',22.61)], targets:[target('t',22.601)]}, {idFactory:()=> 'generated'});
  const map = fakeMap(), controller = createMapController({map,leaflet:fakeLeaflet(),store}); store.subscribe(state => controller.sync(state)); controller.sync(store.getState());
  const cameraA = markerFor(map, 'a'), cameraB = markerFor(map, 'b'), targetMarker = markerFor(map, 't');
  store.clearFocusedEntity();
  assert.equal(cameraA.options.draggable, false); assert.equal(cameraB.options.draggable, false); assert.equal(targetMarker.options.draggable, false);
  assert.ok(controller.getCameraLayerSnapshot('a').bandLayerCount > 0); assert.equal(controller.getCameraLayerSnapshot('a').bandLayerCount, controller.getCameraLayerSnapshot('b').bandLayerCount);
  store.setFocusedEntity('camera', 'b'); assert.equal(cameraA.options.draggable, false); assert.equal(cameraB.options.draggable, true);
  store.setFocusedEntity('target', 't'); assert.equal(targetMarker.options.draggable, true); assert.equal(store.getState().uiState.selectedCameraId, 'b'); assert.equal(store.getState().uiState.selectedTargetId, 't');
  store.clearFocusedEntity(); assert.equal(targetMarker.options.draggable, false); assert.equal(controller.getTargetLayerSnapshot('t').linePresent, true);
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

test('Camera placement preview is temporary, follows FOV mode, and cleans up map move events', () => {
  const store = createProjectStore({settings:{planningTargetHeightM:2}, cameras:[cam('a',22.60)], targets:[]}, {idFactory:()=> 'generated'});
  const map = fakeMap(), moves = [], clicks = [];
  const controller = createMapController({map, leaflet:fakeLeaflet(), store, onMapMove:(latlng, originalEvent)=>moves.push({latlng, originalEvent}), onMapClick:(latlng, originalEvent)=>clicks.push({latlng, originalEvent})});
  store.subscribe(state=>controller.sync(state)); controller.sync(store.getState());
  const draft = cam('preview', 22.605, {color:'#7c3aed', headingDeg:45, tiltDownDeg:5});
  controller.setCameraPlacementPreview({...draft, lifecycle:'placed'});
  const previewGroup = [...map.layers].find(group => [...(group.layers || [])].some(layer => layer.__portcamPlacementPreview));
  assert.ok(previewGroup);
  assert.equal([...previewGroup.layers].filter(layer => layer.options?.pane === 'portcam-analysis-pane' && layer.options?.fillOpacity === 0).length, 1);
  assert.equal([...previewGroup.layers].filter(layer => layer.options?.pane === 'portcam-analysis-pane' && layer.options?.fillOpacity > 0).length, 4);
  const previewEnvelope = [...previewGroup.layers].find(layer => layer.options?.pane === 'portcam-analysis-pane' && layer.options?.fillOpacity === 0);
  assert.equal(previewEnvelope.options.color, '#566273');
  assert.equal(previewEnvelope.options.dashArray, '5,5');
  const previewMarker = [...previewGroup.layers].find(layer => layer.__portcamPlacementPreview);
  assert.equal(previewMarker.tooltip.content, 'Preview');
  store.setFovColorMode('camera');
  const cameraPreviewGroup = [...map.layers].find(group => [...(group.layers || [])].some(layer => layer.__portcamPlacementPreview));
  assert.equal([...cameraPreviewGroup.layers].filter(layer => layer.options?.pane === 'portcam-analysis-pane' && layer.options?.fillOpacity > 0).length, 1);
  assert.equal([...cameraPreviewGroup.layers].filter(layer => layer.options?.pane === 'portcam-analysis-pane' && layer.options?.fillColor === '#15803d').length, 0);
  map.events.mousemove({latlng:{lat:22.606,lng:120.283}, originalEvent:{type:'mousemove'}});
  map.events.click({latlng:{lat:22.607,lng:120.284}, originalEvent:{type:'click'}});
  assert.equal(moves.length, 1); assert.equal(moves[0].originalEvent.type, 'mousemove'); assert.equal(clicks.length, 1); assert.equal(clicks[0].originalEvent.type, 'click');
  controller.clearCameraPlacementPreview(); assert.equal([...map.layers].some(group => [...(group.layers || [])].some(layer => layer.__portcamPlacementPreview)), false);
  controller.setCameraPlacementPreview(draft); assert.ok([...map.layers].some(group => [...(group.layers || [])].some(layer => layer.__portcamPlacementPreview)));
  controller.destroy(); assert.equal(map.events.mousemove, undefined); assert.equal([...map.layers].some(group => [...(group.layers || [])].some(layer => layer.__portcamPlacementPreview)), false);
});
