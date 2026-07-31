# ADR-0051: Webhook 兩端都不再自己編造結果

## Status

Accepted

## Date

2026-07-31

## Context

ADR-0046 到 ADR-0050 處理的都是同一種缺陷形狀：**一個引擎收到它不認識的值，卻靜靜地當作
「沒事發生」**。規則引擎那邊已經修完了。Webhook 這一側（對外送出的通知、對內接收的 CI/CD
回呼）是同一個模組群裡唯一還沒檢查過的地方，檢查之後發現三個問題，其中入站那個比規則引擎的
版本更糟——它不是靜靜地什麼都不做，而是**靜靜地編出一個正面的結果**。

**一、入站：看不懂的狀態一律當成 `done`。**

`cicd_adapters.py` 裡有 15 處 `.get(x, "done")` / `.get(x, "in_progress")` 這種帶預設值的
查表。也就是說：

- GitHub Actions 回報 `timed_out`（建置逾時）→ 舊的 `STATUS_MAP_GITHUB["completed"]` 只列了
  `success` / `failure` / `cancelled`，`timed_out` 查不到 → 預設 `done` → **任務被關掉了**。
- GitLab 的 merge request 事件沒有 pipeline 區塊 → 查不到 → `done` → 開一個 MR 就把任務關掉。
- 送一個 `{"foo": "bar"}` 或空的 body 過來 → `done`。
- 手滑打成 `{"status": "sucess"}` → `done`（碰巧對，但不是因為系統讀懂了）。

而且這個編造出來的 `done` 事後完全無法和 CI 系統真的回報的 `done` 區分——建置歷史那一列看起來
就是一次成功的建置。`tests/test_cicd_adapters.py` 裡還有一個叫
`test_unknown_status_defaults_to_done` 的測試，把這個行為當成規格釘住了。

**二、入站：`?provider=` 打錯字會被無聲吞掉。**

`?provider=githbu` 不會報錯，會落回自動偵測，用另一個 adapter 去解析 GitHub 的 payload，然後
回報那個 adapter 產出的東西。呼叫端明確指定了要用哪個 adapter，這個要求卻被忽略了。

**三、出站：`type="webhook"` 的整合設了認證也不會送出。**

`_build_headers` 裡簽章和認證共用同一條 if/elif 鏈，`webhook` 型別命中第一個分支，底下所有
`auth_type` 分支都到不了。所以在介面上替一個 webhook 整合設定 basic auth，儲存成功、看起來
生效，實際送出的請求裡沒有任何 `Authorization` 標頭，對方回 401，而使用者只會看到「送不出去」。
同一條鏈的另一頭還有個更難察覺的問題：預設 `auth_type` 是 `bearer`，若讓 `webhook` 型別也走
到那個分支，就會把 `secret` 當成 bearer token 送出去——而那個 `secret` 正是對方要拿來驗證我們
簽章的金鑰。

## Decision

**一、狀態表擴充到各家的完整詞彙，表外的值一律不映射。**

五張 map 都補齊各家文件列出的狀態（GitHub 補 `neutral` / `timed_out` / `action_required` /
`startup_failure` / `stale` 與頂層 `pending`；GitLab 補 `cancelled` / `preparing` /
`scheduled` / `waiting_for_resource`；Bitbucket 補 `ERROR` / `IN_PROGRESS`；Drone 補
`declined` / `skipped` / `blocked`）。先擴充再拒絕，是為了讓「真的看不懂」成為罕見狀況，而不是
把常態變成錯誤。

15 個編造用的預設值全部拿掉，改成 `UNMAPPED = None`。`normalize_webhook_payload` 最後統一收口：
狀態不在 `VALID_STATUSES` 裡就是 `None`，同時用 `_raw_status(body)` 走 11 條 payload 路徑把
原始字串留下來。

**二、看不懂的回呼：任務維持原狀，但一定留下兩筆紀錄。**

`webhook_callback` 在 `status is None` 時提前返回，不呼叫 `apply_task_update`。留下的是：

- 建置歷史一列 `WebhookEvent`，`status="unmapped"`（欄位不可為空，而「我們讀不懂這一筆」本身
  就值得記錄）。
- 一筆 `webhook.unmapped_status` 活動紀錄，scoped 到該任務的專案，`meta` 帶 `provider` 與
  `raw_status`。

選擇「維持原狀 + 留紀錄」而不是「回 4xx 讓對方重試」，是因為 CI 系統的重試只會把同一份讀不懂的
payload 再送一次，對誰都沒有幫助；真正需要的是讓人看得到收到了什麼。

**三、`?provider=` 不在 `PROVIDER_PARSERS` 裡就回 422。**

和 ADR-0046 對規則詞彙的處理同一個原則：引擎擁有詞彙，邊界負責拒絕。

**四、簽章與認證拆成兩段獨立的判斷。**

HMAC 簽章只看「是不是 webhook 型別 + 有沒有 secret」，之後才是 `auth_type` 的鏈。`bearer`
分支明確排除 `webhook` 型別並註明原因：那裡的 `secret` 是簽章金鑰，送出去等於把驗證用的鑰匙
交給對方。

**五、兩個把錯誤行為釘住的測試改寫成釘住正確行為。**

`test_unknown_status_defaults_to_done` → `test_unknown_status_is_left_unmapped`；
`test_merge_request_no_pipeline` 現在斷言 `status is None`，並在 docstring 寫明「開一個 MR
不該關掉任務」。

## Consequences

正面：

- 任何被關掉的任務，背後都有 CI 系統真的回報過的成功狀態。逾時、取消、需要人工介入的建置不會
  再被當成通過。
- 「系統讀不懂」和「CI 說成功」在資料上可以區分了：`status="unmapped"` 是一個明確的值，不是
  混在 `done` 裡的一列。
- webhook 整合上的認證設定終於會實際送出；簽章金鑰不會外流成 bearer token。
- 狀態表現在是各家詞彙的完整列表，之後 CI 平台新增狀態時，缺的是表格的一列，而不是一個看不見的
  行為改變。

負面與代價：

- 送整合測試用的假 payload（例如 `{}` 或 `{"foo":"bar"}`）給回呼端點，任務不會再變 `done`。
  這是行為變更，但舊行為本來就不該被依賴。
- 建置歷史面板現在可能出現 `unmapped` 這個狀態，目前沒有專屬顏色，落回灰色。可以接受——它本來
  就不是一個結果。
- 活動紀錄多了一種 `webhook.unmapped_status`。和 ADR-0050 的 `rule.skipped` 一樣，是訊號不是
  雜訊：接不上的整合會持續寫，接好了就停。
- 若真有下游依賴「打任何東西都會把任務關掉」這種用法，會壞掉——但這正是要移除的行為。
