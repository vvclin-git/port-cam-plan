# 港區 AI 攝影機規劃工具

單檔 HTML 的港區 camera site-planning prototype。工具用 Leaflet 顯示地圖，依 sensor、解析度、焦距、安裝高度、Heading 與俯角，估算 FOV、海面可視範圍與 YOLO 目標尺寸。

## 開啟

直接用 Edge 或 Chrome 開啟 [`harbor_ai_camera_planner_v06.html`](./harbor_ai_camera_planner_v06.html) 即可使用。

也可以在專案目錄啟動簡單的本機 HTTP server：

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

然後開啟 <http://127.0.0.1:8765/harbor_ai_camera_planner_v06.html>。

## 功能

- Sensor optical format 預設：1/4"、1/3"、1/2.8"、1/2.5"、1/2"、1/1.8"、1/1.7"、2/3"、1"，另有 Custom。
- 常見解析度預設：VGA、720p、1080p、3MP、1440p、5MP、4K、DCI 4K，另有 Custom。
- 地圖底圖：OpenStreetMap、NLSC 通用電子地圖、NLSC 正射影像；由左側 Base map 下拉選單切換。
- Camera marker 可拖曳，也可用「地圖點選 Camera」重新指定位置。
- 點擊地圖可放置測試目標，顯示距離、方位、HFOV 判定、bbox pixel size、COCO size、P3/P4/P5 與 YOLO heuristic。
- 地圖 coverage 依短邊像素分成 ≥32、16–32、8–16、<8 px 四段。
- FOV 邊界從 Camera 原點開始；實際 VFOV 海面範圍以實色顯示，超出 VFOV 的像素距離帶以淡色虛線作規劃參考。

## 計算模型

- `pixel pitch = sensor active width / image width`
- `HFOV = 2 × atan(sensor width / (2 × focal length))`
- `VFOV = 2 × atan(sensor height / (2 × focal length))`
- 地平線距離採用 `3.57 × (√camera height + √target height)` km 的工程近似。
- 俯角與 VFOV 會決定海平面的 near/far footprint；coverage 另與地平線及目標尺寸像素距離交集。

YOLO 顏色分級是 site-planning heuristic，不是 YOLO 官方保證門檻。實際效果仍會受壓縮、光線、海況、遮擋、目標姿態與模型訓練資料影響。

## 網路與圖資注意事項

Leaflet library 與三種底圖都從線上服務載入，因此直接開啟 HTML 時需要網路。若某一圖磚服務被公司網路阻擋，可以從左側下拉選單切換其他底圖；FOV 與 YOLO 計算仍可執行。

Sensor active area 是 optical-format 工程近似值；正式設計應以攝影機 datasheet 的實際 active width/height 為準。

## 驗證

目前版本已完成：

- Inline JavaScript 語法檢查。
- 本機 HTTP 載入驗證。
- Base map 下拉切換驗證。
- 重複 Leaflet layer control 移除驗證。
- FOV 原點與四段 coverage path 渲染驗證。
