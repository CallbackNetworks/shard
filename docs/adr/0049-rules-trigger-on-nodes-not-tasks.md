# ADR-0049: 規則的觸發從 task 收斂到 node

## Status

Accepted

## Date

2026-07-30

## Context

ADR-0032 之後，這個系統裡所有的第一類實體都是 node，關係都是 edge，而且 ADR-0040 讓型別由
使用者在執行期定義、能力由 `roles` 決定。規則引擎沒有跟上這個轉變。

`SUPPORTED_TRIGGERS` 的四個值全部是 `task.*`，`run_rules` 只從兩個地方被呼叫：
`task_mutations`（task 角色的節點）與 `graph_dispatch` 的 `REL_LABELED` 分支。實際邊界是：

- 有 task 角色的自訂型別**會**進規則引擎——這部分是通的，ADR-0040 的 role 閘門已經處理好了。
- 沒有 task 角色的節點（decision、goal、custom container、label、cycle）**完全不進**規則引擎。
- 條件欄位是五個寫死的 task 欄位，讀不到節點的型別、角色，也讀不到任何 edge。

也就是說：圖模型是開放的，自動化卻只認得圖上的一種節點。使用者可以定義一個
`decision` 型別，卻沒有任何辦法說「當一個 decision 被建立時，通知我的外部系統」。

同時 notifier 是 project-scoped 的：`_deliver` 需要一個 `ProjectView` 才能組 payload 並挑出
訂閱者，`fire_notifications` 是靠 `project_of_task` 取得它的。這代表就算讓規則在非 task 節點上
觸發，它唯一真正泛用的動作（`fire_event`）也送不出去——會變成一個每個動作都靜靜跳過的觸發時機，
正是 ADR-0047／0048 一路在消滅的那一類缺陷。

## Decision

**一、觸發時機以 node 為單位：`node.created` 取代 `task.created`。**

`dispatch_node_created` 對**每一種**節點呼叫 `run_rules`，不再只有 task 角色的。
`task.status_changed` / `task.priority_changed` / `task.label_added` 這三個暫時保留原樣
（見下方「未做的部分」），因為它們對應的是欄位與邊的變化，泛化需要另一組詞彙。

**二、條件新增兩個 graph-native 欄位：`type` 與 `has_role`。**

`type` 比對節點的型別鍵，`has_role` 比對 ADR-0040 的角色詞彙。原本五個欄位保留，並改成
從節點泛型讀取（`status` / `priority` / `title_contains` 對任何節點都有意義；`assignee`
存在 task 的 `data` 裡，非 task 節點讀到 None，條件自然不成立）。

`has_role` 是這次遷移的關鍵：既有的 `task.created` 規則會被改寫成
`node.created` + `has_role eq task`，行為完全不變。用角色而不是列舉型別鍵，是因為型別是
執行期資料——列舉會在使用者新增一個 task-like 型別時悄悄漏掉它。

**三、動作依角色分成兩類，而且跳過時是看得見的。**

- 任何節點都能執行：只有 `fire_event`。
- 只有 task 角色能執行：其餘全部（`set_status`、`set_priority`、`set_assignee`、
  `add_label`、`remove_label`、`add_comment`）。

`set_status` / `set_priority` 看起來像是泛用的——任何節點都有 `status` 欄位——但它們的
**值域**是 task 形狀的：`ACTION_VALUE_ENUMS` 只收 `todo/in_progress/done/failed`，
schema 在寫入時就會擋掉專案的 `archived`。也就是說，即使允許它們作用在非 task 節點上，
能寫進去的也只有一組對那個節點沒有意義的值。要真正泛化，得先讓狀態值域由型別決定，
那是另一個決策。

在非 task 節點上遇到 task-only 的動作時，**不是安靜地跳過**：寫一筆 `rule.skipped` 活動紀錄
說明是哪條規則、哪個動作、因為節點沒有 task 角色。這是本模組反覆出現的缺陷的解法形狀——
無法執行時要留下痕跡，而不是回傳「什麼都沒發生」。

**五、整套規則詞彙由後端提供：`GET /workflow-rules/vocabulary`。**

原本只提供 triggers（ADR-0048），但這次新增了兩個條件欄位，前端那份寫死的
`CONDITION_FIELDS` / `CONDITION_OPS` / `ACTION_TYPES` 就會漏掉它們——同一個缺陷換個位置。
端點改成回傳引擎的全部詞彙（含 `task_only_actions`），編輯器渲染它回傳的東西。
schema 驗證的也是同一組常數，所以編輯器提供的選項在建構上就是引擎認得的。

**四、notifier 的 project 作用域改成選擇性。**

`_deliver` 的 `project` 變成 `ProjectView | None`，並新增 `fire_node_notifications`：
以節點最近的容器作為作用域，沒有容器時 payload 省略 `project`、改帶 `node`，並且只有
未指定專案的（全域）整合會收到。這沿用 ADR-0047 已經為 `task` 做過的判斷——缺少的鍵就省略，
不要塞一個假的佔位值。

## Consequences

正面：

- 自動化終於和圖模型同一個形狀：使用者自訂的型別不必先取得 task 角色，也能被規則接到。
- 遷移用 `has_role` 而不是型別列舉，所以之後新增的 task-like 型別會自動落入既有規則的範圍。
- 通知的作用域從「一定屬於某個專案」放寬成「有容器就用容器」，補上非 task 節點原本無處可送的洞。
- 規則跳過動作時會留下 `rule.skipped`，不再是沉默的空集合。

負面與代價：

- **這是既有規則的行為變更，靠 Alembic 遷移吸收。** 遷移必須正確，否則使用者的線上自動化會
  在毫無徵兆的情況下擴大觸發範圍（例如對每一個新建的 label 節點執行）。遷移對每一條
  `task.created` 規則前置 `has_role eq task`，並在 downgrade 時還原。
- `node.created` 對每一種節點觸發，包含 label 與 cycle 這類使用者不見得認為是「東西」的節點。
  這是刻意的（圖上沒有二等節點），但寫規則時必須自己加型別條件，否則範圍比預期大。
- 觸發詞彙暫時是不對稱的：一個 `node.*` 加三個 `task.*`。這是明知的取捨——
  把欄位變化與邊變化也泛化（`node.updated` 帶「哪個欄位變了」、`edge.added` 帶 `rel_type`）
  是另一組詞彙、另一次遷移，留給後續的 ADR。
- 每次建立任何節點都會查一次規則表。規則數量是個位數到數十條，成本可忽略。
