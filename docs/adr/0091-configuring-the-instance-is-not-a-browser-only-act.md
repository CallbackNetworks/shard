# ADR-0091: 設定這台實例本身，也不能只有瀏覽器做得到

## Status

Accepted

## Date

2026-08-16

## Context

ADR-0084 與 ADR-0085 把「只有瀏覽器能做」的能力清掉了一批：CI/CD 憑證、對外整合、投遞紀錄、規則引擎。當時清的是**跟工作內容有關**的能力。這次把三個表面（內部 `/api` 160 條、`/api/v1` 118 條、MCP 34 個工具）機械比對一遍，剩下的內部獨有路由有 66 條，其中一整類從來沒被檢視過：**這台實例自己的運作方式**。

- `GET /api/settings`、`PUT /api/settings/system` —— 每日摘要幾點寄、「即將到期」往前看多久、提醒冷卻多久、備份開不開、幾點跑、留幾份。ADR-0011 當初特地把這些從環境變數搬進資料庫，理由就是「不必重啟就能改」；結果唯一能改它的是設定頁，在正式環境後面站著 `AUTH_PASSWORD`。一個 agent 可以建立工作、規劃工作、自動化工作、收到通知，就是不能把通知往後挪一小時。
- `/api/backup/*` —— 拍快照、列出快照、還原。這是整個系統裡**最該被自動化**的一件事：知道「等一下這個批次改動有風險」的人，正是應該先拍一張快照的人，而那個人現在多半是 agent。
- `/api/settings/ical-token` 與 rotate —— 一把應用層級的憑證（ADR-0023），和 node 的 share token 同一類，但因為它不屬於任何 node，ADR-0070→0073 那條把分享收斂成一份實作的線沒有掃到它。

比對的過程本身找到一個**活的缺陷**，而且不需要第二道門就已經存在：

```python
# services/runtime_settings.py（修改前）
current[key] = max(lo, min(hi, int(value)))   # 值被夾住
...
if key in FIELD_BOUNDS and value is not None:  # 不認得的 key 被靜靜丟掉
```

`PUT /api/settings/system {"backup_hour": 99}` 回 `200 {"backup_hour": 23}`；`{"backup_hours": 3}`（多一個 s）回 `200`，什麼事也沒發生。這是 ADR-0078 那個「回 201 Created 然後什麼都沒做」的同一種病。它一直沒被發現，是因為唯一的呼叫端是設定頁上的下拉選單和分段按鈕 —— **人用滑鼠選不出 99**。會送出 99 的呼叫端，正是照著計畫組出 payload 的 agent；而它會被告知修改成功了。

## Decision

三個能力各自收斂成一個服務，內部與 v1 兩道門都呼叫它，refusal 由 `ServiceError` 產生、由 `main.py` 那個唯一的 handler 算繪（ADR-0085），所以兩道門不可能對同一次拒絕給出不同答案。

- `services/settings_admin.py` —— 讀（含 `auth_mode`、LLM provider、SMTP 是否設定，這些是從 process 狀態組出來的，寫在 router 裡就會被組兩次）、寫、以及 iCal token 的讀取與輪替。
- `services/backup_admin.py` —— status / run / export / download / restore，檔名樣式與 `confirm="replace"` 這道關卡都住在這裡，所以第三道門不可能在沒有它們的情況下被寫出來。

**夾值改成拒絕。** 超出範圍是 422，不是靜靜夾住；不認得的欄位是 422，不是靜靜忽略（`SystemSettingsUpdate` 用 `extra="forbid"`）。超出範圍是**請求自我矛盾**，不是世界的狀態，所以是 422 而不是 400 —— 和 ADR-0055 那條「條件問了觸發事件永遠不會提供的東西」同一個判準。同時新增 `GET /settings/bounds`，把寫入路徑實際執行的 `FIELD_BOUNDS` 直接供出去：一個客戶端看不到的值域，就是 ADR-0056 說的那個「一個空白框後面藏著 18 種意思」。

**scope 依回應裡帶了什麼決定，不依這件事感覺起來多嚴重。**

- `read`：設定內容、值域、備份的排程與清單。這些描述備份，不交出備份。
- `admin`：所有寫入，**以及所有會交出一份資料庫拷貝的讀取**。export 不是一份關於資料的報告，它*就是*那份資料，包含 ADR-0059 特地擋在一般回應之外的每一個 share token、callback token 與簽章金鑰。設定寫入也是 `admin`，因為 `backup_enabled` 和 `backup_keep` 決定的是這個系統還救不救得回來。

iCal token 走 ADR-0087 的規則：token *就是*訂閱網址，交出去等於交出整份行事曆，而輪替會讓每一個已訂閱的客戶端停止更新 —— 所以是 `admin`。回傳的是 `path` 不是完整 URL，理由同 ADR-0084：反向代理後面，伺服器對自己 origin 的認知只是上一跳說了什麼，而發問的人本來就知道真正的那個。

還原提供兩個入口一份實作：SPA 送 multipart，agent 送 base64 JSON，落在同一個 `restore_bytes` —— 就是 ADR-0086 給附件的那個形狀，確認關卡因此只存在一份。**下載備份刻意不做成 MCP 工具**：把整個資料庫塞進模型的 context 沒有用途，只有風險；需要的人用 `GET /api/v1/backup/export`。

守門測試 `tests/test_ops_surface_parity.py` 對著同一個資料庫送兩道門，比對**狀態碼與 detail 文字**，並且把一道門寫進去的狀態從另一道門讀回來 —— 因為「兩道門都回 200」正是一份漂移的重複實作也會有的表現（ADR-0087）。夾值那條有自己的測試，斷言的是「儲存的值沒有變成沒有人要求過的數字」。

## Consequences

正面：一個 agent 現在可以在動手之前先拍快照、可以把每日摘要挪到使用者真正會看的時間、可以查出備份其實從三週前就沒跑了。設定寫入不再會謊報成功。iCal token 加入了「憑證有一個刻意、會被記錄的取得路徑」這個既有規則。`settings_admin` 讓「SMTP 有沒有設定」只有一個答案的來源。

負面與代價：**這是一次行為改變** —— 以前會被接受並夾住的設定寫入現在回 422。前端所有輸入都是受限的下拉與分段按鈕（值域內），所以 UI 不受影響，但任何手刻的 curl 腳本如果依賴夾值就會壞掉；這正是我們要的。另外 `/api/v1` 現在有一條會回傳整個資料庫的路由：它要 `admin`，但這確實把「一把 admin key 外洩」的後果從「可以呼叫每一個 API」提高到「可以一次拿走全部資料，包含所有 token」。這個交換是刻意的 —— 沒有還原路徑的備份能力沒有意義，而備份能力不能只有瀏覽器有。
