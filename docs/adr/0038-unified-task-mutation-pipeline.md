# ADR-0038: 統一任務變更管線 —— 單一 post-mutation 序列服務

## Status
Accepted

## Date
2026-07-19

## Context

任務變更後的副作用序列(擷取舊值 → `graph.update_task` → `log_activity` → `fire_notifications` → 外部 issue 同步 → `run_rules` → `ws_manager.broadcast`)在五個入口各自手寫:

1. `routers/tasks.py`(web SPA)—— 最完整的參考實作
2. `routers/external_api/tasks.py`(外部 API)—— **漏跑 workflow rules、外部欄位同步、agent key 驗證、assignee/agent activity、ws 廣播**
3. `routers/bulk.py`(SPA 批次操作)—— **完全不跑 rules 與通知**
4. `routers/webhooks.py`(CI/CD callback)—— 只發 `task.{status}`,不發 `task.status_changed`;同狀態 callback 也會記一筆假的 status_changed activity
5. `services/assistant_tools.py`(LLM assistant)—— **完全沉默:無 activity、無通知、無 rules、無廣播**

事件語彙也分裂:web 發 `task.status_changed`,API/webhook 發 `task.{status}`;`project.complete` 只有 API/webhook 檢查。訂閱者收到什麼取決於變更從哪個入口進來,而不是發生了什麼。

這不是美觀問題:批次操作與 API 呼叫繞過使用者設定的自動化規則,assistant 的變更沒有稽核軌跡,前端也收不到即時更新。每加一個入口(未來如 MCP 直寫)都會再抄一次序列並再漏一部分。

## Decision

新增 `services/task_mutations.py` 作為唯一的 post-mutation 管線:

- **`apply_task_update(db, task_id, changes, *, actor, source, ...)`**:舊值擷取、agent key 驗證(`AgentKeyError`,由 router 轉 400)、欄位更新、activity(detail 帶 source 後綴)、通知(status 變更同時發 `task.status_changed` **與** `task.{status}`、全數完成加發 `project.complete`)、外部 issue 同步(`sync_external=False` 供 webhook 防 echo loop)、rules(`_rule_depth` 傳遞)、`task.updated` 廣播。
- **`finalize_task_create(db, task_id, *, actor, source, project_id, ...)`**:`task.created` activity + rules + 通知 + 廣播。
- **`commit` / `broadcast` 旗標**供批次呼叫端:批次更新逐任務 `commit=True`(規則失敗的 `rollback()` 不會吞掉先前項目),`broadcast=False` 改發單次彙總事件(`task.bulk_updated` / `task.imported`)。
- **序列化留在呼叫端**(`enrich_task` vs 手組 `TaskOut` 各端本就不同);re-parenting(graph move,ADR-0032)與請求驗證也留在呼叫端。
- `issue_sync` 目前住在 `routers/`,由 service 引用是分層倒置 —— 採**函式內延遲匯入**(與 `rules_engine._exec_action` 既有模式一致)避免載入期循環;把 issue_sync 遷入 `services/` 是後續的乾淨解法。

拒絕的替代方案:SQLAlchemy event listener(隱式副作用難以理解與測試、拿不到 actor/source 語境)、每個 router 自行補齊(正是造成漂移的原因)。

## Consequences

**正面:**
- 五個入口行為一致:rules、通知、activity、廣播不再取決於入口。批次與 API 路徑的自動化缺陷修復;assistant 變更有稽核軌跡;CI callback 會即時推到前端。
- 事件統一後訂閱語意單純:要粗粒度訂 `task.status_changed`,要細粒度訂 `task.done`/`task.failed`。
- 新入口只需呼叫兩個函式;管線本身有獨立單元測試(`tests/test_task_mutations.py`)。

**負面 / 取捨:**
- 行為可見變化:web 編輯現在也會發 `task.{status}` 與 `project.complete`;webhook callback 多發 `task.status_changed` —— 同時訂閱兩類事件的 integration 會收到雙份(語意不同的兩個事件,屬預期)。
- 批次更新從單一 commit 改為逐任務 commit:批次中途失敗會留下已完成的部分(先前是全部回滾);換來規則失敗不會吞掉整批。
- `services → routers.issue_sync` 延遲匯入是暫時的分層妥協。
