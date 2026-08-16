# ADR-0084: 設定 CI/CD 不能只有瀏覽器做得到

## Status
Accepted

## Date
2026-08-16

## Context

一個節點要收 CI/CD 回呼，需要兩樣東西：`callback_token`（它**就是**位址 `/webhook/callback/{token}`）和 `webhook_secret`（簽章用的金鑰）。自 ADR-0060 起簽章是強制的，所以這兩樣不是可有可無的裝飾——沒有它們，任何 CI provider 都無法被指向這個節點。

ADR-0059 把這兩樣從所有節點 payload 裡拿掉了，理由是對的：`/webhook/callback/{token}` 刻意不需要驗證，一把 `read` scope 的金鑰若能列舉 token，就等於握有一條可用的寫入路徑。代價是「讀出憑證」必須成為一個獨立、會被記錄的請求。那個請求是 `GET /api/nodes/{id}/webhook`。

問題在於它只長在內部 `/api` 上。內部 `/api` 在 production 是被 `AUTH_PASSWORD` 擋住的（ADR-0030），只有帶著 session 的瀏覽器進得去。也就是說：

- API key 拿不到。`/api/v1` 完全沒有對應端點。
- MCP 拿不到。MCP 的 25 個 tool 全部是 `/api/v1` 的薄包裝（ADR-0005、ADR-0080），`/api/v1` 沒有的東西它就沒有。
- 一個 agent 可以建專案、建 task、用 `POST /api/v1/subscriptions` 幫自己註冊**對外**的事件回呼，然後在最後一步停下來，把「去瀏覽器把 webhook URL 和 secret 複製出來貼到 CI 設定裡」交還給人。

這是個不對稱：**對外**那半（平台通知外面）早就承認 agent 是合法的設定者，**對內**那半（外面通知平台）沒有。而 CI/CD 整合恰好是 agent 最該能自己收尾的一件事——它剛剛才建好那個 task。

同一份邏輯要開第二扇門，這個 repo 已經付過帳單：ADR-0070→0073 那一串就是分享功能被複製成兩份之後慢慢走鐘的紀錄，而且複製品「還能用」，所以沒有任何失敗症狀。v1 的 share facade 目前也是自己重新實作了一次 rotate token，這裡不要再多一個。

## Decision

**把「讀出／輪替 CI 回呼憑證」這個動作抽成一個 service，兩扇門呼叫同一個。**

`services/webhook_credentials.py` 持有 `ensure_webhookable` / `reveal` / `rotate`。lazy provisioning（容器第一次被問時才鑄出憑證，ADR-0082）和 activity log 都在裡面，所以第三扇門若有一天出現，不可能發出憑證卻忘記留下紀錄——這是 ADR-0053 學到的同一招：該做的事寫在動作裡，不是寫在每個 router 裡。

兩個 router 各自保留真正屬於自己的部分：404、以及**誰可以問**。

- 內部 `GET /api/nodes/{id}/webhook`、`POST .../rotate-secret`：不檢查 scope，因為能走到 `/api` 就代表通過了密碼閘。actor 記為 `user`。
- 外部 `GET /api/v1/nodes/{id}/webhook`、`POST .../rotate-secret`：需要 `admin` scope，加上既有的 project-scope 存取檢查（ADR-0042）。actor 記為 `api:{key name}`。

**為什麼是 `admin` 而不是 `write`。** 這不是保守，是被既有規則決定的：ADR-0059 的 redaction middleware 會從**每一個** v1 response 裡剝掉 `callback_token`，除非金鑰是 `admin`。一把 `write` 金鑰若能呼叫這個端點，拿到的會是一份少了位址的設定，而且沒有任何跡象告訴它少了東西——比 403 糟。那條規則刻意是「對 response 生效」而不是「每個端點自己檢查」，正是為了讓新端點無法在不遵守它的情況下被寫出來；那麼正確的做法是去符合它，而不是在它身上挖一個洞。實質理由也站得住：發出一個 token 加上它的簽章金鑰，等於在系統上開一條不需驗證的寫入路徑，這是管理動作，不是一般寫入動作。

MCP 端加一個 tool：`manage_webhook(action: "reveal" | "rotate", node_id)`，維持 ADR-0077 的形狀——signature 就是 schema，沒有手寫的 `inputSchema`。

`agent-context` 的 `conventions` 多一條 `cicd`，同時講對外（`/api/v1/subscriptions`）和對內（這兩個端點）兩個方向，因為 agent 讀的是這裡。

## Consequences

**好的：**

- 一個 agent 現在可以自己把 CI/CD 從頭設到尾：建 task、讀出回呼位址與簽章金鑰、寫進 pipeline 設定、收回呼。人不必再開瀏覽器補最後一步。
- 兩扇門同一份實作。`tests/test_webhook_config_api.py` 把同一個請求送進兩邊，比對 status、detail 和整份 config；型別規則、lazy provisioning、log 只有一處可改。
- 憑證發放的稽核紀錄跟著動作走，不跟著 router 走，而且 v1 那筆會記下是**哪一把金鑰**問的。

**要付的代價：**

- 這個能力只給 `admin` 金鑰。一把只有 `write` 的 agent 金鑰仍然設定不了 CI——它會拿到 403 並知道原因，而不是拿到一份壞掉的設定。想讓 MCP 用這個 tool，`MCP_API_KEY` 必須是 admin scope；不是的話 tool 會回報 403，這是誠實的失敗。
- `/api/v1` 上多了一個會吐出明文 secret 的端點。它是這條規則的唯一例外，而且是刻意的：ADR-0060 讓簽章變成強制的那一刻，就註定要有一個地方把金鑰交出去，否則那把鎖沒有人打得開。憑證仍然不會出現在任何節點 payload 裡——`tests/test_webhook_config_api.py::TestItIsStillNotAFieldOnTheNode` 盯著這件事。
- v1 的 share facade 仍然是自己重新實作的一份（`rotate-token` 自己產 uuid），沒有在這次一起收。它是同一類問題，但不是這次的範圍。
