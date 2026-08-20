# Phase 4.2 Handoff — YOLO Coverage 與 FOV 著色模式

## Status

- Phase 4.2 UI bugfix is complete; commit and push status is reported by the repository history and final handoff.
- The implementation checkout is `D:\Workplace\port-cam-plan` on branch `codex/multi-cam`. The user-facing C: OneDrive link is not the Git checkout.
- Current clean baseline before this bugfix: `379f94f` — `Add YOLO coverage and FOV color modes`.
- Phase 4.1 and Phase 4.2 implementation changes are already represented by the committed baseline above; this handoff does not describe them as uncommitted.

## Bugfix baseline

The bugfix was started from the clean baseline:

- `HEAD 379f94f` — `Add YOLO coverage and FOV color modes`.
- Branch: `codex/multi-cam`, tracking `origin/codex/multi-cam`.
- Working tree was clean before editing; no staged changes or unrelated baseline changes were present.

## YOLO Coverage contract

- `portcam-yolo-coverage.js` is pure and non-persistent. It can consume an existing Phase 4.1 Comparison result or use the same `getObservation(cameraId, targetId)` callback; it does not create a second Observation cache.
- Scope is enabled Cameras only (`enabled !== false`); hidden but enabled Cameras remain rows. Disabled Cameras are excluded and counted.
- Only `calculationState === "current"` and `visibilityState === "visible"` Observations receive a tier:
  - `≥ 32 px` — Robust
  - `16–<32 px` — Usable
  - `8–<16 px` — Difficult
  - `< 8 px` — Not recommended
- Outside HFOV/VFOV/FOV receives `Outside FOV` and never receives a tier, even when its pixel value is large. Idle/unavailable and failed calculations receive no tier and show `—` for tier/P3/P4/P5.
- Workspace rows use Current Target Observation `yolo.shortSidePx`, `p3Cells`, `p4Cells`, and `p5Cells`. The workspace explicitly states that the map uses a different planning reference.
- The warning is shown verbatim: `Pixel thresholds are site-planning heuristics, not guaranteed YOLO detection performance.`

## FOV color mode contract

- `uiState.fovColorMode` is `"coverage"` by default; invalid setter values fall back to `"coverage"`.
- `setFovColorMode(mode)` is UI-only: it is excluded from `camera-project/1.0` and `camera-scene/1.1`, does not increment revision, history, or dirty state, and Undo/Redo does not change it.
- The only segmented control is in the YOLO Coverage toolbar. Map Settings has no duplicate control.
- `camera` mode renders every visible, placed Camera with its identity-colored boundary/centerline/fill; the enabled Active Camera receives stronger outline/fill styling, disabled Cameras remain low-opacity neutral dashed outlines, no Camera receives pixel bands, and the whole map legend is hidden.
- `coverage` mode renders every enabled, visible, placed Camera with neutral FOV boundary/centerline and no identity fill; every eligible Camera receives its complete clipped green, yellow, orange, and red (`< 8 px`) bands. Active Camera emphasis is limited to weight, opacity, and layer order.
- Bands use `planningTargetHeightM` and are clipped to the existing near/far envelope, horizon distance, and 30 km maximum. Hidden, disabled, draft, or unlocated Cameras do not render coverage bands; disabled Cameras retain only the neutral dashed outline.
- The Pixel coverage legend is Coverage-only. Its title row is a Pointer Events drag handle with pointer capture, Escape rollback, 8/24 px keyboard movement, Reset, session-local coordinates, and workspace-bound clamping above the Leaflet zoom control by default. Camera colors hides the entire legend.

## Changed files

- `index.html` — loads the pure YOLO module, gives the legend a mount point, and replaces the Phase 4.1 placeholder wiring/version label.
- `app.css` — YOLO toolbar, summary, fixed-column local-scroll table, active-row state, segmented control, compact responsive layout, and bounded draggable legend styles.
- `portcam-store.js` — UI-only `fovColorMode` default/fallback/setter.
- `portcam-map.js` — four clipped coverage ranges, red band, mutually exclusive mode branches, neutral Coverage FOV geometry, and identity/coverage color constants.
- `portcam-ui.js` — YOLO derivation/rendering, summary/table/empty states, mode control, session-local draggable legend controller, and click/Enter/Space Camera activation.
- `portcam-yolo-coverage.js` — pure tier/status/count derivation.
- `test_yolo_coverage.js` — tier boundaries, visibility/status rules, enabled/hidden filtering, summaries, disabled Target behavior, and Comparison reuse.
- `test_portcam_store.js` — UI-only mode isolation and Undo/Redo behavior.
- `test_portcam_map.js` — four-band clipping, all-eligible-Camera coverage, exclusion rules, neutral Coverage geometry, and Camera colors mode.
- `output/playwright/phase42-yolo-1366.png`, `output/playwright/phase42-yolo-1920.png`, `output/playwright/phase42-yolo-1920-dpr2.png` — Phase 4.2 browser evidence.
- `output/playwright/phase42-ui-bugfix-1366.png`, `output/playwright/phase42-ui-bugfix-1920.png`, `output/playwright/phase42-ui-bugfix-1920-dpr2.png` — UI bugfix browser evidence.

