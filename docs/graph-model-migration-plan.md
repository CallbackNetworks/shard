# 圖模型遷移計畫(ADR-0032)

本文件是 [ADR-0032](adr/0032-unified-node-edge-graph-model.md) 的可執行落地計畫。每個階段都必須維持 app 可運作、測試綠、覆蓋率 ≥70%,並在階段末 commit。階段順序不可跳。

## 目標模型速覽

```
nodes(id, type, title, status, priority, due_date, start_date, position, is_pinned, data JSON, created_at, updated_at)
edges(id, source_id, target_id, rel_type, position, data JSON, created_at)  UNIQUE(source_id, target_id, rel_type)
```

| 舊結構 | 新表達 |
|--------|--------|
| `Task.project_id` | `edge(project) --contains--> (task)` |
| `Task.parent_id` | `edge(task) --contains--> (task)` |
| `ProjectIdentity` | `edge(identity) --member_of--> (project)` |
| `GoalProject` | `edge(project) --part_of--> (goal)` |
| `TaskDependency` | `edge(blocked task) --depends_on--> (prerequisite)` |
| `TaskLabel` | `edge(task) --labeled--> (label)` |
| `CycleTask` | `edge(task) --in_cycle--> (cycle)` |

實體 → 節點:Project / Task / Identity / Goal / Cycle / Label(沿用原 UUID)。
其餘表(Comment/Attachment/ActivityLog/Integration/…) 不動,FK 自動仍有效。

---

## 階段 1 — 基礎層(additive,零行為變更) ✅ 已完成

- [x] `models.py`:新增 `Node`、`Edge` ORM;`type`、`status`、`due_date`、`source_id`、`target_id`、`rel_type` 建索引;`UniqueConstraint(source_id, target_id, rel_type)`。
- [x] 建表 migration `c1a2b3d4e5f6`(idempotent,check `inspector.get_table_names()`)。
- [x] 回填 migration `d2e4f6a8c0b2`(與建表分開一支,idempotent 以 nodes 是否已有列判斷):
  - 每個 project/task/identity/goal/cycle/label 插入 `nodes`(沿用 id,熱欄位對映,其餘進 `data`)。
  - `project_id`/`parent_id`/五張關聯表 → 對映 `edges`。
  - 已於 dev SQLite 驗證回填筆數守恆(nodes: 17/122/9/11/17/78;edges contains=137、member_of=26、part_of=5、depends_on=11、labeled=43、in_cycle=41 全部 OK)。
- [x] `services/graph.py`:`create_node`、`update_node`、`delete_node`、`add_edge`、`remove_edge`、`neighbors`、`children_of`、`parents_of`、`ancestors_of`、`descendants_of`、`nearest_ancestor_of_type`、`detect_cycle`。
- [x] `tests/test_graph.py`:12 項涵蓋 CRUD、遍歷、多重歸屬、環偵測;SQLite 與 PostgreSQL 皆綠。
- [x] 全套 668 項測試綠、app 行為不變;舊表仍為權威來源。**Committed。**

## 階段 2 — 讀取切換(回應形狀不變) 🟡 部分完成

**已交付的可用能力(跨專案歸屬 end-to-end,已測):**
- [x] `TaskOut` 新增 `project_ids`(相容、additive);`enrichment.enrich_task` 由「primary `project_id` + 圖 `contains` 邊」推導。
- [x] `enrichment.enrich_project` union 進「由邊掛入本專案、但 primary 不在此」的任務 → 任務可同時出現在多個專案。
- [x] `POST/DELETE /projects/{pid}/tasks/{tid}/memberships/{target}`:以 `contains` 邊管理跨專案歸屬;`ensure_node` 對回填後新建的列 lazy 建節點。
- [x] `tests/test_task_membership.py`(5 項)+ 全套 673 綠。

