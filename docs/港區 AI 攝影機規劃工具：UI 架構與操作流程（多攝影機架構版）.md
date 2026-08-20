# 港區 AI 攝影機規劃工具：UI 架構與操作流程

## 1. 文件目的

本文件整理目前討論形成的 UI 架構、操作流程、資料模型、互動規則與系統狀態，作為後續 UX 設計、前端實作與驗收的共同依據。

目前階段聚焦於：

- 建立新的單螢幕 App 架構。
- 將多攝影機管理提升為第一級功能。
- 保留既有 FOV、YOLO coverage、Camera calculation 與地圖功能。
- 建立清楚的 Map Interaction Mode。
- 將 Camera、Target 與 Observation 解耦。
- 建立多 Camera 與同一 Target 之間的比較架構。
- 預留未來簡單 3D box Target，例如船舶長方體模型。
- 建立 Observation 更新與 invalidation 基本規則。
- 預留 Undo / Redo 架構。

本階段**不包含**：

- Ray Casting。
- DEM。
- Terrain occlusion。
- 水域／陸地分類。
- 圖磚像素顏色辨識。
- HSV / HSL / LAB terrain classifier。
- Ray Casting Python test export。

上述功能後續應以獨立 analysis module 加入，不改變目前 Camera／Target／Observation 核心架構。

---

# 2. 產品定位

這是一個純靜態 Web App，用於在地圖上配置一台或多台攝影機，計算並預覽攝影機視場，並評估指定 Target 在不同 Camera 下的成像條件與 YOLO coverage。

核心使用情境：

- 在港區地圖上新增、定位與調整多台 Camera。
- 即時預覽各 Camera 的 FOV 與地面投影範圍。
- 切換目前工作 Camera。
- 調整 Camera 的位置、姿態、sensor 與 lens。
- 在地圖上獨立建立與管理 Target。
- 查看特定 Camera 對特定 Target 的距離、方位與 coverage。
- 判斷 Target 是否位於特定 Camera 的 FOV 內。
- 比較不同 Camera 對同一 Target 的成像條件。
- 儲存與載入完整多 Camera 專案。

---

# 3. UI 設計原則

1. **固定單螢幕操作**
   - 以 1920×1080 為主要設計基準。
   - App body 本身不產生垂直捲動。

2. **地圖優先**
   - 地圖是主要工作區。
   - Camera 設定與分析結果透過側欄、抽屜或工作台呈現。

3. **多 Camera 是第一級概念**
   - 每台 Camera 獨立存在。
   - Camera 可獨立新增、選取、鎖定、顯示與修改。

4. **Target 是 Project-level entity**
   - Target 不屬於特定 Camera。
   - 同一 Target 可以被多台 Camera 分析。
   - Target 是否位於某台 Camera 的 FOV 內，不影響 Target 是否可以存在。

5. **Observation 表示 Camera × Target**
   - Camera 與 Target 同時存在時才產生彼此的分析結果。
   - FOV inclusion 屬於 Observation 結果，而不是 Target validation。

6. **Selection 與 Interaction Mode 分離**
   - Selection 表示目前工作物件。
   - Interaction Mode 表示下一次地圖操作的意義。

7. **設定與結果即時同步**
   - Camera 或 Target 幾何資料改變後，相關 FOV 與 Observation 應更新。

8. **摘要與詳細資料分層**
   - 地圖顯示必要資訊。
   - 詳細數值透過 Inspector、Result Drawer 或 Bottom Workspace 查看。

9. **資料歸屬清楚**
   - Camera、Target、Observation 與 UI state 不混合儲存。

10. **保留既有計算語意**
    - 新 UI 不得改變既有 FOV、YOLO coverage 或 Camera calculation 的數學結果。

---

# 4. 整體資訊架構

建議採用：

**Camera Rail + Camera Inspector + Map + Result Drawer + Bottom Analysis Workspace**

```text
┌──────────────────────────── Top Bar ──────────────────────────────┐
│ Project / Import / Save / Settings / Status                      │
├──────┬───────────────┬──────────────────────────────┬─────────────┤
│Camera│ Camera        │                              │ Result      │
│ Rail │ Inspector     │             MAP              │ Drawer      │
│      │               │                              │             │
│ A    │ Position      │ Camera marker / FOV         │ Target      │
│ B    │ Orientation   │ Target marker               │ Observation │
│ C    │ Optics        │ Camera-target line          │ Coverage    │
│ +    │               │                              │             │
├──────┴───────────────┴──────────────────────────────┴─────────────┤
│ ▼ Bottom Analysis Workspace                                     │
└──────────────────────────────────────────────────────────────────┘
```

