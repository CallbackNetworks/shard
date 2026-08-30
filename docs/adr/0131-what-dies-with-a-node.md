# ADR-0131: 刪掉一個節點，屬於它的列也要跟著走

## Status
Accepted

## Date
2026-08-30

## Context

`graph.delete_node` 刪掉節點與所有碰到它的邊，**其他什麼都不做**。唯一知道「還有周邊列
存在」的地方是 `_delete_task_node`，那裡有一份手寫的五張表清單。

所以刪掉一個**容器**，掛在它底下的每一列都留在原地。在乾淨資料庫上實測刪一個 project，
一次擱淺八種列：

```
LEFTOVER ROWS AFTER PROJECT DELETE:
{'comment(guest note)': 1, 'saved_filter': 1, 'task_template': 1,
 'notification(project)': 1, 'notification(task)': 1, 'integration': 1,
 'share_chat_log': 1, 'workflow_rule': 1}
```

沒有一項會發出聲音。通知會以一則「連過去是 404」的鈴鐺留著；任務範本的清單預設不分專案，
所以孤兒範本就是永遠在那裡。這是這個 codebase 反覆抓到的同一種缺陷 —— 一條規則只住在
一隻手寫的地方，等到介面通用化了，它沒有跟著通用化。

參照完整性的故事本身也是同一個形狀的不一致：指向**任務**的欄位
（`comments.task_id`、`attachments.task_id`…）帶著真的 `ForeignKey(ondelete="CASCADE")`，
指向**容器**的欄位（`integrations.project_id`、`saved_filters.project_id`…）是裸的
`String(36)`，連約束都沒有。而 SQLite 不開 `PRAGMA foreign_keys=ON` 連前者也不執行 ——
兩半其實都沒有被強制過，這正是 `_delete_task_node` 當年選擇手寫清理的理由。

## Decision

**清單搬進 `services/node_teardown.py`，在 `delete_node` 裡執行。** 一份清單，一個執行點，
所以每個型別都拿得到 —— 而不是只有那個剛好有人手寫過的型別。`_delete_task_node` 只剩下
型別檢查（它從子樹走訪被叫到，不是任務的節點不能當任務拆）。

**分的是「屬於」與「歷史」，不是「有沒有提到這個節點」。**
`activity_logs` 與 `graph_events` 也存著節點 id，而且**刻意不在清單裡**：它們記的是
「發生過什麼事」，[ADR-0073](0073-a-project-is-shared-like-everything-else.md) 已經定過調
—— 退掉一個主體不該退掉它的歷史。`api_keys.container_id` 不在清單裡是另一個理由：
金鑰不是周邊列，而且一把容器已刪的金鑰是 fail closed 的（`_container_ids_for` 匹配不到），
安全的結果本來就是預設值；把使用者的金鑰當成刪專案的副作用一起刪掉，才是這筆交易裡意外的
那一半。

兩個順序是有意義的：**檔案先於列**（附件那一列是「blob 在哪」的唯一紀錄，先刪列就是漏一個
沒有人指得到的檔案），**deliveries 跟著它的 integration 走**（投遞紀錄帶著那個 integration
自己的 request headers，[ADR-0085](0085-a-capability-is-not-browser-only.md) 已經認定那是憑證
的第二條出路）。

`tests/test_delete_semantics.py::TestNothingIsLeftBehindByADelete` 用**列舉整張表清單**
的方式斷言，而不是抽查一張：這個缺陷從來不是「漏了某一張表」，是**根本沒有清單**。配套的
第二個測試斷言歷史還在。

## Consequences

- 刪一個容器會真的刪掉它的 guest notes、儲存的篩選、任務範本、通知、outbound integration
  （連同投遞紀錄）、分享頁問答紀錄、工作流規則，以及註冊在它上面的活動曲線。這些以前留著，
  但沒有任何介面找得回它們 —— 除了會冒出來的那幾個（鈴鐺、全域範本清單）。
- 附件的實體檔案現在會一起清掉。以前連任務刪除都只刪列不刪檔。
- 刪除比以前多跑十來個 DELETE。刪一棵大樹時每個節點各跑一輪，數量級跟原本的
  `_delete_task_node` 相同，沒有變成別的東西。
- 舊資料庫裡既有的孤兒列不會被這次變更清掉 —— 它只約束從此之後的刪除。要清歷史孤兒得另外
  寫一次掃描，而那需要先確認哪些 `project_id` 是真的死了、哪些只是「null = 全域」。

### 同一批清掉的：一個沒有人寫過的欄位

`assistant_messages.tool_call_id` 宣告在 `tool_calls` 旁邊，**沒有任何程式碼寫過它、
讀過它，也沒有任何回應模型帶著它**。助理只會存 `user` 與 `assistant` 兩種 role，
這個欄位為之設計的 `tool` role 這個系統不會產生 —— 工具結果是折進助理那一輪的
`tool_calls` 清單裡的。

和 ADR-0127 之前的 `edge_types.is_symmetric` 同一類：長得像欄位的註解。差別是那一個至少
描述了一個後來真的被實作的意圖，這一個描述的是一種這個助理沒有的訊息形狀，所以它走，
不是等（遷移 `e9b1c3d5f7a2`）。那個遷移的 drop 帶條件判斷：模型已經不再宣告這個欄位，而
FRESH 資料庫是 `create_all()` 之後 stamp head（[ADR-0064](0064-the-schema-upgrade-needs-a-home.md)），
所以這條 revision 只會被重播在「可能有、也可能沒有」這個欄位的 schema 上。
