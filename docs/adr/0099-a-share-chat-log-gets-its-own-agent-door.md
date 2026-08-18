# ADR-0099: share-chat-log 也要有 v1/MCP 的門

## Status

Accepted

## Date

2026-08-18

## Context

ADR-0098 上線時,`GET /api/nodes/{id}/share-chat-log`(訪客問了公開助理什麼)刻意只留內部門——當時的重點是先把公開助理本身的安全邊界做對。使用者事後問「這個方向還能做什麼」,這是清單裡最小、最沒有爭議的一項:讀取自己分享頁的訪客問答紀錄,跟 `share-views`(分享頁被看過幾次)是同一類能力,`share-views` 早就有 v1 門,這個沒有,純粹是先後順序的問題,不是刻意的範圍決定。

## Decision

照抄 `share-views` 的形狀,不是 `webhook-events` 的形狀——兩者都是「小型、單一用途的分享域讀取」,但 `share-views` 是 `manage_share` 這個既有多動作 MCP 工具底下的一個 action(`"views"`),`share-chat-log` 也一樣掛成新 action `"chat_log"`,不另開一個獨立工具(ADR-0093:一個能力一個工具,不是一個端點一個工具)。

查詢邏輯從 `routers/nodes.py` 抽成 `services/share_admin.py::chat_log(db, node_id, limit, offset)`,內部門與 `/api/v1` 新端點都呼叫同一份實作。`/api/v1/nodes/{id}/share-chat-log` 用 `read` scope,跟 `share-views` 同一個判準——這是在描述分享頁發生過什麼,不是交出憑證,`ip_hash` 欄位一律不進回應(那一欄只服務限流,不是給人看的)。

`test_mcp_reach.py` 不用另外改:它掃描 `server.py` 原始碼裡出現過的字面路徑字串,`"chat_log"` action 一旦呼叫 `_get(f"/nodes/{node_id}/share-chat-log")`,這個路徑就會被掃到。

## Consequences

正面:自己的分享頁被問了什麼,現在 agent(透過 MCP)跟外部呼叫端(透過 `/api/v1`)都能查,不用登入瀏覽器。查詢邏輯只有一份,兩道門不會答案不一致。

負面與代價:沒有。這是既有規則(read scope、單一實作、掛進既有多動作工具)的直接套用,沒有新的判斷要做。
