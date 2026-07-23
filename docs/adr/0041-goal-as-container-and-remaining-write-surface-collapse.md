# ADR-0041: goal 收為 container role、identity 寫入收斂,decision 維持 enhanced-label

## Status
Proposed

## Date
2026-07-23

## Context

[ADR-0040](0040-single-graph-write-surface-and-node-roles.md) 落地了兩件事:能力資料化為 `node_types.roles` 集合(`has_role`),以及把 **task** 的寫入收斂到單一圖寫入面 `/api/nodes`(create 收 `container_id`/`parent_id`、回傳 enriched `TaskOut`,dispatcher 依 role 觸發領域反應)。ADR-0040 明確把三塊留給後續:goal 與 decision 的**型別語義 role 化**,以及 **goals / identities / bulk / imports 寫入路由的裁撤**。本 ADR 逐一給出定案。

盤點每個實體的**真實現狀**(讀碼確認,非臆測):

- **goal**:是 `Node(type="goal")`,**無 role**。project 經 `part_of` 邊(project→goal)掛上;`goals.py` 用**專屬程式碼**算進度(各 linked project 進度的**平均**)。goal 目前**無法直接掛 task**——只有 `part_of`(project→goal)一種關係。
- **decision**:**根本不是獨立型別**。它是 `Node(type="label")` 且 `data.type=="decision"`、帶 `decision_status`,複用整套 label 機制([ADR-0004](0004-decision-records-as-enhanced-labels.md))。前端靠這一點,用同一個 `#` 選擇器把 decision 快速連到某個 task/goal(建立 `labeled` 邊)。
- **identity**:是 `Node(type="identity")`,**已具 roles**(`shareable`、`subscribable`)。它不缺 role;唯一的專屬處只是 create 時種下 `share_token`/pin/expiry 預設。其分享操作(rotate-token/set-pin/set-expiry)在 `/api/nodes/{id}/share/*` **早有通用版**;project↔identity 連結是 `member_of` 邊。
- **bulk / imports**:是**批次 / 格式轉換門面**,不是「單實體 CRUD 的第二條寫入面」。`bulk-update` 逐個 task 呼叫 `apply_task_update`(完整 pipeline);`import_*` 呼叫 `graph.create_task` + pipeline。它們**早已走同一個核心**。

**逼出設計的關鍵觀察:大量「孤兒 task」其實只是為了某個 goal 而存在,並不歸屬於任何 project。** 現行 `part_of`(project→goal)無法表達「task 直接屬於 goal」;要支援它,只會被迫再發明一條 `task→goal` 特例邊,讓 goal 底下出現兩種異質關係。

## Decision

### A. goal 收為 `container` role(可直接含 task,進度改 task 加權)

`project ──part_of──▶ goal` 與 `goal ──contains──▶ project` 是**同一個關係、箭頭反向**。「一個 goal 由這些事情組成、進度是它們的匯總」字面上就是容器語義。因此:

- **goal 的型別 `roles` 加入 `container`**。`part_of`(project→goal)**反向遷移為** `contains`(goal→project);`part_of` 邊型別隨後退役。
- goal 因而**可直接 `contains` task**(`goal ──contains──▶ task`),自然收容「只為 goal 而存在、不屬任何 project」的孤兒 task。它們的相容欄位沿用 ADR-0034 既有機制:`project_id = None`、`container_ids = [goal]`——與「掛在自訂容器下的 task」完全同一套,前端不需新邏輯。
- **進度改為沿 goal 子樹的 task 加權**:`goal 進度 = 子樹內 done task 數 / 子樹內全部 task 數`,不論該 task 是直接掛在 goal 下、還是在 goal 底下某 project 裡,一視同仁。取代原本「各 project 進度平均」的 project 加權法。
- goal 的 create/update/delete 收進 `/api/nodes` + dispatcher;`goals.py` 保留讀取/enrich,裁撤其富寫入路由。
- **選 `container` 而非新增專屬 role(如 `objective`)**:後者只是把「goal 是特例」換個名字重編碼——仍保留 `part_of` 特例邊、仍保留專屬進度查詢、dispatcher 仍需特判,且**無法表達 task 直屬 goal**。`container` 讓 goal 與 project、與未來的 org 同為容器,只是層級不同,複用既有遍歷 / dispatcher / 相容機制。

### B. identity 寫入收斂至 `/api/nodes`