---

# 4.1 Top Bar

固定高度約 52–56 px。

包含：

- App 名稱與版本。
- Project 名稱。
- Import。
- Save。
- Global Settings。
- Help。
- Dirty / saved 狀態。
- App warning / error 狀態。

Top Bar 只放 project-level 操作，不放單一 Camera 參數。

---

# 4.2 Camera Rail

建議寬度約 72–80 px。

Camera Rail 是 Camera selection 與 Camera management 的主要入口。

每台 Camera 至少顯示：

- Color identifier。
- Short name。
- Selected state。
- Visibility。
- Lock。
- Enabled / disabled。
- Error state。

主要操作：

- Add Camera。
- Select Camera。
- Duplicate Camera。
- Rename Camera。
- Show / hide FOV。
- Lock / unlock。
- Delete Camera。

Camera 數量超過畫面高度時，只允許 Camera Rail 自身捲動。

---

## 4.2.1 Camera Selection

點擊 Camera Rail 中任一 Camera：

1. 更新：

```text
selectedCameraId = clickedCameraId
```

2. Camera Inspector 載入該 Camera。
3. 地圖強調該 Camera marker。
4. 地圖強調該 Camera FOV。
5. 其他 Camera 保持可見但降低視覺強調。
6. `selectedTargetId` 保持不變。
7. `mapInteractionMode` 保持不變。
8. 若已有 selected Target，取得或更新對應 Observation。

Camera selection **不代表進入重新定位模式**。

例如：

```text
mapInteractionMode = navigate

Click Camera B

selectedCameraId = B
mapInteractionMode = navigate
```

---

# 4.3 Camera Inspector

Camera Inspector 約 320–360 px。

只編輯目前 selected Camera。

## Position & Orientation

- Latitude。
- Longitude。
- Camera altitude / height。
- Heading。
- Tilt。

## Sensor & Lens

- Sensor format。
- Sensor active width。
- Sensor active height。
- Resolution。
- Focal length。
- Pixel pitch。

## FOV

- HFOV。
- VFOV。
- near。
- far。
- horizon。
- FOV calculation summary。

## Actions

- Fit map to Camera。
- Fit map to FOV。
- Duplicate Camera。
- Reset Camera parameters。

參數修改建議採：

- 即時 UI update。
- debounce 後正式 commit。

---

# 4.4 Map Workspace

地圖佔據最大的剩餘畫面。

包含：

- OSM / NLSC base map。
- 多 Camera marker。
- 多 Camera FOV polygon。
- Selected Camera FOV corner points。
- Project-level Target marker。
- Selected Camera-to-Target line。
- Map zoom control。
- Fit bounds。
- Layer control。
- Map Interaction toolbar。
- Compact calculation summary。

---

## 4.4.1 Camera Visual Hierarchy

### Selected Camera

- 高不透明度。
- 較粗 FOV outline。
- 醒目 marker。

### Unselected Camera

- 保持可見。
- FOV 降低 opacity。

### Hidden Camera

- Camera 仍存在於 Camera Rail。
- FOV 不顯示。

### Locked Camera

- FOV 可顯示。
- 不允許位置修改。

---

## 4.4.2 Camera Marker Selection

點擊 Camera marker 與點擊 Camera Rail item 必須使用同一套 selection logic：

```text
selectCamera(cameraId)
```

Camera marker click 不應：

- 修改 Camera position。
- 自動切換至 `place-camera`。
- 清除 Target selection。
- 隱藏其他 Camera。

---

## 4.4.3 Target Visual Hierarchy

### Selected Target

- 醒目 marker。

### Unselected Target

- 一般 marker。

Target 不因切換 Camera 而消失或重新建立。

Camera 切換只影響：

- Observation。
- Camera-to-target line。
- Result Drawer。

---

## 4.4.4 Target Outside Selected Camera FOV

Target 即使位於 selected Camera 的 FOV 外，仍正常存在與顯示。

若 selected Camera 與 selected Target 同時存在，Camera-to-target line 仍可顯示。

建議視覺呈現：

- Target marker 正常保留。
- Camera-to-target line 使用較低強度或虛線。
- Result Drawer 顯示明確的 `Outside FOV` 狀態。
- 不使用阻斷式 Modal。

Target 位於 FOV 外不是資料錯誤，而是合法的 Observation 結果。

---

# 5. Map Interaction Mode

Map Interaction Mode 決定地圖如何解讀滑鼠操作。

任何時刻只有一個主要 Interaction Mode。

