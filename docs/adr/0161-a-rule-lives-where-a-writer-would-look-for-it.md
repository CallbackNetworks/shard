# ADR-0161: 規則要住在會去找它的人會看的地方

## Status
Accepted

## Date
2026-09-11

## Context

三件事，同一個形狀：**一份知識有兩個副本，或者一份知識放在沒有人會去找它的地方。**

### 一、寫入不變量被硬塞在通用管線裡

[ADR-0159](0159-a-status-that-is-a-consequence-is-not-a-word-you-type.md) 修好了一個真缺口，
修法是在 `assert_decision_write_shape` 加第三個分支——而那是一個**以型別命名**的函式，被兩條
通用寫入路徑**指名呼叫**：

```python
graph.assert_decision_write_shape(db, node.type, changes, node_id=node.id)
```

這行在 `graph_dispatch` 和 `node_admin` 裡，而它們對決策一無所知，也不應該知道。這個形狀的
結局是可預測的：第二個需要不變量的型別會在旁邊加第二行，第三個加第三行，而
[ADR-0040→0043](0043-collapse-container-scoped-writes-to-nodes.md) 花四則 ADR 收成一個的
通用寫入面，就長出一個除了語法之外什麼都像的 per-type `if` 階梯。

這也正是 ADR-0159 那麼難找的原因：規則被寫在三份文件裡，而三份都不在「一個要寫入的人會去看」
的位置上，因為根本**沒有一個位置**是給寫入規則住的。

### 二、助理的工具說明和 MCP 的不一樣

`services/assistant_tools.TOOLS` 和 `mcp_server/server` 重疊 34 個工具名。
`tests/test_assistant_tool_parity.py` 已經釘住了結構那半——工具**名稱**與**參數**，每一個真實
差異都寫了下來並凍結。它一個字的散文都沒檢查，而散文正是模型真正讀的東西。

實測：**34 個共用工具裡，27 個對自己的描述不一樣**。

```
add_comment  assistant: "Add a comment to a task. Supports markdown."
             mcp      : "Add a comment to a task. Useful for leaving notes,
                         progress updates, or context."
```

兩個都沒錯，而這正是重點——沒有任何失敗徵狀，只有一個模型會因為它從哪扇門進來，而對「什麼
時候該用這個工具」得到不同品質的提示。[ADR-0089](0089-one-assistant-one-definition-of-overdue.md)
是完全同一個缺陷往上一層，而這個守門測試自己的 docstring 就引用了它，然後只檢查名字。

### 三、一條設計規則被六個按鈕反著做

`global.css` 裡 `.kt-btn-danger` 上方寫著：

> 顏色在 hover 與 focus 才出現，在那裡它**確認**這顆按鈕做什麼，而不是預先廣告它。

六顆刪除圖示鈕（goals、templates、workflow rules、node page）用 inline 設了
`color: DARK.danger`，因此**一直都是紅的**——在一排其他控制項都是灰色的列裡最吵的那個，
而它違反的規則就寫在同一個檔案往上二十行。

## Decision

### 一、`services/write_invariants.py`

不變量**向它所約束的型別登記自己**，寫入路徑只問一個問題：「這筆寫入可以嗎？」

```python
@write_invariants.register(NODE_DECISION)
def _keep_the_superseded_status_tied_to_its_edge(db, node_type, fields, node_id): ...

write_invariants.check_write(db, node.type, changes, node_id=node.id)
```

擁有某個型別的模組就擁有它的規則，並且把規則宣告在它所談論的程式碼旁邊。

**`ANY` 是一個真正的答案，不是偷懶。** ADR-0130 的守衛要對一筆帶著
`data.type="decision"` 的 `label` 寫入開火——整件事的重點就是這筆寫入**說**的是一個型別、
**意思**是另一個，所以照 payload 裡的型別去登記，會把它登記在它唯一永遠看不到的那個型別底下。

