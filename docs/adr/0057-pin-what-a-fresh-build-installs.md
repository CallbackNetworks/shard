# ADR-0057: 上線前的重建：升掉 React Router 的警報，並釘死一份重建就會變的相依

## Status
Accepted

## Date
2026-08-01

## Context

上線前跑一次完整檢查，兩件事同時浮出來，而它們其實是同一個問題的兩端：
**「現在跑著的容器」與「重新建一次會得到的東西」不是同一份。**

**一、`npm audit` 擋住 CI。** 前端有 3 個 high：

- `linkify-it <=5.0.1`：`mailto:` 驗證迴圈的二次方複雜度 DoS。它是 `markdown-it` 的相依，
  而 `markdown-it` 是我們渲染使用者輸入（含分享頁的訪客留言）的路徑，所以這一條**真的適用**。
  5.0.2 就修好了。
- `react-router 7.12.0 – 8.2.0`：RSC 模式的 CSRF 繞過。官方 advisory 明講
  「This only affects your application if you are using the unstable RSC APIs」。
  本專案是純 SPA（`BrowserRouter` / `Routes` / `Link`），**實際上不受影響**。

CI 的 `npm audit --audit-level=moderate` 不管適不適用，一律 exit 1，於是 publish 與 deploy
兩個 job 都進不去。而 react-router 的修法只有一條：升到 8.3.0。8.x 要求 node ≥ 22.22、
react ≥ 19.2.7，並且把 `react-router-dom` 併回 `react-router`（31 個檔案的 import 要改）。
也就是說，一個不適用於我們的 advisory，逼出一次跨三層的升級。

**二、MCP server 的相依沒有釘死。** 把 MCP 的 56 個測試補進 CI 時，第一次執行就失敗了 ——
但在開發用的容器裡跑是綠的。差別只有一個：開發容器是幾天前建的，CI 是現在重建的。
`mcp_server/requirements.txt` 寫的是 `mcp>=1.0.0`，於是重建時裝到了 `mcp 2.0.0`，
而 2.0 的 `Server` 物件已經沒有 `list_tools`，`server.py` 在 **import 階段**就死了。

這是最壞的一種失敗：測試在開發機是綠的，程式碼一個字也沒改，但任何一次重建
——包含 publish job 推出去的 production image——都會產出一個開不起來的 MCP server。
`backend/requirements.txt` 全部是 `==`，`e2e/package.json` 也是精確版本；
`mcp_server/requirements.txt` 是唯一的例外，而它也就是唯一炸掉的那個。

## Decision

**1. 升 react-router 到 8.3.0，連帶升 React 19 與 node 22。**

不採用「把這條 advisory 加進白名單」的作法。理由是：白名單要有人維護、要有複查日期，
而一旦有了第一筆例外，第二筆的門檻就低了；相對地，這次升級對宣告式 SPA 而言的實際改動只有
import 路徑。實測結果支持這個判斷 —— 322 個前端測試、ESLint、production build、
19 個 Playwright e2e 全部一次通過，沒有任何一行元件程式碼需要為 React 19 改寫
（沒有 `defaultProps`、沒有 `propTypes`、沒有 `findDOMNode`，進入點早就是 `createRoot`）。

具體：`react` / `react-dom` → `^19.2.7`，`@types/*` 同步；移除 `react-router-dom`，
改用 `react-router@^8.3.0`；`frontend/Dockerfile` 與 `Dockerfile.prod` 的 base image
`node:20-slim` → `node:22-slim`；31 個檔案（含 4 個 `vi.mock`）與 `vite.config.js` 的
`manualChunks` 一律改指 `react-router`。`linkify-it` 升到 5.0.2，其餘 4 個開發相依的
transitive advisory 以 `npm audit fix` 在原範圍內解掉。結果是 `npm audit` 0 vulnerabilities，
CI 的 audit 門檻不必放寬一分一毫就恢復綠燈。

**2. `mcp_server/requirements.txt` 改成精確釘選，並讓 MCP 測試進 CI。**

`mcp==1.28.0`、`httpx==0.28.1`、`pytest==9.1.0`、`pytest-asyncio==1.4.0` ——
就是目前這份 `server.py` 寫來搭配、且 56 個測試綠燈的那組版本。與 backend 的作法一致。

同時在 `backend-checks` job 補上兩步：build `mcp` image、跑 `pytest test_server.py`；
`docker-compose.ci.yml` 新增對應的 `mcp` service（它的 HTTP 呼叫全部是 mock，不需要 backend）。
MCP server 是 production `--profile mcp` 會啟動的產品元件，它的套件不該是唯一一個
「沒有任何自動檢查看著」的東西。

升級到 mcp 2.0 是另一件事：那要重寫 `server.py` 的註冊方式，不在上線前做。

## Consequences

正面：

- CI 的安全門檻維持在 `--audit-level=moderate`，沒有例外清單、沒有 `|| true`，
  而它現在真的是綠的。適用的那條（linkify-it）被修掉，不適用的那條被升級消滅。
- 前端跳到 React 19 / node 22 / react-router 8，離下一次被迫升級的距離拉遠了。
- 「重建會得到什麼」現在對每一個服務都是確定的：backend、mcp、e2e 三份相依全部精確釘選。
- MCP 的 56 個測試從「只在有人記得時手動跑」變成每次 push 都跑。這個缺口正是它自己
  被抓到的原因。

負面與代價：

- React 19 的升級是靠測試套件與 e2e 背書的，不是靠逐行審視。322 個前端測試不覆蓋每一個
  互動；React 19 在 StrictMode 下的行為差異若有殘留，會在使用時才出現。
- 版本釘死意味著安全更新不會自己進來，得靠人定期升。這是刻意的取捨：
  「重建結果可預測」比「自動拿到最新」重要，尤其對一個 import 期就可能崩潰的元件而言。
- MCP 停在 `mcp` 1.28.0；2.0 的 API 遷移成為一筆已知的待辦，而不是一次意外的重建事故。
