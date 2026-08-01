# ADR-0053: 執行紀錄要說出它觸發了什麼

## Status

Accepted

## Date

2026-08-01

## Context

ADR-0047 到 ADR-0052 修的是同一種缺陷的六個位置：引擎靜靜地什麼都不做。每一次的修法都是
「留下一筆紀錄」。但這系列的最後一個問題是：**紀錄本身也可能是空的**。

`rule.executed` 的內容長這樣：

```
Rule "Auto-label security tasks" executed on task "Fix login bug"
```

它說了「有跑」，沒說跑出了什麼。這跟規則卡片上的 `ran 47×` 是同一個毛病換一個地方——一個數字
或一句話，記錄了事件發生，卻沒有記錄事件的內容。使用者要判斷自動化到底有沒有在做事，唯一的
辦法是自己去比對任務前後的狀態。

更精確地說，前面幾個 ADR 一直把結果切成兩種：**成功**與**沒做成**。實際上是四種：

| 結果 | 意思 | 之前的處理 |
|------|------|-----------|
| `applied` 生效 | 跑了，而且改變了東西 | 記成 `rule.executed` |
| `no_op` 空轉 | 跑了，正確地跑了，但什麼都沒變 | **也記成 `rule.executed`，完全分不出來** |
| `skipped` 跳過 | 根本執行不了 | `rule.skipped`（ADR-0050） |
| `failed` 失敗 | 拋了例外 | `rule.failed`（ADR-0052） |

第二列是這系列一直沒看到的狀態。它有兩個具體來源，兩個都經過實測確認：

1. **動作把欄位設成它本來就是的值。** 規則寫「當狀態變成 done 時，把優先度設為 high」，任務本來
   就是 high。`apply_task_update` 收到一個沒有變化的 `changes`，下游不會發任何 `task.*` 通知，
   活動紀錄也不會多一行——完全正確的行為。但 `rule.executed` 照樣寫下去，`run_count` 照樣 +1。

2. **`fire_event` 送出一個沒有人訂閱的事件。** `_deliver` 裡的
   `matching = [...]` / `if not matching: return` 是 ADR-0047 那個「沉默的空集合」的發送端版本：
   規則做完了它該做的，而它誰也沒送到。實測 `deliveries: 0`、活動紀錄只有一行 `rule.executed`。

而且**空轉不必然是缺陷**。一條冪等的規則就是一條正確的規則，它本來就該在條件已經滿足時什麼都
不做。所以它不能被畫成警示色——那會訓練使用者忽略警示色。它需要的是一個**中性但可辨識**的表達。

順帶發現的一個斷鏈：`rule.skipped` 的 meta 是
`{node_id, type, action, reason}`——**沒有 `rule_id`**，因為 `_exec_action` 與 `_apply_label`
都拿不到 rule。活動頁能說「add_label 因為找不到 security 標籤而跳過」，卻沒辦法說是哪一條規則說的。

## Decision

**一、動作的結果收斂成一組四值詞彙，每個動作都必須回報一個。**

`OUTCOME_APPLIED` / `OUTCOME_NO_OP` / `OUTCOME_SKIPPED` / `OUTCOME_FAILED` 定義在
`rules_engine`。`_exec_action` 的簽章從「回傳 node」改成回傳 `(node, record)`，`record` 是
`{"type", "value", "outcome", "reason"?, ...}`。這個形狀是刻意的：**一個沒有回傳 record 的
分支就是這個模組一再要重新關上的那條沉默路徑**，改成 tuple 之後漏掉它會是型別錯誤而不是靜默。

各動作怎麼判定 applied 與 no_op：

- 欄位動作（`set_status`/`set_priority`/`set_assignee`）改走 `FIELD_ACTIONS` 對照表，**寫入前先
  比對現值**。相同就是 `no_op`，不同才呼叫 pipeline，並在 record 裡帶上 `from`。
