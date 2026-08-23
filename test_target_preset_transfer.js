const test = require('node:test');
const assert = require('node:assert/strict');
const Defaults = require('./portcam-target-defaults.js');
const Presets = require('./portcam-target-presets.js');
const Transfer = require('./portcam-target-preset-transfer.js');

function storage({failKey} = {}) { const data = new Map(); return {getItem:k => data.get(k) || null, setItem(k,v) { if (k === failKey) throw new Error('write failure'); data.set(k,v); }}; }
function repositories(options) { const value=storage(options); return {defaults:Defaults.createRepository({storage:value}), presets:Presets.createRepository({storage:value})}; }
test('Target export omits built-ins and merge skips equals while renaming conflicts', () => {
  const local=repositories(), incoming=repositories();
  local.presets.create({name:'Dock',settings:{modelType:'small-vessel',lengthM:31,widthM:10,heightM:12}});
  incoming.presets.create({name:'Dock',settings:{modelType:'large-vessel',lengthM:300,widthM:48,heightM:40}});
  const bundle=Transfer.createCoordinator({targetDefaultsRepository:incoming.defaults,presetsRepository:incoming.presets,now:()=> '2026-08-24T00:00:00.000Z'}).buildBundle();
  assert.equal(bundle.bundle.presets.length,1);
  const coordinator=Transfer.createCoordinator({targetDefaultsRepository:local.defaults,presetsRepository:local.presets}); const plan=coordinator.planImport(bundle.bundle,{mode:'merge'});
  assert.equal(plan.plan.summary.renamed,1); assert.match(plan.plan.nextPresets[1].name,/Imported/); assert.equal(coordinator.applyImport(plan.plan).ok,true);
});
test('Target replace changes only custom presets and rolls defaults back if preset write fails', () => {
  const source=repositories(); source.defaults.save({modelType:'large-vessel',lengthM:300,widthM:48,heightM:40}); source.presets.create({name:'Large',settings:source.defaults.getDefaults()});
  const bundle=Transfer.createCoordinator({targetDefaultsRepository:source.defaults,presetsRepository:source.presets,now:()=> '2026-08-24T00:00:00.000Z'}).buildBundle().bundle;
  const target=repositories(); const coordinator=Transfer.createCoordinator({targetDefaultsRepository:target.defaults,presetsRepository:target.presets}); const plan=coordinator.planImport(bundle,{mode:'replace'}).plan;
  assert.equal(coordinator.applyImport(plan).ok,true); assert.deepEqual(target.presets.list().filter(x=>x.builtin).map(x=>x.name),['Small Tug','Large Container Ship']);
});
test('Target import rolls Target Defaults back when Target preset storage fails', () => {
  const source=repositories(); source.defaults.save({modelType:'large-vessel',lengthM:300,widthM:48,heightM:40}); source.presets.create({name:'Large',settings:source.defaults.getDefaults()});
  const bundle=Transfer.createCoordinator({targetDefaultsRepository:source.defaults,presetsRepository:source.presets,now:()=> '2026-08-24T00:00:00.000Z'}).buildBundle().bundle;
  const defaultsStorage=storage(), presetsStorage=storage({failKey:Presets.STORAGE_KEY}); const defaults=Defaults.createRepository({storage:defaultsStorage}), presets=Presets.createRepository({storage:presetsStorage});
  const coordinator=Transfer.createCoordinator({targetDefaultsRepository:defaults,presetsRepository:presets}); const plan=coordinator.planImport(bundle,{mode:'replace'}).plan; const result=coordinator.applyImport(plan);
  assert.equal(result.ok,false); assert.equal(result.rolledBack,true); assert.deepEqual(defaults.getDefaults(),Defaults.FACTORY_DEFAULTS);
});
