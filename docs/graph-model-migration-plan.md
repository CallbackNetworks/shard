# 圖模型遷移計畫(ADR-0032)

> ## ▶ 交接狀態(2026-07-15)
> **五張關聯表已全部改為純邊並 drop**(`task_dependencies` / `task_labels` / `cycle_tasks` / `project_identities` / `goal_projects`)。所有多對多關係現在只透過 `edges` 表達;`graph_sync` 只維護實體節點 + `contains` 容器邊。
>
> **▶ 後端遷移已完成。** `Task.project_id` / `Task.parent_id` 欄位已 drop(migration `d8e0f2a4b6c8`);容器只透過 `contains` 邊表達,五張關聯表也早已收斂為邊。設計決策:**完全多重容器、無 primary**。切片 0→6(讀取切換、寫入集中化、寫入/刪除/drop 欄位)全部完成並雙 DB 驗證。**唯一剩下的是切片 7:前端 / MCP 的多重歸屬 UI**(相容欄位 `project_id`/`project_ids[]`/`parent_id` 仍由 `enrich_task` 由邊推導提供,故現有前端不會壞)。
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
- [x] **回同步先補齊(讀取切換的前置):** `graph_sync` 現在(a)新建實體時把全部熱欄位(status/priority/dates/position/is_pinned)寫進 node,不再只有 title;(b)`session.dirty` 的實體更新回同步 node 熱欄位;(c)task re-parent(`project_id`/`parent_id` 變動)用 attribute history 搬移 `contains` 邊(含 un-parent 清邊)。熱欄位對映與回填 migration 一致。`tests/test_graph_sync.py` 增至 10 項,SQLite + PostgreSQL 皆綠。**Committed。**
**設計決策已定(2026-07-15):完全多重容器、無 primary。** 任務對等地屬於 N 個專案,不保留「home / 主專案」概念。`TaskOut.project_id` 僅作為相容欄位由 `nearest_ancestor_of_type(project)` 推導(給尚未改的舊 client/MCP),不再具語意權威;語意權威是 `project_ids[]`(= 全部 `contains` 專案父)。刪除專案改為刪邊 + 清孤兒(無其他專案容器才刪),取代 FK CASCADE。此為 [ADR-0032](adr/0032-unified-node-edge-graph-model.md) 已接受方向(第 33/43 行:多重歸屬、所屬專案 = 專案型祖先)的落地細化,故記於本計畫而非另開 ADR。

**`contains` 讀寫切換 + drop 欄位 — 有序切片(每片:SQLite + PostgreSQL 綠、commit):**
- [x] **切片 0(前置查核):** 已查核所有 15 處 `Task(...)` 建立點皆走 ORM(`db.add`),無 `bulk_insert_mappings`/Core insert 繞過 unit-of-work;故 `graph_sync` before_flush 必鏡射 `contains` 邊。edge-only 讀取的安全前提成立。
- [x] **切片 1(membership 讀取 edge-only):** `enrichment._membership_project_ids` 改為 db 在場時純由 `graph.member_project_ids`(邊)推導,`project_id` 欄位僅在無 db session 時作 compat fallback;`external_api` search 路徑 thread `db` 進 `_enrich_task_for_search`。686 SQLite 綠、63 項 PG 子集綠。**Committed。** (`TaskOut.project_id` 相容欄位仍讀欄位,待切片 2/4 一併改由 `nearest_ancestor_of_type` 推導。)
- [x] **切片 2(專案任務清單 / analytics):** 新增 `graph.tasks_in_project` / `project_task_id_map` helper。把「列某專案的任務」與「依 `Task.project_id` 統計」全數改為 `graph.contained_task_ids` / edge join——已轉:`enrichment.enrich_project`(改由邊取任務並補 `selectinload` 避 N+1;`projects.py`/`share.py` 的 `Project.tasks` eager option 一併移除)、`scheduler`(daily/weekly)、`notifier._compute_progress`(+db)、`webhooks`、`critical_path`、`assistant_tools`(get_summary/list_tasks/analyze_workload/get_activity)、`identities`、`goals`、`analytics`(3)、`external_api/{analytics,summary,stats,tasks,projects,search,agent_context}`、SPA `search`(含關聯子查詢改用 `Edge` count)、`bulk`(4)、`issue_sync`(3)、`recurring`、`deps.get_task_or_404`(共用 helper,涵蓋多數點查驗證)。686 SQLite 綠。
  - [x] **點查驗證也轉完:** `Task.id == X AND Task.project_id == P` 型的點查(`tasks.py` ×9、`external_api/tasks.py` ×4、`external_api/dependencies.py`、`attachments.py`、`share.py:543`)全改為 `Task.id.in_(graph.contained_task_ids(...))`(維持單一 query 結構、最小 diff)。
  - **✅ 至此 `Task.project_id` / `parent_id` 的「讀取」全數走圖**(唯一例外:`enrichment` 的 `db is None` compat fallback)。剩下的 `Task.project_id` 只出現在「寫入」(建立 task 時 `Task(project_id=...)`)與 position bulk update 的 scoping,屬切片 4。
