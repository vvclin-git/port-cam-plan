# Phase 5.4 Handoff — Project New / Open / Save

## Status

- Phase 5.4 is implemented in the current working tree on `codex/multi-cam` and remains uncommitted for acceptance review.
- The verified baseline is Phase 5.3 commit `5c6a8ad` (`Add Phase 5.3 camera preset library transfer`). The prior Phase 5.1 and 5.2 commits are `2dfb027` and `97c45d9`.
- No reset, overwrite, reconstruction, Project schema migration, or Python/downstream consumer change was performed.

## Project contract and validation

- `portcam-project.js` adds strict `camera-project/1.0` validation and defensive-copy helpers. It accepts the existing top-level Project contract plus the optional `map` field; older valid files without `map` remain valid.
- Validation rejects future or wrong schemas, extra fields, missing fields, duplicate Camera/Target IDs, invalid IDs/names/settings, coordinates, dimensions, optics, headings, statuses, and map ranges. `DEFAULT_MAP` is the harbor view `{22.61, 120.28, zoom 15}`.
- Camera Defaults and Preset Library remain browser-local preferences and are not embedded in Project files. Camera/Target values, settings, and optional map viewport are saved directly in `camera-project/1.0`.

## Store and map behavior

- `replaceProject(validatedProject)` atomically installs a validated Project, clears preview/history/redo/Observation cache, establishes a clean baseline, restores first Camera/Target selection and focus, and resets UI mode/panels/search state.
- `renameProject(name)` is one undoable Store transaction. `markSaved(project)` captures the saved canonical Project and map without creating history.
- Map pan/zoom remains UI-only. Save captures the current viewport; Open restores it, while a valid legacy file without `map` fits all objects or uses `DEFAULT_MAP` when empty.

## Project UI and workflow

- The accessible top-bar Project menu provides New Project, Open Project, Save Project As, and Rename Project.
- New uses the current Camera Defaults, creates a new Project ID and initial Camera A, clears Project runtime/history state, and restores the default harbor viewport.
- Native Save/Open pickers are used when available. Save falls back to a Blob download with a sanitized `<Project name>.portcam.json` filename. Native writes mark clean only after stream close; fallback reports `下載已啟動` after download creation. Open validates the complete file before mutation.
- Dirty New/Open flows provide Save/Discard/Cancel. Rename, dirty guards, status/error messaging, Escape handling, focus restoration, menu/dialog ARIA roles, and `beforeunload` are implemented.

## Verification

- Node: `node --test test_portcam_project.js test_camera_preset_transfer.js test_camera_presets.js test_camera_defaults.js test_portcam_core.js test_portcam_store.js test_portcam_map.js test_camera_comparison.js test_yolo_coverage.js` — 66/66 passed.
- Static: all root JavaScript files pass `node --check`; `git diff --check` passes.
- Browser smoke used the real local app at 1366×768 and 1920×1080, plus iPad Pro 11 emulation at DPR2. It covered Project menu keyboard roles, Settings focus behavior, New, dirty Save/Discard/Cancel, Rename with Undo history, native Save cancellation, fallback download and file content, fallback Open and reload state, viewport reset, responsive body sizing, and zero console messages in the DPR2 run.
- Python tests were not run as requested; this phase does not modify Python or downstream calculation consumers.

## Acceptance boundary

Automated tests and real-browser smoke establish Store, validation, fallback, responsive, keyboard, and persistence behavior. Final manual acceptance remains required for native OS picker UX, actual browser download completion/permissions, screen-reader announcements, and browser-specific close/reload `beforeunload` behavior.

## Working tree handoff

- Phase 5.4 remains uncommitted by instruction. The handoff and implementation files are intentionally left for review; no commit was created in this phase.
