# ADR-0096: 助理要打哪個 provider 是一個執行期設定，不是一個部署決策

## Status

Accepted

## Date

2026-08-17

## Context

`LLM_PROVIDER`／`LLM_API_KEY`／`LLM_MODEL` 從一開始就是行程啟動時讀一次的環境變數（`services/llm.py`）。換 provider、換金鑰、換模型的唯一手段是改部署密鑰再重新部署——在 gitea 是改 repo 的 Variables/Secrets 再觸發一次 `deploy` job，等於每次調整都要走一遍 CI/CD。

`GET /settings` 早就把 `llm_provider`／`llm_model` 讀出來顯示，前端 Settings 頁也有一張「AI Assistant」卡片——只是唯讀的：`InfoRow` 顯示現在跑的是什麼，沒有輸入框，因為 `SystemSettingsUpdate` 用 `extra="forbid"`，`provider`／`model`／`api_key` 根本不是它認得的欄位，寫了也不會生效。這正是 ADR-0011 當初解決過的同一個問題：*一個值只要被使用者觀察到，卻沒有寫入路徑，前端加一個輸入框也沒用，因為 backend 不會再讀第二次*。ADR-0091 把排程時間點（`summary_hour`、`backup_hour`……）從環境變數搬進 `user_preferences`，讓 Settings 頁與 agent 都能不重啟就調；LLM 這三個值當時被留在外面，不是因為它們該留在外面,只是那次沒排進去。

## Decision

新增 `services/llm_settings.py`，比照 `runtime_settings.py` 的形狀：覆寫值存進 `user_preferences`（key `"llm-settings"`），讀取時「資料庫覆寫值 `or` 環境變數預設值」——`provider`／`model`／`api_key` 三個欄位用同一條規則，這也是為什麼 `""`能拿來把某個欄位的覆寫清掉、退回環境變數預設：一個 `or` 同時處理了「一般覆寫」和「清除覆寫」兩件事，不需要另外發明一個清除用的哨兵值。

`services/llm.get_provider()` 從模組載入時讀一次的常數，改成每次呼叫時吃一個 `db: Session`、當場解析出有效設定再建立 client。呼叫端只有 `routers/assistant.py` 的 `send_message`，本來就有 `db`，改法是把 `get_provider()` 改成 `get_provider(db)`。**這就是「不重啟生效」成立的原因**：不是資料庫寫入本身快,是讀取路徑從「行程啟動時的常數」變成「這次請求該讀的值」。

金鑰比照 ADR-0063：**讀出來的永遠不是金鑰本身。** `settings_admin.read()` 回傳 `llm_api_key_configured`（布林），不是 `llm_api_key`。寫入時漏掉 `api_key` 欄位＝不變,傳 `""`＝清除——和 `integration_data.py` 的 `merge_secret_dict` 同一條規則，理由也相同：一個客戶端 GET 了設定、改了 model、PATCH 回去，不能因此把它從沒看過的金鑰洗掉。`test_ops_surface_parity.py` 既有的 `test_settings_carry_no_credential` 掃描回應裡所有欄位名有沒有 `password`/`key`/`secret`；`llm_api_key_configured` 這個名字本身就含有 `key`,所以把斷言改成排除 `*_configured` 這個後綴——它和既有的 `smtp_configured` 是同一種「狀態旗標,不是憑證本身」的形狀,不是這條規則要抓的東西。

兩道門、一個服務,和 ADR-0091 的其餘設定同一個模式：內部 `PUT /api/settings/llm`(瀏覽器用,無 scope)與 `PUT /api/v1/settings/llm`(需要 `admin` scope,理由和 `ical-token` 的 rotate 一樣——這是唯一能設定一把金鑰的門)都呼叫 `settings_admin.update_llm()`。MCP 的 `manage_settings` 工具加一個 `llm_update` action,打同一個 v1 端點;`get`/`bounds` 沿用既有 action,因為 `GET /settings` 本來就把新欄位一起吐出來,不需要另開一個讀的工具。

前端把唯讀的 `InfoRow` 換成 `LlmSettingsPanel`(自己管草稿狀態與 mutation,和 `BackupPanel`/`PasswordForm` 同一個自足元件的形狀):provider 是三選一的 `Segmented`,model 是文字輸入,API key 是密碼輸入,已設定時顯示「留空以保留目前的金鑰」而不是金鑰本身,旁邊有一顆「清除」明確送 `""`。

## Consequences

正面:換 provider、換金鑰不再需要碰 gitea 密鑰或觸發部署——這也是這次改動的起點,使用者原本問的是「能不能像 OpenWebUI 一樣在前端臨時填」,答案從「不行,這是設計」變成「現在可以」。環境變數沒有被拿掉,單純降級成預設值:既有生產環境的 `LLM_PROVIDER`/`LLM_API_KEY`/`LLM_MODEL` 在沒人動過 Settings 頁之前行為完全不變,不需要遷移。

負面與代價:金鑰現在有兩個可能的來源(環境變數、資料庫),`get_effective_llm_config` 是唯一決定「這次到底用哪一個」的地方——任何新的呼叫端要拿有效設定,必須經過它,不能自己拼 `os.getenv`。金鑰存在資料庫裡是明文,和 `Integration.secret`(ADR-0063)同一個既有的安全模型,不是這次改動放寬的;真正需要加密的話,那是另一個決策,影響範圍是所有既存的憑證欄位,不只這一個。
