# Phase 4.1 Handoff — Camera Comparison

## Status and scope

- Scope delivered: Camera Comparison only.
- Baseline: `5585820` (`Clarify independent observation context`), branch `codex/multi-cam`.
- Comparison results are UI-derived and are not persisted. No Camera, Target, Observation, `camera-project/1.0`, `camera-scene/1.1`, runtime cache key, revision, history, or dirty-state contract changed.
- YOLO Coverage remains a Phase 4.2 placeholder. No manual weighting, recommendation copy, custom ordering, or Camera/Target pairing was added.

## Delivered files

- `portcam-comparison.js` — pure comparison derivation and ranking helper. It accepts the existing Camera order/state and a `getObservation(cameraId, targetId)` callback; it is not a canonical data source.
- `portcam-ui.js` — lazy Comparison rendering, status/metric formatting, Current Target summary, Camera row selection, and keyboard activation.
- `index.html` — real semantic comparison table, dynamic Workspace summary, and the comparison helper script.
- `app.css` — fixed table header, 300px Workspace layout, table-local vertical/horizontal scrolling, and non-color Active Camera state.
- `test_camera_comparison.js` — enabled filtering, ranking tie-breaks, unavailable/failed placement, disabled Target state, and project-state isolation tests.

## Comparison contract

- Scope is every Camera whose `enabled !== false`; `visible === false` only affects map visibility and does not exclude the row. Disabled Cameras are omitted and counted in the Workspace header.
- Enabled draft/unplaced Cameras remain in the table as `Unavailable`. `Failed` and `Unavailable` rows have no rank and are placed after ranked rows.
- A comparison Observation is requested only by the Comparison renderer when the Workspace is expanded and the Comparison tab is active. Existing Phase 3 Map/Context Inspector paths retain their independent Active Camera/Current Target Observation behavior.
- Rankable rows require a successful current Observation. Ordering is: `Visible` before all outside-FOV states; within a state group, `yolo.shortSidePx` descending; then `distanceM` ascending; then existing `cameraOrder`.
- Table columns are fixed: Rank, Camera, Observation status, Distance, Azimuth, Target pixel size, YOLO short side. Failed/unavailable metrics render `—`.
- Clicking or pressing Enter/Space on a Camera name selects the Active Camera, preserves the Current Target, opens/stays in the Comparison Workspace, updates map selection/FOV projection through the existing Store/Map subscription, preserves the Inspector tab, and marks the active button with `aria-current="true"` plus visible `Active Camera` text.

## Empty states and layout

- No Current Target: prompts selection from Object Manager or the map.
- No enabled Camera: prompts enabling or creating a Camera and reports the disabled exclusion count.
- Disabled Current Target: retains all enabled Camera rows as `Unavailable`.
- The table uses `<table>`, a sticky header, and a table-local scroll container. The Workspace remains 300px when expanded; narrow layouts keep horizontal scrolling inside the table container.

## Verification evidence

- `node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js test_camera_comparison.js` — 28/28 passed (the existing 23 plus 5 Phase 4.1 tests).
- `node --check portcam-comparison.js`, `node --check portcam-store.js`, `node --check portcam-map.js`, and `node --check portcam-ui.js` — passed.
- `git diff --check` — passed; only the existing LF/CRLF conversion warnings were reported.
- Local Edge/Chromium Playwright smoke at `http://127.0.0.1:8765/index.html` verified three-plus Cameras, all required Observation statuses, enabled-only filtering, visible Camera inclusion, rank/metric rendering, row click, Enter/Space activation, `aria-current`, Current Target preservation, Details/Observation Inspector behavior, live refresh after Camera parameter/enabled/Target-position changes, all empty states, YOLO placeholder, and no console messages after adding the data-URI favicon.
- Layout measurements reported no page overflow at 1920×1080, 1366×768, or 1920×1080 with DPR 2. At 1366, the comparison table had a local horizontal scroll range while `body.scrollWidth === body.clientWidth`. Screenshot: `output/playwright/phase41-comparison-1920-dpr2.png`.
- Python ray-casting/water-classification tests were not rerun because no Python or Scene consumer contract was modified.

## Remaining acceptance gates

The following Phase 3 gates remain manual and block final Phase 4.1 acceptance until explicitly accepted:

- physical wheel-detent behavior;
- physical Camera/Target marker drag parity and lock behavior;
- Target click while inside selected-Camera FOV/YOLO geometry;
- NVDA/screen-reader review;
- base-map/network, Surface boundary, and visual water/land/unknown review;
- Scene download file behavior and downstream Scene consumer handoff.

Phase 4.2 remains responsible for complete YOLO Coverage analysis and must not expand Phase 4.1 into a new persisted result or pairing model.
