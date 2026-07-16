# 圖模型遷移計畫(ADR-0032)

> ## ▶ 交接狀態(2026-07-15)
> **五張關聯表已全部改為純邊並 drop**(`task_dependencies` / `task_labels` / `cycle_tasks` / `project_identities` / `goal_projects`)。所有多對多關係現在只透過 `edges` 表達;`graph_sync` 只維護實體節點 + `contains` 容器邊。
>
> **▶ 下一步(唯一剩下的一塊):容器 `contains`** —— 把 `Task.project_id` / `Task.parent_id`(約 685 處引用、遍佈 ~30 檔)改為 `contains`-edge 遍歷,最後 drop 這兩個欄位。這是最大、破窗風險最高的一步;動工前需先決定 `project_id` 是否真的開放多重容器(目前單一必填),並補上 `graph_sync` 對 entity title/status 更新與 task re-parent 的回同步。
>
> 每切一塊的紀律:寫入→邊、讀取→批次邊 helper、drop 表;**只在測試全綠(SQLite + PostgreSQL 皆驗)時 commit**。詳見下方各階段勾選。

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

**實體 + 容器也全域雙寫(`graph_sync` 擴充):**
- [x] 監聽器新增:新建 Project/Task/Identity/Goal/Cycle/Label → 對應型別 `nodes` 列;Task 另建 `project_id`/`parent_id` 的 `contains` 邊。用「在 `before_flush` 內先指派 pk」避開 flush-time id 未定問題。
- [x] 刪除實體 → 清掉該 node 與所有相連邊(明確刪,因 SQLite 不強制 ondelete CASCADE)。
- [x] `tests/test_graph_sync.py` 增至 9 項;task 生命週期 SQLite + PostgreSQL 皆綠。
- [x] **至此圖已是完整的即時鏡射(實體 + 容器 + 五種關係)。**

**bulk 缺口已補(繞過 ORM 事件的三處):**
- [x] `bulk.py` 標籤移除、`rules_engine.py` remove_label、`goals.py` 專案連結替換 → 明確呼叫 `graph.remove_edge` / `graph.remove_edges` 補鏡射。
- [x] `tests/test_graph_bulk_sync.py`(2 項,API 層)SQLite + PostgreSQL 皆綠。
- 已查核:其餘 bulk 寫入(`notifications` 標記已讀、`tasks` position 更新)不是圖關係,無需處理。

**第一個關係完成 read-cutover 並 drop 舊表 — dependencies:**
- [x] 寫入:`add/remove_dependency`(內部 + external API)直接建/刪 `depends_on` 邊,不再寫 `task_dependencies`。
- [x] 讀取全部改由邊推導,並批次載入避 N+1:`enrichment`(`graph.dependency_maps` 一次查整個專案)、`api_keys`、`share`、`external_api` GET、`critical_path`;移除各處 `selectinload(blocked_by_deps/blocking_deps)`。
- [x] 移除 `TaskDependency` model + `Task.blocked_by_deps/blocking_deps` relationship;從 `graph_sync` 拿掉(改直接寫邊)。
- [x] migration `e3f5a7b9c1d3` drop `task_dependencies`(回填已保 11 筆為邊,零資料損失);dev DB 已套用驗證。
- [x] 684 tests SQLite 綠、PG 子集綠。**第一張舊關聯表正式移除。**

**第二張表完成 — labels(`task_labels`):**
- [x] 寫入:10 個寫入點 + remove 端點全改用 `graph.set_label` / `unset_label`(直接建/刪 `labeled` 邊);`issue_sync`、`assistant_tools`、`imports`、`bulk`、`rules_engine`、`labels`、`external_api/labels` 全數轉換。
- [x] 讀取全部改由邊 + 批次 `graph.labels_map` 避 N+1:`enrichment`、`api_keys`、`share`、`issue_sync`(3 處 name/type 過濾)、`rules_engine`(has_label 用 `object_session`);移除各處 `selectinload/joinedload(task_labels)`。
- [x] 移除 `TaskLabel` model + `Task.task_labels`/`Label.task_labels` relationship + `graph_sync` 條目。
- [x] migration `f4a6b8c0d2e4` drop `task_labels`(43 邊零損失);dev DB 已套用。
- [x] 683 tests SQLite 綠、98 項 PG 子集綠。**第二張舊關聯表移除。**

**第三張表完成 — cycles(`cycle_tasks`):**
- [x] 寫入:`cycles`(add/remove/clone)、`issue_sync`(milestone 同步)改用 `graph.add_to_cycle` / `remove_from_cycle`(直接建/刪 `in_cycle` 邊)。
- [x] 讀取全部改由邊:`enrichment`、`analytics`(3 處)、`external_api/analytics`、`cycles`(_enrich/compare 用 `object_session`)、`share`、`issue_sync`(_task_primary_cycle 用 `cycle_ids_for_task`);移除各處 `selectinload(cycle_tasks)`。
- [x] 移除 `CycleTask` model + `Cycle.cycle_tasks`/`Task.cycle_tasks` relationship + `graph_sync` 條目。
- [x] migration `a5b7c9d1e3f5` drop `cycle_tasks`(41 邊零損失);dev DB 已套用。
- [x] 682 tests SQLite 綠、72 項 PG 子集綠。**第三張舊關聯表移除。**

**最後兩張表完成 — memberships(`project_identities` + `goal_projects`):**
- [x] `member_of`:`identities`(link/unlink/enrich/hub-stats)、`enrichment`、`bulk`(ical)、`external_api/summary`、`share`(改用 `graph.projects_for_identity`/`identities_for_project`,`_load_identity` 不再 eager-load projects)全改邊。
- [x] `part_of`:`goals`(create/update/enrich)改用 `graph.link_goal_project`/`projects_for_goal`。
- [x] 移除 `ProjectIdentity`、`GoalProject` model 與所有 relationship;`_ASSOC_SPECS` 清空 → `graph_sync` 只剩實體/容器鏡射(移除關聯迴圈)。
- [x] migration `b6c8d0e2f4a6` drop 兩表(26 + 5 邊零損失);dev DB 已套用。
- [x] 681 tests SQLite 綠、54 項 PG 子集綠。

> **🎉 五張關聯表全部移除。** `task_dependencies` / `task_labels` / `cycle_tasks` / `project_identities` / `goal_projects` 皆已改為純邊並 drop。所有多對多關係現在只透過 `edges` 表達。

**只剩最後一塊 — 容器 `contains`:**
- [ ] `contains`(取代 `project_id`/`parent_id`)的讀取切換 + drop 欄位 — 涉及最多讀取點(685 處),是壓軸也是最大的一步。
- [ ] 實體欄位更新(title/status)與 task re-parent 尚未回同步(node 熱欄位目前不被讀,故無害;`contains` 讀取切換時需一併處理)。

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
