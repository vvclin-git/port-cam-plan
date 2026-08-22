# Phase 3 Handoff

## Status and scope

- Status: Historical Phase 3 App Shell and core workspace handoff; the implementation was subsequently committed through the Phase 3.2 and Phase 4 commits, with current behavior summarized in [`PHASE_4_4_HANDOFF.md`](PHASE_4_4_HANDOFF.md).
- Repository: `D:\Workplace\port-cam-plan`.
- The original Phase 3 handoff did not itself commit or push changes; later commits now contain the delivered implementation. This document preserves the Phase 3 acceptance record.
- The implementation uses the existing `PortCamStore` and `PortCamMap` as the only Camera／Target state and projection sources.

Phase 3 includes the Top Bar, Camera Rail, Camera Inspector, Map Workspace, Result Drawer, and collapsed／expanded Bottom Workspace. Phase 3.1 adds the shared Camera／Target entity interactions and Target List. It intentionally does not include Project Import／Save, Camera Comparison data, exact four-corner projection, DEM, EPSG:3826, or new Ray Casting／water algorithms.

## Delivered files and public APIs

- [`index.html`](../index.html) is now the formal static App Shell entry point.
- [`app.css`](../app.css) owns the desktop shell and responsive panel layout. The body is `100dvh` and `overflow: hidden`; panels and the map manage their own overflow.
- [`portcam-ui.js`](../portcam-ui.js) exposes `PortCamUI.createAppController({store, mapController, root})`. It also accepts `map` and `leaflet` when it needs to construct the MapController, and exposes `defaultProject` and tile source metadata.
- [`portcam-store.js`](../portcam-store.js) adds UI-only panel/tab/search state and keeps it excluded from `camera-project/1.0`, history, revision, and dirty comparison. Generic `patchEntity`, preview／commit, duplicate, remove, selection, and observation invalidation remain shared by Camera and Target.
- [`portcam-map.js`](../portcam-map.js) exposes `createEntityMarkerInteraction`, `getTargetLayerSnapshot`, target drag lifecycle, and `setLabelVisibility`. Camera and Target use `L.marker`; geometry uses the analysis pane with `interactive:false`, while Camera／Target markers and labels use fixed higher panes.

The Scene export still calls `PortCamCore.buildCameraScene` for the selected Camera and produces `camera-scene/1.1` with one top-level `camera`.

## Implemented behavior

- Top Bar shows project name, clean／dirty state, Undo／Redo, Camera Inspector, Project Settings, and Result Drawer. There are no Save／Import controls or fake saved timestamps.
- Object Manager supports Camera selection, two-stage Add/Place Camera, visible, enabled, locked, and Inspector actions for duplicate, rename, delete, fit, reset, and Scene export. Selected state uses background, border, weight, `aria-current`, and status text in addition to color.
- Camera Inspector has collapsible Position & Orientation, Sensor & Lens, Derived FOV, and Actions sections. Latitude／longitude provide the keyboard relocation path. Tilt is labelled `Tilt (+ downward)`. Derived values are read-only and horizon is shown in m／km.
- Camera field input uses Store preview on input and a single Store transaction on blur／change／Enter. Navigate-mode marker drag is the direct relocation path for an Active, visible, unlocked Camera; latitude／longitude fields remain available. Switching Camera cancels an uncommitted preview. Locked Cameras remain selectable and unlockable while calculation and position fields are disabled.
- Map Workspace keeps the reactive multi-Camera/Target LayerGroups and connection lines. Navigate／Place Camera／Place Target are explicit toolbar modes with an Escape-cancellable instruction banner. Map Settings owns OSM／NLSC, tile zoom, Surface visibility, and project-level planning defaults.
- Surface classification keeps `water`, `land`, and `unknown`; hiding the Surface layer does not disable classification.
- Target creation supports map placement and coordinate-only keyboard creation with `lengthM`, `widthM`, `heightM`, `headingDeg`, and `anchor: "bottom-center"`. Target selection does not select or change Camera.
- Result Drawer supports empty, Target-only, visible Observation, outside-HFOV／VFOV／FOV informational amber, unavailable／disabled／draft, and calculation-failed states. Outside-FOV uses the fixed message `Target已建立；目前Camera無法觀測此Target`. Closing the drawer preserves Target selection; Clear Target explicitly clears it.
- Bottom Workspace is UI-only, starts collapsed, expands to 300px, and exposes the searchable Targets list. Camera Comparison and YOLO Coverage remain reserved Phase 4 tabs without fake calculations.

## Phase 3.1 follow-up

