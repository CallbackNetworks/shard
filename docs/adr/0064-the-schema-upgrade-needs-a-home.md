# ADR-0064: 升級 schema 這件事需要一個歸屬

## Status
Accepted

## Date
2026-08-06

## Context

`CLAUDE.md` 是這樣描述 migration 的：

> On a fresh database the lifespan runs `Base.metadata.create_all()` and stamps the Alembic chain to `head`; on an existing database, run `alembic upgrade head` for schema changes.

前半句有人做。**後半句沒有任何人做。**

三個地方互相印證：

- `.github/workflows/ci.yml` 的 deploy job 步驟是 pull images → `up -d` → health check → verify frontend → `ps`。沒有 alembic。
- `backend/Dockerfile.prod` 的 CMD 直接是 `uvicorn`，沒有 entrypoint script。
- `backend/app/main.py` 的 lifespan 只在資料庫是新的時候 **stamp**，不 upgrade。

所以 production 的 `data/shard.db` 自建立那天起，schema 就停在當時的 head。`create_all()` 每次開機會補上**缺少的表**，但它永遠不會補欄位，也永遠不會跑資料回填。那句文件不是錯的——它描述的是一個需要有人手動執行的步驟，而在一條全自動的 deploy pipeline 裡，**一個需要有人主動執行的步驟，就是一個沒有人執行的步驟**。

這和 ADR-0060 的鎖是同一個形狀：機制齊備、文件正確、就是沒有觸發者。

代價已經在線上發生了。最近兩支 migration 都是純資料的，不動 schema，所以 production 照常運作，只是東一塊西一塊地不對：

| Migration | 內容 | production 的實際狀態 |
|---|---|---|
| `c2e4a6b8d0f1` (ADR-0055) | 把 `task.status_changed` / `task.priority_changed` / `task.label_added` 改寫成 graph-shaped trigger | 規則裡還存著已退役的 trigger 名字，等於永遠不會觸發 |
| `d4f6a8c0e2b3` (ADR-0060) | 給每個帶 `callback_token` 的 node 發 `webhook_secret` | task 全都沒有 secret，而 ADR-0060 已經讓沒簽章的 callback 一律拒收 → **所有 inbound CI/CD callback 被擋** |

第二列是一次真正的線上故障，而且沒有任何告警：CI 那端看到的是被拒絕的請求，這端看到的是什麼都沒發生。

### 為什麼不能直接把 upgrade 放進 lifespan

那是最短的修法，而且是錯的。production 跑 `uvicorn --workers 2`，lifespan **每個 worker 各跑一次**。兩個 worker 同時 upgrade 會讀到同一個起始 revision、跑同一批 migration 兩次。`create_all()` 和 `stamp` 撐得住重複執行，`upgrade` 撐不住。

### 為什麼也不能無條件在 deploy 跑 upgrade

chain 的根 `d30b32886576` 是一個 no-op baseline，它假設 schema 已經存在。對一個**還不存在**的資料庫跑 `upgrade head`，baseline 什麼都不做，接著每一支 `ALTER TABLE` 都會打在沒有人建立過的表上。全新環境的第一次 deploy 會直接炸掉。

所以這兩種情況需要**相反**的處理，而判斷它們的依據只有一個：這個資料庫已經有 schema 了嗎。

### 判斷本身也是壞的

原本的判斷是 `main.py` 裡的這一行：

```python
fresh_db = not sa_inspect(engine).has_table("tasks")
```

`tasks` 這張表在 graph migration（ADR-0032）把它併進 `nodes` 之後就不存在了。這一行**在每一次開機都回傳 True**——它認為每一個資料庫都是新的。它待在原處是無害的，因為它守著的 stamp 還有第二個條件 `not has_table("alembic_version")` 擋著；但只要有人把它讀成「這個資料庫是不是新的」並據以決定要不要 upgrade，deploy 步驟就會對**每一個真正需要升級的資料庫**印出「這是新的資料庫」然後跳過。

