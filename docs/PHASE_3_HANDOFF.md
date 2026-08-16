# Phase 3 Handoff

## Status and scope

- Status: App Shell and core workspace implemented locally on 2026-08-16.
- Repository: `D:\Workplace\port-cam-plan`.
- No commit, push, release, import, save, or remote mutation was made.
- The implementation uses the existing `PortCamStore` and `PortCamMap` as the only Camera／Target state and projection sources.

Phase 3 includes the Top Bar, Camera Rail, Camera Inspector, Map Workspace, Result Drawer, and collapsed／expanded Bottom Workspace. It intentionally does not include Project Import／Save, Camera Comparison data, a complete Target List, exact four-corner projection, DEM, EPSG:3826, or new Ray Casting／water algorithms.

## Delivered files and public APIs

- [`index.html`](../index.html) is now the formal static App Shell entry point.
- [`app.css`](../app.css) owns the desktop shell and responsive panel layout. The body is `100dvh` and `overflow: hidden`; panels and the map manage their own overflow.
- [`portcam-ui.js`](../portcam-ui.js) exposes `PortCamUI.createAppController({store, mapController, root})`. It also accepts `map` and `leaflet` when it needs to construct the MapController, and exposes `defaultProject` and tile source metadata.
- [`portcam-store.js`](../portcam-store.js) adds UI-only `setPanelOpen(panel, open)`, `setActiveResultTab(tab)`, and `setActiveWorkspaceTab(tab)`. These values are emitted to subscribers but excluded from `camera-project/1.0`, history, revision, and dirty comparison.
- [`portcam-map.js`](../portcam-map.js) retains the existing public projection API and adds optional target-selection callback, preview projection, `fitTarget`, and `fitCameraAndTarget`. Selected／unselected Camera styling, connection lines, and LayerGroup ownership remain in the controller.

The Scene export still calls `PortCamCore.buildCameraScene` for the selected Camera and produces `camera-scene/1.1` with one top-level `camera`.

## Implemented behavior

- Top Bar shows project name, clean／dirty state, Undo／Redo, Camera Inspector, Project Settings, and Result Drawer. There are no Save／Import controls or fake saved timestamps.
- Camera Rail supports select, add draft, visible, enabled, locked, and the Inspector actions for duplicate, rename, delete, relocate, fit, reset, and Scene export. Selected state uses background, border, weight, `aria-current`, and status text in addition to color.
- Camera Inspector has collapsible Position & Orientation, Sensor & Lens, Derived FOV, and Actions sections. Latitude／longitude provide the keyboard relocation path. Tilt is labelled `Tilt (+ downward)`. Derived values are read-only and horizon is shown in m／km.
- Camera field input uses Store preview on input and a single Store transaction on blur／change／Enter. Switching Camera cancels an uncommitted preview. Locked Cameras remain selectable and unlockable while calculation and relocation fields are disabled.
- Map Workspace keeps the reactive multi-Camera/Target LayerGroups and connection lines. Navigate／Place Camera／Place Target are explicit toolbar modes with an Escape-cancellable instruction banner. Map Settings owns OSM／NLSC, tile zoom, Surface visibility, and project-level planning defaults.
- Surface classification keeps `water`, `land`, and `unknown`; hiding the Surface layer does not disable classification.
- Target creation supports map placement and coordinate-only keyboard creation with `lengthM`, `widthM`, `heightM`, `headingDeg`, and `anchor: "bottom-center"`. Target selection does not select or change Camera.
- Result Drawer supports empty, Target-only, visible Observation, outside-HFOV／VFOV／FOV informational amber, unavailable／disabled／draft, and calculation-failed states. Outside-FOV uses the fixed message `Target已建立；目前Camera無法觀測此Target`. Closing the drawer preserves Target selection; Clear Target explicitly clears it.
- Bottom Workspace is UI-only, starts collapsed, expands to 300px, and exposes Targets, Camera Comparison, and YOLO Coverage empty／coming-next-phase states without fake calculations.
- At ≥1600px Inspector and Result Drawer can be fixed together. At 1366–1599px Inspector is fixed and Result Drawer overlays the map. Below 1366px or at 2× device scale they are mutually exclusive overlays. ResizeObserver and transition-safe invalidation call `map.invalidateSize()` after shell/panel changes.

## Verification evidence

Commands:

- `node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js` — 18/18 passed.
- `node --check portcam-store.js`, `node --check portcam-map.js`, and `node --check portcam-ui.js` — passed.
- Extracted inline bootstrap syntax check — passed.
- `git diff --check` — passed; only the existing CRLF conversion warnings were reported.
- Existing Python suite and checked-in Scene fixtures remain covered by the Phase 0/2 regression baseline; no Python consumer contract was changed.

Bundled Playwright／Microsoft Edge smoke at `http://127.0.0.1:8765/index.html`:

- 1920×1080, 1366×768, and 1920×1080 with `deviceScaleFactor: 2` loaded without page errors.
- App height matched the viewport, Surface reached `已載入`, body overflow was `hidden`, and body width／height did not scroll.
- Add draft → Place Camera via Leaflet map event → placed marker; Undo removed the visible layer; Redo restored the marker.
- Coordinate Target creation opened Result Drawer, showed outside-FOV amber state and observation metrics, and preserved selection after drawer close.
- Removing all Cameras left a usable Target-only drawer state.
- Map Settings changed NLSC PHOTO, tile zoom, and Surface visibility state; restoring Surface succeeded.
- Expanded Bottom Workspace measured 300px and exposed all three reserved tabs.
- Scene export object was `camera-scene/1.1`, contained `camera`, and did not contain `cameras`.

Local screenshot artifacts are under `output/playwright/phase3-*.png` in the working tree.

## Remaining manual gates and deviations

- Physical pointer drag／lock behavior has not been accepted with a human mouse; the browser smoke used Leaflet event dispatch and controller state inspection.
- NVDA／screen-reader review has not been performed. Automated DOM checks cover `aria-current`, `aria-pressed`, live status regions, visible focus styling, and non-color-only selected states.
- Base-map network rendering, three independent live tile services, Scene download file picker behavior, and visual Surface boundary review still need a normal desktop network session.
- The screenshot run is a visual regression smoke, not approval of the previous Phase 2 physical marker, shoreline, or field-data gates.

## Phase 4 entry conditions

Before Phase 4, manually accept the physical marker drag／lock path, keyboard focus order with NVDA, all base-map and Surface visual gates, Scene file download/consumer handoff, and 1920×1080／1366×768 screenshots in the intended desktop environment. Phase 4 can then fill the reserved Targets, Comparison, and YOLO Coverage workspaces without changing the Phase 0 calculation or Scene contracts.
