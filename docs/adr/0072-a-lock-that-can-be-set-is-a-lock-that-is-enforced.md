# ADR-0072: 設得上去的鎖，就必須是會擋人的鎖

## Status
Accepted

## Date
2026-08-07

## Context

ADR-0071 收尾時順手記下一個沒修的既有問題：**專案的分享頁不檢查 PIN，但 `/api/nodes/{id}/share/set-pin` 允許為專案設定 PIN。**

專案是 shareable 角色的節點，所以泛用的分享端點（內部 `/api/nodes/{id}/share/set-pin`、外部 `/api/v1` 的對應端點）從來都接受它，`hash_pin()` 也確實把 hash 寫進了 `node.data`。但 `ProjectView` 這個 dataclass **根本沒有 `share_pin_hash` 欄位**——`IdentityView` 有，專案沒有。所以 hash 寫得進去、讀不出來，`get_share_project()` 沒有東西可檢查，分享頁一路放行。

這比「沒有鎖」更糟：擁有者做了一個明確的保護動作，收到 `{"ok": true}`，然後相信那個連結被保護了。ADR-0060 記過同一句話的另一半——「一把需要人主動打開的鎖，就是一把沒有人打開的鎖」；這次是**一把裝上去但沒接線的鎖**。

同一次檢查還發現：專案頁的「Share Link Settings」面板只有到期日和瀏覽數，**沒有任何 PIN 控制**。所以就算把後端接上，擁有者也只能透過 API 設、透過 API 清。

## Decision

**讓鎖真的擋人。** `ProjectView` 補上 `share_pin_hash`（與 `IdentityView` 對齊，且 `_project_view` 是唯一的建構點），`get_share_project()` 像其他每一種 shareable 節點一樣，在沒有有效 session cookie 時回 `requires_pin`；`_resolve_note_target` 的專案分支改傳真正的 pin hash，**留言的門跟著頁面的門走，不能成為繞過它的路**。解鎖走已經統一的 `/share/node/{token}/verify`（ADR-0071），它依型別分派，專案和身分走同一扇門。

**擁有者要看得到、也解得開。** `ProjectOut` 增加 `share_pin_set`（布林，永遠不送 hash，遵循 ADR-0059 與 `node_data.NEVER_SERVED` 的既有規則），專案頁的分享面板加上設定／移除 PIN 的控制，直接呼叫既有的 `setNodeSharePin` / `clearNodeSharePin`——**這不是把 `ProjectDetail` 併進 `NodeShareFacet`**（那是還沒做的決定），只是把缺的那一格接上既有的泛用端點。

`SharePinGate` 的 scope→路徑對照表一併刪掉：只有一個 verify 網址，不需要一張會靜默 fallback 的表。

## Consequences

- **任何已經被設過 PIN 的專案分享頁，從現在起會要求 PIN。** 這正是擁有者當初要求的行為，但對「以為沒設定成功、就當作沒設」的人是行為改變。開發資料庫實測目前沒有專案帶 PIN；正式環境若有，該連結會開始擋人。
- 專案分享頁現在有 PIN 閘門，瀏覽器實測：鎖住時只顯示專案名稱、`leaksTasks` 為 false，輸入正確 PIN 後解鎖並顯示完整頁面。
- 順帶修掉一個**被這個功能照出來的既有 UI 缺陷**：專案頁那顆分享設定按鈕在「已保護／已設到期」狀態下，標籤是看不見的。`global.css`（ADR-0031）有一條 `button[style*="#facc15"] { color: var(--kt-bg) !important }`，它假設 inline style 提到 `#facc15` 的按鈕都是**黃底**按鈕，於是把文字壓成背景色；這顆按鈕是拿 `#facc15` 當**文字**色。計算後的顏色是 `rgb(23,23,23)`，深底上的近黑字。改成 CSS Module 的 `.archiveBtnActive` class（CLAUDE.md 本來就要求把靜態 inline 樣式搬進 module），屬性選擇器就不再命中。**一條靠 inline style 字串比對的全域規則，會在它猜錯用途時無聲地毀掉元件。**
- 測試：`test_project_share_pin_is_enforced` 走完設定→兩扇門都鎖→擁有者讀到 `share_pin_set` 但沒有 hash→錯誤 PIN 403→正確 PIN 解鎖→cookie 開頁→清除；`test_pinned_project_note_requires_session` 釘住留言的門。**負向驗證做過**：把 `get_share_project` 的閘門拿掉，前者確實變紅。
- 仍未做：`ProjectDetail` 併入 `NodeShareFacet`。它現在多了一格 PIN，離共用面板更近了，但公開網址 `/share/p/` 的存廢仍是獨立決定。
