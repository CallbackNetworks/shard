# ADR-0048: 規則的動作走同一條寫入管線，通知來源成為可訂閱的設定

## Status

Accepted

## Date

2026-07-30

## Context

這個模組最初的意圖是「內部 pipeline 的自動化，並且能通知外部有變更」。ADR-0047 修好了通知這一半：
15 個事件全部有真正的發送點，全域整合不再因為 `project_id IN (:id, NULL)` 而收不到任何東西。

但自動化那一半仍然是斷的，而且斷得很安靜。

`services/rules_engine.py` 的動作直接呼叫 `graph.update_task` / `graph.set_label` 寫資料庫，
繞過 ADR-0038 的 task pipeline 與 ADR-0045 的 edge dispatcher。這是刻意的：
`tests/test_task_pipeline_guard.py` 的 `ALLOWED` 與 `EDGE_ALLOWED` 都替它寫了豁免理由
（「已經在 dispatch 之中，再 dispatch 會遞迴」）。實際後果用 live probe 驗證過：

- 規則把任務改成 `done`，**沒有**任何 `task.done` 或 `task.status_changed` 通知送出去。
- 活動紀錄只有一行 `rule.executed`，看不到狀態其實變了、從什麼變成什麼。
- 也就是說，最該被通知的那一種變更——自動化造成的——恰好是唯一不會通知的。

豁免理由本身也站不住腳。`_rule_depth` 這個遞迴計數器從第一天（`58ff578`，2026-04-25，沒有 ADR）
就存在，但從來沒有任何地方遞增它——因為動作根本沒有走回寫入面，也就沒有機會再觸發規則。
真正防止遞迴的不是那個計數器，而是「動作繞過管線」這件事本身；換句話說，遞迴防護是 bug 的副作用。

同時 ADR-0047 留下了一個不對稱：規則的 `fire_event` 動作接受任意字串，所以使用者可以送出
`deploy.requested`（201），但要訂閱它時卻被拒絕（422）——因為訂閱只允許 `NOTIFICATION_EVENTS`。
可以發、不能收，這又是同一類「設定看起來有效、行為是安靜的空集合」的缺陷。

## Decision

**一、規則的寫入走一般的寫入面，但規則永不串接。**

`_apply_fields` 改呼叫 `apply_task_update`，標籤動作改呼叫 `dispatch_edge_added/removed`。
規則造成的變更因此得到和人為變更一樣的活動紀錄與通知——這正是當初「內部自動化要能通知外部」的意思。

遞迴改由參數明確切斷，而不是靠繞過管線的副作用：`apply_task_update` 與 edge dispatcher 新增
`trigger_rules: bool = True`，規則自己的寫入一律傳 `False`。規則 A 的變更不會觸發規則 B。
沒有做成「最多兩層」是因為深度上限是個難以推理的規則：使用者無法從規則列表看出哪一條會不會被連鎖觸發。
「規則不串接」是一句能寫在畫面上的話。

規則的變更同時帶 `sync_external=False`：把規則造成的改動推回外部 issue tracker，可能正好推回它剛剛
進來的地方，形成 echo（ADR-0014 已經為 inbound 方向做過同樣的判斷）。

`test_task_pipeline_guard.py` 中 `rules_engine` 的兩條豁免因此被刪除——不是放寬，是旁路消失了。

**二、`source` / `actor` 進入 payload，並成為訂閱端可以過濾的條件。**

既然規則造成的變更現在會發通知，訂閱者就需要能說「這種我不要」。做法不是在 notifier 裡寫死策略，
而是把「誰造成的」放進 payload，讓每個整合自己決定：

- `fire_notifications` / `fire_project_notifications` 新增 `source` 與 `actor`。
- 可訂閱的來源詞彙是 `NOTIFICATION_SOURCES`：`user` / `api` / `rule` / `scheduler` / `webhook` / `assistant`。
- pipeline 內部的 `_SOURCE_SUFFIX` 比這個細（`bulk`、`node`、`import`、`duplicate`…），
  由 `normalize_source` 對應過去：`bulk` 仍然是人在點，所以到訂閱端是 `user`。
  對不上的值退回預設而不是自創一個訂閱端選不到的來源。
- `Integration.sources`（JSON，nullable）。**null 或空陣列代表全部來源**，所以既有的整合行為完全不變。

**三、可訂閱的事件 = 內建事件 + 使用者自己的活躍規則實際會發的事件。**

`services/event_catalog.py` 在讀取時從 `WorkflowRule` 推導，不新增資料表：只有 active 的規則算數
（停用發送方就等於不再廣告該事件，和「不廣告沒人發的事件」是同一個道理）。
事件驗證因此需要 DB session，從 Pydantic validator 移到 router；來源驗證不需要 DB，留在 schema。

## Consequences

正面：

- 自動化不再是隱形的。規則改了任務，訂閱者會知道，活動紀錄也看得到是誰改的、從什麼改成什麼。
- 「要不要收自動化造成的通知」變成每個整合自己的設定，而不是寫死在程式裡的策略。
- 遞迴防護從一個從未生效的計數器，變成一個有測試、有明確語義的參數。
- 自訂事件可發也可收，補上 ADR-0047 留下的不對稱。
- guard test 的豁免清單少了兩條——這個模組不再有任何寫入旁路。

負面與代價：

- **這是既有整合的行為變更**：訂閱 `task.done` 的整合，如果有規則會把任務改成 done，現在會多收到通知。
  這是刻意的（那正是原本該送的通知），但確實可能讓既有的接收端變吵。緩解方式是 `sources` 過濾，
  預設 null 保留舊行為的是「收得到」而不是「收不到」——我們選擇讓遺漏的通知先出現，而不是繼續沉默。
- `_exec_action` 變成 async 且會回傳刷新後的 task view（欄位寫入會重建 `TaskView`，
  舊 view 立刻過期），呼叫端必須用回傳值。
- 規則不串接是一個真正的功能限制：想要連鎖效果必須寫在同一條規則的多個動作裡。
- 可訂閱事件清單現在每次讀取都掃一次活躍規則。規則數量是個位數到數十條的量級，成本可忽略；
  若日後規則變多，這裡是第一個該加快取的地方。
