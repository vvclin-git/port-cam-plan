# Phase 5.6 handoff

Coverage Audit replaces the two user-visible Workspace tables with a Camera × Target matrix. It is runtime-only and reuses `store.getObservation(cameraId, targetId)`; no pairing, matrix result, or Observation cache is saved to a Project.

Project settings retain `camera-project/1.0` and add `coverageAuditDimension` (`width` default), `coverageAuditMinimumTier` (`usable` default), and `coverageAuditRequiredCameras` (integer, minimum/default 1). Legacy files normalize these values on validation.

`coveragePixels.length|width|height` uses the existing planning formula: physical dimension metres × focal length / (distance × pixel pitch). It intentionally excludes vessel heading projection, occlusion, perspective box geometry, terrain and inference. Qualified means both entities enabled, a current successful Observation inside HFOV/VFOV, and selected-dimension tier at or above the configured minimum.

Best Camera is the highest qualified pixel result (Project Camera order breaks ties). Disabled Targets are excluded from summary; hidden enabled Cameras/Targets remain in the audit. The matrix cell selects independent Active Camera and Current Target then opens Observation Inspector.

Automated verification: `node --test test_coverage_audit.js test_portcam_core.js test_portcam_project.js test_portcam_store.js` (31 passing). Manual browser acceptance remains for sticky columns/horizontal scrolling, keyboard navigation, panel resizing, screen-reader announcements, and full interaction at 1366×768, 1920×1080 and DPR2.
