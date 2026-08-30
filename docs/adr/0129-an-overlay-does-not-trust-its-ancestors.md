# ADR-0129: 覆蓋層不信任自己的祖先

## Status
Accepted

## Date
2026-08-29

## Context

決策頁的關係選擇器（ADR-0127 的 `DecisionLinkPicker`）打開後跑到「整個頁面」的正中央
而不是視窗中央：在一個捲了幾屏的頁面上，它出現在畫面下方、底部被活動 ticker 蓋掉，
連 CLOSE 按鈕都在畫面外。同時，左側的功能列與上下兩條 ticker 明明 `z-index` 比彈窗低，
卻畫在彈窗之上。

兩個症狀看起來無關，根因只有一個，而且離現象有兩層遠。

`.kt-route-shell`（`App.jsx` 每條路由的外框）帶著 `animation: routeReveal … both`。
`routeReveal` 的最後一格是 `transform: translateX(0)` 與 `clip-path: inset(0 0 0 0)`，
而 `both` 這個 fill mode 會把最後一格**永久保留**下來。單位矩陣仍然是一個 transform，
所以那個外框從此成為底下所有 `position: fixed` 子元素的 containing block，同時也開了一個
新的 stacking context。於是：

- `.kt-modal-backdrop` 的 `inset: 0` 不再是視窗，而是**整個路由的捲動內容**（實測
  1456×3519），`align-items: center` 就把面板放在那 3519px 的中點；
- backdrop 的 `z-index: 300` 只在那個新的 stacking context 內部有意義，對外框以外的
  側欄（90）和 ticker（57/80）完全不作數；
- 保留下來的 `clip-path` 還會把子元素裁到外框的框內。

動畫本身看起來完全正常，保留與否肉眼沒有差別 —— 這是為什麼它可以在那裡放很久。
ADR-0122 已經為了同一個機制把 `OverflowMenu` portal 到 body（那裡是卡片的入場動畫留下
transform），當時只修了那一個元件，沒有回頭看誰還在同一條路上。

## Decision

兩件事，各自獨立成立：

1. **`FormModal` portal 到 `document.body`**，和 `OverflowMenu` 同樣的理由。一個對話框
   不該因為「是從哪一棵子樹打開的」而位置不同；這條規則讓它對任何祖先樣式免疫，包含未來
   才長出來的。`components/shared/__tests__/FormModal.test.jsx` 從一個子容器 render，
   斷言 dialog 落在 body 上。

2. **入場動畫的 fill mode 從 `both` 改成 `backwards`**（`.kt-route-shell` 與 `.kt-modal`）。
   `backwards` 只在動畫開始前套用第一格；結束後元素回到自己原本的計算值，而那正是最後一格
   在畫的東西，所以視覺完全相同、transform 與 clip-path 不再殘留。這一步修的是 portal
   之外的部分 —— `ApiKeys.jsx` 兩個直接寫 `kt-modal-backdrop` 的彈窗、以及任何未來放進路由
   裡的 fixed 元素。`src/__tests__/overlayContainingBlock.test.js` 靜態掃這兩條規則，
   出現 `both`/`forwards` 就失敗。

範圍限定在「可能包住覆蓋層的外框」。卡片、磚塊層級的入場動畫維持 `both`：它們不裝覆蓋層，
而 `OverflowMenu` / `FormModal` 之所以 portal，正是因為那件事不能靠約定保證。

## Consequences

- 彈窗回到視窗正中央，並且真的蓋住側欄與 ticker；`z-index: 300` 恢復意義。
- 所有 `FormModal` 使用者（決策關係選擇器、`GovernPicker`、各頁表單）一次修好，不必逐頁改。
- 多一條靜態守門測試。它擋的是一個看不見的東西：把 `backwards` 改回 `both`，畫面不會有任何
  變化，壞掉的是別的元件的定位 —— 所以這件事必須是測試，不能是註解。
- 沒有處理：其他數十處 `animation: … both` 的入場效果。它們同樣會建立 containing block，
  但只影響自己的子樹，而覆蓋層現在都不住在那裡了。