- Wheel zoom disables Leaflet `scrollWheelZoom` and installs one non-passive controller handler. Pixel／line／page deltas are normalized; a same-direction burst within 180 ms zooms at most one level; Ctrl+wheel is left to browser zoom; min／max bounds and destroy／recreate cleanup are covered.
- Camera and Target markers are draggable only when selected, visible, unlocked, and in `navigate`. `dragstart` captures canonical position, `drag` writes Store preview, and `dragend` commits exactly one `${kind}-drag` transaction. Undo／Redo reprojects markers, labels, FOV, connection lines, Drawer, and Target List.
- Target uses a `divIcon` crosshair marker with selected／locked／disabled styles. Camera／Target labels are permanent by default and renamed through `setTooltipContent()`; Map Settings controls them independently with `pointer-events:none` labels.
- Only the selected Target gets a Camera-to-Target line. FOV, YOLO bands, centerline, and connection line cannot intercept marker clicks, so a Target inside FOV or an overlapping YOLO band remains selectable.
- Target List supports search, row／marker selection, rename, visibility, enabled, lock, duplicate, delete, and Fit Target. Duplicate uses a new ID, `<name> copy`, copied placement／size, unlocks, and selects the copy. Search is UI-only.

## Phase 3.2 follow-up

Object Manager now owns both Camera and Target lists; Context Inspector owns Details and Observation. See [`PHASE_3_2_HANDOFF.md`](PHASE_3_2_HANDOFF.md) for focused-entity and pairing semantics. Phase 3.1 MapController interaction behavior is retained unchanged.
- At ≥1600px Inspector and Result Drawer can be fixed together. At 1366–1599px Inspector is fixed and Result Drawer overlays the map. Below 1366px or at 2× device scale they are mutually exclusive overlays. ResizeObserver and transition-safe invalidation call `map.invalidateSize()` after shell/panel changes.

## Verification evidence

Commands:

- `node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js` — 22/22 passed, including shared drag and wheel contract tests.
- `node --check portcam-store.js`, `node --check portcam-map.js`, and `node --check portcam-ui.js` — passed.
- Extracted inline bootstrap syntax check — passed.
- `git diff --check` — passed; only the existing CRLF conversion warnings were reported.
- Existing Python suite and checked-in Scene fixtures remain covered by the Phase 0/2 regression baseline; no Python consumer contract was changed.

Bundled Playwright／Microsoft Edge smoke at `http://127.0.0.1:8765/index.html`:

- 1920×1080, 1366×768, and 1920×1080 with `deviceScaleFactor: 2` loaded without page errors.
- App height matched the viewport, Surface reached `已載入`, body overflow was `hidden`, and body width／height did not scroll.
- Two-stage Add/Place Camera via Leaflet map events → one placed marker transaction; Undo removed the visible layer; Redo restored the marker.
- Coordinate Target creation opened Result Drawer, showed outside-FOV amber state and observation metrics, and preserved selection after drawer close.
- Removing all Cameras left a usable Target-only drawer state.
- Map Settings changed NLSC PHOTO, tile zoom, and Surface visibility state; restoring Surface succeeded.
- Expanded Bottom Workspace measured 300px and exposed all three reserved tabs.
- Scene export object was `camera-scene/1.1`, contained `camera`, and did not contain `cameras`.
- Phase 3.1 smoke rendered Target List search, row selection, rename／label update, independent label hide／show, `L.divIcon` crosshair marker selection, and wheel burst／Ctrl+wheel behavior. Screenshot: `output/playwright/phase31-target-list.png`.

Local screenshot artifacts are under `output/playwright/phase3-*.png` in the working tree.

## Remaining manual gates and deviations

- Physical pointer drag／lock behavior and one-notch-per-wheel-detent behavior still require acceptance with the same physical mouse; automated contract tests and browser dispatch cover lifecycle policy, not the human input feel.
- NVDA／screen-reader review has not been performed. Automated DOM checks cover `aria-current`, `aria-pressed`, live status regions, visible focus styling, and non-color-only selected states.
- Base-map network rendering, three independent live tile services, Scene download file picker behavior, and visual Surface boundary review still need a normal desktop network session.
- The screenshot run is a visual regression smoke, not approval of the previous Phase 2 physical marker, shoreline, or field-data gates.

## Phase 4 entry conditions

Before Phase 4, manually accept physical wheel detents, Target click inside selected-Camera FOV／YOLO bands, Camera／Target drag parity and lock gates, keyboard focus order with NVDA, all base-map and Surface visual gates, Scene file download/consumer handoff, and 1920×1080／1366×768 screenshots in the intended desktop environment. Phase 4 can then fill Camera Comparison and YOLO Coverage without changing the Phase 0 calculation or Scene contracts.
