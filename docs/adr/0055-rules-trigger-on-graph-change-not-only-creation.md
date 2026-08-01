# ADR-0055: 規則的觸發詞彙涵蓋圖的變化，不只誕生

## Status

Accepted

## Date

2026-08-01

## Context

ADR-0049 把 `task.created` 收斂成 `node.created`，讓規則對每一種節點觸發。但那次只泛化了
**一個**觸發點。清點今天的 `SUPPORTED_TRIGGERS`：

```python
["node.created", "task.status_changed", "task.label_added", "task.priority_changed"]
```

四個裡有三個仍然是 task 專用的。對照 dispatcher 這一側：

| dispatcher | 觸發規則？ |
|---|---|
| `dispatch_node_created` | 是（`node.created`） |
| `dispatch_node_updated` | **否**（只有 task 分支經由 `apply_task_update` 觸發兩個 `task.*`） |
| `dispatch_node_deleted` | **否** |
| `dispatch_edge_added` | 只有 `labeled` 一種邊，而且只有加上的時候 |
| `dispatch_edge_removed` | **否** |

也就是說：**規則只認得節點的誕生，不認得它之後的任何變化**（task 的兩個欄位除外）。
「專案被歸檔時通知我」「某個節點被掛進某個容器時做某事」「刪掉一個容器時留下稽核事件」
這些規則今天寫不出來——不是寫了不會動，是編輯器裡根本沒有那個選項。

這跟 ADR-0047→0054 修的缺陷不同：`task.` 開頭的名字誠實地說了自己只管 task，沒有騙人。
這是**功能缺口**，但它的形狀值得注意——三個 task 專用的觸發，其實是圖上兩件事的特例：

- `task.status_changed` / `task.priority_changed` = 節點的**欄位變了**
- `task.label_added` = 一條 `labeled` **邊被加上**

系統早就是 node/edge 模型（ADR-0032），只有規則的觸發詞彙還停在遷移前的形狀。

## Decision

**一、觸發詞彙就是圖本身的事件。**

```python
SUPPORTED_TRIGGERS = ["node.created", "node.updated", "node.deleted", "edge.added", "edge.removed"]
```

三個 `task.*` 觸發退場，由 Alembic 改寫成等價的條件（見第五點）。理由與 ADR-0049 相同：
特例化的觸發名是一份會漏的清單。`task.status_changed` 存在而 `project.status_changed`
不存在，不是因為後者沒有意義，是因為沒有人去加——而「沒有人去加」在一份列舉裡看不出來。
五個泛用觸發沒有這個問題：任何節點、任何欄位、任何邊，都已經被涵蓋。

**二、條件新增四個描述「這次變化」的欄位。**

| 欄位 | 適用觸發 | 意義 |
|---|---|---|
| `changed_field` | `node.updated` | 這次變動的欄位集合（集合成員判斷） |
| `edge_type` | `edge.*` | 邊的 `rel_type` |
| `edge_side` | `edge.*` | 主體是這條邊的 `source` 還是 `target` |
| `other_type` | `edge.*` | 邊另一端節點的型別 |

原本的七個欄位描述**主體現在是什麼**，這四個描述**剛剛發生了什麼**。兩者都需要：
「狀態變成 done 時」是 `changed_field eq status` + `status eq done`。

`changed_field` 與既有的 `has_label` 同屬集合欄位，共用一組語意：`eq`/`in` 判斷成員、
`neq` 判斷不在其中。順帶修掉 `has_label` 的一個既有錯誤——它完全忽略 `op`，
所以 `has_label neq urgent` 在任務**有** urgent 標籤時回傳 true。

**三、邊事件在兩端各觸發一次。**

一條邊是關於兩個節點的事實，兩端都可能要反應。主體是該端節點，`edge_side` 說明是哪一端。
只對 `source` 觸發的話，「任務被加進某個容器」就永遠寫不出來（`contains` 的 source 是容器，
target 才是任務）——而這正是最常見的需求之一。

代價是一條沒有任何條件的 `edge.added` 規則會為同一條邊跑兩次。這是可接受的：條件不成立時
引擎什麼都不留（連跳過紀錄都沒有），而遷移後的規則都帶著 `has_role eq task`，自然只在對的
那一端成立。

