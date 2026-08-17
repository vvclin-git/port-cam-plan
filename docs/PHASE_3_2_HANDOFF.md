# Phase 3.2 Handoff

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
- Final Node suite: 23/23 passed, including Object Manager focus/state isolation.
- `node --check portcam-store.js`, `node --check portcam-ui.js`, and `git diff --check` passed (only existing CRLF warnings).
- Bundled Edge smoke verified Object Manager Target search, row focus, hidden legacy Result Drawer, Context Details/Observation switching, preserved Observation pairing, and Camera details. Screenshot: `output/playwright/phase32-object-manager.png`.
- Browser mouse drag smoke moved a real Target marker across multiple pointer steps and asserted one Store history transaction; Map contract tests also assert preview does not rebuild the Target icon.

## Remaining gates

Physical wheel-detent behavior, Camera/Target mouse drag parity, Target click inside FOV/YOLO geometry, NVDA, network base-map/Surface validation, and Scene consumer handoff remain manual gates from Phase 3.1. Phase 4 may add only Comparison/YOLO analysis after those gates; it must not change schemas, spherical-v1, ray casting, DEM, EPSG:3826, or 3D Target scope.
