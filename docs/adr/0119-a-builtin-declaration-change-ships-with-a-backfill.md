# ADR-0119: 改了內建型別的宣告，就要附一支 backfill

## Status
Accepted

## Date
2026-08-28

## Context

`seed_builtin_types` 只插入**缺少**的型別，從不覆寫。這對使用者自己建的型別是對的 —— 種子沒有立場去重設別人編輯過的東西。代價是：改了 `graph_registry` 裡某個內建型別的宣告，只有全新的資料庫會拿到新的，既有的資料庫永遠留著第一次拿到的那份。

同一個關係在兩個資料庫裡意思不同，這就是漂移的定義。而且它已經在正式站發生了好幾個月：

ADR-0095 把 `container` 角色給了 identity，也把 `contains` 的說明改寫成這件事，但**沒有附 backfill**。正式站的 `GET /api/v1/edge-types` 和產生出來的 `agent-context` 一直在說：

> …so **an identity cannot be a parent here**: use 'owns' to say whose work something is.

這句話在正式站是假的。identity 在那裡持有 `container` 角色，`graph.add_edge` 照收 `identity -> project` 的 `contains`，而正式站自己的階層（organization → identity → project）就是這樣建起來的。ADR-0078 的整個論點是「說明才是 agent 真正會讀的那部分」；一句過期的說明教的是跟引擎相反的規則，比沒有說明更糟。

在這之前已經有三支 revision 存在的唯一理由就是把這種改動帶過去（`a1c3e5b7d9f0`、`b2d4f6a8c1e3`、`f6b8d0c2e4a3`），每一支都是靠**有人記得**才寫的。

## Decision

兩件事，一起做才有意義。

**一、`b5d7f9a1c3e6` 重新套用所有內建宣告。** 範圍是「宣告」，不是「外觀」：邊的 `description` / `allowed_source` / `allowed_target`（ADR-0078）和節點的 `fields`（ADR-0074） —— 剛好就是 `b2d4f6a8c1e3` 和 `f6b8d0c2e4a3` 各自重套的那些。`label` / `icon` / `color` / `roles` 刻意不動：那些依 ADR-0079 是可編輯的，覆寫它們是把某個人的選擇改掉，不是把一個事實修正。自訂型別在兩個方向都完全不碰。

**二、一個指紋守門測試**（`tests/test_builtin_declarations_reach_existing_databases.py`）。內建宣告的雜湊被釘住；改了宣告，測試就紅，而失敗訊息直接說要做什麼：附一支重套宣告的 revision，然後把指紋和 `LAST_RESYNC_REVISION` 一起更新。第二個測試檢查被指名的那支 revision **真的存在、而且真的重套了每一個宣告欄位** —— 一個指向空殼 revision 的指紋什麼都證明不了。

沒有選擇「在啟動時自動重套」。那會把使用者透過 `/api/graph-types` 對內建型別做的編輯（ADR-0079 允許的）在下次重啟時默默revert掉。要走那條路得先把內建宣告改成唯讀，那是另一個決定，不該夾帶在一支 bugfix 裡。

## Consequences

**得到的：** 正式站不再對 agent 說一句與引擎相反的規則。而且這個類別的疏漏從「靠人記得」變成「不可能默默出貨」—— 忘記附 backfill 的那一刻測試就紅，訊息裡就寫著補救步驟。

**付出的：** 每次改內建宣告都多兩個動作：寫一支 revision、更新指紋。這是刻意的摩擦，因為那正是需要停下來想一秒的地方。指紋是個 ratchet，跟 `check_api_docs.py` 的 `UNDOCUMENTED_BASELINE` 同一個路子。

**沒有解決的：** 內建型別的宣告到底是程式碼的還是使用者的，這個問題還開著。目前的答案是「程式碼的，但我們不強制」—— 使用者仍可透過 API 編輯，而下一支 resync revision 會把它改回去。要收斂的話就是把內建宣告設成唯讀，值得另開一份 ADR。
