# ADR-0106: 規則的觸發條件跟通知事件合成同一份清單

## Status

Accepted

## Date

2026-08-20

## Context

系統裡「發生了什麼事」原本有兩套各自獨立的字彙。通知事件（`notifier.NOTIFICATION_EVENTS`，15 個，例如 `task.done`、`comment.created`、`project.complete`）在固定的呼叫點被明確觸發，供 webhook／email 這類 Integration 訂閱，也回填站內的 Notification。規則觸發條件（`rules_engine.SUPPORTED_TRIGGERS`，只有 5 個：`node.created`／`node.updated`／`node.deleted`／`edge.added`／`edge.removed`）供 `WorkflowRule` 使用，要靠比對時的 conditions（`changed_field`、`status` 等）才能收斂成具體意義。

這兩套字彙原本已經單向連通：規則的 `fire_event` 動作可以送出通知字彙裡的名字（或是使用者自創的名字），`event_catalog.py`（ADR-0048）讓那個名字變成 Integration 可以訂閱的對象。但反過來不行——規則沒辦法直接用 `task.done` 這種好懂的名字當觸發條件，只能拼回底層的圖形狀（`node.updated` + `changed_field: status` + `status eq done`）。結果是前端的規則編輯器跟 Integration 編輯器，對著概念上同一份「這個系統會發生的事」，卻各自秀出兩份完全不同的清單，而「任務完成時，做某件事，同時通知 Slack」這種需求，得用兩種不同的方式把「任務完成」講兩遍。

## Decision

`WorkflowRule.trigger` 現在可以是既有的 5 個結構性觸發條件之一，也可以是通知目錄裡任何一個「可被觸發」的事件名字（`event_catalog.TRIGGERABLE_EVENTS` = `NOTIFICATION_EVENTS` 扣掉 `rule.triggered`）。`rule.triggered` 被刻意排除：它只會在規則執行的過程中被觸發（`source="rule"`），永遠過不了下面說的防連鎖檢查，放進清單裡只會是一個看起來能選、實際上永遠不會跑的觸發條件——正是這個系統其他既有測試在防的那一類 bug。規則自訂的 `fire_event` 名字（`event_catalog.custom_events`）出於同樣的結構性理由也不開放當觸發條件：這些名字本來就只可能由規則自己的動作發出，永遠不可能有別的路徑點燃它。

觸發的位置不是新開一個呼叫點，而是 `notifier._deliver()`——這是所有 `fire_notifications`／`fire_project_notifications`／`fire_node_notifications` 呼叫最終匯聚的唯一函式，已經帶著 `event`、`source`、跟主體（`task`／`node`／`project`）。在這裡加一行 `run_rules(db, event, subject, {})`，一個具名事件就在原本要通知 Integration 的那一刻同時點燃規則——一個發送點，兩種聽眾，跟 `task_mutations.py`／`graph_dispatch.py` 對結構性觸發條件的做法是同一個模式。

順手修掉一個既有的正確性問題：`_deliver` 原本在沒有 Integration 訂閱時會提早 `return 0`，這會連帶跳過規則觸發——但「有沒有人訂閱這個事件」跟「有沒有規則在乎這個事件」是兩個互不相干的問題，規則必須無條件被嘗試觸發（除非呼叫端明確關閉）。

防連鎖沿用既有機制，只是延伸到新的呼叫路徑：規則絕對不能連鎖觸發規則。這件事一直是用一個明確從源頭傳下來的 `trigger_rules: bool` 參數做的，不是從 `source` 反推。這次把同一個參數往下多穿一層：`fire_notifications`／`fire_project_notifications`／`fire_node_notifications`／`_deliver` 都新增 `trigger_rules=True`；`apply_task_update`／`finalize_task_create` 既有的 `trigger_rules` 參數繼續往下穿進它們內部呼叫的 `fire_notifications`（包含新拆出來、一樣吃這個參數的 `_fire_status_events`）；`rules_engine._fire()`（`fire_event` 動作背後的函式）跟 `add_comment` 動作各自呼叫 `fire_notifications` 時明確傳 `trigger_rules=False`。其他呼叫點（scheduler 的到期／逾期提醒、留言路由、webhook 回呼、專案生命週期事件）維持預設的 `True`——這些都是真實、非規則造成的時刻，本來就應該能點燃規則，這正是這個功能要做的事。

驗證的位置搬到有資料庫可查的地方，跟既有的 `event_catalog.validate_events`（給 `Integration.events` 用）同一個做法：新增 `subscribable_triggers(db)` 跟 `validate_trigger(db, trigger)`；`schemas.py` 拿掉原本純 pydantic、只認 5 個結構性觸發條件的靜態檢查；`rule_admin.py`（ADR-0085 兩道門共用的那個服務）的 `create`／`update` 改呼叫這個新檢查，`vocabulary()` 多回傳 `structural_triggers`／`event_triggers`，`triggers` 變成兩者的聯集。MCP／`/api/v1` 完全不用動：`trigger` 本來就是 plain `str`（ADR-0077 簽名即 schema 不受影響），兩道門本來就都經過 `rule_admin`。

前端 `WorkflowRules.jsx` 的觸發條件下拉選單原本攤平顯示 `vocabulary.triggers`，現在依 `structural_triggers`／`event_triggers` 分成兩個 `<optgroup>`，跟 `Integrations.jsx` 既有的 `groupEvents` 分組手法是同一個精神。標籤完全不用另外處理：`ruleTerms.js` 的 `triggerLabel()` 本來就會把辨識不出的 key 轉成人話（`"task.done"` → `"Task Done"`），這正是它當初設計成這樣的理由。

## Consequences

正面：前端只剩一份「這個系統會發生什麼事」的清單，使用者不用先把 `task.done` 拆解回 `node.updated` + `changed_field=status` + `status=done` 才能拿來當觸發條件；規則要對「任務完成」「留言新增」這類具名時刻做反應，現在是直接選一個名字，而不是重建它背後的圖形狀。既有的結構性觸發條件完全沒被動到——一個規則要監聽任意節點型別的任意欄位變化，還是要靠 `node.updated` + conditions，具名事件字彙只涵蓋這 15 個場景明確想表達的意思。

負面與代價：`_deliver` 內多了一次條件式的 `run_rules` 查詢（即使沒有任何規則掛在那個 trigger 上，也要查一次 `WorkflowRule` 表）；`trigger_rules` 這個參數現在多穿了兩層函式簽名，往下追蹤一個事件會不會點燃規則，得多看一步。`docs/adr` 之外，既有的靜態掃描守門測試（`tests/test_task_pipeline_guard.py::test_run_rules_is_only_called_from_a_dispatcher`）原本只認 `task_mutations.py`／`graph_dispatch.py` 兩個呼叫點，這次連帶把 `notifier.py` 也列進允許清單——這條測試在意的「`run_rules` 不能散落在任意呼叫點」的不變量本身沒有被削弱，只是多了一個同樣單一、同樣有名字的第三個發送點。
