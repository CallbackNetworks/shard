# ADR-0056: 每一個數值欄位都知道自己該裝什麼

## Status
Accepted

## Date
2026-08-01

## Context

規則編輯器裡，「動作」那一列長這樣：一個下拉選單選動作型別，後面一個空白文字框填數值。
十八個位置（七種動作、十一個條件欄位）共用同一個文字框。

使用者的三個抱怨其實是同一件事：

1. **「Rules 裡面的 Fire event 有點抽象，沒人知道這是什麼。」**
   `fire_event` 是唯一一個效果不落在這一頁的動作 —— 它送出的事件由 Integrations 頁面上的
   整合去訂閱。畫面上從來沒有畫出這條線，所以它讀起來像「觸發某個東西」，而那個東西是什麼、
   會到哪裡去、有沒有人收，都無從得知。更糟的是：沒有任何整合訂閱的事件，送出去等於沒送，
   這正是 ADR-0047 一路在關的那類「安靜的空集合」。

2. **「切換 Action 的時候，後面的數值也不會變。」**
   `{ ...action, type: e.target.value }` 原封不動保留 `value`。把 `set_priority: high`
   切成 `add_label`，就會得到「加上名為 high 的標籤」；切成 `set_status`，就會得到一個寫入
   時被 422 擋下的狀態。使用者沒有輸入過這個值，它是上一個選擇的殘骸。

3. **「那個數值是讓人填寫的，沒人知道該怎麼填吧？」**
   對。`set_priority` 只收 `low|medium|high`，`edge_side` 只有 `source|target`，
   `has_role` 只有四個角色 —— 這些都是封閉集合，而畫面要求使用者憑記憶把字打對。

而後端其實早就服務了其中一小塊：`/api/workflow-rules/vocabulary` 回傳 `action_value_enums`
與 `task_only_actions`。前端從來沒有讀過它們 —— `grep` 整個 `frontend/src/` 只會命中測試檔。
這是同一個 bug class 往上一層：不是「引擎沉默地什麼都不做」，而是「後端老實說了，畫面沒有聽」。

更何況 `action_value_enums` 只涵蓋七種動作裡的兩種，十一個條件欄位裡的零個。ADR-0055 前幾個
小時才加進來的四個條件欄位（`changed_field`、`edge_type`、`edge_side`、`other_type`）全都有
明確的值域，一個都沒有被服務出去 —— 這是我自己剛留下的、同一個形狀的缺口。

## Decision

### 1. 值域和觸發器、欄位、動作型別一樣，是後端服務出來的詞彙

新增 `app/services/rule_vocabulary.py`，為**每一個**動作型別與**每一個**條件欄位提供一份
規格，由 `GET /workflow-rules/vocabulary` 的 `action_values` / `condition_values` 送出。
`action_value_enums` 被它取代並移除 —— 留著就是第二份要同步的清單。

規格只有三種 `kind`：

- **`enum`** —— 封閉。寫入層會拒絕集合外的值，所以編輯器必須給選單；集合外的值不是偏好，
  是一條不可能成立的規則。（`set_status`、`set_priority`、`type`、`other_type`、
  `has_role`、`edge_side`）
- **`suggest`** —— 開放，但有真實的東西可以提供：現有的標籤、可訂閱的事件、已註冊的關聯
  鍵、可能變動的欄位名。集合外的值合法（標籤可能明天才建立），所以提供而不強制。
  這與 ADR-0054 把「找不到標籤」記為 warning 而非 422 是同一條線。
- **`free`** —— 留言內容、人名。沒有東西可以提供，誠實的控制項就是一個文字框。

規格在讀取時從引擎自己的常數與當下的圖推導出來，不另外維護清單：`changed_field` 的候選是
`NodeUpdate` 的欄位加上 task 的資料欄位，`type` 是節點型別註冊表，`edge_type` 是關聯型別
註冊表。因此「服務出去的值」與「引擎看得懂的值」是同一份東西，不會各自漂移。

### 2. 封閉集合的順序是有意義的順序，不是字典序

