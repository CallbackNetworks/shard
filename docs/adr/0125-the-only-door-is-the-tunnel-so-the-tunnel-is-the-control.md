# ADR-0125: 唯一的入口是 tunnel，所以控制點就在 tunnel

## Status
Accepted

## Date
2026-08-29

## Context

ADR-0124 給 dev 的 `.env` 設了 `AUTH_PASSWORD`，理由是常開的 Cloudflare tunnel 繞過 ADR-0123 的 loopback 綁定。技術上成立，但它在同一天就被使用者退回了，理由是**密碼讓開發時的截圖驗證變麻煩**。

那個成本的實際大小要說清楚，因為它是這個決定唯一的根據：登入是 5 行、已經寫好也驗證過（`POST /api/auth/login` 拿 token → 寫 `localStorage.auth_token`）。它不是阻礙。但 dev 環境的摩擦由使用者承擔，值不值得由使用者判斷，不由寫它的人判斷。

重點是 ADR-0124 之後有一件事變了：**它原本要防的那個場景消失了。** 0124 寫的時候，計畫是「常開一個 demo 網址給別人看」——會有第三方長期持有那個連結。使用者隨後決定不做 demo 站，改成「要看的人我當下展示」。於是那個網址不再是發給別人的東西，而是使用者自己看畫面的路徑。

現在的實際暴露面（實測）：

- 公網 IP 的 `5173` / `8000` / `5432` 全部 connection refused（ADR-0123）。掃描器碰不到任何東西。
- **唯一的入口是那條 quick tunnel**，網址隨機、每次容器重啟就換一個，沒有對外公告過。
- 進得去的人可以讀寫刪 dev 的種子資料，並碰得到 `/api/backup/export`。那是 dev 的拋棄式資料，不是正式站的（正式站在另一台 `cd-deployer`，有自己的 `AUTH_PASSWORD`，這裡的任何設定都影響不到它）。

## Decision

**dev 的 `AUTH_PASSWORD` 清空**，回到 ADR-0123 之後、ADR-0124 之前的狀態。ADR-0124 標記為被本篇取代。

改用的控制點是 tunnel 本身：**沒有 tunnel 就沒有入口**（`docker stop shard-tunnel`），要看畫面時再開。這比密碼更貼近實際情況——問題從來不是「誰進得來要驗證」，而是「有沒有一扇門」。少一個要記的秘密，也少一個開發時的步驟。

後端啟動時已經會印出這件事，不需要另外加提醒：

```
No login gate: AUTH_PASSWORD and AUTH_PROXY_HEADER are both unset, so anyone who
can reach this port has full access to /app. Fine on a private machine; set
AUTH_PASSWORD before publishing the port.
```

## Consequences

- **拿到那條 tunnel 網址的人，對 dev 資料有完整寫入權**，直到 tunnel 重啟換網址為止。這是明知並接受的：資料是拋棄式種子資料，網址沒有公開過，而公網 port 已經關了。
- 正式站不受影響。
- 截圖驗證回到不必登入。ADR-0124 記下的登入步驟仍然正確，哪天再設密碼就照那個做（筆記留著）。
- **如果哪天又要把網址發給別人**——不管是 demo、回報問題還是給人看畫面——`AUTH_PASSWORD` 要跟著回來。這一篇的成立條件是「那個網址只有我自己在用」，條件變了，結論就要跟著變。
- 給外人看單一專案而不交出任何權限的路徑一直都在：分享連結（ADR-0070→0073），唯讀、可加 PIN、可設到期。
