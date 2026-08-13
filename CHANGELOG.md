# Changelog

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
