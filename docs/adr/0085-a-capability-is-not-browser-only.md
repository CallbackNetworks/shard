# ADR-0085: 一個能力不能只有瀏覽器做得到

## Status
Accepted

## Date
2026-08-16

## Context

ADR-0084 補上了「讀出 CI/CD 回呼憑證」的 API 門，然後我們回頭把三個表面（內部 `/api`、`/api/v1`、MCP）整個列出來比對。結果不是只有一個洞。

### 一、`/webhook/events/{task_id}` 完全不需要驗證

`main.py` 的 `_AUTH_BYPASS` 是以**路徑前綴**為單位的，而且必須如此：CI runner 帶不了 owner 的 session、分享連結是給沒有帳號的人看的、健康檢查沒有身分。這些端點各自證明自己 —— `POST /webhook/callback/{token}` 用的是 token 加上一個對 body 的 HMAC 簽章（ADR-0060）。

但 build history 是後來加進 `routers/webhooks.py` 的，它什麼都不檢查，只是因為**和一個已經賺到豁免權的端點共用前綴**而繼承了豁免。production 實測：

```
/webhook/events/{uuid}  -> 404   ← handler 真的執行了
/api/nodes/{uuid}       -> 401   ← 密碼閘擋下
```

拿到任何 node id 的人就能讀它的建置歷史。這是 ADR-0059 的同一個形狀：規則長在路徑上，而不是長在端點做的事情上。

### 二、它唯一的呼叫者一直呼叫錯 URL

`frontend/src/api/client.js` 的 axios instance `baseURL` 是 `/api`（ADR-0036），而 `getWebhookEvents` 送的是 `/webhook/events/${taskId}` —— 也就是 `/api/webhook/events/...`，一條**不存在的路由**。`BuildHistoryPanel` 從來沒有載入成功過。和 ADR-0058 的 burndown、ADR-0071 的 share fetch 是同一類：一個對照後端路由表看起來正確、對照發出請求的 client 卻是錯的路徑。

### 三、delivery log 把憑證用第二條路送出去

`WebhookDelivery.request_headers` 記錄外送請求的 headers，redaction 只有一行：`k.lower() in ("authorization",)`。那在 bearer 是唯一 auth type 的年代是對的。現在 `auth_type="api_key"` 會把金鑰放進**使用者自己命名的** header（預設才是 `X-API-Key`），而 `custom_headers` 是一個使用者可以塞任何東西的自由字典。兩者都以明文寫進 delivery log 並被服務出去 —— ADR-0063 在 integration 讀取時遮蔽的那些值，從另一條路走了出去。

### 四、三分之三的自動化機制沒有 agent 進得去的門

- **workflow rules**：整個規則引擎（ADR-0047→0056）—— CRUD、`/vocabulary`、dry-run —— 只有內部 `/api`。agent 可以手動執行一萬次寫入，卻連一條「以後自動做」都設不起來。
- **integrations**：`/api/v1` 只有 `/subscriptions`，那是這個表面被釘死三處的版本（type 永遠是 webhook、名字永遠加前綴 `agent:{key}:`、憑證和 templates 碰不到）。email 型、簽章 secret、`auth_config`、`custom_headers`、templates、test 全部不可達。
- **delivery log**：設定了 callback 卻讀不到它有沒有送到。webhook 的失敗模式就是沉默，而沉默正是從發送端唯一無法察覺的東西。
- **CI/CD trigger**：`/cicd/trigger/*` 沒有任何 v1 門。剛寫完程式的 agent 跑不了自己的 pipeline。

還有 ADR-0084 自己漏掉的一半：只有輪替**簽章金鑰**（`rotate-secret`），沒有輪替**回呼位址**（`callback_token`）。後者只存在於一條 task-only 的內部路由 `POST .../regenerate-token`。金鑰外洩有救，URL 外洩沒救 —— 而 URL 才是那個會出現在 pipeline 設定、proxy log 和截圖裡的東西。

`/api/v1/subscriptions` 一直都存在，代表「agent 是合法的設定者」從來就是既定立場。缺的不是決定，是門。

## Decision

### 每一個要開兩扇門的能力，先抽成一個 service

`webhook_credentials`、`cicd_dispatch`、`integration_admin`、`delivery_admin`、`rule_admin`。router 只留真正屬於自己那扇門的東西：404、以及**誰可以問**。

配套一個 `services/errors.py`：service 丟 `ServiceError(status_code, detail)`，`main.py` 註冊**一個** handler 把它算繪成 `{"detail": ...}`。兩扇門拿到一模一樣的拒絕，因為兩扇門都沒有自己寫拒絕。用 `HTTPException` 做不到這件事（那是 FastAPI 的概念，service 丟不了，於是拒絕又回到 router 寫兩份）；用裸 `ValueError` 也做不到（每個 router 各自重新決定該回哪個狀態碼，同一個分叉往下移一層而已）。

### `/webhook/` 只留 runner 會 POST 的東西

build history 搬到 `GET /api/nodes/{id}/webhook-events` 和 `GET /api/v1/nodes/{id}/webhook-events`。前端跟著改到 `/api` 命名空間下 —— 順帶修好一個從來沒運作過的面板。

配一個守則測試 `tests/test_unauthenticated_surface.py`：從 `app.openapi()` 列出**所有**不需憑證就會回應的路由，逐一比對一張寫著理由的清單。新增一個公開端點沒有被禁止，但它必須被寫進那張清單，寫在理由旁邊。這和 ADR-0059 的 redaction 規則同一個形狀：不變式是關於「表面」的，就對著表面檢查，而不是信任每一個作者。

