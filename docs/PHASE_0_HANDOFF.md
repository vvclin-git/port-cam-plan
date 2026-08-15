# Phase 0 Handoff

## Status

complete

## Repository

- Root: `D:\Workplace\port-cam-plan`
- Date: 2026-08-15
- Git revision: `1ba703e6219a4abe955bfaed730d34a08e8dfb51`
- Branch: `codex/multi-cam`
- Implemented by: Codex

## Locked Decisions

- Tilt uses `tiltDownDeg`: `0°` is horizontal, positive is downward, and negative is upward. The UI label is `向下俯角 Tilt`.
- Horizon is `Horizon distance`; the displayed unit is `km` and the calculation API uses metres internally.
- Camera height is `heightM` relative to `heightReference: "intersection-plane"`; Scene output also records `intersectionPlaneElevationM` and `verticalDatum: "local-planning-datum"`.
- A Phase 1 Target is still a point marker, but retains `lengthM`, `widthM`, `heightM`, `headingDeg`, and `anchor: "bottom-center"` for physical-size coverage calculations.
- Camera-only planning uses Project-level `planningTargetHeightM`; changing a Target does not change the Camera planning envelope.
- Observation is a derived runtime cache keyed by `cameraId:targetId`, with camera/target revisions, `calculatorModelVersion`, and `generatedAt`; it is not required in `camera-project/1.0` persistence.
- The calculation model is `spherical-v1`; EPSG:3826 is reserved for a future adapter and is not used by Phase 0/1.
- `camera-project/1.0` is the Project save/load contract. `camera-scene/1.1` is the selected-Camera export contract and keeps a single top-level `camera`, not `cameras[]`.
- The existing map shape is a `planning-envelope`, not exact four-corner ray projection.
- Effective ray distance is `min(horizonDistanceM, 30000)` and `hardMaximumRayDistanceM` remains `30000`.

## Implemented Changes

- Production code:
  - Added [`portcam-core.js`](../portcam-core.js), a DOM/Leaflet-free calculation core exporting optics, planning horizon, ground envelope, spherical bearing/destination helpers, observations, Scene/Project builders, tile manifest helpers, observation cache metadata, and preview/commit patch contracts.
  - Changed [`index.html`](../index.html) to load the local core and use it through a browser adapter. Existing FOV, YOLO, map placement, target click, Surface overlay, and Scene export flows remain in place.
  - Added the formal height reference fields to exported Camera Scene JSON.
  - Corrected Scene `maximumRayDistanceM` for no-ground and horizon-clipped cases.
  - Changed [`ray_cast_test.py`](../ray_cast_test.py) to isolate cache files by a stable tile-source hash under `.tile-cache/<tile-source-hash>/<z>/<x>/<y>.png`; legacy unscoped files are not read.
  - Applied the effective horizon limit before Python ray sampling so rays beyond the effective distance remain `max-distance`/`unknown`, not a misleading manifest miss.
- Tests and fixtures:
  - Added [`test_portcam_core.js`](../test_portcam_core.js) and [`testdata/camera-scene-core-golden.json`](../testdata/camera-scene-core-golden.json).
  - Extended [`test_ray_cast_test.py`](../test_ray_cast_test.py) for Phase 0 fields, source-isolated cache behavior, legacy-cache exclusion, and effective ray distance.
- Documentation:
  - Added normative contracts and the handoff link to the latest UI architecture document.
  - Updated [`README.md`](../README.md), [`CHANGELOG.md`](../CHANGELOG.md), and [`RAY_CAST_WATER_COLOR.md`](RAY_CAST_WATER_COLOR.md) with the Phase 0 interfaces, cache layout, and verification commands.
- Known contract corrections:
  - Unified UI/core naming around `tiltDownDeg` and `Horizon distance`.
  - Added explicit `hardMaximumRayDistanceM` and corrected the effective maximum distance.
  - Kept Project persistence and Camera Scene export as separate schema responsibilities.

