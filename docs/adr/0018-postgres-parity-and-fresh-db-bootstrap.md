# ADR-0018: PostgreSQL 行為對齊與全新資料庫的 Alembic bootstrap 策略

## Status
Accepted

## Date
2026-07-10

## Context

專案宣稱支援 SQLite / PostgreSQL / MySQL(ADR 見多資料庫支援相關決策),但開發、測試、CI 一直只在 SQLite 上執行。首次將完整 pytest 套件(580 項)對 PostgreSQL 實跑後,發現 19 項失敗,歸納為四類 SQLite 與 PostgreSQL 的行為差異:

1. **Timezone 語意**:model 欄位皆為 `DateTime(timezone=True)`,PostgreSQL 回傳 aware datetime,SQLite 回傳 naive。`scheduler.py` 是唯一還在用 naive `datetime.utcnow()` 的模組,在 PG 上每小時 tick 的 SLA 檢查、到期提醒、recurring 任務全數 crash。
2. **交易中止語意**:PostgreSQL 在任一語句失敗後會中止整個交易(`InFailedSqlTransaction`),後續語句一律被拒;SQLite 則允許繼續。搜尋的 FTS→ILIKE fallback 沒有先 rollback,在 PG 上會讓整個 request 的 session 報廢。
3. **約束強制程度**:PostgreSQL 強制外鍵與 native enum 值;SQLite 預設不啟用 FK、enum 視同字串。部分測試依賴這種寬容(插入孤兒 FK row、無效 enum 值)。
4. **Migration bootstrap**:Alembic chain 的 root revision 是 no-op baseline(schema 由 `create_all` 建立),因此在「全新」資料庫上 `alembic upgrade head` 必然失敗——第一個真實 migration 就對不存在的表做 `ALTER TABLE`。

另外,搜尋 backend 的選擇是讀全域 `DATABASE_URL`,而非 session 實際連線的 dialect,導致測試中(或任何 session 覆寫情境)選錯 backend。

## Decision

1. **全 codebase 統一使用 aware UTC**(`now_utc()` / `datetime.now(UTC)`);`scheduler.py` 改齊。凡是把 DB 載入的 datetime 拿到 Python 端比較/相減之處,以 `_ensure_aware()` 正規化(SQLite 載回 naive、PG 載回 aware,兩者皆需可行)。
2. **搜尋 fallback 前先 `db.rollback()`**,使 session 在 PG 上仍可用;搜尋 backend 改由 `db.get_bind().dialect.name` 解析,而非全域環境變數。
3. **全新資料庫的 bootstrap 策略**:lifespan 啟動時,若偵測為全新資料庫(無 `tasks` 表),`create_all()` 建出完整最新 schema 後自動 `alembic stamp head`。既有資料庫(不論有無 `alembic_version` 表)一律不自動 stamp,避免把未執行的 migration 誤標為已套用。增量變更仍走 `alembic upgrade head`。
4. **依賴 SQLite 寬容行為的測試**改為 dialect-aware:孤兒 FK 測試在強制 FK 的資料庫上 skip;無效 enum 測試改用不落庫的 in-memory 物件驗證純邏輯分支。
5. `conftest.py` 既有的 `TEST_DATABASE_URL` 機制為官方管道:`TEST_DATABASE_URL=postgresql+psycopg://... pytest tests/` 即可對 PG 執行全套測試。

## Consequences

**正面:**
- 全套 580 項測試在 SQLite 與 PostgreSQL 皆綠;PG 路徑經端到端 smoke 驗證(啟動、stamp、GIN index、CRUD、tsquery 詞幹搜尋、備份)。
- 全新 PG(或任何 DB)部署後,後續 `alembic upgrade head` 可正常運作,不需手動 stamp。
- scheduler 在 PG 上不再於每次 tick 崩潰;搜尋失敗不再毒化整個 request session。

**負面 / 代價:**
- naive/aware 的正規化目前靠比較點逐一套 `_ensure_aware()`,新增 Python 端 datetime 比較時需記得使用(SQL 端過濾不受影響)。
- 孤兒 FK 的防禦性程式路徑(webhook retry 標記 dead)在 PG 上實務不可達,僅在 SQLite 下有測試覆蓋。
- CI 尚未加入 PG job;在加入前,PG 相容性仍可能無聲退化(已知風險,留待後續)。
