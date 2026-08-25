# Architecture Decision Records

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-ci-cd-tooling.md) | CI/CD Tooling | Accepted | 2026-05-29 |
| [0002](0002-code-quality-tools.md) | Code Quality Tools | Accepted | 2026-05-29 |
| [0003](0003-docker-dev-prod-split.md) | Docker Dev/Prod Split | Superseded by ADR-0108 | 2026-05-29 |
| [0004](0004-decision-records-as-enhanced-labels.md) | Decision Records as Enhanced Labels | Accepted | 2026-05-29 |
| [0005](0005-mcp-server-http-proxy.md) | MCP Server HTTP Proxy Architecture | Superseded by ADR-0080 | 2026-05-29 |
| [0006](0006-cicd-adapter-architecture.md) | CI/CD Adapter Architecture for Multi-Platform Webhook Support | Accepted | 2026-05-30 |
| [0007](0007-multi-database-support.md) | Multi-Database Support (SQLite / PostgreSQL / MySQL) | Accepted | 2026-06-05 |
| [0008](0008-automated-docker-deployment.md) | Automated Docker Deployment via CD Pipeline | Accepted | 2026-06-19 |
| [0009](0009-agent-integration-architecture.md) | Agent Integration Architecture | Accepted | 2026-07-04 |
| [0010](0010-gitea-github-compatible-api-base.md) | Gitea Support via GitHub-Compatible API Base Resolution | Accepted | 2026-07-05 |
| [0011](0011-runtime-adjustable-system-settings.md) | Runtime-Adjustable System Settings | Accepted | 2026-07-05 |
| [0012](0012-frontend-styling-strategy.md) | Frontend Styling Strategy — CSS Modules over Inline Styles | Accepted | 2026-07-06 |
| [0013](0013-full-data-backup-strategy.md) | Full-Data Backup Strategy | Accepted | 2026-07-06 |
| [0014](0014-bidirectional-issue-sync.md) | Bidirectional Issue Sync for Comments, Labels, and State | Accepted | 2026-07-09 |
| [0015](0015-outbound-field-sync-last-write-wins.md) | Outbound Field Sync with Last-Write-Wins Semantics | Accepted | 2026-07-09 |
| [0016](0016-guest-notes-on-share-pages.md) | Guest Notes on Public Share Pages | Accepted | 2026-07-10 |
| [0017](0017-pr-signal-sync-content-stays-external.md) | PR Signal Sync — Signals In, Content Stays External | Accepted | 2026-07-10 |
| [0018](0018-postgres-parity-and-fresh-db-bootstrap.md) | PostgreSQL Behavior Parity and Fresh-Database Alembic Bootstrap | Accepted | 2026-07-10 |
| [0019](0019-scheduler-long-run-resilience.md) | Scheduler Long-Run Resilience — Check Isolation, Persistent Dedup, Heartbeat, Fake-Clock Tests | Accepted | 2026-07-10 |
| [0020](0020-databases-as-coequal-test-targets.md) | SQLite and PostgreSQL as Co-Equal Test Targets | Accepted | 2026-07-11 |
| [0021](0021-token-protected-ical-feed.md) | Token-Protected iCal Feed via Reused Project Share Token | Superseded by ADR-0022 | 2026-07-11 |
| [0022](0022-independent-ical-token.md) | Independent iCal Token Separate from Share Token | Superseded by ADR-0023 | 2026-07-11 |
| [0023](0023-scoped-ical-feeds-global-identity-project.md) | Scoped iCal Feeds — Global (Personal), Identity, and Project | Accepted | 2026-07-11 |
| [0024](0024-backup-restore-endpoint.md) | Backup Restore Endpoint | Accepted | 2026-07-11 |
| [0025](0025-project-share-expiry-and-audit.md) | Project Share-Link Expiry and Access Audit | Accepted | 2026-07-11 |
| [0026](0026-create-external-issue-from-task.md) | Create External Issue from a Shard Task | Accepted | 2026-07-11 |
| [0027](0027-due-date-sync-gitea-gitlab.md) | Due-Date Sync for Gitea and GitLab | Accepted | 2026-07-11 |
| [0028](0028-estimate-calibration-suggestion.md) | Estimate Calibration Suggestion | Accepted | 2026-07-11 |
| [0029](0029-milestone-cycle-sync.md) | Milestone ↔ Cycle Sync | Accepted | 2026-07-11 |
| [0030](0030-app-auth-hardening-and-forward-auth.md) | Application Auth Hardening and Forward-Auth Delegation | Accepted | 2026-07-14 |
| [0031](0031-kinetic-typography-system.md) | Kinetic Typography System and Runtime-Switchable Display Font | Accepted | 2026-07-14 |
| [0032](0032-unified-node-edge-graph-model.md) | Unified Node/Edge Graph Model over Fixed Container Relations | Accepted | 2026-07-15 |
| [0033](0033-graph-foundation-final-shape.md) | Graph Foundation Final Shape — Data-Driven Type/Edge Vocabularies, Audit Provenance, Node-Only Endgame | Accepted | 2026-07-16 |
| [0034](0034-user-defined-containers-and-compat-project-fields.md) | User-Defined Containers and Compat Project Fields — Literal-Project project_ids plus Generic container_ids | Accepted | 2026-07-17 |
| [0035](0035-user-defined-task-like-types.md) | User-Defined Task-Like Types as First-Class Tasks | Accepted | 2026-07-17 |
| [0036](0036-internal-api-under-api-prefix.md) | Internal API under an /api Prefix — Eliminate Frontend/Backend Path Collisions | Accepted | 2026-07-18 |
| [0037](0037-graph-native-frontend.md) | Graph-Native Frontend — Universal Node Page and Container Views | Accepted | 2026-07-18 |
| [0038](0038-unified-task-mutation-pipeline.md) | Unified Task Mutation Pipeline — Single Post-Mutation Sequence Service | Accepted | 2026-07-19 |
| [0039](0039-cross-cutting-capabilities-as-node-type-flags.md) | Cross-cutting Capabilities as Node-Type Flags — De-privileging Built-in Identity | Accepted | 2026-07-20 |
| [0040](0040-single-graph-write-surface-and-node-roles.md) | Single Graph Write Surface and Node Capabilities as a Roles Set | Accepted | 2026-07-22 |
| [0041](0041-goal-as-container-and-remaining-write-surface-collapse.md) | Goal as a Container Role, Identity Write Collapse, Decision Stays an Enhanced Label | Accepted | 2026-07-23 |
| [0042](0042-external-api-graph-native-write-surface.md) | External API v1 Collapses to the Graph-Native Write Surface | Accepted | 2026-07-26 |
| [0043](0043-collapse-container-scoped-writes-to-nodes.md) | Internal project/label/cycle Writes Collapse to /api/nodes (container-delete cascade role) | Accepted | 2026-07-26 |
| [0044](0044-close-the-task-pipeline-bypasses.md) | 關閉 Task Pipeline 的旁路，並以 guard test 固定此不變式 | Accepted | 2026-07-26 |
| [0045](0045-edge-dispatch-and-relationship-write-collapse.md) | 關係寫入收斂到 edge dispatcher，並讓 `task.label_added` 真正生效 | Accepted | 2026-07-26 |
| [0046](0046-validate-workflow-rule-vocabulary.md) | 工作流程規則的詞彙在寫入時驗證，標籤動作接受名稱 | Accepted | 2026-07-28 |
| [0047](0047-notification-events-single-list.md) | 通知事件收斂成單一清單，並讓每個事件真的送得出去 | Accepted | 2026-07-28 |
| [0048](0048-rule-actions-through-the-pipeline-and-event-subscription.md) | 規則的動作走同一條寫入管線，通知來源成為可訂閱的設定 | Accepted | 2026-07-30 |
| [0049](0049-rules-trigger-on-nodes-not-tasks.md) | 規則的觸發從 task 收斂到 node | Accepted | 2026-07-30 |
| [0050](0050-every-skipped-rule-action-is-visible.md) | 規則動作跳過時一律留下原因 | Accepted | 2026-07-30 |
| [0051](0051-webhooks-never-invent-an-outcome.md) | Webhook 兩端都不再自己編造結果 | Accepted | 2026-07-31 |
| [0052](0052-recorded-is-not-visible.md) | 記錄下來不等於看得見 | Accepted | 2026-08-01 |
| [0053](0053-an-execution-record-says-what-it-set-off.md) | 執行紀錄要說出它觸發了什麼 | Accepted | 2026-08-01 |
| [0054](0054-one-prediction-shared-by-three-surfaces.md) | 預演與執行共用同一個判斷 | Accepted | 2026-08-01 |
| [0055](0055-rules-trigger-on-graph-change-not-only-creation.md) | 規則觸發於整張圖的變更，而不只是建立 | Accepted | 2026-08-01 |
| [0056](0056-every-value-box-knows-what-belongs-in-it.md) | 每一個數值欄位都知道自己該裝什麼 | Accepted | 2026-08-01 |
| [0057](0057-pin-what-a-fresh-build-installs.md) | 上線前的重建：升掉 React Router 的警報，並釘死一份重建就會變的相依 | Accepted | 2026-08-01 |
| [0058](0058-engine-names-and-user-names.md) | 引擎取的名字唸成人話，使用者取的名字原字照搬 | Accepted | 2026-08-01 |
| [0059](0059-credentials-do-not-leave-the-server.md) | 憑證不離開伺服器，以及沒有人在聽的即時事件 | Accepted | 2026-08-05 |
| [0060](0060-a-callback-is-signed-or-it-is-not-accepted.md) | 回呼有簽章，否則不算數 | Accepted | 2026-08-05 |
| [0061](0061-a-page-route-is-not-a-backend-path.md) | 頁面路由不是後端路徑 | Accepted | 2026-08-06 |
| [0062](0062-offline-writes-are-queued-where-every-write-passes.md) | 離線的寫入排在每一筆寫入都會經過的地方 | Accepted | 2026-08-06 |
| [0063](0063-an-integrations-configuration-is-credentials.md) | 整合設定裡裝的就是憑證 | Accepted | 2026-08-06 |
| [0064](0064-the-schema-upgrade-needs-a-home.md) | 升級 schema 這件事需要一個歸屬 | Accepted | 2026-08-06 |
| [0065](0065-a-containers-numbers-count-its-whole-subtree.md) | 容器的數字要算到它底下的每一層 | Accepted | 2026-08-07 |
| [0066](0066-one-control-with-n-values-is-not-n-nav-entries.md) | 一個控制項的 N 個值，不是 N 個導航入口 | Accepted | 2026-08-07 |
| [0067](0067-fast-switching-does-not-need-permanent-screen-space.md) | 快速切換不需要永久佔著畫面 | Accepted | 2026-08-07 |
| [0068](0068-a-project-has-one-size.md) | 一個專案的大小只有一個答案 | Accepted | 2026-08-07 |
| [0069](0069-the-map-draws-the-level-the-user-inserted.md) | 結構圖畫出使用者插進去的那一層 | Accepted | 2026-08-07 |
| [0070](0070-one-share-panel-for-every-shareable-node.md) | 分享面板只有一個實作 | Accepted | 2026-08-07 |
| [0071](0071-one-public-door-and-it-cannot-be-the-page-itself.md) | 只留一扇公開的門，而那扇門不能是頁面本身 | Accepted | 2026-08-07 |
| [0072](0072-a-lock-that-can-be-set-is-a-lock-that-is-enforced.md) | 設得上去的鎖，就必須是會擋人的鎖 | Accepted | 2026-08-07 |
| [0073](0073-a-project-is-shared-like-everything-else.md) | 專案跟其他東西用同一套分享 | Accepted | 2026-08-07 |
| [0074](0074-a-type-declares-which-fields-are-the-users.md) | 型別自己宣告哪些欄位是使用者的 | Accepted | 2026-08-07 |
| [0075](0075-a-container-status-has-one-rule.md) | 容器的狀態只有一套規則 | Accepted | 2026-08-14 |
| [0076](0076-remote-mcp-through-the-existing-door.md) | 遠端 MCP 走既有那扇門，而且那扇門一定上鎖 | Superseded by ADR-0080 | 2026-08-14 |
| [0077](0077-the-tool-list-is-the-code.md) | 工具清單就是程式碼本身 | Accepted | 2026-08-14 |
| [0078](0078-a-relation-declares-what-may-sit-at-each-end.md) | 關係自己宣告兩端可以接什麼 | Accepted | 2026-08-14 |
| [0079](0079-a-layer-can-be-created-through-the-api.md) | 新增一個層級，不能只有 UI 做得到 | Accepted | 2026-08-15 |
| [0080](0080-a-protocol-adapter-lives-in-the-process-it-wraps.md) | 協定外皮住在它包裝的那個行程裡 | Accepted | 2026-08-15 |
| [0081](0081-focus-follows-ownership-and-containment.md) | 聚焦沿著擁有和包含關係走，不是寫死在身分上 | Accepted | 2026-08-15 |
| [0082](0082-a-container-can-log-inbound-cicd-events-too.md) | 容器也能收 CI/CD 回呼，但只記錄不套用 | Accepted | 2026-08-15 |
| [0083](0083-a-filter-narrows-the-work-not-the-view.md) | 篩選縮小的是工作，不是某一個檢視 | Accepted | 2026-08-15 |
| [0084](0084-configuring-ci-is-not-a-browser-only-act.md) | 設定 CI/CD 不能只有瀏覽器做得到 | Accepted | 2026-08-16 |
| [0085](0085-a-capability-is-not-browser-only.md) | 一個能力不能只有瀏覽器做得到 | Accepted | 2026-08-16 |
| [0086](0086-a-field-you-can-read-is-a-field-you-can-write.md) | 讀得到的東西就要寫得了 | Accepted | 2026-08-16 |
| [0087](0087-the-last-duplicate-share-implementation.md) | 最後一份重複的分享實作 | Accepted | 2026-08-16 |
| [0088](0088-a-colour-means-one-thing.md) | 一個顏色只能代表一件事 | Accepted | 2026-08-16 |
| [0089](0089-one-assistant-one-definition-of-overdue.md) | 一個助理，一個「逾期」的定義 | Accepted | 2026-08-16 |
| [0090](0090-a-task-like-type-is-a-task-everywhere.md) | 宣告了 task 角色，就在每一個地方都是任務 | Accepted | 2026-08-16 |
| [0091](0091-configuring-the-instance-is-not-a-browser-only-act.md) | 設定這台實例本身，也不能只有瀏覽器做得到 | Accepted | 2026-08-16 |
| [0092](0092-work-gets-in-and-out-through-both-doors.md) | 工作進得來、出得去、歸得了檔，兩道門都要能做 | Accepted | 2026-08-16 |
| [0093](0093-the-mcp-registry-catches-up-with-the-api.md) | MCP 註冊表要跟得上 API | Accepted | 2026-08-16 |
| [0094](0094-a-node-says-where-it-lives.md) | 每個節點都說得出自己住在哪 | Accepted | 2026-08-17 |
| [0095](0095-an-identity-is-a-place-work-lives.md) | 身分也是一個「工作住的地方」 | Accepted | 2026-08-17 |
| [0096](0096-the-assistants-provider-is-a-runtime-setting.md) | 助理要打哪個 provider 是一個執行期設定，不是一個部署決策 | Accepted | 2026-08-17 |
| [0097](0097-provider-is-a-protocol-base-url-is-the-vendor.md) | provider 選的是協定，vendor 是 base_url 決定的 | Accepted | 2026-08-17 |
| [0098](0098-the-public-assistant-only-knows-what-the-page-shows.md) | 公開的問答助理只能知道分享頁本來就顯示的東西 | Accepted | 2026-08-18 |
| [0099](0099-a-share-chat-log-gets-its-own-agent-door.md) | share-chat-log 也要有 v1/MCP 的門 | Accepted | 2026-08-18 |
| [0100](0100-token-counts-not-cost.md) | 記錄 token 用量，不記錄花費 | Accepted | 2026-08-18 |
| [0101](0101-one-worker-not-a-persisted-rate-limiter.md) | 少開一個 worker，而不是把限流做成永久的 | Accepted | 2026-08-18 |
| [0102](0102-the-internal-assistant-catches-up-to-mcp-on-its-own-domain.md) | 內部助理補齊跟 MCP 同一個範圍的落差，不多不少 | Accepted | 2026-08-18 |
| [0103](0103-openai-is-a-real-dependency-and-get-provider-cannot-crash.md) | openai 變成真的依賴，而且 get_provider 不能讓請求整個炸掉 | Accepted | 2026-08-18 |
| [0104](0104-a-tool-call-needs-a-second-round-trip.md) | 工具叫完了，還要再打一次才輪得到文字回答 | Accepted | 2026-08-19 |
| [0105](0105-user-registered-activity-watch-curves.md) | 活動跑馬燈下面的曲線可以自己註冊 | Accepted | 2026-08-19 |
| [0106](0106-one-event-catalog-for-triggers-and-notifications.md) | 規則的觸發條件跟通知事件合成同一份清單 | Accepted | 2026-08-20 |
| [0107](0107-api-key-scope-is-a-container-not-a-project.md) | API 金鑰的範圍是一個 container，不只是一個 project | Accepted | 2026-08-21 |
| [0108](0108-the-production-compose-is-generated-not-overridden.md) | 正式環境的 compose 是生成的，不是覆蓋出來的 | Accepted | 2026-08-22 |
| [0109](0109-one-answer-to-who-is-calling.md) | 「誰在呼叫」只有一個答案，而信任多深是部署知識 | Accepted | 2026-08-22 |
| [0110](0110-replay-protection-the-sender-does-not-opt-into.md) | 重播防護不能由寄件方決定要不要開 | Accepted | 2026-08-24 |
| [0111](0111-the-runner-shares-a-host-so-ci-declares-its-limits.md) | Runner 跟別人共用主機，所以 CI 要自己宣告上限 | Accepted | 2026-08-24 |
| [0112](0112-the-build-is-reproducible-and-does-not-run-as-root.md) | 建置要可重現，而且不以 root 執行 | Accepted | 2026-08-25 |
