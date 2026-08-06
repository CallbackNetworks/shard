# ADR-0061: 頁面路由不是後端路徑

## Status
Accepted

## Date
2026-08-06

## Context

ADR-0036 把內部 API 收進 `/api` 命名空間，理由寫得很清楚：**後端路徑不能跟 SPA 的頁面路由撞在一起**。那個決定是對的，而且從此新增一個 SPA 用的 router 不需要動任何 proxy 設定。

但這次逐頁檢查時，用無頭瀏覽器實跑每一個頁面，發現兩個頁面在直接載入時回 404：

```
/api-keys        404
/webhook-logs    404
/analytics       200
/activity        200
```

命名空間沒有錯，**錯的是比對規則**。dev 與 production 兩邊都問同一個問題：「這個 URL 是不是以 `/api` 開頭？」

```js
// frontend/vite.config.js
['/api','/webhook',...].some(p => url.startsWith(p))
```

```nginx
# frontend/nginx.conf
location /api { proxy_pass http://backend:8000; }
```

`'/api-keys'.startsWith('/api')` 是 `true`。nginx 的 `location /api` 同樣是前綴比對，`/api-keys` 一樣落進去。於是這兩個頁面的文件請求被轉給後端，後端沒有這條路由，回 404。`/webhook` 對 `/webhook-logs` 也是一模一樣的事。

**為什麼沒人發現。** React Router 在 SPA 內部換頁時根本不會問伺服器——從側邊欄點進 API Keys 是完全正常的。只有「重新整理」「開新分頁貼網址」「書籤」「把連結傳給別人」這幾種情況會真的送出文件請求。也就是說：日常操作永遠是好的，而任何一次分享或重整都是壞的。前後端測試沒有一項涵蓋到「一個頁面路由被請求為文件時會發生什麼」。

實測確認 production 也一樣（用 `frontend/nginx.conf` 起一個 nginx，後端指向真實服務）：

```
/api-keys      -> {"detail":"Not Found"} [404]
/analytics     -> <html>SPA-INDEX</html> [200]
```

這個類別的錯誤還有一個特性：它會隨著新頁面而復發。今天只有兩個頁面中招，但任何一個未來叫 `/apidocs`、`/websocket-settings`、`/health-report` 的頁面都會無聲地掉進同一個洞。

## Decision

**一條後端路徑只能宣告完整的路徑「段」。**

比對規則改成錨定的：一個 URL 屬於後端，只有當它*等於*某個前綴，或在該前綴後面接著 `/` 或 `?`。

1. 這份清單和比對函式抽成 `frontend/backendPaths.js` 一個獨立模組。它不放在 `vite.config.js` 裡面，是因為把 vite 設定 import 進 jsdom 會連 esbuild 一起拉進來而爆掉——而**測試如果自己重寫一份比對邏輯，那它在舊版壞掉的程式上也會通過**，等於什麼都沒測到。抽出來，測試才能跑到真正在跑的那個函式。

2. dev server 的 SPA fallback 和 `server.proxy` 都從這份清單推導。proxy 的 key 改成正規表達式 `^/api(?:[/?]|$)`（Vite 對 `^` 開頭的 key 會當 regex 處理；純字串 key 就是前綴比對，正是問題的來源）。

3. `nginx.conf` 的每個後端 location 改成帶結尾斜線的前綴，或是 `=` 精確比對：

   | 之前 | 之後 |
   |---|---|
   | `location /api` | `location /api/` |
   | `location /webhook` | `location /webhook/` |
   | `location /ical` | `location /ical/` |
   | `location /docs` | `location = /docs` + `location /docs/` |
   | `location /redoc` | `location = /redoc` |
   | `location /ws` | `location = /ws` |

   全部後端路由都在更深一層（`/api/...`、`/webhook/callback/...`、`/ical/{scope}/{token}.ics`），所以帶斜線不會漏掉任何真實路徑。

4. 新增 `frontend/src/__tests__/backendPathClaims.test.js`：從 `App.jsx` 解析出所有頁面路由，對照 `backendPaths.js` 的真實函式與 `nginx.conf` 解析出的 location（含 `=` / 前綴的區別），斷言沒有任何頁面路由被後端宣告走。這條測試經過負向驗證——把兩份設定各自改回舊寫法，它確實會失敗並指名 `['/api-keys', '/webhook-logs']`。

**為什麼不是「把頁面改名」。** 例如把 `/api-keys` 改成 `/keys`。那只是繞過這一次的碰撞，沒有修掉規則；下一個命名接近的頁面還是會中，而且改路由會讓既有書籤失效。問題出在比對規則不夠了解它自己在守護的命名空間，就該修比對規則。

## Consequences

- `/api-keys` 與 `/webhook-logs` 現在可以重整、加書籤、分享連結。dev 與 production 都實測確認。
- 未來新增的頁面路由不再需要避開後端前綴的開頭字母；只要不佔用整個 `/api`、`/webhook` 等路徑段即可。
- 這份清單仍然存在**三個地方**（`backendPaths.js`、由它推導的 vite proxy、`nginx.conf`）。前兩者已經無法分歧；`nginx.conf` 是另一種語言的設定檔，無法共用執行期，因此改由測試把它和前者比對——第四條斷言檢查兩份設定宣告的命名空間一致。
- nginx 的 `/docs` 從一個前綴 location 變成兩個（`= /docs` 與 `/docs/`），因為 FastAPI 同時有 `/docs` 和 `/docs/oauth2-redirect`。
- 服務工作者的 `navigateFallbackDenylist` 原本就寫成 `/^\/api\//`（帶斜線、已錨定），所以裝了 SW 之後的 production 有可能靠 SW 的 navigate fallback 蓋掉這個症狀——這正好說明為什麼要用**首次載入**的行為來判斷，而不是用「我這台看起來正常」。
- 順手修掉一個同一輪掃描發現的無關缺陷：`DeliveryLog` 把「重新整理」按鈕放在「展開」按鈕**裡面**。巢狀 `<button>` 是無效 HTML，內層控制項不會出現在無障礙樹上；原本靠 `stopPropagation` 讓點擊行為看起來正常，等於知道有問題卻繞過去。改成兩個同層的 sibling 之後那個 guard 也不需要了。
- 驗證：前端 360 passed / 47 files，ESLint 乾淨；無頭瀏覽器逐頁掃描 24 條路由 0 例外 0 主控台錯誤 0 失敗請求。
