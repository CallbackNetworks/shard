# ADR-0081: 聚焦沿著擁有和包含關係走，不是寫死在身分上

## Status
Accepted

## Date
2026-08-15

## Context

側欄的 Focus 控制項（`FocusSwitcher.jsx` + `IdentityFocusContext.jsx`，ADR-0066/0067）從第一天起就只認一種節點：identity。可以聚焦的候選清單直接查 `Node.type == "identity"`，narrow 專案清單靠 `project.identities`（`owns` 邊的另一端），`owns` 這條邊本身也在 `edge_types` 裡把 `allowed_source` 寫死成 `{"types": ["identity"]}`（ADR-0078）。

使用者在正式站自己建了一個 `organization` 型別（`roles: ["container"]`），疊在 identity 之上：`CGCG -contains-> "Pipeline 開發者"`、`CallbackNetwork -contains-> "獨立內容創作者"`、`ChungChen（個人）-contains-> "個人技術實驗"`。這是圖上真實存在的一層，但 Focus 完全看不見它——側欄只列得出 identity，使用者的問題是「我自己定義的類型也沒辦法 focus」。

`contains` 邊本身早就是 registry-driven 的（`container_type_keys`，ADR-0040）：任何宣告 `container` role 的型別自動可以當父層，不需要改程式碼。問題只出在 Focus 這一層——它沒有沿用這個既有的通用機制，而是自己另外寫死了 identity。不需要新的 schema、新的 role、也不需要動 `owns`/`contains` 的語意（ADR-0078 的決定不變）：這純粹是把 Focus 的候選清單和過濾邏輯，從「identity 型別」換成「圖上真正可達的節點」。

## Decision

**Focus 的候選對象 = 每個 identity 節點 ∪ 每個非 project 的 container-role 節點**，用既有的 `container_type_keys(db)` 算出來，新型別自動生效、不用改碼。

**後端**：
- `graph.reachable_project_ids(db, node_id)`（`services/graph/core.py`，緊接在 `descendants_of` 之後）：對 `contains`＋`owns` 邊做 forward、分層批次查詢的 BFS，碰到 `type == "project"` 就收下、不再往下展開（一個 project 自己的 `contains` 子節點是 task，跟這裡無關）。
- `graph.all_focus_targets(db)`（`services/graph/identities.py`）：合併 identity 節點與非 project 的 container-role 節點，每個都算一次 `reachable_project_ids`，回傳 `id/name/type/type_label/color/avatar/project_ids/project_count`。`color` 優先取節點自己 `data.color`（identity 有這個欄位），沒有就退到型別在 registry 上的顏色（大多數 container 型別──包括 `organization`──沒有宣告 `color` 欄位，只有型別本身的顏色）。
- 新的內部端點 `GET /api/focus-targets`（`routers/focus.py`，掛在既有 `/api` 前綴下，只給 SPA 用，不是外部合約）。`GET /api/identities` 原封不動——identity hub、分享、guest notes 這些身分專屬功能還是需要那個窄的讀法。

**前端**：
- `IdentityFocusContext.jsx` 改讀 `GET /api/focus-targets`；對外欄位從 `identities`/`focusIdentity` 改名成 `focusTargets`/`focusTarget`（`focusId`/`setFocusId`/`toggleFocus`/`clearFocus` 不變，聚焦對象本來就還是「一個 id」）。`filterProjects` 直接用後端算好的 `focusTarget.project_ids` 判斷成員，取代原本重新掃一次 `project.identities` 的寫法。
- `FocusSwitcher.jsx`：清單來源換成 `focusTargets`，每個選項旁邊多一個型別 badge（identity 顯示固定的「身分」字樣，其他型別顯示 registry 給的 `type_label`，例如「組織/公司」）——因為清單裡混了不同型別，光靠頭像圓圈已經分不出誰是誰。
- Structure Map（`utils/graphStructure.js`）本來就在瀏覽器裡拿著完整的節點/邊圖（ADR-0037/0069 的既有做法），所以 `focusGraph` 不是重打一次後端那套 BFS，而是重用它已經建好的 `childrenOf`（contains 子節點索引）：從 focusId 往下走 contains 收集整個分支（包含它自己），分支裡的 identity 節點再拿去比對每個 project 的 `identityIds`。原本「只留 `i.id === focusId` 那一個 identity」的寫法，現在是「分支裡的所有 identity」——多層 organization、org 直接 contains project 都同一套邏輯涵蓋。

## Consequences

正面：
- 使用者現在可以用 Focus 選任何自訂的 container 型別，不用改一行程式碼——`organization` 已經生效，下一個自訂容器型別也一樣。
- Focus 的候選資格跟 `contains` 的可容納資格用同一份 registry（`container_type_keys`），沒有第二套「誰能當容器」的定義。
- 沒有動 `owns`/`contains` 的邊型別宣告，ADR-0078 的規則和它的測試（`test_edge_semantics.py`）完全不受影響；也沒有新的 role、沒有 migration。
- Structure Map 和側欄用各自手上已有的資料（後端的 REST 摘要 vs. 前端已載入的完整圖）各自算一次同一個「沿 contains/owns 可達」的概念，跟 ADR-0065/0069 的既有分工一致——不是又長出第 12 個各自為政的實作（ADR-0068 那個教訓）。

負面：
- `IdentityFocusContext` 的對外欄位改名（`identities`→`focusTargets`、`focusIdentity`→`focusTarget`），四個消費端（`FocusSwitcher`、`Dashboard`、`StructureMap`／`graphStructure.js`、對應測試）跟著要改；`CommandPalette.jsx` 因為只用 `filterProjects` 而不受影響。
- Focus 的候選清單現在可能同時混著 identity 和自訂容器型別，使用者要多看一眼型別 badge 才分得出兩者——這是刻意的取捨（ADR-0066 已經把它定成「一個搜尋式清單」而不是分組清單，這裡沿用同一個介面而不是另開一層）。
- `reachable_project_ids` 對每個候選節點各跑一次 BFS；候選數量（identity + 少數自訂容器節點）目前規模很小，沒有分頁或快取，之後候選節點數量大幅成長時要重新評估。
