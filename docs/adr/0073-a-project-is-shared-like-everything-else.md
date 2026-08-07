# ADR-0073: 專案跟其他東西用同一套分享

## Status
Accepted

## Date
2026-08-07

## Context

ADR-0070 到 0072 一路收攏，每一份都在結尾記下同一件未完的事：**`ProjectDetail` 是這條線上最後一份自己幹自己的分享實作。**

盤點它到底自己幹了什麼：

- 標題列四顆按鈕——複製 `/ical/project/{token}.ics`、複製 `/share/p/{token}`、切換訪客留言（走 `updateProject`）、開關分享設定面板。
- 一個私有的 `ShareSettingsPanel`（到期日 + 瀏覽數，ADR-0072 又補了 PIN）。
- 一組專案專用的後端端點：`/api/projects/{id}/set-expiry`、`/api/projects/{id}/share-views`。
- 一組專案專用的公開路徑：`/share/p/{token}` 頁面、`GET /share/project/{token}` 資料、notes 的 `project` scope、`/ical/project/{token}.ics`。

而 `NodeShareFacet` 早就把這些全部做完了，身分和自訂容器都在用。留著兩份的代價 ADR-0070 已經量過一次：**不是壞掉，是漂移**——同一件事兩份實作，然後各自長出對方沒有的東西。ADR-0072 就是這個代價的實例：專案面板缺了 PIN 控制，而缺的原因純粹是它沒有跟著共用面板一起長。

同時 `/share/{scope}/...` 這個 scope 參數也只剩下兩個值，其中一個馬上要退場。一個只有一個合法值的參數不是參數。

## Decision

**專案用共用面板。** `ProjectDetail` 的四顆按鈕收成一顆 `Share`，面板換成 `NodeShareFacet`（`invalidateKeys={[['project', id]]}`）。刪掉 `ShareSettingsPanel` 及其 CSS module，連同 `copiedIcal` / `copiedShare` / `expiryInput` / `shareViews` 四個 state、`guestNotesMut` / `setExpiryMut` / `setPinMut` / `clearPinMut` 四個 mutation 和 `openShareSettings`。

**專案形狀的端點一起退場：**

- 公開：`/share/p/{token}` 頁面路由、`GET /share/project/{token}`、`/ical/project/{token}.ics`、notes 的 `project` scope。
- 內部：`/api/projects/{id}/set-expiry`、`/api/projects/{id}/share-views`，以及 ADR-0070 之後就沒有呼叫者的 `/api/identities/{id}/share-views`。

`get_share_project()` 和 `get_share_identity()` 一樣留著當函式——專案頁面的序列化確實是它自己的形狀，只是不再有自己的門。

**scope 參數消失。** notes 從 `/share/{scope}/{token}/notes` 變成 `/share/node/{token}/notes`，`_resolve_note_target(token, ...)` 不再收 scope，`ShareView` / `SharePinGate` / `ShareProjectCard` / `GuestNotes` / `getShareData` 全部不再傳。少一個永遠只有一個值的參數。

留言的 `project_id` 改成**由範圍大小決定**：範圍裡只有一個專案（專案自己的頁、容器的頁）就不需要指定，身分聚合多個才需要。原本這是 `if scope == "project"` 的分支，scope 沒了之後，判斷條件換成它本來就該問的問題。

## Consequences

- **既有的專案分享連結與行事曆訂閱失效**（`/share/p/`、`/ical/project/` 皆 404），與 ADR-0071 對身分做的相同。token 不變，從面板複製新連結即可。
- 專案頁標題列從七顆按鈕降到四顆，`ProjectDetail.jsx` 少 60 行，前端少一個元件加一個 CSS module。
- 分享這件事現在**只有一套實作**：一個面板（`NodeShareFacet`）、一個公開頁（`/share/n/{token}`）、一個資料端點（`/share/node/{token}`，依型別分派）、一個行事曆（`/ical/node/{token}.ics`）、一組寫入端點（`/api/nodes/{id}/share/*`）、一個瀏覽計數（`services.activity.share_view_count`）。ADR-0070 開的頭到此結束。
- 瀏覽計數的多鍵比對（`identity_id` / `project_id` / `node_id`）**更重要了**，因為現在只剩 `node_id` 會被寫入，而歷史資料是用另外兩個鍵寫的。`test_view_count_has_one_answer_per_node` 明確插入一筆舊格式的 `share.viewed` 並斷言它仍被算到——**退場的是路由，不是歷史**。
- `/api/v1` 外部 API 不受影響：它從來沒有暴露過這些專案形狀的分享端點。
- ADR-0072 剛加的 `ShareSettingsPanel` PIN 控制活了不到一天就被刪除——但它不是白做的：它讓那個面板短暫地跟共用面板功能對等，才使得這次替換是純粹的刪除，而不是一次會掉功能的搬遷。
