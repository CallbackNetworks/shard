# ADR-0133: 滑過是狀態改變，不是特技

## Status
Accepted

## Date
2026-08-31

## Context

五個一起回報的視覺缺陷，其中四個共用同一個機制。

**卡片會憑空消失。** 滑鼠移到 Integrations 頁的第一張卡片上，整張卡片不見。原因在
`global.css`：`.kt-card` 依照 `:nth-child(6n + N)` 挑自己的 hover 反應 —— 同一個元件
在清單裡的第 1、2、3、4、5、6 個位置有六種不同的行為。其中兩種寫的是 `animation:`。

`animation` 是簡寫屬性，會**整個換掉**元素原本正在跑的動畫。而
`Integrations.module.css` 的 `.card` 是這樣進場的：

```css
.card { opacity: 0; animation: fadeUpIn 0.35s ease forwards; }
```

它的「看得見」完全寄生在那個 `forwards` fill 上。hover 規則把動畫換成
`kineticRotateTap`（keyframes 裡沒有 `opacity`），fill 一起被換掉，`opacity` 就掉回
基礎宣告的 `0`。這和 ADR-0129 是同一個機制的另一面：**入場動畫的 fill 不是放狀態的
地方**，因為任何一條無關的規則都能把它換掉。

同一個寫法還有第二個受害者，而且不必有人 hover 就會發生：**載入文字疊在一起**。
`.kt-loading` 把三個字絕對定位疊在同一點，靠 `loadingWord` 一次只顯示一個。三個
`<span>` 的 `opacity` 基礎值是繼承來的 `1`，所以只要動畫沒在跑 —— 作業系統開了
reduced motion、使用者自己開了 `data-motion="reduced"`、或是 `applyUiPrefs` 還沒執行
的第一次繪製 —— 三個字就同時畫出來。而 `.kt-loading` 出現的時機**正好就是**
`applyUiPrefs` 還沒跑完的那一刻。

**第三個：決策頁的卡片被裁掉。** `DecisionGroup` 是遞迴元件（ADR-0126），但它的縮排
同時用了兩套：`.head` 的 `padding-left` 是 `10px + depth * 14px`，`.body` 的
`margin-left` 是 `15px + depth * 14px`。遞迴本身就會累加，再乘一次 depth 就是複利 ——
第四層的卡片在一個 320px 的欄位裡已經失去約 145px，而那個欄位是 `overflow: hidden`，
於是內容不是換行而是被切掉。

**第四個不是缺陷而是取捨：** 底部活動列的 watch 設定列常駐在每一頁最下方，`grid-column:
1 / -1` 橫跨整條，`.kt-route-shell` 為它保留了 88px 的 gutter。它是設定，不是內容。

## Decision

**一、入場動畫一律 `backwards`，不再搭配 `opacity: 0`。** `backwards` 只在動畫**開始
之前**填值；動畫結束後元素回到自己的計算樣式，而那正是最後一格本來要畫的東西。這樣
「安定狀態」永遠是元素自己的宣告，沒有任何別的規則能把它奪走。全域掃過一次：
`.kt-card`、`.projectCard`、`StatCard`、`.kt-share-stat`、`.kt-share-activity-entry`
共六處。

同一條規則反過來用在 `.kt-loading span`：基礎值改成 `opacity: 0`，並讓
`:first-child` 宣告 `opacity: 1`。動畫在跑的時候會蓋過這兩個宣告（CSS 動畫的優先序
高於一般宣告），一次顯示一個字；動畫被停掉的時候，只有第一個字站著。

**二、卡片用顏色回應滑鼠，不用位移。** `.kt-card` 的 hover 只剩 `border-color` 與
`background`，六條 `:nth-child(6n + N)` 變體全部刪除。同一條規則套用到
`.card-hover`、`.projectCard`、`.kt-map-node`、`.kt-assistant-conversation`、
`.kt-assistant-bubble`，以及卡片內會跟著抖動的 `.kt-chip` / badge / 卡片標題。

界線畫在**「被瞄準」和「被掃視」之間**：按鈕、側欄列、頁面標題保留原本的動態 ——
它們是被瞄一次點下去的。卡片是在一欄四十個裡面被掃視的，會動的卡片是把使用者正在
瞄的東西從游標底下移開。

**三、遞迴元件的縮排是每層一步，不是 `depth × 一步`。** `DecisionGroup` 的
`.head`/`.body` 改成固定值，`--depth` 這個變數整個拿掉（元件裡那行 inline style 也一起
刪）；各層再補上 `min-width: 0`，因為 grid item 的 `min-width: auto` 本來就不肯縮到
內容以下 —— 那才是「被裁掉」而不是「被換行」的直接原因。

**四、watch 設定列預設收起，而且保留給它的 gutter 讀同一個偏好。** 新增
`watchPanelOpen`（預設 `false`），`applyUiPrefs` 把它發佈成根節點的 `data-watch`，
`.kt-route-shell` 的 `padding-bottom` 依它在 56px / 88px 之間切換 —— 和 `--rail-w`
（ADR-0088）完全同一個作法，理由也一樣：**收起來如果不把版面還給頁面，就等於沒收**。
開關本身放在強度標尺那一格而不是它所開闔的那一列裡，因為收起來的面板裡的按鈕打不開
自己。

順帶修掉一個既有缺陷：助理的浮動按鈕（`fixed`，`bottom/right: 20`，`z-index: 290`）
本來就壓在底部列右端的 HIGH 標籤上。`.kt-heatscale` 現在自己留 66px 的右內距 ——
不然新開關會畫得出來卻點不到。

## Consequences

- 這個 app 的視覺個性刻意留著（skew、kinetic 標題、掃光），只是不再放在「一欄幾十張
  卡片、滑鼠會經過」的地方。整體觀感比較安靜。
- `kineticRotateTap` / `kineticExpandPulse` / `kineticSlidePunch` 還留著，按鈕與空狀態
  標題仍在用。
- 決策頁深層群組的縮排比以前淺（每層 11px 而非最多 57px），階層感靠左側細線而不是
  距離；換來的是第四層的卡片完整可見。
- `.kt-route-shell` 的預設 gutter 少了 32px，等於每一頁多出一行的可視高度。使用者展開
  watch 列之後偏好會留著，下次進來仍是展開的。
- `src/__tests__/hoverIsNotMotion.test.js` 靜態掃描全部 CSS：任何一條同時有
  `opacity: 0` 與 `animation: … forwards|both` 的規則會讓測試失敗，卡片類選擇器的
  `:hover` 出現 `transform` 或 `nth-child` 也會。這個缺陷從來不是「有人寫錯一條規則」，
  而是「沒有規則說這件事不能做」。
- 沒有任何東西擋得住直接在元件裡寫 inline `style={{ transform }}`；這條界線只到 CSS。
