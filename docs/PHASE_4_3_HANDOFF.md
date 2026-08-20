# Phase 4.3 Handoff — Camera 兩階段放置與地圖顯示控制

## Status

- Phase 4.3 is implemented locally from clean baseline `8253133` on branch `codex/multi-cam`.
- No schema, Observation cache, coverage formula, public API, commit, push, or remote mutation is part of this work.
- `fovColorMode`, placement step, pending anchor, heading preview, and legend coordinates remain UI/controller-local state.

## Camera placement contract

- Add Camera, Place Camera, and the Object Manager Camera action enter the same `place-camera` interaction without creating a draft or changing dirty, revision, or history state.
- Step 1 records only a UI-local geographic anchor. The temporary marker and FOV preview are non-interactive and labelled `Preview`.
- Step 2 derives the heading from `PortCamCore.bearingBetween(anchor, cursor)` on map movement. A second click is rejected when the cursor is less than 8 screen pixels from the anchor.
- A valid second click calls `addCamera` once with `lifecycle: "placed"`, selects the new Active Camera, opens Details, and returns to Navigate. Undo removes the new Camera in one transaction.
- Escape, mode changes, Place Target, restarting placement, and MapController destruction remove the pending preview and map-move listener effects without creating Store data.
- Existing Camera relocation is Navigate-mode marker drag for the selected, visible, unlocked Camera. Locked markers cannot drag. `place-camera` no longer relocates an existing Camera.
- Place Target remains one-click placement and returns to Navigate.

## FOV control and preview contract

- The `FOV display` segmented control is rendered in the map upper-right control group beside Map Settings and is independent of Workspace state, tab, and Current Target state.
- YOLO Coverage has no duplicate FOV switch. `fovColorMode` remains UI-only.
- Camera colors and Pixel coverage retain Phase 4.2 mutual exclusion. Placement preview reuses the existing optics, ground envelope, coverage bands, and color-mode branches with reduced opacity/dashed styling.
- Camera colors preview uses the next Camera identity color and no coverage bands. Pixel coverage preview uses neutral FOV geometry and coverage bands without identity fill.
- The Pixel coverage legend remains Coverage-only, controller-local, Pointer Events based, keyboard accessible, bounded to `.map-workspace` with an 8 px margin, resettable, and above the Leaflet zoom control by default.

## Changed files

- `index.html` — map-level FOV control, Phase 4.3 label, and removal of Relocate.
- `app.css` — map control layout, responsive labels, preview marker, and legend interaction styles.
- `portcam-map.js` — map-move callback, temporary preview layer, shared FOV rendering, and cleanup.
- `portcam-ui.js` — controller-local pending placement state, two-stage interaction, marker relocation policy, and map-level FOV delegation.
- `test_portcam_map.js` — temporary preview, mode separation, event callback, and cleanup coverage.
- `docs/PHASE_4_2_HANDOFF.md`, `docs/PHASE_2_HANDOFF.md`, `docs/PHASE_3_1_HANDOFF.md`, `docs/PHASE_3_HANDOFF.md`, and the architecture document — stale draft/Relocate descriptions updated.

## Verification

- `node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js test_camera_comparison.js test_yolo_coverage.js` — **36/36 passed**.
- `node --check portcam-map.js`, `node --check portcam-ui.js`, and `git diff --check` — passed; only expected CRLF conversion warnings were reported by Git.
- Python tests were not run because Python, Scene consumer, schema, and coverage calculation contracts are unchanged.
- Real Microsoft Edge through the Playwright CLI at `http://127.0.0.1:8765/index.html` verified Add Camera and Place Camera parity, no-draft Step 1, temporary Step 2 preview, 8 px rejection, heading update, one placed Camera transaction, Undo/Redo, Escape cancellation, Navigate marker drag, locked-marker rejection, Relocate removal, map-level FOV control, no duplicate YOLO switch, and zero console errors/warnings.
- 1366×768, 1920×1080, and 1920×1080 with `deviceScaleFactor: 2` verified FOV/Map Settings non-overlap, default legend position above Leaflet zoom, workspace bounds, body/HTML no-scroll overflow, Coverage-only legend visibility, and clean Store revision/history/dirty state for UI-only interactions.
- Legend mouse drag, touch `PointerEvent` drag, keyboard 8/24 px movement, Reset, Escape rollback, mode-switch retention, and reload-to-default were verified without moving the map or changing Store state.
- Visual artifacts: [`phase43-1366.png`](../output/playwright/phase43-1366.png), [`phase43-1920.png`](../output/playwright/phase43-1920.png), and [`phase43-1920-dpr2.png`](../output/playwright/phase43-1920-dpr2.png).

## Remaining acceptance boundary

Automated Node and real-browser smoke establish the Store/map/UI contracts but do not replace physical stylus hardware review, NVDA review, live base-map/Surface inspection, or downstream Scene consumer acceptance.
