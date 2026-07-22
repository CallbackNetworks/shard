# ADR-0040: 收斂為通用圖 API 單一寫入面,節點能力改以 roles 集合表達

## Status
Proposed

## Date
2026-07-22

## Context

圖模型遷移完成後([ADR-0032](0032-unified-node-edge-graph-model.md) / [ADR-0033](0033-graph-foundation-final-shape.md)),每個一等實體都是 `Node`,寫入後置序列統一在 task_mutation 流水線([ADR-0038](0038-unified-task-mutation-pipeline.md)),能力也資料化為節點型別旗標(task-like [ADR-0035](0035-user-defined-task-like-types.md)、shareable/subscribable [ADR-0039](0039-cross-cutting-capabilities-as-node-type-flags.md))。但仍留下兩個結構性問題,並出現一個新需求逼使我們現在處理它們。

**問題一:雙寫入面行為分叉。** 通用端點 `POST /api/nodes` 只做「啞寫入」——`graph.create_node` 插一行 `Node` 再記一條 `GraphEvent` 就返回;而專用路由(`/api/projects/{id}/tasks`、goals、identities、bulk、imports…)才會呼叫 `fire_notifications` / `run_rules` / `log_activity` / `ws_manager.broadcast`。於是「建立/更新一個 task」這同一個邏輯動作,走不同 URL 會產生**不同的副作用**。2026-07-22 的實測直接踩到:一個 agent 經 `/api/nodes` 建立 task-role 節點並將狀態改為 done,webhook 一個都沒觸發(它看到 201、資料庫也有資料),據此誤報「webhook 壞了」;改走專用路由即正常投遞。這是**靜默降級**——資料寫了、行為丟了、還不報錯,是最難排查的一類缺陷。根因是「領域反應寫死在 controller 層」,無法隨寫入自動組合。

**問題二:能力是「布林湯」。** `node_types` 上有四個能力布林:`is_container` / `is_task_like` / `is_shareable` / `is_subscribable`。程式碼 docstring 其實早已稱之為 "role"(「plays the container role」「task/item role」),但形狀仍是布林:每新增一種能力就要加一列 + 一次遷移;而 `-like` 命名讓一個有原則的 capability-typing 決策看起來像臨時 hack。四個旗標散落在後端與前端約 130 處讀取點。

**新需求(forcing function):身份之上的「組織歸屬」。** 目前 `identity` 是頂層節點,`project` 經 `member_of` 邊掛上身份。「組織在身份之上」本質上就是**再加一層容器**:一個 `organization` 容器節點,身份經 `member_of` 掛入(`org → identity → project → task` 的自由巢狀,正是圖模型本就支援的)。這證明**可自訂型別 + role 模型必須保留**,不能退回硬編碼強型別——同時也要求 role 模型足夠表達力,能一次描述「organization 是可分享、可訂閱的容器」。

## Decision

兩個決定相互耦合:統一寫入核心要「**依 role 分派**」領域反應,所以 role 必須先資料化。合併為一次架構收斂。

### A. 收斂為通用圖 API 單一寫入面,行為下沉至圖寫入核心

- **Canonical 寫入面** = `/api/nodes`(節點生命週期)+ `/api/nodes/{id}/edges`(關係)。所有 create / update / delete / 狀態轉移一律經 `graph.create_node` / `update_node` / `delete_node`。
- 這些核心函式發出**領域事件**(`node.created`、`node.status_changed`、`node.{status}`、`node.deleted`…);單一 **dispatcher 依節點 roles + 狀態轉移**觸發 `fire_notifications` / `run_rules` / `log_activity` / `ws` 廣播。副作用不再掛在任何 endpoint 上,而是掛在**狀態變遷**上——任何入口造成同一變遷,都得到同一行為。
- 因此 [ADR-0038](0038-unified-task-mutation-pipeline.md) 的後置序列(`finalize_task_create` / `apply_task_update`)**下沉進核心**,對「具 `task` role 的任何節點」一致生效,不分內建 `task` 或使用者自訂 `incident`。
- **裁撤內部 `/api` 的富寫入路由**:`/api/projects/{id}/tasks`(create/patch/delete)、goals 寫入、identities 寫入、bulk / imports 的建節點部分——行為已在核心,端點無存在必要;前端改走通用核心。
- **明確切割「非純節點寫入」(如實面對代價,不假裝一把梭)**:
  - **dependencies / labels / cycle-membership** 本就是邊,改走 `/edges`(`depends_on` / `labeled` / `in_cycle`)。
  - **comments / attachments** 目前是獨立資料表(非節點)。本 ADR 決定**先保留為 sub-resource 端點**——它們不觸發節點生命週期副作用,不構成分叉;將其 nodify(comment 亦成 node + `contains` 邊)列為後續 ADR,不在本次範圍。
  - **inbound ingress**(webhook callback、cicd trigger、share / ical 公開端點)**不是 client 寫入端點,是外部入口**,保留;其內部一律呼叫同一寫入核心,故仍受 dispatcher 統一治理。
  - **外部 `/api/v1` 與 MCP 保留為薄門面(thin façade)覆寫於同一核心之上。** 這是對「前端/MCP/外部全改走 `/api/nodes`」的一處工程修正:`/api/v1` 是**刻意穩定的版本化外部契約**,MCP 亦透過它代理([ADR-0005](0005-mcp-server-http-proxy.md));破壞它違背版本化的初衷。行為分叉的消除靠的是**單一寫入核心**,不需要連外部契約一起打破。因此「裁撤富端點」精確地作用於**內部 `/api` 面**;`/api/v1` 以最小翻譯層維持契約穩定,其寫入同樣落到核心與 dispatcher。

