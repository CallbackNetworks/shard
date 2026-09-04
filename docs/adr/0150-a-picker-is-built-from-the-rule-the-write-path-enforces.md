# ADR-0150: 選擇器要用「寫入時真正執行的那條規則」蓋出來

## Status
Accepted

## Date
2026-09-04

## Context

使用者的話是「我覺得自己連線 node 和 edge 的那個界面很不直觀」，接著是「甚至整個 Data 模塊的每個頁面都很難用」。兩句都對，而且是同一個病根的兩個切面。

### 一、連線介面：規則早就存在，畫面沒有讀

ADR-0078 給每個關係加了 `allowed_source` / `allowed_target`，`graph.add_edge` 每一次寫入都執行它，兩個 API 門都服務它，`/graph-types` 那頁還把它畫出來。但**建立邊的那個控制項自己重新推導了一次，而且三件事全錯**：

1. **關係清單不過濾。** 對 dev 資料庫的十個節點型別實測，每個型別能當來源的關係數量：

   | 節點型別 | 下拉選項 | 真的可能成功 |
   |---|---|---|
   | project / goal / area / cycle / label / organization | 9 | **2** |
   | task / incident | 9 | 4 |
   | decision | 9 | 6 |

   在專案頁上，七個選項選了必定 400。使用者學到規則的唯一管道是事後的錯誤訊息。

2. **方向寫死成 outgoing。** 這造成兩個相反的傷害。**能力缺口**：`owns` 和 `governs` 的專案端都在 *target*，所以從專案頁根本建不出來——這條關係在那個畫面上不存在。**靜默的錯誤資料**：在任務頁上想說「這個任務屬於那個專案」，唯一做得到的操作是選 `Contains` + 選專案，而 `contains` 沒有 allow-list、`task` 又持有 `task` 角色，所以 `graph.add_edge` **接受**它。存進去的是 `task contains project`，方向相反，之後每一個 subtree rollup 都照它算，而且沒有任何錯誤訊息。這是那個畫面上最常做的動作。

3. **候選節點不過濾。** `NodeCombobox` 早就有 `filter` prop（`MembershipPanel` 有用），`NodePage` 沒傳，所以選了 `depends_on` 之後照樣把 label、identity、project 全端出來。

同一份表單有**三份**：`NodePage`、`NodeExplorer`、`MembershipPanel`。`NodeExplorer` 那份更差，是三個互不相干的下拉（關係／目標型別／目標節點）。這是 ADR-0070→0087 那條線的老形狀：重複的實作不會壞，只會各自漂移。

而每個關係的 `description`——包含「要講『誰的』就用 owns，不是 contains」這種正好在選擇當下該讀的字——服務出去了，只畫在 `/graph-types`。**規則被畫在唯一不能對它動手的那一頁上。**

### 二、Data 模組：四頁是照資料表分的，不是照要做的事分的

- **Data Explorer**：**沒有搜尋框**（`getNodes(type, query)` 支援 `query`，這頁沒傳過）；後端 `limit=100` 且沒有 offset，頁面把畫出來的長度當成總數印出來，所以 144 筆任務顯示成「100 nodes」，44 筆從這頁到不了；預設型別是 `nodeTypes[0]`＝Cycle，19 個 sprint；十個型別有七個 `readOnly`，而副標寫「Browse and **create** nodes of any type」。
- **Unfiled**：判斷式是「沒有 incoming containment edge」。樹的根**按定義**沒有父節點，所以 `組織 / Callback Network`（底下 21 個專案）永遠躺在收件匣裡，提示還寫「Open one to link it into the graph」——照做就是把根接到別人底下。一個清不完的收件匣不是收件匣。
- **Containers**：一整列側欄，畫兩張卡，而且畫的是**型別不是容器**；過濾條件 `container 角色 && !is_builtin` 把 project 和 identity 排除掉，所以叫「Containers」的頁面列不出大部分容器。那兩張卡在 Item Types 左欄已經有了，還多附欄位、角色、使用數，而且可以編輯。
- **Item Types**：四頁裡唯一站得住的。它的洞是新增 edge type 的表單只有 key / Label / Containment——`allowed_source` / `allowed_target` / `is_symmetric` 設不了，所以從 UI 建出來的關係**永遠是無宣告的**。跟 ADR-0132 的 `fields` 同一形狀：引擎會讀、API 寫得到、人點不到。`updateEdgeType` 在 client 裡根本不存在。

## Decision

**規則只有一份，而且是寫入時執行的那一份。前端不重新推導。**

### 伺服器回答「這個節點能連到什麼」

`relation_options(db, node_type)`（`graph_registry`）用 `graph.relation_accepts`——`add_edge` 執行的同一個判斷式——每個方向各跑一次，回傳每個選項的 `rel_type` / `direction` / `label` / `description` / `is_containment` / `is_symmetric` / `other_types`。