Selection 與 Interaction Mode 必須分離。

> Selection 表示目前正在操作或分析的物件。

> Interaction Mode 表示下一次 map action 要做什麼。

Phase 1 建議實作：

```text
navigate
place-camera
select-target
```

UI 可顯示：

```text
[ Pan ] [ Camera ] [ Target ]
```

---

# 5.1 Navigate

預設模式。

允許：

- Pan。
- Zoom。
- Select existing Camera。
- Select existing Target。
- Tooltip。

點擊空白地圖：

- 不建立 Camera。
- 不建立 Target。
- 不取消 Camera selection。
- 不取消 Target selection。

Selection 採 sticky behavior。

---

# 5.2 Place Camera

`place-camera` 僅用於建立新 Camera，不會搬動目前 selected Camera，也不會在進入模式時建立 draft。

流程：

1. Add Camera、Place Camera 或 Camera Manager 的新增動作切換：

```text
mapInteractionMode = place-camera
```

2. 第一次點擊只記錄 UI-only anchor，顯示 ghost marker 與 FOV preview。
3. 移動游標時以 `bearingBetween(anchor, cursor)` 更新 preview heading。
4. 游標距離 anchor 少於 8 screen pixels 時不可確認；第二次有效點擊才建立一台 `placed` Camera。
5. 更新 FOV 與相關 Observation 狀態，自動返回：

```text
mapInteractionMode = navigate
```

整個建立動作只產生一筆 Store history；Escape 或切換其他 interaction mode 會清除 preview。

---

# 5.3 Select Target

用於建立 Target。

建立 Target **不要求 selected Camera**。

流程：

1. 切換：

```text
mapInteractionMode = select-target
```

2. 點擊地圖。
3. 建立 Project-level Target。
4. 將 Target 設為 selected。
5. 顯示 Target marker。

若目前已有 selected Camera：

1. 建立或取得：

```text
Observation(selectedCameraId, selectedTargetId)
```

2. 計算：
   - Distance。
   - Azimuth。
   - Relative angles。
   - HFOV inclusion。
   - VFOV inclusion。
   - Coverage。

3. 顯示 Camera-to-target line。
4. 開啟 Result Drawer。

### Target 位於 Camera FOV 內

Observation 可回傳：

```text
status = visible
```

並正常顯示 coverage 結果。

### Target 位於 Camera FOV 外

Target **仍然正常建立**。

Observation 可回傳：

```text
status = outside-hfov
```

或：

```text
status = outside-vfov
```

或：

```text
status = outside-fov
```

Result Drawer 應顯示原因與必要數值。

例如：

```text
Outside Camera FOV

Horizontal offset: +38.2°
HFOV limit: ±24.5°
```

可搭配非阻斷提示：

```text
Target created outside Camera A FOV.
Adjust camera heading/tilt or compare another camera.
```

不可因 Target 位於 selected Camera FOV 外而：

- 阻止 Target 建立。
- 自動刪除 Target。
- 強制使用者移動 Target。
- 將 Target 綁定至 selected Camera。

---

## 5.3.1 Target Creation Validation

Target creation 僅驗證 Target 本身是否有效，例如：

- Geographic coordinate 是否有效。
- Target geometry 是否有效。
- 必要尺寸是否符合允許範圍。

以下條件**不是 Target creation validation**：

- 是否位於 selected Camera HFOV。
- 是否位於 selected Camera VFOV。
- 是否具有有效 YOLO coverage。

這些都是 Observation-level calculation。

核心規則：

> **Target creation is camera-independent; FOV membership is an Observation result, not a Target creation constraint.**

---

# 5.4 Future: Move Camera

未來可加入 Camera marker drag。

僅允許：

- selected。
- unlocked。

Camera 可拖曳。

首版可不實作，統一使用 Place Camera。

---

# 6. Selection Model

UI 保留兩個彼此獨立的 selection：

```text
selectedCameraId
selectedTargetId
```

兩者皆可為 `null`。

---

## 6.1 Selection Combination

| Camera | Target | UI State |
|---|---|---|
| none | none | Map browsing |
| selected | none | Camera-only view |
| none | selected | Target-only view |
| selected | selected | Observation view |

---

# 6.2 Select Camera

例如目前：

```text
Camera A × Target 03
```

點 Camera B：

```text
selectedCameraId = B
selectedTargetId = Target 03
```

新的工作組合為：

```text
Camera B × Target 03
```

Target 不會重新建立。

若 Target 03 不在 Camera B FOV 中，則新的 Observation 顯示 `outside-fov`，而不是取消 Target。

