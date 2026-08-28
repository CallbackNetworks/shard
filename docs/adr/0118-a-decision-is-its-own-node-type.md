# ADR-0118: 決策是一種節點型別，不是穿著標籤外衣的東西

## Status
Accepted

## Date
2026-08-28

## Context

決策頁面要成為這個產品的主軸，但它畫不出任何 Graph 關係。查了正式站的資料才知道原因不在畫面：

- **103 筆決策，全部的邊加起來 104 條。** 其中 103 條是 `project -> decision` 的 `contains`，另外 1 條是唯一一個 `labeled`。決策之間、決策與工作之間，實際上沒有任何關係存在。
- **9 筆 `superseded` 是死路。** 狀態說「這個決策被取代了」，資料裡沒有任何東西說被誰取代。`edge_types` 裡從來沒有 `supersedes` 這個關係。
- **反向查詢不存在。** `labels_for_task` 從一開始就有，它的鏡像從來沒有。「這個決策管到哪些工作」在伺服器端根本問不出來。

根因是模型。ADR-0004 把決策存成 `label` 節點 + `data.type="decision"`。那在「決策是貼在任務上的標籤」的年代是對的形狀，但 ADR-0078 之後就不再是了：端點宣告認的是 node **type**，所以那個形狀能寫出最強的規則就是 `label -> label` —— 等於沒有規則，任何標籤都可以取代任何標籤。

模型早就在跟自己打架，只是沒有失敗症狀：

- `label_names()` 必須**主動把決策從標籤字彙裡減掉**，否則工作流規則的下拉選單會列出決策記錄。
- `issue_sync` 三處必須寫 `if lb.type == "label"`，才不會讓外部 issue 的標籤同步把決策記錄洗掉。
- `label` 型別把 `type` 宣告成使用者可編輯的 enum，所以通用節點編輯器提供每個標籤一個「變成決策」的選項——而那樣造出來的東西，決策頁面找不到、決策 API 也讀不到。
- 前端其實早就投票了：`StructureMap`、`MapCanvas`、`MapInspector`、`TaskIcons`、`territoryModel` 全部在判斷 `type === 'decision'`，只有後端還當它是標籤。

另外兩個小的宣告漂移，來源相同：`decision_status` 的宣告是 `proposed/accepted/superseded`，但 UI 的篩選器和主題色都有 `deprecated` —— 一個選得到卻編輯不出來的狀態；而決策頁的「拒絕」按鈕呼叫的是 `deleteLabel`，被否決的決策連同它的歷史一起消失。

## Decision

**`decision` 成為一個內建 node type**，並帶兩條自己的關係。

型別本身不帶任何 role：決策既不是工作住的地方，也不是一件工作。因此它在 ADR-0068 的規模與進度彙總裡的地位跟以前當標籤時完全一樣（不算數），而 `contains` 依舊把它歸檔在專案底下。

兩條關係，兩端都宣告得出來（ADR-0078）：

| 關係 | 方向 | 意思 |
|------|------|------|
| `supersedes` | decision → decision | 這筆取代那筆 |
| `governs` | decision → task/container | 這筆決定那件工作 |

`governs` 的方向是反過來的，這是刻意的：一個任務不是「被決策標記」，是一個決策「管轄」這個任務。原本那 1 條 `labeled` 邊由 migration 轉向。

**取代是唯一一個有專屬寫入端點的決策操作**，其餘（建立、修改、刪除、`governs` 連結）都走既有的通用節點／邊介面（ADR-0040→0043、ADR-0078），不另開門。取代之所以例外，是因為它同時是一條邊**和**遠端那筆的狀態：拆成兩次呼叫，會失敗的那一半正好是「狀態說被取代、卻沒有東西指出取代者」——也就是這份 ADR 要終結的那個狀態。所以它是一個 service act，內部與 v1 兩道門各一個端點，共用同一份實作。

回應契約不變。`DecisionOut` 繼承 `LabelOut` 並加上 `supersedes` / `superseded_by` / `governs` 三個 `NodeRef` 陣列；`type` 依舊回 `"decision"`。儲存方式換了不是破壞讀取端的理由。

同一批順手修掉的兩個宣告漂移：`decision_status` 的選項補上 `deprecated`（宣告要對得上 UI 能選的東西，ADR-0074），而「拒絕」改成把狀態設為 `deprecated` 而不是刪除——一個被考慮過而否決的決策，仍然是一件被決定過的事。

決策頁面的下半部從「依專案分組的結果清單」換成**演進鏈**：以現行決策為頭，沿著 `supersedes` 往回縮排。沒有關係的決策就是長度 1 的鏈，形狀一致，所以畫面不需要兩套渲染。鏈的解析在**可見集合**內完成，跟結構圖與看板同一條規則（ADR-0069、ADR-0094）：被篩掉的父節點會把子節點升成根，而不是把它們一起藏起來。每張卡片也終於連得到 `/n/{id}` —— ADR-0114 早就在那裡畫出邊的兩端，決策頁卻沒有任何通往它的路。

## Consequences

**得到的：**

- 「這個決策被什麼取代？」「這個決策管到哪些工作？」「這件工作是依什麼決定的？」三個問題現在都有查詢、有 API、有畫面。9 筆死路的 `superseded` 有地方可去了。
- ADR-0078 的端點宣告終於管得住決策：`supersedes` 兩端都必須是決策，`governs` 的目標必須帶 `task` 或 `container` role。以前這些規則寫不出來。
- 三處 `if lb.type == "label"` 的手動排除、以及 `label_names()` 的減法，全部消失——型別查詢本身就是那個過濾器。
- MCP 多一個 `manage_decision_links` 工具（52 個），內部助理拿到同名的對應工具；`list_decisions` 現在會把鏈一起吐出去，所以模型讀到一筆舊決策時知道它已經被取代。
- 匯出的 Markdown 的 `Status` 行會寫出取代者，`## Supersedes` 區塊列出被取代的記錄——ADR 在紙上本來就該這樣寫。

**付出的：**

- 一次資料遷移，動到 `nodes.type`。migration 在 dev DB 上 upgrade/downgrade 往返驗證過（16 筆決策 + 一條人工造出來的 `labeled` 邊轉成 `governs` 再轉回來）。JSON 判別欄位的過濾寫在 Python 而不是 SQL，因為 SQLite 與 PostgreSQL 的 JSON 取值語法不同——這也正是 `graph.decisions` 原本就在 Python 裡過濾的理由。
- 舊的寫法**不再靜默地繼續work**：`POST /nodes` 帶 `type="label"` + `data={"type":"decision"}` 現在造出來的是一個標籤，因為那就是它。這是刻意的，讓錯誤在寫入當下就看得出來，而不是等到決策頁面少一筆才發現。文件、MCP 工具描述、v1 端點描述都改了。
- `create_label()` 少了 `type` / `decision_status` 兩個參數。標籤不再有這兩個概念。
- 刪除容器時要一併清掉底下的決策節點（`delete_container`）。漏掉的話，刪一個專案會留下 32 個孤兒節點。

**沒有做的：** 決策沒有拿到 `shareable` role，也沒有進分享頁。這是下一個問題，不是這一個。
