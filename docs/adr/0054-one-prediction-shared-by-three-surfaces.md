# ADR-0054: 預演與執行共用同一個判斷

## Status

Accepted

## Date

2026-08-01

## Context

ADR-0053 讓每一次執行都說出它觸發了什麼，並在 Consequences 裡留下一個沒做的部分：dry-run
（`POST /workflow-rules/{id}/test`）仍然只回答「條件會不會成立」。

實際看它的程式碼，問題比「少了一半」更嚴重：

```python
return {
    "would_fire": all(met),
    "conditions_met": met,
    "actions": rule.actions if all(met) else [],   # 規則自己的設定，原封不動送回去
}
```

`actions` 不是結果，是**輸入**。這顆按鈕唯一的用途是在規則真的跑起來之前抓到問題，而它做的
事情是把使用者剛剛打進去的東西唸一遍。實測：對一條動作是 `add_label "security"`、而系統裡
根本沒有這個標籤的規則按下 TEST，得到

```json
{"would_fire": true, "conditions_met": [true], "actions": [{"type": "add_label", "value": "security"}]}
```

同一條規則實際執行時，五次全部 `skipped / label_not_found`。**檢查工具給了綠燈，引擎每次都跳過。**
這是這一系列 ADR 一直在修的那個缺陷最惡劣的一種形式：不是沉默，是**說了一句錯的**。

第二個缺口：這顆按鈕只認 task（`graph.get_task`）。ADR-0049 之後規則在 `node.created` 上對每
一種節點觸發，而「主體不是 task、所以每個動作都被跳過」正是最值得預先檢查的情況——偏偏它檢查不了。

第三個缺口在更前面：規則被存下來的當下，系統其實已經能判斷某些動作**對任何主體都不可能成功**
（引用了不存在的標籤、送一個沒有任何整合訂閱的事件）。今天要發現這件事，只能等它跑、然後去活動
頁讀紀錄。

最後是輸入方式：dry-run 要使用者**手貼一串 node ID**。檢查規則的門檻比寫規則還高。

## Decision

**一、抽出 `predict_outcome(db, action, node)`，三個界面共用。**

回傳與執行紀錄**完全相同**的 record 形狀（`{type, value, outcome, reason?, ...}`，ADR-0053 的
四值詞彙）。它不寫任何東西：不留活動紀錄、不送通知、不動標籤邊。

三個使用者：引擎（`_exec_action`）、dry-run、存檔警告。**這是本 ADR 的核心。**如果預演和執行
各寫一套判斷，總有一天存檔說「沒問題」、TEST 說「會跳過」、實際執行是第三種答案，而漂移的那一
邊必定是告訴使用者「你的規則沒問題」的那一邊。

**二、`_exec_action` 改成「預測 + 執行」。**

```python
record = predict_outcome(db, action, task)
if record["outcome"] == OUTCOME_SKIPPED:  return task, _skip(db, task, record, rule)
if record["outcome"] == OUTCOME_NO_OP:    return task, record          # 依定義沒有要寫的東西
...                                                                     # applied：照 record 說的做
```

判斷只有一份，執行是它的下游。`skip_detail(record, node)` 也一併抽出來，讓「為什麼跳過」這句
話同樣只有一份定義。`_apply_label` 的判斷部分移進 `predict_outcome`，剩下的純寫入部分改名為
`_write_label`。

**三、dry-run 回答兩件不同的事，並接受任何節點。**

回應加上 `node`（主體是什麼）、把 `actions` 換成每個動作的**預測結果**、加上 `effect_count`。
`would_fire` 只回答「條件成不成立」，`effect_count` 回答「會不會改變什麼」——這是 ADR-0053 在
執行端建立的同一組區分，補到預演端。查詢參數改成 `node_id`，`task_id` 保留為 deprecated 別名。

**四、存檔時給警告，不是 422。**

`rule_warnings(db, actions, project_id=None)` 回答那個**沒有主體**的問題：這個標籤存不存在、
這個事件有沒有人訂閱。它出現在 `WorkflowRuleOut.warnings`，因此規則卡片上一直看得到。

**警告而非拒絕**，因為條件會變：標籤明天可能被建出來、整合下週可能訂閱；而且全域規則在 A 專案
是死的、在 B 專案是活的，擋下寫入會讓一條合法的規則存不進去。同理，它**每次讀取時重算而不儲存**
——警告描述的是世界的狀態，不是規則的屬性。存起來的警告會繼續指控一條使用者早就修好的規則。

範圍規則：全域規則只要標籤在**任何**專案存在就不警告；綁定專案的規則只看該專案。事件訂閱同樣
scope-blind（`notifier.event_has_subscriber`）。

**五、前端：從清單挑主體，用同一組籤顯示。**

原本的 `task ID` 輸入框換成搜尋挑選器（任務與專案皆可，因為規則可以觸發在任何節點上）。
ADR-0053 的結果籤抽成共用元件 `components/shared/RuleOutcomeChips`，活動頁的執行紀錄、dry-run
的預測、規則卡片的警告三處共用——形狀相同的東西長得一樣，使用者才可能把預測和實際對起來。

## Consequences

正面：

- 檢查規則的按鈕不再可能給出引擎不會做的答案。這是本次修掉的真正缺陷：`would_fire: true` 之下
  藏著一個每次都跳過的動作。
- 「條件成不成立」與「動作做不做得到」在 UI 上是分開的兩個答案，對應執行端已經分開的兩個軸。
- 一條引用不存在標籤的規則，在**存檔當下**就說得出來，不必等它跑完一週再去翻活動頁。
- dry-run 可以對非 task 節點使用，也就是說「每個動作都會被跳過」這個最需要預檢的情況終於檢查得到。
- 預演與執行的一致性由結構保證（同一支函式），不是由兩邊的測試各自維持。

負面與代價：

- dry-run 的回應形狀變了（`actions` 從設定變成結果，多了 `node`/`effect_count`）。這是刻意的
  破壞性變更：舊形狀回答的是錯的問題。
- 規則列表每次讀取都會為每個動作跑一次靜態檢查（標籤查詢、整合查詢）。規則數量以個位數到數十
  計，可接受；若日後成為問題，該做的是快取整合訂閱表，而不是把警告存進資料庫。
- `predict_outcome` 對 `fire_event` 預測的訂閱者數量與實際送出時再數一次的結果理論上可能不同
  （中間有人改了整合設定）。record 以**實際送出時**的數字為準：紀錄要說的是發生了什麼，不是
  當初預期什麼。
- 警告只涵蓋「對任何主體都不可能成功」的兩種情況。像 `set_assignee` 指向不存在的人這種，系統
  沒有使用者名冊可比對，仍然檢查不出來——這不是遺漏，是這個系統目前沒有這項事實。