（讀 `app.openapi()` 而不是自己走 `app.routes`：這個 FastAPI 版本把 included router 留成巢狀節點，需要重組前綴才拼得出路徑，而一個會重組路徑的測試也可能重組錯 —— 那正是 ADR-0061 記下的那次差點失手。這裡是直接問 app 它公開了什麼。）

### delivery log 的遮蔽由 integration 推導，而且在讀取時也做一次

哪些 header 是憑證，不是比對一張「可能的名字」清單，而是從 integration 本身推導：`auth_config["header_name"]` 加上 `custom_headers` 的每一個 key。寫入時遮蔽，**讀取時再遮蔽一次** —— log 寫一次讀一輩子，只修寫入端會留下每一筆歷史資料繼續外洩。

### 三個新的 v1 表面，scope 沿用既有先例而不是另立新規

| 表面 | 讀 | 寫 |
|---|---|---|
| `/api/v1/cicd/trigger/*` | — | `write` |
| `/api/v1/integrations`、`/deliveries` | `read` | `write`（purge log 是 `admin`） |
| `/api/v1/workflow-rules` | `read` | `write` |
| `/api/v1/nodes/{id}/webhook*`（ADR-0084） | `admin` | `admin` |

`integrations` 用 `write` 而不是 `admin`，因為 `/subscriptions` 建立的是同一個 object、一直都只要 `write`。讓一般形式比它的語法糖更嚴格，等於同一個問題有兩個答案 —— ADR-0079 指出的正是這個缺陷。

workflow rules 用 `write`，因為規則的 action 就是普通寫入：設欄位、加減標籤、加註解、對**已經存在的** integration 發事件（`rules_engine._exec_action`）。一把能寫的金鑰不會因此拿到新的觸及範圍，它拿到的是**持續性**，而那正是這個功能的意義。

CI/CD trigger 用 `write`：外部效果是有的，但那是對一個「憑證由呼叫方在 request 裡自帶、平台不儲存」的系統造成的效果 —— 和交出**我們自己的**回呼憑證（那是 ADR-0084 判定為 admin 的管理動作）不是一回事。

### MCP 加七個工具，共 33 個

`trigger_pipeline`、`list_integrations`、`manage_integration`、`list_deliveries`、`retry_delivery`、`get_rule_vocabulary`、`manage_workflow_rules`；`manage_webhook` 的 action 擴成 `reveal` / `rotate_secret` / `rotate_token` / `history`。

`get_rule_vocabulary` 對 agent 比對它原本服務的編輯器更重要：agent 沒有下拉選單擋著它，這是它和「一條存得下去、卻永遠不會觸發的規則」之間唯一的東西。工具描述明講「先呼叫這個」。

規則和 integration 的 `config` 是 `dict` 而不是展開的具名參數，這一步是往 ADR-0077「signature 就是 schema」的反方向退的：那兩個結構是深度巢狀的 JSON（conditions/actions 陣列），攤不平。用 vocabulary 端點加上後端的 422 來補，並在此記下這個取捨。

## Consequences

**好的：**

- 一個 unauthenticated 的讀取端點關掉了，而且以後不會再有下一個 —— 不是靠記得，是靠一個對著整張路由表跑的測試。
- 一條憑證外洩路徑關掉了，包含已經寫進資料庫的歷史資料。
- agent 現在可以把一件工作從頭做到尾：建 task、寫規則讓後續同類自動處理、設定 inbound 回呼、觸發 pipeline、讀建置歷史、確認外送通知有沒有真的送到。以前這條鏈上有四個點必須交還給人。
- 五個 service 各自成為那個能力的唯一實作。`tests/test_agent_surface_parity.py` 把同一個請求送進兩扇門，比對狀態碼**和 detail 文字**。
- `test_task_pipeline_guard` 自己發現 `routers/tasks.py` 已經不再直接寫 task，那條豁免被刪掉了 —— 守則測試反過來抓到了它自己的過期條目。

**要付的代價：**

- `/api/v1` 的表面明顯變大，每一個都是要維護的公開合約。
- MCP 從 26 個工具長到 33 個。工具清單越長，選錯的機會越大；三個新的 `manage_*` 用 action 參數而不是一個工具一個動作，是為了壓住這個數字，代價是 schema 描述力變弱。
- `manage_workflow_rules` / `manage_integration` 的 `dict` 參數如上所述是一個已知的退步。
- `/api/v1/subscriptions` 現在是 `/api/v1/integrations` 的語法糖，兩者並存。留著是刻意的（常見情境的形狀比較好用），但這是一筆將來可能要付的重複帳。

**仍然沒開，而且是刻意的：**

`api-keys` 的 CRUD（用 API 造 API key 是一條提權路徑）、`backup` 的 restore（毀滅性）、`assistant` conversations（LLM 呼叫 LLM）、`saved-filters`（純 UI 狀態）。

**仍然開著的缺口**（同一類，這次沒收）：

- `/api/v1` 的 share facade 是第二份實作（它的 `rotate-token` 自己產 uuid，而不是呼叫內部那個 helper）—— ADR-0073 的同一個形狀。
- `routers/external_api/tools_schema.py` 那份手寫的 OpenAI 格式工具清單已經漏了 `manage_edges`、`list_node_types`、`get_container_subtree`，這次又多漏七個。它需要的是被生成，而不是再手動補一筆。
- `edge_types` 在 v1 唯讀而內部 `/api/graph-types/edges` 有完整 CRUD —— ADR-0079 反對的「只有 UI 做得到」的形狀。當初的理由是「沒有端點宣告的關係就是 ADR-0078 修掉的東西」，但 `allowed_source`/`allowed_target` 現在已經是宣告的一部分了，理由變弱了。這是一個待做的**決定**，不是待寫的程式碼。
- `attachments`、`templates`、任務 export/import、`analytics` 的 critical-path / burndown / estimate-suggestion 仍然是內部限定。
