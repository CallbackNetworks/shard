# ADR-0070: 分享面板只有一個實作

## Status
Accepted

## Date
2026-08-07

## Context

起點是一個看起來像減法的問題：身分頁面值得拿掉嗎？

盤點之後答案是不值得——`/identities` 是四件事在整個 app 裡唯一的入口：建立/刪除身分與它的 color/avatar/description（`NodeExplorer` 對 builtin type 直接 read-only，`NodePage` 只能改標題）、身分↔專案的 `member_of` 連結（`ProjectDetail` 只讀身分顏色，`FocusSwitcher` 只選不寫）、分享頁的 PIN／到期／訪客留言／瀏覽數，以及 iCal 訂閱網址。身分又不是裝飾，它是這個 app 的組織主軸，而且它跟專案是 `member_of` 而不是 `contains`，泛用的容器頁接不住它。

但盤點同時翻出頁面裡真正該消失的東西：**同一個分享面板被寫了兩份**。

- `Identities.jsx` 有一個私有的 `ShareSettings`（162 行），`components/NodeShareFacet.jsx` 是 ADR-0039 為任何 shareable 節點寫的泛用版。
- 兩份已經漂移出**不同的對外網址**：身分頁給 `/share/{token}` 和 `/ical/identity/{token}.ics`，facet 給 `/share/n/{token}` 和 `/ical/node/{token}.ics`。後端兩條都通（`get_share_node` 對 identity/project 做 delegation，`ical_feed_node` 認得 identity 的 `member_of` 聚合），所以沒有人會發現——同一個身分只是會複製出兩種長得不一樣的連結。
- 兩份的**功能集合也不同**：泛用 facet 沒有訪客留言開關、沒有瀏覽數；私有版兩者都有。
- `api/client.js` 裡連函式都是成對的：`rotateShareToken`/`setSharePin`/`clearSharePin`/`setShareExpiry` 早就指向 `/nodes/{id}/share/*`，和它們正下方的 `rotateNodeShareToken`/`setNodeSharePin`/… 是**逐字相同的呼叫**。

這是 ADR-0068 那個 bug class 換了個地方發作：同一個問題有 N 份實作，各自漂移。順著查下去還有兩處同源的分裂：`share.py` 有三個近乎逐字相同的瀏覽記錄函式（其中身分那份用一段繞路的寫法算出跟專案那份一樣的「整點」），而**泛用容器的分享頁根本沒有記錄瀏覽**——所以 `/nodes/{id}/share-views` 對使用者自訂的 shareable 型別會永遠回報 0，一個沒有人記錄的數字看起來就像一個事實。

## Decision

分享面板只留一個實作，就是泛用的 `NodeShareFacet`，身分頁改用它。

為此把 facet 補成完整的：加上訪客留言開關與瀏覽數，這樣它不再是私有版的子集，換過去不會掉功能。三個缺的後端能力補在 `/api/nodes` 這個 ADR-0040 就定好的單一寫入面上：

- `POST /api/nodes/{id}/share/set-guest-notes` — 和 set-pin/set-expiry 並排，走同一個 `_load_shareable_node` 守門。
- `GET /api/nodes/{id}/share-views` — 泛用的瀏覽數。
- `services/activity.py` 的 `share_view_count()` 是這個數字**唯一的實作**，`/identities/{id}/share-views` 和 `/projects/{id}/share-views` 都改成呼叫它。

計數接受三個 meta key（`identity_id`／`project_id`／`node_id`），因為一個節點在它的生命裡可能被不同的門服務過；`share.viewed` 的三個記錄函式收斂成一個 `_maybe_log_share_view`（三者的去重視窗本來就等價），泛用容器的分享頁也開始記錄自己的瀏覽。

前端 facet 讀取分享狀態時同時接受兩種形狀：raw `Node` 把它放在 `data` 底下，而 enriched 的 entity 讀取（`IdentityOut`／`ProjectOut`）把它攤平在頂層。**由讀的人吸收這個差異，而不是要每個呼叫端把物件塞成另一種形狀**——後者只會在別處長出第三份轉接程式碼。呼叫端另外可以指定 `invalidateKeys`，因為身分清單存在 `['identities']` 而不是 `['node', id]`。

身分列上因此可以刪掉四顆按鈕：分享連結複製、iCal 複製、rotate（全都在面板裡）、以及 `/?identity=` 那顆開新分頁看 Dashboard 的「overview」——ADR-0066 之後那是 `FocusSwitcher` 的工作。

**頁面本身留著。** 它獨有的那四件事還沒有第二個家。真正的合併目標不是刪除頁面，是把身分管理搬進泛用 node 頁（`/n/{id}` 加上 share facet、`data` 欄位編輯器、membership panel），讓 `/identities` 退化成 `TypeNodesPage` 那樣的薄清單——那是 ADR-0040→0043「單一寫入面」在前端的對應版本，本次不做。

## Consequences

- 分享面板從兩份變一份，少了約 200 行；`Identities.jsx` 從 483 行降到 264 行，`client.js` 少掉 5 個重複函式，15 個只有私有版在用的 i18n key 一併清掉。
- **身分的分享連結從 `/share/{token}` 改成 `/share/n/{token}`，iCal 從 `/ical/identity/` 改成 `/ical/node/`。** 兩條舊路徑都還在（`App.jsx` 有 `/share/:token` 路由，後端有 `ical_feed_identity`），既有連結不會斷；但 UI 從此只發新形式。舊路徑之後可以規劃退場，這次不動。
- 使用者自訂的 shareable 型別第一次能開訪客留言、也第一次有真實的瀏覽數。
- 瀏覽數的計數規則統一，代價是每次查詢要比對三個 JSON key 而不是一個。以 activity log 的量級與這個查詢的呼叫頻率（面板打開時一次）而言不需要處理。
- `tests/test_share.py::test_every_surface_reports_the_same_view_count` 對 identity 與 project 各問一次同樣的問題，任何一扇門答得不一樣就紅。`NodeShareFacet.test.jsx` 用 `it.each` 把兩種輸入形狀餵給同一個元件，確保**形狀不決定使用者能做什麼**。
- 專案頁的分享控制**還沒**換過來（`ProjectDetail` 仍有自己的 guest-notes 切換與 `getProjectShareViewCount`），這是同一條線上剩下的最後一份分歧，留待下次。