- [x] **切片 3(子任務樹):** 新增 graph helper:`child_task_ids_map`(批次父→子任務)、`subtasks`(子任務 rows)、`subtask_ids_among`(已載入集合中哪些是子任務,join `nodes.type=='task'` 以與 project→task 邊區分)、`top_level_task_filter()`(query 用 SQL 表達式:非任何 task 的子任務)。所有 `parent_id` / `task.subtasks` 讀取改由 task→task `contains` 邊——已轉:`enrichment`(`subtask_count` 批次 `child_task_ids_map`、top-level 用 `subtask_ids_among`、移除 `selectinload(Task.subtasks)`)、`scheduler`(2 迴圈)、`assistant_tools`(summary + `analyze_workload` query)、`critical_path`、`goals`、`share`(top-level 過濾 + 子任務明細)、`agent_context`、`api_keys`、`tasks.py` 的 `include=subtasks` 巢狀序列化。唯一保留欄位讀取的是 `enrichment` 的 `db is None` compat fallback。`test_graph_sync.py` 增至 12 項;686 SQLite 綠。
> **容器模型決策(2026-07-15):維持扁平。** 子任務同時擁有 `project→task` 與 `parent-task→task` 兩條 `contains` 邊(沿用回填現況);helper 以 `nodes.type` 區分父節點是專案或任務。不改回填、不改 helper。「某任務所屬專案」= 直接查 project→task 邊(O(1)、免遞迴)。

> **⚠️ 耦合分析:** 讀取切換可乾淨分片,但 **寫入/刪除/drop 欄位彼此耦合**——`Task.project_id` 是 NOT NULL + ondelete CASCADE。只要欄位還在:(a) `graph_sync` 從欄位建邊,故無法「停止寫欄位」而不同時改 `graph_sync`;(b) 刪專案時 FK CASCADE 會連跨專案任務一起刪,無法乾淨實作「孤兒才刪」。因此切片 4/5/6 實質是一次協調變更,拆成兩個檢查點降風險。

- [x] **切片 4(建立集中化,additive、可獨立綠):** 新增 `graph.create_task(db, **fields)`(construct→add→flush),成為唯一 task 建立入口(仍設欄位、`graph_sync` 照舊鏡射邊 → 行為不變)。全部 15 處 `Task(...)` 收斂進來(`tasks.py`、`external_api/tasks.py`×2、`imports.py`×3、`scheduler`、`cycles`、`issue_sync`、`assistant_tools`×4、`bulk` 遞迴)。有 post-construction 設 `due_date` 的點靠 slice-1 的 dirty-entity 回同步保持 node 正確。688 SQLite 綠。最終 drop 欄位的風險面已縮到「`create_task` + `graph_sync` + migration」3 處。
- [x] **切片 4b/5/6(協調的一刀,drop 欄位)✅ 完成。** `tasks.project_id` / `parent_id` 欄位已 drop(migration `d8e0f2a4b6c8`,upgrade/downgrade round-trip 已驗)。容器只存在於 `contains` 邊。`project_id`/`parent_id` 現為 `Task.__init__` 的 transient 建構提示,`graph_sync` 轉成邊(呼叫端 `Task(project_id=...)` 仍可用,但無欄位)。寫入經 `graph.create_task`;re-parent 經 PATCH 的邊搬移;刪除經 `graph.delete_task_tree` / `delete_project_and_tasks`(孤兒感知)。`task.project`/`.project_id` 讀取全改 `graph.project_of_task`/`project_id_of_task`;raw task 回應改走 `enrich_task` 補相容欄位;`TaskOut.project_id` 改為 `str | None`。新增 `tests/test_delete_semantics.py`(3 項:子任務串聯刪除、專案刪除連任務、跨專案任務存活)。691 SQLite 綠、覆蓋率 78.6%。原配方:
  1. **`graph.create_task(db, *, project_id=None, parent_id=None, **fields)`**:`Task(**fields)`(不含容器欄位)→flush→顯式 `add_edge(project_id→task, contains)`、`add_edge(parent_id→task, contains)`。呼叫端不變(已用 kwargs)。
  2. **`graph_sync`**:task 新建分支只 ensure node(移除從欄位建邊);移除 `_reparent` 與 dirty-task 搬邊。
  3. **`enrichment`**:`out.project_id`/`out.parent_id` 相容欄位改由圖批次推導(`project_of_task` 取最近 project 祖先、新增 batched `parent_task_map`);移除三處 `db is None` 讀欄位 fallback。
  4. **`task.project` 4 處**(`notifier`、`webhooks`×2 含移除 `_ = task.project`、`external_api/tasks`)→ 新增 `graph.project_of_task(db, task_id)`(最近 project 祖先→Project row)。
  5. **PATCH `update_task`**:攔截 `changes` 裡的 `parent_id`,改成搬 `contains` 邊(移除舊 task-parent 邊、加新),不再 `setattr`。
  6. **⚠️ 刪除語意(新發現,非機械式):** 移除 `Task.subtasks`(delete-orphan)+ `parent_id` FK CASCADE 後,刪任務不再自動刪子任務。需新增 `graph.delete_task_tree(db, task_id)`(遞迴刪子任務樹;comment/attachment/PR 仍靠各自 task_id FK CASCADE)。`delete_task` 改用它;`delete_project` 改為:逐一 contained task → 若無其他專案容器則 `delete_task_tree`,否則只移除本專案的 contains 邊,最後刪 project(取代 project_id FK CASCADE)。
  7. **`models.py`**:移除 `Task.project_id`/`parent_id` 欄位與 `Task.project`/`subtasks`/`parent`、`Project.tasks` relationship。
  8. **migration**:batch mode drop `tasks.project_id`、`tasks.parent_id`(含 FK);downgrade 重建欄位並由邊回填。
  9. 全套 SQLite + PostgreSQL 綠、覆蓋率 ≥70% 才 commit。
