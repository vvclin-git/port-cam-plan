# Phase 2 Handoff

## Status

Implemented locally on 2026-08-16. No commit, push, release, or remote mutation was made.

## Delivered

- Added `portcam-map.js`: a DOM-free-from-Store Leaflet projection controller with one LayerGroup per Camera and Target, marker/FOV hierarchy, selected YOLO bands, connection lines, visibility/lock/enabled styles, cleanup, and read-only camera layer snapshots.
- Replaced the page's single Camera marker and `updateAll()` render path with one Store subscription. Store mutations now project the map, Camera form, manager, status, and selected Target result from the same state snapshot.
- Added the compact Camera Manager: selection, add draft, duplicate, relocate, delete, visible, enabled, and locked controls. Map interaction is now `navigate`, `place-camera`, or `place-target`; Escape cancels preview/mode.
- Strengthened `PortCamStore`: formal mode validation, recovery of stale selections after undo/redo, selected duplicate Camera, and non-cached `idle/unavailable` responses for disabled/draft/missing observation inputs.
- Kept `camera-project/1.0` and selected-Camera `camera-scene/1.1` unchanged. No App Shell, Camera Rail, Result Drawer, Save/Load UI, EPSG:3826, exact four-corner projection, or Ray Casting/surface work was added.

## Verification

- `node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js` — 17/17 passed.
- `node --check portcam-map.js` and extracted inline page-script syntax check — passed.
- `git diff --check` — passed, with only existing CRLF conversion warnings.
- Added fake-Leaflet projection coverage for three independent Camera groups, selected/unselected layers, Store move → marker projection, Undo → marker restoration, hidden layer removal, and destroy cleanup.
- Isolated Microsoft Edge localhost acceptance (`127.0.0.1`, unsigned-in temporary profile): verified Add draft → map placement, Duplicate, hidden and disabled layer states, selected Camera Store move → marker/form update, Undo/Redo restoration, Target placement → `navigate`, three Camera selector options, and no page exceptions. The initial Edge run revealed and then verified the fix for draft Cameras lacking a position.

## Remaining acceptance boundary

The original Playwright CLI startup did not return a usable snapshot; the isolated Edge run above superseded its functional portion. A visual/manual gate remains for physical marker drag/lock, manager selection appearance, connection-line styling, base-map/surface behavior, Scene export download, and 1920×1080/1366×768 layout smoke. Unit tests and DevTools-driven browser flows do not replace that visual gate.

## Phase 3 entry conditions

Phase 3 may reuse `PortCamStore` actions and `PortCamMap` snapshots; it must not introduce a parallel Camera state model. Complete the browser gate above before treating the reactive Leaflet workflow as operationally accepted.

## Phase 3 entry follow-up — 2026-08-16

The Phase 3 implementation reused the Store／Map contracts and ran a bundled Microsoft Edge visual smoke at `127.0.0.1:8765` for 1920×1080, 1366×768, and 2× device scale. The run covered Surface load, Map Settings state changes, draft placement, marker projection through Undo/Redo, Target Drawer outside-FOV state, Target-only state after Camera removal, and Scene schema shape. Screenshots are in `output/playwright/phase3-*.png`.

This is evidence for the App Shell layout and reactive projection, not closure of the remaining human gates. Physical pointer drag／lock, NVDA review, live base-map／Surface visual inspection, Scene file download, and the intended desktop network session remain manual acceptance items and are recorded in [`PHASE_3_HANDOFF.md`](PHASE_3_HANDOFF.md).
