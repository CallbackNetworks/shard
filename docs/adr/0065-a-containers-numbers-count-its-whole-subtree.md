# ADR-0065: 容器的數字要算到它底下的每一層

## Status
Accepted

## Date
2026-08-07

## Context

`contains` 是這個模型裡唯一的層級關係，而且它是泛型的：來源和目標都可以是任何型別的節點，只有 `detect_cycle` 會擋住成環。使用者要在樹狀圖的中間插一層——例如把三個專案收進一個自訂的 `area` 容器——資料層完全支援，`graphStructure.test.js` 甚至有一條測試明講「nested containers survive」。

問題出在讀取端。每一個讀 `contains` 的地方都只問了**任務那一半**：

```python
def contained_task_ids(db, project_id):
    tasks = task_type_keys(db)
    return [n.id for n in children_of(db, project_id) if n.type in tasks]
```

`enrich_project` 用它算 `progress` / `total_tasks`，`/api/nodes/{id}/contained-tasks` 用它餵容器頁的看板。兩者都會把「子節點是另一個容器」這件事整個丟掉——不是報錯，是安靜地當作不存在。實際後果是：

- 把一個專案收進新容器後，新容器的看板是空的，頁面還會說「No tasks in this container yet」；
- 那個容器底下的任務，也不會被算進更上層的進度；
- 插進去的那一層，在 UI 上沒有任何一個地方看得到。

也就是說，**一個合法、有測試覆蓋、會被 cycle 檢查保護的操作，做完之後東西會消失。**

唯一的例外是 goal。ADR-0041 讓 goal 帶上 container role 時，替它寫了 `goal_subtree_progress`——遞迴整棵子樹、只算 top-level 任務。正確的規則早就寫好了，只是被綁在一個型別上，其他每一個容器都讀不到它。

## Decision

**彙總的單位是子樹，不是直接子節點。**

1. `container_subtree_stats(db, container_id)` 成為唯一的規則（`graph/tasks.py`）：`done top-level tasks / all top-level tasks`，範圍是整棵 `contains` 子樹。`goal_subtree_progress` 改成呼叫它的別名——goal 只是一種容器，不該擁有自己的一份規則。

2. 只算 top-level 任務（父任務與其子任務不重複計）。這正是舊的每專案進度用的規則，所以**在沒有巢狀時，新舊數字完全相同**。這不是行為變更，是把原本算不到的情況補上。

3. 容器的子節點分成兩半，兩半都明講：`contained-tasks` 回答「這一層的板子上有什麼」，新的 `GET /api/nodes/{id}/subtree` 回答「這一層底下有什麼」——直接子容器，每個都帶自己的子樹彙總。兩者加起來涵蓋每一個 `contains` 子節點，這就是插進去的那層不再消失的原因。

4. `ProjectOut` 增加 `direct_task_count` / `child_container_count`。`direct_task_count` 必須用**和 total 同一條 top-level 規則**去數：實機資料上第一版沒有這麼做，於是一個直接掛在專案下的子任務讓 `direct` 大於 `total`，`total - direct`（「有多少工作在下一層」）變成負數。同一個問句的兩個數字，必須用同一把尺量。

5. 規則留在伺服器。前端不從畫面上看得到的任務重新推導進度——ADR-0056 的同一課：後端服務了一份規則、前端自己再算一次，就是兩份會分岔的真相。

6. `descendants_of` 改成一層一批查詢（`IN` 分塊），取代原本一個節點一次查詢的 BFS。200 個任務的容器原本要 200 次往返，那樣的成本沒辦法放進 `/api/projects` 這種列表端點——效能在這裡不是最佳化，是這個決定可不可行的前提。

## Consequences

正面：

- 在任何一層插入容器，上層的數字仍然完整，插進去的那層在頁面上看得到、點得進去。
- 一條規則、三個讀取端（專案頁、容器頁、goal）。往後多一種容器型別不必再多一份彙總。
- 專案頁與容器頁會明說「有 N 個任務在子容器裡」，數字和清單長度對不上時使用者知道為什麼。

代價與尚未解決的：

- `ProjectOut.total_tasks` 在有巢狀時的語意變了。任何拿 `tasks` 陣列長度去對 `total_tasks` 的客戶端會看到差異——`direct_task_count` 就是為了讓它們對得回來而存在。
- `/api/v1` 外部 API 這次沒有加上 subtree 端點；外部客戶端仍只看得到直接子任務。
- 專案進度這條規則在程式碼裡還有好幾份各自為政的拷貝（`share.py`、`search.py`、`external_api/helpers.py`、`external_api/stats.py`、`scheduler.py` 的摘要信、`notifier.py`），它們維持直接子節點的算法。goal 內的每專案細目已經改成共用規則（否則同一頁的總計與細目會互相矛盾），**其餘的收斂尚未做**——這是這條線上仍然存在的「同一個問題有多份答案」。
- `/api/nodes/{id}/subtree` 只回一層子容器（避免深樹回出無上限的 payload）。更深的層要逐層點進去。
- 樹狀圖的呈現仍然固定在 identity→project→task：只有 network 版面畫容器→容器，tree / sankey / territory 會把插進去的容器畫成兄弟卡片。**分層視覺化是這條線的下一步，本 ADR 未處理。**
- 目前也還沒有「插入一層」這個單一動作（建節點＋搬邊仍要在 `/n/{id}` 手動接拆邊）。