- [ ] **切片 5(刪除語意):** 刪專案 → 刪其 `contains` 邊 + 刪孤兒任務(無其他專案容器才刪),取代 SQLite/PG 的 FK ondelete CASCADE。
- [ ] **切片 6(drop 欄位):** migration drop `tasks.project_id`、`tasks.parent_id`;移除 model 欄位/relationship;`graph_sync` 不再讀欄位(改由邊事件驅動)。
- [x] **切片 7(前端 / MCP):** 前端開放跨專案多重歸屬 UI —— `IssueRow` 新增 `Boxes` 動作鈕與「屬於 N 個專案」被動徽章(`project_ids.length > 1` 時顯示),展開 `MembershipPanel` 可檢視/解除/新增跨專案連結;API client 加 `addTaskMembership`/`removeTaskMembership`(打既有 `/memberships/{target}` 端點);i18n 補 `membership.*`(en + zh-TW)。MCP 無需改(proxy `/api/v1` 已原樣帶 `project_ids`)。`MembershipPanel.test.jsx` 4 項 + 全套 200 前端測試綠、eslint 0 error、vite build 成功。**🎉 ADR-0032 遷移全部完成(後端 + 前端)。**
- [x] **切片 8(cutover 後 bug 修補,2026-07-16):** 審查發現四個 cutover 遺留缺口,已修:
  1. **共享 subtask 資料遺失:** `delete_task_tree` 原本無條件刪整棵子樹;已連進其他專案的後代會被連帶刪除。改為「root 專案集合以外仍有歸屬的後代 → 連同其子樹存活,只解除 root 專案的 contains 邊」。專案刪除路徑(`delete_project_and_tasks`)自然繼承此語意。
  2. **Re-parent 成環回 500:** PATCH `parent_id` 指向自己的子孫時 `add_edge` 拋 `ValueError` 未接 → 500。新增 `deps.get_parent_task_or_error`(parent 必須存在且在同專案,否則 404;成環回 400)+ `graph.set_parent_task` 集中搬邊。
  3. **幽靈節點 / dangling edge:** 建立或 re-parent 帶不存在的 `parent_id` 時,`graph_sync._ensure_contains_edge` 會 mint 空 task node(或留下 dangling edge),task 從 UI 隱形。所有入口(human router create/update、external API create/update/bulk-create/bulk-update)現在都先驗證 parent。
  4. **External API re-parent 靜默失效:** `parent_id` 已非欄位,`setattr` 只設了 stray attribute;改走圖搬邊。另修 `reorder_tasks` 的 N+1(每個 task 重查一次 contained ids)。
  新增 10 項測試(delete 語意 ×2、human re-parent 驗證 ×5、external API ×3)。SQLite 701 綠 + PostgreSQL 700 綠。
