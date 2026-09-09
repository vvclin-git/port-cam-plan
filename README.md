# 港區 AI 攝影機規劃工具

Leaflet 港區 camera site-planning prototype。工具依 sensor、解析度、焦距、安裝高度、Heading 與俯角估算 FOV、海面可視範圍與 Target pixel coverage，並以 Camera × Target Coverage Audit Matrix 協助檢查每個 Target 是否有足夠的 Camera 覆蓋。

目前的 Project 使用 `camera-project/1.0`；單一選取 Camera 的分析匯出使用 `camera-scene/1.1`。計算模型維持 `spherical-v1`，Observation 是 runtime-derived result，不是保存的 Camera／Target 配對。

## 使用流程

1. 在專案根目錄啟動本機 HTTP server，然後開啟 `index.html`。可用 [`start-host.cmd`](./start-host.cmd) 快速啟動，或執行：

   ```powershell
   python -m http.server 8765 --bind 127.0.0.1
   ```

2. 用 `Add Camera`／`Place Camera` 放置 Camera：第一階段點選位置，第二階段移動游標預覽 Heading，再以第二次有效點擊建立一台 Camera。Navigate 模式可拖曳 focused、visible、unlocked 的 Camera 或 Target marker；拖曳結束只提交一次。
3. 用兩階段 Target 放置流程先選位置，再指定船首方向。Target 可使用 `small-vessel` 或 `large-vessel` SVG 船型；Zoom 15 以上會以實際 Length × Width 投影地理尺寸。
4. 從 Object Manager 管理 Cameras／Targets 的選取、搜尋、Visible、Enabled、Locked、Rename、Duplicate、Delete 與 Fit。Camera、Target、Active Camera、Current Target 和視覺上的 `focusedEntity` 是獨立狀態。
5. 在 Inspector 編輯位置、方向、光學或 Target 尺寸。欄位採 preview／blur／Enter 的單次提交；Heading 可用 N/E/S/W compass scrubber 微調。`Focus map` 可暫時把地圖配置為全寬。
6. 在 Bottom Workspace 開啟 Coverage Audit Matrix。它依 Width／Length／Height、最低品質 tier 和每個 Target 所需 Camera 數，從 enabled、成功且在 HFOV／VFOV 內的 Observation 產生 `Qualified`、Best Camera、貢獻與冗餘摘要；矩陣結果不寫入 Project。

## Project、Defaults、Presets 與匯出

Project Settings UI 可管理 Camera／Target Defaults、Preset Library 與 Coverage Requirements；其中 Defaults 與 Preset Library 是 browser-local，不是 Project 持久資料。Camera 與 Target 都支援建立、載入、套用、更新、重新命名、複製、刪除及 Merge／Replace Import／Export Presets；Inspector 的 Apply／Reset 以一次 transaction 套用目前選定的 Preset，Reset 代表恢復目前的 browser-local Defaults。Preset 與 Defaults 的儲存失敗不應破壞既有有效資料。

Top Bar 的 Project menu 支援 New Project、Open Project、Save Project As 與 Rename。New／Open 遇到 dirty Project 時會提供 Save、Discard、Cancel；Open 會先完整驗證檔案，再以原子方式替換目前 Project。

資料邊界如下：

| 類別 | 內容 |
| --- | --- |
| Project 持久資料 | Project name、Camera／Target、Camera／Target 設定、Map settings、Coverage Audit requirements，以及可選的 map viewport。Schema 是 `camera-project/1.0`。 |
| Browser-local | Camera／Target Defaults、命名 Preset Library 與本機偏好；不嵌入 Project 或 Scene。 |
| UI-only／runtime | panel、tab、search、Focus map、placement preview、legend 位置、preview draft、Observation cache、Comparison／Audit runtime 結果、Undo／Redo history 與 dirty state。 |

Camera Scene 匯出是單一 Camera 的分析交接檔，包含當下 Camera、光學、FOV、底圖來源與保守 tile manifest；它不是完整 Project，也不保存 Camera／Target 集合。Project 檔用於恢復規劃工作；Scene 檔用於外部分析或下游流程。

## 計算、Surface 與授權限制

- `HFOV = 2 × atan(sensor width / (2 × focal length))`；VFOV、pixel pitch、地平線與海平面 near／far footprint 依同一 `spherical-v1` 工程模型計算。
- Pixel coverage 的 32／16／8 px 色帶是 site-planning heuristic，不是 YOLO 偵測率保證；實際效果仍受壓縮、光線、海況、遮擋、姿態與模型訓練資料影響。
- Surface 使用固定的 [`data/kaohsiung-harbor-surface.geojson`](./data/kaohsiung-harbor-surface.geojson)，支援 water／land／unknown、Polygon／MultiPolygon 與 holes。資料範圍為 `120.24–120.36 E / 22.55–22.68 N`，來源與處理限制見 [`docs/SURFACE_LAYER_IMPLEMENTATION.md`](./docs/SURFACE_LAYER_IMPLEMENTATION.md)。資料是規劃參考，不是測量級岸線；OpenStreetMap 資料採 `© OpenStreetMap contributors / ODbL 1.0`。
- 目前保留近距離／遠距離、地平線與 30 km 最大射線距離限制；不包含 DEM、潮位、建築物、障礙物或精確 ray-casting 視角真值。
- 舊 Python ray-casting 工具與其快取、CLI、Pillow 依賴已移除。Python HTTP server 在本專案只負責以 localhost 提供相對路徑的靜態檔案，不是 Python 計算服務。