這個缺陷不是靠讀程式碼發現的，是靠一條斷言「探測用的那張表必須是現行 schema 真的有的表」的測試發現的。

## Decision

**把這個判斷收進一個模組 `backend/app/db_schema.py`，讓應用程式和 deploy pipeline 讀同一份，各自只做自己那一半。**

模組認得三種狀態，而不是兩種：

| 狀態 | 判斷依據 | 處理 |
|---|---|---|
| `FRESH` | 沒有 `nodes` 表 | 不動。應用程式開機時 `create_all()` + stamp head |
| `MANAGED` | 有 `nodes`，也有 `alembic_version` | `alembic upgrade head` |
| `UNTRACKED` | 有 `nodes`，沒有 `alembic_version` | **拒絕，回傳非 0**。表已經在了所以它不是新的，但沒有任何紀錄說它跑過哪些 migration，stamp 和 upgrade 都只能用猜的 |

第三種狀態是這個設計的重點。把它併進前兩者的任何一種都是在替使用者猜，而猜錯的代價是一個半升級的 schema。它應該停下來要一個人來看。

升級由 deploy job 執行，位置在 pull images 之後、`up -d` 之前：

```yaml
- name: Apply database migrations
  run: |
    docker compose -f "$DEPLOY_DIR/docker-compose.yml" stop backend
    docker compose -f "$DEPLOY_DIR/docker-compose.yml" run --rm --no-deps backend python -m app.db_schema
```

先 `stop backend`，是為了讓資料庫在被改寫的那段時間裡沒有任何行程正在讀它。deploy 本來就會重啟容器，這一步不額外增加停機時間，但把「舊版程式短暫看到新 schema」這個窗口關掉了。

失敗時整個 deploy 失敗，舊版繼續服務——這比讓一個半升級的資料庫開始接流量好。

## Consequences

**正面**

- production 的 schema 和資料回填會自動跟上，這是這條 pipeline 上線以來第一次成立。
- 補跑 `d4f6a8c0e2b3` 會修好被擋掉的 inbound callback；補跑 `c2e4a6b8d0f1` 會讓存量規則重新會觸發。
- `fresh_db` 那個從 ADR-0032 起就一直回傳 True 的探測被修好了，而且現在有一條測試釘住「探測的表必須真的在 schema 裡」。
- 新環境的第一次 deploy 仍然可行——`FRESH` 會把建立 schema 留給應用程式。
- 判斷只有一份。`main.py` 和 deploy 步驟讀的是同一個 `schema_state()`。

**負面 / 代價**

- 每次 deploy 多一次容器啟動，以及 `stop backend` 帶來的數秒停機。對一個個人工具可以接受，對需要零停機的部署就不夠了。
- migration 只在 deploy 時跑一次，這假設 production 只有一個 backend 容器。要水平擴充就得改成有鎖的方案。
- 這次補跑是**一次性的追趕**，跨越了不知道多少支 revision。如果 `create_all()` 曾經先建好某張後續 migration 也要建的表，`upgrade head` 會以 "table already exists" 失敗。第一次執行前必須備份，並且要有人看著。
- `UNTRACKED` 會擋下 deploy 而不是自己想辦法。這是刻意的，但代價是那種情況需要人介入。

**尚未處理（本 ADR 不涵蓋）**

- production 回報的 `n.find is not a function` 還沒定位，尚不確定是否源自這裡的 schema 漂移。
- deploy 產生的 `.env` 樣板沒有 `SECRET_KEY`、`CORS_ORIGINS`、`BACKUP_*`、`MCP_*`。備份因此走預設值（開啟、03:00 UTC、保留 7 份）尚可，其餘幾個值得另外檢查。
- 開發用的資料庫有 29 張表，而 models 只宣告 21 張——8 張是歷次遷移留下的孤兒表。無害，但沒有人清理過。