節點**建立時**一併寫入的 `contains` 邊不另外觸發 `edge.added`——那個時刻由 `node.created`
負責，兩個都發等於同一件事講兩次。同理，刪除節點時連帶消失的邊不觸發 `edge.removed`，
由 `node.deleted` 涵蓋。

**四、`node.deleted` 上，除了 `fire_event` 以外的動作一律**可見地**跳過。**

主體在刪除**之前**交給引擎（那時它還在），但對一個即將消失的節點設欄位、貼標籤、寫留言都是
沒有意義的寫入。新的跳過原因 `node_deleted` 循 ADR-0050 的形狀：做不到的時候留下痕跡。

這個判斷寫在 `predict_outcome` 裡（它因此多收一個 `trigger` 參數），所以預演、存檔警告、
實際執行三邊自動一致——ADR-0054 的整個重點。特別是：一條 `node.deleted` 規則若所有動作都是
task-only，那是「對任何主體都不可能成功」，`rule_warnings` 在**存檔當下**就說得出來。

另外，刪除 task 時規則寫下的活動紀錄不掛 `task_id`，只掛專案：`delete_task_tree` 會清掉
指向該任務的紀錄，掛上去等於寫完就被刪掉。

**五、既有規則由 Alembic 等價改寫，不留相容分支。**

| 原本 | 改寫成 |
|---|---|
| `task.status_changed` | `node.updated` + `changed_field eq status` |
| `task.priority_changed` | `node.updated` + `changed_field eq priority` |
| `task.label_added` | `edge.added` + `edge_type eq labeled` |

三者都再補上 `has_role eq task`（若尚未存在），與 ADR-0049 的處理一致：新觸發比舊觸發寬，
不補條件的話規則會**悄悄擴大**適用範圍。

**六、觸發與條件的相容性在寫入時驗證，回 422。**

`node.created` + `changed_field eq status` 是一條永遠不會成立的規則。這與 ADR-0054 的
「警告而非拒絕」不衝突，兩者的分界是：**警告描述世界**（標籤現在不存在，明天可能存在），
**422 描述規則本身**（這個觸發不可能帶著這個欄位，明天也不會）。世界會變，規則的自相矛盾不會。

**七、預演對「取決於變化」的條件回答 null，不回答 false。**

dry-run 只有一個節點，沒有「剛剛發生了什麼」。把 `changed_field` 當成不成立會讓每一條
`node.updated` 規則的 TEST 都顯示「不會觸發」——正是 ADR-0054 剛修掉的那種假答案，
只是換了個方向。因此 `conditions_met` 的每一項是 `true | false | null`，`would_fire`
在有 null 而無 false 時也是 `null`（「要看那次變化」），而動作預測照樣算給使用者看。

## Consequences

正面：

- 規則能回應圖上的任何變化，而不只是誕生。`dispatch_*` 五個進入點現在全部觸發規則，
  「哪些變化會觸發規則」不再是一份要人去記得維護的清單。
- 三個 task 專用觸發變成兩個泛用觸發的特例，少了三個各自維護的路徑。
- 同時改了 status 和 priority 的一次更新，現在觸發**一次** `node.updated`
  （`changed_field` 是集合），而不是像過去那樣把同一條規則跑兩遍。
- `has_label neq` 修好了。

負面與代價：

- 觸發名稱是破壞性變更。既有規則由 migration 改寫，但任何外部持有 `task.status_changed`
  這個字串的東西（腳本、匯入的規則 JSON）會在寫入時被 422 擋下。這是刻意的：安靜接受一個
  不會觸發的規則，正是這一系列 ADR 在修的東西。
- 邊事件兩端各觸發一次，規則評估次數加倍。條件不成立時只是一次條件判斷，成本可忽略；
  但一條無條件的 `edge.*` 規則會執行兩次，這在編輯器裡看不出來。
- `node.updated` 比 `task.status_changed` 寬得多：它對**每一種**節點的**每一個**欄位變化
  評估所有相關規則。規則數量以個位數計，可接受。
- 分享門面的寫入（mint share token、設 PIN）走 `graph.update_node` 而不經
  `dispatch_node_updated`，因此不觸發 `node.updated`。這是刻意的：那不是使用者概念裡的
  「節點被修改」，而且會讓稽核類規則被 token 操作洗版。
- `edge_side` / `other_type` 讓條件欄位從 7 個增加到 11 個，編輯器的下拉選單變長；
  只有在選定觸發後才顯示相容的欄位，稍微緩解但沒有消除這件事。