規則丟 `ServiceError`（[ADR-0085](0085-a-capability-is-not-browser-only.md)），由單一 handler 渲染，
所以內部門和 v1 門不可能對同一筆寫入給出不同的拒絕。

登記靠 import 副作用，而接不上是**無聲的**——規則不在就只是不在，寫入路徑不呼叫就跟規則不存在
時一模一樣回 200。所以 `tests/test_write_invariants.py` 釘的是接線本身，不是任何一條規則的邏輯。

### 二、`services/agent_tool_prose.py`

方向是被逼出來的。[ADR-0077](0077-the-tool-list-is-the-code.md) 讓 MCP 工具的**簽名就是
它的 schema**，[ADR-0086](0086-a-field-you-can-read-is-a-field-you-can-write.md) 讓 `/api/v1/tools-schema` 變成那份
註冊表的投影而不是旁邊的第二份清單——MCP 那側早就是從它所描述的程式碼生成的。助理那份是剩下
的手寫副本。

所以共用工具在 `TOOLS` 裡**完全不帶描述**：看到散文，就代表這個工具不是 MCP 提供的那一個。

`describe()` 是 **local 優先**，不是 shared 優先。這樣「這一筆帶了散文」才**等於**「這個工具
跟 MCP 的不是同一個」。shared 優先會安靜地把一個工具描述成它做不到的事，那比兩份描述更糟——
模型會讀到一個不在它拿到的 schema 裡的參數。

因此兩個缺口被**補掉**而不是被改寫文字：`list_tasks` 拿到 `priority`、`get_container_subtree`
拿到 `view`（另一半就是 `contained_task_ids`，ADR-0065）。剩下兩個保留自己的散文並寫明理由：
`get_analytics`（MCP 的提到 velocity/heatmap/status_trend，那三個住在 v1 路由而不是
`analytics_admin`）與 `manage_attachments`（MCP 的描述用 `content_base64` 上傳，這扇門只能列與刪）。

實作刻意維持分開。[ADR-0005](0005-mcp-server-http-proxy.md) 讓 MCP 走 HTTP 代理 `/api/v1`、
助理用行程內的 `db` 呼叫服務；那是資料路徑的決定，而且漂移的不是它。

### 三、`.kt-card-section` 與 `.kt-icon-btn-danger`

前者取代 13 處「寫了 `.kt-card` 再用完全相同的 inline 蓋掉它的 padding」，跨 6 個檔案。
後者讓那六顆刪除鈕照它們上面二十行那條規則走：靜止是灰的，hover 與 focus 才變紅。

**其餘的 inline style 刻意不動。** 量過之後：1416 處、**1074 種不同的形狀**，也就是約四分之三
只出現一次。把 1074 個一次性形狀翻成 1074 個 CSS module class name 不是抽象化，是把同一份資訊
搬到另一個檔案再加一層間接，而且要冒視覺回歸的風險。[ADR-0012](0012-frontend-styling-strategy.md) 的
「改到哪個元件就順手搬哪個」仍然是對的規則；先前把 1416 這個數字講成一個待辦，是在描述一個
**慣例**，不是在描述一個**重複**。

## Consequences

- 下一個需要寫入不變量的型別，把規則寫在自己的模組裡並登記，不必碰 `graph_dispatch` 或
  `node_admin`。`registered_types()` 讓「有哪些規則」是可以被問出來的。
- 助理與 MCP 的共用工具說明不可能再漂移；能漂的只剩下被列名並寫了理由的那兩個。
- 助理多了兩個能力（`list_tasks` 的 priority 篩選、`get_container_subtree` 的 `view`），
  因為「描述說它做得到」跟「它做不到」之間，該動的是後者。
- 六顆刪除鈕的靜止外觀變了——這是刻意的視覺改變，不是修 bug 的副作用。
- inline style 的總數幾乎沒變（-19）。那個數字不是這則 ADR 要解決的問題，理由寫在上面。
