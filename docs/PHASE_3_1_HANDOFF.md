# Phase 3.1 Handoff

## Status and boundaries

- Status: implemented locally on 2026-08-16.
- Scope: shared Camera／Target entity management, MapController interaction repairs, wheel policy, labels／panes, and the Bottom Workspace Targets tab.
- No commit, push, import／save workflow, or remote mutation was performed.
- Existing `camera-project/1.0`, `camera-scene/1.1`, `spherical-v1`, Surface semantics, and ray-casting contracts are unchanged.
- Phase 4 still owns Camera Comparison, YOLO Coverage analysis, Project Import／Save, 3D Target boxes, exact ray projection, DEM, and EPSG:3826.

## Shared entity contract

`PortCamStore` remains the sole canonical source for `camerasById`, `targetsById`, order, selection, revisions, observation invalidation, history, and dirty state. Camera and Target both use generic Store operations:

- select, rename, visible, enabled, locked;
- duplicate, delete, fit, Undo／Redo;
- selected／visible／unlocked／`navigate` is the only drag-enabled state;
- drag preview does not change revision, history, or dirty;
- drag end commits one `${kind}-drag` transaction and therefore one revision／history entry;
- locked entities remain selectable and visible, but calculation fields and map drag are disabled.

`PortCamMap.createEntityMarkerInteraction({kind, marker, store})` owns the shared marker lifecycle. The MapController subscription projects preview state immediately to marker position, FOV／bands, connection line, Drawer, and list. Camera-only behavior remains draft-unplaced placement, FOV／Fit FOV, and selected-Camera Scene export. Target creation is placed and committed immediately; Target retains dimensions, heading, and Target-only Drawer behavior.

## Map interaction policy

- Leaflet built-in `scrollWheelZoom` is disabled. The controller binds one non-passive `wheel` handler to the map container and removes it during `destroy()`.
- `deltaMode` pixel／line／page values are normalized. Each same-direction 180 ms burst can change zoom by at most one level. Ctrl+wheel is not prevented, so browser zoom remains available. Controller zoom is clamped to map min／max.
- Panes are fixed as analysis geometry (z 400), Camera marker (z 650), Target marker (z 700), and entity labels (z 750).
- FOV polygon, YOLO bands, centerline, and Camera-to-Target line use `interactive:false`; markers use `bubblingMouseEvents:false`. Only the selected Target renders its connection line.
- Target is an `L.marker` with `L.divIcon` crosshair HTML. Selected, locked, and disabled states are represented by classes and opacity.
- Camera／Target labels are permanent and enabled by default. Rename calls `setTooltipContent()` on the existing marker; it does not rebuild or stack tooltips. Labels use `pointer-events:none` and Map Settings has independent Camera／Target switches.

## Target List

The Targets tab lives in Bottom Workspace and is separate from Camera Rail while using the same Store semantics. It displays name, coordinates, visible／enabled／locked state, selected state, and Observation status for the selected Camera. It supports Search, row selection, Rename, Visible, Enabled, Locked, Duplicate, Delete, and Fit Target.

- Row selection selects only the Target, preserves Camera selection, opens the Result Drawer, and selects the same map marker.
- Marker selection selects and scrolls the matching row into view.
- Duplicate uses a fresh ID, `<name> copy`, copied placement／size, `locked:false`, and selects the new Target.
- Delete uses the Store next／previous fallback. Undo／Redo restores selection, marker, label, row, and observation state.
- Search is `uiState.targetSearchQuery`; it is not canonical project data and does not create history or dirty state.

## Verification

- `node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js` — 22/22 passed.
- `node --check portcam-store.js`, `node --check portcam-map.js`, and `node --check portcam-ui.js` — passed.
- Browser smoke with bundled Microsoft Edge／Playwright at `http://127.0.0.1:8765/index.html` verified Target List search, row selection, rename and label update, independent label hide／show, `L.divIcon` marker selection, wheel burst cooldown, delta behavior, Ctrl+wheel preservation, and no page errors. Network tile failures were expected in the restricted test environment.
- Visual artifact: [`phase31-target-list.png`](../output/playwright/phase31-target-list.png).

## Manual acceptance gates

Use the same physical mouse for each gate:

1. Place or select a Camera and Target. Drag each in `navigate`; confirm the marker, Target List coordinate, Drawer, FOV／line update live, then confirm one Undo／Redo step restores all projections.
2. Repeat with hidden, unselected, and locked entities; confirm they cannot drag. Unlock from Rail／Target List and confirm dragging resumes only after selection.
3. Put a Target inside the selected Camera FOV, on its boundary, and over a YOLO band; click the marker and confirm it selects the Target rather than placing a map entity.
4. Rename Camera and Target repeatedly; confirm exactly one permanent label per entity after rename, hide／show, delete, Undo, and Redo.
5. With the physical wheel, each detent must change zoom by one level at most. Rapid same-direction notches within 180 ms must not skip levels; opposite direction and map min／max must behave correctly; Ctrl+wheel must remain browser zoom.
6. Check 1920×1080, 1366×768, and 200% scaling for panel mutual exclusion, workspace height, row scrolling, focus order, and no body scroll.

These manual gates are separate from Node/Python regression tests and the automated browser smoke. Phase 4 entry requires the wheel, FOV Target click, and Camera／Target drag parity gates to be accepted.
