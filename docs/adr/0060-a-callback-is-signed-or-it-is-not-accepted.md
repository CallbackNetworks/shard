# ADR-0060: 回呼有簽章，否則不算數

## Status
Accepted

## Date
2026-08-05

## Context

ADR-0059 把憑證關回伺服器裡：唯讀 API key 不再能一次撈走 133 個 callback token。但它明確留下一筆欠債 —— 拿到 token 的人，依然打得進來。

`/webhook/callback/{token}` 在 auth 白名單裡，這是對的：CI runner 沒有辦法帶著擁有者的 session。問題在於除了那個 token 之外，它不要求任何東西。也就是說**網址本身就是全部的憑證**，而網址會外洩到很多地方：瀏覽器歷史、反向代理的存取紀錄、螢幕截圖、貼進 pipeline 設定檔、貼進聊天室。它不會過期，也沒有辦法單獨撤銷。

簽章機制**一直都在**。`_verify_signature` 認得 GitHub 的 `X-Hub-Signature-256`、GitLab 的 `X-Gitlab-Token`、以及通用的 `X-Signature`，密鑰設了就一定檢查，對不上就 401。它只是這樣開頭：

```python
secret = task.webhook_secret
if not secret:
    return True  # No secret configured = accept all
```

而沒有任何地方會設 `webhook_secret`：不會在建立任務時產生，前端沒有欄位可以填，文件把它寫成「為了安全，你可以設定……」。所以缺的從來不是機制，是**預設值**。一把需要人主動打開的鎖，就是一把沒有人打開的鎖。

外面的服務不是這樣做的。Stripe、Shopify 在你建立 webhook 的當下就發給你一組密鑰，沒得選；GitHub 的欄位是選填，但文件裡寫「strongly recommend」。這套系統的實作水準本來就對齊那些服務，只有這個預設值不是。

## Decision

**每一個任務在建立時就發一把密鑰，回呼沒有有效簽章就拒絕。**

三個部分：

1. `_apply_task_data_defaults` 在 `callback_token` 旁邊一起種下 `webhook_secret`（`secrets.token_hex(32)`）。這個函式同時被內建 task 與使用者自訂的 task-like 型別走過（ADR-0035），所以「能收回呼的節點」與「有密鑰的節點」是同一個集合，不需要第二處記得。

2. `_verify_signature` 沒有密鑰時回傳 `False`。既然每個任務出生就有一把，沒有密鑰只可能是早於這次變更的節點，或是被人手動清掉的 —— 兩者都不構成接受一次未簽章寫入的理由。

3. Alembic `d4f6a8c0e2b3` 補發給既有資料。挑選的條件是**能力而不是型別**：`data` 裡有 `callback_token` 的節點，正好就是回呼端點會路由到的節點，無論它的型別叫什麼。在 migration 裡重新推導一次 task role 的集合，只會多一個與執行期不一致的機會。

### 密鑰要讀得到，但要用讀的方式讀

ADR-0059 把 `webhook_secret` 列為「永不送出」。強制簽章之後這條規則若原封不動，結果會是一把沒有人拿得到、因此沒有人設定得起來的鎖。

但也不能就這樣把它放回 `TaskOut`：**第二道鎖的意義，就在於它不走第一道鎖的那條路**。callback token 會跟著每一次任務列表回應一起出去（那是擁有者自己的 session，ADR-0059 判斷可以），如果密鑰也跟著同一份回應走，任何洩漏那份回應的途徑就同時洩漏兩者，第二道鎖等於不存在。

所以密鑰有一個**自己的、會留下紀錄的請求**：`GET /api/nodes/{id}/webhook`，回傳 token + secret + path，並寫下一筆 `task.webhook_secret_revealed` 活動。旁邊是 `POST /api/nodes/{id}/webhook/rotate-secret`。

放在 node 介面而不是 `/projects/{pid}/tasks/{tid}` 之下，理由與 ADR-0041 把分享機制一般化成 `/nodes/{id}/share/*` 相同：task-like 的自訂型別是一等公民的任務，不一定住在字面上的 project 底下。

回傳 `path` 而不是完整 URL —— 伺服器在反向代理後面，對自己 origin 的認知只是上一跳告訴它的，而發問的前端本來就知道真的是什麼。

### 前端

新增 `WebhookPanel`：網址與密鑰放在一起（一個沒有另一個等於沒設定），密鑰預設遮蔽、可複製而不必先顯示、可就地輪替。密鑰只在面板打開時抓取，`gcTime: 0` 讓它一關閉就從 query cache 消失。

看板卡片上那顆「一鍵複製 webhook 網址」的按鈕移除了 —— 它現在複製的是半個憑證。未被任何地方引用的 `TaskItem.jsx` 一併刪除，它把 `POST /webhook/callback/{token}` 當成完整設定展示。

## Consequences

- 拿到 callback URL 不再等於拿到寫入權限。ADR-0059 記下的那筆欠債結清。
- 對這個專案沒有破壞性影響：現存任務全部由 migration 補發密鑰，而使用者確認尚未有任何對外設定好的 CI 整合。若換成一個已有既存整合的部署，這是一次**破壞性變更** —— 所有既有 webhook 會開始回 401，必須逐一補上密鑰。這是知情的取捨，不是疏漏。
- 未簽章的請求連 build history 都不會留下。驗證發生在寫入 `WebhookEvent` 之前，否則只知道網址的人就能灌爆一個任務的建置歷史。
- 密鑰現在有一條讀得到的路，這是 ADR-0059「永不送出」的一個具名例外。範圍限定在一個端點、會留下活動紀錄、且不隨任何列表回應移動；`NEVER_SERVED` 對 schema 的約束不變（OpenAPI 契約掃描仍然通過）。
- 測試上升為必須簽章：`conftest` 的 `post_callback` fixture 對送出的**實際位元組**簽章，因為對一種編碼簽章卻送出另一種，正是每個呼叫端各自會犯一次的錯。
- 三種 provider 格式各有一條端到端的測試，另有「金鑰不對」「對別的內容簽章」「密鑰被清空」三種拒絕情境。
- 驗證：後端 1038 passed / 1 skipped（覆蓋率 81%），前端 342 passed，ruff 與 ESLint 乾淨。