## Public Interfaces

- `PortCamCore` exports:
  - `computeOptics`
  - `computePlanningHorizon`
  - `computeGroundEnvelope`
  - `computeObservation`
  - `bearingBetween`
  - `angleDifference` / `angleDiff`
  - `destinationPoint`
  - `buildCameraScene`
  - `buildCameraProject`
  - `buildTileManifest`
  - `getObservationCacheKey`
  - `buildObservationCacheEntry`
  - `previewCameraPatch` / `commitCameraPatch`
- Schema versions: `camera-project/1.0`, `camera-scene/1.1`, `water-color-profile/1.0`.
- New Scene fields: `camera.position.intersectionPlaneElevationM`, `camera.position.verticalDatum`, and `tileSelection.hardMaximumRayDistanceM`.
- Compatibility notes: existing `camera-scene/1.1` fixtures without the new optional fields remain readable by the Python consumer; newly exported Scenes retain top-level `camera`, WGS84/EPSG:4326, `tiltDownDeg`, camera frame, half-pixel convention, and OSM/NLSC URL ordering.

## Verification Evidence

- Command: `node --test test_portcam_core.js`
  - Result: 8/8 tests passed, including default optics/horizon, heading wrap, tilt sign, finite/horizon-clipped/no-ground states, Target-size coverage, four Observation visibility states, full timestamp-excluded Scene golden comparison, Project/preview/commit contracts, and effective no-ground ray distance.
  - Date: 2026-08-15
  - Fixture/output: `testdata/camera-scene-core-golden.json`
- Command: `python -m unittest -v test_ray_cast_test.py`
  - Result: 14/14 tests passed, including existing RGB/LAB/HSV/classification/profile/reclassification tests and Phase 0 cache/schema/distance tests.
  - Date: 2026-08-15
  - Fixture/output: `testdata/camera-scene-minimal.json`, `testdata/camera-scene-core-golden.json`, temporary source-scoped PNG fixtures.
- Command: `node --check portcam-core.js` plus the README inline-script extraction check.
  - Result: passed; output `inline script syntax ok`.
  - Date: 2026-08-15
- Command: `python -m py_compile ray_cast_test.py test_ray_cast_test.py`.
  - Result: passed.
  - Date: 2026-08-15
- Command: `python -m json.tool data/kaohsiung-harbor-surface.geojson > $null`.
  - Result: passed; the fixed GeoJSON parses successfully.
  - Date: 2026-08-15
- Command: `python -c "from pathlib import Path; import ray_cast_test as r; [r.load_scene(Path(p)) for p in ['testdata/camera-scene-minimal.json','testdata/camera-scene-20260813-195947.json','testdata/camera-scene-core-golden.json']]; print('camera-scene fixtures validation ok')"`.
  - Result: passed; all three `camera-scene/1.1` fixtures were accepted by the Python consumer.
  - Date: 2026-08-15
- Command: `git diff --check`.
  - Result: passed; no whitespace errors in modified tracked files.
  - Date: 2026-08-15
- Localhost browser smoke: `python -m http.server 8765 --bind 127.0.0.1`, then real-browser navigation to `http://127.0.0.1:8765/index.html`.
  - Result: page initialized with local `PortCamCore`, Leaflet map, Surface state `已載入`, default OSM, and default values `2.80° HFOV`, `1.57° VFOV`, `21.01 km Horizon distance`; Camera placement and target click updated the UI; Scene download produced `camera-scene/1.1`; overlay toggle worked; OSM, NLSC EMAP, and NLSC PHOTO selectors updated successfully with no map error overlay.
  - Date: 2026-08-15
  - Note: the only browser console error observed was the non-functional `/favicon.ico` 404.

## Compatibility Results

