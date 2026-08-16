# ADR-0086: 讀得到的東西就要寫得了

## Status
Accepted

## Date
2026-08-16

## Context

ADR-0085 把五個「只有瀏覽器做得到」的能力補上 v1 和 MCP 的門之後，再掃一次三個表面，剩下的東西分成兩種，價值差很多。

### 一、讀寫不對稱 —— 這比「功能還沒做」更糟

API **描述了一個它並不提供的能力**。這不是缺功能，是一扇開了一半的門：

- **`recurrence`**：`enrich_task` 把 `recurrence` 放進**每一個** `TaskOut`，所以自從這個欄位加進去那天起，每個透過 v1 讀 task 的 agent 都被告知它存在 —— 而 `/api/v1` 沒有任何寫入口。它永遠讀到 `null`，而且對此無能為力。
- **cycles**：cycle 成員關係是一條 `in_cycle` edge，所以 `/nodes/{id}/edges` 一直都能**把 task 放進去**；卻沒有任何端點能說出一個 cycle 裡有什麼。可寫不可讀 —— 同一個不對稱的另一面。
- **attachments**：agent 的產出大部分是檔案（build log、報告、diff、截圖），而它沒有地方放。

### 二、可及範圍

- **analytics 的規劃那一半**：v1 有 overview / heatmap / velocity / status-trend，也就是回顧的那一半。回答「接下來該做什麼」的那一半（critical path、burn-down、校準過的估時）是內部限定 —— 而那正是要規劃工作的 agent 需要的那一半。
- **templates**、**export / import 往返**：v1 能一次建一個 task、也能 bulk 建，但拿不出來，所以搬遷、依計畫種資料、把快照交給別的系統，全都只能在瀏覽器裡做。
- **notifications**：v1 有 list、unread-count、標記單筆已讀，沒有 mark-all-read、沒有刪除。對一個無法確認自己已讀的讀者來說，`unread-count` 只會單向成長，於是「上次看過之後有沒有新的」—— 這個端點存在的唯一理由 —— 它永遠答不出來。
- **edge types**：ADR-0079 給了 node types 一扇 v1 的門，刻意讓 edge types 在那裡維持唯讀，理由是「一個沒有端點宣告的關係正是 ADR-0078 修掉的東西」。這個理由經不起檢查：內部的 `/api/graph-types/edges` **一直都可以**建立一個 `allowed_source`/`allowed_target` 都是 NULL 的關係。所以那個限制從來沒有防止過「無約束的關係」這個壞狀態，它只防止了 agent 抵達一個 UI 兩下就能抵達的狀態 —— 而那正是 ADR-0079 自己反對的形狀。

### 三、一份手寫清單，又漂走了

`routers/external_api/tools_schema.py` 是一份手寫的 OpenAI function-calling 格式工具清單，維護在 MCP registry 旁邊、描述同一批操作。它漂了：等到有人去看的時候，`manage_edges`、`list_node_types`、`get_container_subtree` 加上 ADR-0085 新增的七個全都不在裡面。一個靠它自動探索操作的 HTTP agent，被餵的是一個沒有人決定過的子集 —— 那份清單只是在某個時間點停止被更新了。

ADR-0077 已經解過一次這個問題（給 MCP）：一個工具的**簽章就是它的 schema**，registry 無法和 dispatch 漂開，因為根本沒有另一個 dispatch。

## Decision

### 補齊不對稱，用和 ADR-0085 相同的形狀

新增 service：`recurrence_admin`、`attachment_admin`、`cycle_admin`、`analytics_admin`、`task_transfer`；edge type 的守則搬進 `graph_registry`，就放在 node type 守則旁邊。兩扇門都呼叫同一個，拒絕由 `ServiceError` 的單一 handler 算繪（ADR-0085）。

