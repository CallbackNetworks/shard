# ADR-0158: 一個數字要當成一個數字去要

## Status
Accepted

## Date
2026-09-10

## Context

使用者回報：在正式站跳轉到某個節點（`CGCG`，一個 `organization`）要等很久，「起碼快 10 秒」。

實測正式站（登入後用瀏覽器量，非 API 直打）：

| | |
|---|---|
| 節點頁自己的六個請求，併發 | **0.40s** |
| `GET /api/projects` 單獨 | **1.5s 熱 / 3.6s 冷，327KB** |
| 兩者同時 → 節點頁變成 | **1.9s** |
| `/c/{id}` 整頁載入 | 0.9–2.9s |

節點頁本身不慢。慢的是 `GET /api/projects`：它對每個專案跑 `enrich_project`，把**全部任務、標籤、cycle、identity 整包內嵌**回傳。dev 資料庫量到 58 個專案 = **1579 次 SQL、1.6 秒**；正式站 25 個專案 / 242 筆任務 = 327KB。那段期間後端被佔滿，同頁其他請求排在後面。

問題不在它慢，而在**誰需要它**。掃過全部十個 `qk.projects()` 的消費端，真正讀 `project.tasks` 的**只有一個**：`GlobalActivityTicker`。（`CommandPalette` 的 `.tasks` 來自 search 端點，`Goals` 的來自別處，`Dashboard` 只讀 `.color` / `.id` / `.status`。）

而 ticker 拿那 327KB，是為了算三個整數：

```js
const tasks = projects.flatMap(getProjectTasks)
const overdue    = countOverdue(tasks, now)
const failed     = tasks.filter(t => t.status === 'failed').length
const highActive = tasks.filter(t => t.priority === 'high' && !['done','failed'].includes(t.status)).length
```

伺服器早就在算了。`GET /analytics/overview` 用四個 `COUNT` 算出同一批數字，其中 overdue 走的是 `graph.overdue_clause()` —— ADR-0089 訂的那個唯一定義。所以現況是：**ticker 在瀏覽器裡重算了一次伺服器已經算好的東西**，用的是 `utils/overdue.js`，也就是 ADR-0089 明文只允許存在一份的那條規則的第二份實作。它躲過了 `tests/test_overdue_agreement.py`，因為那個守門測試問的是伺服器的每一個回報面，而這一份活在客戶端。

而且它掛在 layout 裡（`App.jsx`），所以**每一頁都跑**，外加 `refetchInterval: 60000` 每分鐘再跑一次。

第二件事在收尾時浮出來：`overview` 有**兩份實作**，內部 router 一份、v1 router 一份，除了 v1 多做 API key 範圍限縮之外逐行相同。當下沒有壞 —— 正是 ADR-0070 說的那種狀態：還會動的重複沒有失敗徵狀。但它馬上就要壞了，因為這個 ADR 要加兩個欄位。

## Decision

**ticker 改成跟伺服器要那三個數字，不要整包下載。**

`analytics_admin.overview(db, *, project_ids=None)` 收下兩份實作，兩個門都呼叫它；`project_ids=None` 代表不限縮。新增兩個計數 `failed_tasks`、`high_priority_active_tasks`，跟既有七個一起，一次加在一個地方。

「還在進行中」用 `graph.open_status_clause()`，不是 `notin_(CLOSED_STATUSES)`。`Node.status` 可為 NULL，SQL 的三值邏輯會把 NULL 列從 `NOT IN` 裡丟掉（ADR-0142），而 Python 和 JavaScript 版本的同一條規則會留著 —— 正式站有十筆這種列。用錯的那個寫法，ticker 會報出比看板小的數字，而這正是 ADR-0089 存在的理由。

`GlobalActivityTicker` 改讀 `getAnalyticsOverview()`，刪掉 `getProjects` / `countOverdue` / `getProjectTasks`。

**沒有做的事**：`GET /api/projects` 的形狀不動。它現在沒有任何消費端讀 `tasks` 了，但那是另一個決定，要有自己的 ADR 和自己的量測 —— 這一刀先讓那個端點從「每一頁都載入」變成「只有需要它的頁面才載入」。

## Consequences

- 節點頁、容器頁和其他非 Dashboard 的頁面**完全不再請求 `/api/projects`**。那 1.5–3.6 秒和 1600 次 SQL 從每一次跳轉的路徑上消失。
- ticker 的三個數字的**範圍改變了**，而且是往對的方向。舊的做法數的是「專案的直接子任務」（`contained_task_ids` 只回傳直接子節點，子任務掛在母任務下所以數不到）；新的數的是每一個 task-role 節點，跟 Dashboard、分析頁、以及 ADR-0089 的守門測試問到的是同一批。也就是說 ticker 從今天起才真的跟其他畫面一致。
- `overview` 的回應多了兩個欄位。這是加法，既有消費端不受影響；v1 那一份也一起拿到 —— 這正是收成一份的目的。
- `tests/test_overview_has_one_implementation.py` 列舉全部九個欄位並把兩個門的回應對比相等。欄位清單是手寫的：加了計數卻沒加進清單就不會被測到，這是這個守門測試的已知邊界。
- `GlobalActivityTicker.test.jsx` 斷言 `getProjects` **沒有被呼叫**。這是這次真正需要守的那一半 —— 回歸的話畫面上的數字仍然是對的，沒有任何視覺徵狀。
- 使用者回報的 10 秒**沒有被完整重現**：從機房量最壞是 2.9 秒。這一刀拿掉了量得到的最大一塊，但剩下的差距還沒有解釋。已知的其他嫌疑，都還開著：
  - `useRealtimeSync` 收到任何 `task.*` / `project.*` WebSocket 事件就 invalidate `['projects']`，所以有 agent 在寫入時，瀏覽器會反覆重抓。這一刀讓重抓的頁面少很多，但 Dashboard 仍在其中。
  - `scheduler._run_tick` 在 event loop 上直接跑同步 DB 查詢（只有寄信用了 `to_thread`），每小時一次外加每日備份。跑的時候整個後端凍住，不分執行緒。
  - `nodes/{id}/subtree` 對 CGCG 要 **148 次查詢**（21 個容器各自跑一次 `descendants_of`），`contained-tasks` 每筆任務 **14.6 次**。兩者都是既有批次機制沒接上，不是新問題。
