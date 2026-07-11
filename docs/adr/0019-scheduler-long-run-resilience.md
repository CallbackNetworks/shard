# ADR-0019: Scheduler 長期運作韌性 — 檢查隔離、持久化去重、heartbeat 與假時鐘測試

## Status
Accepted

## Date
2026-07-10

## Context

Scheduler 是一條每小時 tick 的 asyncio task,負責七項檢查(提醒、recurring、webhook 重試、日/週摘要、SLA、備份)。既有設計存在三類只在長期運作下才顯現的失效模式,單次 unit test 無法涵蓋:

1. **連鎖飢餓**:七個檢查共用一個 try/except,第一個持續失敗(如 ADR-0018 修掉的 PG datetime crash)會讓其餘六個永遠不執行——實際症狀是「備份靜悄悄停了」,唯一痕跡是 log 一行錯誤。
2. **重啟重複**:once-per-day/week 去重標記(`_last_summary_date` 等)是 module-level 全域變數,重啟即丟失;在寄送時刻之後重新部署會重寄當日摘要、重跑備份。
3. **靜默死亡**:asyncio task 若死亡,`/health` 照樣回 `ok`,部署健康檢查全過,但所有排程功能已停止,無任何信號。

此外,跨日/跨週邊界、cooldown 節奏等時間邏輯,測試若依賴真實時鐘則不可能覆蓋。

## Decision

1. **檢查隔離**:抽出 `_run_tick(db)`,每個檢查獨立 try/except;失敗時 `db.rollback()`(PG 中止交易語意,見 ADR-0018)再繼續下一個檢查。
2. **去重狀態持久化**:去重標記改存 `user_preferences` KV 表(`scheduler-state` key),重用 ADR-0011 的既有原語而非新表;重啟後狀態自 DB 恢復,不會重寄。
3. **Heartbeat**:每次 tick 結束更新 `_last_tick_at`,`get_scheduler_health()` 以「兩個 tick 間隔內有無心跳」判定 alive,並由 `/health` 回傳 `scheduler: {alive, last_tick_at}`。`/health` 維持恆回 200——scheduler 死亡不應觸發容器重啟迴圈,而是交由監控/告警消費此欄位。
4. **假時鐘長期模擬測試**(`tests/test_scheduler_longrun.py`):patch `scheduler.now_utc` 注入 FakeClock,在毫秒級時間內驅動「連續三天/兩週的每小時 tick」,驗證:摘要恰好一天一封、週報恰好一週一封、提醒 cooldown 節奏、recurring 一天一件、重啟不重寄、壞檢查不拖垮其餘、心跳停止後 health 轉 dead。原則:**不是把測試跑得久,而是把時間變成可注入的參數,讓「長期」可以在單次執行內壓縮重現。**

## Consequences

**正面:**
- 一個檢查壞掉不再放大成全面停擺;症狀從「全部靜默停止」變成「單項降級 + 明確 log」。
- 重啟安全:摘要/備份去重不依賴 process 壽命。
- 「scheduler 還活著嗎」從不可觀測變成 `/health` 一眼可見,部署後可驗證。
- 時間邏輯迴歸有確定性測試防護,CI 單次執行即可覆蓋跨日/跨週行為。

**負面 / 代價:**
- 每次 tick 對 `user_preferences` 多幾次讀寫(單人工具、每小時一次,可忽略)。
- heartbeat 只證明迴圈活著,不證明每個檢查成功;單項檢查的持續失敗仍需看 log(可接受:錯誤已含檢查名稱)。
- 真正的資源洩漏/累積類問題(連線、無上限資料表成長)仍不在覆蓋範圍,屬於未採納的 soak test 範疇(已知風險)。
