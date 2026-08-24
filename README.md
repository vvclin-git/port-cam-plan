# 港區 AI 攝影機規劃工具

Leaflet 港區 camera site-planning prototype。工具依 sensor、解析度、焦距、安裝高度、Heading 與俯角估算 FOV、海面可視範圍與 Target pixel coverage；目前版本包含 Target model、browser-local Target Defaults/Preset Library、兩階段 Target 定向放置、SVG 船型符號與 Camera × Target Coverage Audit。Project 檔只保存 Target 最終值，不包含本機 Defaults 或 Preset Library。

## 開啟

v0.7 的水陸資料是相對路徑的靜態 GeoJSON，必須透過 localhost 開啟：

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

然後開啟 <http://127.0.0.1:8765/index.html>。正式入口是 `index.html`；直接雙擊 HTML 仍可使用部分地圖、FOV 與 YOLO 功能，但水陸 GeoJSON 的 `fetch()` 會失敗。

### 快速啟動

在專案根目錄雙擊 [`start-host.cmd`](./start-host.cmd)，它會以專案根目錄啟動 `127.0.0.1:8765`，並自動開啟 <http://127.0.0.1:8765/index.html>。Server 會在命令視窗以前景執行，按 `Ctrl+C` 停止。

若 Windows 找不到 Python，請先安裝 Python 並確認 `python` 已加入 PATH，或手動執行：

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

## 功能

- Sensor optical format 預設：1/4"、1/3"、1/2.8"、1/2.5"、1/2"、1/1.8"、1/1.7"、2/3"、1"，另有 Custom。
- 常見解析度預設：VGA、720p、1080p、3MP、1440p、5MP、4K、DCI 4K，另有 Custom。
- 地圖底圖：OpenStreetMap、NLSC 通用電子地圖與 NLSC 正射影像。
- 預設開啟水域／陸地 overlay；可獨立關閉視覺圖層，點擊分類仍會運作。
- 一般地圖點擊放置測試目標，顯示距離、方位、HFOV、bbox、COCO size、P3/P4/P5、YOLO heuristic 與 `water`／`land`／`Unknown` 地表類型。
- Camera 與 Target 是獨立 Project entity；Active Camera、Current Target 與 visual `focusedEntity` 分離管理。
- `Place Camera`／`Add Camera` 共用兩階段流程：先點位置，再移動游標指定 Heading；第二次有效點擊才建立一台 `placed` Camera。
- Navigate 模式可拖曳 focused、visible、unlocked Camera／Target marker；`place-camera` 不再搬動既有 Camera。
- Map-level `FOV display` 支援 `Camera colors` 與 `Pixel coverage` 互斥模式；Coverage 會對所有符合資格的 Camera 顯示四級 bands。
- Pixel coverage Legend 僅在 Coverage 模式顯示，支援 Pointer Events 拖曳、觸控、鍵盤位移、Escape 還原、Reset 與 workspace 邊界限制。
- Top Bar 提供獨立 `Objects`、`Inspector`、`Focus map` 控制；Inspector 的 Heading 另有 N/E/S/W compass scrubber。
- FOV coverage 依短邊像素分成 ≥32、16–32、8–16、<8 px 四段。
- Bottom Workspace 的 Coverage Audit 以 Width／Length／Height 任一尺寸估算 pixel coverage，顯示每個 Target 的合格來源、最佳 Camera 與單點風險；這是 site-planning heuristic，不是實際模型偵測率。

## v0.7 水陸圖資

資料檔為 [`data/kaohsiung-harbor-surface.geojson`](./data/kaohsiung-harbor-surface.geojson)，是 WGS84 / EPSG:4326 的 `FeatureCollection`，只含 `Polygon`／`MultiPolygon`，每個 feature 都有 `properties.surface`：`water` 或 `land`。

- 固定 bbox：`120.24–120.36 E / 22.55–22.68 N`；範圍外分類為 `Unknown`。
- 主要海域依 OSM coastline water polygon 的 land-left／water-right 處理規則組裝 `natural=coastline`，並以工作區 bbox 裁切。
- 補入同一 OSM 快照內的封閉 `natural=water` 與 `waterway=dock` polygon；重疊水域在輸出前排除重複 rings。
- 修復 ring 閉合與重複頂點，再以約 1–2 m 的 WGS84 近似容差簡化；land 是工作區矩形減去 water，並保留 polygon holes。
- 來源：<https://osmdata.openstreetmap.de/data/water-polygons.html>、工作區快照查詢服務 <https://overpass-api.de/>；快照日期：`2026-08-13`。
- 授權與署名：`© OpenStreetMap contributors / ODbL 1.0`。這是規劃參考資料，不是測量級岸線。

