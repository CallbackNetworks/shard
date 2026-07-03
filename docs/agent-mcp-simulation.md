# Agent MCP Simulation

- Base URL: `http://localhost:8000`
- Scenario date used in created task titles: `2026-07-02`
- Run timestamp: `2026-07-03T01:36:33.810583+00:00`
- Total API calls recorded: `45`
- Passed: `44`
- Failed: `1`

## Created Artifacts

- Daily plan task: task `2b8dc4f6-b55f-47b3-9767-c5eb49706909` in project `a57cae9c-164b-4152-a29b-ce04004f481d`
- Payment review summary task: task `32ff6620-47a5-4c45-b32b-56666742e19f` in project `fd331f50-fd1e-4f89-9e24-17a2be474388`
- Cross-project analysis task: task `32cc8c86-67ff-45cb-8248-b9cb772adf6e` in project `a57cae9c-164b-4152-a29b-ce04004f481d`

## Scenario 1

- Identified 68 high-priority task references across 10 projects; 36 were overdue relative to 2026-07-02.
- Notifications returned 2; urgent/overdue/failed keyword matches: 0.

## Scenario 2

- Found Payment Gateway v2 as fd331f50-fd1e-4f89-9e24-17a2be474388; commented on 3 in-progress tasks.

## Scenario 3

- /search?q=todo returned 1 task matches. This is text search, not a status=todo listing, so it may miss most todo tasks.
- Added 1 triage comments and performed 0 security/bug priority updates from search results.

## Scenario 4

- Checked 17 projects; found 0 blocked tasks and added 0 blocker comments.

## Scenario 5

- Overview total_tasks=121, overdue_tasks=36; heatmap days=6; trend points=7.

## Errors, Unexpected Responses, and API Design Issues

- Server timestamp was 2026-07-03 UTC while scenario titles use 2026-07-02; report preserves requested scenario date.
- GET `/api/v1/projects/fd331f50-fd1e-4f89-9e24-17a2be474388/stats` returned HTTP 500 during the Payment Gateway v2 review, blocking project statistics retrieval for that scenario.
- /api/v1/search?q=todo is text search, not a true status=todo query. Agents should prefer /projects/{id}/tasks?status_filter=todo when project IDs are known.
- GET /api/v1/projects returns task counts but empty tasks arrays; agents must call /projects/{id}/tasks for task details.
- One or more API calls failed; see call log rows with FAIL.

## API Call Log

