# ADR-0159: 一個「後果」性質的狀態，不是一個可以自己打上去的字

## Status
Accepted

## Date
2026-09-11

## Context

ADR-0118 把決策記錄從 `label` + `data.type="decision"` 搬成自己的節點型別，並且在兩處
明文寫下同一句話：

> `superseded` 是 `supersedes` 這條邊落在對面那端的後果，**不是一個自己打上去的狀態**。
> 一筆記錄說自己「被取代了」而資料庫裡沒有任何東西說「被誰」，那是一個死結。

`graph_registry.py` 的 `DECISION_STATUSES` 註解寫了一次，`decision_records.py` 的模組
docstring 寫了第二次。`supersede()` 之所以把「寫邊」和「改狀態」綁成一個動作，理由也正是
這個：拆成兩次呼叫的話，單獨失敗的那一半剛好就是留下死結的那一半。ADR-0122 進一步讓卡片
在 `superseded` 狀態下**不提供任何按鈕**，因為任何一顆改狀態的按鈕都會跟一條邊互相矛盾。

三份文件、一個綁在一起的服務函式、一個刻意留白的 UI。沒有人寫那條規則。

通用節點寫入面（ADR-0040→0043 之後**唯一**的寫入面，也是 agent 唯一走的門）照單全收
`status="superseded"`：

```
PATCH /api/nodes/{id} {"status": "superseded"}  ->  200
GET   /api/decisions/{id}                        ->  {"decision_status": "superseded",
                                                      "superseded_by": []}
```

ADR-0118 遷移掉了當時存在、而且**說得出後繼者是誰**的那幾筆，然後把門留著。這次量正式站：

| | |
|---|---|
| 決策記錄 | 226 |
| 狀態標成 `superseded` | 27 |
| `supersedes` 邊 | 10 |
| **說自己被取代、而沒有任何東西說被誰** | **17** |

把這 17 筆的 `created_at` 對到 ADR-0118 上線那天（`eb03054`，2026-08-28）：

- **8 筆早於它**。遷移只能把 `data["superseded_by"]` 這個鍵轉成邊；沒有記後繼者的那幾筆
  沒有東西可以轉，於是原地留下。
- **9 筆晚於它**。這 9 筆是在「決策已經是自己的節點型別、規則已經寫在三個地方」之後，
  照樣從通用寫入面走進來的。

第二個數字才是這則 ADR 的理由。ADR-0118 之後的每一天，這扇門都還開著。

這也是這個專案反覆出現的同一類：ADR-0122 的 `governs` 有 write helper、有反向讀取端點、
有 client function，零個呼叫端；ADR-0132 的 `fields` 有兩個 API 門、沒有任何畫面；
ADR-0121 的內建宣告改了、到不了既有資料庫。**一條被宣告而沒有被執行的規則，跟沒有這條
規則的差別，只在於它讓讀程式碼的人以為有。**

## Decision

`assert_decision_write_shape` 加上第三種拒絕——它已經是兩個門（`node_admin.create`、
`graph_dispatch.dispatch_node_updated`）共用的那一個呼叫，所以一處改動兩門都蓋到。多收一個
`node_id`，因為判斷條件不是字面值而是「這個節點身上到底有沒有那條邊」。

規則**雙向**成立：

1. `status="superseded"` 而沒有指向它的 `supersedes` 邊 → 422。建立時必然屬於這一類，
   一筆剛出生的記錄不可能已經被取代。
2. 狀態要離開 `superseded` 而邊還在 → 422。只守一個方向的話，鏡像的死結（邊說被取代、
   狀態說 accepted）照樣走得進來，不變量就只成立一半。
3. 邊還在、把 `superseded` 原樣寫回去 → 200。一個 GET 完再 PATCH 回來的 client，不該
   被自己的現況擋下來。

兩則拒絕訊息都**指名做得到的那個動作**，而且把這筆記錄自己的 id 帶進去
（`POST /decisions/{replacement_id}/supersedes/<this-id>`）。這是 ADR-0078 的規矩：
agent 一定會讀錯誤訊息，不一定會讀文件。

`supersede()` / `unsupersede()` 直接寫 ORM 屬性，不經過寫入面，因此不受這條規則影響——
它們**就是**那條規則所說的那個合法動作。

已經存在的 17 筆不做 migration。後繼者是誰這件事沒有記在任何地方，猜一個等於把使用者的
原意改掉。改成讓它們**在畫面上修得掉**：`DecisionCard` 現在分辨「有邊撐著的 superseded」
和「沒有邊撐著的 superseded」，後者畫一個 failed 色系的 `⚠ no successor`
（ADR-0088：壞掉的狀態本來就是那一族的意思，不另開第四種色相），並且**提供 REOPEN**。
這不是對 ADR-0122 的例外，而是同一條理由算到底：那顆按鈕之所以不存在，是因為它會跟一條邊
矛盾；沒有那條邊的時候，它不跟任何東西矛盾。

## Consequences

- 一筆決策不可能再被寫成死結。這條路徑上所有的門——內部 `/api`、`/api/v1`、MCP 的
  `update_task`/節點寫入工具、助理、匯入——全部收斂在同一個 `assert_decision_write_shape`。
- **這是一個行為改變，而且會打到既有的 agent 腳本**：任何過去用 `status: "superseded"`
  記錄取代關係的呼叫端，現在會拿到 422。訊息直接給出該打的那一支，所以是可修的失敗，而不是
  安靜的錯誤資料。
- 正式站那 17 筆維持原狀，但不再是隱形的：決策頁的 `superseded` 篩選會把它們連同警示標記
  一起列出來，每一筆都可以就地 REOPEN，或者從取代它的那筆記錄補上真正的 `supersedes` 邊。
- 一筆被邊撐著的記錄，狀態欄變成唯讀。要改就得先撤掉取代關係——這正是 UI 從 ADR-0122
  以來的唯一走法，現在 API 跟它一致了。
- `tests/test_decisions_router.py::TestTheSupersededStatusCannotBeTypedOnItsOwn` 釘住
  七個方向（含兩門回覆逐字一致、以及「其他狀態照樣自由」這個負向控制）。拿掉守衛時其中
  四個會紅——這是實測過的，不是推論。
