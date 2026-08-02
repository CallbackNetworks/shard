# ADR-0058: 引擎取的名字唸成人話，使用者取的名字原字照搬

## Status
Accepted

## Date
2026-08-01

## Context

上線前做了一次前後端對照檢查，把 `client.js` 的 122 個呼叫點逐一比對線上的 OpenAPI spec。六個看起來對不上的都是誤報，但在 `client.js` 之外找到兩個真的缺陷：

1. **`CyclePanel.jsx` 用裸 axios 打 `/analytics/cycle-burndown`。** 內部 API 掛在 `/api` 底下（ADR-0036），根路徑只留給對外契約。而不論 dev proxy 或 production nginx，遇到不認得的根路徑都回 SPA 自己的 `index.html`——HTTP 200、`text/html`、一份 `.catch()` 永遠看不到的內容。燃盡圖就這樣一直畫著「沒有資料」，沒有任何一行紅字。這個錯誤只在那一個畫面上顯現，所以它可以活很久。
2. **`comment.*` 沒有人接。** 對外 API 廣播了這個事件（代理人留言就是這條路），前端 `useRealtimeSync` 的判斷式只認 `task.` / `project.` / `node.`。偏偏「沒有本地 mutation 可以順手失效快取」的情況，正是這個事件唯一存在的理由。

同一次檢查也看了 Rules 頁面。它把引擎的識別字原封不動印在畫面上：`changed_field eq in_progress`、`set_priority "high"`、`when: node.created`。這些字串是 API 收的字串，也是規則存下來的字串，該原樣留在線路上；但要求讀的人自己去解析識別字，是另一回事。

真正要判的是這條界線：哪些字可以改寫成人話？**引擎自己取的名字**（`changed_field`、`node.created`、`in_progress`）是產品造的詞，改寫只是換個唸法。**使用者自己打的字**（叫 `needs_review` 的標籤、自己發明的事件名、留言內容、負責人姓名）不行——把它們用別的字顯示回去比底線還糟，因為畫面上的字串就不再是拿去搜尋的那個字串了。

而這條界線該由誰知道？前端寫一份硬編碼清單是最快的做法，也正好是 ADR-0056 修掉的那個缺陷的翻版：詞彙表又多出第二個要同步的地方，後端加一個欄位，前端就默默地落後一版。

## Decision

**一、`vocabulary` 旗標由後端隨每個數值欄位一起送出。**

`rule_vocabulary.py` 的每個 slot spec 多一個布林 `vocabulary`，意思是「這一格的選項是產品造的詞」。封閉集合（`kind == "enum"`）預設為真——只有引擎能定義一個封閉集合。四個 `suggest` 類但選項由引擎命名的欄位（`status`、`priority`、`changed_field`、`edge_type`）明寫為真；`add_label`、`fire_event`、`add_comment`、`set_assignee`、`has_label`、`assignee`、`title_contains` 為假。伺服器新增一個條件欄位時，它會自己落在正確的那一邊，前端不必改。

**二、前端只有一層顯示名稱：`utils/ruleTerms.js`。**

`humanizeTerm` 把 `.` 和 `_` 換成空白並首字大寫。`triggerLabel` / `fieldLabel` / `opLabel` / `actionLabel` 走 i18next 的 `t(key, { defaultValue })`：**只在推導出的名字會誤導時才翻譯**，其餘一律用推導值，所以伺服器新增的觸發器、欄位、動作在什麼都還沒翻譯時就已經是可讀的。`valueLabel(value, spec)` 只在 `spec.vocabulary` 為真時改寫。存下去的原始 key 一律保留為 `<option value>` 與 `title` 屬性，畫面上讀到的是人話，滑鼠停住看到的是會被存起來的那個字。

`title_contains` 是唯一的特例：它的欄位名自帶動詞，而引擎只把它的 op 當否定用（`op != "neq"`）。把存下來的 op 印在旁邊，最好的情況是「Title Contains contains」的結巴，最壞的情況是「Title Contains is」——一個引擎根本不會做的比對。所以這個子句直接陳述引擎實際做的事：`Title contains "x"` / `Title does not contain "x"`。

**三、一次抓取，三個畫面共用。** `useRuleVocabulary(projectId)` 讓編輯器、規則卡片、活動列表讀同一份 React Query 快取。`RuleOutcomeChips` 收 `specs` 當 prop 而不自己抓，維持純呈現；Activity 頁與 Rules 頁因此把同一條執行紀錄唸成同一句話。

**四、根路徑呼叫由靜態掃描守住。** 新增 `internalApiPrefix.test.js`，掃過 `src/**/*.{js,jsx}`（排除 `__tests__`）所有交給 axios / fetch 的字面絕對路徑，斷言其開頭屬於對外契約清單。用靜態掃描而非執行時檢查，是因為這種錯誤只在那一個發出呼叫的畫面上現形。

## Consequences

- 規則現在唸得出來：`when: Node Created` / `if Role is "Task"` / `if Title contains "security"` / `→ Set Priority: High`，而標籤名 `security`、`urgent` 原字照搬。
- 界線由伺服器宣告，所以它只有一個版本。後端加一個 `suggest` 欄位而忘了標 `vocabulary`，預設是「使用者取的名字」——原字顯示，最壞情況是留著一個底線，不會把使用者的字串改掉。這是刻意選的失敗方向。
- 顯示層與線路層分離之後，「畫面上的字」與「存進資料庫的字」不再是同一個東西。這是一筆真實的成本：使用者回報問題時可能唸的是 `Changed Field`，而 API 裡叫 `changed_field`。`title` 屬性與 `<option value>` 保留原始 key 就是為了讓這兩者隨時可以對回去。
- 燃盡圖從此真的會畫出資料。守衛測試確認過會在缺陷被還原時失敗。
- 代理人留言現在會即時出現在畫面上，不需要重新整理。
- 已知但刻意不動的兩處：`conditions_met` 與 `last_run_at` 後端有送、前端沒讀。兩者都是資訊性的，不構成缺陷，記在這裡以免下次檢查又重新發現一遍。
- 驗證：後端 1007 passed / 1 skipped，前端 331 passed（42 檔），ESLint 與 ruff 皆乾淨，並在瀏覽器實地確認三張規則卡片的字面。
