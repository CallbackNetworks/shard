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

## 階段 1 — 基礎層(additive,零行為變更)

- [ ] `models.py`:新增 `Node`、`Edge` ORM;`type`、`status`、`source_id`、`target_id`、`rel_type` 建索引;`UniqueConstraint(source_id, target_id, rel_type)`。
- [ ] Alembic:`alembic revision --autogenerate -m "add nodes and edges tables"`,`render_as_batch=True` 確認 SQLite 相容。
- [ ] 回填 migration(data migration,與建表分開一支):
  - 每個 project/task/identity/goal/cycle/label 插入 `nodes`(沿用 id,熱欄位對映,其餘進 `data`)。
  - `project_id`/`parent_id`/五張關聯表 → 對映 `edges`。
  - 於 SQLite 與 PostgreSQL 皆驗證回填筆數守恆。
- [ ] `services/graph.py`:`create_node`、`update_node`、`delete_node`、`add_edge`、`remove_edge`、`neighbors(node_id, rel_type, direction)`、`children_of`、`parents_of`、`ancestors_of`、`nearest_ancestor_of_type`、`detect_cycle`。
- [ ] `tests/test_graph.py`:節點/邊 CRUD、遍歷、環偵測、回填守恆。
- [ ] 舊表仍為權威來源,app 行為不變。**Commit。**

## 階段 2 — 讀取切換(回應形狀不變)

- [ ] `routers/projects.py` 的 `_enrich_task` / `_enrich` 改由邊推導:`project_id`(最近 project 祖先)、`parent_id`(首個 task 父)、`labels`、`blocked_by`、`blocking`、`subtask_count`、identities。
- [ ] 全部 GET 端點改讀圖;`TaskOut` / `ProjectOut` 欄位不變。
- [ ] mutation 暫行**雙寫**(舊表 + 圖),確保讀圖與舊資料一致。
- [ ] 加 `nearest_ancestor_of_type` 的決定性規則(多祖先時取 position 最小 / created_at 最早)。
- [ ] 既有 API 測試全綠(形狀未變即為通過)。**Commit。**

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