## 計算模型

- `pixel pitch = sensor active width / image width`
- `HFOV = 2 × atan(sensor width / (2 × focal length))`
- `VFOV = 2 × atan(sensor height / (2 × focal length))`
- 地平線距離採用 `3.57 × (√camera height + √target height)` km 的工程近似。
- 俯角與 VFOV 會決定海平面的 near/far footprint；coverage 另與地平線及目標尺寸像素距離交集。
- 地表分類支援 Polygon、MultiPolygon 與 holes，分類順序固定為 water、land、unknown；共用邊界 water 優先。

YOLO 顏色分級是 site-planning heuristic，不是 YOLO 官方保證門檻。實際效果仍會受壓縮、光線、海況、遮擋、目標姿態與模型訓練資料影響。

## 網路與錯誤狀態

Leaflet library 已改由專案內的 `leaflet/` 靜態目錄載入，不再連線任何 Leaflet CDN。水陸資料也不在線上查詢，只由 `fetch('./data/kaohsiung-harbor-surface.geojson')` 載入專案內固定檔；只有 OSM／NLSC 圖磚仍需外部網路。

- 載入中：checkbox 停用，結果顯示「載入中」。
- 載入成功：checkbox 預設開啟，可切換視覺 overlay。
- 404、`file://` 或其他載入失敗：顯示「無法判定」與 localhost 啟動命令；既有地圖、FOV 與 YOLO 不被阻止。
- 點擊資料 bbox 外：顯示 `Unknown`。

Sensor active area 是 optical-format 工程近似值；正式設計應以攝影機 datasheet 的實際 active width/height 為準。

## Leaflet 靜態資源與部署

