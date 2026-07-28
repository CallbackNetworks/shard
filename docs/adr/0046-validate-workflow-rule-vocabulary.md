# ADR-0046: 工作流程規則的詞彙在寫入時驗證，標籤動作接受名稱

## Status
Accepted

## Date
2026-07-28

## Context

`WorkflowRule` 的三個欄位（`trigger`、`conditions[].field/op`、`actions[].type`）都是自由字串，
由 `services/rules_engine.py` 的 if/elif 鏈解讀。遇到不認得的值時：

- `_eval_condition` 走到 `else: return False` —— 條件視為「不符合」
- `_exec_action` 整串 elif 落空 —— 動作靜默不執行

兩者都不記錄、不報錯。結果是一條拼字接近但不合法的規則（`title` 之於 `title_contains`、
`equals` 之於 `eq`、`set_field` 之於 `set_priority`）會被 API 照單全收，在規則清單裡
看起來完全正常，`active=true`，但永遠不會執行，而且沒有任何地方會透露這件事。

正式環境的資料證實了這個風險：5 條規則中有 4 條帶著這種近似拼字，`run_count` 全為 0。
前端的下拉選單只會產生合法值，因此這些規則都是經由 API 直接寫入的（測試殘留或 agent 操作）。

另一個相關問題是 `add_label` / `remove_label` 的值必須是標籤 UUID。但標籤是專案範圍的，
而規則多半是全域的（`project_id` 為 null），所以填 UUID 等於把規則綁死在單一專案，
在其他專案一律查不到而靜默跳過。

## Decision

**一、詞彙由引擎定義，於寫入時驗證。**
`rules_engine.py` 除既有的 `SUPPORTED_TRIGGERS` 外，新增 `CONDITION_FIELDS`、
`CONDITION_OPS`、`ACTION_TYPES` 三個集合，作為唯一真實來源。`schemas.py` 的
`WorkflowCondition` / `WorkflowAction` / `WorkflowRuleCreate` / `WorkflowRuleUpdate`
以 `field_validator` 對照這些集合，不合法即回 422，錯誤訊息列出允許值。

因為 `rules_engine` 會拉進 service 層、而 service 層會匯入 `schemas`，驗證器內採用
延遲匯入（validator 在呼叫時才執行），避免匯入環。

集合與 if/elif 分支的同步由靜態掃描測試固定（`TestVocabularyMatchesTheEngine`）：
從 `rules_engine.py` 原始碼抓出所有 `field == "…"` / `op == "…"` / `atype == "…"`，
與三個集合比對。分支或集合任一方單獨變動都會讓 CI 紅燈。此手法沿用 ADR-0044 的理由 ——
if/elif 沒有可供執行期檢視的註冊表。

選擇在寫入時擋，而非在執行時記錄警告：規則的價值在於「設定完就不用再管」，
執行期警告只會進到沒人看的 log，而寫入時的 422 會直接打回呼叫端。

**二、標籤動作接受名稱或 ID。**
`_resolve_label()` 先以 ID 查（維持既有規則可用），查不到再於該任務所屬專案內以名稱比對，
仍找不到則記錄 warning 而非完全靜默。全域規則因此可以寫 `add_label: "urgent"`，
在每個有 `urgent` 標籤的專案各自解析。

**三、順帶修正 `/workflow-rules/{id}/test` 的乾跑端點**，補上 `_eval_condition` 的 `db` 參數 ——
與 ADR-0045 修掉的是同一個成因（`TaskView` 非 mapped instance，引擎無法自行取得 session），
先前會把所有 `has_label` 條件回報為不符合。

## Consequences

**正面**

- 拼錯的規則在建立當下就被擋下並指出合法值，不再變成永遠沉默的死規則。
- 詞彙只定義一次，前端選單、後端驗證、引擎分支三者一致；漂移由測試擋。
- 全域規則的標籤動作真正可用，不必為每個專案複製一條規則並填不同 UUID。
- 乾跑端點的結果與實際執行一致，「測試規則」按鈕重新可信。

**負面 / 取捨**

- 這是對外契約的破壞性變更：先前會回 201 的無效 payload 現在回 422。但受影響的
  payload 本來就對應到不會執行的規則，早失敗優於假成功。
- 資料庫中既有的無效規則不會被自動修正，也不會在讀取時被擋（`WorkflowRuleOut`
  不驗證）。歷史資料需人工修正或刪除；本次已一併處理正式環境的 4 條。
- 名稱解析在標籤數量大的專案是線性掃描。以規則觸發的頻率與單一專案的標籤數量而言，
  這個成本可忽略；若日後成為熱點，再加上以名稱查詢的索引即可。
- 靜態掃描綁定了 `_eval_condition` / `_exec_action` 的寫法。若改成 dict dispatch，
  掃描的正規式需同步調整 —— 屆時也就不再需要這個測試了。
