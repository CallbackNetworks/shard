# ADR-0032: 統一節點／邊圖模型取代固定容器關係

## Status
Accepted

## Date
2026-07-15

## Context

目前資料模型把「實體」與「關係」混在兩種不對稱的表達方式裡:

1. **固定容器(單一歸屬的外鍵)**:`Task.project_id` 讓每個任務只能屬於一個專案;`Task.parent_id` 讓子任務只能有一個父節點;`Label.project_id` / `Cycle.project_id` 把標籤與週期綁死在單一專案底下。
2. **已經是節點關係(多對多關聯表 = 邊)**:`ProjectIdentity`(專案↔身份)、`GoalProject`(目標↔專案)、`TaskDependency`(任務↔任務,帶語意)、`TaskLabel`、`CycleTask`。

這種不對稱造成幾個限制:同一個任務無法同時掛在多個專案或多個上層任務底下;身份只能透過專案間接關聯到任務,不能直接關聯;專案無法掛在另一個專案之下形成任意層級。每要新增一種「A 與 B 有關係」都得再開一張關聯表與一套 CRUD。

這是個單人多身份的個人工具(見 [[project_purpose]]),資料量有限、只有單一資料集,因此有條件做一次性的儲存層重塑,而不必顧慮多租戶線上遷移。目標:讓 Project / Task / Identity / Goal / Cycle / Label 都成為對等的**節點**,它們之間所有關係都成為對等的、可多重、帶類型的**邊**。

## Decision

採用**單一屬性圖(property graph)儲存層**:一張 `nodes` 表 + 一張 `edges` 表,取代固定容器外鍵。不採用「把每個實體都塞進純 JSON 節點」的極端做法,以保住查詢能力與遷移可行性。

**`nodes`(single-table inheritance + JSON 尾巴)**
- `id`(沿用各實體原本的 UUID)、`type`(`project`/`task`/`identity`/`goal`/`cycle`/`label`)、`title`。
- 熱查詢欄位保留為真欄位並建索引:`status`、`priority`、`due_date`、`start_date`、`position`、`is_pinned`。這些是 scheduler、board、gantt、排序大量依賴的欄位,放進 JSON 會讓 SQLite/PostgreSQL/MySQL 的 JSON 取值語意分歧(見 [[0018-postgres-parity-and-fresh-db-bootstrap]] 的方言差異教訓)。
- 其餘型別專屬欄位(description、color、avatar、share_token、wip_limits、外部 issue 連結等)進 `data` JSON。

**`edges`(唯一的關係原始物件)**
- `id`、`source_id`→`target_id`(皆為 `nodes.id`)、`rel_type`、`position`(同一父層下的排序)、`data` JSON(邊的中繼資料)、時間戳。
- 唯一約束 `(source_id, target_id, rel_type)`。
- 標準方向與詞彙(source → target):
  - `contains`:父(專案/任務)→ 子任務。**同時取代 `project_id` 與 `parent_id`** — 任務可有多個 `contains` 父節點;任務的「所屬專案」定義為最近的 `project` 型祖先。
  - `member_of`:身份 → 專案(取代 `ProjectIdentity`)。
  - `assigned_to`:任務 → 身份(身份可直接關聯任務,現況做不到)。
  - `depends_on`:被擋任務 → 前置任務(取代 `TaskDependency`,保留其 blocked-by 語意)。
  - `labeled`:任務 → 標籤(取代 `TaskLabel`)。
  - `in_cycle`:任務 → 週期(取代 `CycleTask`)。
  - `part_of`:專案 → 目標(取代 `GoalProject`)。

**只有實體變節點,關係變邊。** Comment、Attachment、ActivityLog、Integration、ApiKey、Notification、RecurrenceRule、WorkflowRule、SavedFilter、AssistantMessage、TaskPullRequest、WebhookEvent、UserPreference 等週邊紀錄**不**成為節點,維持既有表與既有 FK。因為節點沿用原 UUID,這些表的 `task_id` / `project_id` 指標自動仍然有效,毋須改動。

**API 回應形狀在切換期維持相容。** `TaskOut.project_id` / `parent_id` 由 `contains` 邊推導(取最近/首個父節點),`labels`、`blocked_by`、`blocking` 由對應 rel_type 的邊推導。多重歸屬能力(`project_ids[]`、跨專案掛載)以新增欄位漸進開放,不破壞既有前端與 MCP。

**分階段遷移,全程保持 app 可運作**(詳見 `docs/graph-model-migration-plan.md`):
1. 基礎層:新增 `Node`/`Edge` model 與建表 migration,回填既有資料(雙存,舊表仍為權威),加 `services/graph.py` 與測試。
2. 讀取切換:`_enrich` / `_enrich_task` 與 GET 端點改讀圖,回應形狀不變;寫入暫時雙寫。
3. 寫入切換:所有 mutation 只寫圖,停止寫舊表。
4. 前端 / MCP 與新能力:開放多重歸屬與跨專案掛載 UI。
5. 清理:migration 移除舊實體表、關聯表與 `project_id`/`parent_id` 欄位。

## Consequences

**正面:**
- Project / Task / Identity / Goal / Cycle / Label 對等化;任意兩實體間的關係只有一種表達方式(邊),新增關係類型不再需要新表與新 CRUD。
- 解鎖多重歸屬:任務可跨多專案、多父節點;身份可直接關聯任務;專案可任意層級巢狀。
- `TaskDependency`、`ProjectIdentity`、`GoalProject`、`TaskLabel`、`CycleTask` 五張關聯表收斂為單一 `edges` 原始物件,符合「一個最小 primitive、重用既有結構」的取向(見 [[feedback_restrained_design]])。
- 沿用 UUID 使外圍表零改動,大幅縮小爆炸半徑。

**負面 / 代價:**
- 儲存層是 single-table inheritance:`nodes` 上的熱欄位對不同型別部分為 NULL(專案不用 due_date、身份不用 priority),`data` JSON 缺乏 schema 強制,型別專屬約束改由應用層維護。
- 圖查詢取代直接外鍵 join:「某專案的所有任務」從 `WHERE project_id=?` 變成邊遍歷,需在 `services/graph.py` 收斂遍歷邏輯並注意 N+1 與遞迴深度。
- 這是跨 backend / migration / 測試的大型多階段工程;切換期需維持雙寫/雙讀的一致性,遷移計畫的階段順序必須嚴格遵守以免中途破窗。
- `contains` 允許多父節點後,需在應用層防止環(A contains B、B contains A),並定義「所屬專案」在多祖先情境下的決定性規則。
