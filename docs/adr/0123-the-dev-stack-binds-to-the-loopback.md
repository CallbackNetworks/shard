# ADR-0123: 開發用的 port 綁在 loopback，不綁 0.0.0.0

## Status
Accepted

## Date
2026-08-29

## Context

在查另一件事的時候，vite 的 log 裡出現一批找不到檔案的錯誤：`truffle-config.js`、`wormhole.config.js`、`turbo.json`。查下去發現那是**加密貨幣錢包收割掃描**——293 個路徑各掃兩遍（`wallet.json`、`signer.json`、`session-keys.json`、`sweeper/`、`validator/`、`wp-config.php`），2026-08-29 當天四波，大約每小時一次。

反查後端 `:8000` 收到的外部 IP，掃描方是一整群不同的來源，不是單一攻擊者：

| 來源 | 是誰 | 在找什麼 |
|------|------|----------|
| `167.94.146.x`、`66.132.186.x` | Censys | 全網普查 |
| `71.6.146.130` | Shodan (`census.shodan.io`) | 全網普查 |
| `80.82.70.133` | Group-IB | 普查 |
| `69.5.169.x` (`infrawat.ch`) | — | 專門找 MCP：`/mcp/`、`/sse`、`/api/mcp` |
| `93.123.109.234` | 無 PTR | `.env`、`.env.bak`、`.git-credentials`、`.npmrc`、`/actuator/env` |
| `154.90.70.254` | 無 PTR | `GET /v1/models`，找沒鎖的 LLM proxy |
| `45.135.193.198`、`204.76.203.14` | `pfcloud.network` | 大量掃描 |

**這是網路背景輻射，不是有人盯上這個專案。**真正的問題在自己這邊：這台主機的 `eth0` 上就是公網 IP（`23.95.216.156`），前面沒有防火牆，而 dev stack 的 port 全部綁在 `0.0.0.0`：

- **`:8000` 的內部 API 沒有任何驗證。** 本機 `.env` 的 `AUTH_PASSWORD` 是空的（測試需要），所以 `GET /api/decisions`、`GET /api/api-keys` 對全世界回 200。（`api-keys` 只吐 `key_preview`，沒有金鑰本體，所以沒有直接洩漏憑證。）
- **`:5432` PostgreSQL 對外開著**，帳密就是 CLAUDE.md 裡公開寫的 `todo/todo_dev`。
- **`:5173` vite dev server 對外開著。** 排查當下，`GET /@fs/etc/passwd` 確實把檔案內容吐了出來；把容器重建之後同一個請求變成 `403 Restricted`（vite 6.4.3），沒有再重現。無論成因為何，**一個以「只有我自己會連」為前提設計的伺服器不應該擺在公網上**——它的 `/@fs`、原始碼、`package-lock.json` 全部是設計上就對「可信的本機使用者」開放的。

原本綁 `0.0.0.0` 的理由是「要從外面看畫面」。查了才發現那個理由不成立：實際在用的 Cloudflare tunnel 容器（`shard-tunnel`）掛在 `shard_app-network` 上，指向 **`http://frontend:5173`**——它是**用 Docker 服務名走 compose 網路**連進容器的，從來沒有經過主機發佈的那個 port。

## Decision

dev stack 的四個 port 全部改成綁 `${BIND_HOST:-127.0.0.1}`，預設 loopback：

```yaml
- "${BIND_HOST:-127.0.0.1}:${BACKEND_PORT:-8000}:8000"
```

`BIND_HOST` 進 `.env` 與 `.env.example`（照專案規則，compose 不寫死值）。要開回去是改一個字，但那會是一個**刻意**的動作，而不是預設值。

`0.0.0.0` 不是「方便」，它是一個安全決定；而一個安全決定不該是 compose 的預設值順手帶來的。

## Consequences

- 三個 port 從公網消失（實測改完後從公網 IP 連 5173/8000/5432 皆 connection refused），localhost 與 tunnel 都不受影響——改完後 `https://<...>.trycloudflare.com/decisions` 仍是 200。
- 用 `--network host` 的工具（截圖用的 headless Chrome、`scripts/test.sh`、CI runner）照舊，loopback 對它們是同一個位址。
- **Cloudflare tunnel 那條路還在，而且它繞過了這個修正**：透過 tunnel，`/api/api-keys` 依然回 200，因為 vite 的 proxy 會把 `/api` 送進沒有驗證的 dev 後端。tunnel 的網址猜不到，所以掃描器碰不到，但那是「難以發現」不是「有防護」。**要真的關掉，得在 dev 的 `.env` 設 `AUTH_PASSWORD`，或只在需要預覽時才開 tunnel。**這次沒有一併改，因為 `AUTH_PASSWORD=""` 是測試套件的前提。
- MySQL 那個 profile 一起改了，雖然它現在沒在跑——留一個沒改到的當範本，下次就會被複製走。
