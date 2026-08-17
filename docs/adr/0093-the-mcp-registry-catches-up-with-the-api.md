# ADR-0093: MCP 註冊表要跟得上 API

## Status

Accepted

## Date

2026-08-16

## Context

ADR-0084→0085→0091→0092 這條線一路在補 `/api/v1` 的門，理由都是「一個能力不能只有瀏覽器做得到」。但這三個表面（內部 `/api`、`/api/v1`、MCP 註冊表）會朝**同一個方向漂**：工作發生在 v1，所以 v1 先長出來，MCP 工具清單安靜地落後。

把 MCP 模組實際呼叫的路徑抽出來跟 v1 路由表比對，落差是這樣的：

- **分析**：v1 有 8 份報表（burndown、cycle-burndown、velocity、heatmap、status-trend、critical-path、estimation-calibration、estimate-suggestion），MCP 只有 `analyze_workload`。也就是說 agent 可以問「現在什麼狀況」，但不能問「趨勢如何、還要多久」。
- **週期任務**：v1 有完整 CRUD，MCP 零。一個 agent 建得出任務，卻設不了「每週一重複」。
- **範本**：v1 有完整 CRUD，MCP 零。
- **分享設定**：v1 有 token 輪替、PIN、到期、訪客留言、瀏覽次數 —— ADR-0070→0073 花了四份 ADR 收斂成一份實作，MCP 一個都碰不到。
- **通知**：`get_notifications` 看得到，卻沒有任何工具可以標示已讀或刪除。**看得到、清不掉。**
- **edge type 寫入**：ADR-0086 特地在 v1 開了寫入權，MCP 完全沒有；node type 只有一個 `create_node_type`，連 ADR-0074 的 `fields` 宣告都表達不出來。
- 另外還有 `graph/map`（整張圖，定位用）、任務 JSON 匯出／匯入、integration 的 health／sources／templates／retry-all、單筆 delivery、容器的 contained-tasks 那一半。

**沒有任何東西壞掉，工具就只是不在那裡。** 這正是這類缺口最難發現的原因：沒有失敗症狀，只有做不到的事。

## Decision

補上 8 個新工具、擴充 3 個既有工具，並把兩個既有工具收攏。**一個能力一個工具名，不是一個端點一個工具名** —— 工具清單是模型真的會讀的選單，8 份分析報表變成 8 個工具名，會讓整份選單更難用。所以是 `get_analytics(report, ...)`、`manage_recurrence(action, ...)`、`manage_templates`、`manage_share`、`manage_notifications`、`transfer_tasks`、`get_graph_map`、`manage_email`。

**參數不足要在打出網路請求之前就拒絕。** 沒有 `cycle_id` 的 burndown 不是 burndown；工具在本地就回錯誤，省下一次往返，也讓錯誤訊息說得出缺什麼。

**兩個刻意的破壞性變更：**

- `create_node_type` → `manage_types(kind, action, key, config)`。舊工具只吃 key/label/roles，表達不出 ADR-0074 的 `fields` 宣告，也完全沒有 edge type 的寫入路徑。這不是整理，是換一個做得到事情的工具。
- `duplicate_cycle` → `manage_cycles(action, ...)`。這個工具昨天才隨 ADR-0092 出去，趁還沒有人依賴它先併進去，比之後再併便宜。

`get_notifications` **不動**。它和寫入動作分成兩個工具，正是這個 codebase 一直在拆的漂移形狀 —— 但使用者的全域 CLAUDE.md 直接點名了幾個工具、agent 的工作流程實際在用，為了對稱去破壞一個活的呼叫端不划算。兩邊的描述互相指向對方，理由寫在這裡。

**守門測試 `tests/test_mcp_reach.py`** 是 ADR-0085 那個形狀：列舉 v1 路由，任何一條既沒有工具可達、也沒有被寫進 `NO_TOOL` 並附上理由的，就失敗。「這條端點刻意沒有工具」是一個決定，不是可以從程式碼推導的事實，所以它必須是一份**寫著理由的名單**。新增一條 v1 端點因此會逼出一個選擇：寫工具，或寫下為什麼不寫。

`NO_TOOL` 目前分三類：自我描述的端點（`tools-schema`）、會交出整份資料庫或檔案位元組的端點（ADR-0091 已經決定過）、以及換條路已經到得了的端點（`subscriptions` ≙ `manage_integration`）。第三類最危險 —— 一個「另有他途」的理由如果哪天不成立，它就變成一個披著理由的缺口 —— 所以另有一個測試檢查它指向的工具還存在。

守門測試本身做過負向對照（ADR-0071 的教訓）：拿掉一條 `NO_TOOL` 之後它確實失敗，塞一條不存在的端點進去，過期檢查也確實失敗。

## Consequences

正面：MCP 工具 42 → 50，而 v1 的每一條端點現在不是可達、就是有一句寫下來的理由。agent 可以問趨勢、設定重複規則、管理範本、配置分享頁、清掉通知、匯出匯入任務、一次看懂整張圖。三個表面第一次有了會失敗的一致性檢查 —— ADR-0086 讓 `tools-schema` 從 MCP 註冊表生成，這一份補上另一邊：註冊表本身跟 v1 的落差。

負面與代價：兩個工具名消失（`create_node_type`、`duplicate_cycle`），任何寫死這兩個名字的呼叫端會拿到 "Unknown tool"。工具總數變多本身也是成本 —— 每個工具的描述都佔模型的 context，50 個已經接近「選單太長反而選不好」的邊界，所以下一次補東西應該優先擴充既有工具的 action，而不是加新名字。`manage_email` 是真的會寄信，不是草稿；它的 blast radius 比這批其他工具都大，描述裡明說了。最後，`test_mcp_reach` 的路徑抽取是靜態的、刻意寬鬆的（同名區域變數會取所有曾被指派過的值），所以它會漏報而不會誤報 —— 這是安全的方向，但它保證的是「沒有端點無人可達」，不是「每個工具都真的打得通」；後者由 `test_mcp_server.py` 逐個 mock 驗證。
