# ADR-0115: 一個下載，檔名是人寫的字

## Status
Accepted

## Date
2026-08-27

## Context

把 repo 的 ADR-0094～0114 補進 Shard 的決策記錄之後，去驗證匯出，`GET /api/v1/decisions/{id}/export`
回 **500**。換一筆舊的決策，也是 500。換 ADR-0107 —— 唯一一筆標題是純 ASCII 的 —— **200**。

原因不在匯出。HTTP 的 header 值是 latin-1，Starlette 送出回應時會
`v.encode("latin-1")`，所以

```
Content-Disposition: attachment; filename="decision-決策：儲存層改用 PostgreSQL.md"
```

會在**回應階段**丟 `UnicodeEncodeError`，body 早就算好了，log 裡也沒有任何一行提到檔名。
使用者的決策記錄全部用中文寫，所以正式站 79 筆決策裡，能匯出的剛好是那 1 筆。這條路從來
沒有成功過。

框架早就解了這件事：Starlette 的 `FileResponse` 會照 RFC 6266 把檔名 percent-encode 進
`filename*`。**這正好解釋了為什麼 SPA 的附件下載是好的、而 `/api/v1` 的同一個下載是壞的** ——
內部那道門用 `FileResponse(filename=...)`，v1 那道門是自己組 `Response`、自己拼 header。
一件事兩道門，答案不一樣（ADR-0085 的老問題）。八個地方各自拼過這個 header，其中三個接的是
人寫的字：決策的兩道門，加上 v1 的附件下載（上傳「報告.pdf」，SPA 載得下來，v1 500）。

同一趟還發現另一件事。`decision_admin` 刻意唯讀，理由寫得很好 ——「寫入已經有門了，再開一個
就是 ADR-0087 花整份文件在拆的重複」—— 但它給的地址是錯的：

```
POST /api/v1/nodes {"type": "decision"}  →  422 unknown node type 'decision'
```

註冊表裡沒有 `decision` 這個型別，也從來沒有過。ADR-0004 早就決定決策是一個 **label**
（`data.type="decision"`）。這句錯的地址出現在五個地方：MCP 的工具描述、v1 端點描述、
`decision_admin` 的模組註解、`docs/api.md`、`CLAUDE.md` —— 也就是 agent 唯一會讀到的那幾行。
論證是對的，地址是錯的，而 agent 讀的是地址。

## Decision

**一個下載的 `Content-Disposition` 只組一次。** `services/downloads.attachment_headers(filename)`
照 Starlette 自己的規則：percent-encode，若結果與原字串不同就走 `filename*=utf-8''`，否則維持
`filename="..."`。八個下載端點全部改讀它，包含檔名保證是 ASCII 的那幾個 —— 留著判斷「這個檔名
安不安全」比直接統一貴。

**把錯的地址改成對的。** 五處全部改成
`POST /nodes {"type": "label", "data": {"type": "decision", ...}}`，並在 `decision_admin` 的註解
裡明寫舊的那句是什麼、為什麼錯，因為那句話已經被複製到五個地方一次。

`tests/test_download_filenames.py` 對兩件事下錨：header builder 產出的每一個值都
`.encode("latin-1")` 得過去（這正是壞掉時會炸的那一行），以及一筆中文標題的決策，兩道門匯出的
內容**逐字相同**。`tests/test_decisions_router.py` 釘住 `type="decision"` 是 422、而文件寫的
label 形狀會出現在兩道門的決策清單上。

## Consequences

- 中文（或任何非 ASCII）標題的決策記錄可以匯出了，非 ASCII 檔名的附件在 v1 也載得下來。
  這兩件事對這個實例來說不是邊緣案例，是常態。
- 錯誤指示修好之前，一個照著 MCP 工具描述做的 agent 會吃 422，而且沒有任何線索指向正確形狀
  （`/api/v1/node-types` 只會告訴它 `decision` 不在清單上，不會告訴它該用 `label`）。
- 這一類缺陷只有真的送一次請求才看得到：1952 個後端測試全綠，因為沒有一個測試用非 ASCII 的
  名字下載過東西。**負向對照確認過** —— 把 header 改回舊寫法，新測試立刻炸出正式站那個
  `UnicodeEncodeError`。
- 沒有動決策的儲存形狀。ADR-0004 的 label 決定不變，唯讀也不變 —— 改的只有「往哪裡寫」這句話。
