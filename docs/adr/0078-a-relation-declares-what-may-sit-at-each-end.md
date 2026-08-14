# ADR-0078: 關係自己宣告兩端可以接什麼

## Status
Accepted

## Date
2026-08-14

## Context

起點是一個看起來很無害的問題：「為什麼 project 只能掛在一個父節點底下？」

答案是它本來就不只能掛一個——`contains` 是 `edges` 表裡的一列，天生多對多，沒有任何欄位限制數量。於是在 dev 環境上實際示範一次，想讓一個 project 同時出現在兩個容器底下。示範過程踩到三件事，這份 ADR 是那三件事的帳單。

**第一次嘗試：把 project 用 `contains` 掛到 identity「DevOps」底下。**

```
POST /api/nodes/{devops_id}/edges {"target_id": "<project>", "rel_type": "contains"}
→ 201 Created
```

然後畫面上什麼都沒有改變。因為 identity↔project 走的是 `member_of`，不是 `contains`。這條邊被完整地寫進資料庫、發了 `edge.added` 事件、進了 provenance 稽核軌跡，然後不被任何讀取路徑承認——**它是一個成功回應的 no-op**。

這正是 ADR-0060 那一類：規則存在（identity 沒有 `container` role，所以遍歷不會走它），但沒有任何時刻會執行那個規則。

**第二次嘗試：掛到 area「Frontend Squad」底下。**

```
→ 400 "adding contains edge ... would create a cycle"
```

這次擋對了——seed data 裡本來就有一條反方向的 `project --contains--> area`。防環檢查是 `add_edge` 裡**唯一**的語意檢查，而它只管環，不管兩端是什麼型別。

**第三次才成功**（goal → project），一條指令，兩個容器同時把那 8 個 task 算進自己的 subtree。

### 一個 agent 現在能知道什麼

這件事對人來說只是不方便，對 agent 來說是斷的。盤點 agent 手上實際有的資訊：

- `/api/v1/agent-context`（endpoint 自己的說明寫著「the first endpoint an AI agent should call」）對這整個主題只有一句：**「Relationships are edges.」**
- `/api/v1` **沒有** edge-types 清單。拿 API key 的 agent 連詞彙表都讀不到。
- 內部的 `/api/graph-types/edges` 只給四個欄位：`key`、`label`（"Member of"）、`is_containment`、`is_symmetric`。**沒有任何東西說哪種節點可以坐在線的兩端。**
- MCP 21 個工具**沒有一個能操作 edge**。agent 只能在建立節點時給一個 `container_id`。
- 猜錯不會失敗，回 201。

也就是說：agent 不是「不知道要選哪一個」，是**選錯了也沒有人告訴它**。

### 詞彙本身的兩個缺陷

盤點時另外撞到兩件與上面同源的事：

**`assigned_to` 是死詞彙。** registry 宣告了它（`graph_registry.py`），常數定義了它，資料庫裡 **0 筆**，後端**沒有任何一行程式寫它**——`grep` 只找得到常數定義和一句註解。而它的方向跟 `member_of` **相反**（`task → identity` vs `identity → project`）。同一件事（誰參與）有兩個方向的表達法，其中一個從來沒被用過。這正是最會讓 agent 猜錯的形狀。

**`member_of` 的名字讀反了。** source 是 identity，字面讀作「identity 是這個 project 的成員」，但系統實際的意思是「這個 project 屬於這個身分」——這是一個個人多身分工具，不是團隊成員名冊。寫這份 ADR 之前的示範裡，第一直覺就是去用 `contains`；人會猜錯的地方，agent 一定會猜錯。

### 那 `member_of` 到底需不需要存在

認真問過這一題，結論是需要，但理由不是「identity 是視角不是位置」那種說法——那是偏好，不是論證。真正的論證是：

**合併不會消除這個區別，只會把它從一個欄位搬到 N 個讀取點。**

「誰的」和「放在哪」是兩個獨立的軸。示範用的那個 project 同時屬於兩個 identity，**而且**放在 Platform Group 底下。三條線如果都是 `contains`，那個節點的 parents 就是兩軸混編的一串，每個畫樹或做 rollup 的地方（結構圖、麵包屑、containers 頁、subtree 統計）都得靠「檢查型別是不是 identity」把它拆回來。ADR-0068 才剛把「專案多大」的 11 份實作收成一份，這等於反方向再開一次同樣的洞。

具體代價還有：identity 一旦拿到 `container` role，`delete_container` 的級聯就會套上去——**刪一個身分會連帶刪掉它底下的專案**。現在刪身分只是拆線。

## Decision

### A. 關係型別自己宣告兩端可以接什麼

`edge_types` 加三欄，與 ADR-0074 對 `node_types.fields` 做的事同構——**能力寫成資料，不是寫成程式裡的分支**：

- `description` — 一句話說明何時該用它，寫給人也寫給 agent。
- `allowed_source` / `allowed_target` — `{"types": [...], "roles": [...]}`，兩個鍵都是「任一符合即可」，欄位為 `null` 表示不限制。

用 `roles` 而不是只用 `types`，是為了讓使用者自訂的型別自動適用：一個宣告了 `container` role 的自訂型別，不必修改任何 seed 就能當 `contains` 的來源。

