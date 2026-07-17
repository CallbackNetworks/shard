# ADR-0033: 圖底層定案 —— 資料化 type/edge 詞彙、稽核式溯源、node-only 終局

## Status
Accepted

## Date
2026-07-16

## Context

[[0032-unified-node-edge-graph-model]] 已把「包含」從 schema(`project_id`/`parent_id` 外鍵)搬進資料(`contains` 邊),解決了「加一層邏輯層級就得改表、整棵樹崩塌」的老問題。但 ADR-0032 停在一個**半遷移的過渡狀態**:node/edge 基質已就位,實體卻仍雙儲存(各自的表 + `nodes` 鏡像),而 node 型與 edge 型的詞彙仍**寫死在程式碼**(固定常數集、`graph_sync._ENTITY_TYPES`、`graph.py` 幾支 `n.type == NODE_TASK/PROJECT` 的過濾)。

擁有者的核心心智模型(源自過去專案的痛):樹狀的**物理分區** component 永遠無法在使用時隨意建立 edge、再依 edge 推導**邏輯**層歸屬;很多事物一開始**根本沒有專案歸屬**(有些只是個「話題」,話題底下才有 task);把歸屬在建立時就設死,是個古板的系統。目標因此不只是「包含變邊」,而是把**層級(category / node 型)本身**開放給使用者自行定義。

生產環境尚未上線,目前資料庫只有可丟棄的 dev 測試資料(見 [[project_purpose]]),因此可承受地基級改動,不必顧慮線上遷移。擁有者的疑慮很明確:**「這個新底層架構到底算不算完整?會不會下次又得從地基重來一次?」** 為回答此問,對心智模型做了一次需求採訪,逐一走過會逼使 graph 模型重做的每個維度。

**採訪結論(2026-07-16):**
1. **包含關係**:採「通用 `contains` 預設 + 可選的具名關係」。不強制一套具名層級分類。
2. **edge 型也要資料化**:relationship 詞彙不只內建,使用者可自行發明(如 `blocks`、`relates-to`、`references`)。
3. **自訂欄位**:以 JSON `data` 袋儲存即可;查詢/排序能力**延後**(JSON 前向相容,日後加索引或投影不需資料遷移),不列為地基決定。
4. **溯源**:只需**稽核軌跡**(誰在何時把 X 加到/移出哪),**不需** bitemporal 的「還原任一過去時間點完整結構」。

## Decision

判定:**`nodes` + `edges` 基質架構已完整、屬最終形態,不會再逼出地基級重做。** 補齊「使用者自訂層」與「溯源」所需的一切,都是**不改動既有 `nodes`/`edges` 欄位形狀的加法**。定案的完整地基如下。

**保持不變(已最終化):**
- `nodes`:`id` / `type` / `title` / 熱欄位 / `data` JSON / 時間戳(見 ADR-0032)。
- `edges`:`id` / `source_id` / `target_id` / `rel_type` / `position` / `data` JSON / `created_at`,唯一約束 `(source, target, rel_type)`。**因溯源採稽核制,edge 不做 bitemporal**,live edge 維持硬刪除的簡單語意。

**新增 `node_types` 註冊表** —— node 型詞彙資料化:`key`、`label`、`icon`、`color`、`is_builtin`,以及選填的預設熱欄位提示。內建型(task/project/identity/goal/cycle/label)以 seed 寫入。使用者可 CRUD 自訂型;自訂型的 node 以純 `Node` + `data` JSON 存在(node-only,無專屬表)。

**新增 `edge_types` 註冊表** —— relationship 詞彙資料化:`key`、`label`、`is_builtin`、以及語意旗標(如「是否具容器語意」用於遍歷、是否對稱)。內建 `contains`/`member_of`/`assigned_to`/`depends_on`/`labeled`/`in_cycle`/`part_of` 以 seed 寫入。