- 標籤動作：`_apply_label` 本來就知道——它那兩個提前 return 正是空轉的情況（已經有這個標籤 /
  本來就沒有這個標籤），只是以前把它們和成功一起丟掉了。
- `add_comment`：一定 applied（留言一定是新的東西）。
- `fire_event`：`applied` 或 `no_op`，看**訂閱者數量**。

**二、通知端回報配對到幾個訂閱者。**

`fire_notifications` / `fire_project_notifications` / `fire_node_notifications` / `_deliver`
的回傳從 `None` 改成 `int`。「送出去了」和「有人收到」是兩件不同的事實，只有呼叫端知道這個差別
值不值得記錄，所以 notifier 只負責把數字交出來，不自己決定要不要抱怨。

**三、`rule.executed` 記下它觸發了什麼。**

`meta` 增加 `actions`（每個動作一筆 record）與 `effect_count`；`detail` 由 `_summarize` 產生，
把每個動作講成一句話，而且在完全沒有效果時明說：

```
Rule "R" ran on task "T" with no effect: priority already high;
add_label skipped (label_not_found); fired "deploy.requested" to no subscriber
```

前端是照 `meta["actions"]` 結構化渲染的，但這行純文字仍然要能讓人採取行動——日誌、摘要信、
活動頁的單行預覽都只有它。

**四、`rule.skipped` 帶上 `rule_id` 與 `rule_name`。**

`rule` 一路傳進 `_skip`，補上那個斷鏈。

**五、規則多一個 `effect_count` 欄位。**

`run_count` 回答「有沒有觸發」，卻一直被當成「有沒有在做事」讀。卡片改成
`執行 47 次 · 12 次有效果`，而且**在 0 的時候才上色**——那正是值得處理的情況。既有資料 backfill
成 0 而不是複製 `run_count`：複製等於斷言過去每一次執行都有效果，而那正是這個欄位存在的目的
所要避免的斷言；0 誠實地表示「還沒量過」，下一次執行就會自己修正。

**六、前端把兩個軸分開表達。**

`utils/ruleOutcomes.js` 是唯一的顏色來源，對應引擎的四個值：生效 = 品牌色，空轉 = 中性灰，
跳過 = 警示色，失敗 = 危險色。活動頁在每一列 `rule.executed` 下面渲染每個動作的結果籤；而
`rule.executed` 這個 action 籤本身的顏色改成看 `effect_count`——同一個 action 字串，改變了東西
和沒改變東西不該是同一個顏色。

## Consequences

正面：

- 「執行了」與「有效果」在紀錄、資料庫欄位、畫面三個層次都是分開的。一條天天觸發但什麼都沒改的
  規則，現在會自己說出來。
- `fire_event` 送給零個訂閱者不再是靜默成功。ADR-0047 從接收端關掉的那個空集合，發送端也關上了。
- 跳過的動作可以追回是哪一條規則。
- `_exec_action` 的 tuple 回傳讓「忘記回報結果」變成寫不出來的程式碼，而不是下一次巡查的發現。

負面與代價：

- `meta["actions"]` 讓 `activity_log` 的每一列 `rule.executed` 變大。動作數量以個位數計，可忽略；
  它取代的是使用者原本得靠猜的東西。
- 欄位動作多一次現值比對。它讀的是已經在手上的 TaskView，沒有額外查詢。
- 多一個 schema 欄位與一次 migration。
- 「空轉」的判定對欄位動作是精確的（比對前後值），對 `add_comment` 是恆為 applied 的近似——一則
  和上一則內容相同的留言仍然算 applied。這是刻意的：留言本來就是可以重複的東西。
- dry-run（`POST /workflow-rules/{id}/test`）仍然只回答「條件會不會成立」，不預演動作的結果。
  這裡建立的 outcome 詞彙正是它日後要共用的東西——抽一支 `predict_outcome(db, action, node)`
  給引擎、dry-run、以及規則存檔時的「這條規則存下去會全部空轉」警告三邊共用——但那會改變 dry-run
  的回應形狀，留到後續決定。