---

# 6.3 Select Target

例如目前：

```text
Camera B × Target 03
```

點 Target 04：

```text
selectedCameraId = Camera B
selectedTargetId = Target 04
```

工作組合變成：

```text
Camera B × Target 04
```

Camera selection 不變。

---

# 6.4 Click Empty Map

在 Navigate mode 點擊空白地圖：

```text
selectedCameraId = unchanged
selectedTargetId = unchanged
```

不取消 selection。

只有以下情況才清除：

- Explicit Clear Camera。
- Explicit Clear Target。
- Clear Selection。
- Selected object 被刪除。

---

# 7. Result Drawer

Result Drawer 約 360–400 px。

內容由 Selection Model 決定。

---

## 7.1 Target-only View

條件：

```text
selectedCameraId = null
selectedTargetId != null
```

顯示：

- Target ID。
- Target name。
- Position。
- Geometry。
- Heading。
- Dimensions。
- Rename。
- Delete。
- Fit map。

不顯示 Camera-dependent calculation。

---

## 7.2 Camera × Target Observation View

條件：

```text
selectedCameraId != null
selectedTargetId != null
```

標題：

```text
Camera B | Target 03
```

顯示：

- Camera。
- Target。
- Distance。
- Azimuth。
- Elevation angle。
- Horizontal relative angle。
- Vertical relative angle。
- In HFOV。
- In VFOV。
- Estimated pixel width。
- Estimated pixel height。
- YOLO coverage。
- Calculation status。

---

## 7.3 Outside FOV Result

若 Target 不在 selected Camera FOV 內：

Result Drawer 不應顯示一般 error。

應顯示一個合法但不可觀測的 Observation 狀態。

例如：

```text
Status: Outside HFOV

Azimuth to target: 142.1°
Camera heading: 103.9°
Horizontal offset: +38.2°
HFOV: 49°
Allowed range: ±24.5°
```

若同時超出 HFOV 與 VFOV：

```text
Status: Outside FOV
```

建議提供下一步：

- Adjust Camera heading。
- Adjust Camera tilt。
- Compare Cameras。
- Fit Camera and Target on map。

---

# 8. Bottom Analysis Workspace

預設收合。

建議高度：

280–320 px。

Phase 1 先建立 layout shell。

未來主要分頁：

- Targets。
- Camera Comparison。
- YOLO Coverage。

---

## 8.1 Camera Comparison

使用 selected Target 作為固定 Target。

對 enabled Cameras 計算：

```text
Camera A × Target
Camera B × Target
Camera C × Target
...
```

比較：

- Distance。
- Azimuth。
- FOV status。
- Target pixel size。
- YOLO coverage。

Camera 即使無法看到 Target，仍應出現在比較表中，例如：

```text
Camera A   Visible
Camera B   Outside HFOV
Camera C   Outside VFOV
```

點擊某 Camera row：

- selected Camera 改變。
- selected Target 保持。
- Result Drawer 同步更新。

---

# 9. 操作流程

## 9.1 Add Camera

1. 點 Camera Rail `+`。
2. 進入 `place-camera`，不建立 draft、不改 dirty state。
3. 第一次點擊地圖記錄 anchor，顯示 ghost marker 與完整 FOV preview。
4. 移動游標更新 heading；第二次有效點擊才建立 `placed` Camera。
5. 自動 select Camera、顯示 Details，並回到 `navigate`。
6. 一次建立只產生一筆 history；Undo 一次移除新 Camera。

---

# 9.2 Select Camera

使用者可透過：

- Camera Rail。
- Camera marker。

選取 Camera。

流程：

```text
Click Camera B
        ↓
selectedCameraId = B
        ↓
Update Inspector
        ↓
Highlight Camera B + FOV
        ↓
Keep selectedTargetId
        ↓
Keep mapInteractionMode
        ↓
Target selected?
   ├── No → Camera-only view
   └── Yes
         ↓
      Get / recalculate Observation
         ↓
      Check FOV inclusion
         ↓
      Update Camera-target line
         ↓
      Update Result Drawer
```

若 Target 不在新 selected Camera FOV 內，Target selection 保留，Observation 改為對應的 `outside-*` 狀態。

---

# 9.3 Adjust Camera

1. Select Camera。
2. Camera Inspector 顯示設定。
3. 修改：
   - position。
   - altitude / height。
   - heading。
   - tilt。
   - sensor。
   - resolution。
   - focal length。
4. 即時更新 FOV。
5. Calculation-affecting parameter 改變時增加 Camera revision。
6. 相關 Observation 變成 stale。
7. UI 需要時重新計算 Observation。
8. 原本位於 FOV 內的 Target 可能變成 outside FOV，反之亦然。

