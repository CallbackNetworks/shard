# ADR-0098: 公開的問答助理只能知道分享頁本來就顯示的東西

## Status

Accepted

## Date

2026-08-18

## Context

ADR-0096/0097 讓內部助理的 provider 變成執行期設定。使用者接著問了兩件事:助理能不能協助操作這台實例、以及能不能讓助理對外回答查詢。前者是既有能力(內部助理已經有工具能讀寫任務),後者不是——`/share/n/{token}` 這個公開分享頁,從 ADR-0070→0073 開始就刻意收斂成一份實作,任何人拿到連結就能看,不需要帳號。讓一個 LLM 助理接進這個頁面,等於把 tool-calling 的存取權暴露給不受信任的輸入,問題不是「要不要做」,是「怎麼讓它不多知道分享連結本來就沒給的東西」。

三個範圍決定是在動手前先問清楚的(不是事後補的規則):只回答這個分享連結本來就能看到的資料、不碰真實寫入、遵守這個分享既有的 PIN 鎖,並且比照登入鎖定的方式限流。第四個問題在計畫定案前又被問了一次——「外部可以直接用 API 問嗎」——答案是可以,而且是刻意的:token(+PIN)本來就是這整個分享機制的憑證,不是「限瀏覽器」,`Origin`/`Referer` 這類 header 誰都能偽造,真正的邊界只有 token、PIN、限流三樣,跟 `/share/node/{token}` 本身的信任模型完全一致。

## Decision

**不做 tool-calling,把資料直接餵進 context。** 內部助理需要動態工具,因為它能查、能改整個資料庫;這個助理只回答**一份早就被序列化好的資料**——就是 `GET /share/node/{token}` 本來就會回的那包 JSON。與其為公開助理另外寫一套工具/派送系統(每個工具都要重新驗證查到的東西沒有跨出分享範圍,是很容易漏掉的地方),`POST /share/node/{token}/chat`(`routers/share.py`)直接呼叫既有的 `get_share_node(token, request, db)`——這個檔案裡的其他路由本來就這樣互相呼叫(`get_share_node` 內部就是這樣分派給 `get_share_identity`/`get_share_project` 的)——把它的回傳值原封不動塞進系統提示。沒有工具、沒有派送層、沒有另一份要單獨稽核的範圍邏輯:「這個助理能知道什麼」收斂成一行——*就是 `get_share_node` 本來會回給瀏覽器的東西*。這個做法也讓身分(聚合多個 owns 專案)、專案、自訂容器三種分享型態一次處理好,因為回傳的資料形狀本來就一樣。

**requires_pin 在打模型之前就先擋掉。** `payload = get_share_node(...)`,若 `meta.requires_pin` 為真就回 403,provider 完全不會被呼叫——`test_share_chat.py` 直接斷言 mock 過的 `get_provider` 沒被呼叫過,不只是斷言回應碼對。15 分鐘的 PIN session cookie 過期是唯一會在對話中途觸發這條路徑的情況,前端顯示「請重新整理頁面」,不做內嵌的重新輸入 PIN 流程。

**限流依 token 計次,不是依 IP。** `services/rate_limiter.py` 新增 `share_chat_rate_limit`(20 次/小時/token),沿用既有 `RateLimiter` 類別。依 token 而非 IP 計次,是因為不管呼叫的是網頁上的小工具還是直接打 API,同一個分享連結該扛住的問題數量是同一個數字——這正是「外部能不能直接用 API 問」這題的答案落到限流設計上的樣子。跟既有的 `share_rate_limit` 同一個信任等級:記憶體內、單行程,production 兩個 uvicorn worker 之間不共享,重啟就重置——是個緩衝閘,不是硬上限。

**訪客的一問一答存成獨立的一份 log,不進 `AssistantConversation`。** 新表 `ShareChatLog`(`node_id`、`question`、`answer`、`ip_hash`、`created_at`),不是內部助理那組表的延伸——那組表描述的是一個有身分歸屬、狀態化的多輪對話串,一個匿名訪客的單次問答除了「都牽扯到 LLM」以外沒有共同的不變量,硬塞進同一張表意味著往後每一個查內部對話的地方都要多一個永久的過濾條件。這裡的形狀反而更接近 `ActivityLog`/`WebhookDelivery`——一件事一列,依它發生在哪個節點查。擁有者這邊的讀取端 `GET /api/nodes/{id}/share-chat-log` 照抄既有的 `GET /api/nodes/{id}/webhook-events`(ADR-0085)的樣子——每個節點自己的 log 放在那個節點自己的頁面上,不是塞進全域 Settings。回傳的 schema 刻意不含 `ip_hash`:那一欄只是限流與濫用追蹤用的,不是要給人看的。

`test_unauthenticated_surface.py` 的 `JUSTIFIED` 清單加了這條路由——這個守門測試列舉每一條免憑證路由,新加的端點如果不在清單裡就會直接測試失敗,理由跟同一份清單裡其他 `/share/*` 條目一致:token(+PIN)就是憑證。

## Consequences

正面:訪客能直接在分享頁上問「這個專案進度到哪了」,不用自己爬資料;安全邊界收斂成一行程式碼(`payload = get_share_node(...)`)方便稽核,不是一整套要單獨驗證的工具派送邏輯;擁有者能在自己的分享面板看到訪客實際問了什麼。

負面與代價:這是這台實例第一個**公開、無憑證、會打外部 LLM API** 的端點——每一次問答都是真金白銀的費用,而限流是記憶體內、單行程,不是硬上限,一個決心繞過的人在 production 的兩個 worker 之間或靠重啟是繞得過去的(跟既有 `share_rate_limit`/`api_rate_limit` 一樣的已知限制,沒有在這次解決)。系統提示把整包分享頁 JSON 塞進 context,大專案的 token 成本沒有做上限或截斷——這台工具是個人規模的資料,先不處理,真的變成問題再回頭看。這個助理沒有 v1/MCP 的門(`GET /api/nodes/{id}/share-chat-log` 只有內部門這一道)——這是擁有者查看自己資料的能力,不是要給 agent 用的,之後若要補齊,走 ADR-0084 那條線即可。
