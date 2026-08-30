# ADR-0132: 一個欄位宣告要在畫面上宣告得出來

## Status
Accepted

## Date
2026-08-30

## Context

[ADR-0074](0074-a-type-declares-which-fields-are-the-users.md) 讓型別自己宣告
`fields`，`NodeFieldsPanel` 就是照著那份宣告畫出來的唯一編輯器。`fields` 在
`NodeTypeCreate` / `NodeTypeUpdate` 上都是可寫的，兩道門都收。

而 `/graph-types` —— 這個 app 裡唯一一個講型別註冊表的畫面 —— 能編 key、label、color、
roles，**就是不能編 `fields`**。

所以一個自訂型別永遠拿不到可編輯的欄位。正式站現在就是這個狀態：

| 型別 | 節點數 | 宣告的欄位 | `data` 裡實際帶的鍵 |
|------|--------|-----------|--------------------|
| `repository` | 9 | 0 | `repo_url` `owner` `default_branch` `visibility` `latest_commit` `description` `upstream_url` `service_url` |
| `organization` | 2 | 0 | `description` |

那 8 個欄位是真的使用者欄位，每一個在 `/n/{id}` 上都是唯讀列表裡的一行，只能靠有人去
API 上手寫 JSON 才設得了。

這和 [ADR-0122](0122-a-relation-is-drawn-once-and-can-be-created.md) 抓到的是同一件事：
`governs` 當時有 write helper、有反向讀取端點、有 client 函式，而**零個呼叫端**。能力做好了，
沒有門。

## Decision

**`components/graph/NodeTypeFieldsEditor.jsx`**，掛在 `GraphTypes` 既有的行內編輯器裡。
自訂型別可編；內建型別的宣告是凍結的（[ADR-0121](0121-a-builtin-declaration-is-code-not-a-row.md)），
所以改用唯讀摘要呈現 —— 它們是程式碼，在這裡改一次會被下一次 resync revision 蓋回去，
那正是 ADR-0121 存在的理由。收合狀態下每一列都直接說出「宣告了幾個欄位」，包括 0 個。

**詞彙表用服務的，不在 client 抄一份。** 新的
`GET /api/graph-types/fields/vocabulary` 回 `{managed, kinds, stores, columns}` ——
全部從真正在執行檢查的那份程式碼取。這取代了原本只回 managed keys 的
`/data-keys/managed`：兩個端點各服務同一份詞彙的一部分，就是下一次漂移的位置。
理由是既有的：[ADR-0056](0056-every-value-box-knows-what-belongs-in-it.md) 抓到規則編輯器
提供了引擎會拒絕的值，[ADR-0058](0058-engine-names-and-user-names.md) 抓到規則名稱清單漂了。
在有這個編輯器之前沒有任何 UI 讀這些，這正是第二份副本會被寫出來的時機。

**`columns` 是其中最要緊的一項**，所以 store 一切到 `column`，key 的輸入框就換成
那份清單的下拉。CLAUDE.md 早就記著這條規則：一個 `column` 欄位若指到
`WRITABLE_COLUMNS` 以外的名字，會被寫進 `data` 的同名鍵 —— 看起來存好了，欄位一點沒動。
自由輸入框是走到那裡的方法，所以這裡沒有自由輸入框。

同一次把一個小漂移補上：`NodeFieldSpec` 原本只拒 `MANAGED_DATA_KEYS`，
不拒 `node_data.DERIVED`。`share_pin_set` 是讀取時算出來、寫入時被剝掉的，宣告成欄位會畫出
一個「每次存檔都被丟掉」的輸入框。端點已經叫編輯器把它藏起來了 —— 兩份清單必須是同一份，
否則編輯器藏起來的鍵，寫入端其實會收。這是新測試逼出來的，不是猜的。

## Consequences

- 自訂型別可以在 UI 裡長出自己的欄位，`/n/{id}` 的通用編輯器立刻照著畫。使用者自己的
  `repository` 與 `organization` 層終於可以宣告它們一直都在用的那些欄位。
- **`/data-keys/managed` 沒了**，換成 `/fields/vocabulary`。只有 SPA 用它，
  `/api/v1` 沒有對應端點，所以沒有外部合約被動到。
- v1 沒有跟著開一道「詞彙表」的門，因為 agent 這一面本來就是通的：`fields` 在
  `/api/v1/node-types` 上可寫，而 kind / store / managed 的拒絕訊息各自都會列出合法清單 ——
  agent 讀得到的是錯誤，那條路是通的。
- 半寫完的宣告在前端就存不下去（沒有 key、沒有 label，或 enum 沒有值）。伺服器一樣會 422，
  但那會連整筆型別編輯一起帶走，而使用者只是按了「新增欄位」然後改變主意。
