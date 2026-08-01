# ADR-0052: 記錄下來不等於看得見

## Status

Accepted

## Date

2026-08-01

## Context

ADR-0047 到 ADR-0051 都在修同一種缺陷：引擎靜靜地什麼都不做。修法一律是「留下一筆紀錄」——
`rule.skipped`、`webhook.unmapped_status`、`WebhookEvent(status="unmapped")`。這次把規則與整合
兩個模組的**前後端**一起巡查，發現那些紀錄大多寫進了資料庫，卻到不了畫面上。也就是說前四個
ADR 只做完了一半。

**一、活動頁把規則的顏色標在一個永遠不會出現的事件上。**

`ACTION_COLORS` 裡有 `rule.triggered`，但那是**通知事件**的名字，從來不會被寫進活動紀錄。真正
寫進去的是 `rule.executed` 和 `rule.skipped`，加上 ADR-0051 的 `webhook.unmapped_status` ——
三個都沒有顏色，一律落到 `DARK.textDim`，整頁最暗的灰。花力氣讓失敗「看得見」，結果它在畫面上
是最不顯眼的東西。篩選籤也沒有 `webhook` 這一類，那些紀錄只能在 All 裡面翻。

**二、建置歷史看得到 `unmapped`，卻看不到收到了什麼。**

`raw_payload` 有存進 `webhook_events` 資料表，但 `WebhookEventOut` 沒有這個欄位，API 從來不吐
它。對一列 `unmapped` 而言，「那到底是什麼 payload」正是唯一要問的問題，使用者卻得改去活動頁
翻。而狀態文字的顏色是 `STATUS_COLORS[ev.status]`，對 `unmapped` 求值為 `undefined`。

**三、送達紀錄的事件篩選是一份寫死的複製品。**

ADR-0047 把事件清單收斂成後端統一供應，整合的訂閱勾選框確實是抓 `GET /integrations/events`；
但 `DeliveryLog.jsx` 另外留了一份 `FILTER_EVENTS` 常數。它已經漏了 `task.todo`，而且後端那份是
**動態的**——它會包含使用者自己的規則用 `fire_event` 送出的自訂事件。所以你可以訂閱
`deploy.requested`，卻沒辦法在送達紀錄裡篩它。

**四、webhook 整合選了 basic/api_key 認證，簽章金鑰欄位就整個消失。**

ADR-0051 把後端的簽章與認證拆成兩段獨立判斷，但表單還把它們綁在一起：`secret` 欄位只在
`auth_type === 'bearer'` 時渲染。選了 basic 之後金鑰欄位不見了，下方卻仍顯示「這個整合會用
HMAC 簽章」；若先前設過 secret，它還留在資料庫、還在繼續簽章，畫面上看不到也改不了。

**五、規則丟例外時，只有一行 log。**

ADR-0050 說規則有三種執行不了的方式，其實是四種。第四種是動作**拋出例外**，而它到今天為止是
四種裡最安靜的一種：`run_rules` 最外層 `except Exception` 只寫 `logger.warning`，連
`run_count` 都不會動——規則在列表上看起來是閒置，而不是壞掉。同一個 except 還做了
`db.rollback()`，那是整個 session 的回捲，會把同一輪裡**前面幾條規則已經寫好的東西**一起丟掉，
一樣不留痕跡。

## Decision

**一、後端記錄的每一種訊號，前端都要有對應的顏色與入口。**

`ACTION_COLORS` 改成標記真正會出現的三個 action，兩個「沒做成」的用警示色而非最暗的灰；
`rule.triggered` 這個死條目移除。活動頁加上 `webhook` 篩選籤（timeline 與 wall 兩個檢視本來就
有 webhook 的樣式，缺的只是 log 檢視那排籤）。

**二、`raw_payload` 併入 `WebhookEventOut`，建置歷史展開時顯示。**

`unmapped` 拿到自己的警示色，狀態顏色查表統一走 `statusColor()` 有預設值的路徑。展開一列
`unmapped` 時，除了 payload 本身，另外用一句話說明「這次的狀態讀不懂，任務未被更動」——因為
`unmapped` 這個字本身不會告訴任何人發生了什麼。

**三、清單一律用後端供應的那一份，不留第二份副本。**

`FILTER_EVENTS` 刪除，改用和訂閱勾選框同一支 `getIntegrationEvents`。這是 ADR-0047 的原則，
只是當時漏了這一處。

**四、表單的結構要和後端的判斷結構一致。**

簽章金鑰對 `type === 'webhook'` 永遠顯示，位置移到認證方式**之前**（先簽章、再認證，與
`_build_headers` 的順序相同）；bearer token 欄位改成 `auth_type === 'bearer' && type !== 'webhook'`，
正好對上後端排除 webhook 的那個分支。金鑰欄位下方加一句話說明它不會被當成 bearer token 送出。

**五、規則的第四種失敗也寫進活動紀錄，而且每條規則各自一個存檔點。**

新增 `rule.failed`，帶 `rule_id` 與例外的型別和訊息，scope 與 `rule.skipped` 相同（兩者共用抽出
來的 `_scope_of`）。`db.rollback()` 換成 `with db.begin_nested()` 包住單條規則的條件評估與動作
執行：失敗只回捲那條規則自己的寫入。寫 `rule.failed` 這件事本身用 try/except 包起來——記錄失敗
不該把一條壞規則升級成一個失敗的請求。

順帶把 `fire_event` 從 `loop.create_task(...)` 改成 `await`。它是 `_exec_action` 還是同步函式
時的殘留；實測它今天會送達，但那是靠後面 `rule.triggered` 的 await 順帶給了它一個排程機會，
沒有執行中的 loop 時它會整個丟掉事件，而且例外永遠不會被觀察到。

## Consequences

正面：

- 前四個 ADR 產生的訊號現在真的看得到：規則跳過與 webhook 讀不懂都是警示色，webhook 有自己的
  篩選籤，`unmapped` 的 payload 一展開就在眼前。
- 事件清單在整個前端只剩一份來源，自訂事件可訂閱也可篩選。
- webhook 整合的簽章金鑰與認證可以各自設定，畫面上不再有「正在生效但看不到」的欄位。
- 一條會拋例外的規則現在會在專案動態裡說出自己壞了，而且壞的只有它自己。

負面與代價：

- 每條規則多一個 SAVEPOINT。以目前的規則數量與觸發頻率，這個成本可以忽略；若日後規則數量成長到
  需要在意，該處理的是每次觸發都全表掃描 `WorkflowRule` 這件事，而不是存檔點。
- `raw_payload` 會被 API 吐出來。它是 CI 系統送來的原始內容，可能包含 commit 訊息、觸發者等
  資訊——但這些本來就已經逐欄存在同一張表裡並顯示，沒有擴大暴露面。
- 活動紀錄多了一種 `rule.failed`。和前幾個 ADR 的判斷一致：這是訊號不是雜訊。
- 本 ADR 只處理「已經記下來的東西看不見」。規則頁的 `run_count` 仍然把「所有動作都被跳過」算成
  一次成功執行，dry-run 也仍然是 task-only 且不預演動作能否執行——這兩件事會改變功能語意，
  留待後續決定。
