# Changelog

## v0.6 — 2026-08-13

- 建立單檔港區 AI 攝影機規劃工具。
- 加入 OSM、NLSC 通用電子地圖與 NLSC 正射影像底圖。
- 加入 sensor optical format、常見解析度、焦距、安裝高度、Heading 與俯角控制。
- 加入 HFOV、VFOV、地平線、海面 near/far footprint 與 YOLO 8/16/32 px coverage。
- 修正 FOV 邊界從 Camera marker 原點開始。
- 讓超出 VFOV 的黃、橘、紅像素距離帶以淡色虛線顯示，避免 coverage 完全消失，同時區分實際可視範圍。
- 移除重複的 Leaflet 圖層控制，只保留側欄 Base map 下拉選單。
- 移除不需要的「回高雄港」按鈕，讓 Camera 放置按鈕使用單欄全寬版面。
