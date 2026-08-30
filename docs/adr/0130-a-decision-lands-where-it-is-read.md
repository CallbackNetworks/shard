# ADR-0130: 一筆決策要落在會被讀到的地方

## Status
Accepted

## Date
2026-08-30

## Context

[ADR-0118](0118-a-decision-is-its-own-node-type.md) 把決策從「`label` 節點 + `data.type="decision"`」
搬成自己的節點型別，並在那份 ADR 裡寫下：舊寫法**不再靜默地繼續 work**，因為它造出來的
是一個標籤，而那就是它。這句話只對了一半 —— 它造出來的是一個標籤，**以及一個 201**。

正式站因此在兩天內收了 17 筆。截至 2026-08-30，資料庫裡是這個樣子：

| 形狀 | 筆數 | 建立時間 |
|------|------|----------|
| `type="decision"` | 103 | 2026-08-19 ～ 08-27 |
| `type="label"` + `data.type="decision"` | 17 | 2026-08-29 ～ 08-30 |

也就是說，**資料庫裡最新的 17 筆決策，一筆都不在決策頁上**。`decisions()` 用
`Node.type` 過濾，看不到它們；而 ADR-0118 同時拿掉了 `label_names()` 原本的扣除，
所以它們反過來成了標籤詞彙表裡貨真價實的條目 —— 正式站 22 個標籤有 17 個是誤存的決策，
工作流規則的標籤選單也一併吃到。本機重現，三個後果一次到齊：

```
POST /nodes {type:"label", data:{type:"decision", decision_status:"accepted"}}
  write status: 201
  decisions() sees: []
  label vocabulary sees: ['Old-shape decision']
```

同一次盤點還翻出兩件同一形狀的事：

- **狀態不在它該在的地方。** 決策的狀態一直放在 `data["decision_status"]`，那是標籤時代
  的產物 —— 一個標籤沒有別的地方可以放。結果 `nodes.status` 欄在正式站 103 筆決策上
  **全部是 NULL**，決策是唯一一個「通用節點查詢無法依狀態篩選」的型別。這與
  [ADR-0075](0075-a-container-status-has-one-rule.md) 抓到的是同一類：讀取時給預設值、
  欄位查詢看真值，兩邊會對不上。
- **一份沒有人讀的第二真相。** 兩筆決策的 `data` 裡還留著 `superseded_by`，指名自己的
  後繼者。那是 ADR-0118 把「取代」變成邊之前寫的；沒有任何程式碼讀它，所以它唯一能做的事
  就是在某天跟邊講出不同的話。

## Decision

**一、舊形狀在門口被擋下，而且擋下的訊息會說出對的形狀。**
`decision_records.assert_decision_write_shape` 在 `node_admin.create`（兩道門的建立）
與 `graph_dispatch.dispatch_node_updated`（兩道門的更新）各叫一次，回 422。訊息直接點名
`type='decision'`，並說出寫成標籤會發生什麼事。這是 [ADR-0078](0078-a-relation-declares-what-may-sit-at-each-end.md)
的規矩：**agent 一定會讀錯誤訊息，不一定會讀文件**；那 17 筆就是照著某份舊說明寫的，而
201 沒有給它任何可以察覺的東西。

**二、決策的狀態就是 `nodes.status` 欄**，和其他每一個型別一樣。回應合約不動 ——
讀出來仍然叫 `decision_status`，那是分享頁、助理與整個前端寫成的名字，儲存位置換了不構成
破壞它們的理由。型別宣告因此改成 `{"key": "status", "store": "column"}`，前端的
`decisionBody()` 在 `api/client.js` 裡做這一層翻譯，只做一次。

順帶把同一個陷阱往下一格也堵上：`type="decision"` 卻把狀態塞在 `data.decision_status`
的寫入同樣 422。不擋的話，它會被當成一個惰性的 `data` 鍵收下，而所有決策介面讀的那個欄位
留在空的 —— 和這份 ADR 在修的事一模一樣。

**三、遷移 `d8f0a2c4e6b1` 把資料搬到位。** 17 筆轉成 `decision` 型別、拔掉標記鍵；
每一筆的 `decision_status` 進 `status` 欄。`data["superseded_by"]` 不是直接刪掉：
先用它建出真正的 `supersedes` 邊（後繼者在來源端），**然後**才刪鍵 —— 直接刪會把它唯一
知道的那件事一起丟掉。

`tests/test_agent_surface_parity.py::TestADecisionLandsWhereItIsRead` 對兩道門送同一個
請求，比對 status **與** detail 文字（ADR-0085 的規矩），並斷言「寫進去的狀態就是讀出來
的狀態」，含通用節點讀取那一面。

## Consequences

- 那 17 筆決策回到決策頁上，也從標籤詞彙表消失。標籤選單與工作流規則的值選單跟著乾淨。
- **任何還在用舊形狀的呼叫端會開始拿到 422。** 這是刻意的，也是這份 ADR 的重點：它們
  現在寫進去的東西沒有人看得到，早一點壞比晚一點壞好。MCP 工具描述、`docs/api.md` 與
  本 repo 的 `CLAUDE.md` 都改了 —— 最後這個原本還寫著 ADR-0092 時代的舊句子。
- 決策的狀態現在能被通用的節點查詢篩到，`/n/{id}` 的欄位面板也畫得出那個下拉。
- 遷移是單向的。往回走必須猜哪些決策原本是標籤，而把它們重新錯置不是一個值得回復的狀態。
- 沒有動 `data["source"]`（15 筆）。它記的是「哪個介面寫了這一列」，是系統給自己的註記，
  不是要交給使用者的欄位，所以它維持未宣告、在節點頁上唯讀 —— 那正是未宣告鍵該有的樣子。
