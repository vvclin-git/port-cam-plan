# Phase 4.4 Handoff — Map Focus & Camera Control Polish

## Status

- Phase 4.4 is implemented in the committed history on `codex/multi-cam`; the live checkout was verified at `6d85dc2` (`Document Phase 4.4 controls and current implementation status`) before Phase 5.1 work began.
- The previous `29b753e`/uncommitted documentation note was stale: the checkout was clean at that verified Phase 4.4 `HEAD`. Phase 5.1 was subsequently committed as `2dfb027`; Phase 5.2 Camera Preset Library changes are intentionally tracked in the current working tree and are documented separately in [`PHASE_5_2_HANDOFF.md`](PHASE_5_2_HANDOFF.md).
- Project/Scene schemas, Observation cache, spherical-v1 calculations, coverage formula, and public Map/Store contracts remain unchanged.

## Panel and Focus map contract

- The Top Bar exposes independent `Objects`, `Inspector`, and `Focus map` controls. Objects and Inspector use `aria-pressed`, `aria-expanded`, and `aria-controls`; their in-panel close buttons remain available.
- `uiState.panelOpen.objectManager` defaults to `true`. Closing Object Manager removes the rail/grid column without clearing tab, search, scroll, Active Camera, Current Target, or `focusedEntity`. Closing Inspector removes its column/overlay at every responsive breakpoint.
- `uiState.focusMapMode` defaults to `false` and is UI-only. Entering Focus map clears only `focusedEntity`, hides Object Manager/Inspector/Bottom Workspace, and preserves the underlying `panelOpen` values. Leaving restores that panel configuration while retaining the map toolbar, FOV control, Map Settings, status, and Coverage legend.
- Focus map applies a final single-column grid rule after the responsive panel rules, so the map remains full-width when either or both panels were open, including the DPR 2 layout path.
- Escape, blank Navigate map clicks, and explicit Focus map exit follow the interaction-priority rules. Marker/row refocus exits Focus map, updates the relevant Active/Current selection, sets `focusedEntity`, and opens Inspector Details. UI-only changes never affect revision, history, dirty state, Undo/Redo, or exports.

## Selection and map projection

- `selectedCameraId` remains Active Camera and `selectedTargetId` remains Current Target. `focusedEntity` is the visual/edit focus. `clearFocusedEntity()` only clears the latter.
- Camera/Target marker focus styling, bring-to-front behavior, FOV emphasis, and Navigate drag eligibility follow `focusedEntity`; the Active/Current context used by Observation, Comparison, and YOLO remains independent.
- Clearing focus removes the Inspector/row/marker focus emphasis without removing eligible Coverage bands or changing the Active/Current context.

## Heading scrubber contract

- Camera Details keeps the 0.1 precision number input and adds a full-width N/E/S/W horizontal `role="slider"` scrubber. Both controls are disabled for locked Cameras and share normalized `[0, 360)` values.
- Pointer Events with pointer capture provide mouse/touch/stylus drag. Drag uses Store preview, updates marker/FOV immediately, commits one history transaction on `pointerup`, and cancels to the start value on `pointercancel`/Escape. Horizontal keyboard movement is ±1° (Shift ±10°), Home is 0°, and End is 359°.
- Heading commits are real Camera calculation changes: revision/history/dirty and Observation invalidation follow the existing Store contract.

## Verification

- Node suite: `node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js test_camera_comparison.js test_yolo_coverage.js` — 38/38 passed.
- Static checks: `node --check portcam-store.js`, `node --check portcam-map.js`, `node --check portcam-ui.js`, and `git diff --check` passed. The final CSS fix was also checked with the browser smoke below.
- Python tests were not run because Python, Scene consumer, schema, Observation cache, and calculation contracts are unchanged.
- Browser smoke evidence covers 1366×768, 1920×1080, and an iPad Pro 11 emulation at 1920×1080/DPR2: panel allocation, Focus map enter/exit, blank-map/Escape clear focus, Camera colors/Coverage legend visibility, heading keyboard/pointer commit/cancel, legend drag/mode retention/reset/reload, body overflow, and zero console errors/warnings.
- Visual artifacts: [`phase44-1366.png`](../output/playwright/phase44-1366.png), [`phase44-1920.png`](../output/playwright/phase44-1920.png), and [`phase44-1920-dpr2.png`](../output/playwright/phase44-1920-dpr2.png).

## Files

- `index.html` — panel controls, Object Manager close action, Phase 4.4 label, and heading scrubber markup.
- `app.css` — panel grid allocation, Focus map projection, responsive control group, and scrubber interaction styling.
- `portcam-store.js` — UI-only panel/focus setters, explicit null focus restoration, and normalized Camera heading preview/commit.
- `portcam-map.js` — visual focus based FOV emphasis, marker drag, Target icon, and connection projection.
- `portcam-ui.js` — controller-local Focus map, heading pointer/keyboard interaction, panel delegation, blank-map/Escape priority, and resize invalidation.
- `test_portcam_store.js`, `test_portcam_map.js` — Phase 4.4 UI-only state, normalized heading, focus and marker contract coverage.

## Acceptance boundary

Node and real-browser smoke establish Store/map/UI behavior but do not replace physical stylus review, NVDA review, live base-map/Surface inspection, or downstream Scene consumer acceptance.
