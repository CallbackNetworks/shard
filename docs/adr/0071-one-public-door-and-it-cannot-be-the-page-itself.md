# ADR-0071: 只留一扇公開的門，而那扇門不能是頁面本身

## Status
Accepted

## Date
2026-08-07

## Context

ADR-0070 把身分的分享面板收成一份，但刻意留下舊路徑：`/share/{token}` 和 `/ical/identity/{token}.ics` 還在，理由是「既有連結不會斷」。決定退場之後，這條線上剩下的東西才浮出來——而且不是一件，是三件。

**第一件：泛用的門根本不是一扇完整的門。** `/share/n/` 對 identity 和 project 做 delegation，*讀*的時候一切正常，但：

- `_resolve_note_target()` 只認得 scope `identity` 和 `project`，scope `n` 直接 404。所以 ADR-0070 之後，一個開了訪客留言的身分，它的分享頁**看得到留言框、按下去 404**。實測 `/share/identity/{token}/notes` → 201，`/share/n/{token}/notes` → 404。
- `verify_share_node_pin()` 驗完 PIN 之後**永遠回傳 container response**。身分的專案掛在 `member_of` 而不是 `contains`，所以一個有 PIN 的身分解鎖之後拿到的是一個空頁面。
- 泛用容器的 task note 會踩到 `next(pid for pid in project_ids if pid in member_ids)` 的 `StopIteration`（500），因為自訂容器本身不是專案，交集必然為空。

一扇只能讀不能寫、解鎖之後給錯頁面的門，不足以承接另一扇門的退場。

**第二件，也是最嚴重的一件：`/share/n/{token}` 同時是 SPA 的頁面路由和後端的資料路徑。** `backendPaths.js` 只宣告 `/share/identity` 和 `/share/project`，所以 `/share/n/...` 不會被 proxy 到後端——瀏覽器打開分享頁，頁面自己去 fetch `/share/n/{token}`，**Vite dev server 和 nginx 都回自己的 `index.html`，HTTP 200、`text/html`**。這正是 ADR-0058 那個 burndown 呼叫的形狀，也是 ADR-0061 的同一類錯誤，只是這次不是前綴比對出錯，而是**一個 URL 同時是兩種東西**。

自 ADR-0039 起這個頁面在任何瀏覽器裡就沒能載入過自己的資料。所有測試都是綠的，因為測試直接打後端；ADR-0070 把身分的分享唯一指向這扇門之後，這個沉睡的缺陷變成了「身分分享頁全壞」。

**第三件：守門測試看不到這一類。** `backendPathClaims.test.js` 問的是「有沒有頁面路由被後端錯誤宣告？」——`/share/n` 是頁面路由，沒有被宣告，**完全符合它的規則**。它從來沒問過反方向的問題：「前端真的會去打的每一個 root-level 路徑，有沒有被宣告？」

## Decision

**退場。** `/share/identity/{token}`、`/share/identity/{token}/verify`、`/ical/identity/{token}.ics`、notes 的 `identity` scope，以及 SPA 的 `/share/:token` 路由，全部移除。身分只有一扇門。`get_share_identity()` 留著當函式（`member_of` 聚合確實是它自己的事），只是不再掛路由。

**頁面路徑與資料路徑分屬不同 segment。** 公開頁面維持 `/share/n/{token}`（那是面板已經在發、也已經寫進 ADR-0070 的網址），後端資料端點改成 `/share/node/{token}`、`/share/node/{token}/verify`、`/share/node/{token}/notes`。這與 `/share/p/{token}` 頁面配 `/share/project/{token}` 資料是同一個既有慣例——ADR-0061 的 segment-anchored 比對讓 `/share/node` 不會誤claim `/share/n/...`，正是為此存在。

**把泛用的門補成完整的門：**
- `_resolve_note_target` 的 scope `node` 依節點型別分派，和 GET 用同一套規則；三個分支共用一個 `_check_note_access`（過期／未開放／PIN session）。
- `verify_share_node_pin` 同樣分派，解鎖後交回的是那一頁本身，不是一個空容器。
- 自訂容器上的 task note 找不到範圍內專案時，退回任務自己的 membership 而不是丟 500——訪客能看到那個任務，`project_id` 只是記帳。

**守門測試補上反方向的斷言**：從 `api/client.js` 抽出所有 root-level 的請求路徑（`${scope}` 展開成 `node` 和 `project`），斷言每一條都被 dev proxy 和 nginx 宣告。

## Consequences

- **既有的身分分享連結與 iCal 訂閱全部失效**（404）。這是明確選擇的代價：token 沒變，擁有者從面板複製新連結重發即可。
- 身分的分享頁**第一次能在瀏覽器裡真的打開**。實測：頁面 HTML 由 SPA 提供、資料由 `/share/node/…` 提供 `application/json`，4 個專案 26 個任務全部算出並繪出。
- 訪客留言在泛用門上第一次可用，自訂 shareable 容器也一併拿到（含 task note，不再 500）。
- 新的守門斷言對「壞掉的設定」做過負向驗證：把三個檔案改回退場前的狀態，三條斷言確實變紅。**只驗證新規則會過的測試，證明不了它抓得到舊錯誤。**
- `/share/{scope}/…` 的 scope 詞彙現在是 `node` 和 `project` 兩個值，與後端路由 segment 一致，不再有 `identity` 這個只存在於 notes 的第三種寫法。
- 剩下的分歧仍是 `ProjectDetail`：它自己發 `/share/p/` 與 `/ical/project/`，並保有自己的 guest-notes 切換與瀏覽數呼叫。專案要不要也收進同一扇門，是下一個決定。順帶記錄一個本次發現、未修的既有問題：專案分享頁**不檢查 PIN**，但 `/api/nodes/{id}/share/set-pin` 允許為專案設定 PIN——設了也沒有用。
