# ADR-0036: 內部 API 收斂到 `/api` 前綴,消除前端路由與後端路徑的碰撞

## Status
Accepted

## Date
2026-07-18

## Context

前端是單頁應用(SPA),用 React Router 在瀏覽器內做客戶端路由;後端是 FastAPI。兩者同源部署,靠一個「總機」分派請求:**dev 是 vite dev server**(`vite.config.js` 的 `server.proxy` + SPA fallback `isProxied`),**prod 是 nginx**(`frontend/nginx.conf`,跑在前端容器內,`Dockerfile.prod` `FROM nginx`)。

問題根源:**內部 API 路由散在 root**(`/projects`、`/settings`、`/analytics`、`/nodes`、`/graph-types`…),而前端頁面路由**剛好同名**(`/projects/:id`、`/settings`…)。伺服器只看網址,分不出「使用者要看畫面」還是「程式要資料」,預設把這些路徑當後端 API。後果有二:

1. **硬重新整理 / 深連結 / 分享網址 → 回傳 JSON 或 404**,而非 app 畫面(在 app 內點擊導航因為是客戶端路由所以無感)。過去只對 `/activity`、`/decisions` 兩條用 `Accept: text/html → 418 → @spa` 的嗅探技巧個別補過。
2. **每新增一條後端路由要同步三個地方**(vite `server.proxy`、vite `isProxied`、`nginx.conf`),CLAUDE.md 只提了前兩個 → graph 遷移期的 `/graph-types`、`/nodes`、`/tasks` 與備份 `/backup` 漏了 nginx,正式環境會壞(見 [[project_graph_foundation_todo]] 的驗證發現)。

`Accept` 嗅探是權宜補丁:靠猜、且要逐條手動維護。**規範解是讓前端路由與後端路徑從命名空間上就不可能碰撞** —— 把內部 API 收斂到單一前綴。生產尚未上線,是做此跨層重構最便宜的時機。

## Decision

**所有前端 SPA 消費的內部 API 收斂到 `/api/*` 前綴;外部合約與基礎設施維持 root 路徑。**

- **搬到 `/api`(約 30 個 router):** projects、tasks、nodes、graph-types、identities、goals、analytics、settings、integrations、labels、cycles、comments、attachments、api-keys、activity、search、workflow-rules、assistant、templates、saved-filters、notifications、cicd、decisions、backup、deliveries、webhook-logs、bulk、imports、recurring、**auth**。做法:`main.py` 用一個 `APIRouter(prefix="/api")` 收納這些,`app.include_router(api_router)`。
- **維持 root(外部合約 / 基礎設施):** `/api/v1/*`(外部 API,本就在 /api 傘下)、`/webhook/*`(CI/CD 回呼)、`/webhook/issues/*`(issue sync)、`/share/*`(公開分享頁 + 資料)、`/ical/*`(行事曆訂閱)、`/ws`、`/health`、`/docs`、`/openapi.json`、`/redoc`。`bulk.py` 內的 `/ical` 路由拆到獨立 `ical_router` 留在 root。
- **Auth middleware:** bypass 清單 `/auth/` → `/api/auth/`。`/api/v1/`(外部 key 驗證)維持 bypass;`/api/projects` 等不在 bypass → 照常受人用 auth 保護。
- **前端:** 單一 axios 實例 `axios.create({ baseURL: '/api' })`(一行);公開分享的 plain-axios 呼叫維持 `/share`;`AuthContext` 的 plain-axios `/auth/me`、`/auth/login` 顯式改 `/api/auth/*`;ws 用 `window.location.host/ws` 不變。
- **vite proxy / nginx:** 從約 30 條縮為 `/api` + `{/webhook, /share/(identity|project), /ical, /ws, /health, /docs, ...}`;SPA fallback 變成單一 `try_files … /index.html`。`/activity`、`/decisions` 的 `Accept` 嗅探 hack 移除。

## Consequences

**正面:**
- **前端頁面路由與後端路徑永不碰撞** —— 硬重新整理、深連結、分享網址全部正確回 SPA(徹底解掉舊的 F5/deep-link 問題,不再需要 per-route 的 `Accept` 嗅探)。
- **新增後端路由的維護面收斂**:內部路由自動在 `/api` 下,vite/nginx 皆為單一 `/api` 規則,不再需要逐條同步三處。
- dev(vite proxy)與 prod(nginx)分派規則同構、極簡,不易再漏。

**負面 / 代價:**
- 一次性大協調改動:後端 `main.py` 路由掛載 + 前端 baseURL + vite + nginx + **約 400 處測試 URL 加 `/api`**(機械式,腳本處理)。屬 big-bang(API 命名空間遷移本質無法半遷),但已用雙 DB 全測 + 前端 vitest + 真實瀏覽器硬導航 + prod image 冒煙擋住風險。
- 少數非端點的路徑字面(usage-tracker 的 `_normalize_path` 單元測試、notifier 產生的**前端** deep-link `/projects/{id}`)刻意保留 root。
- `/api/api-keys`、`/api/api/v1`?否 —— 外部 API 仍是 `/api/v1`(未再加前綴),內部 `api-keys` 變 `/api/api-keys`(可接受)。
