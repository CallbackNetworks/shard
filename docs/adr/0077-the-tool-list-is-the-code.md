# ADR-0077: 工具清單就是程式碼本身

## Status
Accepted

## Date
2026-08-14

## Context

`mcp_server/server.py` 有 1006 行，其中大約六成不是邏輯，是**同一件事講兩遍**：

```python
TOOL_DEFINITIONS = [
    types.Tool(name="list_tasks", description="...", inputSchema={...}),   # 21 份手寫的參數規格
    ...
]

@server.call_tool()
async def call_tool(name, arguments):
    if name == "get_summary": ...
    elif name == "list_tasks":
        result = await _list_tasks(args["project_id"], args.get("status"), ...)   # 20 個分支
    ...
```

一邊宣告「這個工具有哪些參數」，另一邊再手動把那些參數取出來、對位、傳給實作。**兩邊沒有任何東西保證一致**：

- `manage_labels` 的 schema 寫著 `required: ["action", "project_id"]`，dispatch 卻用 `args.get("project_id")` 讀它，於是漏傳 `project_id` 不會被擋下來，而是走進實作、回傳字串 `"project_id required for list action"`——**一個看起來成功的失敗**。
- `action` 宣告了 `enum: ["list","add","remove"]`，dispatch 收到 `"rename"` 也照樣執行，回傳 `"Unknown label action: rename"`。
- 整個 dispatch 包在一個 `except Exception` 裡，任何錯誤都變成 `"Tool error: ..."` 的**正常結果**。呼叫端要靠讀字串內容才知道失敗了——這正是 ADR-0051 對 webhook 未知狀態、ADR-0060 對簽章檢查處理過的同一種形狀。
- 新增一個工具要改兩個地方，忘記其中一個不會有任何錯誤訊息。

同時，`mcp` SDK 2.0 已經發布，而 **2.0 把這個寫法整個拿掉了**：低階 `Server` 不再有 `list_tools` / `call_tool` 裝飾器，只剩 `add_request_handler`。原本 1.x 裡那個 `mcp.server.fastmcp` 模組也不見了——它升格成內建的 `MCPServer`。也就是說「升級 SDK」和「改寫法」不是兩件可以分開排程的事，是同一件事。（版本釘死救了一次：ADR-0057 記錄過 `mcp>=1.0.0` 讓新 image 撈到 2.0 而在 import 就死掉，開發容器卻還活著。）

## Decision

改用 SDK 2.0 的 `MCPServer`，**工具的簽章就是它的 schema**：

```python
@mcp.tool(description="List tasks for a project, optionally filtered by status and/or priority.")
async def list_tasks(project_id: str, status: TaskStatus | None = None, priority: Priority | None = None) -> str:
    return await _list_tasks(project_id, status, priority)
```

21 份手寫 schema 和 20 個 `elif` 一起消失，檔案從 1006 行變成 736 行。「忘記加分支」這個錯誤**不再表達得出來**——沒有分支可以忘。列舉值集中宣告成 `Literal`，和後端的詞彙同一份（ADR-0056 的規矩）。

**實作層（`_get_summary`、`_list_tasks` …）一行都沒動。** 那 56 個測試打的就是這一層，保持不動等於這次改寫自帶迴歸網——只有註冊層和傳輸層被換掉，而那兩層本來就有新測試。

順帶被修好的行為（都是刻意的）：

| 情況 | 之前 | 現在 |
|---|---|---|
| 少傳必填參數 | 回字串「project_id required」，`isError=false` | 驗證失敗，`ToolError` |
| 列舉外的值 | 回字串「Unknown label action」 | 驗證失敗，`ToolError` |
| 工具內部丟例外 | 回字串「Tool error: ...」 | `ToolError` |
| 讀不存在的 resource | 回一個 body 是 `{"error": ...}` 的成功結果 | `ResourceNotFoundError` |

**錯誤變成錯誤。** 呼叫端不必再靠解析人話來判斷成功與否。

三個實作上的決定：

**HTTP 的 token 檢查包在 SDK 的 app *外面*，用一層樸素的 ASGI 函式。** 不用 `Mount`——ADR-0076 才付過這個帳：`Mount("/mcp")` 只匹配 `/mcp/...`，client 打的那個 `/mcp` 會變成 307，而**重導不是傳輸協定**。這次照樣踩了一次，症狀一模一樣。也不用 SDK 自己的 middleware 層：那層是「每一則 JSON-RPC 訊息」執行一次，跑到那裡時 HTTP 請求早就被接受了；token 是 HTTP 層的事。包一層還有一個好處是 lifespan scope 原封不動交給下層，session manager 的生命週期不歸我們管。

**DNS rebinding 保護明確關掉，不是靠參數剛好沒踩到。** `streamable_http_app()` 的 `host` 預設 `127.0.0.1`，而這個預設會**默默打開** DNS rebinding 保護、只允許 localhost 的 Host——nginx 後面每個請求帶的都是對外的 Host，會全部被擋。可以靠傳 `host="0.0.0.0"` 繞過那個 if，但那是「因為字串沒對上所以沒事」，不是決定。這個端點本來就是設計成公開的，守門的是 bearer token（ADR-0076），所以明確傳 `enable_dns_rebinding_protection=False` 並寫下原因。

**版本仍然釘死。** 理由和當初一樣，只是這次釘的是 2.0.0。

## Consequences

正面：

- 少 270 行，而且少掉的正好是「兩份要人工同步的東西」那一類。
- 工具契約經過比對：21 個名稱、required 清單、property 清單全部相同；三個差異是**選填**的列舉從頂層 `enum` 變成 `anyOf: [{enum}, {null}]`——值沒變，只是把「可以是 null」也講清楚了。
- resource template 不再手工解析 URI：`todo://projects/{project_id}` 直接把 `project_id` 當參數送進來。
- 失敗會像失敗。

負面：

- **這是行為變更，不是純重構。** 依賴舊行為（讀 `"Tool error: ..."` 字串）的呼叫端會看到協定層錯誤。以這個伺服器的使用範圍（自己的 agent）可以接受，但它確實不是相容的。
- 綁死在 SDK 對 signature → schema 的推導上。要描述得更細（例如某參數的長串說明）就得回頭用 `add_tool` 或 annotation，不再是改一個 dict 那麼直接。
- `mcp` 2.0 是新版本；協定 revision 從 `2025-11-25` 起跳的相容性由客戶端決定。實測 stdio 與 HTTP 兩種傳輸都完成了 initialize / tools/list / tools/call / prompts/list / resources/read。
