# ADR-0074: 型別自己宣告哪些欄位是使用者的

## Status
Accepted

## Date
2026-08-07

## Context

問題是從「身分頁面很礙眼」開始的，但真正的問題不在那個頁面。

身分是一個 `Node`，跟其他節點沒有結構上的差別。它之所以需要一整個專屬頁面，只因為三個欄位——顏色、頭像、說明——沒有任何泛用介面畫得出來。`/n/{id}` 只能改標題，`NodeExplorer` 對內建型別唯讀。所以問題不是「要不要拆掉身分頁」，而是**為什麼泛用節點頁不能編輯 `data`**。

答案在資料裡。統計了執行中資料庫每個型別的 `data` 實際鍵值之後，那個袋子裡混著三種毫無關係的東西：

- **功能自己寫的**：132 個 task 每一個都有 `callback_token`、`webhook_secret`、`external_*`、`reminder_sent_at`；project 和 identity 有 `share_token`、`share_pin_hash`。手改 `callback_token` 就是讓 ADR-0060 的簽章失效，手改 `share_pin_hash` 就是砸掉 ADR-0072 剛接好的鎖。
- **使用者的欄位**：identity 的 `color`/`avatar`/`description`、project 的 `repo_url`/`agent_instructions`/`wip_limits`、task 的 `assignee`/`time_estimate`/`progress_pct`。
- **臨時鍵**：project 上的 `owner`、`service_tier`、`pager_rotation` 各出現在一個節點上，incident 上的 `runbook`、`resolution`，task 上的 `completion_note`。人或 agent 隨手寫的，**現在完全看不見**，不在任何表單裡，只有打 API 才知道存在。

沒有東西描述這個袋子，所以沒有人能為它畫出編輯器——只能一個型別長一個專屬頁面，於是身分有頁面、專案有頁面，自訂型別什麼都沒有。

順帶一提，`node_types` 上早就有一個自由格式的 `data` 欄位，註解寫著「例如預設 hot-field 提示」，而**整個前後端沒有一行讀它**。有人留過位置，沒有下文。

## Decision

型別自己宣告它的節點的 `data` 裡，哪些鍵是使用者的，以及每一格裝什麼。

`node_types.fields`，一個 `{key, label, kind, ...}` 的 JSON 陣列，**自己的欄位而不是塞進上面那個 `data` 角落**——理由和 `roles` 當初拿到自己的欄位一樣（ADR-0040），而且 ADR-0059 的教訓正是「沒有東西描述的自由 JSON」就是憑證外洩的路徑。

`kind` 從實際資料收斂，不是先發明一套型別系統：`text` / `longtext` / `color` / `emoji` / `number` / `url` / `bool` / `json`。

兩道守門寫在寫入時，不是靠介面不畫：

- 宣告 `MANAGED_DATA_KEYS` 裡的任何一個鍵一律 422。那份清單和欄位宣告放在同一個模組，兩邊會被一起讀到，才不會各自漂移成交集。
- `kind` 不在清單裡也是 422。編輯器畫不出來的東西，不該被宣告。

內建型別的宣告在 `graph_registry.py` 跟 roles 一起 seed，**而 migration 自己做回填**。`seed_builtin_types` 只補「缺少的型別」且從不覆寫，所以既有資料庫的內建型別列早就存在，seed 會全部跳過——只靠它的話，除了全新安裝以外每一個資料庫的這個欄位都會是空的。這正是 ADR-0064 的教訓：**一個要靠別的事情發生才會發生的步驟，就是不會發生的步驟**。

## Consequences

- 泛用編輯器現在有東西可以照著畫。這是第一步，編輯器本身還沒做——所以身分頁**目前一格都還沒少**。
- 自訂型別第一次能宣告自己的欄位。`incident` 是現成的驗收案例：三個節點都帶著 `severity`/`service`/`customer_impact`/`incident_commander`，等於一直有一組事實上的欄位，只是沒有地方講出來。
- 臨時鍵仍然看不見，但現在**看得出來它們是臨時的**——「有值卻沒被宣告」是一個可以判斷的狀態。編輯器要怎麼呈現它們是下一個決定；把它們藏起來會是錯的，那等於承認有一批資料只有 API 使用者知道。
- 宣告是描述性的，還沒有拿來擋一般的 `PATCH /api/nodes/{id}`。那個端點有其他正當呼叫者，在編輯器存在之前就收緊它只會弄壞現有流程。**寫入端的強制要跟編輯器一起上**，這是刻意留下的一步，不是遺漏。
- 內建型別的宣告目前只反映「今天存在什麼」，不是「應該存在什麼」。例如 `color` 只有 identity 和 label 有，但專案其實也想要顏色（現在是去借第一個身分的）。要不要補是另一個決定。
- 驗證做了兩邊：seed 路徑由測試涵蓋（測試跑在全新的記憶體資料庫上），migration 路徑在執行中的開發資料庫實測，並確認 downgrade / upgrade 來回之後回填仍然正確。