| # | Scenario | Method | Endpoint | HTTP | Pass/Fail | Response summary |
|---:|:---:|---|---|---:|---|---|
| 1 | 1 | `GET` | `/api/v1/summary` | 200 | PASS | {"timestamp":"2026-07-03T01:36:32.855294+00:00","total_projects":17,"active_projects":15,"total_task |
| 2 | 1 | `GET` | `/api/v1/notifications` | 200 | PASS | [{"id":"5694421e-cc23-427f-b45b-38a96dd0b13a","type":"decision_pending","message":"[Demo] Decision p |
| 3 | 1 | `GET` | `/api/v1/projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks` | 200 | PASS | [{"id":"c1c9e509-084f-4264-989f-7a3d58639df5","project_id":"a57cae9c-164b-4152-a29b-ce04004f481d","p |
| 4 | 1 | `GET` | `/api/v1/projects/245a67b7-745c-4c81-975d-ae9fa87c5aae/tasks` | 200 | PASS | [{"id":"d9eb2883-5334-4859-9b51-b4871a7bcf22","project_id":"245a67b7-745c-4c81-975d-ae9fa87c5aae","p |
| 5 | 1 | `GET` | `/api/v1/projects/15b372ba-8145-4140-a9dd-0287aa98ef11/tasks` | 200 | PASS | [{"id":"ff4dba6c-b796-4381-a416-e4ce0be1b0ad","project_id":"15b372ba-8145-4140-a9dd-0287aa98ef11","p |
| 6 | 1 | `GET` | `/api/v1/projects/a1dd6cd3-a25e-4ebc-ad21-98988f07c486/tasks` | 200 | PASS | [{"id":"4bd2ea7a-7133-4a78-961a-55101d2baae2","project_id":"a1dd6cd3-a25e-4ebc-ad21-98988f07c486","p |
| 7 | 1 | `GET` | `/api/v1/projects/a4a17164-28d1-4e04-978e-d4b162cc337b/tasks` | 200 | PASS | [{"id":"68b2e119-3cc0-441c-a0da-7d3cbef6e875","project_id":"a4a17164-28d1-4e04-978e-d4b162cc337b","p |
| 8 | 1 | `GET` | `/api/v1/projects/fd331f50-fd1e-4f89-9e24-17a2be474388/tasks` | 200 | PASS | [{"id":"05b7fc84-c8e7-4e12-afb2-fed5ff49283b","project_id":"fd331f50-fd1e-4f89-9e24-17a2be474388","p |
| 9 | 1 | `GET` | `/api/v1/projects/c9c4d837-7f15-4b5b-bd03-316cc6cf645a/tasks` | 200 | PASS | [{"id":"1624c68b-02fc-4760-a5fa-2d6f8cdd2a30","project_id":"c9c4d837-7f15-4b5b-bd03-316cc6cf645a","p |
| 10 | 1 | `GET` | `/api/v1/projects/112bfce7-b03e-4f38-b967-b1dec387e9c5/tasks` | 200 | PASS | [{"id":"ea4abce6-7fa9-40ca-90bb-7c3a0709a56f","project_id":"112bfce7-b03e-4f38-b967-b1dec387e9c5","p |
| 11 | 1 | `GET` | `/api/v1/projects/b1b6c255-5dea-4b46-9a1a-904bf6dff7a5/tasks` | 200 | PASS | [{"id":"2ea02522-99f6-41c1-96e0-596e2a350027","project_id":"b1b6c255-5dea-4b46-9a1a-904bf6dff7a5","p |
| 12 | 1 | `GET` | `/api/v1/projects/f36ce46c-6716-4221-840b-b2b0cbec8b90/tasks` | 200 | PASS | [{"id":"060d2779-fda4-42dc-87e6-2c39cf230aa4","project_id":"f36ce46c-6716-4221-840b-b2b0cbec8b90","p |
| 13 | 1 | `POST` | `/api/v1/projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks` | 201 | PASS | {"id":"2b8dc4f6-b55f-47b3-9767-c5eb49706909","project_id":"a57cae9c-164b-4152-a29b-ce04004f481d","pa |
| 14 | 2 | `GET` | `/api/v1/projects` | 200 | PASS | [{"id":"a57cae9c-164b-4152-a29b-ce04004f481d","name":"Legacy API Deprecation","description":"Sunset  |
| 15 | 2 | `GET` | `/api/v1/projects/fd331f50-fd1e-4f89-9e24-17a2be474388/tasks` | 200 | PASS | [{"id":"05b7fc84-c8e7-4e12-afb2-fed5ff49283b","project_id":"fd331f50-fd1e-4f89-9e24-17a2be474388","p |
| 16 | 2 | `GET` | `/api/v1/projects/fd331f50-fd1e-4f89-9e24-17a2be474388/stats` | 500 | FAIL | {"detail":"Internal server error"} |
| 17 | 2 | `GET` | `/api/v1/analytics/velocity?project_id=fd331f50-fd1e-4f89-9e24-17a2be474388` | 200 | PASS | [{"cycle_id":"8da3aa31-2a9f-459f-8db6-d39e76a8d5a7","name":"Sprint 23 - Payment Core","total_tasks": |
| 18 | 2 | `POST` | `/api/v1/projects/fd331f50-fd1e-4f89-9e24-17a2be474388/tasks/05b7fc84-c8e7-4e12-afb2-fed5ff49283b/comments` | 201 | PASS | {"id":"1aae5acc-a405-4d4b-a337-9635c48adf97","task_id":"05b7fc84-c8e7-4e12-afb2-fed5ff49283b","proje |
| 19 | 2 | `POST` | `/api/v1/projects/fd331f50-fd1e-4f89-9e24-17a2be474388/tasks/760999c8-f999-427f-ab5f-c9786edcdf66/comments` | 201 | PASS | {"id":"b04a778a-986c-494d-8875-4be38c538b71","task_id":"760999c8-f999-427f-ab5f-c9786edcdf66","proje |
| 20 | 2 | `POST` | `/api/v1/projects/fd331f50-fd1e-4f89-9e24-17a2be474388/tasks/4a20955b-d9bc-4d9b-9684-5d4999e5718d/comments` | 201 | PASS | {"id":"574e365e-89a1-46d5-b910-93c571d2d0b5","task_id":"4a20955b-d9bc-4d9b-9684-5d4999e5718d","proje |
| 21 | 2 | `POST` | `/api/v1/projects/fd331f50-fd1e-4f89-9e24-17a2be474388/tasks` | 201 | PASS | {"id":"32ff6620-47a5-4c45-b32b-56666742e19f","project_id":"fd331f50-fd1e-4f89-9e24-17a2be474388","pa |
| 22 | 3 | `GET` | `/api/v1/search?q=todo&limit=200` | 200 | PASS | {"query":"todo","tasks":[{"id":"2b8dc4f6-b55f-47b3-9767-c5eb49706909","project_id":"a57cae9c-164b-41 |
| 23 | 3 | `GET` | `/api/v1/projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks/2b8dc4f6-b55f-47b3-9767-c5eb49706909/comments` | 200 | PASS | [] |
| 24 | 3 | `POST` | `/api/v1/projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks/2b8dc4f6-b55f-47b3-9767-c5eb49706909/comments` | 201 | PASS | {"id":"e98ae7e0-76c7-4542-8be9-829e629c433f","task_id":"2b8dc4f6-b55f-47b3-9767-c5eb49706909","proje |
| 25 | 4 | `GET` | `/api/v1/projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks` | 200 | PASS | [{"id":"c1c9e509-084f-4264-989f-7a3d58639df5","project_id":"a57cae9c-164b-4152-a29b-ce04004f481d","p |
| 26 | 4 | `GET` | `/api/v1/projects/245a67b7-745c-4c81-975d-ae9fa87c5aae/tasks` | 200 | PASS | [{"id":"d9eb2883-5334-4859-9b51-b4871a7bcf22","project_id":"245a67b7-745c-4c81-975d-ae9fa87c5aae","p |
| 27 | 4 | `GET` | `/api/v1/projects/15b372ba-8145-4140-a9dd-0287aa98ef11/tasks` | 200 | PASS | [{"id":"ff4dba6c-b796-4381-a416-e4ce0be1b0ad","project_id":"15b372ba-8145-4140-a9dd-0287aa98ef11","p |
| 28 | 4 | `GET` | `/api/v1/projects/a1dd6cd3-a25e-4ebc-ad21-98988f07c486/tasks` | 200 | PASS | [{"id":"4bd2ea7a-7133-4a78-961a-55101d2baae2","project_id":"a1dd6cd3-a25e-4ebc-ad21-98988f07c486","p |
| 29 | 4 | `GET` | `/api/v1/projects/a4a17164-28d1-4e04-978e-d4b162cc337b/tasks` | 200 | PASS | [{"id":"68b2e119-3cc0-441c-a0da-7d3cbef6e875","project_id":"a4a17164-28d1-4e04-978e-d4b162cc337b","p |
| 30 | 4 | `GET` | `/api/v1/projects/fd331f50-fd1e-4f89-9e24-17a2be474388/tasks` | 200 | PASS | [{"id":"05b7fc84-c8e7-4e12-afb2-fed5ff49283b","project_id":"fd331f50-fd1e-4f89-9e24-17a2be474388","p |
| 31 | 4 | `GET` | `/api/v1/projects/071dbe00-0805-4129-bebb-a7d12c9e6d8d/tasks` | 200 | PASS | [{"id":"c0af60dd-d569-4408-be36-9ab5a59b6a07","project_id":"071dbe00-0805-4129-bebb-a7d12c9e6d8d","p |
| 32 | 4 | `GET` | `/api/v1/projects/c9c4d837-7f15-4b5b-bd03-316cc6cf645a/tasks` | 200 | PASS | [{"id":"1624c68b-02fc-4760-a5fa-2d6f8cdd2a30","project_id":"c9c4d837-7f15-4b5b-bd03-316cc6cf645a","p |
| 33 | 4 | `GET` | `/api/v1/projects/112bfce7-b03e-4f38-b967-b1dec387e9c5/tasks` | 200 | PASS | [{"id":"ea4abce6-7fa9-40ca-90bb-7c3a0709a56f","project_id":"112bfce7-b03e-4f38-b967-b1dec387e9c5","p |
| 34 | 4 | `GET` | `/api/v1/projects/b1b6c255-5dea-4b46-9a1a-904bf6dff7a5/tasks` | 200 | PASS | [{"id":"2ea02522-99f6-41c1-96e0-596e2a350027","project_id":"b1b6c255-5dea-4b46-9a1a-904bf6dff7a5","p |
| 35 | 4 | `GET` | `/api/v1/projects/f36ce46c-6716-4221-840b-b2b0cbec8b90/tasks` | 200 | PASS | [{"id":"060d2779-fda4-42dc-87e6-2c39cf230aa4","project_id":"f36ce46c-6716-4221-840b-b2b0cbec8b90","p |
| 36 | 4 | `GET` | `/api/v1/projects/1295bab7-4e5e-4e75-97a2-6beeee0dc3d2/tasks` | 200 | PASS | [] |
| 37 | 4 | `GET` | `/api/v1/projects/f25e027d-2dcf-44c4-9221-2a7cb6043b04/tasks` | 200 | PASS | [{"id":"739039e8-5bb7-4ca0-8ded-936883f227d7","project_id":"f25e027d-2dcf-44c4-9221-2a7cb6043b04","p |
| 38 | 4 | `GET` | `/api/v1/projects/ac89441d-1ea5-4c34-8943-604176aee8a6/tasks` | 200 | PASS | [{"id":"ff8095b7-469c-4e3a-9397-0f20adbe201a","project_id":"ac89441d-1ea5-4c34-8943-604176aee8a6","p |
| 39 | 4 | `GET` | `/api/v1/projects/6b61d884-1322-44e5-8a68-ebfdd4f618d5/tasks` | 200 | PASS | [{"id":"647f14ae-67e8-4933-81ba-e6ed1388e2f1","project_id":"6b61d884-1322-44e5-8a68-ebfdd4f618d5","p |
| 40 | 4 | `GET` | `/api/v1/projects/73da4a52-1442-4abe-9318-cfe9e7eb1d6a/tasks` | 200 | PASS | [{"id":"274520ea-5b57-466a-a858-a38581e3e757","project_id":"73da4a52-1442-4abe-9318-cfe9e7eb1d6a","p |
| 41 | 4 | `GET` | `/api/v1/projects/487f3725-e828-4715-b932-26f4517332e8/tasks` | 200 | PASS | [] |
| 42 | 5 | `GET` | `/api/v1/analytics/overview` | 200 | PASS | {"total_projects":17,"active_projects":15,"total_tasks":121,"done_tasks":8,"in_progress_tasks":5,"ov |
| 43 | 5 | `GET` | `/api/v1/analytics/heatmap` | 200 | PASS | [{"date":"2026-06-26","count":4},{"date":"2026-06-27","count":7},{"date":"2026-06-28","count":13},{" |
| 44 | 5 | `GET` | `/api/v1/analytics/status-trend?days=7` | 200 | PASS | [{"date":"2026-06-27","todo":8,"in_progress":2,"done":7,"failed":9},{"date":"2026-06-28","todo":8,"i |
| 45 | 5 | `POST` | `/api/v1/projects/a57cae9c-164b-4152-a29b-ce04004f481d/tasks` | 201 | PASS | {"id":"32cc8c86-67ff-45cb-8248-b9cb772adf6e","project_id":"a57cae9c-164b-4152-a29b-ce04004f481d","pa |
