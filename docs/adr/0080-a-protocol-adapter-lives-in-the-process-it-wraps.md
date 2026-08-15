# ADR-0080: 協定外皮住在它包裝的那個行程裡

## Status
Accepted

## Date
2026-08-15

## Context

MCP server 從第一天起就是一個獨立的容器。這件事看起來像架構決定，其實是協定形狀留下的痕跡：MCP 最早只有 stdio 一種用法，client 自己把 process 生出來、用 stdin/stdout 講話、講完就死。那種模式**必須**是獨立行程，沒得選。`docker-compose.yml` 的註解到今天還誠實地寫著這件事——「the stdio transport is launched on demand by an MCP client, not run as a standing service」——所以 `mcp` 是 `profiles: ["mcp"]`，預設根本不啟動。

ADR-0076 把遠端 HTTP transport 接起來之後，那個「必須」就消失了。Streamable HTTP 是一個 ASGI app，而我們本來就有一個在跑的 ASGI 行程。但獨立容器留了下來，而且沒有人回頭問過它現在買到了什麼。

它現在付的帳，每一筆都是「這一層是獨立部署單位」的價格，不是 MCP 本身需要的：

1. **第二個 image。** CI 有一整條 build / tag / push `mcp` 的步驟。
2. **兩個 secret 才生得出 service。** deploy job 要 `MCP_API_KEY` 和 `MCP_HTTP_TOKEN` 同時存在，才會把 `mcp` 寫進產生的 compose 檔。缺一個，`/mcp` 就回 502——prod 現在正是這個狀態。
3. **nginx 的 upstream 只能是變數。** ADR-0076 自己把理由寫得很清楚：字面值 `proxy_pass http://mcp:8001` 在啟動時解析 DNS，於是任何沒有 mcp 容器的部署會讓 nginx 開不起來、**整站跟著掛掉**。那個 `resolver 127.0.0.11` + `set $mcp_upstream` 的 workaround 存在的唯一理由，就是這一層**可以缺席**。
4. **dev proxy 的特例。** `vite.config.js` 必須為 `/mcp` 指向另一個 target，而且只有 `--profile mcp` 起來才通。

而它換到的隔離價值是零。25 個 tool 全都是 `/api/v1` 的薄包裝；backend 一掛它就只能回錯誤（ADR-0005 自己的 Consequences 就寫著這條）；它和 backend 同語言、同 runtime；這是個人用的單一 backend，沒有獨立擴縮的需求。

**一個獨立的部署單位要付的帳，是隔離的價格。這一層沒有隔離可買。**

## Decision

**把 HTTP transport 掛進 backend 行程，stdio 保留為同一份程式碼的另一種啟動方式。**

五個實作上的決定：

**`/mcp` 用 `Route` 掛 raw ASGI app，不是 `Mount`。** 這筆學費 ADR-0076 已經付過：`Mount("/mcp")` 只匹配 `/mcp/...`，client 實際 POST 的那個 `/mcp` 會變成 307，而**重導不是傳輸協定**。Starlette 只有在 endpoint 是 function 時才會包上 request/response 那層，掛 ASGI app 則直接呼叫——這正是 session manager 需要的，它自己寫回應。

**session manager 的 lifespan 必須接進 backend 的 lifespan。** `streamable_http_app()` 的 session manager 是在那個 app 自己的 lifespan 裡啟動的；掛進別人家就沒有人跑它了，而漏掉的症狀是 runtime 才炸，不是啟動失敗。

**`/mcp` 加進 `_AUTH_BYPASS`。** 它有自己的 Bearer 驗證，不該再過一次 SPA 的密碼閘——和 `/api/v1/` 同樣的理由。

**沒有 `MCP_HTTP_TOKEN` 就不註冊這條 route。** ADR-0076 的規則不變，只是實現位置從「deploy 不生成 service」變成「app 不註冊 route」：一個半設定好的公開端點，仍然不是值得存在的狀態。差別是失敗模式變好了——現在是「這條路徑不存在（404）」，而不是「這條路徑存在但後面沒人（502）」。

**tool 仍然走 httpx 打 `/api/v1`，`MCP_API_KEY` 保留。** 這條最容易被當成沒改乾淨，所以明講：同一個行程裡直接呼叫 dispatcher 是做得到的（ADR-0042 之後，v1 本來就只是 dispatcher 的一層薄殼），但那會拆掉兩樣東西——**API key 的 scope 就是這個公開端點的權限上限**（bearer token 外洩時，攻擊面被那把 key 的 scope 框死），以及 67 個 mock httpx 的測試。**行程放在一起是部署決定，不是資料路徑決定**；ADR-0005 管的是後者，它一個字都不動。

**程式碼搬進 backend image**（`mcp_server/` → `backend/app/mcp_server/`），stdio 的啟動命令跟著改成用 backend image 跑同一個模組。tool 定義只有一份，兩種啟動方式——這是 ADR-0077「工具清單就是程式碼本身」的直接延伸。