---

# 9.4 Move Existing Camera

1. 在 `navigate` 選取 Active Camera。
2. 直接拖曳其 marker；只有 visible、unlocked Camera 可拖曳。
3. drag end 產生一筆 Camera move transaction，更新 position、FOV 與相關 Observation 狀態。
4. Locked Camera 不可拖曳；latitude／longitude 欄位仍提供鍵盤編輯路徑。

---

# 9.5 Create Target

建立 Target 不要求 Camera selection。

1. 進入 Target mode。
2. 點擊地圖。
3. 建立 Target。
4. Target 成為 selected Target。
5. 顯示 Target marker。

若已有 selected Camera：

```text
Camera × Target
        ↓
Observation
```

並計算：

- Distance。
- Azimuth。
- HFOV。
- VFOV。
- Coverage。

若 Target 位於 FOV 外：

- Target 仍保留。
- Observation 顯示 `outside-hfov`、`outside-vfov` 或 `outside-fov`。
- Result Drawer 顯示原因。
- Camera-to-target line 可用弱化或虛線呈現。

若沒有 selected Camera：

- 顯示 Target-only information。
- 不建立 Camera-dependent result。

---

# 9.6 Select Existing Target

1. 點擊 Target marker。
2. 更新：

```text
selectedTargetId
```

3. selected Camera 保持不變。
4. 若已有 selected Camera：
   - 取得或更新 Observation。
   - 判斷 Target 是否位於 Camera FOV。
5. 若沒有：
   - 顯示 Target-only view。

---

# 9.7 Switch Camera for Same Target

例如：

```text
selectedTargetId = Target 03
```

從 Camera A 切到 Camera B：

```text
A × Target 03
        ↓
B × Target 03
```

Target position 與 geometry 完全不變。

只更新：

- Observation。
- FOV inclusion。
- Camera-to-target line。
- Result Drawer。

因此同一 Target 可能：

```text
Camera A → Visible
Camera B → Outside HFOV
Camera C → Visible
```

這是正常的 multi-camera analysis 結果。

---

# 10. Coordinate & Angle Convention

## 10.1 Persistent Position

Camera 與 Target 的 persistent geographic position 使用：

```text
WGS84
EPSG:4326
latitude
longitude
```

---

## 10.2 Local / Analysis Geometry

港區內距離、FOV footprint、polygon 與未來 Target box 計算，可轉換至：

```text
TWD97 TM2 zone 121
EPSG:3826
```

單位：

```text
meter
```

本地 world axis：

```text
+x = East
+y = North
+z = Up
```

Persistent storage 與 analysis coordinates 應分離，不將 projected coordinate 當成唯一 source of truth。

---

# 10.3 Heading

Heading 定義：

```text
0°   = North
90°  = East
180° = South
270° = West

positive = clockwise
range = [0°, 360°)
```

Camera heading 與 Target heading 使用相同 world convention。

---

# 10.4 Camera Tilt

Camera tilt：

```text
0° = horizontal
positive = downward
negative = upward
```

---

# 10.5 Camera Internal Coordinate

未來需要做影像投影時，Camera frame 建議：

```text
+x = image right
+y = image down
+z = optical forward
```

World coordinate 與 Camera coordinate 必須透過明確 transform 轉換。

---

# 11. Target Model

Target 是 Project-level entity。

Target 不屬於特定 Camera。

Target 的存在不依賴任何 Camera 是否能看到它。

---

## 11.1 Target Position

包含：

```text
position
├── latitude
├── longitude
└── altitude
```

---

## 11.2 Target Orientation

預留：

```text
orientation
└── heading
```

Target heading 定義為：

> Target positive length axis 在水平面上的方向。

---

## 11.3 Target Geometry

預留：

```text
geometry
├── type
├── length
├── width
├── height
└── anchor
```

Phase 1 可支援：

```text
type = point
```

未來：

```text
type = box
```

---

## 11.4 Box Target Convention

Box dimension：

```text
length
width
height
```

單位皆為 meter。

長軸方向：

```text
+length axis
```

對船舶模型：

```text
+length axis = stern → bow
```

因此 Target heading 可以直接代表船首方向。

---

## 11.5 Target Anchor

建議：

```text
anchor = bottom-center
```

即 Target geographic position 表示 box 底面的中心位置。

---

# 12. Observation Model

Observation 表示：

```text
Camera × Target
```

唯一關係：

```text
cameraId + targetId
```