## Verification

Final Node suite:

```text
node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js test_camera_comparison.js test_yolo_coverage.js
```

Result: **35/35 passed**. This includes the committed Phase 4.1 and Phase 4.2 baseline coverage.

Focused checks also passed:

```text
node --test test_yolo_coverage.js                         # 5/5
node --test test_portcam_store.js test_portcam_map.js     # 17/17
node --check portcam-yolo-coverage.js
node --check portcam-store.js
node --check portcam-map.js
node --check portcam-ui.js
git diff --check
```

Python tests were not run because no Python code or Scene consumer contract changed.

## Browser smoke evidence

- Host: `http://127.0.0.1:8765/index.html`.
- Browser: real Microsoft Edge through Playwright CLI, isolated persistent temporary profiles. The skill's Bash wrapper is not usable on this Windows environment, so the same bundled `@playwright/cli` was run through direct `npx`.
- In-memory smoke data exercised two overlapping placed Cameras, a Current Target, and temporary map/workspace state. No project file, localStorage entry, or analysis result was persisted.
- Verified YOLO tab is no longer a placeholder; summary counts and rows agree; hidden enabled Camera is included; disabled Target keeps rows Unavailable; no Target/no enabled Camera empty states render; mode switching updates bands and legend; Camera row click, Enter, and Space select the Active Camera while preserving Current Target, YOLO tab, and expanded Workspace.
- Verified Camera optics, Target position, and Camera enabled-state changes refresh the table/summary/map immediately; temporary browser changes were undone.
- Verified Camera colors has zero bands for both Cameras and hides the entire legend; Pixel coverage has four bands for both Cameras with neutral FOV geometry and no identity fill.
- Verified mouse drag, `pointerType="touch"` Pointer Events drag, keyboard movement (8 px and Shift 24 px contract), Reset, Escape rollback, mode-switch position retention, and reload-to-default behavior. Legend interaction did not change Store revision/history/dirty state and did not activate map placement.
- Verified default Legend positioning above Leaflet zoom control, 8 px workspace bounds, resize clamping, 1366×768, 1920×1080, and 1920×1080 DPR2. Body had no overflow in all three required layouts.
- Console after the interactions: **0 errors, 0 warnings** in both normal and DPR2 Edge sessions.
- Body/layout checks:
  - 1366×768: no body overflow; table overflow remained local to its table scroll container.
  - 1920×1080: no body overflow.
  - 1920×1080 DPR2: no body overflow; workspace/table remained within bounds.

Screenshots:

- `output/playwright/phase42-yolo-1366.png`
- `output/playwright/phase42-yolo-1920.png`
- `output/playwright/phase42-yolo-1920-dpr2.png`
- `output/playwright/phase42-ui-bugfix-1366.png`
- `output/playwright/phase42-ui-bugfix-1920.png`
- `output/playwright/phase42-ui-bugfix-1920-dpr2.png`

## Deviations and remaining acceptance gates

- Browser data was deterministic in-memory smoke data; it was not saved as a project fixture.
- The default unrequested 1280 viewport places the existing inspector overlay over the workspace; required 1366/1920 acceptance viewports were verified separately.
- Physical/manual gates remain separate and are not claimed complete: physical wheel-detent behavior; physical Camera/Target drag parity and lock behavior; physical stylus hardware review beyond the real-browser `pointerType="touch"` path; physical Target click/drag while over selected-Camera FOV/YOLO geometry; NVDA/screen-reader review; base-map/network and Surface water/land/unknown visual review; Scene download behavior and downstream Scene consumer handoff.

## Next-phase entry conditions

Phase 5 or the next analysis phase may enter when:

1. This handoff and the Phase 4.1 handoff are accepted without requiring schema or Observation-cache changes.
2. The 35/35 Node suite, syntax checks, and `git diff --check` remain green on the next working tree.
3. The 1366×768, 1920×1080, and DPR2 browser smoke gates remain green, including active Camera keyboard selection, local table scrolling, marker interaction, and zero console errors.
4. The remaining Phase 3 manual gates above are explicitly accepted or assigned; no new Camera/Target pairing or persisted analysis-result model is introduced.
