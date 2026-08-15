# Phase 1 Handoff

## Status and Basis

- Status: implementation complete; browser coordinate-interaction acceptance remains a manual gate.
- Date: 2026-08-16
- Repository: `D:\Workplace\port-cam-plan`
- Branch: `codex/multi-cam`
- Implementation baseline: `1087fea`
- Publish state: no commit, push, release, or remote mutation was made. The worktree intentionally contains the Phase 1 changes and the pre-existing untracked `__pycache__/` directory.

## Locked Decisions and Public API

`portcam-store.js` is a DOM/Leaflet-free UMD module (`window.PortCamStore` and CommonJS) with `createProjectStore(initialProject, { idFactory })`. IDs use `crypto.randomUUID()` unless a deterministic factory is injected for tests.

- State is normalized as `camerasById`/`cameraOrder` and `targetsById`/`targetOrder`; camera and target selection are independent in `uiState`.
- `visible` controls projection only, `enabled` indicates analysis participation, and `locked` rejects calculation-affecting patches. Metadata changes are dirty but do not increment entity revisions.
- Draft Cameras have `lifecycle: 'draft-unplaced'`; they never produce an Observation before becoming `placed`.
- Public methods include state/subscription/export (`getState`, `subscribe`, `toCameraProject`), CRUD/duplicate/selection/mode, preview (`beginPreview`, `cancelPreview`, `commitPreview`), patch methods, `getObservation`, `undo`, `redo`, `isDirty`, and `markSaved`.
- A preview does not alter canonical data, revision, history, or dirty state. A commit creates one transaction; undo/redo restores Project data while retaining selection/UI state.
- Canonical dirty comparison and `toCameraProject()` output only `camera-project/1.0` data. UI state, history, preview, and runtime Observation entries are excluded.
- Observation cache is lazy, keyed `cameraId:targetId`, holds entity revisions, `spherical-v1`, timestamp, calculation and visibility state, and is cleared on relevant entity changes/deletion. Preview observations are never cached.

## Implemented Scope and Deviations

- Added `portcam-store.js` and focused `test_portcam_store.js` coverage for normalized state, selections, lock/visible/enabled, deletion fallback, draft lifecycle, preview/history/dirty, cache isolation/cleanup, and metadata dirty behavior.
- Adapted `index.html` to bootstrap one Project once, route form and map mutations through the Store, use Store-selected Camera for summary/FOV/Scene export, use Project-level `planningTargetHeightM` for the envelope, and derive clicked Target results through the Observation selector.
- Existing single-Camera UI remains intentionally unchanged. There is no Camera Rail, new App Shell, Result Drawer, Save/Load control, or visible undo/redo control.
- Deviations: browser automation verified form commit, Surface, overlay, and all base-map selections, but its current viewport did not reliably dispatch coordinate clicks to Leaflet. Camera drag/place and Target click must be manually accepted before operational release.

## Verification Evidence

- `node --test test_portcam_core.js test_portcam_store.js` — 15/15 passed (8 core + 7 Store), 2026-08-16.
- `python -m unittest -v test_ray_cast_test.py` — 14/14 passed, 2026-08-16.
- `node --check portcam-store.js` and inline-script extraction syntax check — passed.
- Python fixture validation for all three checked-in `camera-scene/1.1` fixtures — passed.
- `python -m json.tool data/kaohsiung-harbor-surface.geojson > $null` — passed.
- `git diff --check` — passed; the only output was Git's CRLF conversion warning for the existing HTML working-tree convention.
- Localhost smoke at `http://127.0.0.1:8765/index.html` — initialized with local scripts and Leaflet; Surface showed `已載入`; default values were `2.80°` HFOV, `1.57°` VFOV, `21.01 km`; focal-field commit recalculated to `4.12°` HFOV; OSM, NLSC EMAP, NLSC PHOTO, and the Surface toggle operated. Map coordinate click/drag requires the manual gate above. No browser console errors were observed in this run.

## Compatibility

- `camera-project/1.0` remains arrays at its persistence boundary; normalized Store internals are not serialized.
- Scene export remains selected-Camera `camera-scene/1.1` with a top-level `camera` and project-level planning target height.
- The Python Ray Casting consumer accepted the existing fixtures and all 14 tests pass. Local Leaflet, Surface GeoJSON, three base maps, and relative static paths remain present.

## Risks, Remaining Scope, and Phase 2 Entry Conditions

- `enabled` is represented by the Store but the legacy one-Camera UI has no visible multi-Camera analysis control yet.
- The legacy form has no visible Save/Load or undo/redo controls; APIs are deliberately provided for the following UI phase.
- Manually verify Camera drag, Camera place mode, Target map click/result, presets as one history gesture, and Scene download in a standard desktop browser before declaring full browser acceptance.
- Phase 2 may introduce the App Shell/Camera Rail/Result Drawer only after preserving the Store contracts and completing that manual Leaflet gate. EPSG:3826, exact four-corner projection, and new Ray Casting/water UI remain out of scope.