**已交付的全域雙寫(`services/graph_sync.py`):**
- [x] `before_flush` 監聽器把**五張關聯表**(`TaskLabel`/`TaskDependency`/`CycleTask`/`ProjectIdentity`/`GoalProject`)的 insert/delete 自動鏡射成對應邊,涵蓋所有 9+ 個寫入點,不需逐檔改。節點缺就 lazy 建。
- [x] `Edge` 加上對 `Node` 的 relationship,讓 unit-of-work 在同一 flush 內先插 node 再插 edge(PostgreSQL 即時強制 FK,見 [ADR-0018](adr/0018-postgres-parity-and-fresh-db-bootstrap.md))。
- [x] `tests/test_graph_sync.py`(6 項)SQLite + PostgreSQL 皆綠。

**尚未做(刻意保留,見下方風險判斷):**
- [ ] 把 `project_id` / `parent_id` / `labels` / `blocked_by` 等**讀取**改由邊推導(目前 primary 仍讀舊欄位/關聯,邊為鏡射)。
- [ ] 實體本身(task/project/…)的 create/delete → node 與 `contains` 邊尚未全域雙寫(新建 task 的 primary 歸屬邊靠 backfill + `ensure_node` lazy 補;主鏈路仍走 `project_id` 欄位)。
- [ ] 已知限制:bulk `query(...).delete()` 繞過 ORM 事件(如 `bulk.py` 的標籤移除),鏡射會漏;讀取切換前需處理。

> **風險判斷:** primary `project_id` 仍是 685 處讀取點的權威來源。要讓邊成為唯一權威、進而 drop 欄位(階段 3、5),等於逐檔改寫這 685 處 + 122 處關聯引用,回歸風險高。建議此後**逐檔、帶測試**推進,不做一次性 big-bang,以免動到線上個人工具的資料。跨專案歸屬這個核心新能力已可用。

## 階段 3 — 寫入切換

- [ ] `routers/tasks.py`、`projects.py`、`identities`、`goals`、`cycles`、`labels`、`dependencies` 的所有 mutation 改為只寫圖。
- [ ] 移除雙寫;`log_activity` / `fire_notifications` / `run_rules` 的呼叫點以 node/edge 為準。
- [ ] `contains` 新增／移動邊時呼叫 `detect_cycle` 擋環。
- [ ] 端到端:建立/移動/刪除任務、依賴、標籤、身份指派全套測試綠。**Commit。**

## 階段 4 — 前端 / MCP 與新能力

- [ ] `TaskOut` 新增 `project_ids[]`、`parent_ids[]`(相容欄位保留)。
- [ ] MCP `mcp_server/server.py` proxy 對映新欄位(見 [ADR-0005](adr/0005-mcp-server-http-proxy.md))。
- [ ] 前端:多重歸屬顯示與跨專案掛載 UI(`ProjectDetail.jsx` / `IssueRow.jsx`);`vite.config.js` 若有新路由,proxy 與 `isProxied` 兩處都更新。
- [ ] 前端 vitest 綠。**Commit。**

## 階段 5 — 清理

- [ ] Alembic migration:drop `task_dependencies`、`task_labels`、`cycle_tasks`、`project_identities`、`goal_projects`;drop `tasks.project_id`、`tasks.parent_id`;視情況 drop 舊實體表或保留為 view。
- [ ] 移除 `models.py` 中已淘汰的 ORM 與關聯 relationship。
- [ ] 全套測試(SQLite + PostgreSQL)綠,覆蓋率 ≥70%。**Commit。**

---

## 貫穿性風險與守則

- **回填守恆**:每支 data migration 前後比對筆數;跨 SQLite/PostgreSQL 各跑一次(見 [ADR-0020](adr/0020-databases-as-coequal-test-targets.md))。
- **環偵測**:`contains` 允許多父後必擋環,並在 `nearest_ancestor_of_type` 定義決定性 tie-break。
- **N+1**:圖遍歷易產生 N+1,`services/graph.py` 提供批次載入(單一 query 拉一層 edges + nodes)。
- **方言**:熱欄位保留真欄位以避開 JSON 取值的方言差異;`data` JSON 只放不參與過濾/排序的欄位。
- **不可跳階段**:讀切換前必須雙寫,寫切換前讀必須已走圖,否則切換期會破窗。
