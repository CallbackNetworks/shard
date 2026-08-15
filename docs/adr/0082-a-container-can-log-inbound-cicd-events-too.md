# ADR-0082: 容器也能收 CI/CD 回呼，但只記錄不套用

## Status
Accepted

## Date
2026-08-15

## Context

`/webhook/callback/{token}` 一直只認 task 型節點：`_load_task_node`（`routers/nodes.py`）明確把非 task 角色擋在外面，`find_task_by_callback_token`（`graph/tasks.py`）只掃 task 型節點。這是對的起點——一個 build 的成敗本來就該回饋到「這個 build 對應哪個任務」上，ADR-0060 的簽章機制與 ADR-0051 的「無法辨識就不猜」都是繞著這個前提設計的。

但使用者在 Shard 上追蹤的不只是任務，還有 36 個各自獨立的 repo，每個都是一個 project 節點（`agent-context` 已經帶著它們的 `repo_url`）。這些 repo 的 push、CI 執行結果目前完全進不了 Shard——沒有一個「這個 repo 發生了什麼」的地方可以看。task 的 callback 機制解決的是「一個 build 對應一個任務」，但這裡要的是「一個 repo 對應一個 project，任何推送/建置都值得被看見，卻沒有單一任務可以歸屬」。

另外，`cicd_adapters.py` 原本認得 GitHub、GitLab、Bitbucket、Jenkins、Drone,沒有 Gitea 專屬解析——push 事件（沒有 `status` 欄位）掉進 generic parser 後拿不到有意義的訊息，而 Gitea 原生 webhook 送出的 `X-Gitea-Event`/`X-Gitea-Delivery` header 目前完全沒被偵測到。ADR-0010 記錄過這個系統過去踩過的坑:Gitea 的 webhook 同時會帶 `X-GitHub-Event`（相容性 header），過去的 issue-sync 就是靠這個管道走的,`external_provider` 因此被記成 `"github"`。這次新增的 Gitea 偵測放在 GitHub 偵測**之前**，讓原生 `X-Gitea-Event` 優先命中,能給出「3 個 commit 推送到 main」這種可讀訊息,而不是退回泛用解析。

## Decision

**callback 憑證與端點,依角色分兩條路,而不是另開一條路。**

1. `graph.webhookable_type_keys(db)` = `task_type_keys(db) | container_type_keys(db)`,`find_node_by_callback_token` 掃這個聯集,回傳原始 `Node` 而不是 `TaskView`——呼叫端自己決定怎麼分支,不是在找節點的當下就決定了語意。

2. `GET /api/nodes/{id}/webhook`、`POST /api/nodes/{id}/webhook/rotate-secret` 現在接受 container 角色的節點。task 在建立時就由 `_apply_task_data_defaults` 種下 `callback_token`/`webhook_secret`(ADR-0060);container 從來不會,因為建立節點的路徑太多,每一條都要記得種一次不划算——所以憑證**在第一次揭露時延遲產生**,`_webhook_config` 缺哪個補哪個,冪等。

3. `webhook_callback` 收到 payload、驗完簽章、存完 `WebhookEvent`(這一步兩條路共用,build 歷史對 task 和 project 是同一張表、同一支查詢端點)之後,依 `node.type` 分支:
   - **task**:行為不變。`status` 解不出來就只記活動、不碰任務(ADR-0051);解得出來就照舊呼叫 `apply_task_update`。
   - **container**:*永遠*只呼叫 `log_activity`(action `webhook.container_event`,`project_id=node.id`)再 `ws_manager.broadcast("project.webhook_event", ...)`,不存在「套用」這件事——project 沒有 build 結果這種語意,push 事件本來就不帶 status,而 build 事件的 status 描述的是那次建置,不是 project 本身。回應也不再是 `TaskOut`,是剛寫入的 `WebhookEventOut`。

4. `cicd_adapters.py` 加 `parse_gitea`:`X-Gitea-Event`/`X-Gitea-Delivery` 優先於 GitHub 的 body 特徵判斷(兩者都可能有 `workflow_run`)。push 事件組出「N 個 commit 推送到 branch by 人:第一行 commit 訊息」,`status` 保持 `None`(交給既有的 unmapped 路徑處理,不是這次新加的邏輯);`workflow_run`/`workflow_job` 沿用 GitHub 的結論對照表,因為 Gitea Actions 的欄位名稱是照抄 GitHub Actions 的。

沒有做的事:沒有幫這 36 個 repo 在 Gitea 上實際建立 webhook——那是下一步,使用者先要後端功能到位。

## Consequences

- 一個 project 現在可以配置 webhook,推送/CI 事件會出現在它自己的活動紀錄與 build 歷史裡,前端能看到,不用另外開一條資料路徑。
- callback 端點的信任邊界沒有放寬:簽章驗證(`_verify_signature`)邏輯完全沒變,只是不再綁定 `TaskView`,改吃一個 secret 字串——task 和 container 走同一套「沒簽章就 401」。
- `GET /webhook/events/{task_id}`(build 歷史)的守門條件從「是任務」放寬成「能收 webhook」,對舊呼叫端沒有破壞性影響:task id 一樣通過,只是現在 project id 也通過了。
- `_load_task_node` 改名 `_load_webhook_node`,`GET /api/nodes/{id}/webhook` 對純 container 型節點(project)從 400 變 200——這是刻意的行為變更,`test_webhook_signatures.py::TestTheOwnerCanReadTheKey::test_a_container_gets_credentials_lazily` 取代了原本斷言 400 的測試。沒有 container/task 角色的節點(如 identity)仍然 400。
- 新增 `TestContainerCallbacksNeverMutateTheProject`(`test_webhook_signatures.py`)與 `TestParseGitea`/Gitea 偵測案例(`test_cicd_adapters.py`),涵蓋:簽章仍是強制的、push 不動 project 狀態欄、build 事件的結論只留在歷史裡不套用、container 與 task 共用同一支 build history 端點。
- 前端還沒有畫面能開這個面板(下一步要做);憑證與端點先就緒,是為了讓那塊 UI 有東西可以打。
