# Phase 5.1 Handoff — Camera Defaults

## Status

- Phase 5.1 Camera Defaults is committed on `codex/multi-cam` as `2dfb027` (`Add Phase 5.1 project camera defaults settings`); the live checkout verified that `HEAD` and `origin/codex/multi-cam` were aligned before Phase 5.2 work began.
- The verified pre-Phase-5.1 Git baseline was `6d85dc2`. Phase 5.2 Camera Preset Library changes are intentionally separate and currently live in the working tree; they do not rewrite or replace the Phase 5.1 commit.
- Camera project/scene schemas, Store persistence, FOV/YOLO formulas, Observation cache, and the Python consumer remain unchanged.

## Camera Defaults contract

- `portcam-camera-defaults.js` provides the independent, dependency-injected repository for `camera-defaults/1.0`.
- The persisted payload contains only `heightM`, `tiltDownDeg`, `sensorWidthMm`, `sensorHeightMm`, `widthPx`, `heightPx`, and `focalLengthMm`.
- Factory values match the existing `DEFAULT_CAMERA` optical/installation values. Heading remains the existing 90° value in the Camera model and is not part of defaults.
- Reads validate the complete payload and fall back atomically to Factory Defaults on missing fields, extra fields, invalid values, version mismatch, malformed JSON, or storage exceptions. Writes preserve the previous value when storage is unavailable or throws. Repository results and getters use defensive copies.

## Application semantics

- `PortCamUI.defaultProject({cameraDefaults})` applies validated defaults to the initial `Camera A`.
- Each two-stage Camera placement takes a defaults snapshot at start; preview and final Camera use that snapshot while Heading remains determined by the placement direction.
- Project Settings saves only the repository. It does not mutate existing Cameras, revisions, history, dirty state, or Observations.
- Inspector Reset uses the current repository defaults in one `patchCamera` transaction, preserves Camera identity/position/Heading/colour/status, invalidates Observation normally, and is disabled for Locked Cameras. Undo/Redo covers the transaction.

## Project Settings UI

- Top Bar `Project Settings` opens an independent centered modal; `Map Settings` remains its map-only popover.
- The 5.1 fix presents the modal as a vertical Camera/Target accordion. Camera is expanded by default and contains all Camera Defaults; Target is collapsed by default and contains only a reservation note. Native buttons expose `aria-expanded`/`aria-controls` and are keyboard-operable.
- This fix adds no Target Defaults schema, localStorage entry, or editable Target fields.
- The modal supports Use Selected Camera, Restore Factory Defaults (draft-only), Save Defaults, Cancel, close button, Escape, backdrop close, initial focus, focus trap, and focus restoration.
- Sensor and resolution preset/Custom behavior shares the Inspector preset definitions. Opening the modal cancels any unfinished Camera placement preview.
- Storage read/write failures expose an actionable error while retaining the existing stored/current defaults.

## Verification

- Node: `node --test test_camera_defaults.js test_portcam_core.js test_portcam_store.js test_portcam_map.js test_camera_comparison.js test_yolo_coverage.js` — 46/46 passed.
- Static: `node --check` passed for every root JavaScript file, and `git diff --check` passed.
- Browser smoke used the real local app at 1366×768, 1920×1080, and iPad Pro 11/DPR2 emulation. It covered modal open/close, initial focus, focus trap, Cancel focus restoration, Custom sensor/resolution, Save/reload persistence, Use Selected Camera, Restore Factory draft-only behavior, Reset plus Undo/Redo, Locked Reset disabled, and placement preview cancellation. Console errors/warnings were zero in the tested contexts.
- Python tests were not run as requested; this phase does not modify Python, schemas, or downstream calculation consumers.

## Acceptance boundary

Automated Node tests and real-browser smoke establish repository, Store, modal, responsive, and keyboard behavior. They do not replace final manual review of physical drag/touch behavior, screen-reader announcements, browser-specific storage policy/quota UX, or downstream device/Scene consumer acceptance.