- [x] **切片 9(語意收尾,2026-07-16):** 審查剩餘四項非致命問題,已修:
  1. **Compat `project_id` 不確定性:** `neighbors`/`project_ids_map`/`parent_task_map`/`child_task_ids_map` 全部改為 `ORDER BY edge.position, edge.created_at` —— compat `project_id` = 最舊歸屬,跨讀取路徑一致且確定。
  2. **假 home 守衛:** `remove_membership` 原本擋「不能移除 home」但 home 概念已不存在(no primary)。改為對稱語意:任何歸屬皆可移除,唯「最後一個歸屬」回 400。前端 `MembershipPanel` 同步開放解除目前專案的 chip。**⚠️ 過渡狀態:** 這條「最後一個歸屬」守衛在未來會被放寬(見下方「未分類任務」),因為已決定 task 可以合法地零歸屬。目前保留只是因為還沒有『未分類』清單能看到歸零後的任務,先不讓它隱形。
  3. **訪客留言歸屬:** 跨專案任務的 share 留言原本可能記到 share 範圍外的專案;改為在 share scope 內挑該任務實際歸屬的專案。
  4. **Webhook callback 回傳裸 task:** `/webhook/callback/{token}` 原本回傳未 enrich 的 ORM row(`project_id`/`project_ids` 缺失);改走 `enrich_task`。
  新增測試:membership ×3、share ×1、webhook 斷言 ×2、前端 MembershipPanel ×1。SQLite 705 綠 + PostgreSQL 綠、前端 201 綠。

### 🔜 未來能力 — 未分類任務(unfiled tasks,零歸屬)

**動機(2026-07-16,使用者):** 當初砍掉 `tasks.project_id` NOT NULL FK 的真正原因 —— 有些 task/issue 是**後來才確定歸屬**的,一開始沒有準確的 project 或上游。邊模型已天然支援這件事:`graph.create_task(**fields)` 不帶 `project_id` 時 `graph_sync._ensure_contains_edge` 對 falsy parent 直接 return,產生一個**沒有 incoming `contains` 邊的合法 task node**。`TaskOut.project_id` 已是 `str | None`,回應層能表達 null 專案。

**決定(2026-07-16):** ✅ 方向確定 —— task 可合法零歸屬,`remove_membership` 未來允許移到零(退回未分類)。「未分類」不是新表或 inbox 機制,就是**「沒有 project 來源的 `contains` 邊」這個狀態本身**。⏸️ 現在只記錄,不實作。

