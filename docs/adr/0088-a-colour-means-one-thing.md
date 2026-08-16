# ADR-0088: 一個顏色只能代表一件事

## Status

Accepted

## Date

2026-08-16

## Context

這次不是找功能缺口，是問一個更基本的問題：**這個介面好不好操作、好不好辨認**。在本機把 dev stack 跑起來，用真的瀏覽器看桌面、手機、淺色、繁中四種狀態，量到的問題可以歸成五類，而且每一類都不是「少做了什麼」，是「同一件事被表達了兩次、或被表達成別的意思」。

**一、黃色同時代表三件事。** `constants/theme.js` 裡 `STATUS_COLOR.in_progress`、`PRIORITY.high` 和品牌強調色 `BRAND` 全都是 `#facc15`。同一列任務裡的黃色，可能是「進行中」、可能是「高優先」、也可能只是一顆按鈕。更糟的是 `PRIORITY.medium = #f59e0b`，跟 high 是相鄰的琥珀色，兩個 chip 放在一起分不出來 — 而優先度是這份清單上最需要一眼掃到的欄位。

**二、狀態色沒有跟著主題走。** `DARK` 物件早就改成走 `--kt-*` CSS 變數，`STATUS_COLOR` 卻還是寫死的 hex，而且是照深色底調的。量在白底上的對比：`done` 1.92:1、`failed` 2.69:1、`in_progress` 1.53:1 — 連 3:1 這個非文字元件的底線都過不了，AA 文字要求是 4.5。淺色模式下首頁那個「今天完成 2」實際上是看不見的。同一類問題還有幾個寫死深色的介面元件（`.kt-alert-strip` 的 `#e0a13a`、`.kt-signal-timeline-head strong` 的 `#ffffff`），以及 done 狀態圖示裡那個 `stroke="#000"` 的勾 — 在淺色模式下綠色圓形本身變深，黑勾就消失了。

**三、側欄展開時蓋住內容。** rail 收合是 72px、hover 展開成 224px，但它是 `position: fixed`，而版面只保留 72px 的溝槽。滑鼠只要靠近左邊緣就會蓋掉頁面最左邊 150px：專案標題、第一個分頁、每一列任務標題的開頭。而且平常 18 個入口全是無字圖示，**你必須 hover 才讀得到名字，而 hover 就會遮住你要看的東西** — 這兩件事互相抵銷。

**四、手機上讀不到任務標題。** 議題列是一條不換行的 flex，它的外層包裝是 `flex: 1` 而沒有 `minWidth: 0`；flex item 的 `min-width` 預設是 `auto`，所以它拒絕縮到內容的 min-content 以下。在 390px 的視窗裡每一列都以 **862px** 排版，再被上層 `overflow` 裁掉，而且沒有捲軸 —— 標題的後半段是**看不到也捲不到**的。同一列還有一塊 130px 的固定佔位，留給只有 hover 才會出現的 13 顆按鈕：觸控裝置沒有 hover，所以那些按鈕永遠不會出現，佔位卻永遠佔著三分之一的列寬。

**五、翻譯只做了一半。** 側欄、設定頁和大部分頁面都接了 i18n，但 `ProjectDetail.jsx`（722 行，最常用的那一頁）、它底下的 `BulkToolbar` / `TaskFiltersPanel` / `LabelManager`、首頁主體 `OverviewViews.jsx` 全都沒有 `useTranslation`。切到 zh-TW 之後外框是中文、工作區是英文。而 `zh-TW.json` 裡 `project.issues`、`project.newIssue`、`project.searchIssues` 這些 key **早就翻好了，只是沒有人接上去**。側欄的分組標題（Operate / Think / Build / Graph / System）則是硬編字串，從來沒有進過 i18n。附帶一提，`OverviewViews` 的日期用 `toLocaleDateString('en')` 寫死。

還有兩個和「表達兩次」同類的：首頁同一個畫面上完成率出現兩次、專案數三次、「新增專案」按鈕兩次；而最上面那條警示跑馬燈把三個計數器**複製三份**只為了填滿 200% 寬的軌道 — 它還掛著 `aria-live`，所以螢幕閱讀器會把同一句話唸三遍。

## Decision

