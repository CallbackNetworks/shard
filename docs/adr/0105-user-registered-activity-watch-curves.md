# ADR-0105: 活動跑馬燈下面的曲線可以自己註冊

## Status

Accepted

## Date

2026-08-19

## Context

活動跑馬燈(`GlobalActivityTicker.jsx`)固定在畫面最下方的那條 `kt-signal-timeline`，畫的是一條「全部活動」的熱度曲線——不分是哪個專案、哪個節點、哪種型別，全部混在一起。使用者的回饋是這條曲線「有點沒什麼用」：一個人同時關注好幾個專案或好幾種節點型別時，全部疊在一起的總數看不出任何一條線自己在做什麼，曲線的形狀只反映「整個系統最近忙不忙」，不反映使用者真正想盯的那件事。

資料面比想像中好處理。`ActivityLog` 本來就帶著能定位「這筆紀錄是關於誰」的欄位：任務自己的活動記在 `task_id`；容器（專案／自訂容器）自己的活動連同底下所有任務的活動，都記在 `project_id`（`graph_dispatch.py` 的 `_generic_scope`）；其他型別（decision、goal 等）的活動則把自己的 id 放進 `meta.node_id`。這組「同一個 id 可能出現在幾個不同欄位裡」的模式，跟 `services/activity.py` 裡 `share_view_count` 用 `SHARE_VIEW_META_KEYS` 同時比對三個欄位是同一件事，是既有的先例。

唯一缺的是「這筆活動的節點現在是什麼型別」——這個資訊完全沒有被記下來。task 相關的 log（`task.status_changed`、`task.assigned` 等）連 `meta` 裡都沒有 type；只有非 task 的通用節點事件才在 `meta.type` 帶了型別。要做「依型別分曲線」，原本以為得在十幾個 `log_activity` 呼叫點都補上型別欄位，但其實不必：`task_id` 或 `meta.node_id` 已經是這筆紀錄的主體節點 id，而節點「現在」是什麼型別，直接查一次 `nodes` 表就有了，不需要在寫入當下就把型別凍結進 log 裡——而且用「現在」的型別比凍結當下的型別更符合語意：型別很少變，但真的改了，舊紀錄應該跟著新分類走，而不是卡在建立當下的分類。

## Decision

**不改 `activity_logs` 的表結構，只新增一張 `activity_watches` 表**，記錄使用者註冊了哪些曲線：`kind`（`"node"` 或 `"node_type"`）、`target_id` / `target_type`、`label`、`color`。`GET /activity` 在回應時多做一步：把每筆紀錄的主體 id（`task_id` 或 `meta.node_id`）批次去查 `nodes` 表目前的 `type`，附加成回應裡的 `node_type` 欄位——這不是 ORM 欄位，是路由層算出來的衍生欄位。

前端維持「一次抓一批原始活動紀錄、自己在 client 端分桶畫圖」的既有模式（`buildActivityHeat`），只是現在每一條註冊的曲線各自對同一批資料跑一次篩選：`kind="node"` 用 `task_id === target_id || project_id === target_id || meta.node_id === target_id` 三選一命中（跟 `share_view_count` 同一種「一個 id、多個可能欄位」的比對），`kind="node_type"` 用新附加的 `node_type === target_type`。所有曲線共用同一個時間窗（跟基準曲線的 `[minTime, maxTime]` 對齊），但各自對自己的峰值正規化高度——這樣一條冷門曲線不會因為跟熱門曲線共用同一把高度尺而被壓成一條看不見的平線。

顏色不開放使用者自訂：固定六色的小調色盤，依註冊順序輪流指定並存進那一列，跟 `--kt-status-*`／`--kt-prio-*`／`--accent` 這幾個已經被 ADR-0088 賦予固定意義的家族沒有交集。註冊入口是曲線圖下面新增的一排 legend chip 加一顆「+ WATCH」按鈕：選節點走 `NodeCombobox`（本來就是 `GET /nodes?query=&type=` 的通用節點搜尋，不限任務或專案，`MembershipPanel` 已經在用），選型別走 `GET /graph-types/nodes` 的下拉選單——兩個都是既有元件、既有端點，沒有新造一個搜尋介面。

這張表跟這組端點只掛在內部 `/api`，沒有開 `/api/v1` 或 MCP 工具。跟 ADR-0084/0091/0092 那批「補齊 agent 可達性」的東西不同類——那些補的是 agent 原本做不到、但人類在瀏覽器一次點擊就能做到的**能力**（觸發部署、管理憑證、發布 issue）；這裡註冊一條曲線純粹是使用者自己的畫面偏好，不影響資料、不是任何工作流程的一部分，跟量表板要不要顯示某張圖是同一類決定，不屬於 ADR-0093 `test_mcp_reach.py` 要顧的範圍。

## Consequences

正面：曲線圖從「一條看不出所以然的總數」變成使用者自己決定要盯什麼——可以同時看好幾個專案的活動有沒有同時卡住，也可以只看某個型別（例如所有 decision）最近動得勤不勤。新增的資料面很輕：一張新表、`GET /activity` 多一次批次查詢，`activity_logs` 本身完全沒有動、沒有遷移既有資料的問題。

負面與代價：`node_type` 是即時查出來的，不是寫入當下凍結的，所以一個節點被刪除之後，它自己那筆 `node.deleted` 紀錄的 `node_type` 會變成 `null`（`nodes` 表裡已經查不到它了）——這條紀錄對「依型別分曲線」的觀察者會消失，但對「依這個特定節點分曲線」的觀察者不受影響（`task_id`／`project_id`／`meta.node_id` 仍然比對得到，紀錄本身沒被刪）。這個落差目前接受不特別處理：一則節點已經不存在的刪除事件，究竟該算進哪個型別，本來就沒有唯一答案。另外，底部固定列高度變高了（新增一排 legend），`.kt-route-shell` 的 `padding-bottom` 跟著從 56px 調到 88px 才不會蓋到頁面內容；行動版（≤768px）直接隱藏這排 legend，維持原本的高度與 padding，避免小螢幕上再多擠一排。