### B. `node_types` 能力改以 `roles` 集合表達,取代四個布林

- 新增 `node_types.roles`(字串集合,存為 JSON array)。取代 `is_container` / `is_task_like` / `is_shareable` / `is_subscribable`。
- 對照遷移:`is_container→"container"`、`is_task_like→"task"`、`is_shareable→"shareable"`、`is_subscribable→"subscribable"`。
- 一個型別可**同時具多個 role**(`project = {container, shareable, subscribable}`;`identity = {shareable, subscribable}`;`task = {task}`)——這正是 role 必須是「集合」而非單值的原因。
- 讀取點統一改用 `has_role(type_key, "task")` 等 helper,取代散落的 `is_*` 讀取與 `task_type_keys` / `container_type_keys`。
- role 詞彙一律用**名詞**(`container` / `task` / `shareable` / `subscribable`),去除 `-like`。
- **新增內建型別 `organization`**,`roles = {container, shareable, subscribable}`;`identity` 經 `member_of` 掛入。dispatcher 與遍歷 helper 皆為 role-driven,對 organization **零特判**即生效。
- 未來新增能力(`assignable` / `schedulable` / …)= 集合加一個字串 + dispatcher 加一條規則,**零 schema 改動**。

## Consequences

**正面**
- 消除雙寫入面分叉:任何入口造成的同一狀態轉移,副作用一致。「資料寫了、行為靜默丟失」這類 bug 從結構上不再可能。
- 能力真正資料化:新增能力或型別(organization 等)不再動 schema、不再散落 `is_*` 判斷。
- 表面積收斂:內部寫入 API 從約 9 個富路由收斂到 `nodes` + `edges` 核心;新增可分享/可訂閱/可指派的自訂容器(組織、團隊、部門…)成為零程式碼的資料操作。

**負面 / 成本(如實記錄)**
- **一次性遷移量大**:9 個富路由的行為需無損搬進核心並補測試;前端所有寫入呼叫改走通用 API;現有約 833 個後端測試中觸及 tasks/projects 寫入路徑者需重寫。
- **邊界妥協**:comments / attachments 暫留 sub-resource,尚未完全「純圖」——這是本 ADR **明確接受**的妥協,非疏漏。
- **schema 遷移**:`roles` 需 Alembic migration + 資料回填,並顧及 SQLite 的 `render_as_batch`;約 130 處 `is_*` 讀取需一次改到 `has_role`。
- **外部契約**:`/api/v1` + MCP 維持薄門面,意味「單一寫入面」在**外部面**上不是字面成立;這是刻意保留的契約穩定性,取捨已在 Decision A 說明。
- **回滾成本**:前端與核心耦合到位後,回到雙路由需反向工程;故應分階段落地,每階段獨立可驗證。

**建議實作階段(非本 ADR 強制)**
1. 圖寫入核心發領域事件 + role-driven dispatcher。**此步完成後通用端點即不再啞寫入 → 分叉當場消失,零裁撤、零契約破壞**,可先獨立上線止血。
2. `roles` 集合遷移 + `has_role` helper + 新增 `organization` 型別。
3. 逐一裁撤內部富寫入路由,前端改走核心;`/api/v1` 收斂為薄門面。
