# ADR-0020: SQLite 與 PostgreSQL 作為對等的測試目標

## Status
Accepted

## Date
2026-07-11

## Context

ADR-0018 修復了 SQLite/PostgreSQL 的行為差異,並(在後續提交中)加了一個對 PostgreSQL 跑測試的 CI job。但那個結構把 SQLite 當「主」、PostgreSQL 當「附加的 parity 檢查」:

- SQLite 的 `backend` job 同時做 lint、format、coverage 門檻(≥70%)、pip-audit;PostgreSQL 的 job 只跑光禿禿的 `pytest`,沒有 coverage 門檻。
- 命名 `Backend tests` vs `Backend tests (PostgreSQL)` 暗示前者才是正牌測試。
- 本地開發沒有任何一鍵對 PostgreSQL 跑測試的方式,SQLite 是唯一預設。

專案宣稱支援多資料庫(見 CLAUDE.md、ADR-0018),但實務上兩者待遇不對等,PostgreSQL 的迴歸只會被「順帶」抓到,且各自的 dialect 專屬程式路徑(SQLite FTS5 vs PostgreSQL tsvector)只在自己的 DB 下才被覆蓋,coverage 意義不完整。使用者要求兩個資料庫「平行且平等」。

## Decision

把兩個資料庫定位為**對等、對稱的一等測試目標**,涵蓋 CI 與本地:

1. **CI 拆成三個 backend job**:
   - `Backend checks` — 與 DB 無關的 lint / format / pip-audit,只跑一次。
   - `Backend tests (SQLite)` 與 `Backend tests (PostgreSQL)` — 對稱:跑相同的測試套件、相同的 `--cov-fail-under=70` 門檻,名稱並列。
   - 兩個測試 job 皆為 `integration` 的前置依賴,因此**任一資料庫的失敗或覆蓋率不足都會擋下 publish/deploy**,沒有主從之分。
2. **本地對等**:新增 `scripts/test.sh {sqlite|postgres|both}`(預設 both),對 dev stack 一鍵跑任一或兩個資料庫。PostgreSQL 使用獨立的 `shard_test` 資料庫,與 app 的 `shard` 資料完全隔離(conftest 每個測試 `create_all`/`drop_all`,不可指向正式資料)。選用 shell script 而非 Makefile,因為開發機不保證有 `make`,且 CLAUDE.md 禁止在 host 安裝套件——bash 與 docker 已是既有依賴。
3. **conftest 維持 `TEST_DATABASE_URL` 為唯一切換點**,SQLite in-memory 為預設,兩條路徑共用同一組 fixture 與測試碼。

## Consequences

**正面:**
- 兩個資料庫獲得相同的把關強度(測試 + 覆蓋率),PostgreSQL 迴歸不再是二等公民,且會阻擋部署。
- 本地開發者可零摩擦地對兩個資料庫驗證,CI 與本地行為一致。
- DB 無關的檢查不再重複執行,runner 時間不浪費。

**負面 / 代價:**
- backend 的 CI job 從 1 個變 3 個,總 job 數增加;分支保護若設了必要檢查(required status checks),需更新為新的 job 名稱。
- PostgreSQL 測試 job 每次多約 6 分鐘(起 PG + 完整套件),在 capacity=1 的 runner 上會拉長整體 pipeline;可接受,因為它現在是 deploy 的把關者。
- 兩個資料庫各自的 coverage 都需 ≥70%;dialect 專屬分支(如搜尋後端)在對方 DB 下不被覆蓋,故門檻是以「各自獨立達標」為準,而非合併覆蓋率。
