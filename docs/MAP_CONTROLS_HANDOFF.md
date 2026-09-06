# Map controls handoff — 2026-09-06

Implements [issue #3 comment 5556392880](https://github.com/vvclin-git/port-cam-plan/issues/3#issuecomment-5556392880) on the clean `6a664b5` baseline, branch `codex/multi-cam`. Changes are left uncommitted.

## Delivered behavior

- `settings.pixelCoverageReferenceSizeM` is a positive finite Project number. New/legacy normalization installs the independent baseline value before dirty/history tracking: explicit valid size, otherwise valid `planningTargetHeightM`, otherwise 2 m. Invalid explicit values reject instead of falling back. Store updates preserve the value through one transaction, Undo/Redo and serialization.
- `camera-project/1.0` remains the identifier. New code reads old files; old strict field whitelists may reject new files. `camera-scene/1.1` does not include the field. Height/horizon/FOV, Target dimensions, Observation/YOLO and Coverage Audit retain their existing semantics.
- Only map 32/16/8 px range thresholds use the reference size. Existing near/far, horizon and 30 km clipping still apply. This simplified shared size is not a projected vessel dimension or a guarantee of detection/audit qualification.
- Legend input previews through a temporary map presentation snapshot. Enter/blur commits once; unchanged, Escape and invalid edits create no history. Invalid completion restores the committed value and displays a short message. Runtime `projectEpoch` invalidates drafts on replacement/Undo/Redo, including opening the identical Project. It is not exported. Input events are separated from the title drag handle and map gestures.
- Camera colors has a global localStorage preference at `portcam.cameraFillOpacity`. Default 0.16, range 0–1 (slider 0–100%, 1% increments); focused fill is `min(1, preference * 1.5)`, placement preview multiplies by 0.4, disabled fill is zero. Zero preference gives zero focused fill. Outline, centerline, Pixel coverage and Surface styling are unchanged. Reload/reset, corrupt storage and unavailable storage are supported without Project mutations.
- Leaflet metric scale sits above bottom-right attribution. The status banner reserves space above it. Map controls use separate rows from placement controls; legend bounds account for top controls, bottom controls and an overlaid Inspector. Narrow layouts do not expand the map beyond the viewport. On very narrow layouts, close panels or use Focus map to expose the working map area.

## Verification performed

- `node --test test_*.js`: **82/82 passed** (baseline 78/78). New tests cover migration/defaults, invalid size and height rejection, atomic failed replacement, independent height changes, round-trip, clean baseline, unchanged transaction, Undo/Redo, proportional unclipped ranges, 30 km clipping, unchanged Scene/Observation/entities/Coverage Audit and bounded fill derivation. `git diff --check` passed.
- Real Chromium via Playwright against localhost: live band geometry changes and exact Escape restoration; preview stays clean; Enter + blur only one commit; blur commit; invalid/unchanged rollback; Undo cancels draft; Redo updates the legend; identical Project replacement clears old preview; file-input Open migrates legacy size and preserves Project on invalid input.
- Keyboard slider zero/increment, zero fill through zoom, reload, Reset, corrupt preference and throwing Storage get/set methods passed. Scale text changes on zoom. These UI controls leave the Project unchanged.
- Real mouse Camera and Target marker drags each changed position, incremented revision/history exactly once, and cleared preview. Legend mouse drag left map viewport and Project/history unchanged. Reference input and slider were clicked/edited successfully.
- Layout exercised at 1600, 1280, 900 and 480 px widths with normal/Focus map states (narrow normal states had panels closed). Final 480×600 opacity and 480×900 reference/scale screenshots were inspected. Explicit FOV button accessible names remain available when narrow labels replace wide text.
- OSM, NLSC EMAP and NLSC PHOTO tiles loaded and were visually compared with one and two overlapping Cameras plus a Target, at 16%/24% focused fill. OSM/EMAP retain road/map details; PHOTO retains image texture; the blue/purple overlap and stronger focused outline remain distinguishable. This supports the 16% default without requiring separate basemap preferences. Snapshot comparison is visual evidence, not a universal contrast guarantee.

## Acceptance limits and follow-up

No physical touch/stylus device or screen-reader acceptance was performed. File-input Open was exercised; native OS picker and physical-device Save workflows were not re-certified. Screenshots and mouse automation do not establish those device gates. FOV bearing handles, precise line/path measurement, per-Camera settings and Map Settings redesign remain outside this delivery.

README, CHANGELOG and the UI architecture document describe the independent reference size, compatibility direction, opacity preference and scale limitations. Local browser scripts/screenshots are retained as session artifacts outside the source tree.
