# ADR-0092: 工作進得來、出得去、歸得了檔，兩道門都要能做

## Status

Accepted

## Date

2026-08-16

## Context

ADR-0091 清掉了三個表面比對後剩下的「維運類」內部獨有路由。同一份比對裡還有另一類，跟工作內容直接相關，而且其中一條是整個產品裡**最像 agent 該做的事**：

- `POST /api/projects/{id}/import/{trello,linear,github}` —— 把一疊 issue 變成任務。這件事只有「在設定頁按檔案選擇器的人」做得到。一個手上握著 GitHub issue 清單的 agent，只能一次一個 POST 慢慢建，而且得自己重寫標籤比對、狀態對應、優先度對應 —— 那三份對應邏輯本來就在伺服器上。
- `POST .../tasks/{id}/create-external-issue` —— 反方向。雙向 issue 同步一直只有單邊對 agent 開放：外面的 issue 進得來，之後每次狀態變動兩邊都同步，但**從這邊開啟這段關係**的那個動作是內部路由。agent 可以在這裡規劃工作，卻不能把它發佈到人和 CI 看得到的地方。
- `GET /api/tasks/unfiled` 與 `POST /api/tasks/{id}/memberships/{project_id}` —— 一個任務可以合法地掉到零個專案成員關係（ADR-0032／0033），那時它不是不見了，是**未歸檔**。UI 有這個桶子，`/api/v1` 沒有這個概念。而且 MCP 有一個叫 `triage-inbox` 的 prompt 要模型去整理收件匣 —— **prompt 存在，它要看的資料不存在**。
- `GET /api/decisions` —— 決策記錄。assistant 的 prompt 明文要求它在做出決定時寫一筆（ADR-0089），然後讀不回來。一個 agent 寫了自己永遠查不到的記錄，等於在幫別人寫日記。
- `POST .../cycles/{id}/duplicate` —— 衝刺輪替。ADR-0086 當時把它排除在外，理由寫在 `cycle_admin` 的 docstring 裡：「它會 broadcast、會跑任務建立管線」。回頭看，那句話描述的是**程式碼住在哪裡**，不是**誰可以呼叫它**。服務層當然可以 broadcast。

## Decision

五個能力各自收斂成服務，兩道門呼叫同一份：`task_import`、`issue_sync_admin`、`task_filing`、`decision_admin`，以及搬進 `cycle_admin` 的 `duplicate`。

**匯入器的契約是部分成功。** 二十筆好的加一筆沒有標題，結果應該是二十個任務加 `errors` 裡一行，不是 422 和什麼都沒有 —— 所以回傳的是 `{imported, skipped, errors}` 而不是一個狀態碼。三個匯入器各自保留自己的形狀，因為來源真的不同（Trello 有 `closed`、Linear 有 1-4 的優先度、GitHub 有 number 和 html_url 值得留成外部連結）；但「來源怎麼叫它」之後的每一步都是共用的：標籤照名字找或建、每個任務跑一次建立管線（`commit=False, broadcast=False`）、整批落在一個 transaction 一次廣播。

**MCP 工具收下來源自己的形狀。** `import_tasks(project_id, source, payload)` 直接把 payload 原封不動送出去。在工具這層再定義一套正規化格式，等於多一份對應邏輯要跟伺服器同步 —— 那就是 ADR-0086 把 `tools-schema` 改成生成的理由。

**決策記錄刻意只讀。** 寫一筆決策已經有門了：它是一個 node，`POST /api/v1/nodes` 加 `type="decision"` 就會經過單一寫入表面（ADR-0040→0043）。在這裡補一個專屬寫入路徑，正是 ADR-0087 花整份文件在拆掉的那種重複。

**scope 沿用既有判準，不另外發明更嚴的。** 會建立任務或外部 issue 的動作是 `write`，桶子和決策記錄是 `read`。這裡沒有任何回應帶著憑證，所以 ADR-0084 那條「因為 redaction middleware 會把欄位拿掉，所以必須 `admin`」的論證不適用；在沒有理由的情況下加嚴，只會讓這道門比它要取代的瀏覽器還不好用。

順手把 `create_external_issue_from_task` 的 `HTTPException` 換成 `ServiceError`。它本來就是共用程式碼，兩道門拿到的答案其實一樣，但 refusal 的型別是這個 codebase 的約定（ADR-0085），而約定的價值在於下一個人不必判斷。

守門測試 `tests/test_intake_surface_parity.py`：同一個資料庫、兩道門、比對狀態碼與 detail 文字。另外 `test_task_pipeline_guard.py` 的 `EDGE_ALLOWED` 名單跟著程式碼搬家 —— 那個測試在這次重構中確實叫住了我們兩次（`services/task_import.py` 和 `services/cycle_admin.py` 寫 edge 但不 dispatch），這正是它存在的理由：豁免必須跟著實作走，而不是留在原檔名上變成過期的許可。

## Consequences

正面：一個 agent 現在可以把 GitHub 的 issue 整批倒進來、把規劃好的任務發佈成真的 issue、看見並清空未歸檔的收件匣（`triage-inbox` 這個 prompt 終於有資料可看）、讀回自己寫過的決策記錄、把上一個衝刺輪成下一個草稿。ADR-0084→0085→0091→0092 這條線走完之後，三個表面的機械比對只剩下 API key 管理（刻意不開，一把 `write` key 生出 `admin` key 就是提權）、assistant 對話、以及純 UI 偏好（saved filters、dashboard widgets）。

負面與代價：匯入器現在可以由 API key 觸發，而匯入是**批次建立任務**，所以一把 `write` key 打錯一次的後果從「一個任務」變成「一百個任務」。部分成功的契約讓這件事更難察覺 —— 200 加上一個 `imported` 數字，沒有東西會叫住呼叫者。緩解方式是既有的：`import.{source}` 活動記錄照舊寫入，而 ADR-0091 的 `POST /api/v1/backup/run` 現在也是 agent 叫得動的，所以「先拍快照再倒資料」在同一次對話裡做得到。另外 `issue_sync_admin` 在函式內部 import `routers/issue_sync`，方向是反的；那 866 行的模組該搬進 services，但那是一次沒有任何使用者面向問題的搬家，留給下一次。