- Existing App behavior: preserved FOV/YOLO formulas and map interaction paths; browser smoke confirmed placement, target click, surface classification, overlay toggle, and export.
- `camera-scene/1.1`: top-level `camera` remains unchanged in shape and all three checked-in fixtures validate in Python; the new golden fixture includes the formal Phase 0 fields.
- Ray Casting Python: all 14 unit tests pass; cache path is source-isolated and old unscoped cache files are ignored.
- Surface GeoJSON: fixed file parses and remains loaded in the browser; `water/land/unknown` behavior remains in the existing Surface adapter.
- Local Leaflet and static hosting: `portcam-core.js`, Leaflet 1.9.4, and Surface GeoJSON all load from relative local paths under the Python localhost server; no npm runtime or backend was added.

## Deviations from Plan

- Planned item: complete Store/Undo UI and multi-camera UI.
  - Actual result: not implemented.
  - Reason: explicitly outside Phase 0 scope; only the preview/commit public contract and tests were added.
  - Follow-up requirement: Phase 1 must implement Store, history transactions, dirty state, and the multi-camera UI using these contracts.
- Planned item: Project Save UI.
  - Actual result: `buildCameraProject` schema helper and tests were added, but no Save/Load controls were added.
  - Reason: Phase 0 fixes the schema boundary without changing the layout.
  - Follow-up requirement: Phase 1/4 should connect the helper to actual persistence.
- Planned item: exact four-corner ray projection and EPSG:3826.
  - Actual result: unchanged; the map remains a conservative spherical `planning-envelope` and EPSG:3826 is not used.
  - Reason: explicitly excluded from Phase 0/1.
  - Follow-up requirement: a later analysis phase must define and test a separate adapter before enabling either.
- Planned item: manual ten-point NLSC orthophoto/shoreline comparison.
  - Actual result: not repeated in this Phase 0 run; base-map selection and error-state behavior were smoke-tested.
  - Reason: source/date/shoreline visual agreement is environment- and tide-dependent and is not a Phase 1 contract blocker.
  - Follow-up requirement: perform the visual sample check before using the tool for operational shoreline decisions.

## Known Issues and Risks

- Unresolved issue: `/favicon.ico` returns 404 in the browser smoke.
  - Severity: low.
  - Phase 1 impact: none; it does not affect application scripts, Leaflet, Surface data, calculations, or export.
  - Temporary workaround: none required; add a local favicon only if a clean console is desired.
- Unresolved issue: real tile-service availability and ray-casting image-date agreement remain external network/source concerns.
  - Severity: low for Phase 0.
  - Phase 1 impact: no impact on the core/UI contract; operational ray-casting requires rate-limit and source-date checks.
  - Temporary workaround: use offline fixtures and the source-scoped cache; missing/decode/manifest/no-intersection states remain `unknown`.
- Unresolved issue: the current page is still a single-camera prototype.
  - Severity: expected scope boundary.
  - Phase 1 impact: multi-camera Store/UI work is still required.
  - Temporary workaround: none; do not infer multi-camera behavior from the current page.

## Phase 1 Entry Conditions

- Passed conditions:
  - Tilt, Horizon distance, height reference, Target dimensions, Observation persistence, and schema relationships have one normative definition.
  - `PortCamCore` golden tests, Python tests, syntax checks, fixture validation, GeoJSON parsing, and localhost smoke all pass.
  - `camera-scene/1.1` remains backward-readable and top-level `camera` is preserved.
  - Surface layer, local Leaflet, OSM/NLSC selectors, and Ray Casting export remain present.
  - No multi-camera UI, Camera Rail, Result Drawer, Bottom Workspace, EPSG:3826 calculation, or exact four-corner projection was introduced in Phase 0.
- Remaining blockers: none for entering Phase 1 implementation; the low-severity environmental/manual checks above must remain visible in operational acceptance.
- Recommended first implementation step: build the Project Store around `camera-project/1.0`, independent `selectedCameraId`/`selectedTargetId`, revision invalidation, dirty state, and one commit transaction per user gesture; then connect the existing `PortCamCore.computeObservation` and `buildCameraProject` adapters.