`ACTION_VALUE_ENUMS` 由 `set` 改成有序 tuple：`("todo", "in_progress", "done", "failed")`、
`("low", "medium", "high")`。理由是它現在同時是下拉選單的內容 —— 字典序會把 `done` 排在最
前面，並讓優先度讀成 high/low/medium：同一份詞彙，呈現成沒有意義的東西。改成 tuple 之後
`in` 與驗證行為完全不變，而序也只有一份。

### 3. 切換動作型別或條件欄位時，數值重設

`enum` 落到第一個選項（唯一在構造上就合法的選擇），其餘一律清空。不猜測標籤名或事件名 ——
那等於替使用者發明他沒有寫過的內容。

### 4. `fire_event` 以它的目的地命名，並當場說出誰會收到

- 名稱改為「送出整合事件 / Send integration event」。這是唯一一個以 i18n 覆寫的動作名稱；
  其餘仍由 `humanize(type)` 推導，所以後端新增的動作型別不需要先翻譯就能讀。
- `action_values.fire_event` 附帶 `subscribers`：每個事件目前有幾個啟用中的整合會收到。
  規格與計數一起送，編輯器就能在規則還在編輯時說「目前有 N 個整合會收到」，或者在沒有人
  訂閱時警告「送出後沒有人會收到，請到 Integrations 新增一個」。
- 計數與 `event_has_subscriber` 一樣是**不分專案**的：全域規則會在每個專案觸發，所以
  「這個專案沒有人聽」不足以判定它是死的。

### 5. `task_only_actions` 終於被讀了

每個觸發器現在都對所有節點型別發生（ADR-0049/0055），所以除 `fire_event` 外的動作會在
專案、標籤、cycle 上被跳過。編輯器在規則尚未以 `has_role = task` 或 `type = task` 限縮時，
於動作區塊下方說出哪些動作只對 task 有效。只說一次，而且只在還沒限縮時說。

### 6. 順帶清掉的死鍵

`rules.actionSetStatus`…`rules.actionFireEvent`、`rules.triggerCreated`…
`rules.triggerPriorityChanged`、`rules.wouldFire`、`rules.taskIdPlaceholder` 這些 i18n 鍵
沒有任何地方讀取，其中觸發器那四個在 ADR-0055 之後還是錯的（那些觸發器已經不存在）。
一併刪除 —— 留著一組沒人用又是錯的字串，跟留著一條永遠不會觸發的規則是同一種東西。

## Consequences

**正面**

- 十八個數值位置全部有明確的控制項。封閉集合不可能填錯；開放集合看得到現有的東西；
  自由文字有對應的提示文字。
- 切換動作型別不再留下上一個選擇的殘骸，也就不再產生「儲存時 422」或「執行時安靜跳過」。
- `fire_event` 從一個沒人看得懂的詞，變成一個會說出自己送到哪裡、有沒有人收的動作。
  規則還沒儲存，就已經知道它會不會落空。
- 後端服務、前端未讀的缺口關閉；`grep action_values` 現在會命中真正的渲染路徑。

**負面 / 代價**

- `/workflow-rules/vocabulary` 從純常數變成需要 DB：它現在查標籤、節點型別、關聯型別、
  整合。查詢量小（型別註冊表與整合表都是小表），但前端的快取從 `staleTime: Infinity`
  降為 30 秒，因為標籤與訂閱會在別的頁面被改動。
- 標籤建議是不分專案的（除非傳 `project_id`），在標籤很多的實例上清單會偏長。決策紀錄
  （`data.type == "decision"` 的 label 節點）已排除；合法性不變，只是不再建議。
- `suggest` 用 `<datalist>` 實作。瀏覽器的 datalist 樣式無法自訂，與其餘深色 UI 不完全
  一致；換得的是「可打字也可挑選」這個正確語意，不值得為了外觀改用自製 combobox。
- 條件欄位的值域是「提供」而非「驗證」：條件的值引擎完全不檢查（條件只做比較，不做寫入）。
  所以一個打錯字的條件仍然可以存下來、仍然什麼都不匹配。這一層留給 dry-run 與
  `rule_warnings`，本 ADR 不擴大寫入層的拒絕範圍。