- **核心在建立時,對帶 `shareable` role 的型別自動種下 `share_token` 預設**(把 `create_identity` 的專屬段落一般化到寫入核心)。任何 shareable 型別(identity、project、自訂 topic…)經 `/api/nodes` 建立即得到分享門面所需的 token。
- 前端 identity 寫入改走 `/api/nodes`;project↔identity 連結改走 `/api/nodes/{id}/edges`(`member_of`)。
- 裁撤 `identities` 的 create/update/delete、以及三個分享操作(已有 `/nodes/{id}/share/*` 通用版)。**保留** identity 的讀取/enrich(`IdentityOut`、hub 統計)與焦點切換等非寫入端點。

### C. bulk / imports 保留為核心之上的薄批次門面

- **不裁撤。** 訂正 ADR-0040「端點無存在必要」的過度表述:bulk-update 的價值在批次語意(單請求、聚合廣播、500 上限保護),import 的價值在外部格式轉換,兩者**早已呼叫同一寫入核心**(`apply_task_update` / `create_task` + pipeline),不構成行為分叉。維持現狀,僅在此記錄其定位。

### D. decision 維持 enhanced-label(明確定案,非續延)

- **不抽成獨立型別。** role 掛在 `node_types` 的型別 key 上,而 "decision" 目前只是 label 節點的 `data.type` 值——「role 化 decision」與「把 decision 抽成獨立型別」是同一件事,沒有中間路線。
- 抽出來的代價是**犧牲既有的 `#` 快速連結 UX**(單一 `#` 選擇器、單一 `labeled` 邊,同時服務標籤與決策),換來的僅是「decision 不再假裝成 label」的架構整潔;且 decision **本就不在寫入面裁撤清單內**,ADR-0041 的核心目標不需要動它。
- 依「用最小既有原語、複用現有表」的取向,**決定保留 decision 為 label 的一種**,把 ADR-0040 的「延後」正面收斂為「已決定保留,理由如上」。ADR-0004 不推翻。

## Consequences

**正面**
- **容器模型統一**:`org → goal → project → task` 成為單一關係(`contains`)、單一 role(`container`)、任意深度的巢狀;退役 `part_of` 這條一次性特例邊。孤兒-for-goal 的 task 終於有家。
- **單一寫入面再擴一圈**:task(ADR-0040)之外,goal 與 identity 的生命週期也收進 `/api/nodes` + dispatcher;shareable 預設一般化後,任何 shareable 型別「建立即可分享」成為零程式碼的資料操作。
- **decision 的 `#` UX 與克制設計獲得保留**,且 ADR-0040 的懸念被正面收掉,而非無限延後。

**負面 / 成本(如實記錄)**
- **一次性 schema 遷移**:`part_of`(project→goal)需 Alembic **反向**遷為 `contains`(goal→project)並回填,再退役 `part_of` 邊型別;render_as_batch 顧及 SQLite。
- **goal 進度語義改變(可觀察行為變更)**:從「各 project 平均(project 加權)」改為「子樹 task 加權」。同一批資料下數字會變;需在前端 goal 視圖溝通,並涵蓋「goal 直屬 task」的顯示。
- **goal 成為容器後的曝光面**:goal 會以 container 身分出現在容器相關 UI(sidebar 自訂容器列表、`#`/容器選擇器、unfiled 判定)。需決定 goal 在這些位置**與 project 同列或區隔**(預設建議:goal 有自己的導覽分區,不混入「自訂容器」清單)。
- **identity 寫入回應降級**:通用端點對非 task role 回 `NodeOut` 而非 `IdentityOut`;前端寫入後 invalidate + 重抓(讀取仍 enriched),影響可控。
- **decision 維持「不純」**:它仍是「假裝成 label 的決策」。這是本 ADR **明確接受**的取捨(UX 與複用 > 型別純度),非疏漏。
- **`/api/v1` 外部門面**:延續 ADR-0040,外部 API 尚未生產,本次不投入門面建設,待首個真實外部消費者再另立 ADR。

**建議實作階段(非強制,逐一可驗證)**
1. goal → container:Alembic `part_of`→`contains` 反向遷移 + `roles` 加 `container`;進度改 task 加權子樹聚合;goal 寫入接 `/api/nodes`,裁撤 `goals.py` 富寫入路由;前端 goal 視圖涵蓋直屬 task。
2. identity:寫入核心種 `shareable` 預設;前端 identity 寫入 → `/api/nodes`、連結 → `/edges`;裁撤 `identities` 富寫入 + 分享操作,保留讀取。
3. 文件訂正:bulk/imports 定位、decision 定案,更新相關 ADR 索引與交叉引用。
