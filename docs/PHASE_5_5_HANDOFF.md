# Phase 5.5 handoff

Phase 5.5 adds the `small-vessel` and `large-vessel` Target model catalog, browser-local Target Defaults/Preset repositories, project-file `modelType` normalization, two-click Target heading placement, and heading-aware Leaflet target projection.

Target symbols use a small SVG factory inside `L.DivIcon`: hull, bridge, and Heading rotation remain inside the SVG, while Leaflet retains marker positioning. The marker box is fixed at 40 × 40 px. The catalog is the single source for the two hull profiles and bridge proportions; it does not add a generic vessel class or embed visual data into a Project file.

Project Settings includes a Target Defaults form and CRUD/Import/Export controls for browser-local Target Presets. Target import/export excludes built-ins, supports Merge and Replace custom presets, and rolls Target Defaults back when a subsequent Preset write fails. Inspector Apply/Reset patches the selected unlocked Target once; Reset uses the current Target Defaults.

Compatibility remains `camera-project/1.0`: legacy Targets normalize to `small-vessel` during validation. Target height is independent of `settings.planningTargetHeightM`.

The preceding Phase 5.4 baseline is committed as `d56e0f5`.