**新增 append-only `graph_events` 記錄**(或擴充現有 `ActivityLog`)—— 溯源的稽核軌跡:`node_created` / `edge_added` / `edge_removed` 等事件,帶 `actor` 與時間戳。此為**唯一附加**,不觸及遍歷;且 append-only 事件可回放重建過去狀態,保留了日後若改需完整時間回溯的後路。

**新增通用 node 操作**(把寫死在型別上的邏輯改為註冊表驅動):`create_node(type, **fields)`、`add_edge` / `remove_edge`(順帶寫 `graph_events`)、**通用「刪 node → 清其所有觸及邊」路徑**(補掉 node-only 型的 dangling-edge 陷阱 —— `graph_sync` 現行的刪除清邊只對 `_ENTITY_TYPES` 中的實體類別觸發)、通用 `NodeOut` 序列化。`graph.py` 的 `n.type == NODE_TASK/PROJECT` 過濾改由 `node_types` 註冊表的角色判定。

**node-only 為終局。** 內建實體(task/project/…)最終收斂為純 node,實體表消失、型別詞彙全資料化。分階段、一次一型、兩套資料庫(SQLite + PostgreSQL)每階段皆綠,**嚴禁 big-bang**。因目前資料可丟,可評估比 strangler 更積極的收斂節奏。詳見 `docs/graph-model-migration-plan.md` 的 Phase A/B/C。

**表達力完整性的逃生口**(佐證此地基不需重做):
- **n 元關係**(A 在情境 C 下依賴 B):以**具現化**表達(把關係本身變成一個 node,再連向各參與者),不改 schema。
- **自訂欄位大量查詢**:JSON 前向相容,日後加 side-table(`node_id, field_key, value`)或原生 JSON 索引(Postgres JSONB GIN / SQLite 表達式索引)。
- **大圖遍歷變慢**:換遍歷實作(遞迴 CTE),屬實作優化而非 schema 變更。

## Consequences

**正面:**
- 回答了核心疑慮:node/edge 核心 schema 已是最終形態;補「自訂層 / 溯源」皆為螺栓式加法,**不會有地基級的「下次又來一遍」**。
- 層級(category)成為使用者可定義的資料;node 型與 edge 型兩套詞彙皆資料化,契合「事物先存在、歸屬與結構後來才由 edge 湧現」的心智模型,並延續「包含即邊、歸屬可零」的 [[project_graph_model_migration]] 路線。
- 溯源採稽核制:成本低、不動遍歷,又以事件回放保留了完整時間回溯的後路,是安全的預設。
- Phase A(兩張註冊表 + 通用 node 操作 + 刪 node 清邊)即可交付「使用者自訂層」,完全不必觸碰 task/project 的既有 endpoint 與測試。

**負面 / 代價:**
- **「地基完整」不等於「沒工可做」。** node-only 收斂是龐大的**執行工**(牽動 enrichment、Pydantic schema、MCP、前端 `IssueRow`/`ProjectDetail`、幾乎全部測試),只是屬執行而非重新設計。
- 型別/關係約束改由應用層 + 註冊表維護(DB 的 `type`/`rel_type` 是自由字串,無 enum/check);錯字或未知型別要靠應用層與 UI 防呆。
- 自訂型的 node 為 node-only,其刪除清邊必須走新的通用路徑;若有程式碼繞過而直接刪 `Node`,SQLite(不執行 CASCADE)會留下 dangling edge —— 此不變式僅由應用層守住。
- 雙儲存在收斂完成前仍是過渡態,`node_types` 註冊表需同時承載「內建=有鏡像表」與「自訂=純 node」兩種 backing,直到 Phase B 把內建也收成 node-only 才一致。
- 完全自由的包含(任何 node 含任何 node)只有 `detect_cycle` 一道結構護欄,其餘合理性靠 UX;compat `project_id`(最近 project 祖先)在「task 可零專案、可掛任意型別之下」時逐漸失去意義,終將轉為通用「父容器」概念。