Observation 描述 Camera 對 Target 的幾何與成像關係。

Target 是否位於 Camera FOV 內是 Observation 的一部分。

---

## 12.1 Observation Fields

包含：

- Camera ID。
- Target ID。
- Distance。
- Azimuth。
- Elevation。
- Horizontal relative angle。
- Vertical relative angle。
- In HFOV。
- In VFOV。
- Estimated pixel width。
- Estimated pixel height。
- YOLO coverage。
- Status。
- Warning / diagnostic。

---

# 12.2 Observation Status

建議至少支援：

```text
visible
outside-hfov
outside-vfov
outside-fov
invalid-camera
invalid-target
calculation-error
```

`outside-*` 是合法的 analysis result，不是 system error。

例如：

```text
inHFOV = false
inVFOV = true
status = outside-hfov
```

或：

```text
inHFOV = false
inVFOV = false
status = outside-fov
```

---

# 12.3 Observation Source of Truth

Observation 本身不是 source of truth。

Source of truth 為：

```text
Camera parameters
+
Target parameters
```

Observation 是可重新計算的 derived data。

---

# 12.4 Revision

Camera 與 Target 各自維護 calculation revision：

```text
Camera.revision
Target.revision
```

Observation 記錄：

```text
cameraRevision
targetRevision
```

例如：

```text
Camera revision = 13
Observation cameraRevision = 12

→ Observation stale
```

---

# 12.5 Calculation-affecting Changes

以下 Camera 欄位改變：

- position。
- altitude / height。
- heading。
- tilt。
- sensor。
- resolution。
- focal length。

Camera revision 增加。

以下 Target 欄位改變：

- position。
- altitude。
- heading。
- length。
- width。
- height。
- geometry type。

Target revision 增加。

---

# 12.6 Metadata-only Changes

以下修改不影響 calculation revision：

- Camera name。
- Camera color。
- Camera visible。
- Camera locked。
- Target name。
- Target visible。

---

# 12.7 Lazy Recalculation

不要求每次變動後立即重新計算所有 Camera × Target。

例如：

```text
10 Cameras × 100 Targets
```

不需一次更新 1000 個 Observation。

建議：

```text
Camera / Target changed
        ↓
Affected Observations become stale
        ↓
UI requests Observation
        ↓
Recalculate on demand
```

目前 selected Camera × selected Target 可立即重算。

Camera Comparison 開啟時，再批次計算 selected Target 對所有 enabled Cameras 的 Observation。

---

# 13. Project Data Model

```text
Project
├── Cameras[]
├── Targets[]
├── Observations[]
├── Map
└── Global Settings
```

---

## 13.1 Camera

```text
Camera
├── id
├── name
├── color
├── revision
├── position
├── altitude / height
├── heading
├── tilt
├── sensor
├── resolution
├── focalLength
├── HFOV
├── VFOV
├── visible
├── locked
└── enabled
```

---

## 13.2 Target

```text
Target
├── id
├── name
├── revision
├── position
├── orientation
├── geometry
└── visible
```

---

## 13.3 Observation

```text
Observation
├── cameraId
├── targetId
├── cameraRevision
├── targetRevision
├── calculation results
└── status
```

---

# 14. Delete Rules

## Delete Camera

刪除 Camera：

- Camera entity 刪除。
- 所有相關 Observation 刪除。
- Target 保留。

---

## Delete Target

刪除 Target：

- Target entity 刪除。
- 所有相關 Observation 刪除。
- Camera 保留。

---

# 15. UI State

UI state 不寫入 Project geometry data。

至少包含：

```text
selectedCameraId
selectedTargetId
mapInteractionMode

inspectorOpen
resultDrawerOpen
bottomWorkspaceOpen

activeResultTab
activeWorkspaceTab
```

Selection 可為 null。

---

# 16. Undo / Redo

Phase 1 建議使用 snapshot 或 hybrid history。

核心概念：

```text
past[]
present
future[]
```

---

## 16.1 History Transaction

不要在每一個 mousemove 建立 history entry。

例如 Camera drag：

```text
dragStart
→ store before state

drag
→ realtime UI update

dragEnd
→ commit one history entry
```

Slider：

```text
pointerDown
→ remember old value

pointerMove
→ realtime preview

pointerUp
→ commit one change
```

因此 Undo 應代表：

```text
Undo "Move Camera"
```

而不是 Undo 每一個 mouse movement。

---

## 16.2 History Scope

建議納入 Undo / Redo：

- Add Camera。
- Delete Camera。
- Move Camera。
- Camera parameter edit。
- Add Target。
- Delete Target。
- Move Target。
- Target geometry edit。
- Target heading edit。