**顏色分成三個互不共用色相的家族。** `--kt-status-*`（狀態機：灰／藍／綠／紅）、`--kt-prio-*`（急迫度）、`--accent`（品牌），兩個主題各宣告一次，`constants/theme.js` 透過 `var()` 取用 — 和 `DARK` 早就在用的作法一樣。淺色值全部達到 AA。順帶確認了一件會影響作法的事：**`var()` 在 SVG presentation attribute 裡是會解析的**（Chrome 124 實測），所有圖表都是 SVG，所以不需要為它們另開一條路。代價是 `color + '33'` 這種補 hex alpha 的寫法會壞掉（附加在 `var(...)` 後面會被瀏覽器整條丟掉），改用 `utils/color.js` 的 `alpha()`／`color-mix()`。

**優先度是序數，所以畫成階梯而不是三個平等的色塊。** 只有最高那一階給顏色；medium／low 靠 `weight`（solid／outline／ghost）和 ▲■▼ 字形表達順序。這樣就算列印、調暗或色盲，順序依然讀得出來。三處手刻的 chip 收斂成一個 `PriorityChip`。

**側欄的展開是一個明確且會被記住的選擇，不是 hover。** `railExpanded` 存在 uiPrefs，`applyUiPrefs` 把它寫成 `data-rail`，CSS 用 `--rail-w` **同時**決定 rail 的寬度和版面保留的溝槽寬度 — 兩個數字現在是同一個變數，所以「展開的 rail 蓋在頁面上」在結構上不可能發生。預設展開：辨認優先。

**手機上，重複的欄位讓位給標題。** 包裝加 `minWidth: 0`；≤640px 隱藏 id、優先度 chip（▲ 圖示仍在列首）、計時器，以及那塊 hover 佔位 —— 並在原位放一顆一直可見的編輯鈕，因為觸控裝置本來就摸不到那排 hover 工具列。

**沒有第二次說同一個數字。** 首頁 hero 只留下它獨有的東西（active 數、它的拆解、最新訊號）；「Queue Pressure」面板整個拿掉，它的三個數字在同一畫面上都已經有了。警示列改成靜態，三個計數器只算一次。

**翻譯的缺口用兩個守門測試釘住**（`src/__tests__/i18nCoverage.test.js`）：每一個會顯示文字的 page/component 都必須呼叫 translator；兩份語系檔必須描述同一個 app（沒有單邊 key、沒有把英文照抄當中文）。同時 `test/setup.js` 改成初始化真正的 i18n singleton —— 在那之前 `useTranslation()` 落到未初始化的實例、`t` 直接回傳 key，所以「斷言使用者看到的文字」這種測試**只有在元件還沒被翻譯時才會通過**，這正是 ProjectDetail 能一直維持硬編英文的原因。

側欄的「Graph」分組改名為「資料」，`Types` / `Explorer` 換成「項目類型」/「資料瀏覽器」。**`Container` 這個詞保留** — 它是 API 裡 `node_types.roles` 的角色名，只改 UI 標籤會讓介面和文件、API 對不起來，那是 ADR-0058 已經處理過的錯誤。

## Consequences

正面：一列任務裡的顏色現在只有一個意思，High 和 Medium 一眼可分；淺色模式全站可讀，而且新增狀態色時兩個主題會被一起要求；rail 永遠有字、永遠不擋內容；手機上讀得到標題也編輯得了；首頁少了一個面板和四個重複讀數；`ProjectDetail` 整頁跟著語言走。

負面與代價：`color-mix()` 需要 Chrome 111+／Firefox 113+／Safari 16.2+ — 這個 app 已經在用 CSS 巢狀與 `:has()`，所以不是新的底線，但它是一條底線。`--rail-w` 現在同時被 rail、`.layout-sidebar`、`.kt-mini-drawer` 和 `.kt-signal-timeline` 讀，新增任何貼著左邊緣的固定元素都必須讀它而不是寫死 72px。`i18nCoverage` 的 `NO_PROSE` 是一份人工清單：新增一個真的沒有文字的元件時要記得加進去，否則測試會擋下來 — 這是刻意的，寧可多一次確認。優先度只有 high 有顏色，是刻意把 medium／low 壓低；如果之後有人希望三階都醒目，那要先回答「那 medium 和 status 的顏色怎麼分」。

至於首頁上方那條**活動**跑馬燈仍然在動：它的內容確實比一行寬，動是有理由的，而且 `reduceMotion` 偏好已經可以關掉它。這是這次唯一沒有動的那類「動態文字」。
