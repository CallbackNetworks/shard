# ADR-0095: 身分也是一個「工作住的地方」

## Status

Accepted

## Date

2026-08-17

## Context

ADR-0094 把祖先關係畫上畫面之後，照出一件本來看不見的事：**production 的階層是用一種現在建不出來的邊存的。**

使用者實際的結構是 `organization → identity → project`，中間那一段是 `contains` 邊，共 6 條。但 ADR-0078 的端點規則會拒絕它：

```
POST /api/nodes/{identity}/edges {rel_type: "contains", target: project}
→ 400 identity -> project is not valid for 'contains'
       (a contains source must be a container or a task); use 'owns' instead
```

規則是「一個型別若**宣告**了自己的形狀，就必須持有 `container` 或 `task` 才能當 `contains` 的來源」。而 ADR-0040 當初把 `identity` 宣告成 `{shareable, subscribable}` —— 一個掛歸屬用的人格，不是一個地方 —— 並且刻意把 container 角色給了 `organization`，論證是「兩個軸不能混：`contains` 是東西住在哪，`owns` 是這是誰的」。

那些邊比規則早存在，所以沒有壞：Focus 的 `reachable_project_ids` 同時走 `contains` 和 `owns`，篩選一直是對的。但代價是真實的：

- 使用者**沒辦法再照原本的方式建**。UI 的「把專案連到身分」寫的是 `owns`，於是舊專案掛 `contains`、新專案掛 `owns`，同一件事兩種存法。
- 身分底下沒有任何統計。`contains` 是唯一有 rollup 的軸，而身分不是容器，所以「這個身分底下有多少工作」這個問題沒有地方問。

## Decision

**給 `identity` 加上 `container` 角色。** 一個字串（seed + 一筆 migration，因為 `seed_builtin_types` 只會插入缺少的型別、從不覆寫既有資料庫）。

理由不是「規則太嚴」，是**規則和使用者的用法不一致，而使用者那邊是對的**：一個人格在這個產品裡確實是人們拿來歸檔工作的一層，不是只有一個名字。ADR-0040 的兩軸論證依然成立，也依然生效 —— `contains` 和 `owns` 都可以連 identity → project，兩者**不同義**：只有 `contains` 帶 rollup。edge type 的說明（會生成到 `/api/v1/edge-types` 與 agent-context）改寫成這句話，因為那是 agent 選關係時唯一會讀的東西。

角色是資料不是繼承（ADR-0040），所以這個改動很便宜。**便宜不等於沒有後果**，引擎會照角色決定行為，所以三個後果各有一條測試釘住（`tests/test_identity_is_a_container.py`）：

- 身分底下的專案**不會**因為刪除身分而被刪除（容器的 teardown 只吃它獨佔的任務與 scoped 實體）。
- 直接掛在身分底下的**任務會**跟著被刪。目前是 0 筆，但這是行為改變，該是一個決定而不是一次驚訝。
- 掛在兩個容器底下的任務只會失去一條邊。

## Consequences

**得到的：**

- 使用者的階層可以重建、可以延伸；不再是「舊的能用、新的建不出來」。
- 身分第一次有 rollup 和自己的容器頁：`/c/{identity}` 顯示「8 tasks (8 in sub-containers)」、底下的專案卡、以及分享面板。這頁本來就存在，只是身分到不了。
- 結構圖、麵包屑、首頁分組都自動把身分當成一層 —— 全部是 role-driven，零特判，這正是 ADR-0040 role 模型的驗收條件。

**代價：**

- **身分現在會收 CI/CD 回呼**（`webhookable_type_keys = task | container`，ADR-0082）。也就是說身分有 callback token 這個憑證面。合理但是新增的：容器收到的建置結果只記錄、不套用。
- `/api/v1` 刪除身分的 scope 從 `write` 升成 `admin`（容器一律如此）。這是收緊，但**是既有外部契約的改變**。
- 內建型別的 `container`/`task` 角色是凍結的（ADR-0079），所以之後要拿掉只能再發一次 migration —— 這正是凍結想要的：這種決定要留下紀錄。
- 兩種邊都合法之後，「該用哪一個」變成使用者要懂的事。答案寫在 `contains` 的 description 裡：**要統計就用 `contains`，只是說「這是誰的」就用 `owns`。**

**沒有做的：** 沒有把既有的 `owns` 邊搬成 `contains`，也沒有反過來。兩者都合法且不同義，批次改寫等於替使用者決定他每一個專案的意思。
