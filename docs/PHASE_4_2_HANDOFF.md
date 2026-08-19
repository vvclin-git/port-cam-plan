# Phase 4.2 Handoff — YOLO Coverage 與 FOV 著色模式

## Status

- Phase 4.2 implementation is complete in the working tree; no commit, reset, push, or remote mutation was performed.
- The implementation checkout is `D:\Workplace\port-cam-plan` on branch `codex/multi-cam`. The user-facing C: OneDrive link currently exposes only `UI_ARCHITECTURE.md`; it is not the Git checkout.
- Phase 4.1 Comparison changes remain intact and uncommitted.

## Phase 4.1 baseline preserved before editing

The baseline was captured before any Phase 4.2 edit:

- `HEAD 5585820` — `Clarify independent observation context`.
- Branch: `codex/multi-cam`, tracking `origin/codex/multi-cam`.
- No staged changes.
- Pre-existing status:

  ```text
   M app.css
   M index.html
   M portcam-ui.js
  ?? docs/PHASE_4_1_HANDOFF.md
  ?? output/playwright/phase41-comparison-1920-dpr2.png
  ?? portcam-comparison.js
  ?? test_camera_comparison.js
  ```

- Pre-existing tracked diff: `app.css` 21 lines, `index.html` 6 lines, and `portcam-ui.js` 74 lines changed (`88 insertions`, `13 deletions`). The complete pre-edit diff was inspected with `git diff --no-ext-diff --binary`; the untracked Phase 4.1 files above were inspected separately and preserved.
- Phase 4.1 baseline command, run before Phase 4.2 edits:

  ```text
  node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js test_camera_comparison.js
  ```

  Result: **28/28 passed**.

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
- `camera` mode renders visible Camera envelopes with identity colors, stronger Active Camera outline/fill, no pixel bands, and an identity legend.
- `coverage` mode renders identity-colored FOV boundaries/centerline, and only the enabled Active Camera receives up to four existing-palette bands: green, yellow, orange, and red (`< 8 px`). Non-active Cameras retain only low-intensity identity outlines.
- Bands use `planningTargetHeightM` and are clipped to the existing near/far envelope, horizon distance, and 30 km maximum. Hidden, disabled, draft, or unlocated Active Cameras do not render bands.

## Changed files

- `index.html` — loads the pure YOLO module, gives the legend a mount point, and replaces the Phase 4.1 placeholder wiring/version label.
- `app.css` — YOLO toolbar, summary, fixed-column local-scroll table, active-row state, segmented control, compact responsive layout, and dynamic legend support.
- `portcam-store.js` — UI-only `fovColorMode` default/fallback/setter.
- `portcam-map.js` — four clipped coverage ranges, red band, mode-aware rendering, and identity/coverage color constants.
- `portcam-ui.js` — YOLO derivation/rendering, summary/table/empty states, mode control, dynamic legend, and click/Enter/Space Camera activation.
- `portcam-yolo-coverage.js` — pure tier/status/count derivation.
- `test_yolo_coverage.js` — tier boundaries, visibility/status rules, enabled/hidden filtering, summaries, disabled Target behavior, and Comparison reuse.
- `test_portcam_store.js` — UI-only mode isolation and Undo/Redo behavior.
- `test_portcam_map.js` — four-band clipping and Camera colors mode.
- `output/playwright/phase42-yolo-1366.png`, `output/playwright/phase42-yolo-1920.png`, `output/playwright/phase42-yolo-1920-dpr2.png` — browser evidence.

## Verification

Final Node suite:

```text
node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js test_camera_comparison.js test_yolo_coverage.js
```

Result: **35/35 passed**. This includes the original Phase 4.1 28 tests.

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
- Browser: real Microsoft Edge through Playwright CLI, isolated persistent temporary profile. The skill's Bash wrapper could not start on this Windows environment, so the same bundled `@playwright/cli` was run through direct `npx`.
- In-memory smoke data exercised four visible tier Cameras, Outside FOV, Unavailable draft Camera, and one disabled excluded Camera. No project file or analysis result was persisted.
- Verified YOLO tab is no longer a placeholder; summary counts and rows agree; hidden enabled Camera is included; disabled Target keeps rows Unavailable; no Target/no enabled Camera empty states render; mode switching updates bands and legend; Camera row click, Enter, and Space select the Active Camera while preserving Current Target, YOLO tab, and expanded Workspace.
- Verified Camera optics, Target position, and Camera enabled-state changes refresh the table/summary/map immediately; temporary browser changes were undone.
- Verified Camera colors has zero bands and identity legend; Pixel coverage has four bands for the Active Camera and no bands for non-active Cameras. Target marker click remained active while SVG analysis paths reported `pointer-events: none`.
- Console after the interactions: **0 errors, 0 warnings**.
- Body/layout checks:
  - 1366×768: no body overflow; table overflow remained local to its table scroll container.
  - 1920×1080: no body overflow.
  - 1920×1080 DPR2: no body overflow; workspace/table remained within bounds.

Screenshots:

- `output/playwright/phase42-yolo-1366.png`
- `output/playwright/phase42-yolo-1920.png`
- `output/playwright/phase42-yolo-1920-dpr2.png`

## Deviations and remaining acceptance gates

- Browser data was deterministic in-memory smoke data; it was not saved as a project fixture.
- The default unrequested 1280 viewport places the existing inspector overlay over the workspace; required 1366/1920 acceptance viewports were verified separately.
- Physical/manual Phase 3 gates remain separate and are not claimed complete: physical wheel-detent behavior; physical Camera/Target drag parity and lock behavior; physical Target click/drag while over selected-Camera FOV/YOLO geometry; NVDA/screen-reader review; base-map/network and Surface water/land/unknown visual review; Scene download behavior and downstream Scene consumer handoff.

## Next-phase entry conditions

Phase 5 or the next analysis phase may enter when:

1. This handoff and the Phase 4.1 handoff are accepted without requiring schema or Observation-cache changes.
2. The 35/35 Node suite, syntax checks, and `git diff --check` remain green on the next working tree.
3. The 1366×768, 1920×1080, and DPR2 browser smoke gates remain green, including active Camera keyboard selection, local table scrolling, marker interaction, and zero console errors.
4. The remaining Phase 3 manual gates above are explicitly accepted or assigned; no new Camera/Target pairing or persisted analysis-result model is introduced.
