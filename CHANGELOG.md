# Changelog

## Phase 3.3 — 2026-08-18

- Reframed Observation as the Current Target observed by the Active Camera; removed permanent relationship language without changing selection, cache, project, or scene contracts.

## Phase 3.2 UI polish — 2026-08-17

- Removed the visible and hidden legacy Result Drawer paths. Context Inspector is now the sole Details／Observation surface; Target creation opens its Observation view.
- Made Object Manager the only Visible／Enabled／Locked control surface, with action-specific accessible labels and titles.
- Rebuilt Target Details as stable collapsible Position & Orientation, Dimensions & Coverage, and Actions sections; preview updates fields in place.
- Strengthened Target drag regression coverage so repeated previews and the single drag commit do not call `marker.setIcon()`; selected／locked／enabled styles remain the only icon replacement triggers.

## Phase 3.2 — 2026-08-16

- Consolidated Camera Rail and Target List into Object Manager tabs and merged the visible inspector/drawer experience into Context Inspector Details/Observation.
- Added UI-only manager focus/tab/search and inspector tab state without changing project/scene schemas or history semantics.

## Phase 3.1 — 2026-08-16

- Added shared Camera／Target marker interaction: selection, labels, lock-aware drag preview／single commit, duplicate／delete fallback, Fit Target, and observation-aware projections.
- Replaced Target circle markers with `L.marker`／`L.divIcon`, fixed pane ordering and non-interactive FOV／YOLO／centerline／connection geometry so Targets remain clickable inside analysis overlays.
- Disabled Leaflet built-in wheel zoom and added normalized, cooldown-limited, min／max-bounded controller wheel handling with Ctrl+wheel pass-through and destroy cleanup.
- Added searchable Bottom Workspace Targets list with row／marker selection, rename, visibility, enabled, locked, duplicate, delete, and Fit Target actions; search remains UI-only.
- Added independent Camera／Target label switches, 22 Node tests, and [`docs/PHASE_3_1_HANDOFF.md`](docs/PHASE_3_1_HANDOFF.md).

## Phase 3 — 2026-08-16

- Replaced the compact Phase 2 page with a Store-driven App Shell: Top Bar, Camera Rail, Camera Inspector, Map Workspace, Result Drawer, Map Settings, and collapsed／expanded Bottom Workspace.
- Added `portcam-ui.js` and `app.css`, responsive 100dvh layout rules, ResizeObserver-driven Leaflet invalidation, accessible mode／selection states, Camera preview／commit form flow, coordinate-only Target creation, and Result Drawer availability states.
- Added UI-only Store panel/tab actions without changing `camera-project/1.0`, dirty state, or Undo/Redo; added target fit helpers and preview projection cleanup to the MapController.
- Preserved selected-Camera `camera-scene/1.1`, Surface `water`／`land`／`unknown`, OSM／NLSC relative paths, and the Phase 0 calculation contracts.
- Added 18 Node regression tests including UI-only Store state isolation and [`docs/PHASE_3_HANDOFF.md`](docs/PHASE_3_HANDOFF.md).

## Phase 2 — 2026-08-16

- Added reactive multi-Camera Leaflet layer registries and a compact Camera Manager driven by one Project Store subscription.
- Added formal interaction modes, disabled/draft Observation availability semantics, MapController fake-Leaflet regression coverage, and the Phase 2 handoff.
- Corrected Phase 1 documentation: Store coordinate undo/redo did not prove legacy Leaflet/form projections were reactive.

## Phase 1 — 2026-08-16

- Added DOM/Leaflet-free normalized `PortCamStore` with Project serialization, independent Camera/Target selection, preview/commit transactions, revision-aware lazy Observation cache, dirty baseline, and undo/redo APIs.
- Adapted the existing single-Camera adapter to bootstrap and project Store data while retaining the current UI and `camera-scene/1.1` selected-Camera export.
- Added focused Store Node tests and [`docs/PHASE_1_HANDOFF.md`](docs/PHASE_1_HANDOFF.md), including actual verification evidence and the remaining manual Leaflet interaction gate.

## Phase 0 — 2026-08-15

- Extracted DOM／Leaflet-free `PortCamCore` calculation and schema helpers with Node golden tests for optics, spherical envelope, observations, angle conventions, project/scene contracts, and preview/commit semantics.
- Locked `tiltDownDeg`, `heightReference: "intersection-plane"`, `camera-project/1.0`, `camera-scene/1.1`, and effective ray distance `min(horizonDistanceM, 30000)`.
- Isolated Python tile cache entries by source hash and retained legacy unscoped cache files without reading them.
- Added [`docs/PHASE_0_HANDOFF.md`](docs/PHASE_0_HANDOFF.md) as the verified handoff record.

