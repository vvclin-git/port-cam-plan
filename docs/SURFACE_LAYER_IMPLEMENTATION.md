# v0.7 高雄港水陸圖層實作說明

## 範圍

v0.7 只提供平面二維的 water／land／unknown 分類。FOV 四角 ray casting、相機視角預覽、地形高程、潮位、建築遮蔽與 Roll 不在本版。

## 資料來源與固定快照

GeoJSON：[`../data/kaohsiung-harbor-surface.geojson`](../data/kaohsiung-harbor-surface.geojson)

- 主來源與處理參考：[OSM Data water polygons](https://osmdata.openstreetmap.de/data/water-polygons.html)。該資料由 `natural=coastline` 組裝、修復並提供 WGS84 版本。
- 工作區補充快照：[Overpass API](https://overpass-api.de/)，查詢 `natural=coastline`、封閉 `natural=water` 與封閉 `waterway=dock`。
- 快照日期：`2026-08-13`。
- 固定 bbox：`[120.24, 22.55, 120.36, 22.68]`，順序為 `[min longitude, min latitude, max longitude, max latitude]`。
- 授權：`© OpenStreetMap contributors / ODbL 1.0`。

瀏覽器端不呼叫 Overpass、OSM Data 或任何自動更新服務；只用相對路徑 `./data/kaohsiung-harbor-surface.geojson` 載入提交時的固定檔。

### 處理順序

1. 取得工作區 bbox 內的 OSM `natural=coastline`、`natural=water` 與 `waterway=dock` 幾何快照。
2. 將 coastline ways 與工作區矩形邊界組成線網、polygonize；依 OSM coastline 的 land-left／water-right winding rule 選取主要海水 cells。
3. 將封閉 `natural=water` 與 `waterway=dock` rings 合併進水域，修復無效幾何並移除重疊。
4. 使用約 `0.000015°` 的 WGS84 幾何簡化容差，約相當於 1–2 m；land 由 bbox 外框減去最終水域，水域洞以 MultiPolygon／Polygon hole 保留。
5. 輸出 FeatureCollection，寫入 bbox、來源、快照日期、處理描述、授權與署名 metadata。

這是規劃參考圖資，不宣稱為測量級岸線。正式部署前仍應依港區實際圖資與資料日期校正。

## GeoJSON schema

檔案必須符合以下條件：

```json
{
  "type": "FeatureCollection",
  "bbox": [120.24, 22.55, 120.36, 22.68],
  "source": {
    "primary": "https://osmdata.openstreetmap.de/data/water-polygons.html",
    "supplemental": "https://overpass-api.de/"
  },
  "snapshot_date": "2026-08-13",
  "license": "ODbL 1.0",
  "attribution": "© OpenStreetMap contributors / ODbL 1.0",
  "features": [
    {
      "type": "Feature",
      "properties": {"surface": "water"},
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[120.25, 22.60], [120.26, 22.60], [120.25, 22.60]]]
      }
    }
  ]
}
```

實際輸出只接受 `Polygon`、`MultiPolygon`；每個 feature 的 `properties.surface` 必須是 `water` 或 `land`。座標永遠是 `[longitude, latitude]`、WGS84 / EPSG:4326。Polygon 的第一個 ring 是 outer ring，後續 rings 是 holes；分類器會處理 holes。

## Leaflet 實作

`index.html` 在 Base map 下方建立：

- 預設勾選且載入完成前停用的 `surfaceToggle` checkbox。
- water／land 圖例與載入狀態。
- `surface-pane`，z-index `350`，低於預設 overlay pane 的 FOV／YOLO coverage。
- `L.geoJSON` 視覺 layer。水域為半透明藍色，陸地為低透明度灰棕色；`interactive:false` 確保點擊仍落到地圖。

資料載入完成後，`surfaceFeatures` 與 `surfaceBbox` 供分類器使用。視覺 layer 被關閉只會從 map 移除 layer，不會清除分類資料。

## 分類規則

`classifySurfacePoint(longitude, latitude)` 的順序如下：

1. GeoJSON 尚在載入：回傳 `loading`，UI 顯示「載入中」。
2. 載入失敗或資料無效：回傳 `unavailable`，UI 顯示「無法判定」。
3. 點位超出 top-level bbox：回傳 `unknown`，UI 顯示 `Unknown`。
4. 對 Polygon／MultiPolygon 做 outer ring 與 holes 的 point-in-polygon。
5. 水域與陸地都命中時，水域優先；因此共用邊界回傳 `water`。
6. 沒有命中任何 feature：回傳 `unknown`。

一般地圖 click 會更新既有 target marker 與 `targetResult` 的「地表類型」欄位。Camera 放置模式先更新 Camera、清除 place mode 並 return，因此不會建立 target，也不會觸發該次分類。

## 錯誤與降級行為

| 狀態 | UI | 既有功能 |
| --- | --- | --- |
| `loading` | checkbox disabled、狀態「載入中」 | 地圖、Camera、FOV／YOLO 可用；點擊結果顯示「載入中」 |
| `ready` | checkbox enabled、預設顯示 | 全部可用；關閉視覺 layer 不影響分類 |
| HTTP 404、`file://`、JSON/schema 錯誤 | 狀態「無法判定」，提示雙擊 `start-host.cmd` 或使用 `python -m http.server 8765 --bind 127.0.0.1`，再開啟 `/index.html` | 地圖、底圖、Camera、FOV／YOLO 繼續可用 |
| bbox 外 | 分類結果 `Unknown` | 其他計算繼續可用 |

## 驗證方式

### 資料驗證

```powershell
python -m json.tool data/kaohsiung-harbor-surface.geojson > $null
```

另應檢查：FeatureCollection 可解析、top-level bbox 與 snapshot metadata 存在、geometry 僅為 Polygon／MultiPolygon、surface 值合法、座標順序為 longitude／latitude、所有座標落在 bbox、每個 ring 閉合且至少三個不同頂點、沒有未修復自交或非預期水陸重疊。

### 分類測試案例

應以人工方形 fixture 測試：

- water 內點、land 內點、bbox 外點。
- Polygon hole 內點與 hole 邊界。
- MultiPolygon 第二個 polygon 內點。
- water／land 共用邊界，確認 water 優先。
- `[longitude, latitude]` 順序，避免誤把台灣經緯度反置。

頁面亦提供 `window.surfaceLayerForTest.classifySurfacePoint` 與 `pointInGeometry`，方便瀏覽器 console／Playwright 直接執行上述案例。

### 整合與視覺驗證

以 localhost 啟動後確認：

1. GeoJSON 200 載入、overlay 預設顯示、checkbox 可開關。
2. OpenStreetMap、NLSC 通用電子地圖、NLSC 正射影像可切換。
3. 一般點擊更新 target 與地表類型；Camera 放置模式只移動 Camera。
4. 暫時將 GeoJSON 改名或使用 404 URL，確認提示可操作且既有功能仍可用。
5. 用 NLSC 正射影像抽查至少 10 點，涵蓋港池、碼頭、岸線兩側、防波堤與 bbox 外；至少 9 點相符。岸線 5–15 m 的潮位／資料日期差異可列為容許帶。
6. GeoJSON 載入後拖曳、縮放與單次點擊分類無明顯卡頓；分類目標低於 50 ms。若資料規模增加，先以 feature bbox 建立記憶體索引，再進行 point-in-polygon。

目前已完成靜態 JSON、bbox／ring 基本檢查與 inline JavaScript syntax check；NLSC 正射影像的 10 點人工抽查與真實瀏覽器互動驗證需在具備可用底圖網路的環境執行。

## 後續 ray casting 接點

後續版本可直接使用目前的 `cameraLatLng`、`heading`、`c.hfov`、`surfaceFeatures` 與 `classifySurfacePoint`：

1. 從 Camera 沿四個 FOV 角度建立射線／地面交點。
2. 對每條射線以 bbox／feature bbox 篩選候選 surface polygon。
3. 以目前同一套 holes 與 water-first 規則判定射線穿越的 water／land 邊界。
4. 在不改變 target click 與 Camera placement 分流的前提下，新增四角標記或相機視角預覽。

不要把此版的二維 surface 判定解讀成測量級視線遮蔽或相機可見性結論。
