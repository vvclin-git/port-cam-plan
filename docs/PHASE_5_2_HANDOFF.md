# Phase 5.2 Handoff — Camera Preset Library

## Status

- Phase 5.2 is committed on `codex/multi-cam` as `97c45d9` (`Add Phase 5.2 camera preset library`).
- It is based on the committed Phase 5.1 closeout fix `2dfb027` (`Add Phase 5.1 project camera defaults settings`). Phase 5.3 Camera Preset Library transfer changes are separate and currently live in the working tree; neither earlier commit is rewritten or replaced.
- This phase does not modify `camera-project/1.0`, `camera-scene/1.1`, Store persistence, FOV/YOLO formulas, Observation caching, or the Python consumer.

## Preset repository contract

- `portcam-camera-presets.js` provides an independent dependency-injected repository for `camera-presets/1.0` at `port-cam-plan.camera-presets`.
- Custom presets contain only a stable `id`, trimmed unique `name`, and the seven validated Camera Defaults settings. Factory Defaults is a built-in read-only entry and is never written to the preset storage key.
- The repository uses the Camera Defaults validator, returns defensive copies, sorts custom presets deterministically by case-insensitive name and ID, and rejects empty/duplicate names, invalid settings, malformed payloads, wrong versions, duplicate IDs, extra fields, and Factory Defaults mutations.
- Corrupt preset storage falls back to Factory Defaults only and does not clear or migrate the independent Camera Defaults repository. Storage read/write failures expose the error and retain the previous valid library when a write fails.

## Project Settings

- The existing centered Project Settings modal keeps the Phase 5.1 vertical Camera/Target accordion. Preset Library is inside the Camera panel; Target remains a reservation-only description with no Target schema, storage key, or editable fields.
- The Camera panel lists Factory Defaults and custom presets and supports creating from the current form or Selected Camera, loading into the draft form, setting a preset as the current Camera Defaults, updating, renaming, duplicating, and confirming deletion.
- Load into Form changes only the modal draft. Set as Default immediately saves Camera Defaults and synchronizes the form; closing or Cancel does not undo that direct save. Preset CRUD and Set as Default do not dirty the Project or create history.
- Factory Defaults cannot be renamed, updated, or deleted. Duplicate generates a non-conflicting name. Failed storage operations leave the previous library intact and show an actionable status/error.

## Camera Inspector

- Sensor & Lens includes a compact Camera Preset selector and Apply action. Selecting a preset is draft-only; Apply is required to mutate the Camera.
- Apply copies exactly the seven preset fields in one `patchCamera` transaction, preserves identity/name/position/Heading/colour/status, follows normal revision/dirty/Observation invalidation and Undo/Redo behavior, and is disabled for a Locked Camera.
- Inspector options are rebuilt after repository changes so rename/delete/duplicate are reflected immediately. A missing or locked Camera cancels the apply with an explanatory status.

## Verification

- Node: `node --test test_camera_presets.js test_camera_defaults.js test_portcam_core.js test_portcam_store.js test_portcam_map.js test_camera_comparison.js test_yolo_coverage.js` — 53/53 passed.
- Static: all root JavaScript files pass `node --check`; `git diff --check` passes.
- Browser smoke used the real local app at 1366×768, 1920×1080, and DPR2 emulation. It covered Project Settings preset creation, update, Load into Form, Set as Default, reload persistence, Inspector Factory Apply, one-transaction Undo/Redo, Locked Apply disabled, modal/accordion continuity, and zero console errors/warnings.
- Python tests were not run as requested; this phase does not modify Python or downstream calculation consumers.

## Acceptance boundary

Automated repository/Store tests and real-browser smoke establish data, mutation, persistence, responsive, and keyboard behavior. They do not replace final manual review of screen-reader announcements, browser-specific quota/storage-policy UX, physical drag/touch behavior, or downstream device/Scene consumer acceptance.
