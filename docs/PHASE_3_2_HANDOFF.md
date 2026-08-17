# Phase 3.2 Handoff

## UI polish — 2026-08-17

- Baseline was clean at `b523d1d` (`Fix Target marker drag preview`); the original Phase 3.2 UI commit is `250fe71`.
- Removed the Top Bar Observation shortcut, Camera Open Result action, and legacy Result Drawer DOM. Context Inspector is the single entry point: its Details／Observation tabs preserve focused entity and selected Camera × Target pairing.
- Object Manager is the sole Visible／Enabled／Locked control surface. Camera/Target Details show state badge and locked guidance only.
- Target Details now uses collapsible Position & Orientation, Dimensions & Coverage, and Actions sections. Observation contains relationship metrics plus Fit Target/Fit Camera + Target only. `activeResultTab` remains a deprecated Store API for compatibility, but the UI no longer uses it.
- Target preview updates existing fields without rebuilding the renderer for the same focused target/tab. The Target drag regression test now drives multiple preview moves and asserts no `setIcon()` call before or after the single commit.

## Delivered scope

Phase 3.2 was implemented on the existing uncommitted Phase 3.1 worktree. No reset, commit, push, release, schema migration, import/save workflow, or remote mutation was performed.

- Left-side Object Manager replaces the Camera Rail and Bottom Workspace Targets view. Cameras and Targets use one row renderer with tab, search, focus, selection, visible, enabled, locked, Fit, duplicate, and delete operations.
- Right-side Context Inspector replaces the visible Camera Inspector/Result Drawer split. Details follows `focusedEntity`; Observation always uses independent `selectedCameraId × selectedTargetId` pairing.
- Bottom Workspace retains only Camera Comparison and YOLO Coverage placeholders.
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
