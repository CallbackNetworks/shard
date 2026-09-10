# ADR-0157: 一條關係要畫在讀它的陌生人面前

## Status
Accepted

## Date
2026-09-09

## Context

使用者看著自己的分享頁說了兩句話：「Ask a question 好像不太適合放在中間那個對話欄位」、「另外 Node 之間的 Graph 也沒有提供，不太明顯」。

兩句都是關於同一個表面——`/share/n/{token}`，這個 app 裡**唯一一個由不在場的人閱讀**的畫面。

### 一、問答助理長成一個沒有歸屬的輸入框

ADR-0098 把公開問答助理放進捲動流，夾在「決策」和「近期活動」之間。實際畫出來是一行 `ASK A QUESTION` 小標加一條單行 input（截圖量到高度 28px），上下都是內容區塊。

問題不在它醜，在於**它讀起來像是上一段內容的留言欄**。同一頁上方每一個任務展開後就真的有一個留言框（`GuestNotes`，樣式同一套 `kt-share-note-form`），所以「頁面中間一條 input」在這一頁已經有既定意義了，而那個意義不是「問這個專案的問題」。

還有一個更基本的：**問題是「對著正在看的東西」問的**。放在捲動流第四段，意思是你必須先離開你想問的那一段、捲到它、然後在那裡打字。

### 二、關係全都在資料裡，一條都沒畫

分享頁的 payload（`share.py::_serialize_project`）本來就帶著這些東西：

| 關係 | payload 欄位 | 頁面上呈現成 |
|---|---|---|
| 專案裝著任務 | `projects[].tasks[]` | 一張卡片裡的清單 |
| 任務裝著子任務 | `tasks[].subtasks[]` | 展開後的縮排清單 |
| 任務被任務擋住 | `tasks[].blocked_by[]` | 展開第三層的一行 `Blocked by: A, B`（逗號串起來的字） |
| 決策取代決策 | `decisions[].supersedes` | 決策卡上的一枚 chip |
| 決策治理任務 | `decisions[].governs` | 決策卡上的一枚 chip |

三件事同時成立：**（a）** 全部是字，沒有一個是形狀；**（b）** 依賴那一條藏在「展開任務 → 往下看 → 一行逗號」的第三層；**（c）** 每一條都**只有一端說得出口**——任務展開會說「被 A 擋住」，A 那一列什麼都不說；決策說得出它治理哪個任務，而那個任務從頭到尾不知道有一條決策決定了它。

第三點正是 ADR-0122（`governs` 只有決策那一端有控制項）和 ADR-0155（關係只在 Data 頁編得動）已經在 owner 那一側處理過的同一個形狀。分享頁沒有跟上，而分享頁恰好是**最需要它的那一面**：owner 記得為什麼，讀連結的人不記得，因為他從來就不知道。

### 順手量到的三個既有缺陷

做這件事必須把 owner 的結構圖機器（`deriveGraphStructure` + `structureMapLayout` + `MapCanvas`）接到公開 payload 上。接上去的過程本身就是稽核，量到三個活著的缺陷：

**1. 結構圖上每一筆決策都顯示 `proposed`。** `graphStructure.js` 讀 `n.data?.decision_status`。ADR-0130 已經把決策狀態搬到 `nodes.status` 欄位、並且**把往 `data` 寫這個鍵變成 422**。所以自那次 migration 之後，`/graph/map` 回來的 78 筆決策裡 `data.decision_status` 全部是 `null`，狀態全部 fallback 成 `proposed`：

```
Counter({'proposed': 64, 'accepted': 10, 'superseded': 4})   # nodes.status
Counter({None: 78})                                          # data.decision_status
```

連帶壞掉的是 ADR-0128 的規則——「結構圖要留下被邊指到的已定案決策」——那條規則讀的就是這個狀態，而它讀到的是一個常數。`pendingDecisionCount` 也一路等於決策總數。

**測試沒抓到，因為 fixture 寫的是程式碼讀的那個欄位，不是伺服器送的那個欄位**：`{ id: 'd1', type: 'decision', data: { decision_status: 'proposed' } }`。這是守門測試最典型的失效方式——它驗的是自己那份假資料的內部一致性。

**2. dependencies 模式下的任務卡版面是壞的。** `.kt-map-node` 是兩欄 grid，圖示 `grid-row: 1 / span 2`。在 dependencies 模式，任務卡多長出第三行（`N depends on · M blocks`），auto-placement 把它放進**第一欄第三列**，把圖示欄撐開，標題被擠到卡片右緣。這在 owner 的 `/structure` 切到 dependencies 模式時一樣壞，只是那不是預設模式所以沒人常看到；分享頁的圖**永遠**是 dependencies 模式，所以它變成第一眼就看得到的東西。

**3. 空欄位上掛著標題。** mindmap 版面的三欄是固定幾何。一個沒有身分的專案分享，`PERSONAS` 欄是空的，標題照畫。

## Decision

### Ask 變成一個 dock

`ShareChatWidget` 從捲動流拿出來，改成右下角固定的啟動鈕 + 面板：關著是一顆 38px 的 `ASK`，開著是一個 360px 寬、最高 70vh 的面板。Esc 關閉，開啟時自動聚焦。`open` 提到 `ShareView` 上，因為——

**從版面裡拿掉，不可以從目錄裡拿掉。** 導覽列的 `ASK` 留著，但它變成一個 `action` 條目：不捲動到某一段，而是把 dock 叫起來。這是這一頁上唯一一個訪客會知道「可以問問題」的地方，砍掉它等於把功能藏起來。`ShareScrollNav` 因此分成兩種條目，`active` 的判準也跟著分成 `activeSection` / `activeAction` 兩個 prop。

