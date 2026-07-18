# ADR-0035: 使用者自訂 task-like 型別為一等 task

## Status
Accepted

## Date
2026-07-17

## Context

[[0034-user-defined-containers-and-compat-project-fields]] 開放了 `is_container`(自訂容器層),但刻意把 `is_task_like` 留在封閉狀態,理由是它比容器更深:`is_task_like` 角色驅動 `graph.task_type_keys` → `contained_task_ids` → 整條 task enrichment 管線(`TaskView` / `enrich_task` / `TaskOut`)。若在管線尚未準備好時就開放,會出現一個**沉默的不一致**:

- `contained_task_ids` / `unfiled_task_ids` 以**角色**過濾 → 自訂 task-like 節點會被收集;
- 但 `get_task` / `task_views_by_ids` / `task_views_for_ids` / `_delete_task_node` 等**寫死 `Node.type == "task"`** → 同一批節點在載入前就被丟掉;
- 且 `TaskOut.callback_token` 是必填 `str`,而經通用 `/nodes` API 建立的節點 `data` 裡沒有 `callback_token`(→ None)→ 一旦真的進到 enrichment 會驗證失敗。

擁有者確認產品意圖(2026-07-17):**自訂 task-like 型別應為「完整的一等 task」** —— 出現在專案 task 清單/看板、走同一條 enrichment,只是帶自己的型別(圖示/標籤)。這是 [[project_graph_foundation_todo]] 一路「型別即資料、node-only 終局」的自然收尾。

**為何用資料欄位(角色旗標)而非 class 繼承:** 使用者自訂型別只存在於**執行期**,而 class 必須存在於**編譯期** —— 無法為使用者在跑起來的 app 裡發明的型別生出 Python 子類別。整個遷移的命題就是把型別詞彙從程式碼/schema 搬進資料(`Node` 已收斂成單一 class + `type` 字串 + `data`);角色是**可組合的正交布林**(可同時是容器與 task-like,或皆非),契合 mixin 而非單一繼承樹。行為仍封裝在一個 class(`TaskView`)裡,差別只在「哪些節點交給它」由執行期角色決定 —— 即組合優於繼承。代價是不變式(task-like ⇒ 有 callback_token)改由應用層守,而非型別系統;但對執行期定義的型別,編譯期保證本就拿不到。

## Decision

**1. task 生命週期改為角色驅動。** 以下由寫死的 `type == "task"` 改讀 `graph.task_type_keys(db)`(內建 `task` + 任何 `is_task_like` 自訂型):`get_task`、`task_views_by_ids`、`update_task`、`_delete_task_node`、`find_task_by_callback_token`、`find_task_by_external`、`set_parent_task`(判斷舊父是否為 task),以及 router 的 `list_tasks` / `reorder_tasks` 過濾。**保留字面 `NODE_TASK`** 的是「建立內建 task」的 `create_task`(自訂 task-like 節點走通用 `/nodes`)。

**2. task-like 節點在建立時取得完整 task `data` 面。** `graph.create_node` 偵測到 type 為 task-like 時,套用共用的 `_apply_task_data_defaults`(補 `callback_token` 與各 scalar 欄位),使其節點能載入為 `TaskView`、通過 `TaskOut` 驗證、與內建 task 一樣 enrich。內建 task 仍走 `create_task`(不重複)。

**3. `TaskOut` 曝露 `type`,`callback_token` 改為選填。** 新增 `TaskOut.type`(預設 `"task"`,取自節點 type)讓前端能顯示自訂型別的標籤/顏色;`callback_token` 放寬為 `str | None`,以容忍「先建立節點、之後才把該型標記為 task-like」而尚無 token 的節點(不必回填即不會 500)。

**4. 開放 `is_task_like`(僅自訂型)。** `NodeTypeCreate` / `NodeTypeUpdate` 納入 `is_task_like`;`PATCH` 對**內建型**的角色變更(`is_container` 或 `is_task_like`)一律回 400(改內建 `task` 的角色會打爛 enrichment 管線)。前端型別管理頁新增「task」核取方塊;task 列以 `TypeBadge` 顯示非 `task` 的自訂型別(標籤/顏色取自 `node_types` 註冊表,查無則退回 type key)。

## Consequences

**正面:**
- 補齊 node-only 終局的最後一塊:使用者可自訂「可工作的項目型別」(如 `ticket`/`story`/`spike`),與內建 task 並列於清單/看板,走同一條 enrichment、可指派/依賴/子任務/評論。
- 一致性:與 `is_container`(ADR-0034)同一套註冊表 + 角色機制;不引入平行的 class 階層。
- 沉默不一致被消除:角色過濾與 TaskView 載入現在同源(皆角色驅動)。

**負面 / 代價:**
- task 型不變式(有 callback_token、scalar 欄位齊備)由應用層維護(`create_node` 補值),而非型別系統保證;繞過此路徑直接插 node 需自行負責。
- 「先建節點、後標 task-like」的既有節點可能無 callback_token → `callback_token` 選填化以避免 500,但這類節點的 webhook 回呼在補值前不可用。
- `create_node` 每次建立都查一次 `task_type_keys`(小成本);`TaskOut` 多一個 `type` 欄位與前端一支共用 `['node-types']` 查詢(React Query 去重快取)。
- `is_container` 與 `is_task_like` 可同時開:一個型別可既是容器又是 task —— 語意上允許,但 UX 需自行防呆避免使用者造出難以理解的結構。
