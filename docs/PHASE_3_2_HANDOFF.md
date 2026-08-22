# Phase 3.2 Handoff

> This is a historical Phase 3.2 handoff. The current committed repository is `29b753e`; Phase 4.1–4.4 supersede the old placeholder and uncommitted-work wording below. See [`PHASE_4_4_HANDOFF.md`](PHASE_4_4_HANDOFF.md) for the current panel, focus, FOV, placement, and heading behavior.

## Phase 3.3 independent analysis context — 2026-08-18

- Camera selection is now expressed as Active Camera and Target selection as Current Target. They remain independent object selections; Observation is a runtime calculation of the Current Target observed by the Active Camera, not a saved or permanent pair.
- Observation header/subtitle and badge now use Current Target／Active Camera language and report Visible, Outside FOV, Unavailable, or Failed. Its three empty states distinguish missing Active Camera, missing Current Target, and both missing.
- No project, scene, Camera, Target, Observation-cache, selection, history, revision, or dirty-state contract changed. `getObservation(cameraId, targetId)` and its runtime cache key remain calculation internals only.
- Verification: `node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js` passed 23/23; `python -m unittest -v test_ray_cast_test.py` passed 14/14; `node --check` passed for Store, Map, and UI; `git diff --check` passed. Edge smoke alternated Active Camera／Current Target, checked visible and outside-FOV badges plus all three empty states, and reported no console errors.

## Object Manager row hierarchy and overflow — 2026-08-18

- Baseline was clean at `e9d19fc` (`Fix scene export and repeated target placement`). The row polish is committed and pushed as `282eae8` (`Refine object manager row actions`).
- Camera and Target rows now share a 64px two-line grid: identity marker, ellipsized name and overflow button on the first line; position plus Visible／Enabled／Locked controls on the second line. Target uses a compact crosshair identity instead of a white dot.
- Rename, Fit on map, Duplicate, and Delete moved into a single fixed body-level overflow popover. It is keyboard tabbable; closes on outside click, Escape (returning focus), row/tab change, action, and list scroll; it uses no Store state and therefore remains UI-only.
- Edge smoke added 30 long-name Targets, verified stable row heights and no horizontal list scroll, checked row keyboard selection and non-selecting status controls, exercised overflow open/close, tab-close, Duplicate, and ran at 100% and DPR 2. Screenshot: `output/playwright/object-manager-row-narrow.png`.

## Export and continuous Target creation bugfix — 2026-08-17

- Baseline was clean at `478f003` (`Polish Phase 3.2 object management UI`) with 23/23 Node tests passing.
- Removed the direct `downloadCameraScene` and `copyCameraScene` listeners. Context Inspector event delegation is now the only export trigger, so one click creates one Blob URL/download link or one clipboard write; the Blob URL is still revoked after download.
- Split Target creation into `createTargetFromForm()`, `createTargetFromMap(latlng)`, and `addTargetFromDraft(targetDraft)`. Map placement no longer reads Context Inspector inputs and always uses the documented default dimensions, state flags, anchor, and lifecycle.
- Add Target now only enters `place-target`, preserving the existing Camera/Target selection and focus until the map click. Each map placement adds one history entry, selects/focuses the new Target, returns to navigate, and opens Observation.
- Edge smoke counted single and double export/copy clicks, created three consecutive Targets while Observation was open, cancelled a fourth placement, then undid/redid the three adds without console errors. Screenshot: `output/playwright/phase32-export-target-bugfix.png`.

## UI polish — 2026-08-17

- Baseline was clean at `b523d1d` (`Fix Target marker drag preview`); the original Phase 3.2 UI commit is `250fe71`.
- Removed the Top Bar Observation shortcut, Camera Open Result action, and legacy Result Drawer DOM. Context Inspector is the single entry point: its Details／Observation tabs preserve focused entity and independent Camera/Target analysis inputs.
- Object Manager is the sole Visible／Enabled／Locked control surface. Camera/Target Details show state badge and locked guidance only.
- Target Details now uses collapsible Position & Orientation, Dimensions & Coverage, and Actions sections. Observation contains relationship metrics plus Fit Target/Fit Camera + Target only. `activeResultTab` remains a deprecated Store API for compatibility, but the UI no longer uses it.
- Target preview updates existing fields without rebuilding the renderer for the same focused target/tab. The Target drag regression test now drives multiple preview moves and asserts no `setIcon()` call before or after the single commit.

## Delivered scope

Phase 3.2 was initially implemented on the existing uncommitted Phase 3.1 worktree. It was subsequently incorporated into the committed branch; this historical handoff does not imply that the current Phase 4 implementation remains uncommitted.

- Left-side Object Manager replaces the Camera Rail and Bottom Workspace Targets view. Cameras and Targets use one row renderer with tab, search, focus, selection, visible, enabled, locked, Fit, duplicate, and delete operations.
- Right-side Context Inspector replaces the visible Camera Inspector/Result Drawer split. Details follows `focusedEntity`; Observation calculates the Current Target with the independent Active Camera selection.
- Bottom Workspace retained Camera Comparison and YOLO Coverage placeholders at the Phase 3.2 boundary; Phase 4.1／4.2 later implemented both derived analysis surfaces.
- MapController was retained: shared marker drag, labels, panes, non-interactive geometry, Target-in-FOV click behavior, and wheel controller are unchanged.
- Fixed a Target-only drag regression: preview no longer replaces the active `L.divIcon`; icon replacement is limited to selected/locked/enabled style changes, preserving Leaflet pointer capture throughout the drag.

## UI-only Store contract

`uiState` now includes `objectManagerTab`, `focusedEntity`, `inspectorTab`, `cameraSearchQuery`, and `targetSearchQuery`. The Store exposes matching UI-only setters. They are excluded from `camera-project/1.0`, history, revision, and dirty state; Camera/Target selection remains independent. Delete fallback repairs focus using same-kind selection.

## Verification

- Recorded Phase 3.1 baseline before edits: dirty worktree and 22/22 Node tests passed.
- Final Node suite: 23/23 passed, including Object Manager focus/state isolation and repeated Target drag preview/commit icon assertions.
- `node --check portcam-store.js`, `node --check portcam-map.js`, `node --check portcam-ui.js`, `python -m unittest -v test_ray_cast_test.py` (14/14), and `git diff --check` passed (only existing CRLF warnings).
- 2026-08-17 bundled Edge smoke verified no Top Bar Observation/legacy Drawer/status checkboxes, coordinate Target creation → Observation, Details section layout, focused Target input stability during preview, Object Manager accessible status actions, and close/reopen Inspector tab retention. Screenshot: `output/playwright/phase32-ui-polish.png`.
- Browser mouse drag smoke from the Target drag fix remains the regression evidence for a real marker multi-step move and one Store history transaction; Map contract tests additionally assert preview and drag-end do not rebuild the Target icon.

## Remaining gates

Physical wheel-detent behavior, Camera/Target mouse drag parity, Target click inside FOV/YOLO geometry, NVDA, network base-map/Surface validation, and Scene consumer handoff remain manual gates from Phase 3.1. Phase 4 may add only Comparison/YOLO analysis after those gates; it must not change schemas, spherical-v1, ray casting, DEM, EPSG:3826, or 3D Target scope.