- 版本固定為 Leaflet 1.9.4，來源為 [Leaflet 官方 v1.9.4 release](https://github.com/Leaflet/Leaflet/releases/tag/v1.9.4)。
- `leaflet/leaflet.js`、`leaflet/leaflet.css`、`leaflet/images/` 與 `leaflet/LICENSE` 均隨專案提交；CSS 使用官方相對路徑 `images/...`，不可移動或省略 images 目錄。
- `index.html` 使用 `./leaflet/leaflet.css` 與 `./leaflet/leaflet.js`，不使用 `/` 開頭的根目錄路徑，因此可部署在 GitHub Pages repository site、Vercel static hosting、IIS virtual directory、NAS 子目錄或其他網站子目錄。
- 支援 localhost HTTP server：`python -m http.server 8765 --bind 127.0.0.1`。
- `start-host.cmd` 會從腳本所在目錄啟動 server，不依賴固定的本機絕對路徑，也不需要 npm 或 backend。
- 也可直接部署整個專案目錄到 GitHub Pages、Vercel static hosting、IIS 或 NAS static hosting；需保留 `leaflet/`、`data/` 與 HTML 的相對目錄結構。
- OSM／NLSC 圖磚 URL 維持線上服務，離線部署不包含圖磚快取或圖磚伺服器。
- Leaflet 採 BSD-2-Clause；授權全文見 [`leaflet/LICENSE`](./leaflet/LICENSE)。
- 若 Leaflet 本機資源遺失，頁面會提示檢查 `leaflet/leaflet.js`、`leaflet/leaflet.css`、`leaflet/images/`、檔名大小寫與相對路徑。

## Camera Scene JSON 匯出

側欄的「Ray Casting 測試匯出」會依按鈕當下的 Camera marker、Camera 控制參數、光學參數、目前底圖與 tile zoom，產生版本化的 `camera-scene/1.1` JSON。可下載 `camera-scene-YYYYMMDD-HHmmss.json`，或複製完整 JSON 給獨立 ray-casting 程式；App 只輸出 manifest，不下載或內嵌 PNG／JPEG 圖磚。

- `camera.position` 記錄 `[latitudeDeg, longitudeDeg]` 語意的 WGS84 位置、相對交平面高度與 `heightReference: "intersection-plane"`。
- `camera.orientation.headingDeg` 以真北為 0°、順時針增加並正規化到 `[0, 360)`；`tiltDownDeg` 正值向下；第一版 `rollDeg` 固定為 0°。
- `image` 使用左上角原點、影像中心 principal point 與 `pixelCenterConvention: "half-pixel"`；外部程式應以 pixel + 0.5 作為 pixel center。
- `optics` 包含 sensor 尺寸、解析度、焦距、pixel pitch、完整 HFOV／VFOV 與 `distortionModel: "none"`。
- `coordinateSystem` 固定記錄 EPSG:4326／WGS84、heading／tilt 慣例與 Camera frame：right `+X`、down `+Y`、forward `+Z`。
- `intersectionSurface` 是 elevation 0 m 的水平交平面；Camera 高度不是實際海拔，也不包含 DEM、潮位、建築或障礙物。

### Tile manifest

`tileSelection` 使用現有 near／far、HFOV／VFOV 與 horizon 模型建立保守 FOV envelope，最大距離為 `min(horizon distance, 30000 m)`，再轉換成標準 Web Mercator tile indices 並加入一圈 `paddingTiles: 1`。Tile 依 y、x 排序且去除重複，manifest 不是逐像素 ray-casting 的幾何真值。

- `footprintStatus` 為 `finite`、`horizon-clipped` 或 `no-ground-intersection`；最後一種會輸出 `footprint: null` 與空的 `tiles`。
- JSON 的 tile 欄位永遠是標準 Web Mercator `z/x/y`；每個 tile 另含 WGS84 `bounds` 與依目前來源 template 展開的完整 `url`。
- OSM 使用 `{z}/{x}/{y}`；NLSC EMAP／PHOTO 維持 App 實際使用的 `{z}/{y}/{x}` WMTS GoogleMapsCompatible URL。切換底圖只改變 `tileSource` 與 manifest URL，不改 Camera 模型。
- Tile 服務斷線時仍可產生 JSON，因為匯出不依賴圖磚成功載入。外部程式下載時應保留來源 attribution、使用可控 cache、對暫時性錯誤採有限次數與退避 retry，並遵守服務的 rate limit；不可把 Cookie、Token、Authorization header、Proxy credential 或瀏覽器憑證放入 JSON。
- 若 ray 落在 manifest 外，外部程式應回傳 `tile-not-in-manifest`，不可誤判成 `no-intersection`、`land` 或 `water`。

## Ray Casting 圖磚色彩水域測試工具

目前分支已提供獨立的 [`ray_cast_test.py`](./ray_cast_test.py)。它讀取上述
`camera-scene/1.1`，以圖磚 RGB、可調式 CIELAB CIE76 ΔE、多個水域參考色及選用
HSV gate 產生 `water`／`non-water`／`unknown`。Tkinter/Pillow UI 的顏色設定變更
只會重新分類記憶體中的樣本，不重新建立 rays、地面交點或下載圖磚。

```powershell
python -m pip install -r requirements-ray-cast.txt
python ray_cast_test.py camera-scene.json --ui
```

CLI、profile schema、輸出檔案與驗收邊界見
[`docs/RAY_CAST_WATER_COLOR.md`](./docs/RAY_CAST_WATER_COLOR.md)。此工具只供快速驗證，
不取代 GeoJSON、語意分割或人工檢查。

## Phase 0 計算契約與測試

[`portcam-core.js`](./portcam-core.js) 是不依賴 DOM／Leaflet 的純計算核心，頁面 adapter 與 Node golden tests 共用它。正式計算模型為 `spherical-v1`；`tiltDownDeg` 正值向下，Camera height 使用 `heightReference: "intersection-plane"`，Scene 另記錄 `intersectionPlaneElevationM` 與 `verticalDatum: "local-planning-datum"`。

- Project schema 是 `camera-project/1.0`；Observation 預設是 derived runtime cache，不是必要持久資料。
- Camera Scene export 維持 `camera-scene/1.1` 與 top-level `camera`，不改為 `cameras[]`。
- Tile selection 的有效距離是 `min(horizonDistanceM, 30000)`，並保留 `hardMaximumRayDistanceM: 30000`。
- Ray-casting cache 使用 `.tile-cache/<tile-source-hash>/<z>/<x>/<y>.png`；舊的無來源路徑不會被讀取。

Phase 0 回歸命令：

```powershell
node --test test_portcam_core.js
python -m unittest -v test_ray_cast_test.py
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const a=h.indexOf('<script>',h.indexOf('leaflet.js'));const b=h.indexOf('</script>',a);new Function(h.slice(a+8,b));console.log('inline script syntax ok')"
```

完整交接與實際驗證結果見 [`docs/PHASE_0_HANDOFF.md`](./docs/PHASE_0_HANDOFF.md)。

## Phase 1 Project Store

[`portcam-store.js`](./portcam-store.js) 將 Camera／Target canonical Project data 正規化，並以 UMD 形式同時提供瀏覽器 `window.PortCamStore` 與 Node 使用。Store 不依賴 DOM、Leaflet；UI、history、preview 與 Observation runtime cache 均不會寫入 `camera-project/1.0` JSON。Camera／Target selection 獨立，預覽不變更 revision/history/dirty，正式 commit 才建立單一 transaction；`undo()`、`redo()`、`markSaved()` 已可供後續 UI 使用。

## Phase 2 Reactive Leaflet 多 Camera

[`portcam-map.js`](./portcam-map.js) 將 Store state 投影成每台 Camera/Target 各自的 Leaflet LayerGroup；Object Manager 可選取、新增、複製、刪除與切換 visible/enabled/locked。既有 Camera 的位置移動在 Navigate 模式透過 marker drag 完成，`place-camera` 僅建立新 Camera。所有畫面更新由單一 Store subscription 驅動，因此 Undo/Redo、selection、visibility、lock、enabled 與 commit 都會更新 marker、FOV、表單與 connection line，而不是依賴舊的 `updateAll()`。

`camera-project/1.0` 與 selected-Camera `camera-scene/1.1` 保持不變。完整範圍、測試證據與尚需 real-browser 驗收的互動項目見 [`docs/PHASE_2_HANDOFF.md`](./docs/PHASE_2_HANDOFF.md)。

Phase 1 回歸：

```powershell
node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js
python -m unittest -v test_ray_cast_test.py
```

## Phase 3 App Shell 與核心工作區

正式入口 [`index.html`](./index.html) 現在使用 [`app.css`](./app.css) 與 [`portcam-ui.js`](./portcam-ui.js) 投影桌面 App Shell：Top Bar、Object Manager、Inspector、Map Workspace，以及預設收合的 Bottom Workspace。

- `PortCamUI.createAppController({store, mapController, root})` 負責 Store-driven DOM projection、panel state、responsive invalidation 與 cleanup；實際頁面以 `map`／Leaflet 建立既有 `PortCamMap` controller。
- Object Manager 是 Visible／Enabled／Locked 的唯一控制入口；其 Cameras／Targets tabs 均支援搜尋、選取、重新命名、Fit、複製與刪除。
- Inspector 的 Details 顯示 focused entity；Observation 即時計算 Current Target 由 Active Camera 觀測的結果，不建立或保存物件關係。`setActiveResultTab` 僅為相容性保留的 deprecated UI-only API。
- Camera 與 Target 欄位都採 preview／blur／Enter single-commit；Target Details 在 preview 時保留 active input、捲動與 section 收合狀態。
- Map Settings 保留 OSM、NLSC EMAP、NLSC PHOTO、Surface `water`／`land`／`unknown`、tile zoom 與獨立 labels 設定。Project Import／Save 與精確四角 ray 仍不在本階段；Comparison 與 YOLO Coverage 已由 Phase 4 實作。

## Phase 3.1 共用 Entity、地圖互動與 Target List

[`docs/PHASE_3_1_HANDOFF.md`](./docs/PHASE_3_1_HANDOFF.md) 記錄本階段的共用 drag contract、wheel policy、pane 順序與人工驗收界線。

- Camera／Target 共用 `PortCamMap.createEntityMarkerInteraction`，只有 focused、visible、unlocked 且 `navigate` 才能拖曳；Active Camera／Current Target selection 與 visual focus 分離。preview 不改 revision/history/dirty，drag end 只 commit 一次。
- Target 使用 `L.marker`／`L.divIcon` crosshair；FOV、YOLO、centerline、connection line 不攔截 pointer，Current Target 保留 connection line，visual marker emphasis 則由 `focusedEntity` 控制。
- Wheel 由 MapController 單一 non-passive handler 處理，正規化 pixel／line／page delta，同方向 180 ms burst 最多縮放一級，Ctrl+wheel 保留瀏覽器縮放。
- Object Manager 的 Cameras／Targets 分頁支援 Search、Select、Rename、Visible、Enabled、Locked、Duplicate、Delete、Fit Target；搜尋、分頁、捲動與 focus 是 UI-only state，不進 Project、history 或 dirty。
- Camera／Target labels 預設開啟，Map Settings 可分別切換；rename 更新既有 tooltip，不重建或累積 labels。

## Phase 3.2 Unified Object Management UI

左側 Object Manager 收斂 Cameras／Targets 表格；右側 Inspector 以 Details／Observation 顯示 focused entity 與 Current Target／Active Camera 的即時計算結果。Phase 4.4 增加可獨立收合的 Objects／Inspector、UI-only Focus map 與 heading compass scrubber；Bottom Workspace 的 Comparison 與 YOLO Coverage 已使用純 derived analysis，不寫入 Project／Scene。細節見 [`docs/PHASE_4_4_HANDOFF.md`](./docs/PHASE_4_4_HANDOFF.md)。

2026-08-17 UI polish 移除 Top Bar Observation、Camera Open Result 與舊 Result Drawer DOM；Target 建立後自動切到 Observation。Target marker drag preview 不會重建作用中的 `L.divIcon`，只在 selected／locked／enabled 樣式改變時更新 icon。

完整實際範圍、API、Node／browser evidence 與未完成人工 gate 見 [`docs/PHASE_3_HANDOFF.md`](./docs/PHASE_3_HANDOFF.md)。

## Phase 4 多 Camera analysis 與地圖控制

目前 HEAD 為 `29b753e`，Phase 4.1–4.4 已在 `codex/multi-cam` 分支提交。這些功能維持既有 `camera-project/1.0`、selected-Camera `camera-scene/1.1`、`spherical-v1`、Observation cache、coverage 計算與公開 Store／Map API：

- Camera Comparison 以 enabled Camera 的 Current Target Observation 排序，支援 Visible／Outside FOV／Unavailable／Failed 狀態與鍵盤啟用 Active Camera。
- YOLO Coverage 以同一 Observation 結果產生四級摘要；地圖 Pixel coverage 則使用 Project `planningTargetHeightM` 與既有距離裁切，兩者不共用第二套 Observation cache。
- Camera colors 與 Pixel coverage 是互斥的 map display mode；Camera identity 顏色只在前者出現，Coverage bands 與 neutral FOV geometry 只在後者出現。
- Add／Place Camera 的 pending anchor、placement step、heading preview、FOV mode、legend 座標、panel state 與 Focus map 都是 UI-only，不進 schema、revision、history、dirty、Undo／Redo 或 export。
- Focus map 在所有支援的 panel／DPR 組合中將地圖配置為單欄全寬；離開後還原 Objects／Inspector 的原本開關狀態。

詳細契約與驗收紀錄：[`PHASE_4_1_HANDOFF.md`](./docs/PHASE_4_1_HANDOFF.md)、[`PHASE_4_2_HANDOFF.md`](./docs/PHASE_4_2_HANDOFF.md)、[`PHASE_4_3_HANDOFF.md`](./docs/PHASE_4_3_HANDOFF.md)、[`PHASE_4_4_HANDOFF.md`](./docs/PHASE_4_4_HANDOFF.md)。

## 驗證

可先執行靜態檢查：

```powershell
python -m json.tool data/kaohsiung-harbor-surface.geojson > $null
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const a=h.indexOf('<script>',h.indexOf('leaflet.js'));const b=h.indexOf('</script>',a);new Function(h.slice(a+8,b));console.log('inline script syntax ok')"
```

瀏覽器驗證應確認 localhost 載入、預設 overlay、checkbox 開關、三種底圖、一般點擊分類、Camera 放置模式，以及 GeoJSON 404 時既有功能仍可使用。NLSC 正射影像至少抽查 10 點、岸線 5–15 m 的潮位／資料日期差異列為容許帶；ray casting 與相機視角預覽不在 v0.7 範圍。

Phase 4 回歸命令：

```powershell
node --test test_portcam_core.js test_portcam_store.js test_portcam_map.js test_camera_comparison.js test_yolo_coverage.js
node --check portcam-store.js
node --check portcam-map.js
node --check portcam-ui.js
```

目前完整 Node suite 為 38/38；Phase 4 browser smoke 已涵蓋 1366×768、1920×1080 與 DPR 2，並驗證 panel allocation、Focus map、FOV mode、legend、heading scrubber、body overflow 與 console error/warning。

詳細規格、schema、分類狀態與後續接點見 [`docs/SURFACE_LAYER_IMPLEMENTATION.md`](./docs/SURFACE_LAYER_IMPLEMENTATION.md)。
