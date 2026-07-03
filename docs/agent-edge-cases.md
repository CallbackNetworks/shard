| Test | Endpoint | Status Code | Pass/Fail | Notes |
|---|---|---:|---|---|
| Empty title | `POST /api/v1/projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks` | 201 | Fail | Empty task title was accepted and a task was created. Expected validation failure. |
| Invalid priority | `PATCH /api/v1/projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks/c1c9e509-084f-4264-989f-7a3d58639df5` | 422 | Pass | Rejected `super_critical`; allowed values are `low`, `medium`, and `high`. |
| Invalid status | `PATCH /api/v1/projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks/c1c9e509-084f-4264-989f-7a3d58639df5` | 422 | Pass | Rejected `yolo`; allowed values are `todo`, `in_progress`, `done`, and `failed`. |
| Non-existent project | `GET /api/v1/projects/00000000-0000-0000-0000-000000000000` | 404 | Pass | Returned `Project not found`. |
| No API key | `GET /api/v1/projects` | 422 | Pass | Request was rejected because the required `X-API-Key` header was missing. |
| Invalid API key | `GET /api/v1/projects` | 401 | Pass | Request was rejected with `Invalid or inactive API key`. |
| XSS in search | `GET /api/v1/search?q=<script>alert(1)</script>` | 200 | Pass | Search handled the payload without server error and returned empty `tasks` and `projects` arrays. Response echoed the query string. |
| SQL injection | `GET /api/v1/search?q=test%27+OR+1%3D1+--` | 200 | Pass | Search handled the payload without server error and returned empty `tasks` and `projects` arrays. |
| Progress > 100 | `POST /api/v1/projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks/c1c9e509-084f-4264-989f-7a3d58639df5/progress` | 200 | Fail | Out-of-range `percentage: 150` was accepted. Response returned the task with `progress_pct: null`. |
| Very long title (1000+ chars) | `POST /api/v1/projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks` | 201 | Fail | A 1000-character title was accepted and a task was created. Expected length validation or documented limit. |
