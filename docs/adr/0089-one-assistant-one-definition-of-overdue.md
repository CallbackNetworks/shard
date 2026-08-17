# ADR-0089: 一個助理，一個「逾期」的定義

## Status

Accepted

## Date

2026-08-16

## Context

ADR-0088 之後被問到「還有什麼該調整？比如 Assistant 那邊？」。實際跑起來看，Assistant 是問題最集中的地方，而且不只是不好看 —— 其中一項是真的錯。

**Assistant 有兩份完整實作。** `pages/Assistant.jsx` 和 `components/AssistantPanel.jsx` 各自持有：一個 `axios.create({ baseURL: '/api' })` 加上自己的 auth interceptor、同樣那四個對話 API、自己手寫的 SSE 讀取迴圈、自己的 `ToolBlock` / `MessageBubble`，以及自己的 `PROMPT_TEMPLATES`。

而且**已經漂移了**。同一顆按鈕在兩個介面送出不同的文字：

- 「Plan today」在頁面版只說「建議我今天該專注什麼」，在面板版多了「優先處理逾期與高優先項目」。
- 「Analyze Decisions」在頁面版只要求分析；在面板版要求 **建立決策記錄並為相關任務打標籤** —— 也就是寫入資料庫。

同一個標籤、同一個圖示，一個會寫、一個不會。兩邊都回 200、都串流出回覆，沒有任何失敗徵兆 —— 這正是 ADR-0070 描述的那種重複：還能動，所以沒有症狀。

同一片區域還有四件事：回覆用 `whiteSpace: 'pre-wrap'` 當純文字印出來，而 LLM 回的是 Markdown（app 裡已經有 `MarkdownPreview`，IssueRow 在用）；prompt 文字硬編英文，而 `assistant.promptOverdueText` 這些 key **兩份語系檔裡都在、沒有人讀**，所以中文使用者按中文標籤送出英文問題；那兩個私有 axios instance 繞過了 `api/client.js` 的 response interceptor，也就是離線佇列的唯一產生點（ADR-0062）與全域錯誤提示；而浮動 FAB 連在 `/assistant` 頁面上都會出現，一個畫面兩個助理，共用同一批對話。

還有一個存在資料庫裡的：`StubProvider` 把「LLM provider not configured…」當成 `text` 事件送出，於是 router 把它**存成一則 assistant 訊息**。一個部署設定問題變成了永久的對話歷史，而且在 provider 設好之後還留在那裡。

**「逾期」有三個定義。** 這個更嚴重，因為使用者會直接看到兩個不同的數字：

| 位置 | 規則 | 開發資料庫上的數字 |
|---|---|---|
| 後端（六個位置，全都一致） | `due_date < now AND status NOT IN (done, failed)` | 81 |
| 前端各種計數（11 個內嵌 + `commandCenter.js` 自己的 `isOverdue`） | `status !== 'done'` | 91 |
| 前端「Overdue」篩選（`taskFilters.js`） | 完全不看 status | — 連完成的工作都列出來 |

首頁說 91、分析頁說 81，同一份資料、同一個字。而且把規則統一之後還剩 83 vs 81 的差距，原因是第四件事：**分析頁的查詢寫的是 `Node.type == NODE_TASK`（字面上的內建型別）**，而宣告了 task 角色的自訂型別在 app 其他每個地方都是一等任務（ADR-0033／0035）。seed 資料裡的兩個 `incident` 因此從分析頁的每一個數字裡消失。

其餘四項較小的：分析頁的圖表圖例直接印引擎原始值（`done` / `in_progress`，帶底線），`.kt-input` 有樣式但沒有 `appearance: none`，所以**全站每一個 `<select>` 都保留作業系統的原生外觀**；`.kt-btn-danger` 用的是品牌琥珀色，讓刪除鈕成為那一列裡最醒目的控制項；目標卡在沒有連結任何任務時畫一條 0% 的進度條，讀起來像「量過是零」而不是「沒有東西可量」。

## Decision

**Assistant 是一份實作、兩個版面。** `components/assistant/` 下面放 `useAssistantChat`（對話狀態、查詢、mutation、SSE）、`ChatMessages`（`ToolBlock` / `MessageBubble` / `StreamingMessage`）、`PromptChips` 和 `prompts.js`。四個對話 API 移進 `api/client.js`，和其他每一個呼叫放在一起；串流仍然用 `fetch`（axios 不能串流），但 URL 與 auth header 在同一個檔案裡解析，所以兩個介面不可能在這兩件事上分歧。頁面與面板只剩下版面。