built-in 的宣告種在 `graph_registry.py`，就放在 `roles` 和 `fields` 旁邊。**`seed_builtin_types` 只補缺少的型別、從不覆寫**（ADR-0074 記過這個坑），所以既有資料庫一律靠 migration 回填。

### B. `add_edge` 依宣告驗證，錯誤訊息直接說出正確答案

檢查放在 `graph.add_edge`——防環檢查已經在那裡，這是加在它旁邊，於是內部寫入、`/api/nodes/{id}/edges`、`/api/v1/nodes/{id}/edges` 三條路一次全部有效（兩個 router 早就把 `ValueError` 轉成 400）。

規則兩條：

1. `is_containment` 的關係，**若 source 的型別宣告了 role，就必須包含 `container` 或 `task`**。identity 宣告的是 `shareable`/`subscribable`，從來不含容器 role，所以它不能當父節點。**沒有宣告任何 role 的型別不受此限**——那是 ADR-0033 留下的自由圖，node explorer 讓使用者把任意自訂型別互相巢狀，這裡不能順手把它砍掉。第一版的規則寫成「source 一律必須是 container 或 task」，被既有測試（`test_non_task_like_custom_type_not_a_subtask`）當場擋下，那個測試是對的：**宣告 role 等於表態自己是什麼形狀，沒宣告的型別沒有表態，就不該被追究**。
2. 有宣告 `allowed_source` / `allowed_target` 的，兩端型別必須符合。這是宣告，不是安全網，所以嚴格比對、沒有上面那條豁免。

`contains` 因此**不帶** `allowed_source`——它由第 1 條約束，而那條的內容寫在它的 `description` 裡給人和 agent 讀。

關鍵在錯誤訊息：擋下來的時候，**回頭問 registry「有沒有別的關係接受這一對端點」，把答案寫進訊息**：

```
identity -> project is not valid for 'contains'
(a contains source must be a container or a task); use 'owns' instead
```

這是這份 ADR 裡最有效的一塊。agent 不需要事先讀懂詞彙表——**它一定會讀錯誤訊息，但不一定會讀文件**。

### C. `member_of` 更名為 `owns`，`assigned_to` 裁撤

`owns`（`identity → container`）方向與字面一致。migration 同時改 `edge_types` 的鍵與既有 26 筆 `edges.rel_type`。

`assigned_to` 從 registry 與常數刪除，migration 只在它確實 0 筆使用時刪除該列——**沒有人用過的詞彙，留著只會被猜到**。日後若真的需要「task 指派給誰」，那時再設計，方向要與 `owns` 一致。

### D. 詞彙表送到 agent 手上

- 新增 `GET /api/v1/edge-types`：key、label、description、兩端宣告、`is_containment`。
- `/api/v1/agent-context` 的 `conventions.relations` **從同一份 registry 生成**，不是手寫第二份——手寫的那份三個月後就會跟程式碼不一致。
- MCP 補上 `manage_edges`（list/attach/detach）與 `list_edge_types`。`rel_type` 的列舉值由 registry 供給；SDK 2.0 之下簽名即 schema（ADR-0077），寫錯就是協定錯誤，不是一個內容寫著 error 的成功回應。

### E. 宣告必須與既有資料相符，由測試盯著

`tests/test_edge_semantics.py` 掃過資料庫裡**每一條邊**，斷言它滿足自己型別的宣告。這道測試的用途是防止宣告寫得比現實嚴格——寫這份 ADR 時就是先把 dev 資料庫裡實際存在的 13 種 `(rel_type, source_type, target_type)` 組合抓出來，才決定宣告內容的。

## Consequences

正面：

- 選錯關係從「201 + 靜默無效」變成「400 + 告訴你該用哪一個」。這是 agent 與人都會撞到的那一面。
- `is_containment` 這個旗標第一次真的有作用。以前它只是給前端分組用的顯示屬性。
- 詞彙表對外部 agent 可讀（`/api/v1/edge-types`），且 `agent-context` 的說法由 registry 生成，不會與程式碼漂移。
- 自訂節點型別自動適用：宣告 `container` role 即可成為 `contains` 的來源，不需要改 seed。
- 死詞彙 `assigned_to` 消失，猜錯的機會少一個。

負面：

- `owns` 是破壞性更名。外部呼叫者若寫死 `member_of`，會拿到 422「unknown edge type」。沒有保留別名——保留別名等於同一個關係有兩個名字，正是這份 ADR 要消除的東西。破壞在 `/api/v1` 是真的，這裡選擇承擔：目前的外部使用者只有自己的 agent。
- `add_edge` 每次多查節點型別與 role。已用單次查詢取兩端型別 + 一次 registry 讀取，但批次寫入大量邊的路徑（import、backfill）會感覺得到。
- 宣告是「允許清單」，不是完整的型別系統：它管得住兩端的型別，管不住基數（一個 task 可以有幾個 `in_cycle`）。基數規則目前仍散在各自的呼叫端。
- seed data 裡那條方向可疑的 `project --contains--> area` 仍然合法（project 有 container role）。宣告不會替你判斷語意上合不合理，只判斷型別上允不允許。