附件的**上傳有兩條路，但只有一個實作**：SPA 從 file input 送 multipart，MCP 工具手上是 bytes、沒有辦法組 multipart body，所以 v1 收 JSON 裡的 base64。兩條路都落在同一個 `store`，所以大小上限只存在一處 —— 一條長出自己上限的第二條上傳路徑，就是一條只在單邊生效的上限。內部那條改成一次 bounded read（`MAX_FILE_SIZE + 1`）而不是 chunk 迴圈：讀超過上限一個 byte，正是「超過了」的證明。

### edge types 開寫入，`admin` scope

這推翻了 ADR-0079 決策裡的一個子句（其主體 —— node type registry 上 v1 —— 不變，所以 0079 的狀態維持 Accepted）。理由如上：那個限制沒有防止它宣稱要防止的狀態。ADR-0078 真正買到的是「**被宣告的**規則會被強制執行」，而那件事和這個型別是從哪扇門建出來的無關。

### `tools-schema` 改成生成的

從 `mcp.list_tools()` 投影成 OpenAI 格式。MCP 的 `input_schema` 本來就是 JSON Schema，也就是 `parameters` 要的東西，所以這幾乎只是改個名字。這個端點自此不再持有任何自己的詞彙表：MCP 加一個工具它就出現，移掉就消失，沒有東西需要記得。

### 一個路由遮蔽的守則測試

`/api/v1/projects/{id}/tasks/export` 被 `/api/v1/projects/{id}/tasks/{task_id}` 吃掉了 —— 註冊順序在前的參數化路由先比中，`task_id="export"`。兩個宣告本身都看不出衝突，只有 include 的順序看得出來。修法是把字面路由排在前面；守則是一個掃過整張 v1 路由表、對每個**同 method** 的字面路徑檢查有沒有更早的參數化路徑會先比中的測試。它先對著壞掉的順序跑過一次確認會紅 —— 一個沒有被負面對照過的守則，不知道自己在守什麼（ADR-0061）。

## Consequences

**好的：**

- 三個不對稱關上了。一個 agent 現在可以設定循環、讀出 cycle 內容、把自己的產出當附件掛上去。
- 規劃用的 analytics、templates、export/import 往返都到得了，agent 可以做搬遷和依歷史校準的估時。
- `tools-schema` 不會再漂，而且 `test_agent_surface_gaps.py` 直接斷言它和 MCP registry **完全相等**。
- 路由遮蔽從「下次再踩一次」變成一個會紅的測試。
- 順帶把 `analytics.py`（407 → 173 行）、`graph_types.py`（153 → 98 行）、`bulk.py` 的 export/import、`cycles.py` 的讀取都變薄了，因為那些邏輯搬進了 service。

**要付的代價：**

- `/api/v1` 的表面又長大了一截。每一個都是公開合約。
- 附件上傳的 base64 會讓 20MB 的檔案在 JSON 裡膨脹成約 27MB 的請求體，而且解碼後整份留在記憶體裡。對個人用的規模是可以接受的取捨，但這是一個真實的上限。
- v1 的 export 現在必須註冊在 `tasks_router` 之前。這是一個**順序上的**約束，程式碼本身讀不出來 —— 靠註解和那個守則測試撐著。
- MCP 只加了一個工具：`manage_attachments`（34 個）。這個必須加 —— MCP client 呼叫不了任意的 v1 端點，所以少了它，「agent 的產出有地方放」在**主要的** agent 通道上根本不成立。循環、cycle 讀取、templates、規劃 analytics 沒有給 MCP 工具：那些是 v1 呼叫者用得到的，而工具清單再長下去，選錯的機會會超過補上的價值。這是取捨，不是漏掉。

**仍然開著，而且是刻意的：**

`api-keys` CRUD（用 API 造 API key 是提權路徑）、`backup` 的 restore（毀滅性）、`assistant` conversations（LLM 呼叫 LLM）、`saved-filters`（純 UI 狀態）、`settings/system`。

**仍然沒收的一筆債：**

`/api/v1` 的 share facade 是第二份實作（它的 `rotate-token` 自己產 uuid，而不是呼叫內部那個 helper）。ADR-0073 的同一個形狀，還沒造成傷害，但它就在那裡。
