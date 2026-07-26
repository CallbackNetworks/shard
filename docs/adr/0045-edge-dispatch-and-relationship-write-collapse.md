# ADR-0045: 關係寫入收斂到 edge dispatcher，並讓 `task.label_added` 真正生效

## Status
Accepted

## Date
2026-07-26

## Context

ADR-0040 到 ADR-0043 把**節點**的寫入收斂成單一入口（`/api/nodes`），並用
`services/graph_dispatch` 的角色驅動 dispatcher 保證「同一個狀態轉換 = 同一組副作用」，
無論是哪個 URL 造成的。ADR-0044 再把 task pipeline 的旁路全部接回來。

但**關係**（edge）從來沒有做過同樣的收斂。同一條 edge 有兩種寫法：具名子資源
（`/tasks/{t}/labels/{l}`、`/cycles/{c}/tasks/{t}`、`/tasks/{t}/dependencies/{d}`、
`/tasks/{t}/memberships/{p}`）與泛用的 `/nodes/{id}/edges`。稽核後的實際行為：

| 寫入路徑 | 外部同步 | activity | broadcast |
|---|---|---|---|
| `POST /tasks/{t}/labels/{l}`（內部） | 無 | 無 | **無** |
| `POST /v1/projects/…/labels/{l}`（外部） | 無 | 有 | 有 |
| `POST /cycles/{c}/tasks/{t}` | milestone 同步 | 無 | **無** |
| `POST /tasks/{t}/dependencies/{d}` | 無 | 無 | **無** |
| `POST /tasks/{t}/memberships/{p}` | 無 | 有 | 有 |
| `POST /nodes/{id}/edges`（泛用） | 無 | 無 | **無** |
| `PATCH /bulk`（label 欄位） | 無 | 無 | 彙總事件 |
| assistant `manage_labels` | 無 | 無 | **無** |

同一件事（「這個 task 被貼上了 bug 標籤」）依照呼叫的路徑不同，會產生四種不同的
結果。其中四條路徑**完全不 broadcast**，所以在 A 分頁貼標籤、B 分頁永遠看不到 ——
這不只是整潔問題，是實際的跨分頁失效 bug。

更嚴重的是第二個發現：`task.label_added` 是 `rules_engine.SUPPORTED_TRIGGERS` 裡
公開的四個 workflow trigger 之一，前端的規則編輯器也讓使用者選它 —— 但**整個
codebase 從來沒有任何地方發出這個 trigger**。使用者可以建立一條「貼上 bug 標籤就
設為高優先」的規則、儲存成功、看起來一切正常，然後它永遠不會執行。同樣是 ADR-0044
描述的那種「靜默少做事」缺陷。

接著又牽出第三個：`_eval_condition` 的 `has_label` 分支用 `object_session(task)`
取得 session。但 ADR-0033 之後 `run_rules` 收到的是 `TaskView`（非 mapped 物件），
`object_session` 會直接拋例外，被 `run_rules` 的 try/except 吞掉並降級成「整條規則
失敗」。也就是說**任何使用 `has_label` 條件的 workflow rule 在正式環境從來沒有成功
評估過**；單元測試看不出來，因為它直接傳入 mapped 的 `Node`。

## Decision

**一、新增 edge dispatcher，關係反應由 `rel_type` + 端點角色決定。**

`services/graph_dispatch` 增加 `dispatch_edge_added` / `dispatch_edge_removed`，
與既有的 `dispatch_node_*` 對稱。反應綁在關係的語意上，不綁在路由上：

- `labeled` → 寫 activity → 跑 `task.label_added` rules → 外部 label 同步 → broadcast
- `in_cycle` → milestone 同步 → broadcast
- `depends_on` → broadcast **兩端**（blocked/blocking 兩邊的視圖都變了）
- `contains` 且 target 具 task 角色 → membership activity → broadcast
- 其他 → 泛用 `node.linked` / `node.unlinked` 事件

`commit=False` 讓批次呼叫端持有交易，`broadcast=False` 讓批次呼叫端改發一個彙總
事件 —— 與 `task_mutations` 既有的慣例一致。

