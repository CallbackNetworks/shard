# ADR-0075: 容器的狀態只有一套規則

## Status
Accepted

## Date
2026-08-14

## Context

Prod 上線後，第一次真的用外部 API 把一個專案建進去——`POST /api/v1/nodes {"type":"project","title":"Shard"}`，201，回傳看起來完全正常。

然後：

- `GET /api/v1/projects` → 列出這個專案，`"status": "active"`
- `GET /api/v1/agent-context` → `"projects": []`

同一個資料庫、同一把金鑰、相差幾秒的兩個請求，一個說有，一個說沒有。

原因是 `status` 是選填欄位。ADR-0033 把 project 變成 `Node` 之後，`status` 是節點的 hot column，而泛用寫入面（ADR-0040、ADR-0042）沒有理由替呼叫者發明一個狀態，所以欄位留 NULL。讀的時候：

```python
status=node.status or "active"     # _project_view / _goal_view，各寫了一份
```

列表的時候：

```python
query.filter(Node.status == status)  # all_projects / all_goals，各寫了一份
```

**顯示時 NULL 是 active，過濾時 NULL 什麼都不是。** 這是 ADR-0068「一個專案只有一種大小」的同一類錯誤，只是換到狀態上：一個值有兩套算法，兩邊各自都說得通，湊在一起就互相打臉。

為什麼撐到現在才炸：內部路徑用的 `graph.create_project()` 帶著 `status: str = "active"` 預設參數，所以 UI 建的專案欄位都有值；測試也一律明寫 `make_project(db, name=..., status="active")`。**只有走泛用節點寫入面建立的容器會是 NULL，而那正是 agent 走的那條路。**

代價特別高的地方在於受害的是哪個 endpoint。`/api/v1/agent-context` 的說明文字自己寫著「Designed as the first endpoint an AI agent should call」——一個 agent 照著做，得到的答案是這個平台上沒有任何專案，於是它要嘛什麼都不做，要嘛建立一個重複的專案。

## Decision

容器狀態的**預設值和它的過濾條件成對放在一起**，放在 `graph/core.py`：

```python
CONTAINER_DEFAULT_STATUS = "active"

def container_status(node) -> str:            # 讀
    return node.status or CONTAINER_DEFAULT_STATUS

def container_status_filter(status):          # 過濾，與上面同義
    if status == CONTAINER_DEFAULT_STATUS:
        return or_(Node.status == status, Node.status.is_(None))
    return Node.status == status
```

`_project_view` / `_goal_view` 讀前者，`all_projects` / `all_goals` 濾後者。四個地方原本各自手寫的規則歸零。

**不在寫入端補預設值**（例如讓 `create_node` 替容器填 `"active"`），雖然那看起來更直覺。理由是那只修好未來寫進來的資料：資料庫裡既有的 NULL 列仍然會顯示成 active 而不出現在 active 列表裡，於是同樣的矛盾繼續存在，只是變得更難發現——要修就得再加一次 migration，而規則本身還是兩份。規則統一在讀取端，既有資料立刻正確，不需要 migration。

測試從**泛用寫入面**建立容器，而不是像既有測試那樣明寫 `status="active"`——把狀態傳進去，正是這個 bug 躲掉整套測試的原因。

## Consequences

正面：

- 「這個容器是不是 active」在整個系統只有一個答案。`/api/v1/projects` 與 `/api/v1/agent-context` 現在必然一致，測試直接斷言兩者的專案清單相等。
- 既有的 NULL 資料不需要 migration 就正確。
- goal 有一模一樣的缺陷（`all_goals` 同樣濾欄位），一起修掉了——查的時候順手 grep 全部 `Node.status` 的比較，而不是只修眼前那一個。
- 明確的狀態值（`archived`）行為不變，也不會誤收 NULL 列。

負面：

- 多一層 helper：任何新的容器列表若直接寫 `Node.status == ...`，一樣會漏掉 NULL。沒有靜態守衛擋這件事，只有 `test_goal_container.py` 的那個測試會在 project/goal 上失敗；新增第三種容器列表的人得自己記得。
- `status` 仍是自由字串，沒有 enum 約束——這次沒有一併處理，因為狀態值本身是使用者可見的詞彙（ADR-0056 的範疇），不該在這裡順手鎖死。
