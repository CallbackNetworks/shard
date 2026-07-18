# ADR-0034: 使用者自訂容器層 —— compat 專案欄位維持字面 project、新增通用 container_ids

## Status
Accepted

## Date
2026-07-17

## Context

[[0033-graph-foundation-final-shape]] 的 Phase C 收尾把「型別詞彙資料化」推到最後一哩:讓使用者能把自訂 node 型標記為**容器**(`is_container` 角色),真正實現「使用者自訂邏輯層,並用 `contains` 邊把東西掛進去」。A5 當時刻意**不開放** `is_container` 給使用者設定,是因為一個直接的陷阱:

- `TaskOut.project_id` / `project_ids` 是給前端的相容欄位,前端把它們當**字面專案** id 用(`/projects/{id}` 導頁、成員面板、分析、活動…約 10 個元件)。
- 這兩個欄位在後端是由 `graph.member_project_ids` / `project_ids_map` 計算,而當時它們的過濾條件是 **`is_container` 角色**。內建只有 `project` 一種容器,所以剛好等價於「字面專案」。
- 一旦使用者把某個自訂型標記為 `is_container`,該容器 node 的 id 就會流進 `project_ids` → 前端拿去打 `/projects/{custom_id}` → **404**。

因此「開放 `is_container`」與「compat 專案欄位」兩件事必須一起處理,否則自訂容器會打爆前端。生產尚未上線、資料可丟(見 [[project_purpose]]),但前端相容面是實打實的破壞點,需以**加法、可回滾、兩套資料庫皆綠**的方式進行。

`is_task_like` 角色本次**不開放**:它會讓自訂型的 node 被 `contained_task_ids` → task enrichment 管線當成 task 拉進專案清單,產生半空的 `TaskView`,且需要一整套「自訂 task-like 型如何在 task UI 呈現」的產品決策。屬於另一條更高風險的軸,獨立處理。

## Decision

**1. compat 專案欄位釘死在字面 `project` 型,不再跟隨 `is_container` 角色。**
`graph.member_project_ids` 與 `project_ids_map` 改以 `Node.type == NODE_PROJECT` 過濾(而非 `is_container`)。前端消費的 `TaskOut.project_id` / `project_ids` 因此**永遠只含真正的專案** id,自訂容器 id 不可能外洩造成 404。今日行為逐位元不變(內建唯一容器就是 project)。

**2. 新增通用 `container_ids` 相容欄位 + 對應 helper。**
- `graph.member_container_ids(task_id)` 與 `graph.container_ids_map(task_ids)`:以 `is_container` 角色過濾的**通用超集**(字面專案 + 任何自訂容器型)。
- `TaskOut.container_ids`:一個 task 透過 `contains` 邊所屬的**所有容器**(含自訂型)。純加法欄位,舊前端忽略它、不受影響;需要真正泛化容器語意的 UI(Explorer、未來的自訂層視圖)改讀它。
- 不變式:`container_ids ⊇ project_ids`(專案本身也是容器)。

**3. 刪除孤兒邏輯改用通用容器集。**
`delete_task_tree` / `delete_project_and_tasks` 判斷「這個 task 是否還被別的容器留住而應存活」時,改用 `member_container_ids`(通用)而非 `member_project_ids`。語意更正確:一個同時掛在自訂容器下的 task,在其專案被刪時應存活。今日行為不變。

**4. 開放 `is_container` 給使用者設定。**
`NodeTypeCreate` / `NodeTypeUpdate` 納入 `is_container`;`POST /graph-types/nodes` 可建立自訂容器型,`PATCH` 可切換自訂型的容器角色。**內建型的角色旗標不可變更**(改 built-in `project` 的 `is_container` 會全盤崩壞),更新時對內建型的角色變更回 400。前端型別管理頁(`/graph-types`)新增「容器」核取方塊。

**5. `is_task_like` 本次不開放**(維持 seed/DB-only、`NodeTypeOut` 唯讀曝光),理由見 Context;留待獨立、附產品決策的一次處理。

## Consequences

**正面:**
- 解除 A5 的封鎖:使用者可自訂容器層並用 `contains` 掛載,而前端相容面**零破壞**——自訂容器 id 永不進入字面專案欄位。
- `container_ids` 提供泛化容器的正解通道,和「包含即邊、歸屬可零」的 [[project_graph_model_migration]] 路線一致;只掛在自訂容器下的 task,對前端呈現為「未分類」(`project_ids` 空),不會 404。
- 刪除孤兒語意更正確(任何容器都能留住 task)。
- 逐位元相容:內建容器集不變,既有測試與行為不動;新行為僅在自訂容器出現時才顯現。

**負面 / 代價:**
- compat `project_id`/`project_ids` 與通用 `container_ids` 並存,是「相容」與「泛化」的雙軌;前端要泛化容器 UI 時需自覺改讀 `container_ids`。此雙軌在前端全面理解通用容器前會持續存在。
- 型別角色約束由應用層守(內建不可改、DB 無 check);錯設要靠 API guard 與 UI 防呆。
- `is_task_like` 仍封閉,「使用者自訂 task-like 型」尚不可行,留待後續 ADR。
