# ADR-0047: 通知事件收斂成單一清單，並讓每個事件真的送得出去

## Status

Accepted

## Date

2026-07-28

## Context

這個平台最初的用途是「內部 pipeline 自動化，並且能通知外部有變更」。也就是說，
notification 不是裝飾，是對外的契約：外部系統靠它知道平台裡發生了什麼。

ADR-0046 修掉了 workflow rule 的同一種病：一個引擎看不懂的字串會被當成「不符合／不做事」
靜靜吞掉，於是一條拼錯的規則看起來活著卻永遠不會跑。稽核通知路徑時，發現同一種病在這裡
更嚴重，而且有四層：

1. **訂閱得到、但永遠不會發生的事件。** UI 的勾選清單、`/api/v1/subscriptions/events`
   對外廣告的清單，各自是一份手抄的複本。其中 `task.deleted`、`comment.created`、
   `rule.triggered`、`project.created`、`project.archived` 這五個，程式裡從來沒有任何地方
   把它們交給 `fire_notifications`。勾了等於訂閱了空氣，而且系統不會告訴你。

2. **全域整合完全收不到東西。** `_deliver` 用
   `Integration.project_id.in_([project.id, None])` 挑收件者。SQL 裡 `NULL IN (x, NULL)`
   的結果是 NULL 不是 true，所以**沒有指定專案的整合（project_id 為 NULL）從來沒有被選中過**。
   線上 10 個整合裡有 9 個是這一類。既有測試每一個都指定了 `project_id`，所以測試全綠而東西
   全部沒送出去。

3. **無效的動作值。** ADR-0046 驗證了動作的 *type*，沒有驗證 *value*。既有測試裡就躺著一條
   `{"type": "set_priority", "value": "urgent"}` — 系統裡根本沒有 `urgent` 這個優先權，
   這條規則會被接受、會被計入 `run_count`，然後什麼也不改。

4. **外部 API 的留言不通知。** `/api/v1` 建立留言的路徑只寫了活動紀錄與 WebSocket，
   沒有 `fire_notifications`；同一件事從 UI 做和從 API 做，對外部訂閱者是兩種結果。

共同的形狀都一樣：**設定看起來成立，行為卻是靜默的空集合。**

## Decision

**一份清單，由後端提供，並用測試釘在真正的發送點上。**

- `services/notifier.py` 的 `NOTIFICATION_EVENTS` 是唯一的事件詞彙。
  `/api/v1/subscriptions/events` 直接指向同一個物件；前端不再自己抄一份，改打新的
  `GET /api/integrations/events` 取得，分組（task／project／other）純粹由前綴推導，屬於呈現。
- 五個從未發送的事件全部接上線，而不是從清單移除 —— 因為原始意圖是「通知外部有變更」，
  移除等於讓外部系統漏掉變更：
  - `project.created`／`project.archived` 掛在 node dispatcher（ADR-0040 的角色分派點）上，
    限定內建 project 型別：自訂 container 不是 `project.*` 訂閱者要的東西。
  - `task.deleted` 在 `delete_task_tree` **之前**發送，因為事件要靠 task 反查專案，拆完就查不到了。
  - `comment.created` 在內部與 `/api/v1` 兩條留言路徑都發送。
  - `rule.triggered` 在規則實際執行成功之後發送。
- **專案層級事件的 payload 不含 `task` 鍵**，而不是塞一個假的佔位物件。這是對外契約的變更：
  消費端必須把 `task` 當成選用欄位。
- `_deliver` 的收件者條件改成 `project_id == :id OR project_id IS NULL`，全域整合恢復作用。
- `Integration.events` 在 schema 層驗證（未知事件回 422），`WorkflowAction` 的值也在
  `set_status`／`set_priority` 這兩個封閉列舉上驗證。其餘動作的值是自由文字（負責人、標籤名、
  留言內容），無法事先檢查。
- 測試用靜態掃描把清單釘住：掃過 `app/` 所有發送點（含 dispatcher 的薄包裝，以及以變數傳入
  事件名的排程器），比對清單，任何「廣告了卻沒人發」或「發了卻沒廣告」的事件都讓 CI 紅。
  這一則用掃描而不用執行期斷言的理由與 ADR-0044 相同：旁路上的斷言根本不會被執行到。

## Consequences

正面：

- 勾選框與實際送達之間不再有落差；清單只有一份，多抄一份就編不過測試。
- 全域整合恢復投遞。這同時修好了**所有**事件對全域整合的投遞，不只新接上的五個。
- 「內部改動 → 通知外部」的覆蓋範圍補齊：刪除、留言、規則觸發、專案建立與封存都會外送。
- 無效的規則動作值在寫入時就被擋下，不會再產生一條會累加 `run_count` 卻什麼都不做的規則。

負面與代價：

- **對外契約變更**：`project.*` 事件的 payload 沒有 `task` 鍵。既有消費端若無條件讀
  `payload["task"]` 會壞。這是刻意的：假的佔位物件會讓下游做出錯誤判斷。
- 每次規則執行多一次 `rule.triggered` 投遞；訂閱它的整合會看到明顯變多的流量，因此它預設不在
  「critical only」預設集裡。
- 新增事件現在要動兩個地方（清單 + 真正的發送點），否則 CI 會擋。這正是想要的成本。
- 靜態掃描認得的是「發送函式」名單；未來若再包一層新的 wrapper，必須把它加進測試的
  `FIRE_FUNCTIONS`，否則會誤判為 dark event。