全部 12 個關係寫入點改為呼叫 dispatcher：內部 labels / cycles / tasks
（dependencies、memberships、file-into-project）、`/nodes/{id}/edges`、對外 v1 的
labels / dependencies / nodes，以及 bulk 與 assistant 的標籤操作。

**二、`task.label_added` 由 edge dispatcher 發出。**

這是唯一沒有節點層對應物的 trigger —— 它本質上就是一個 edge transition，所以它的
家在 edge dispatcher，不在 `task_mutations`。ADR-0044 的
「`run_rules` 只能從 `task_mutations` 呼叫」因此放寬為「只能從 dispatcher 呼叫」，
允許的集合明確列出這兩個檔案。

規則動作本身（`_exec_action` 裡的 `add_label` / `remove_label`）**不**經過
dispatcher，維持與 task pipeline 相同的處理：規則的動作是在一次 dispatch 內部執行
的，再 dispatch 一次就會遞迴。

**三、修正 `has_label` 的 session 取得方式。**

`_eval_condition` 增加選用的 `db` 參數，由 `run_rules` 明確傳入；`object_session`
降為 fallback（保留直接傳 mapped `Node` 的呼叫方式）。

**四、guard test 擴充到關係寫入。**

`tests/test_task_pipeline_guard.py` 新增對稱的第二組檢查：直接呼叫
`graph.set_label` / `unset_label` / `add_to_cycle` / `remove_from_cycle` /
`add_edge` / `remove_edge` 的模組，同一檔案內必須也出現 dispatcher 呼叫。豁免清單
`EDGE_ALLOWED` 同樣逐項寫明理由，並且會在「已不再寫 edge」**或**「已經改成會
dispatch」時判定為過期 —— 後者是 ADR-0044 版本沒有的檢查，避免豁免清單留下已經
不需要的項目。

豁免只有三項，都是語意上不該 dispatch 的：rules_engine（動作在 dispatch 內部執行）、
issue_sync（inbound 方向，再同步回去會形成 echo 迴圈）、imports（在
`finalize_task_create` 宣告 task 誕生之前先掛好 label）。

## Consequences

**正面**

- 關係寫入的行為與路徑脫鉤：貼標籤就是貼標籤，不管是 UI、agent、外部 API 還是
  泛用 edge 端點寫的，副作用完全一致。
- 修好四條路徑完全不 broadcast 造成的跨分頁失效。
- `task.label_added` workflow trigger 從「UI 上可選但永不執行」變成真的會執行。
- `has_label` 條件從「正式環境永遠讓整條規則失敗」變成正常運作。這同時也讓
  `has_label` 之外的條件不再被同一條規則的例外拖累。
- 具名子資源與泛用 edge 端點現在是同一件事的兩種寫法，而不是兩套語意。這讓未來
  真的要淘汰具名子資源時只是刪路由，不需要搬行為。
- guard test 讓「新增 edge 寫入點但忘了 dispatch」在 CI 就被擋下，錯誤訊息直接說明
  該呼叫什麼。

**負面 / 取捨**

- 標籤操作現在會寫 activity 並可能觸發 workflow rules。大量貼標籤（尤其 bulk）的
  activity 量與耗時都會上升。bulk 以 `commit=False, broadcast=False` 吸收了交易與
  事件成本，但 rules 仍逐筆評估。
- `task.label_added` 開始生效意味著**既有的、使用者早就建立但從未執行過的規則會突然
  開始跑**。這是修好而非改變行為，但對正在使用的資料庫來說是可觀察的變化。
- 對外 v1 label 端點的 activity 敘述由 `... via API` 改為統一句型，API key 名稱改由
  `actor` 欄位承載。與 ADR-0044 對 PR 敘述做的取捨相同：可讀性略降，換得格式一致。
- `run_rules` 的允許呼叫端從一個變成兩個。這是刻意的：trigger 依其本質分屬節點層與
  關係層兩個 dispatcher，硬要塞進同一個檔案只會讓 `task_mutations` 承擔它不擁有的
  語意。guard test 以明確集合（而非「數量上限」）固定這一點，第三個呼叫端會失敗。
- guard test 與 ADR-0044 一樣是檔案粒度的字串比對，抓不到同檔案內某一條分支漏跑。