dock 是 `.kt-share-page` 的直接子節點、在 `.kt-share-shell` 外面。這是 ADR-0129 的帳：**有 transform 的祖先會自己變成 `position: fixed` 的 containing block**，而 shell 上跑的正是這一頁的入場過渡。

### 結構圖：同一台機器，換一份切片

新增 `utils/shareGraph.js`：`buildShareSlice(payload)` 把公開 payload 投影成 `GET /api/graph/map` 那個 `{nodes, edges}` 形狀，外加兩份寫死的註冊表（訪客碰不到 `/graph-types`，而 payload 裡永遠只有這四種型別）。於是：

```
share payload → buildShareSlice → deriveGraphStructure → buildMindMapLayout → MapCanvas
                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                             一字未改，就是 /structure 用的那些
```

**不做第二份實作**是這裡最重要的一條。ADR-0070→0073 那條線的教訓是「還能動的重複沒有故障徵狀」；一張公開的圖如果自己算一次 rollup、自己排一次版，它跟 owner 看到的那張圖之間就只剩「目前碰巧一致」。分享頁不從 `/structure` 那一頁拿走的，是它的**編排**：沒有搜尋、沒有篩選、沒有 focus、沒有跳轉——訪客無處可跳，所以這裡的節點只會被選取。

三個決定：

**預設是 `sankey`（欄狀）而不是 owner 那一頁的 `territory`。** 這是量出來的，不是挑的：一個 12 個任務的專案，`lines`（樹）把任務排成一列，畫布寬 2352px，塞進 916px 的框裡 fit 成 **0.377**，字全糊掉；`sankey` 往下長（874×936），同一個框 fit 成 **0.63**，讀得到。內嵌在一份要捲的文件裡，長度可以借、寬度不行。三種版面都留著（名稱沿用 owner 的字，ADR-0058）。

**永遠是 dependencies 模式。** 「什麼在等什麼」是陌生人打開這個連結最主要的問題，也正是先前被埋在展開第三層的那一條。

**決策的關係補畫在版面之後。** `governs` / `supersedes` 兩端分屬版面的不同帶，沒有任何一趟版面計算擁有它們；network 版面自己會放 custom 關係，另外兩種不會，所以在算完的 layout 上補上 `type: 'decision'` 的連線——`MapCanvas` 因此把它們畫成虛線、而且**選取之前不畫**。一百條決策弧線同時亮著就是 ADR-0128 用暗化在躲的那張圖。

選取一個節點會把它沒碰到的東西暗下來，這是 ADR-0128 的暗化規則套到整張圖上。選 ADR-002 之後，同一個畫面上一次說完：它治理哪兩個任務、它取代了哪一筆、它屬於哪個專案——這四件事在此之前分散在三張卡片的 chip 上，而且每一條只有一端說得出口。

`MapCanvas` 為此多了兩件事，兩件都讓 owner 那一頁一起變好：`onOpen` 變成選配（沒有跳轉目標時，aria-label 就不要承諾「雙擊開啟」），空欄位不畫欄位標題。多一個 `taskColumnLabel` prop，因為分享頁畫的是**全部**任務而不是 owner 那一頁的 signal 切片，沿用 `SIGNAL TASKS` 會是一句謊。

任務上限 30，超過的部分**數出來寫在圖下面**，不靜默截斷（ADR-0128 的同一條規矩）。

### 一併修掉量到的三個缺陷

`graphStructure.js` 改讀 `n.status`；fixture 改成伺服器真正送的形狀，並加一筆已定案的決策——把反向控制跑過一次確認會紅。`.kt-map-node em` 釘在第二欄。空欄位不畫標題。

## Consequences

**好的：**

- 分享頁上每一條 payload 帶著的關係都畫得出來，而且兩端都說得出口。之前只有決策那一端知道自己治理什麼。
- owner 和訪客看到的是同一張圖、同一套 rollup、同一套版面演算法。分享頁不可能自己漂移。
- 助理隨時可及，而且不再假裝自己是頁面中間的留言欄。
- 三個既有缺陷順手清掉，其中「結構圖上每一筆決策都是 proposed」自 ADR-0130 起就活著。

**代價與已知邊界：**

- **`MapCanvas` 會翻譯，`components/share/` 的其他東西不會。** 用同一個元件畫圖的代價就是它帶著自己的 i18n。這是刻意選的：與其為公開頁寫第二個 canvas，不如讓幾個欄位標題跟著瀏覽器語言走。
- **payload 是平的，所以巢狀容器畫不出來。** 伺服器把分享出去的子樹壓成 `projects` 一層，圖只能畫到「擁有者 → 專案 → 任務」。要畫巢狀層級得先改 payload，那是另一件事。
- **節點很多的時候第一眼會縮得很小。** 一個 21 個專案的身分分享，畫布高 1730px，塞進 620px 的框是 0.34。有縮放與 fit 控制，行為跟 owner 的地圖遇到大圖時一樣——但「第一眼」確實需要動手。真要處理得讓框跟著內容長，那會讓這一段吃掉整個捲動視野。
- **`ShareScrollNav` 現在有兩種條目。** 一個沒有 `onAction` 的 `action` 條目會是一顆按了沒事的按鈕；`ShareView` 是唯一的呼叫端，這條線很短，但它是一條線。
- **`.kt-map-node em { grid-column: 2 }` 動到 owner 的地圖。** 那裡的版面因此也改變了——往正確的方向，但它是一個共用樣式的改動，不是分享頁自己的。
