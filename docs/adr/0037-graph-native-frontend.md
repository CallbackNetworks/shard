# ADR-0037: 前端圖原生化 —— 通用節點頁與容器視圖

## Status
Accepted

## Date
2026-07-18

## Context

後端已完成 node/edge 全面遷移([ADR-0032](0032-unified-node-edge-graph-model.md) / [ADR-0033](0033-graph-foundation-final-shape.md) Phase A+B+C):每個一等實體都是 node、所有關係都是 edge、type 詞彙資料化在 `node_types`/`edge_types` 註冊表,且使用者可自訂 container 型([ADR-0034](0034-user-defined-containers-and-compat-project-fields.md))與 task-like 型([ADR-0035](0035-user-defined-task-like-types.md))。

但前端是「兩個世界並存」:

1. **日常頁面仍是 project 中心的舊心智模型。** Sidebar 是寫死的 `NAV_GROUPS`;`ProjectDetail`/`IssueRow` 只認 project;`MembershipPanel` 只管 `project_ids`。使用者建了自訂 container(如 `topic`)之後,**沒有任何頁面能「打開它」看它包含的任務** —— C4b/C4c 的後端能力做完了,使用者用不到。
2. **圖能力只露出在三個管理性質頁面**(`/graph-types`、`/explorer`、`/unfiled`)。`NodeExplorer` 顯示邊時只有裸 UUID,不可點、看不出對方是什麼;自訂 node 沒有自己的 URL 和詳情頁。
3. **A4 溯源軌跡**(`graph_events` + `GET /nodes/{id}/events`)後端完成但前端零露出。
4. **StructureMap 在前端用四支舊實體 API 拼裝近似圖**(`deriveStructureMap(projects, identities, goals, decisions)`),底層明明就是圖;自訂 node/edge type 在地圖上不存在。

力場:使用者偏好克制的設計(一個最小 primitive 優於一套機制、復用既有元件);日常使用效率不可退化;既有三個關聯面板(Dependencies/Membership/Labels)各有專用 UX(環偵測、孤兒守衛)不宜貿然整併。

## Decision

**圖是資料模型,不是 UI 隱喻。** 日常介面維持任務中心;圖能力在情境中露出(「這個東西連到什麼」),不做通用圖編輯 canvas 當主介面。三條原則:

1. **type registry 是前端的 schema** —— `['node-types']`/`['edge-types']` 快取驅動渲染決策:顏色、badge、版型選擇(task-like → 任務列;container → 容器視圖;其他 → 通用節點)。
2. **URL 以 node id 為準** —— 任何 node 都有可分享、可從任何地方點過去的頁面。
3. **復用優於重寫** —— 容器視圖參數化 `ProjectDetail`,不另寫;關聯露出復用 `IssueRow`。

七個提案,依「回報最大 → 最小」排序落地:

| # | 提案 | 內容 |
|---|------|------|
| 1 | **地基**:NodeCombobox + 邊回應內嵌節點 | 共用搜尋式節點選擇元件(防抖打 `GET /nodes?query=&type=`);`GET /nodes/{id}/edges` 內嵌兩端節點 `{id,type,title,status}` 避免 N+1 |
| 2 | **通用節點頁 `/n/:id`** | 樞紐頁:type badge + 熱欄位;邊按 `rel_type` 分組、方向分開,鄰居顯示 title + badge 可點導航;task-like 鄰居用瘦身 `IssueRow`;attach/detach 用 NodeCombobox;底部掛 `graph_events` 歷史 |
| 3 | **容器視圖 `/c/:nodeId`** | C4 的前端收割:`ProjectDetail` 參數化復用(board/table/篩選/bulk),project 專屬功能(cycles/labels/share/integrations)對自訂容器隱藏;後端補 `GET /nodes/{id}/contained-tasks`(走既有 `enrich_task`);`MembershipPanel` 升級管 `container_ids`,chip 帶 type badge |
| 4 | **Sidebar 動態群組** | 只加一個群組:每個 `is_container && !is_builtin` 的型一個入口 → 型別清單頁 `/t/:typeKey` → `/c/:nodeId`;既有隱藏/排序偏好自然適用;graph 管理頁收進「Graph」群組。不把個別 node 塞進 sidebar |
| 5 | **IssueRow「其他關聯」小節** | 列出 task 上不屬於 `{contains, depends_on, labeled, in_cycle, assigned_to}` 的邊 + attach 入口(只列自訂 edge 型);既有三個面板**不動** |
| 6 | **StructureMap 吃真圖** | 後端 `GET /graph/map` 回 `{nodes, edges}`(熱欄位 + rel_type,可篩 type);`deriveStructureMap` 改吃真圖;territory 泛化為「任何 container 都是領土」;edge 樣式由 edge registry 決定;inspector 連 `/n/:id` |
| 7 | **一致性收尾** | TypeBadge 全面化(內建 `task` 型不顯示、其餘顯示);Unfiled 加零歸屬自訂 node tab;GraphTypes 補 inline 編輯(PATCH 已存在)+ 使用中計數;CommandPalette 搜尋所有 node type |

**明確不做:**
- 通用圖編輯 canvas 當主介面(拖節點連線)—— 與任務管理效率相悖;StructureMap 維持唯讀導覽。
- 現在整併三個關聯面板成單一 RelationsPanel —— 動到大量測試與既有 UX,風險/回報不划算;自訂 edge 型由提案 5 的小節承接。
- 把 `/explorer` 做大 —— 提案 2、3 落地後它降級為 debug 工具,維持現狀。

## Consequences

**正面:**
- 使用者自訂層(ADR-0034/0035)終於可用:自訂容器有入口、有視圖;「加一層 topic 不會崩」變成看得見的功能。
- 任何 node 有統一的「家」(`/n/:id`),所有關聯可瀏覽、可導航;`graph_events` 溯源露出。
- StructureMap 從「project 關係圖」升級為名符其實的 structure map,且只是替換資料來源,不重寫視覺層。
- 前端渲染由 registry 資料驅動,新增自訂型別零前端改動。

**負面 / 代價:**
- 後端需補三支小 API(邊內嵌節點、`contained-tasks`、`graph/map`)與 `/nodes` 的 `query` 過濾。
- `ProjectDetail` 參數化有回歸風險(它是最大的前端元件之一),需以「project 路徑走舊資料來源、容器路徑走新 API」隔離,分步驗證。
- 多入口(sidebar 動態群組、節點頁、容器視圖)增加導航面積;以「一個群組、不塞個別 node」的克制原則控制。
- 提案分七步各自可獨立交付,但順序有依賴(1 是 2/5 的地基;3 依賴 4 提供入口較完整)。
