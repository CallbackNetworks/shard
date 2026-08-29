# ADR-0124: dev 也要有密碼，因為 tunnel 繞過了綁定

## Status
Superseded by ADR-0125

## Date
2026-08-29

## Context

ADR-0123 把 dev stack 的 port 綁回 loopback，把三個 port 從公網移除。**但它沒有解決全部的問題，而且它對「為什麼沒解決」的解釋是錯的。**

那份 ADR 的 Consequences 寫著「要真的關掉，得在 dev 的 `.env` 設 `AUTH_PASSWORD`……這次沒有一併改，因為 `AUTH_PASSWORD=""` 是測試套件的前提」。**這個理由是假的，沒查就寫了。** `backend/tests/conftest.py` 第 4 行自己就寫 `os.environ["AUTH_PASSWORD"] = ""`，在 app import 之前執行——測試套件從來不讀 `.env` 的那個值。設密碼對測試零影響。

而剩下的洞是真的。常開的 Cloudflare tunnel 走 compose 網路連進 `frontend:5173`，**不經過主機發佈的 port，所以 ADR-0123 完全管不到它**。實測（建一個 probe 節點再刪掉）：

```
POST   /api/nodes         -> 201    任何拿到連結的人都能建資料
DELETE /api/nodes/{id}    -> 204    也能刪
GET    /api/settings      -> 200
GET    /api/backup/status -> 200    同一個 router 還有 /backup/export 與 /backup/restore
```

vite 的 proxy 把 `/api` 原樣送進 dev 後端，而 dev 後端的 `AUTH_PASSWORD` 是空的。也就是：**匯出整個資料庫、再覆蓋回去，都在那個網址後面。**

一度考慮過拆一個獨立的 demo 站（跑 CD 發佈的 `:latest` 映像、自己的資料、自己的密碼）。結論是不需要：程式碼那面它買不到任何東西（跟正式站同一份映像），而它唯一真正解決的問題——「不想把真實資料的寫入權交給看 demo 的人」——在「當下自己展示」這個使用方式下並不存在。**多一個要餵資料、要維護、要記住它存在的實例，是這個專案一路在拒絕的東西。**

## Decision

dev 的 `.env` 設一組強密碼的 `AUTH_PASSWORD`。

不是因為 dev 需要驗證——它綁在 loopback 上——而是因為**有一條刻意打開的、常開的公開入口指著它**，而那條入口不受綁定管轄。密碼是這個 app 對「這個入口是公開的」唯一的答案（ADR-0030），tunnel 就是那個入口。

`.env` 是 gitignored 的，所以密碼不進版控；`.env.example` 維持空值，因為**全新 checkout 的預設狀態是沒有 tunnel 的 loopback-only，那個狀態下密碼是多餘的**。要開對外入口的人，才需要設它。

## Consequences

- 那個常開網址現在對每個 `/api/*` 回 401，寫入與匯出都關上了。`/health`、`/share/`、`/ical/`、`/api/v1/`（API key 是它自己的憑證）、`/docs` 依 ADR-0085 的豁免清單維持原狀。
- **測試套件不受影響**，`conftest.py` 自己覆寫。`e2e` profile 走 `/api/v1` + API key，也不受影響。
- **開發時的瀏覽器驗證多一步。** 用 headless Chrome 截圖前要先拿 token：`POST /api/auth/login {"password": …}`（**路徑在 `/api` 底下**，ADR-0036；打 `/auth/login` 會被中介層擋掉並回一個看起來像密碼錯誤的 `{"detail":"Unauthorized"}`），再把它寫進 `localStorage.auth_token`，另外設 `localStorage.auth_mode = 'required'`。
- vite dev server 依然會對那個網址吐原始碼（`/package.json`、`/src/**`）——那不是 app 的一部分，`AUTH_PASSWORD` 管不到。開著一條指向 dev server 的公開入口，就是接受這件事。
- 不做 demo 站。要給外人看單一專案而不給密碼的路徑已經存在：分享連結（ADR-0070→0073），唯讀、可加 PIN、可設到期。
