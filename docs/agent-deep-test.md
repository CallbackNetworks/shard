# Agent Deep Functional Test

Service: `http://localhost:8000`

Summary: **26 passed**, **8 failed**, **34 total**.

All API calls were made with `curl -s -H "X-API-Key: ..."`; mutating cleanup was attempted for created attachment/task data.

| # | Module | Request / Check | HTTP status | Result | Evidence |
|---:|---|---|---:|:---:|---|
| 1 | Decisions | `GET /decisions` | 200 | **PASS** | 16 decisions; all type=decision: True |
| 2 | Decisions | `GET /decisions/3e73cc2b-2e4f-4e8e-ab3b-1ab2aa0fcbaa` | 200 | **PASS** | Fields present: ['id', 'project_id', 'name', 'type', 'description', 'decision_status', 'created_at']; status=proposed |
| 3 | Decisions | `GET /decisions/3e73cc2b-2e4f-4e8e-ab3b-1ab2aa0fcbaa/export` | 200 | **PASS** | Markdown starts '# ADR-010: Streaming writes for large backfills\n\n## Status\nProposed\n\n## Date\n202'; contains status heading and title: True |
| 4 | Decisions | `GET /decisions?status=accepted` | 200 | **PASS** | 13 returned; mismatches=[] |
| 5 | Decisions | `GET /decisions?status=proposed` | 200 | **PASS** | 2 returned; mismatches=[] |
| 6 | Decisions | `GET /decisions?project_id=a1dd6cd3-a25e-4ebc-ad21-98988f07c486` | 200 | **PASS** | 2 returned for project |
| 7 | Attachments | `GET /projects/{pid}/tasks and find task with attachments` | 200 | **PASS** | Found task 4456e495-1720-4a84-96c7-06ddbd7710c4 with 1 attachment(s) |
| 8 | Attachments | `GET /projects/245a67b7-745c-4c81-975d-ae9fa87c5aae/tasks/4456e495-1720-4a84-96c7-06ddbd7710c4/attachments` | 200 | **PASS** | 1 attachments; target id listed: True |
| 9 | Attachments | `GET /projects/245a67b7-745c-4c81-975d-ae9fa87c5aae/tasks/4456e495-1720-4a84-96c7-06ddbd7710c4/attachments/232f77c3-16ac-4af3-8647-ad500cece2cd/download` | 200 | **PASS** | Downloaded 95 bytes; filename=logging_architecture.svg |
| 10 | Attachments | `POST /projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks/c1c9e509-084f-4264-989f-7a3d58639df5/attachments -F file=@-` | 201 | **PASS** | Uploaded id=906e2084-341a-4f02-9780-eda498dbebaa; size=41 |
| 11 | Attachments | `DELETE /projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks/c1c9e509-084f-4264-989f-7a3d58639df5/attachments/906e2084-341a-4f02-9780-eda498dbebaa` | 204 (verify 404) | **PASS** | Delete returned 204 and subsequent download returned 404 |
| 12 | iCal | `GET /ical/a57cae9c-164b-4152-a29b-ce04004f481d.ics` | 200 | **PASS** | Project=Legacy API Deprecation; first line=BEGIN:VCALENDAR |
| 13 | iCal | `Validate iCalendar structure` | 200 | **PASS** | BEGIN:VEVENT count=4 |
| 14 | iCal | `Check task titles appear as SUMMARY` | 200 | **PASS** | 4/4 due task titles found as SUMMARY |
| 15 | Webhook Deliveries | `GET /integrations` | 200 | **PASS** | 8 integrations returned |
| 16 | Webhook Deliveries | `POST /integrations/496769ab-6aac-4d27-b420-aa8043e2230f/test` | 200 | **FAIL** | Endpoint responded, but the test delivery did not succeed: {'success': False, 'error': "Request URL is missing an 'http://' or 'https://' protocol."} |
| 17 | Webhook Deliveries | `GET /deliveries` | 200 | **FAIL** | 0 deliveries returned; note `/integrations/{id}/test` does not log deliveries in current implementation |
| 18 | Webhook Deliveries | `GET /integrations/496769ab-6aac-4d27-b420-aa8043e2230f/health` | 200 | **PASS** | Health stats object returned: total_deliveries=0, successes=0, failures=0, dead=0, success_rate=0.0 |
| 19 | Webhook Deliveries | `GET /deliveries/{id}` | N/A | **FAIL** | No delivery exists to fetch |
| 20 | Subtasks | `Find task with subtasks via parent_id children` | 200 | **PASS** | Parent=822bdbe6-9a7d-4a78-861d-1640d88050d1; child count found=4 |
| 21 | Subtasks | `Verify subtask_count on parent task response` | 200 | **PASS** | `GET /projects/{pid}` parent response reports subtask_count=4; actual children=4. Note: `GET /projects/{pid}/tasks` returned subtask_count=0 for the same parent. |
| 22 | Subtasks | `Verify subtasks array present and populated` | 200 | **FAIL** | Parent task keys include subtasks: False; value length=n/a |
| 23 | Workflow Rules | `GET /workflow-rules` | 200 | **PASS** | 5 rules returned |
| 24 | Workflow Rules | `POST /workflow-rules/5628e3a0-8714-430c-a31a-a593dcf77d5b/test with task_data body` | 422 | **FAIL** | Response={'detail': [{'type': 'missing', 'loc': ['query', 'task_id'], 'msg': 'Field required', 'input': None}]} |
| 25 | Workflow Rules | `Verify workflow-rule test result makes sense` | 422 | **FAIL** | Requested body-only dry run failed; implementation requires task_id query parameter and ignores task_data body |
| 26 | Templates | `GET /templates` | 200 | **PASS** | 5 templates returned |
| 27 | Templates | `Verify template tasks are included` | 200 | **PASS** | All templates include subtasks field: True; templates with non-empty subtasks=0 |
| 28 | Goals | `GET /goals` | 200 | **PASS** | 11 goals returned |
| 29 | Goals | `PATCH /goals/c108b7bc-d57f-42a4-8ac7-60b7785a9ae6 current_value=75` | 200 | **FAIL** | Response keys=['id', 'title', 'description', 'status', 'target_date', 'created_at', 'updated_at', 'projects', 'progress']; current_value=None |
| 30 | Goals | `GET /goals/c108b7bc-d57f-42a4-8ac7-60b7785a9ae6 verify current_value persisted` | 200 | **FAIL** | current_value=None; schema exposes progress=0.0 |
| 31 | MCP-style /api/v1 | `GET /api/v1/summary` | 200 | **PASS** | keys=['timestamp', 'total_projects', 'active_projects', 'total_tasks', 'total_done', 'overall_progress', 'overdue_tasks', 'identities', 'projects', 'recent_activity'] |
| 32 | MCP-style /api/v1 | `GET /api/v1/agent-context` | 200 | **PASS** | keys=['platform', 'version', 'capabilities', 'instructions', 'conventions', 'projects', 'quick_start'] |
| 33 | MCP-style /api/v1 | `Verify summary arrays` | 200 | **PASS** | identities=9; projects=17; recent_activity=20 |
| 34 | MCP-style /api/v1 | `Create task, add comment, report progress, delete lifecycle` | create 201, comment 201, progress 200, delete 204, verify 404 | **PASS** | created task 1a2d09f6-b847-4961-91e4-2b19e0192a02; comment 2379e9a9-f55e-4f3b-ae50-3747a180230c; verified deleted with GET 404 |

## Notable Findings

- Test 16 (Webhook Deliveries): Endpoint responded, but the test delivery did not succeed: {'success': False, 'error': "Request URL is missing an 'http://' or 'https://' protocol."}
- Test 17 (Webhook Deliveries): 0 deliveries returned; note `/integrations/{id}/test` does not log deliveries in current implementation
- Test 19 (Webhook Deliveries): No delivery exists to fetch
- Test 22 (Subtasks): Parent task keys include subtasks: False; value length=n/a
- Test 24 (Workflow Rules): Response={'detail': [{'type': 'missing', 'loc': ['query', 'task_id'], 'msg': 'Field required', 'input': None}]}
- Test 25 (Workflow Rules): Requested body-only dry run failed; implementation requires task_id query parameter and ignores task_data body
- Test 29 (Goals): Response keys=['id', 'title', 'description', 'status', 'target_date', 'created_at', 'updated_at', 'projects', 'progress']; current_value=None
- Test 30 (Goals): current_value=None; schema exposes progress=0.0
