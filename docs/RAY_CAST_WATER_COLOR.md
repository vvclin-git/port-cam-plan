# Ray Casting tile-colour water test tool

`ray_cast_test.py` is a local, test-purpose consumer of the existing
`camera-scene/1.1` export. It samples the RGB value at each ground-intersecting
ray, then classifies the cached samples as `water`, `non-water`, or `unknown`.
It is not a survey-grade or measurement-grade land/water classifier.

## Run

Install the only new runtime dependency:

```powershell
python -m pip install -r requirements-ray-cast.txt
```

CLI, offline by default:

```powershell
python ray_cast_test.py camera-scene.json `
  --grid 160x90 `
  --download-tiles `
  --color-profile water-profile.json
```

The first run stores only decoded-source tile files under
`.tile-cache/<tile-source-hash>/<z>/<x>/<y>.png`. The hash isolates Source ID,
URL template, layer/style, matrix set, and tile size. Existing unscoped
`.tile-cache/<z>/<x>/<y>.png` files are retained but are not read.
Profiles and output files never contain tile images, cookies, tokens, or
credentials. Use `--offline` to prohibit all network downloads.

Desktop UI:

```powershell
python ray_cast_test.py camera-scene.json --ui
```

The UI uses Tkinter and Pillow only. Ray casting, tile downloads, and image
decoding run in a worker thread. Slider and colour changes use a short debounce
and operate on the in-memory sample layer; they do not rebuild rays, ground
intersections, geographic coordinates, tile coordinates, or download tiles.
Changing the sample-neighborhood size changes the sampled source window, so the
UI marks the sample layer expired and asks for a new tile-sampling run; it does
not silently reclassify the old 3x3/5x5 sample as if it were new data.

## Data layers

Each result keeps these layers separate:

1. Geometry: ray direction, ground intersection, geographic coordinate, and
   tile coordinate.
2. Sample: nearest tile RGB, median-neighbourhood RGB, HSV, and CIELAB.
3. Classification: minimum CIE76 ΔE, matched reference, HSV gate result,
   confidence score, and class.

Missing tiles, manifest misses, decode errors, no intersection, and rays beyond
the maximum distance remain `unknown` with a reason. They are not converted to
`non-water`.

The Scene contract sets `tileSelection.maximumRayDistanceM` to
`min(horizonDistanceM, 30000)` and keeps `hardMaximumRayDistanceM: 30000` as
the hard ceiling. A ray beyond the effective distance is `max-distance`, not a
manifest miss.

The raw preview uses nearest-neighbour pixels. Status colours are sky blue for
no intersection, red for unavailable/decode failure, yellow for a manifest
miss, and purple for maximum-distance rays. Classification preview modes are
raw RGB, mask, overlay, confidence, and difference.

## Profiles and outputs

Profiles use `water-color-profile/1.0`. Multiple enabled references are allowed;
the classifier takes the minimum CIE76 ΔE. HSV gating is optional and supports a
hue interval that crosses 360°/0°. A profile whose `tileSourceId` differs from
the current scene is shown as a warning and requires explicit confirmation in
the UI.

CLI and UI export:

```text
output/ray-results.json
output/ray-preview-raw.png
output/ray-preview-water-mask.png
output/ray-preview-water-overlay.png
output/ray-preview-confidence.png
output/water-color-profile.json
output/report.txt
```

All JSON output uses `allow_nan=False`; non-finite values are converted to
`null` before serialization.

## Verification boundary

The unit tests cover RGB/HSV/CIELAB conversion, CIE76 symmetry, multiple and
disabled references, zero tolerance, HSV wraparound, unknown tile results,
profile round-tripping, and reclassification without changing geometry or
sample data:

```powershell
python -m unittest -v test_ray_cast_test.py
```

Tile-source availability, actual image dates, network access, and visual
agreement with shoreline data remain environment- and source-dependent checks.
