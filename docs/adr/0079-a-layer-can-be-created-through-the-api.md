# ADR-0079: 新增一個層級，不能只有 UI 做得到

## Status
Accepted

## Date
2026-08-15

## Context

使用者要在專案之上加一層「組織」，發現只能在 `/app` 裡建，API 建不了。查證結果他是對的，而且比「少一個端點」嚴重：

```
POST /api/v1/nodes {"type":"area", ...}          → 201   （某型別的節點：可以建）
POST /api/v1/graph-types/nodes {...}             → 404   （型別本身：路徑不存在）
GET  /api/graph-types/nodes  （帶 API key 打 prod）→ 401
```

prod 的 `/api/v1` 底下 44 條路徑，**沒有任何一條與型別有關**。型別註冊表只掛在內部 `/api` 命名空間下，而 prod 設了 `AUTH_PASSWORD`，那個命名空間需要瀏覽器 session——API key 一律 401。

兩個後果，第二個比第一個嚴重：

1. **建立層級是 UI 專屬能力。** 一個 agent 可以建立節點、拉邊、改狀態，卻無法新增一個「層級」。這條界線沒有任何 ADR 主張過——ADR-0042 把外部寫入面收斂成 graph-native 的節點/邊時，型別註冊表沒有跟著開出去，就這樣留著。

2. **`type` 是每一次節點寫入的必填欄位，而 `/api/v1` 從來沒有說過哪些值合法。** 呼叫者必須「本來就知道」有 `project`、`goal`，而**自訂型別根本無從發現**。這正是 ADR-0078 前一天才在關係詞彙上關掉的同一個洞：系統握有詞彙表，卻不交給要使用它的人。當時開了 `/api/v1/edge-types`，node types 連**讀**都還沒有。

## Decision

### A. `/api/v1/node-types`：讀取用 `read`，寫入用 `admin`

- `GET /node-types` — 每個型別的 label、roles、欄位宣告與使用數。**roles 一起送**，因為它決定該型別的節點可以坐在哪裡（ADR-0078）：`container` 可以當父節點，`task` 可以當子任務。
- `POST` / `PATCH /{key}` / `DELETE /{key}` — 需要 `admin`，不是 `write`。**型別是其他資料的形狀**，與「刪除容器需要 admin」同一個標準。

`conventions.node_types` 一併加進 `/api/v1/agent-context`，與 ADR-0078 的 `relations` 並列，同樣由註冊表生成。

### B. 規則搬進 `graph_registry`，兩扇門共用

守則（built-in 不可刪、built-in 的 `container`/`task` role 不可改、仍有節點在用時不可刪、重複 key 是 409）原本寫在內部 router 裡。現在**有兩扇門通往同一個註冊表**，而只在一扇門上執行的守則不是守則。

規則移到 `services/graph_registry.py`，以 `TypeRegistryError(status_code, detail)` 表達拒絕，兩個 router 各自把它翻成 HTTP。ADR-0074 的欄位守則（不可宣告 feature 擁有的 key、未知的 `kind`/`store`）本來就在 schema 上，兩邊共用同一組 schema 即自動生效。

測試對**兩扇門發同一個請求、比對狀態碼與訊息字串相等**——不是各測各的。各測各的正是兩份實作漂移時仍然全綠的寫法。

### C. edge types 維持唯讀，這是刻意的

`/api/v1/edge-types`（ADR-0078）只開讀取，這次不一併開放寫入。**一個沒有端點宣告的新關係，正是 ADR-0078 花整份篇幅關掉的東西**；要從 API 建立關係，得連 `allowed_source`/`allowed_target` 的宣告一起設計成外部合約，那是另一件事，不該順手夾帶。節點型別沒有這個問題：它的守則已經完整。

## Consequences

正面：

- 「在專案之上加一層組織」現在 API 做得到，`agent-context` 也看得到有哪些層級可用。
- 型別註冊表的守則只有一份實作，並且由一個對兩扇門發同一請求的測試盯著。
- 內部 router 因為改為委派而變短，行為不變（既有測試未修改即通過）。

負面：

- 型別寫入需要 `admin` scope，只有 `write` 的既有金鑰不能建層級。這是刻意的，但代表要建層級就得配一把 admin 金鑰。
- 兩扇門的認證模型仍然不同（內部靠瀏覽器 session、外部靠金鑰），這份 ADR 沒有統一它，只確保**規則**一致。
- `/api/v1` 缺少 header 時回 422 而非 401（FastAPI 對必填 header 的驗證），全部 44 條路徑皆然。新端點沿用同一行為而不特別處理，一致性優先；測試直接斷言這個真實合約。