prompt 文字改成從語系檔取，所以問題會用讀者的語言送出去。`promptDecisions` 的**標籤**改成「整理並記錄決策」—— 會寫入是真的能力（`create_decision`、`tag_task_with_decision` 這兩個工具就是為此存在），漂移的問題在於標籤沒說。助理的回覆改用 `MarkdownPreview` 呈現；**串流中的文字刻意維持純文字**，因為寫到一半的 Markdown 會渲染成亂碼，而且每個 chunk 重新解析整篇是白做工。`MarkdownPreview` 的樣式從 per-instance 的 `<style>` 移進 `global.css`（否則一段對話有幾則訊息就有幾份相同的 CSS）—— 順手發現 `MarkdownEditor` 裡有一份**漂移的副本**，它的連結色寫死 `#facc15`，在淺色模式下不可讀。

面板在 `/assistant` 上自己隱藏。`StubProvider` 改送 `error` 事件，router 轉發但**不寫進歷史**：設定問題不是對話裡的一輪。

**「逾期」有一條規則，兩端各講一次。** 後端 `graph.overdue_clause()`（SQL）與 `graph.is_overdue()`（Python），前端 `utils/overdue.js`。採用後端原本的規則：**失敗的任務不算遲到，它是失敗** —— 那是另一個問題、另一種處理，而且已經被算在自己的狀態底下。分析頁的查詢改用 `graph.task_type_filter()`，任務型別由註冊表決定而不是字面比對。

守門測試三支：`tests/test_overdue_agreement.py` 建一個涵蓋所有情況的專案（含一個自訂 task-like 型別），問每一個回報逾期的介面同一個問題；`utils/__tests__/overdue.test.js` 釘住規則，並**靜態掃描整個前端**，任何檔案再把 `due_date` 和 status 比較寫在一起就失敗；`components/assistant/__tests__/oneImplementation.test.js` 斷言兩個介面都沒有自己的 axios instance、自己的 SSE 讀取、自己的 prompt 清單。

小的四項：圖例走 `STATUS_MAP[...].labelKey`；`select.kt-input` 加上 `appearance: none` 與自繪的 chevron，一次修好全站；`.kt-btn-danger` 平時安靜，hover／focus 才轉紅；`GoalOut` 補上 `total_tasks` / `done_tasks`（本來就算出來卻丟掉），沒有連結任務的目標顯示「尚未連結任何任務」而不是一條 0% 的進度條。

## Consequences

正面：同一顆 prompt 按鈕在哪裡按都做同一件事，而且按鈕上的字說得出它會寫入；助理的回覆讀得懂；助理的寫入現在會進離線佇列、錯誤會進 toast；「逾期」在整個產品裡只有一個數字，而且第十二份副本會讓測試紅；全站下拉選單終於是同一個主題；刪除鈕不再是最搶眼的按鈕。

負面與代價：`MessageBubble` 每則助理訊息掛一個 tiptap editor 實例 —— 對這個個人工具的對話長度沒問題，但如果之後要載入很長的歷史，這裡會是第一個要換掉的東西（換一個輕量 Markdown renderer，代價是多一個相依套件）。`test/setup.js` 初始化真正的 i18n singleton、`test/i18nMock.js` 解析真正的英文之後，斷言使用者可見文字的測試必須寫**文字**而不是 key —— 這次順手改掉了 Goals 的一批斷言，未來新測試也要照這個寫法。

明確**沒有**做的：`scheduler.py`（提醒、摘要、SLA 老化）和 `critical_path.py` 還有 9 個位置用字面 `Node.type == NODE_TASK`，所以自訂 task-like 型別不會收到到期提醒、不會進日／週報。那和分析頁是同一類錯誤，但改它會改變**誰會收到通知**，那是一個獨立的決定，不該夾帶在這次修版面的變更裡。

Assistant 目前有 13 個工具，MCP 有 34 個（ADR-0077）。這次沒有動：那是「助理該能做多少事」的產品問題，不是重複實作。
