/* Pure, runtime-only Camera × Target coverage audit derivation. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PortCamCoverageAudit = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TIERS = Object.freeze([
    Object.freeze({key:'robust', label:'Robust', minPx:32}), Object.freeze({key:'usable', label:'Usable', minPx:16}),
    Object.freeze({key:'difficult', label:'Difficult', minPx:8}), Object.freeze({key:'notRecommended', label:'Not recommended', minPx:0})
  ]);
  const RANK = Object.freeze({robust:3, usable:2, difficult:1, notRecommended:0});
  const DIMENSIONS = new Set(['length','width','height']);
  const minimumTier = value => RANK[value] === undefined ? 'usable' : value;
  const dimension = value => DIMENSIONS.has(value) ? value : 'width';
  function tierFor(value) { const px=Number(value); return Number.isFinite(px) && px >= 0 ? TIERS.find(tier=>px >= tier.minPx) : null; }
  function cellFor(camera, target, observation, options) {
    if (camera?.enabled === false || target?.enabled === false) return {key:'disabled',label:'Disabled',tier:null,px:null,qualified:false};
    if (observation?.calculationState === 'failed') return {key:'failed',label:'Failed',tier:null,px:null,qualified:false};
    if (!observation || observation.calculationState !== 'current' || observation.visibilityState === 'unavailable') return {key:'unavailable',label:'Unavailable',tier:null,px:null,qualified:false};
    if (observation.visibilityState !== 'visible' || !observation.inHFOV || !observation.inVFOV) return {key:'outside-fov',label:'Outside FOV',tier:null,px:null,qualified:false};
    const px=Number(observation.coveragePixels?.[dimension(options.dimension)]);
    const tier=tierFor(px); const qualified=Boolean(tier && RANK[tier.key] >= RANK[minimumTier(options.minimumTier)]);
    return {key:tier ? tier.key : 'unavailable',label:tier ? tier.label : 'Unavailable',tier,px:Number.isFinite(px)?px:null,qualified};
  }
  function buildCoverageAudit(options={}) {
    const cameras=(options.cameraOrder||Object.keys(options.camerasById||{})).map(id=>(options.camerasById||{})[id]).filter(Boolean);
    const targets=(options.targetOrder||Object.keys(options.targetsById||{})).map(id=>(options.targetsById||{})[id]).filter(Boolean);
    const settings={dimension:dimension(options.dimension),minimumTier:minimumTier(options.minimumTier),requiredCameras:Math.max(1,Math.floor(Number(options.requiredCameras)||1))};
    const rows=cameras.map((camera,cameraIndex)=>({camera,cameraIndex,cells:targets.map((target,targetIndex)=>cellFor(camera,target,options.getObservation?.(camera.id,target.id),settings))}));
    const targetSummaries=targets.map((target,targetIndex)=>{ const qualified=rows.filter(row=>row.camera.enabled!==false&&row.cells[targetIndex].qualified); const best=qualified.slice().sort((a,b)=>(b.cells[targetIndex].px-a.cells[targetIndex].px)||a.cameraIndex-b.cameraIndex)[0]||null; const count=qualified.length; const status=target.enabled===false?'disabled':count===0?'uncovered':count<settings.requiredCameras?'under-covered':'covered'; return {target,targetIndex,qualifiedCount:count,bestCameraId:best?.camera.id||null,bestPx:best?.cells[targetIndex].px??null,status,singleSource:target.enabled!==false&&count===1}; });
    rows.forEach(row=>{ const enabled=targetSummaries.filter(item=>item.target.enabled!==false); row.qualifiedCount=enabled.filter(item=>row.cells[item.targetIndex].qualified).length; row.bestCount=enabled.filter(item=>item.bestCameraId===row.camera.id).length; });
    const enabledTargets=targetSummaries.filter(item=>item.target.enabled!==false); const summary={targets:enabledTargets.length,covered:enabledTargets.filter(x=>x.status==='covered').length,underCovered:enabledTargets.filter(x=>x.status==='under-covered').length,uncovered:enabledTargets.filter(x=>x.status==='uncovered').length};
    return {settings,cameras,targets,rows,targetSummaries,summary};
  }
  return {TIERS,RANK,tierFor,cellFor,buildCoverageAudit};
}));