被否決的替代方案是維持現狀：那要繼續付上面四筆帳，換一個買不到的隔離。

## Consequences

正面：

- `/mcp` 不會再因為容器沒起而 502。backend 在，它就在——而 backend 是每個部署都有的。
- nginx 可以換回字面值 upstream 指向 backend，`resolver` 那段 workaround 連同它的前提一起消失；`vite.config.js` 的 `/mcp` 特例也可以拿掉，dev 環境不再需要 `--profile mcp`。
- CI 少一個 build/push 的 image，deploy 少一個條件分支；對外開通只剩 `MCP_HTTP_TOKEN` 一個門檻。
- `backendPaths.js` 裡的 `/mcp` 不變，`backendPathClaims.test.js` 的兩向檢查照舊——這一條本來就宣告「這條路徑屬於後端」，現在它字面上為真了。

負面：

- backend image 多一個相依（`mcp==2.0.0`），啟動路徑多一段。MCP SDK 的版本升級從此會動到 backend 的 image。
- 兩者的生命週期綁死。backend 重啟，開著的 SSE 連線一起斷；「只重啟 MCP」不再是一個選項。（實務上原本也幾乎沒有這個選項，但現在是明確沒有。）
- `MCP_API_KEY` 還在，而且變成伺服器拿自己的 key 打自己。這是刻意的（見 Decision），但它會長期看起來像一個可以刪掉的東西，所以刪它之前請先讀那一段。
- stdio 的啟動命令改變，本機已經設好的 MCP client 設定要重寫一次。
- 67 個測試搬家；HTTP transport 那幾個要改成打 backend 的 test client。
- backend 這個行程的職責又多了一項。它已經同時是 SPA 的 API、外部 API、webhook 接收端、WebSocket 廣播端與排程器；這是第六項。真正需要把 MCP 拆出去的那一天，是它需要獨立擴縮或獨立部署的那一天——到時候這個決定應該被一個新的 ADR 取代，而不是被偷偷改回去。

## 落地與提案的差異

實作分三次 commit（`38d3e41` 搬家、`71891d8` 掛上、`7a3f8fe` 拆外掛），過程中有四件事和提案不同，記在這裡而不是默默改掉：

**1. SDK 的 session manager 每個 instance 只能 `run()` 一次。** 提案假設 transport app 可以在 import 時建一次、重複進入 lifespan。不行。第一次進入之後，後續每一次 startup 都會炸——而在測試套件裡，「每一次 startup」就是每一個用 `client` fixture 的測試。症狀是把 token 設進開發容器後跑全套，上百個測試同時 error，且離原因很遠。改成 **每次進入 lifespan 建一個新的 transport app**。prod 每個 worker 各自 import，本來踩不到；這是一個等著咬人的形狀，不是一個已經在痛的 bug。

**2. route 的 endpoint 必須是 class，不能是 function。** 提案只寫了「用 `Route` 不用 `Mount`」，這不夠。`starlette.routing.Route` 用 `inspect.isfunction` 決定 endpoint 是什麼：是 function 就當成 `func(request) -> response`，只有非 function 才當 ASGI app。session manager 自己寫回應，所以交給它一個 function，Starlette 會等一個永遠不會來的 `Response`——client 端看到的是掛住。守門的 `BearerGuard` 因此是一個 class，並有一個測試斷言 `Route(...).app is transport`（Starlette 沒有包它）。

**3. 「兩個 secret 才算啟用」收斂成一個。** 原本 deploy 用 `MCP_API_KEY` + `MCP_HTTP_TOKEN` 決定要不要生成 service。現在 route 由 app 自己依 `MCP_HTTP_TOKEN` 註冊，所以那個閘只剩一個條件；只設 token 沒設 key 會得到一個「開得起來但每個工具都 401」的端點，deploy 因此改成**明確警告**而不是安靜地放行。順帶讓負向驗證變強：停用時斷言 **404**（route 從未註冊），而過去停用只可能是 502（容器不存在），根本無從斷言。

**4. 兩個原本沒被 lint 過的檔案。** 舊的 CI job 只跑 pytest，沒跑 ruff。併進 backend 後跳出 12 個錯誤（十個測試裡沒用到的綁定、import 排序），一併修掉。至於 Context 裡擔心的 coverage 分母：**是往上不是往下**——模組本身 93%，整體 83%（gate 78%），`pip-audit --strict` 也乾淨。

驗證方式一律是實機而不只是測試綠：未驗證的 `POST /mcp` 得到 401、帶 token 完成 initialize、`tools/list` 25 個工具、`list_projects` 真的繞回本行程自己的 `/api/v1` 取到資料（單 worker 下 8 個並發也正常），以及透過 production nginx image 走完整條路徑。
