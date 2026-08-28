# ADR-0120: 公開分享頁要說得出這些工作是依什麼決定的

## Status
Accepted

## Date
2026-08-28

## Context

ADR-0118 把決策變成一等公民之後，回頭看「決策要不要能被分享」。原本的提案是給 `decision` 型別 `shareable` 角色，讓每一筆決策有自己的公開連結。查了實際資料之後，這個提案是錯的：

- 正式站有 38 個節點帶著 share token，但這是假訊號 —— 任何 shareable 型別**一建立就自動配一個** token（ADR-0041）。
- 真正代表「刻意設定過分享」的訊號很少：1 個節點設了 PIN、4 個開了訪客留言。
- 而且「把一份決策給人看」這件事，**匯出成 Markdown 已經蓋掉了**，而且對 ADR 來說更好：目的地是 repo 的 `docs/adr/`，不是一條連結。

真正的缺口在別的地方。`share.py` 的 `_serialize_project` 給公開頁面的是 tasks、labels、cycles、comments、dependencies、activity —— **沒有 decisions**，前端 `ShareView.jsx` 裡 `decision` 出現 0 次。

分享連結是**唯一一個給「當初不在場的人」讀的畫面**，而對那個讀者來說，「為什麼」正是價值最高的部分。頁面把做了什麼列得很清楚，一句都沒說為什麼。

同一次檢查還發現兩個既有缺陷：

1. `share.py` 算 overdue 用的是 `t["status"] != "done"` —— **ADR-0089 之前的定義**。`tests/test_overdue_agreement.py` 問過 analytics、identity hub、project stats、summary，唯獨沒問公開分享頁，所以它保留了舊答案。一個 failed 且過期的任務，在分享頁算逾期、在其他每個地方都不算。漏掉的偏偏是唯一給外人看的那面。
2. 分享頁的 section 追蹤 `useEffect` 相依陣列是 `[]`。第一次 render 是 loading 狀態，那時候 `share-section-*` 這些元素都還不存在，所以每個 `getElementById` 都落空 —— **沒有任何 section 被觀察過，導覽列的高亮永遠停在 OVERVIEW**。

## Decision

**分享頁多一個 Decisions 區塊。** payload 的每個 project 帶 `decisions`，內容是名稱、狀態、內文，以及取代鏈與所治理的工作（ADR-0118 的兩條關係）。summary 加 `total_decisions` / `accepted_decisions`，數字在伺服器端算，讓頁面和分享助理讀同一個來源。

**不新增分享的門。** 決策沒有拿到 `shareable` 角色 —— 它跟著所屬專案的分享連結走，因為那就是它的所在位置。沒有第二個公開端點、沒有第二個 token 要管。

**分享助理自動涵蓋。** ADR-0098 把 `get_share_node()` 的回傳值原封不動塞進 system prompt，所以決策一進 payload，訪客就能問「為什麼這樣做」而得到有根據的回答 —— 不需要另外決定一次「助理能知道什麼」，那個邊界仍然是「頁面顯示什麼」。

**鏈的畫法只有一份。** 公開頁重用 `utils/decisionRoom.js` 的 `buildDecisionLineages`，跟擁有者自己的決策頁同一個函式，所以同一條鏈在兩個畫面上不會長得不一樣。

內文以純文字呈現並可展開，跟這個頁面既有的做法一致（任務與專案的描述本來就是截斷的純文字，不是 markdown）。

順帶修掉上面那兩個缺陷：overdue 改讀 `graph.CLOSED_STATUSES`，而且**把分享頁加進 `test_overdue_agreement.py`** —— 它之所以會漏，唯一的原因就是沒人問過它；section 追蹤改成依賴 payload。

## Consequences

**得到的：** 公開頁面第一次說得出「為什麼」。ADR 敘事對外部讀者是這個產品最有說服力的東西，而它原本只存在於擁有者登入後才看得到的頁面。訪客的助理也一起變得能回答決策問題。

**付出的：** 分享的內容變多了。決策內文跟任務描述、專案描述在同一個曝光層級 —— 這不是新的邊界，但如果某筆決策記錄寫了不該外流的東西，它現在會出現在公開頁上。要細緻控制的話，得引入「某筆決策不公開」的概念，目前沒有做，因為那會是分享機制上的第二套規則。

**沒有做的：** 決策仍然不能單獨分享。如果之後真的需要「給某人看這一筆決策」，`shareable` 角色隨時可以加 —— ADR-0070→0073 已經讓分享對每個型別是同一份實作。現在不做，是因為匯出已經覆蓋了這個需求，而每多一個公開的門就多一份要顧的東西。