- `direction` 是 `outgoing`（寫 `this -> other`）或 `incoming`（寫 `other -> this`）。對稱關係（ADR-0127）只出一個選項，因為反向那列**就是**這條邊。
- `other_types` 把另一端解析成具體型別 key，而不是把 `{types, roles}` 宣告原樣回傳：前端若要按 role 過濾候選，就得自己抄一份角色表，那正是 ADR-0056 講的第二份詞彙。
- **措辭不在這裡組。** label 是使用者的，方向是翻譯樣板。ADR-0058 是「引擎的名字由伺服器畫」，而「被包含」不是引擎的名字——英文對使用者自訂的 label 也沒有通用被動式，中文有「被」，所以方向由兩個 `optgroup` 標題承擔，不逐個關係變格。

兩個門都有：`GET /api/graph-types/edges/options/{node_type}` 與 `GET /api/v1/edge-types/options/{node_type}`（`read` scope）。MCP 這面不是新工具而是 `list_edge_types(for_type=...)`——ADR-0093 的規則是一個能力一個工具，而這是同一個能力被收窄。

### 一個選擇器，三處共用

`components/shared/RelationPicker.jsx` 取代 `NodePage` / `NodeExplorer` / `MembershipPanel` 的三份表單。方向做在選項清單**裡面**（使用者的選擇），所以選一次就是一句完整的話；選定關係後 `description` 就顯示在下面，候選節點按 `other_types` 過濾。這個元件不知道 role 是什麼。

順手修掉同族的兩個不對稱：`MembershipPanel` 的關係區塊不再只在「已經有關係」時才出現（建立關係的控制項只在你已經有一條時才看得到——ADR-0122/0128 為同一個理由把 `governs` 的空狀態放出來過），以及 detach 按鈕不再只給 outgoing 邊（從另一端建的關係看得到、刪不掉）。

### Data 模組四格併兩格

`/explorer` 重做成一頁：跨型別搜尋、型別側欄帶**真實總數**（`usage_count` 是伺服器的 COUNT，不隨頁面大小變動）、真的分頁（`GET /api/nodes` 加 `offset`）、選中節點的關係就地編輯。`?type=` 與 `?loose=` 進 URL（ADR-0083）。

`/unfiled` 與 `/containers` 收掉，路徑改成 redirect——退休的頁面不該變成 404，但也不該留成第二份實作。「未歸檔」變成這頁的一個篩選器，並且**換了定義**：`graph.unfiled_node_ids` 是「上面沒有東西**而且**下面也沒有東西」。根節點是「沒有東西在它上面、但它裝著東西」，不算孤立。這個區分不需要型別或角色，所以對沒人告訴過 app 的自訂層一樣成立。

側欄 DATA 從四列變兩列——ADR-0066 的規則再往外一層：那四列是同一份資料的四個切面，其中兩個是第三個的子集。

### 自訂關係宣告得出自己的端點

`components/graph/EdgeEndpointsEditor.jsx` 讓自訂 edge type 設定 `description` / `allowed_source` / `allowed_target` / `is_symmetric`。空宣告存成 `null` 而不是 `{types: [], roles: []}`——後者讀起來是「什麼都不合格」，會擋掉每一條邊，而欄位本身對「不存在」的定義是「不受限」。內建型別沒有鉛筆：它們的宣告在兩個門都被凍結（ADR-0121）。

## Consequences

- 專案頁的關係選項從「9 選 1，7 個是死路」變成 5 個全部可用，其中 `owns ←` 和 `governs ←` 是**以前建不出來**的。實測從專案頁建立，資料庫存的是 `identity -owns-> project`，方向正確。
- Data Explorer 選 Task 時說「144」而不是「100」，而且那 44 筆到得了。
- `tests/test_relation_options.py` 從兩個方向釘住「選擇器 = 寫入規則」：**每一個提供的選項都必須是 `add_edge` 接受的邊**，且**每一條 `add_edge` 接受的邊都必須被提供**。第二條是重點——它就是 `owns` / `governs` 從專案頁消失的那個缺口，用測試寫出來。寫這些測試時抓到我自己兩處判斷錯誤：`labeled` 只宣告 target 規則，所以 label → label 是合法的；註冊表沒聽過的型別會得到「自由圖」那個答案（`contains` + 沒有 source 規則的關係），不是空清單。
- **`contains` 的規則沒有改。** `task contains project` 現在仍然會被 `add_edge` 接受。方向變成明確選項之後，那條路不再是唯一能走的路——但它還在。要不要禁止「持有 `task` 角色的來源包含一個 `container` 角色的目標」是另一個決定，需要先看正式站有沒有既存的這種邊，不該夾帶在這次改動裡。
- 少了三份重複的表單和兩個頁面（`Unfiled.jsx`、`Containers.jsx` 及其測試）。`/unfiled`、`/containers` 這兩個網址仍然到得了地方。
- **代價**：舊 Unfiled 頁那個「選專案 + FILE」的快捷按鈕沒有了。等價操作是在 Data 頁選中任務、`← Contains` + 選專案——步數一樣，但少一份實作。使用者偏好一個最小的原語勝過一組專用機制。
- 「孤立」的新定義會列出比舊頁多的東西（例如二十幾個沒有父節點也沒有子節點的專案）。那是誠實的：它們確實孤立。名字從「未歸檔」改成「孤立」，因為前者暗示這是待辦事項。
