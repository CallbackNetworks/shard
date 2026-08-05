# ADR-0059: 憑證不離開伺服器，以及沒有人在聽的即時事件

## Status
Accepted

## Date
2026-08-05

## Context

ADR-0058 的前後端對照只比對了「網址存不存在」。這次補上兩項它沒查的：後端送出的欄位與前端讀取的欄位是否一致，以及 WebSocket 廣播的事件與前端處理的事件是否一致。兩項都找到東西，而且是同一個形狀：**一條規則寫在某一個手工維護的地方，當它周圍的東西一般化之後，規則沒有跟著一般化。**

### 一、憑證隨著節點一起被送出

`Node.data` 是自由格式 JSON。這正是單一節點寫入介面（ADR-0040→0043）能容納使用者自訂型別的原因，也正是**沒有任何人審查過裡面裝了什麼**的原因 —— 它不在 OpenAPI 契約裡，看 API 文件的人永遠看不到它。

裡面裝的是 `share_token`（分享連結本身）、`share_pin_hash`、`callback_token`（CI 回呼授權）。`TaskOut` 更直接：`callback_token` 和 `webhook_secret` 是一級欄位。

實測一把 **read** scope 的 API key —— 系統裡權限最低的 —— 從 `/api/v1/nodes?include=data` 撈到 161 個機密。這構成一條可用的提權路徑：

- `/webhook/callback/{token}` 在 auth 白名單裡，**設計上就是免驗證的**（CI 服務打得進來才有意義）。
- 它的簽章檢查是選填的：`if not secret: return True  # No secret configured = accept all`。
- 所以唯讀 key → 撈 callback token → 改任務狀態。系統中最低的權限升級為寫入。

`share_pin_hash` 另有問題：它是**加鹽單輪 SHA-256**，而分享 PIN 通常是 4-6 位數字。拿到雜湊等於拿到 PIN。

值得記下的是，這個 codebase **本來就知道**。`identities.py` 一直都把 PIN 雜湊投影成布林 `share_pin_set`，從不吐出雜湊。那份知識只是沒有從一個手寫的路由，跟著搬到通用的節點介面上。

### 二、即時同步只刷新它出生那天就知道的東西

後端廣播 13 種事件。前端的 prefix 判斷確實全數涵蓋 —— 但收到之後，它只失效 `['projects']`、`['project', id]`、`['comments', id]` 這三個查詢鍵。全站有 51 個。

也就是說：Goals、Identities、結構圖、活動列表、未歸檔任務……這些頁面只會被**使用者自己按下的那個按鈕**刷新。改動如果來自 AI 代理人（本產品的核心使用情境）或工作流程規則，畫面會靜靜地停在舊資料上，直到視窗失焦再聚焦才因 `staleTime` 過期而重抓。

## Decision

### 憑證：分成「永不送出」與「隨授權而定」兩類

新增 `app/services/node_data.py` 作為唯一判定點。

**永不送出**（`NEVER_SERVED`）：`share_pin_hash`、`webhook_secret`。它們是靜態憑證，客戶端只需要知道「有沒有設」。實作在 `NodeOut` 的 `field_validator` 與 `TaskOut` 的 `model_validator` 上 —— 每一次節點與任務的讀取都經過這兩個 schema，所以沒有站點可以遺漏。`webhook_secret` 從 `TaskOut` 移除，換成 `webhook_secret_set`；保留這個布林值是因為簽章仍是選填的，至少要看得見哪些回呼是沒簽章的。

**隨授權而定**（`TOKENS`）：`share_token`、`callback_token`。它們是**能力**而非描述 —— 持有即可行動。改為 `admin` scope 才給，對齊既有的權限模型（`admin` 本來就是能刪除容器的那一級）。內部 `/api`（擁有者自己的 session）照常全給：擁有者本來就持有資料庫裡的每一個憑證，遮蔽只會壞掉「複製 webhook URL」按鈕而關不掉任何東西。

授權那一半實作為 `CredentialRedactionMiddleware`，作用於整個 `/api/v1` 的**完成回應**，而不是逐一穿線進每個端點。理由：v1 有十幾種回應形狀且還會長，逐端點套用的規則，是一個新端點可以「不寫它」就繞過的規則。這條不變式描述的是回應本身，就在回應上檢查。scope 由 `_get_api_key` 寫進 `request.state` —— 每個 v1 端點本來就依賴它。

### 即時同步：不再列舉要刷新什麼

`useRealtimeSync` 改為對任何圖變更事件呼叫不帶參數的 `invalidateQueries()`。沒有清單，就沒有清單會落後。React Query 只會重抓**當下掛載中**的查詢（任一畫面上不過數個），其餘標記為過期留待下次讀取。250ms 合併同一批事件，讓代理人的連續寫入或批次匯入只觸發一輪。

過度失效的代價是一個多餘的 GET；失效不足的代價是一個安靜說謊的畫面。

## Consequences

- 唯讀 key 從 161 個機密降到 0；admin key 仍拿得到 token（否則代理人無法自動設定 CI 回呼，那是實際存在的功能）。PIN 雜湊與簽章密鑰對**任何** scope 都不再送出。
- 提權路徑關閉。但**簽章仍是選填的** —— 這次刻意不動（見下）。持有 token 者依然打得進免驗證的回呼端點，只是 token 不再容易取得。
- 專案範圍限制經實測是正常的（受限 key 看到 0 個節點），沒有跨專案外洩，這部分不需要改。
- `webhook_secret` 從 `TaskOut` 消失是**對外契約的破壞性變更**。目前沒有任何消費端讀它（前端、MCP、文件皆無），所以實際影響為零，但仍記在此。
- 中介層對每個非 admin 的 v1 JSON 回應多一次序列化。以個人規模的流量而言可忽略，換來的是「新端點不可能忘記」。
- 三道守衛：`test_credential_redaction.py`（13 項，含各 scope 的實際端點行為）、掃描產生出的 OpenAPI 文件確認沒有 schema 再次宣告這些欄位、以及 `useRealtimeSync.test.jsx` 逐一餵入後端實際廣播的 13 種事件。
- 已知刻意未做：webhook 簽章維持選填。強制簽章會讓既有的 CI 整合全數失效需重新配置，判斷為上線後處理較妥。這是一筆明確的欠債，不是遺漏。
- 驗證：後端 1020 passed / 1 skipped，前端 336 passed（43 檔），ruff 與 ESLint 乾淨，並以實際 API key 現場驗證各 scope 的回應。
