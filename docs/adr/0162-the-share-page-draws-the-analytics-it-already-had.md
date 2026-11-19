# ADR-0162: 分享頁畫出分析頁的圖，而且算的是同一份

## Status
Accepted

## Date
2026-11-19

## Context

分享頁是唯一給「不在場的人」看的頁面，卻只有四張數字卡和清單；同一份資料在分析頁有熱圖、狀態趨勢、燃盡、速度圖。要把圖搬過去，碰到兩件事：

1. **分析的計算已經有兩份。** 熱圖、狀態趨勢、速度在內部 `/api/analytics` 和 `/api/v1/analytics` 各寫了一遍（`analytics_admin` 的 docstring 自己承認 v1「carries its own copy of velocity」）。分享頁要第三份，就是 ADR-0087 的漂移：三個答案回答同一個問題。
2. **訪客沒有 session**，分享頁不能去打 `/api/analytics`；資料只能隨分享 payload 一起走。

頂端的跑馬燈也是同一類：它是 `::before` 的固定字串 `SHARED STATUS`，從來沒有動畫，也不帶任何資料。

## Decision

- 熱圖、狀態趨勢、速度收進 `services/analytics_admin`（`heatmap` / `status_trend` / `velocity`，以 `project_ids` 限定範圍），兩個 router 都改成呼叫它。另加 `heatmap_by_project` 給地形圖。
- 分享 payload 多一個 `analytics` 區塊：一年熱圖、30 天狀態趨勢、每個專案進行中衝刺的燃盡、每個專案的速度、每個專案的每日活動序列。**只算頁面會畫的 active 專案**，而且**排除 `share.viewed`**——訪客開頁不是工作，不該讓圖因為有人看而變高。分享助理（ADR-0098）因此也讀得到同一批數字。
- 前端把 `BurndownChart` / `VelocityChart` / `StatusTrendChart` 從 `Analytics.jsx` 抽到 `components/charts/`，分析頁與分享頁共用同一份元件。
- 新增 `TerrainChart`：每個專案一條山脊、近大遠小前後疊、內含等高線，讀起來像地形圖；分享頁窄螢幕自動改 13 週與窄畫布。`ActivityHeatmap` 在放不下時預設捲到今天（分析頁同受益）。
- 統計卡下方加「進行中清單」與「各專案狀態長條」；跑馬燈改成真元件，捲動最新活動，與 app 底部 ticker 共用 `hooks/useTickerLoop`。
- 分享 nav 多一個 `ANALYTICS`，條件與區塊本身相同。

## Consequences

- 分析計算從三份變一份；`test_share_analytics_agrees_with_the_analytics_page` 直接比對分享 payload 與分析 API 的輸出。
- 分享 payload 變大（一年熱圖最多 365 列），也進了分享助理的 system prompt；以個人工具的量級可接受，若要瘦身，先砍熱圖範圍。
- 分析頁本身還沒有地形圖：它需要一個回傳「每專案序列」的端點，`heatmap_by_project` 已在服務層，差一個路由。
- 寫 `TerrainChart` 測試時抓到：以「當天中午」換算週數，早上會把今天的活動當成未來丟掉；已以 `max(0, …)` 修正。
