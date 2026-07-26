# ADR-0043: 內部 project / label / cycle 寫入收斂至 /api/nodes(container 刪除級聯 role 化)

## Status
Accepted

## Date
2026-07-26

## Context

[ADR-0040](0040-single-graph-write-surface-and-node-roles.md) / [ADR-0041](0041-goal-as-container-and-remaining-write-surface-collapse.md) 把 **task / goal / identity** 的寫入收斂到單一圖寫入面 `/api/nodes` + 角色驅動 dispatcher;[ADR-0042](0042-external-api-graph-native-write-surface.md) 讓外部 API v1 也以 nodes 為唯一實體寫入面。

但**內部 SPA 對 project / label / cycle 仍走專屬寫入路由**(`POST/PATCH/DELETE /api/projects`、`/labels`、`/cycles`),沒收進 `/api/nodes`。ADR-0041 當時明講這塊「卡在 bespoke create 邏輯尚未 role 化」而延後。盤點後,這三者的「bespoke」其實只剩**一項真正的領域反應**:

- **create / update**:讀碼確認皆等價於 `create_node(type, ...)` + 一條 `contains` 邊(label/cycle 的專案歸屬)。share_token 由核心種下(ADR-0041 B);name→title、cycle 的 end_date→due_date、其餘欄位 fold 進 `data`。**無 bespoke 邏輯**。
- **delete**:`delete_project_and_tasks` 會**級聯**——刪除專屬於此容器的 task 子樹、把跨容器共享的 task 只解除連結、刪除容器內的 label/cycle,最後刪容器節點。這是 dispatcher 目前對非 task 節點的**通用 `delete_node` 缺少**的行為(通用刪除只丟節點與其邊,會讓子任務**孤兒化**)。

因此「role 化」的實質 = 把**容器刪除的級聯拆解**掛到 dispatcher 的 container role 上。

## Decision

### 1. container 刪除級聯 role 化(dispatcher)

把 `delete_project_and_tasks` 一般化為 `delete_container(db, node)`,對**任何 container-role 節點**運作(既有實作用的 `contained_task_ids` / `member_container_ids` / `labels_in_project` / `cycles_in_project` 本就接受任意容器 id)。`dispatch_node_deleted` 依 role 分派:

- **container-role** → `delete_container`(級聯專屬 task 子樹、解除共享 task、刪除內含 label/cycle,再刪節點)+ 活動 + 廣播。
- **task-role** → `delete_task_tree`(不變)。
- 其餘 → 通用 `delete_node`(不變)。

這**統一了所有容器的刪除語義為「級聯刪除專屬內容」**,涵蓋 project、goal、自訂容器,並取代 ADR-0041/0042 先前「經 `/api/nodes` 刪容器會孤兒化子任務」的行為(本 ADR 明確 supersede 該後果:改為級聯)。跨容器共享的 task 仍只被解除連結、不被刪除(`member_container_ids` 判定)。

### 2. 裁撤內部 project / label / cycle 富寫入路由

- `routers/projects.py`:裁撤 `POST/PATCH/DELETE /projects`(create/update/delete);**保留**讀取(list/get)、分享控制(set-expiry/share 稽核)等子資源。
- `routers/labels.py`:裁撤 `POST/PATCH/DELETE` label 實體;**保留** list 與 task↔label 指派(`labeled` 邊)。
- `routers/cycles.py`:裁撤 `POST/PATCH/DELETE` cycle 實體;**保留** list/get、task↔cycle(`in_cycle` 邊)、`duplicate`(轉換門面)、`compare`(讀取)。

create/update/delete 一律改走 `/api/nodes`(create 帶 `container_id` 建立 project→label / project→cycle 的 `contains` 邊)。`graph.create_project/create_label/create_cycle` 等 service 保留(facade 測試釘選 + fixtures 使用),只是路由不再是第二寫入面。

### 3. 前端與即時同步

- `client.js` 的 `createProject/updateProject/deleteProject`、`createLabel/...`、`createCycle/...` **維持簽名**(呼叫端不動),內部改組合 `/api/nodes`(+`container_id`)呼叫;做欄位映射(name→title、cycle end_date→due_date、其餘進 `data`)。`duplicateCycle` 維持專屬端點。
- `useRealtimeSync` 的事件前綴新增 `node.`,讓經 `/api/nodes` 的容器/標籤/週期變更也會使其他分頁 invalidate `['projects']`。

## Consequences

**正面**
- **內部寫入面真正單一化**:task/goal/identity 之外,project/label/cycle 的生命週期也全走 `/api/nodes` + dispatcher。內部不再有任何實體的第二寫入路徑。
- **容器刪除語義統一且更正確**:所有容器(project/goal/自訂)刪除都級聯專屬內容、保留共享 task;不再依端點而有孤兒 vs 級聯的分歧。
- create 邏輯零重複:三者 create 都變成 `create_node` + `contains` 邊。

**負面 / 成本(如實記錄)**
- **破壞內部路由合約**(未進生產,已接受):`POST/PATCH/DELETE /api/projects`、`/labels`、`/cycles` 移除;前端與測試改用 `/api/nodes`。
- **回應形狀降級**:create 經 nodes 回 `NodeOut` 而非 enriched `ProjectOut/LabelOut/CycleOut`;前端寫入後 invalidate + 重抓(讀取仍 enriched)。
- **容器刪除行為變更(可觀察)**:先前經 `/api/nodes` 刪 goal/自訂容器會孤兒化子任務,現在**級聯**;supersede ADR-0042「project 刪除孤兒化」的敘述。刪除 goal 會刪掉只屬於它的直屬 task(跨容器者仍保留)。
- **即時同步粒度**:`node.*` 事件不帶 `project_id`,其他分頁對容器內 label/cycle 變更只會 invalidate `['projects']`、不會即時刷新特定專案詳情(下次進入才更新)。動作端本身的 React Query invalidation 不受影響。
- **activity/ws 事件名改變**:`project.created` 等改由 dispatcher 的通用 `node.*` 發出(無下游消費者依賴具體 project.* 名稱,僅 useRealtimeSync 依前綴,已一併處理)。
