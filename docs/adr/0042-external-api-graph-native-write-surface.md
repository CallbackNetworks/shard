# ADR-0042: 外部 API v1 收斂為圖原生寫入面

## Status
Accepted

## Date
2026-07-26

## Context

[ADR-0040](0040-single-graph-write-surface-and-node-roles.md) 把**內部** SPA 的寫入收斂到單一圖寫入面 `/api/nodes`(create 收 `container_id`/`parent_id`、回傳 enriched `TaskOut`、dispatcher 依 role 觸發領域反應),[ADR-0041](0041-goal-as-container-and-remaining-write-surface-collapse.md) 再把 goal(收為 container)與 identity 的生命週期也收進去,並讓寫入核心對任何 shareable-role 型別種下 `share_token`。

但**外部 API v1**(`/api/v1`,`X-API-Key` 驗證,scope read/write/admin)是一條**平行且較舊的寫入面**:它有自己的 task/project/label 的 create/update/delete 端點,而且**完全沒有** goal / identity / 自訂節點型別 / 通用圖(node/edge)的寫入能力。外部 agent 因此只能操作內建的 project/task/label 模型,碰不到 ADR-0033/0034/0041 帶進來的圖模型(自訂 container/task-like 型別、goal 直接持有 task、任意 `contains`/`member_of`/自訂邊)。

盤點現狀(讀碼確認):
- v1 的 task 寫入**已**走 `task_mutations` 核心(`finalize_task_create`/`apply_task_update`),與內部同一條 pipeline;project/label 寫入走 `graph.create_project`/`create_label`。三者的 create 邏輯在 ADR-0041 之後其實都等價於 `create_node(type, ...)`(share_token 已由核心種下,其餘欄位 fold 進 `data`)。
- v1 的寫入端點被 **MCP server**(`mcp_server/server.py`,proxy `/api/v1`)與 **tools_schema**(agent 探索用)直接消費:`create_task`/`update_task`/`delete_task`/`create_subtask` → `POST/PATCH/DELETE /projects/{id}/tasks`,`create_project` → `POST /projects`。
- 系統**尚未進生產**,無外部相容包袱,可直接改 v1。

## Decision

**v1 也以 `/api/v1/nodes` 為唯一實體寫入面**,與內部 `/api/nodes` 對稱。

1. **新增 v1 圖原生寫入面**(`external_api/nodes.py`),委派給與內部相同的角色驅動 dispatcher(`dispatch_node_created`/`_updated`/`_deleted`)以保證**行為與內部完全一致**:
   - `POST /api/v1/nodes`(收 `container_id`/`parent_id`;task-role 回 enriched `TaskOut`,其餘回 `NodeOut`)
   - `GET /api/v1/nodes` / `GET /api/v1/nodes/{id}` / `PATCH /api/v1/nodes/{id}` / `DELETE /api/v1/nodes/{id}`
   - `GET /api/v1/nodes/{id}/contained-tasks`、`GET/POST/DELETE /api/v1/nodes/{id}/edges`
   - `GET /api/v1/graph/map`
   - 分享門面沿用 ADR-0041 的通用 `/api/nodes/{id}/share/*`(v1 亦掛載於 `/api/v1/nodes/{id}/share/*`)。

2. **裁撤 v1 的實體 create/update/delete**:task、project、label 的 `POST/PATCH/DELETE`。**保留**讀取(list/get)、批次門面(bulk create / bulk-update,ADR-0041 決策 C)、以及帶領域驗證的關係子資源(task↔label 指派、dependencies、comments、progress、subscriptions 等)。

3. **v1 node 面的 scope / 專案存取模型**(安全邊界,本 ADR 的重點):
   - GET 需 `read`、寫入需 `write`(沿用 v1 既有 `_require_scope`)。
   - **專案範圍金鑰**(`api_key.project_id` 有值)只能碰「治理專案 == 該金鑰專案」的節點。節點的治理專案 = 節點本身若為 project 則其 id;否則最近的 project 祖先;皆無則 `None`(top-level goal/identity)。
   - 因此**專案範圍金鑰無法建立/變更 top-level 節點**(project、goal、identity、無容器的孤兒 task)——這些跨切節點需**非限定金鑰**。建立 task/label 必須帶 `container_id`/`parent_id` 且解析到該金鑰的專案。
   - 邊操作需對**兩端**的治理專案都有存取權。
   - 刪除採 dispatcher 語義(與內部 `/api/nodes` 一致):task-role 走 `delete_task_tree`,其餘走通用 `delete_node`。

4. **重接 MCP server 與 tools_schema**:MCP 的 `create_task`/`create_subtask`/`update_task`/`delete_task`/`create_project` 改呼叫 `/api/v1/nodes`;tools_schema 對應更新為 node 面描述。

## Consequences

**正面**
- **端到端單一寫入面**:內部 SPA、外部 API、MCP agent 三者都以 `nodes`(+`edges`)為唯一實體寫入面,role-driven dispatcher 是唯一領域反應點。消滅了 v1 這條會分叉的平行寫入路徑。
- **外部 agent 取得完整圖能力**:透過 v1 即可建立 goal(容器,直接持有 task)、identity、自訂型別節點與任意邊——過去只能碰 project/task/label。
- **v1 create 邏輯零重複**:三種實體 create 都變成 `create_node`,share_token 等預設由核心負責。

**負面 / 成本(如實記錄)**
- **破壞既有 v1 外部合約**(未進生產,已接受):`POST/PATCH/DELETE /api/v1/projects`、`/tasks`、`/labels`(實體)移除;呼叫者改用 `/api/v1/nodes`。
- **MCP 回應形狀變動**:`create_project` 經 node 面回 `NodeOut` 而非 enriched project;`create_task` 仍回 enriched `TaskOut`(task-role)。
- **project 刪除語義變動**:舊 v1 `DELETE /projects/{id}` 會連帶刪除子任務(`delete_project_and_tasks`);經 dispatcher 的通用 `delete_node` 會**改為孤兒化**子任務(與內部 `/api/nodes` 一致)。此為刻意取「與內部一致」而非保留舊串接語義。
- **scope 模型較嚴**:專案範圍金鑰不能建立 top-level(project/goal/identity)節點;需要非限定金鑰。這是安全的預設,但比舊行為(可建 project)受限。
- **`/api/v1` 仍未有生產消費者**:待首個真實外部消費者出現時再評估是否需要更細的 scope(如「只能建 task 不能建 goal」)。
