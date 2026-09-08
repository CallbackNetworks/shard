# ADR-0155: 關係要在「讀得到這個節點的地方」就編得動

## Status
Accepted

## Date
2026-09-08

## Context

ADR-0150 把三份各自為政的「建立關係」控制項收成一個 `RelationPicker`：它去問伺服器
`GET /graph-types/edges/options/{type}`，用 `add_edge` 自己執行的那條述詞決定要提供哪些關係、
哪個方向、以及哪些節點可以當另一端。那次修好的是**這個控制項提供什麼**。

沒有修的是**它被掛在哪裡**。三份清單（`NodePage`、`NodeExplorer` 的右欄、`MembershipPanel`
的 other relations）仍然各寫各的 render，而且——這才是沒有失敗徵狀的那一半——這個面板總共只
出現在三個地方：`/n/{id}`、`/explorer`、以及專案頁上任務列展開後的歸屬面板。

而 `utils/nodeHref.js` 的規則是：

```js
if (ref.type === 'project') return `/projects/${ref.id}`
if (hasNodeRole(typeByKey?.get(ref.type), 'container')) return `/c/${ref.id}`
return `/n/${ref.id}`
```

也就是說，**專案永遠不會被送到 `/n/{id}`，任何容器（含 identity）也不會**。全 app 掃一遍
`to={\`/n/${...}\`}`，指向「自己這個節點」的連結只有一個：`ContainerView` 副標題那行
「關聯與結構」。專案頁沒有、身分卡沒有（身分卡根本沒有任何連結）、目標頁沒有。

結果就是使用者回報的那句話：**「不然全部都要到 Node data 頁面才能設定有點麻煩。」** 這是準確的。
要說「這個專案歸在那個身分底下」，唯一的路是離開專案頁、走到 `/explorer`、在一份跨型別清單裡把
它找出來、選起來，再從右欄掛邊——而專案正是這個產品裡幾乎所有工作所在的型別。

這跟 ADR-0122（`governs` 有寫入 helper、有反向讀取端點、零個呼叫端）和 ADR-0132（`fields` 兩個
API 門都寫得動，唯一談註冊表的那頁不能改）是同一類：能力做好了，站的地方沒有門。

## Decision

一個元件 `components/NodeRelationsPanel.jsx`，掛在每一個「顯示單一節點」的頁面上：專案頁、
容器頁、身分卡、`/n/{id}`、以及 explorer 的右欄。它含清單（依關係分組、容器類關係排前面、
兩個方向都畫、任一端都能解除）、`RelationPicker`、以及 explorer 原本獨有的 `EgoNetwork`
鄰域圖切換——後者現在每一頁都有，因為兩跳之外才看得出形狀。

四個決定：

**清單和選擇器在同一個元件裡。** ADR-0150 只收了選擇器，於是「有哪些關係」是共用的、
「在哪裡看得到並動得了」不是。這次連清單一起收，`RelationPicker` 現在只有一個 import 端，
守門測試釘住這一點——第四份手寫清單無法悄悄長回來。

**在工作頁上預設收合。** 專案頁與容器頁的主體是工作，關係是「要用的時候去找」的東西，不是
開頁面第一眼該看到的。`/n/{id}` 與 explorer 的主體本來就是圖，維持展開。

**MembershipPanel 繼續隱藏 core 關係。** `contains` / `depends_on` / `labeled` / `in_cycle` /
`owns` / `governs` 在那一列各有自己的專屬控制項，重複畫一次會讓同一條邊出現兩次（ADR-0122 的理由）。
以 `hideRels` 表達，不是再開一份 render。同一手也補掉一個既有缺口：那裡的選擇器原本
`onLinked` 只 invalidate 邊，所以從它掛上一個容器之後，上方的容器 chip 不會更新。

**已連上的節點是「照關係」排除，不是照節點排除。** `NodePage` 原本把「跟我有任何一條邊」的節點
全部從候選裡拿掉，於是一對節點之間的第二條關係永遠說不出口——而 ADR-0095 存在的理由，正是
`identity contains project` 和 `identity owns project` 兩條都合法、而且不是同一件事。

**卡片要 `overflow: visible`。** `.kt-card` 是 `overflow: hidden`，而選擇器的節點搜尋會從卡片
最後一個元素往下掉一個 240px 的絕對定位清單——所以在每一個卡片形狀的掛載點，那份清單都被卡片
邊緣切掉。跟 ADR-0122／ADR-0129 是同一個機制的第三次現身。

順帶兩件：`TypeChip` 原本在 `NodePage` 和 `NodeExplorer` 各寫一份（一份 inline style、一份
module class），收成 `components/shared/TypeChip.jsx`；而目標頁的卡片標題本來不連到任何地方——
goal 帶 `container` 角色、`/c/{id}` 一直都在，只是沒有任何一條路徑指過去（ADR-0147 的規則），
現在標題就是那條連結，那一頁上也有這個面板。

## Consequences

- 專案、容器、身分現在都能在自己的頁面上說出自己掛在誰底下，並且改得動。`/explorer` 從
  「唯一的門」退回「一個資料視角」，這本來就是 ADR-0150 給它的定位。
- 每一頁多一個 `GET /nodes/{id}/edges`——**收合時也發**：標題上那個數字就是「要不要打開」的
  唯一線索，收著寫 0 而底下有五條，比不寫數字更糟（ADR-0154 的規則，往前一格）。真正省下來的是
  鄰域圖：`getGraphMap()` 只有按下「關係圖」才發。同理，「還沒有任何關聯」是一句斷言，所以它等
  請求回來才說——原本在飛行中就先講了。
- `frontend/src/__tests__/nodeRelationsReach.test.js` 兩個方向都測：每一個節點詳細頁都要掛這個面板，而
  `RelationPicker` 只能有一個消費端。單測任一方向，在缺陷存在時都會通過。
- 沒有新的後端程式碼、沒有新的端點、沒有新的 i18n key——這一整條都是把既有能力接到既有畫面上；
  反倒是清掉四個沒人用的 key（三份清單收成一份之後留下的）。
- 解除按鈕的 aria-label 帶上另一端的名字。六條關係六顆一模一樣的「解除」，是螢幕閱讀器分不出來的
  六顆按鈕——`MembershipPanel` 本來就已經避開了，收成一份時把它帶過去。
