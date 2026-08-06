# ADR-0062: 離線的寫入排在每一筆寫入都會經過的地方

## Status
Accepted

## Date
2026-08-06

## Context

`CLAUDE.md` 是這樣描述離線支援的：

> **Offline support** (`hooks/useOfflineSync.js` + `components/OfflineIndicator.jsx`): IndexedDB queue for pending mutations when offline. Auto-syncs when reconnected.

程式碼看起來完全符合。`useOfflineSync` 有一個 IndexedDB 資料庫、`enqueueAction` / `getPendingActions` / `clearAction` 三個函式、重新連線後的重送迴圈、以及 `pendingCount`。`OfflineIndicator` 會顯示「Offline」和「N pending changes」，還有一顆「Sync now」。四條測試全綠。

只有一件事不成立：

```
$ grep -rn "queueAction" frontend/src --include=*.jsx --include=*.js | grep -v useOfflineSync.js
(no output)
```

**唯一的入口沒有任何呼叫者。** 佇列永遠是空的，`pendingCount` 永遠是 0，重送迴圈永遠沒有東西可送。整個機制是完整的、可運作的、而且從未被使用過。

更糟的是實際發生的事。axios 的錯誤攔截器是這樣寫的：

```js
if (err.response && !err.config?._isBackgroundRefetch && !err.config?._silent) {
```

網路層失敗（離線）沒有 `err.response`，所以**連錯誤提示都不會跳**。離線時改一個任務標題，改動就這樣消失，而畫面下方掛著一個「Offline」徽章，暗示著有人在處理。這比沒有這個功能更糟——它做出了一個它不會兌現的承諾。

**為什麼測試是綠的。** `OfflineIndicator.test.jsx` 把 `useOfflineSync` 整個 mock 掉，餵一個假的 `pendingCount` 進去，然後斷言畫面顯示「3 pending changes」。它釘住的是「給定一個待送數量，徽章長什麼樣」，從來沒有問過「一個待送數量要怎麼產生」。測試測的是**顯示**，不是**機制**。

這和 ADR-0060 是同一個形狀的錯誤：一套建好的機制，入口條件永遠不成立。差別只在那次是安全鎖沒人打開，這次是佇列沒人放東西進去。任何只 grep「這個機制存在嗎」的稽核都會給出綠燈。

## Decision

**把生產者放在每一筆寫入本來就會經過的那一個點：axios 的回應攔截器。**

不是去列舉「哪些 mutation 要支援離線」然後逐一接上 `queueAction`。那份清單會落後於下一個功能——而這正是原本沒被發現的原因。攔截器是唯一一個現在和未來所有寫入都必經的地方，接在那裡就不需要維護任何清單。

（這和 ADR-0059 對 `useRealtimeSync` 的處理是同一個判斷：一份具名清單會偷偷落後，一個全面的規則不會。）

具體：

1. 佇列本身搬到 `frontend/src/api/offlineQueue.js`。生產者是攔截器而不是元件，所以佇列不能住在 hook 裡；hook 改成只負責回報與排空。模組另外提供一個 subscribe/notify，讓徽章的數字是被推送的而不是輪詢的。

2. 攔截器判斷「這是一筆因為沒有網路而失敗的寫入」時才排隊，條件為：沒有 `err.response`（伺服器沒答話）、方法是 POST/PUT/PATCH/DELETE、且 `navigator.onLine` 為 false。滿足時存入佇列、跳一則 info 提示、在 error 上標記 `queuedOffline`，然後**仍然 reject**——呼叫端的樂觀更新不是攔截器該替它決定的事。

3. **`FormData` 不排隊。** 重送一個上一個工作階段才選好的檔案，不是這裡能誠實承諾的事，所以附件上傳與備份匯入照常失敗並說明原因。

4. 重送走**同一個 axios instance**，帶 `baseURL: ''`（佇列存的是完整路徑）與 `_replay: true`。用同一個 instance 是為了共用認證標頭，不要在旁邊長出第二份會走樣的複製品；`_replay` 則是避免重送失敗時又被排進它正在排空的那個佇列。

5. 重送的失敗處理分三種，這是這個決定裡最需要說清楚的一段：
   - **沒有 `response`（還是沒網路）** → 中斷，保留順序，下次再來。
   - **4xx** → 丟棄。伺服器聽懂了而且拒絕了：目標被刪掉、內容過期、payload 被拒。重試不會改變結果，而留著它會讓後面每一筆都永遠卡在它後面。
   - **5xx** → 中斷，保留。伺服器出問題是暫時的。
   排空一律照插入順序：同一段離線期間先建任務、後留評論，順序反過來就沒有意義。

6. 順帶修掉那個沉默：網路層失敗現在會跳錯誤提示（在確定不排隊的情況下）。瀏覽器認為自己在線上卻連不到伺服器時（伺服器掛了、captive portal），不排隊也不假裝——直接說失敗。

## Consequences

- 離線時的修改真的會被保留，恢復連線後自動送出。已在真實瀏覽器用 CDP 的 `Network.emulateNetworkConditions` 端到端驗證：離線改標題 → `queuedOffline=true` → 佇列內容為 `PATCH /api/nodes/{id}` → 恢復連線 → 佇列歸零 → 伺服器上的標題確實改了。
- **重複送出的風險是這個設計固有的，不是疏漏。** 網路層失敗意味著我們不知道請求有沒有抵達。如果它其實成功了只是回應遺失，重送一個 POST 就會建出第二筆。對一個單人工具這是可以接受的取捨，但它是取捨，不是沒想到。要真正消除需要冪等鍵（idempotency key），那是另一個決定。
- 4xx 一律丟棄意味著離線期間的修改**有可能靜靜地不生效**——例如離線改了一個同時在別處被刪掉的任務。目前只有主控台知道這件事；把丟棄的動作呈現給使用者是後續可做的事。
- 攔截器現在會為離線寫入跳提示。如果一次操作觸發多筆 mutation，會跳多則——目前沒有合併。
- `useOfflineSync` 不再輸出 `queueAction`。它本來就沒有呼叫者，保留一個「請自行接上」的入口只會邀請下一次同樣的遺漏。
- 新增的測試刻意不碰畫面：`api/__tests__/offlineQueue.test.js`（7 條）拿真實攔截器的 rejected handler 來跑，釘住什麼會被排隊、什麼不會（讀取、上傳、伺服器已回應的失敗、重送本身、線上時的失敗）；`hooks/__tests__/useOfflineSync.test.js`（6 條）釘住排空的順序與三種失敗處理。原本那四條顯示測試保留不動——它們測的東西沒有錯，只是不夠。
- 驗證：前端 360 passed / 47 files，ESLint 乾淨。