## 網路與部署

本專案是純靜態網站，沒有應用程式建置步驟，也不需要 npm 或 backend。部署時保留 `index.html`、`leaflet/`、`data/` 和其他相對資源的目錄結構；`./leaflet/...`、`./data/...` 等相對路徑也支援 GitHub Pages repository site 或其他子目錄 hosting。

OSM／NLSC 圖磚仍需外部網路；圖磚不隨專案快取或內嵌。Leaflet 1.9.4 的本機檔案與 BSD-2-Clause 授權在 [`leaflet/`](./leaflet/)。

若使用 GitHub Pages，請依 [GitHub 官方文件](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) 在 repository Settings 的 Pages 設定發布來源，選擇要發布的 branch 與 root（`/`）目錄。此說明不代表本 repository 目前已啟用 Pages，也不指定候選網址；本專案沒有新增部署 workflow。

## 開發中（Unreleased）

以下內容已實作並保留在 Unreleased；最新的 [`docs/MAP_CONTROLS_HANDOFF.md`](./docs/MAP_CONTROLS_HANDOFF.md) 記錄了 82/82 Node 測試、Chromium 互動與三種底圖的視覺檢查。這些證據仍不等同於產品發布：touch／stylus、screen reader、原生 OS picker 與實體裝置 Save 等人工 gate 尚未重新認證。需求背景為 [issue #3](https://github.com/vvclin-git/port-cam-plan/issues/3)。

- Map-only Pixel coverage `Reference size` 已與 planning height 分離，支援 preview、Enter／blur 單次提交、Escape／invalid rollback、Undo／Redo 與 Project replacement cancellation；相容性仍是 `camera-project/1.0`，新版可讀舊檔，但舊版嚴格欄位白名單可能拒絕新欄位。
- Camera colors 的 browser-local `Fill opacity` 預設為 16%，另有 focused 與 placement-preview 倍率、Reload／Reset 和 storage fallback；handoff 已比較 OSM、NLSC EMAP 與 NLSC PHOTO 的 16%／24% 顯示，支持目前預設，但不保證所有環境的普遍對比度。
- Leaflet 公制比例尺、legend／status／Inspector 的邊界配置與窄版 map overflow 修正已加入；FOV bearing handle、精確線／路徑量距、per-Camera settings 與 Map Settings redesign 仍在後續範圍。

## 歷史階段摘要

詳細的契約、實作範圍、測試結果與人工驗收界線保留在各 handoff；以下只摘要已提交或已記錄的階段：

- [Phase 0](./docs/PHASE_0_HANDOFF.md)：計算核心、`spherical-v1`、Project／Scene schema 與 ray distance contract。
- [Phase 1](./docs/PHASE_1_HANDOFF.md)、[Phase 2](./docs/PHASE_2_HANDOFF.md)：Project Store、multi-Camera Leaflet projection 與 reactive interaction。
- [Phase 3](./docs/PHASE_3_HANDOFF.md)、[Phase 3.1](./docs/PHASE_3_1_HANDOFF.md)：App Shell、Object Manager、Inspector、Target list、drag／wheel contract。
- [Phase 4.1](./docs/PHASE_4_1_HANDOFF.md)、[Phase 4.2](./docs/PHASE_4_2_HANDOFF.md)、[Phase 4.3](./docs/PHASE_4_3_HANDOFF.md)、[Phase 4.4](./docs/PHASE_4_4_HANDOFF.md)：Comparison／YOLO analysis、FOV modes、two-stage Camera placement、Focus map 與 Heading scrubber。
- [Phase 5.1](./docs/PHASE_5_1_HANDOFF.md)、[Phase 5.2](./docs/PHASE_5_2_HANDOFF.md)、[Phase 5.3](./docs/PHASE_5_3_HANDOFF.md)、[Phase 5.4](./docs/PHASE_5_4_HANDOFF.md)：Camera Defaults、Camera Preset Library、Preset Transfer、Project New／Open／Save As／Rename。
- [Phase 5.5](./docs/PHASE_5_5_HANDOFF.md)、[Phase 5.6](./docs/PHASE_5_6_HANDOFF.md)：Target model／Defaults／Presets／two-stage placement，以及 Camera × Target Coverage Audit Matrix。

Comparison／YOLO 舊 Workspace 表格、crosshair Target 與單次點擊放置是歷史實作脈絡；目前使用 Coverage Audit Matrix、SVG vessel symbol 與兩階段 Target placement。舊 Python 分析工具與舊分析表格的歷史紀錄保留在 [`CHANGELOG.md`](./CHANGELOG.md)，不代表目前仍提供那些工具或 UI。

## 驗證

根目錄完整 Node 測試集合：

```powershell
node --test test_*.js
```

也可執行靜態檢查：

```powershell
python -m json.tool data/kaohsiung-harbor-surface.geojson > $null
node --check portcam-core.js
node --check portcam-store.js
node --check portcam-map.js
node --check portcam-ui.js
```

測試與自動化 browser smoke 不取代實體 touch／stylus、screen reader、native picker、實際下載權限、不同瀏覽器與部署環境的人工驗收；本次文件同步也不宣稱補完這些 gate。

最新 MAP controls handoff 記錄的回歸結果為 `node --test test_*.js` 82/82，並包含實際 Chromium 互動與 1600／1280／900／480 px 版面檢查；這些結果屬 handoff evidence，不取代上述人工 gate。
