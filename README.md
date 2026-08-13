# 港區 AI 攝影機規劃工具

Leaflet 港區 camera site-planning prototype。工具依 sensor、解析度、焦距、安裝高度、Heading 與俯角估算 FOV、海面可視範圍與 YOLO 目標尺寸；v0.7 新增固定快照的水域／陸地 overlay 與點擊分類，v0.7.1 將 Leaflet 靜態資源本地化。

## 開啟

v0.7 的水陸資料是相對路徑的靜態 GeoJSON，必須透過 localhost 開啟：

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

然後開啟 <http://127.0.0.1:8765/harbor_ai_camera_planner_v06.html>。直接雙擊 HTML 仍可使用部分地圖、FOV 與 YOLO 功能，但水陸 GeoJSON 的 `fetch()` 會失敗並顯示「請使用 localhost 開啟」。

## 功能

- Sensor optical format 預設：1/4"、1/3"、1/2.8"、1/2.5"、1/2"、1/1.8"、1/1.7"、2/3"、1"，另有 Custom。
- 常見解析度預設：VGA、720p、1080p、3MP、1440p、5MP、4K、DCI 4K，另有 Custom。
- 地圖底圖：OpenStreetMap、NLSC 通用電子地圖與 NLSC 正射影像。
- 預設開啟水域／陸地 overlay；可獨立關閉視覺圖層，點擊分類仍會運作。
- 一般地圖點擊放置測試目標，顯示距離、方位、HFOV、bbox、COCO size、P3/P4/P5、YOLO heuristic 與 `water`／`land`／`Unknown` 地表類型。
- 「地圖點選 Camera」模式只移動 Camera，不觸發 target 分類。
- FOV coverage 依短邊像素分成 ≥32、16–32、8–16、<8 px 四段。

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
- `harbor_ai_camera_planner_v06.html` 使用 `./leaflet/leaflet.css` 與 `./leaflet/leaflet.js`，不使用 `/` 開頭的根目錄路徑，因此可部署在 GitHub Pages repository site、Vercel static hosting、IIS virtual directory、NAS 子目錄或其他網站子目錄。
- 支援 localhost HTTP server：`python -m http.server 8765 --bind 127.0.0.1`。
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

## 驗證

可先執行靜態檢查：

```powershell
python -m json.tool data/kaohsiung-harbor-surface.geojson > $null
node -e "const fs=require('fs');const h=fs.readFileSync('harbor_ai_camera_planner_v06.html','utf8');const a=h.indexOf('<script>',h.indexOf('leaflet.js'));const b=h.indexOf('</script>',a);new Function(h.slice(a+8,b));console.log('inline script syntax ok')"
```

瀏覽器驗證應確認 localhost 載入、預設 overlay、checkbox 開關、三種底圖、一般點擊分類、Camera 放置模式，以及 GeoJSON 404 時既有功能仍可使用。NLSC 正射影像至少抽查 10 點、岸線 5–15 m 的潮位／資料日期差異列為容許帶；ray casting 與相機視角預覽不在 v0.7 範圍。

詳細規格、schema、分類狀態與後續接點見 [`docs/SURFACE_LAYER_IMPLEMENTATION.md`](./docs/SURFACE_LAYER_IMPLEMENTATION.md)。
