# Phase 5.3 Handoff — Camera Preset Library Import / Export

## Status

- Phase 5.3 is implemented in the current working tree on `codex/multi-cam` and remains uncommitted for acceptance review.
- The verified Phase 5.2 baseline is commit `97c45d9` (`Add Phase 5.2 camera preset library`), based on Phase 5.1 commit `2dfb027`. No reset, overwrite, or reconstruction was performed.
- This phase does not modify `camera-defaults/1.0`, `camera-presets/1.0`, `camera-project/1.0`, `camera-scene/1.1`, Store persistence, FOV/YOLO formulas, Observation caching, or the Python consumer.

## Transfer contract

- `portcam-camera-preset-transfer.js` provides `camera-preset-library/1.0` bundle validation, deterministic `buildBundle`, Merge/Replace `planImport`, and coordinator `applyImport` APIs.
- Bundles contain only `schemaVersion`, canonical `exportedAt`, the seven validated Camera Defaults fields, and custom presets. Factory Defaults is excluded from exports and remains built-in on import.
- Import validation is strict for top-level fields, schema version, timestamp, defaults, preset fields, IDs, names, settings, Factory ID masquerade, and duplicate IDs/names. Results use defensive copies.
- `portcam-camera-presets.js` now provides one-shot `replacePresets`/`replaceCustomPresets`, so Replace does not perform per-preset writes.

## Import semantics

- Merge preserves non-conflicting IDs, skips exact ID/name/settings duplicates, and allocates a new ID with `Name (Imported)`, `Name (Imported 2)`, and so on for ID or case-insensitive name conflicts.
- Replace removes all custom presets and retains the built-in Factory Defaults entry. The UI requires a second destructive confirmation before applying Replace.
- Import defaults are selected by default; clearing the checkbox preserves the local Camera Defaults. File selection creates a validated draft plan only. Cancel, close, or selecting another file discards the pending plan.
- The coordinator snapshots both repositories, writes defaults and presets only after a validated plan, and rolls back a successful defaults write if the later bulk preset write fails. Read fallback, validation, stale-plan, quota, and storage errors preserve the pre-import state and do not show success.

## Project Settings UI

- Camera Preset Library now includes Export Library and Import Library controls within the existing Camera accordion. Export filename format is `camera-preset-library-YYYYMMDD-HHmmss.json`.
- Import shows the selected file, Merge/Replace summary, defaults checkbox, Apply Import, and Cancel Import. Successful import immediately refreshes Project Settings and Inspector selectors and reports added, skipped, renamed, removed, and defaults counts.
- Export is blocked when either repository reports a read/fallback error. Import/export and repository persistence remain outside Project revision, history, dirty state, Camera/Target state, and Observation state.

## Verification

- Node: `node --test test_camera_preset_transfer.js test_camera_presets.js test_camera_defaults.js test_portcam_core.js test_portcam_store.js test_portcam_map.js test_camera_comparison.js test_yolo_coverage.js` — 60/60 passed.
- Static: all root JavaScript files pass `node --check`; `git diff --check` passes.
- Browser smoke used the real local app at 1366×768, 1920×1080, and iPad Pro 11/DPR2 emulation. It covered bundle download filename/content, draft-only import, Merge apply and reload persistence, Replace summary and second confirmation, defaults opt-out, Cancel without mutation, focus trap/Escape restoration, selector refresh, clean Project history, and zero console errors/warnings.
- Python tests were not run as requested; this phase does not modify Python or downstream calculation consumers.

## Acceptance boundary

Automated repository/coordinator tests and real-browser smoke establish transfer, rollback, persistence, responsive, and keyboard behavior. They do not replace final manual review of screen-reader announcements, browser-specific download permission/quota UX, physical touch behavior, or downstream device/Scene consumer acceptance.