UI-only actions通常不需要加入：

- Select Camera。
- Select Target。
- Open / close panel。
- Pan map。
- Zoom map。

---

# 17. Dirty State

Project data 改變後：

```text
dirty = true
```

Save 後：

```text
dirty = false
```

以下操作若存在 unsaved changes 應提醒：

- Import new project。
- Load another project。
- Close / reload App。

---

# 18. Project Schema

多 Camera project 建議使用：

```text
camera-project/1.0
```

必須包含：

```text
schemaVersion
```

例如：

```text
schemaVersion = "camera-project/1.0"
```

Import 時：

1. Validate schema。
2. Validate required fields。
3. Future version 可經 migration function 轉換。
4. 不支援版本時給出明確錯誤。

內部 ID 與 display name 分離。

例如：

```text
cameraId = UUID
name = "Camera A"
```

不可使用 display name 當 data key。

---

# 19. 必要 Error / Empty / Observation States

至少需處理：

- No Camera。
- No Target。
- No selected Camera。
- No selected Target。
- Camera not positioned。
- Camera parameter invalid。
- Camera locked。
- FOV calculation failed。
- FOV ray above horizon。
- Target outside HFOV。
- Target outside VFOV。
- Target outside both HFOV and VFOV。
- Coverage unavailable。
- Observation stale。
- Observation calculation failed。
- Invalid project schema。
- Save failed。

需區分：

### System / validation error

例如：

```text
Camera focal length is invalid.
```

### Legitimate Observation status

例如：

```text
Target is outside Camera A HFOV.
```

後者不應呈現為紅色 system error。

---

# 20. Desktop Layout

基準：

```text
1920 × 1080
```

App：

```text
height = 100dvh
body scroll = disabled
```

尺寸建議：

- Top Bar：52–56 px。
- Camera Rail：72–80 px。
- Inspector：320–360 px。
- Result Drawer：360–400 px。
- Bottom Workspace：280–320 px。

Panel 內容超出時：

- Panel 自身 scroll。
- 不讓 body scroll。

首版優先支援：

```text
desktop width >= 1366 px
```

---

# 21. Phase 1 實作範圍

Phase 1 聚焦於 App 重構與多 Camera 基礎。

包含：

- App Shell。
- Top Bar。
- Camera Rail。
- Camera Inspector。
- 多 Camera create / delete / select。
- Camera visibility。
- Camera lock。
- Camera duplicate。
- 多 Camera FOV。
- Selected Camera hierarchy。
- Camera marker selection。
- Map Interaction Mode。
- Independent Camera / Target selection。
- Project-level Target。
- Camera-independent Target creation。
- Point Target。
- Box-ready Target schema。
- Camera-specific Observation。
- FOV inclusion as Observation result。
- Outside-FOV Target workflow。
- Observation revision / invalidation。
- Result Drawer。
- Distance。
- Azimuth。
- HFOV / VFOV。
- YOLO coverage。
- Bottom Workspace shell。
- Basic Undo / Redo。
- Dirty state。
- Basic Project save / load。
- Existing FOV calculation compatibility。

---

# 22. Phase 1 不包含

- Full 3D Target rendering。
- Box projection algorithm。
- Ray Casting。
- DEM。
- Terrain occlusion。
- Water / land classification。
- Tile pixel classification。
- HSV / HSL / LAB classifier。
- Ray Casting export。

Target box schema 可以先存在，但 UI 與 calculation 暫時只使用 Phase 1 所需資訊。

---

# 23. 後續 Phase 建議

## Phase 2：Multi-Camera Analysis

- Camera Comparison。
- Multiple Target comparison。
- Complete Bottom Workspace。
- Coverage ranking。
- Camera recommendation。

## Phase 3：Target Geometry

- Box Target。
- Length / width / height UI。
- Target heading。
- Image-space projected bbox。
- Pixel width / height / area。
- Box-aware YOLO coverage。

## Phase 4：Project & Data Exchange

- 完整 `camera-project/1.x`。
- Schema migration。
- Batch analysis。
- Project interchange。

## Future Analysis Modules

- Ray Casting。
- DEM。
- Terrain occlusion。
- Water / land polygon。
- Tile sampling。

---

# 24. Phase 1 驗收重點

