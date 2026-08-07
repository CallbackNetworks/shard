# Architecture Decision Records

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-ci-cd-tooling.md) | CI/CD Tooling | Accepted | 2026-05-29 |
| [0002](0002-code-quality-tools.md) | Code Quality Tools | Accepted | 2026-05-29 |
| [0003](0003-docker-dev-prod-split.md) | Docker Dev/Prod Split | Accepted | 2026-05-29 |
| [0004](0004-decision-records-as-enhanced-labels.md) | Decision Records as Enhanced Labels | Accepted | 2026-05-29 |
| [0005](0005-mcp-server-http-proxy.md) | MCP Server HTTP Proxy Architecture | Accepted | 2026-05-29 |
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