**實作時要補的缺口(尚未做):**
1. `graph.unfiled_task_ids(db)` / filter —— task node 且沒有任何 source 為 project node 的 incoming `contains` 邊(對比 `top_level_task_filter` 管的是 task→task 子任務,不是專案歸屬)。
2. 無專案的 create 入口(`graph.create_task` 本身已支援;缺的是一支不掛在 `/projects/{id}` 下的路由 / 或人類 API 的「未分類」建立)。
3. 放寬 `remove_membership` 的「最後一個歸屬」守衛 → 允許歸零(見切片 9 #2 的過渡註記)。
4. 前端「未分類」bucket 清單 + 從那裡指派到專案(=新增一條 `contains` 邊)。
5. 檢查所有假設「task 一定有專案」的讀取/enrich 路徑(compat `project_id` 已容忍 null,但 UI 樹、分析、summary 需逐一確認零歸屬不會爆)。SQLite + PostgreSQL 兩套綠。

### 🔮 更遠的方向 — 用戶自訂層(user-defined node types / 全 node-only)

**動機(2026-07-16,使用者):** 舊的樹狀容器(project/identity 是寫死的 FK 層級)太死板 —— 想加一層(如 `topic`)整棵底層樹就崩、每次改「包含」都引出資料結構問題。把包含搬到 edge 已解決「加層會崩」;下一步是把 **node type(= category / 層級)本身也開放給用戶自訂**:平台只給預設幾個內建 type,其餘的層由用戶自己定義。

**已確認的形狀(2026-07-16):**
- **包含規則:完全自由** —— 任何 node 可包含任何 node,不存「可包含哪些 type」白名單。唯一結構護欄是既有的 `detect_cycle`,其餘靠 UX。
- **內建 vs 自訂:逐步全 node-only** —— 最終連 task/project 也收成純 node,實體表消失、type 詞彙全資料化。分階段、非 big-bang。

**為何可行:** `nodes.type` 是純字串欄(無 enum/check),`contains` 遍歷 type-agnostic,DB 今天就接受任意 type 與任意層深。把 type 寫死的只有三處 Python:固定常數集、`graph_sync._ENTITY_TYPES`、幾支 hardcode `n.type == NODE_TASK/PROJECT` 的 leaf helper(graph.py:349/421/523/545/609/623)。所以這是「把 type 詞彙從程式碼搬到資料」的加法,不是重寫儲存。

**分階段路徑(Phase A 建置中 —— 見 [ADR-0033](adr/0033-graph-foundation-final-shape.md)):**
- **Phase A — 地基(先交付用戶自訂層):** `node_types` 註冊表(type 資料化、seed 內建)+ 通用 Node CRUD API + **通用「刪 node → 清邊」路徑**(補 node-only 的 dangling-edge 陷阱,`graph_sync` 目前只對 `_ENTITY_TYPES` 觸發清邊)+ 通用 `NodeOut` 序列化。做完用戶即可自訂層(純 node),task/project 不動。
  - [x] **A1 — 兩張註冊表 + seed:** `NodeType`/`EdgeType` model、migration `c3d5e7f9a1b2`(建表 + seed 內建 6 node 型 / 7 edge 型,idempotent)、`services/graph_registry.py`(內建定義 + `seed_builtin_types` 冪等 seed,startup lifespan 呼叫)。內建 = `is_builtin=True`;`edge_types` 帶 `is_containment`/`is_symmetric` 語意旗標。SQLite + PostgreSQL 綠。commit `0b45cd0`。
  - [x] **A2 — 註冊表 REST API:** `/graph-types/{nodes,edges}` list/create/update/delete;內建型不可刪(key 不可變)、使用中的自訂型不可刪(有 node/edge 時 409)。conftest `db` fixture 加 seed 使 API 測試與 prod 一致。vite proxy 兩處補 `/graph-types`。commit `fa021eb`。
  - [x] **A3 — 通用 node/edge API:** `/nodes` CRUD(僅 node-only 自訂型;實體型 task/project… 寫入回 400 導回專屬 endpoint,讀取放行)+ `/nodes/{id}/edges` attach/detach(任意兩 node,rel_type 須在註冊表,contains 擋環)+ `NodeOut`。自由包含成立(自訂 node 可含 project/task)。`graph.ENTITY_BACKED_TYPES` 標記仍有實體表的內建型。vite proxy 補 `/nodes`。commit `ff24ef8`。
  - [x] **A4 — 溯源稽核軌跡:** append-only `graph_events` 表(migration `d4e6f8a0b2c3`)+ `graph.add_edge`/`remove_edge`/`create_node`/`delete_node` 附帶寫事件(`node_created`/`node_deleted`/`edge_added`/`edge_removed`,含選填 `actor`)+ `/nodes/{id}/events` 讀取。**已知缺口:** `graph_sync` 直接 `session.add(Edge)` 建的 contains 鏡射邊(task 建立)不經 `graph.add_edge`,故不記事件 —— 使用者動作經 `graph.*` helper 者皆有軌跡,實體鏡射邊的完整覆蓋待後續。SQLite 739 / PostgreSQL 738 綠。
  - [ ] **A5 — 註冊表驅動角色判定:** 把 `graph.py` 幾支 hardcode `n.type == NODE_TASK/PROJECT` 的 leaf helper(`member_project_ids`/`contained_task_ids`/`parent_task_map`/`project_ids_map`/`subtask_ids_among`/`top_level_task_filter`)改由 `node_types` 的角色/旗標判定,讓自訂型不被硬過濾擋掉。
  - [ ] **A6 — 前端:** 定義 node/edge 型的 UI + 通用 node 檢視 + 「未分類」bucket(接「未分類任務」線);放寬「最後一個歸屬」守衛使 task 可歸零。
- **Phase B — 逐型收斂(一次一 type,兩套 DB 綠):** 內建實體逐一搬進 node(欄位→hot columns/`data`,endpoint 轉通用層,drop 表)。輕的先做(label/cycle/goal/identity),最後才碰 task/project(有 endpoint/MCP/前端/大量測試依賴)。
- **Phase C — 清理:** 移除 `_ENTITY_TYPES`;hardcode type 過濾改由註冊表驅動;實體 ORM 類別消失。compat `project_id` 屆時轉為通用「父容器」概念(呼應「未分類任務」)。

**風險提醒:** Phase B 碰 task/project 時牽動 enrichment、Pydantic typed schema、MCP 工具、前端 `IssueRow`/`ProjectDetail`、幾乎每個測試 —— 以季為單位的漸進工程,底層已備妥故非高風險重設計,但**嚴禁 big-bang**。

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