- 1920×1080 下 body 不需捲動。
- 至少可建立三台 Camera。
- Camera 可切換、顯示／隱藏與鎖定。
- 多 Camera FOV 可同時顯示。
- Selected Camera 有明確視覺層級。
- Camera Rail 與 Camera marker 使用相同 selection logic。
- Selecting Camera 不會自動進入 Place Camera。
- Selecting Camera 不會取消 Target selection。
- Selecting Camera 不會改變 Map Interaction Mode。
- Navigate mode 點擊空白不取消 selection。
- Target 可在沒有 selected Camera 時建立。
- Target 不屬於任何特定 Camera。
- 同一 Target 可由多台 Camera 分析。
- Camera / Target selection 可獨立存在。
- Camera × Target 才產生 Observation。
- Target 即使位於 selected Camera FOV 外仍可正常建立。
- Outside-FOV Target 不被當作 system error。
- Observation 可區分 `visible`、`outside-hfov`、`outside-vfov` 與 `outside-fov`。
- 切換 Camera 後，同一 Target 的 FOV status 可正確更新。
- Camera 或 Target 幾何修改後，相關 Observation 正確 stale / update。
- Metadata 修改不造成不必要 Observation invalidation。
- Result Drawer 能區分 Target-only、Visible Observation 與 Outside-FOV Observation。
- Undo / Redo 不會把 mousemove 拆成大量步驟。
- Project 修改後有正確 dirty state。
- 新 UI 不造成既有 FOV、YOLO coverage 或 Camera calculation 回歸。

---

# 25. Phase 0 Normative Contracts

本節是 Phase 0 鎖定的計算與資料契約；若本文件其他段落與本節衝突，以本節及
[`docs/PHASE_0_HANDOFF.md`](./PHASE_0_HANDOFF.md) 為準。

## 25.1 Camera

- 全系統欄位名稱為 `tiltDownDeg`；`0°` 是水平，正值向下，負值向上。UI 標示為「向下俯角 Tilt」。
- `Horizon distance` 是距離欄位，單位只能是 `m` 或 `km`；Phase 0 的工程近似沿用目前球面模型。
- Camera height 欄位為 `heightM`，其 reference 固定為 `heightReference: "intersection-plane"`。
- Scene camera position 必須記錄 `intersectionPlaneElevationM` 與 `verticalDatum: "local-planning-datum"`。

## 25.2 Target and Observation

- Phase 1 地圖上的 Target 仍是 point marker，但資料必須保留 `lengthM`、`widthM`、`heightM`、`headingDeg` 與 `anchor: "bottom-center"`。
- Target physical dimensions 用於 pixel size 與 Camera × Target coverage；這不表示 Phase 1 已完成 3D box projection。
- Camera-only planning envelope 使用 Project-level `planningTargetHeightM`；切換 Target 不得改變該 envelope。
- Observation 是 `cameraId:targetId` 的 derived runtime cache，不是 `camera-project/1.0` 的必要持久資料。Cache 至少記錄 `cameraRevision`、`targetRevision`、`calculatorModelVersion` 與 `generatedAt`。
- Calculation state 為 `idle | calculating | current | stale | failed`；visibility state 為 `visible | outside-hfov | outside-vfov | outside-fov | unavailable`。

## 25.3 Calculation and Schema Relationship

- 正式計算模型版本為 `spherical-v1`，沿用目前球面距離、方位與 FOV 語意；EPSG:3826 僅保留為 future adapter，不參與 Phase 0/1 計算。
- 現有地圖形狀稱為 `planning-envelope`，不是精確四角 ray projection。
- `camera-project/1.0` 用於 Project save/load；`camera-scene/1.1` 用於 selected Camera export。Scene 的 top-level field 固定是單一 `camera`，不改成 `cameras[]`。
- Save Project 預設不持久化 Observation；Camera 與 Target 是 source of truth。

## 25.4 Existing Analysis Boundaries

- Ray Casting、水陸圖層與 Scene export 在 Phase 1 不新增新的 UI 模組，但既有功能必須保留。
- Tile cache 必須按來源隔離，來源 identity 至少包含 Source ID、URL template、layer/style、matrix set 與 tile size；舊的無來源 cache 不再讀取。
- `tileSelection.maximumRayDistanceM = min(horizonDistanceM, 30000)`，並保留 `hardMaximumRayDistanceM = 30000`。

## 25.5 Draft UI References

`docs/UI (1).png` 至 `docs/UI (4).png` 在重新製圖前皆為 **illustrative draft**，不是實作規格；其中的 Tilt 正負號與 Horizon 數值不可直接當作 calculation contract。

Phase 0 的實際完成狀態、驗證命令與未解除風險以 [`PHASE_0_HANDOFF.md`](./PHASE_0_HANDOFF.md) 為唯一交接依據。
