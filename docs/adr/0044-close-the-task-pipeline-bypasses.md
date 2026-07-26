# ADR-0044: 關閉 Task Pipeline 的旁路，並以 guard test 固定此不變式

## Status
Accepted

## Date
2026-07-26

## Context

ADR-0038 建立了 `services/task_mutations`：所有 task 的建立與更新都必須跑同一段
後置流程 —— activity log → workflow rules → 對外通知 → external issue 同步 →
WebSocket broadcast。當時的理由是各 router 各自手寫這段序列會漂移，而漂移的症狀
是「靜默少做事」而非報錯。

ADR-0038 之後陸續新增與改寫的程式碼，又長回了同樣的問題。全面稽核後發現 **8 個
旁路點**，它們直接呼叫 `graph.create_task` / `graph.update_task` 就結束：

| 位置 | 症狀 |
|---|---|
| `routers/imports.py` ×3（Trello / Linear / GitHub） | 匯入的 task 不觸發任何 rule、不發任何通知 |
| `routers/bulk.py` `_create_task_recursive` | JSON 匯入的整棵樹同上 |
| `routers/cycles.py` `duplicate_cycle` | 同上，且完全沒有 broadcast，前端要重整才看得到 |
| `services/scheduler.py` `_check_recurring` | 週期性產生的 task 不觸發 rule、不通知 |
| `routers/issue_sync.py` inbound issue create/update | GitHub 開/關 issue 不觸發 rule、不通知 |
| `routers/issue_sync.py` PR 事件 ×3 | 手寫了 log + broadcast，但漏掉 rules 與通知 |

值得注意的是這些旁路**沒有任何測試會失敗**。task 確實被建立了、狀態確實被改了、
API 回應也正確；少掉的只是「本來應該連帶發生的事」。這正是 ADR-0038 想根除、卻
沒有機制去維持的那一類 bug。

另外發現一個相關的資料遺失：`_check_recurring` 在 `db.commit()` **之後**才呼叫
`log_activity`（只做 flush 不 commit），因此最後一條 recurrence rule 產生的
`task.recurred` 紀錄從來沒有被寫進資料庫。

順帶更正一項紀錄錯誤：ADR-0041 的 Context 段落聲稱 `import_*` 已經走
「`graph.create_task` + pipeline」。這與當時及此 ADR 之前的程式碼不符 —— 它們只有
`graph.create_task`。歷史 ADR 不修改，在此更正。

## Decision

**一、把全部 8 個旁路點接回 pipeline。**

批次型路徑（imports、bulk import、cycle duplicate）以
`commit=False, broadcast=False` 逐筆跑 pipeline，最後由呼叫端做一次 commit 並發出
一個彙總事件，維持「一個批次 = 一個交易 = 一次 broadcast」。順序上先掛好 label 與
cycle 關聯再 finalize，讓依賴 label 的 rule 看到的是最終形狀的 task。

由外部系統觸發的路徑（issue_sync 的 inbound issue 與 PR 事件）一律帶
`sync_external=False`。這些變更本來就來自 provider，再推回去會形成 echo 迴圈。

`_SOURCE_SUFFIX` 增加 `import` / `recurrence` / `duplicate` / `pr` / `issue-sync`
五種來源，讓 activity log 的敘述能說明變更是誰造成的。

**二、以 guard test 固定此不變式**（`tests/test_task_pipeline_guard.py`）。

只把旁路修好是不夠的 —— ADR-0038 已經修好過一次，兩個月後又長回來了。真正的問題
是這個不變式沒有任何強制機制。新測試做三件事：

1. 任何 `app/` 底下的模組若直接呼叫 `graph.create_task` / `graph.update_task`，
   同一檔案內必須也出現 pipeline 呼叫，否則測試失敗。
2. 豁免清單（`ALLOWED`）必須逐項寫明理由，且不允許有「已經沒有直接寫入」的過期項目。
3. `run_rules` 只能從 `task_mutations` 被呼叫。

豁免的只有真正不可能觸發 rule 的欄位寫入：`reminder_sent_at`、`callback_token`
重新產生、external_* 連結欄位、progress 欄位。

選擇靜態掃描而非執行期斷言，是因為這個 bug 的本質就是「不執行」—— 執行期的
assertion 在旁路上根本不會被跑到。

## Consequences

**正面**

- 匯入、週期性、cycle 複製、issue/PR 同步產生的 task，行為與手動建立完全一致：
  同樣觸發 workflow rules、同樣發出通知、同樣即時同步到前端。
- `duplicate_cycle` 從同步函式改為 async 並補上 broadcast，前端不再需要手動重整。
- 修好 recurrence 最後一筆 `task.recurred` activity 遺失的問題。
- 下一次有人新增 task 寫入路徑而忘記跑 pipeline，CI 會直接擋下，並在錯誤訊息裡
  說明該怎麼做。這是 ADR-0038 缺少的那一半。

**負面 / 取捨**

- 匯入現在每筆 task 都會跑 rules 與通知，大批匯入的耗時與對外請求量都會上升。
  維持單一交易與彙總 broadcast 已經吸收了大部分成本，但語意上這就是「匯入的 task
  是真正的 task」該付的代價。
- PR 同步的 activity 敘述由「completed by merged PR #42」改為 pipeline 的標準句型，
  PR 編號改放在 `meta` 裡。人類可讀性略降，換得所有來源的 activity 格式一致。
- guard test 是字串比對，不是型別系統。它抓得到「整個檔案都沒跑 pipeline」，抓不到
  「同檔案內某一條分支漏跑」。這是刻意的取捨：更嚴格的分析（AST / call graph）
  複雜度不成比例，而檔案粒度已經涵蓋了實際發生過的全部 8 個案例。
- 新增的豁免項目需要人工判斷「這個欄位真的不會觸發 rule 嗎」。理由必須寫進
  `ALLOWED`，讓判斷本身可以被 review。
