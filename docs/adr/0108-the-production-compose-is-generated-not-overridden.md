# ADR-0108: 正式環境的 compose 是生成的，不是覆蓋出來的

## Status

Accepted

## Date

2026-08-22

## Context

ADR-0003 決定了兩件事：**dev 與 prod 使用分離的 Dockerfile**，以及用 Docker Compose 的
**override 檔**（`docker-compose.prod.yml`）把 base 的開發設定換成正式設定。

前半在當時與現在都是對的。後半從一開始就做不到它宣稱的事。

該檔的註解寫著「移除 source mount 與 dev venv volume；image 是自足的」和「無 source mount；
nginx 服務預先建置的靜態檔」。但 **compose override 是合併語意，不是取代語意** —— `volumes:`
與 `ports:` 是列表，override 檔裡的項目會**加到** base 的項目上。`volumes: []` 不會清空任何東西。
渲染 `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` 可以直接看到：

| 註解宣稱 | 實際渲染結果 |
|---|---|
| backend source mount 已移除 | `./backend → /app` 仍在 |
| dev venv volume 已移除 | `backend_venv → /app/.venv` 仍在 |
| frontend 無 source mount | `./frontend → /app` 與 `frontend_modules` 兩者都在 |

後果不只是「沒有生效」，而是**反向生效**：正式 image 是多階段自足建置的，但 bind mount 蓋在
`/app` 上之後，跑的是 host 上的原始碼；`PATH` 指向 `/app/.venv`，而那個 named volume 是 dev image
灌的，所以正式容器跑的是 dev 的 venv。同時 base 的 `0.0.0.0:8000:8000` 被保留，FastAPI 繞過 nginx
全介面可達；base 的 frontend healthcheck 用 `node` 連 5173，而 override 後的 image 是
`nginx:1.27-alpine`，沒有 `node` 也沒有 5173，容器永遠 `unhealthy`。

這個缺陷從未在正式環境造成事故，原因是 **ADR-0008 之後就沒有任何執行路徑在用這個檔案**。
CD pipeline 的 `deploy` job 在 `$DEPLOY_DIR` **生成**一份完整的 compose 檔（只 `expose` backend、
frontend 綁 `127.0.0.1`、無任何 build 與 source mount、image 以 `:sha` 指定），CI 的
`integration` job 則用 `docker-compose.ci.yml` 的 `backend-prod`/`frontend-prod` profile。
`docker-compose.prod.yml` 成了一個壞掉且沒人執行的檔案。

問題在於文件沒有跟上：`CLAUDE.md`、`docs/deployment.md`、`docs/highlights.md` 都還把它列為
正式部署的方式。一個沒人執行的壞檔案不會有失敗症狀 —— 它只會等著讓下一個照文件操作的人踩到，
而那個人拿到的會是一個跑著 host 原始碼、對全介面開放 8000 埠、永遠 unhealthy 的「正式環境」。

## Decision

**移除 `docker-compose.prod.yml`。正式環境的 compose 由 CD pipeline 生成，不由 override 產生。**

理由不是「override 寫錯了、修一修就好」，而是 **override 這個機制本身無法表達這個需求**。
要從 base 移除一個 volume 或 port，compose 沒有提供任何語法；能做到的只有「不要有 base」——
也就是寫一份獨立的完整檔案。而一旦要寫獨立的完整檔案，正式環境那份的正確歸屬地是**部署主機**，
不是這個 repo：它需要 registry 的 image tag、需要 `$DEPLOY_DIR` 的路徑、需要從 Gitea 變數與
secret 渲染出來的 `.env`，這些都是部署時才存在的事實。生成它的地方就是唯一知道這些事實的地方。

因此本 repo 保留三份 compose，各有明確且不重疊的職責：

| 檔案 | 職責 |
|---|---|
| `docker-compose.yml` | 開發堆疊（hot-reload、bind mount、named volume） |
| `docker-compose.ci.yml` | CI 的檢查、測試、以及用 `--profile integration` 跑正式 image |
| *（生成於 `$DEPLOY_DIR`）* | 正式環境 —— 由 `ci.yml` 的 `deploy` job 寫出 |

**ADR-0003 的另一半原封不動延續**：`backend/Dockerfile.prod` 與 `frontend/Dockerfile.prod`
仍然存在、仍然是多階段建置、仍然被 `docker-compose.ci.yml` 與 publish job 使用。
被取代的只有 override 那個機制。

本地要驗證正式 image 的方式改為 CI 用的同一條路徑：

```bash
docker compose -f docker-compose.ci.yml --profile integration up --build backend-prod frontend-prod
```

## Consequences

**正面**

- 不再有一個宣稱做了 A、實際做了 B 的檔案。想知道正式環境長什麼樣，只有一個答案：`ci.yml` 生成的那份。
- 文件不再教人走一條會產生不安全結果的路。照 `docs/deployment.md` 操作的人現在會被導向
  CI 用的同一條指令，那條指令跑的東西與 CI 驗證過的完全相同。
- 本地驗證正式 image 與 CI 的 `integration` job 收斂成同一條路徑，兩者不會再分歧。

**負面 / 代價**

- **沒有「從 working copy 一鍵起正式站」的指令了。** 這是刻意的 —— 那個指令從來沒有真的做到過 ——
  但如果將來需要在沒有 pipeline 的環境手動部署（例如離線安裝），必須另外寫一份獨立的完整 compose，
  而不是再加一個 override。
- 正式環境的 compose 內容只存在於 `ci.yml` 的 heredoc 裡，review 時要讀 YAML 裡的 YAML。
  這是為了讓它與部署邏輯同處一地所付的代價；分開放會讓「生成」與「被生成物」再度漂移。
- `FRONTEND_PORT` 現在只有生成的那份 compose 會讀。`.env.example` 已更新註解說明這件事，
  否則它看起來會像一個沒人用的變數。