## v0.8.1 — 2026-08-14

- 將 App 正式入口由 `harbor_ai_camera_planner_v06.html` 改為 `index.html`。
- 新增可攜式 `start-host.cmd`，從腳本所在目錄啟動 localhost HTTP server 並自動開啟 `/index.html`。
- 同步更新 README、surface layer 文件、localhost 錯誤提示與驗證命令。
- 未修改 FOV、YOLO、Camera、target、GeoJSON、Leaflet 或 ray-casting 計算邏輯。

## v0.8.0 - 2026-08-13

- Added `ray_cast_test.py`, a Python CLI and Tkinter/Pillow desktop tool for
  Camera Scene ray casting, cached tile RGB sampling, CIELAB CIE76 water
  classification, optional HSV gating, and nearest-neighbour previews.
- Added background tile/ray work, profile validation, `ray-results.json`,
  classification preview images, `report.txt`, and focused unit tests.
- Colour/profile changes reclassify cached samples; changing scene, zoom, grid,
  or sampling neighborhood expires the old run and requires a new run.

## v0.7.2 — 2026-08-13

- 新增 `camera-scene/1.1` Camera Scene JSON 下載與複製功能，匯出當下 Camera 位置、高度、Heading、Tilt、sensor、解析度、焦距、HFOV／VFOV 與座標慣例。
- 新增目前啟用底圖來源與 OSM／NLSC URL 座標順序的 tile source 匯出。
- 新增依現有 near／far、HFOV／VFOV、horizon 模型產生的保守 FOV tile manifest，含一圈 tile padding、horizon clipping、WGS84 bounds 與可重建 URL。
- 圖磚服務無法連線時仍可匯出；不下載或內嵌圖磚，也不匯出 Cookie、Token、Authorization header、Proxy credential 或瀏覽器憑證。
- 未改動既有 Camera marker、FOV、YOLO coverage、target calculation 與 OSM／NLSC 圖磚載入方式。

## v0.7.1 — 2026-08-13

- 將 Leaflet 1.9.4 官方 distribution 的 JS、CSS、五個 images 與 BSD-2-Clause LICENSE 加入 `leaflet/`。
- 將 HTML 的 Leaflet 引用改為 `./leaflet/leaflet.css` 與 `./leaflet/leaflet.js`，移除 jsDelivr 依賴。
- 保留 OSM／NLSC 線上圖磚 URL，不包含圖磚離線化。
- 更新 Leaflet 本機資源遺失提示，涵蓋 JS、CSS、images、檔名大小寫與相對路徑檢查。
- 未修改 FOV、VFOV、地平線、YOLO、Camera／target 操作與水陸 GeoJSON 邏輯。

## v0.7 — 2026-08-13

- 新增 `data/kaohsiung-harbor-surface.geojson` 固定 WGS84 水陸快照，範圍為 `120.24–120.36 E / 22.55–22.68 N`。
- 在 Base map 下方加入預設開啟的水域／陸地 overlay、圖例與載入狀態；圖層置於 FOV／YOLO coverage 下方。
- 新增支援 Polygon、MultiPolygon、holes 與 `[longitude, latitude]` 的無外部套件分類器，water 優先於 land。
- 一般地圖點擊結果新增「地表類型」；Camera 放置模式維持只移動 Camera、不觸發 target 分類。
- 水陸 GeoJSON 載入失敗時提示使用 localhost，且不阻止既有底圖、FOV 與 YOLO 功能。
- 更新 README，新增 `docs/SURFACE_LAYER_IMPLEMENTATION.md`，記錄來源、ODbL 署名、schema、處理順序、驗證方式與後續 ray casting 接點。

## v0.6 — 2026-08-13

- 建立單檔港區 AI 攝影機規劃工具。
- 加入 OSM、NLSC 通用電子地圖與 NLSC 正射影像底圖。
- 加入 sensor optical format、常見解析度、焦距、安裝高度、Heading 與俯角控制。
- 加入 HFOV、VFOV、地平線、海面 near/far footprint 與 YOLO 8/16/32 px coverage。
- 修正 FOV 邊界從 Camera marker 原點開始。
- 讓超出 VFOV 的黃、橘、紅像素距離帶以淡色虛線顯示，避免 coverage 完全消失，同時區分實際可視範圍。
- 移除重複的 Leaflet 圖層控制，只保留側欄 Base map 下拉選單。
- 移除不需要的「回高雄港」按鈕，讓 Camera 放置按鈕使用單欄全寬版面。
