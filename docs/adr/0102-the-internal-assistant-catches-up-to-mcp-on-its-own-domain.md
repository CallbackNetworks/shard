# ADR-0102: 內部助理補齊跟 MCP 同一個範圍的落差,不多不少

## Status

Accepted

## Date

2026-08-18

## Context

使用者問「這個方向還有什麼可以做」,我提了兩個候選,其中一個是「內部聊天助理能不能協助操作這個服務」——查下去發現這不是新能力,是舊落差:MCP(`mcp_server/server.py`)有 51 個工具,內部聊天助理(`assistant_tools.py`)只有 13 個,而且兩邊從一開始就是分頭長出來的,不是同一份清單的兩個檢視。

補齊之前先查出一件沒預期到的事:**內部助理完全沒有權限或確認機制。** MCP 的每一次呼叫都經過 `_require_scope(api_key, "read"/"write"/"admin")`,一把 key 能做什麼由它的 scope 決定;內部助理的 `dispatch_tool` 是一個裸的 `if/elif`,LLM 一喊就直接執行,吃的是完整、無限制的 `db: Session`,唯一存在的確認機制是 `manage_backup` 的 `confirm="replace"` 字串比對,而且只有那一個工具有。這代表 MCP 缺的 42 個工具裡,凡是碰到憑證輪替、寄信、發布外部 issue、備份還原這類東西,直接搬過來就是把它們的安全網從「scope 擋著」變成「什麼都沒有」。

## Decision

**只補跟任務/專案同類型的工具,這是使用者在調查結果攤開後親自定的界線。** 新增的 24 個工具(留言、依賴關係、通知、進度回報、專案讀寫、刪除任務、容器 rollup、批次更新、未歸檔、graph 全貌、ancestry、決策讀取匯出、cycle、分析報表、週期性規則、範本、附件讀取刪除、匯入、搬移)跟既有的 13 個工具是同一個風險等級——建立/修改真實資料,沒有確認步驟,現在也一樣沒有。**刻意不補**的一批(設定、備份、webhook/分享憑證、整合、CI 觸發、node/edge 型別註冊表、workflow rules、寄信、發布外部 issue)全部是憑證、外部副作用,或者影響範圍是整個實例而不是一筆資料——這批要嘛需要 MCP 那種 scope 機制的等價物,要嘛需要一個確認步驟,兩者現在都不存在,不該用「反正都補了」的慣性一起塞進來。

`get_analytics` 只支援 `burndown`/`cycle_burndown`/`critical_path`/`estimation_calibration`/`estimate_suggestion` 五種報表,不含 `velocity`/`heatmap`/`status_trend`——調查發現這三種在 MCP 那邊也沒有專屬的 service 函式,邏輯直接寫在 `routers/external_api/analytics.py` 的路由函式裡,要嘛複製那段查詢邏輯,要嘛先把它抽成 service 函式再呼叫,兩者都超出這次的範圍,先留著。`manage_attachments` 只做 `list`/`delete`,不做 `upload`——upload 要的是原始檔案位元組,一個聊天工具呼叫實際上只能傳 JSON 文字,LLM 沒有辦法附上一個它自己電腦裡的檔案。

每個新工具都直接呼叫 MCP 對應工具最終會呼叫到的同一個 service/graph 函式——跳過 HTTP 那段 proxy,也跳過 `_require_scope`/`_check_project_access`,因為兩者都是「這把 key 能看到什麼」的檢查,內部助理本來就沒有 key,運作方式跟 SPA 走的內部 `/api` 一樣是全權限。工具的 JSON schema 抄 MCP 現有的,參數名稱、enum 值一致,同一件事在兩個表面上不該有兩種說法。

寫測試的過程中,`transfer_tasks` 的匯出/匯入 round trip 對著自己的輸出跑失敗了——不是新程式碼寫錯,是 `services/task_transfer.py::export_rows` 一直以來對缺值的欄位(`due_date`/`start_date`/`time_estimate`/`time_spent`)吐 `""`,但 `TaskImportItem` 把這些欄位定型成 `datetime | None`/`int | None`,`""` 兩邊都不是。這個函式的路由層文件早就寫著「匯出的 JSON 跟匯入吃的是同一個形狀,所以匯出→匯入是一個 round trip」——這句話對任何一個有空欄位的任務從來就不成立,MCP 自己的 `transfer_tasks` 工具文件也重複了同一個承諾。順手把 `export_rows` 改成吐 `None`(csv 那條路徑不受影響,`csv.DictWriter` 本來就把 `None` 寫成空欄位),這個修正同時修好了既有的 v1/MCP 門,不只是新工具。

## Consequences

正面:內部助理現在能做的事,跟一個透過 MCP 連進來的 agent 在「任務/專案」這個範圍內能做的事,是同一份清單——不會再出現「MCP 能匯出決策紀錄,聊天助理不行」這種隨機的落差。順手抓到並修好一個既有的 round-trip 承諾破損的 bug。

負面與代價:內部助理的動作範圍變大了,而它依然是「LLM 一喊就執行,沒有確認」——`delete_task` 是這批裡唯一真正不可逆的操作,故意沒有加任何門檻,因為它跟既有的 `update_task`(可以把一個任務改到面目全非)本來就是同一種信任等級,加一個只在 `delete_task` 生效的門檻只是選擇性的心安,不是真的降低風險。真正要降低這整層風險,答案是幫內部助理設計一個範圍/確認機制——這次沒做,留給下一個決定。`get_analytics`/`manage_attachments` 是刻意的部分覆蓋,不是遺漏;真的需要 velocity/heatmap/status_trend 或附件上傳的時候,再回頭做。
