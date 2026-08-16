const test = require('node:test');
const assert = require('node:assert/strict');
const {createProjectStore} = require('./portcam-store.js');
const {createMapController} = require('./portcam-map.js');

function fakeLeaflet() {
  class Layer { addTo(parent) { parent.addLayer(this); return this; } }
  class Group extends Layer { constructor() { super(); this.layers = new Set(); } addLayer(layer) { this.layers.add(layer); return this; } removeLayer(layer) { this.layers.delete(layer); } bringToFront() {} }
  class Marker extends Layer { constructor(value) { super(); this.value=value; this.events={}; this.options={}; this.dragging={enable(){},disable(){}}; } bindTooltip(){ return this; } on(name, fn){this.events[name]=fn; return this;} setLatLng(value){this.value=value; return this;} getLatLng(){return this.value;} setOpacity(){} }
  class Shape extends Layer { constructor(points) { super(); this.points=points; } getBounds(){return {points:this.points};} }
  return {latLng(a,b) { return typeof a === 'object' ? {lat:a.lat, lng:a.lng} : {lat:a,lng:b}; }, layerGroup(){return new Group();}, marker(v){return new Marker(v);}, circleMarker(v){return new Marker(v);}, polygon(v){return new Shape(v);}, polyline(v){return new Shape(v);} };
}
function fakeMap() { const layers=new Set(), events={}; return {layers, events, addLayer(layer){layers.add(layer); return this;}, removeLayer(layer){layers.delete(layer);}, hasLayer(layer){return layers.has(layer);}, on(name, fn){events[name]=fn;}, off(name){delete events[name];}, getZoom(){return 13;}, setView(){}, fitBounds(){}}; }
const cam = (id, lat, extra={}) => ({id, name:id, position:{latitudeDeg:lat,longitudeDeg:120.28},heightM:20,headingDeg:90,tiltDownDeg:20,sensorWidthMm:7.2,sensorHeightMm:4.05,widthPx:2560,heightPx:1440,focalLengthMm:14,...extra});

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
