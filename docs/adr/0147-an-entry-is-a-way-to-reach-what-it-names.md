# ADR-0147: 一個條目就是通往它所指之物的路

## Status
Accepted

## Date
2026-09-04

## Context

Overview（`/`，Dashboard）是這個產品每天第一個被打開的畫面，它的職責是把需要注意的東西聚集起來：統計卡、command hero、四條優先級 lane、Due Soon、My Work、活動流、目標與決策簡報。

它每一個區塊都在**指名一件具體的事**，而其中大多數點下去不會發生任何事：

| 區塊 | 修改前 |
|---|---|
| StatCards 四個數字 | 完全不可點 |
| CommandHero（active / overdue / failed / in motion / latest signal） | 完全不可點 |
| PriorityWall 四條 lane 的任務列 | `/projects/{id}` |
| DueSoonPanel、MyWorkSection 的任務列 | `/projects/{id}` |
| OpsSidebar → 活動流 | 完全不可點 |
| OpsSidebar → 簡報的目標與決策 | 完全不可點 |
| ViewTasks 的任務列 | 只有就地展開 |

兩件不同的事，同一個成因。

**第一，沒有「一筆任務的深連結」這種東西。** ADR-0083 已經把 view 與 filter 放進 `ProjectDetail` 的 URL，但沒有任何參數指得到單一任務。所以能寫出來的最好連結就是 `/projects/{id}`——一個四十張卡片的看板，沒有任何東西指出你剛剛點的是哪一張。這在 lane 裡尤其糟：lane 的存在意義就是「這幾筆需要你」，而它把你送到一個不區分它們的地方。`utils/nodeHref.js` 有一條「這個節點在哪裡打開」的規則，但任務不在它的守備範圍：任務也是節點，`nodeHref` 會把它送去 `/n/{id}`——那是一個真的頁面，也是錯的頁面，因為它拿掉了任務被閱讀時所在的脈絡。

**第二，不可點的文字不會壞。** 活動流的每一列本來就帶著 `task_id`、`project_id` 和解析出來的 `node_type`（`ActivityLogOut` 一直都有），也就是說它一直知道每一行發生在什麼東西上，只是從來沒有提供過去的方法。沒有任何測試會失敗，沒有任何錯誤會出現——這正是它能存在這麼久的原因，和 ADR-0070 描述的「還能動的重複沒有故障徵狀」是同一類。

## Decision

**一個指名了某筆記錄的條目，就是一個可以啟動、而且會抵達那筆記錄的元素。**

三個部分：

**1. 目的地由一條規則決定。** `utils/nodeHref.js` 擴充 `taskHref`（任務 → `/projects/{id}?focus={taskId}`，沒有專案時退回 `/n/{id}`）與 `activityHref`（活動列 → 它的主體）。兩個 key 拼法都接受（`projectId` 與 `project_id`），因為 Overview 自己的兩種形狀就不一致，讀錯一個會組出 `/projects/undefined?focus=…`——一個會 route、會顯示「找不到專案」、看起來像後端故障的 URL。`activityHref` 依 `node_type` 分流而不是依欄位名，所以宣告了 `task` 角色的自訂型別照樣是任務（ADR-0090）。

**2. `?focus=` 是抵達一列的方式。** 五個任務視圖的列根都標上 `data-focus-id`，`hooks/useFocusRow` 是唯一知道「連結怎麼變成螢幕上的位置」的地方。列有正當理由不在場，每個理由的處置不同，所以是一道階梯而不是一次嘗試：

- pass 0：filter 或搜尋把它藏起來了 → 放寬後重試
- pass 1：目前的視圖畫不出它 → 切回 issue 列表
- pass 2：它真的不在這一頁 → `/n/{id}`，那一頁永遠畫得出來

階梯是狀態機而不是一串 effect，因為這幾階都**不會改變 `focus` 本身**；沒有明確的 pass 計數，effect 不會重跑，只有第一階會被試到。抵達後 `focus` 就從 URL 拿掉，理由和 `?new=` 一樣：重新整理或按上一頁，不應該把一列已經捲離的內容再捲回來、再閃一次。

子任務是這道階梯之外的一個特例：`IssueRow` 只在展開時才畫子代，所以連結指向的那一列**確實不在 DOM 裡**。`subtreeContains` 讓列在掛載時自己決定初始展開狀態——用 lazy initial state 而不是 effect，因為 effect 跑到的時候，搜尋早就找過並且錯過了。

**3. 數字是看見它所計算之工作的入口。** Dashboard 的 tab 與 scope 移進 URL（ADR-0083 的同一條規則）——「12 筆逾期」只有在「tasks 分頁、收斂到逾期」是一個 URL 的時候，才可能是一個連結。`ViewTasks` 收 `only=`，收斂時**先切片再算層級**：先留 top-level 再篩逾期，會把每一筆逾期的子任務丟掉，正是 ADR-0094 修掉的那類消失的工作。收斂中的列表會掛一個說明自己被收斂了的 chip，因為 `?only=` 可能是幾個畫面之前按的。

指名不到任何東西的條目**維持為純文字**。一個吞掉點擊卻哪裡都不去的按鈕，比一段文字更糟。

## Consequences

- Overview 上每一個指名記錄的條目都到得了它所指之物，包含在此之前完全不可點的四類。
- 從 lane、Due Soon、My Work 點任務會落在該筆任務上並閃現，而不是落在它的專案上。
- Dashboard 的 tab 與收斂條件現在在 URL 裡：可以被書籤、可以被分享、上一頁會回到正確的分頁。代價是 tab 切換會進歷史紀錄（刻意的，它是一次導覽），而收斂只做 replace。
- `?focus=` 在找不到列時會放寬使用者自己設的 filter。這是刻意的取捨：使用者剛剛要求看某一筆，看到它比保留篩選狀態重要；chip 與 URL 都會顯示狀態已改變。
- 階梯最後一階會離開專案頁去 `/n/{id}`。對子任務以外的情形這有點突兀，但它永遠有答案，而「安靜地什麼都不做」沒有。
- `hooks/useNodeTypeMap` 取代四處各自 `new Map(nodeTypes.map(…))` 的複本。
- `overviewEntriesReach.test.jsx` 斷言的是**規則**而不是個別連結：頁面上每一個面板都被檢查，所以第十二個用純 `<div>` 列寫成的面板會在這裡失敗。這一點是必要的，因為原本的缺陷從來不是某一條連結壞掉——是根本沒有連結，而那不會壞。
