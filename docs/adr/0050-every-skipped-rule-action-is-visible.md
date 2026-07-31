# ADR-0050: 規則動作跳過時一律留下原因

## Status

Accepted

## Date

2026-07-30

## Context

ADR-0049 為「task-only 動作落在非 task 節點上」加了 `rule.skipped` 活動紀錄，理由是這個模組
反覆出現的缺陷形狀就是「執行不了卻不留痕跡」。但 `_exec_action` 裡有**三**個地方會執行不了，
當時只處理了一個：

1. 節點沒有 task 角色 → ADR-0049 已處理。
2. `add_label` / `remove_label` 的值在該專案裡找不到對應標籤 → `_resolve_label` 回傳 `None`，
   只寫一行 `logger.warning` 就 return。
3. `set_status` / `set_priority` 的值不在 `ACTION_VALUE_ENUMS` 裡 → `if value in ...` 不成立，
   什麼都不做，連 log 都沒有。

第 2 種在使用者的線上資料上是真的：`Auto-label security tasks` 這條規則要貼 `security` 標籤，
但該專案裡從來沒有這個標籤。規則每次都跑、`run_count` 每次都加一、`last_run_at` 每次都更新，
而標籤永遠沒貼上，介面上沒有任何地方說得出為什麼。從使用者的角度看，這條規則看起來是健康的。

第 3 種自 ADR-0046 起在寫入時就會被擋掉，但更早存下來的規則仍然可能帶著這種值。

另外 ADR-0049 寫的 `rule.skipped` 是 `project_id=None`，而活動頁是用 `project_id` 過濾的，
所以那筆紀錄只出現在全域列表、不會出現在使用者正在看的專案動態裡。

## Decision

**一、三種執行不了的情況都寫 `rule.skipped`，並帶上機器可讀的 `reason`。**

`_skip` 從「非 task 節點專用」泛化成「動作執行不了的統一記錄點」，多收一個 `reason`
（`not_a_task` / `label_not_found` / `invalid_value`）與一段給人看的 `detail`。
`reason` 放在 `meta` 裡，讓之後要在介面上分類顯示時不必去解析文字。

**二、`rule.skipped` 跟著主體的專案走。**

主體是 task 就用它的專案與 `task_id`；不是 task 就用 ADR-0049 的
`container_of_node` 找最近的容器。找不到容器才落回 `None`。理由很單純：寫進去卻沒人看得到，
和沒寫是一樣的。

**三、值域檢查從動作分支裡抽出來，前置成一次判斷。**

原本是 `if atype == "set_status": if value in ACTION_VALUE_ENUMS[...]` 這種巢狀寫法，
「不符合就什麼都不做」是縮排造成的，不是寫出來的決定。改成在進入分支前先查
`ACTION_VALUE_ENUMS`，不符合就記錄並返回，動作分支本身只剩下執行。

## Consequences

正面：

- 規則的三種失敗方式現在都看得見，而且看得見的地方是使用者本來就會看的那個專案動態。
- `reason` 是列舉值，之後要做「這條規則最近跳過了 N 次」這種提示不需要再改引擎。
- 值域檢查只有一處，新增一個有列舉值域的動作時不會漏掉它的失敗路徑。

負面與代價：

- 活動紀錄會變多。一條指向不存在標籤的規則，每次觸發都會寫一筆——但這正是要讓人看見的訊號，
  不是雜訊；規則修好了紀錄自然就停了。
- `rule.skipped` 只說了「這次沒做成」，沒有主動把規則本身標成有問題。要在規則列表上直接顯示
  「這條規則的動作一直失敗」是另一件事，留給後續。
- 使用者現存的 `Auto-label security tasks` 規則行為不變（仍然貼不上標籤），只是現在說得出原因。
  真正修好它要嘛在該專案建一個 `security` 標籤，要嘛改規則。
