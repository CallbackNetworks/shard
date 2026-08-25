# ADR-0076: 遠端 MCP 走既有那扇門，而且那扇門一定上鎖

## Status
Superseded by ADR-0080

（只有獨立的 `mcp` 容器被取代，連同為了它可能不存在而生的 nginx `resolver` 變數技巧和
compose 的雙 secret 閘門。門本身沒有變——`https://<host>/mcp`、走 frontend 的 nginx、
bearer token 是必要條件、沒有 token 就沒有這條路由——那正是 ADR-0080 保留下來的部分。）

## Date
2026-08-14

## Context

MCP server 一直只有 stdio 一種用法：client（Claude Code）自己 `docker run -i` 把 process 生出來，講完就死。那對單一台開發機沒問題，但代價是**每一台裝置都要有 image、有金鑰、有設定**。手機上的 client、另一台電腦、以後任何接進來的 agent，都連不上。

程式碼裡其實早就有 HTTP transport：`MCP_TRANSPORT=http` 會跑 uvicorn，掛 `StreamableHTTPSessionManager`，還有 `MCP_HTTP_TOKEN` 的 Bearer 驗證。問題是**它從來沒有在任何地方跑過**——不在 prod（deploy job 產生的 compose 只有 backend + frontend），不在 CI（`test_server.py` 的 56 個測試全部只測 tool 實作，沒有一個碰過 HTTP app），也不在開發環境（`mcp` 是 profile-gated，預設不啟動）。

一段沒有執行過的程式碼，就是一段還沒被證實能執行的程式碼。真的把它接起來之後，第一次跑就撞到三個各自足以讓它不能用的缺陷：

1. **驗證預設是關的。** `async def auth_check` 開頭是 `if http_token:`——環境變數沒設，就完全不檢查。也就是說「忘記設 token」的結果不是啟動失敗，而是**把 21 個工具無條件公開給任何連得到的人**，而每個工具都帶著伺服器自己的 API key。這和 ADR-0060 那個 `if not secret: return True` 的簽章檢查是同一個形狀。
2. **每個成功的請求都送兩次回應。** handler 在 `await session_manager.handle_request(...)` 之後還 `return Response()`，而 session manager 早就自己寫完回應了——多一個 `http.response.start`。
3. **`Authorization` 的解析同時太鬆和太緊。** `removeprefix("Bearer ")` 讓「裸 token、不帶 scheme」也能通過（多一條沒人記載的入口），卻擋掉大小寫不同的 `bearer`（RFC 7235 說 scheme 不分大小寫）。

至於怎麼對外曝露：prod 的 origin 只透過一條 tunnel 進得來，前面是 frontend 容器裡的 nginx。開第二個 hostname 要動 DNS 和 tunnel 設定，換來的是同一件事。

## Decision

**遠端 MCP 走既有那扇門：`https://<host>/mcp`**，由 frontend 的 nginx 反向代理到內部網路上的 `mcp` 容器。MCP 容器不對主機開任何 port，唯一的入口就是這條路徑加上 Bearer token——和這個專案其他所有公開介面一樣，一個能力一扇門（ADR-0071、ADR-0073）。

三個實作上的決定：

**token 是必要條件，不是選項。** `MCP_TRANSPORT=http` 而沒有 `MCP_HTTP_TOKEN` 時，process 直接 `SystemExit`。stdio 模式下 client 擁有那個 process，OS 就是邊界；HTTP 模式下任何路由得到的人都是潛在呼叫者。**一把需要人主動打開的鎖，就是一把沒有人打開的鎖**（ADR-0060、ADR-0072 已經各付過一次帳）。同理，deploy 時 `MCP_API_KEY` 和 `MCP_HTTP_TOKEN` 兩個 secret 缺任何一個，compose 檔就**不會生出 mcp 這個 service**——寧可沒有這個功能，也不要一個半設定好的公開端點。

**nginx 的 upstream 是變數，不是字面值。** `proxy_pass http://mcp:8001` 會在**啟動時**解析 DNS，於是任何沒有啟用 MCP 的部署都會讓 nginx 開不起來，**整個站跟著掛掉**。寫成變數加 `resolver 127.0.0.11`，解析延到每次請求：沒有 mcp 容器時 `/mcp` 回 502，其他路徑毫髮無傷。（驗證方式就是拿掉 mcp 容器跑 `nginx -t` 和實際啟動。）

**`/mcp` 用 `Route` 掛一個 raw ASGI app，不是 `Mount`，也不是一般的 handler。** Starlette 只有在 endpoint 是 *function* 時才會包上 request/response 那層，其他一律當成 ASGI app 直接呼叫——這正好是我們要的：session manager 自己寫回應。`Mount("/mcp")` 則只匹配 `/mcp/...`，client POST 的那個 `/mcp` 會變成 307（關掉 redirect 就變 404）。**重導不是傳輸協定**，client 的第一個請求就必須打得到 session manager。

## Consequences

正面：

- 任何裝置上的 MCP client 只要有網址和 token 就能連，不必有 image、不必有後端金鑰——金鑰留在伺服器上。
- 不需要新 hostname、不需要碰 DNS 或 tunnel 設定。
- HTTP transport 從「寫過但沒跑過」變成有測試涵蓋（缺 token 拒絕啟動、五種未授權形狀、兩種大小寫的 scheme），而且 deploy 有一個負向驗證步驟：未授權呼叫必須拿到 401 —— 200 代表 SPA 自己回答了自己的路徑（ADR-0071 的形狀），502 代表 nginx 找不到容器。
- 開發環境的 vite proxy 也把 `/mcp` 指向 mcp 容器而不是 backend，`--profile mcp` 起來就能在本機重現同一條路徑。

負面：

- 多一個對外端點，也就多一個要輪替的憑證。持有 token 的人，等同持有 `MCP_API_KEY` 那把 key 的全部權限——所以那把 key 應該只給 `read,write`，不要給 admin。
- CORS 仍是 `allow_origins=["*"]`。token 不在 cookie 裡，瀏覽器無法代打，所以這不是漏洞；但它比需要的寬，之後若要收緊是獨立的一次改動。
- 這條路徑上多了一層 nginx。SSE 串流已經關掉 buffering 並把 timeout 開到一小時，但長連線多一跳就是多一個會斷線的地方。
- MCP server 仍釘在 `mcp==1.28.0`（協定 `2025-11-25`）。遠端連線讓「client 要求更新協定版本」這個升級觸發條件變得更可能發生。
