# Integrations

## Inbound: CI/CD Webhook

Every task has a unique webhook URL. When a CI/CD pipeline finishes, it POSTs to this URL to update the task's status automatically.

### Get the Webhook URL

1. Go to a project in the management UI (`/app/projects/{id}`)
2. Hover over any task — click the link icon to copy the webhook URL
3. Format: `https://your-domain/webhook/callback/{callback_token}`

### Native CI/CD Payload Support

The platform **auto-detects** the CI/CD provider from request headers and parses native payloads. You can send payloads directly from GitHub Actions, GitLab CI, Jenkins, Drone CI, or Bitbucket Pipelines without converting to a custom format.

**Supported providers** (auto-detected via headers):

| Provider | Detection Headers | Status Mapping |
|---|---|---|
| **GitHub Actions** | `X-GitHub-Event`, `X-GitHub-Delivery` | `conclusion: success` → `done`, `failure` → `failed` |
| **GitLab CI** | `X-Gitlab-Event`, `X-Gitlab-Token` | `status: success` → `done`, `failed` → `failed` |
| **Jenkins** | `X-Jenkins-Source`, `User-Agent: Java/` | `status: SUCCESS` → `done`, `FAILURE` → `failed` |
| **Drone CI** | `X-Drone-Event`, `X-Drone-Source` | `status: success` → `done`, `failure` → `failed` |
| **Bitbucket** | `X-Event-Key`, `X-Hook-UUID` | `state: SUCCESSFUL` → `done`, `FAILED` → `failed` |
| **Generic** | (fallback) | `status` field mapped directly |

You can also force provider detection via query param: `?provider=github`

### Simple Format (all CI/CD tools)

```bash
curl -X POST https://your-domain/webhook/callback/{callback_token} \
  -H "Content-Type: application/json" \
  -d '{"status": "done", "message": "Build #42 passed in 3m 12s"}'
```

**`status`** (required): `todo` | `in_progress` | `done` | `failed`

**`message`** (optional): Human-readable description logged to activity

### Enriched Data (Build History)

When using native payloads, the platform extracts and stores enriched build metadata:

- **commit_sha** — Git commit hash
- **branch** — Git branch name
- **build_url** — Link to the CI/CD build page
- **build_number** — Build/run number
- **build_duration_ms** — Build duration in milliseconds
- **triggered_by** — Who/what triggered the build
- **test_summary** — Test results (passed/failed/skipped)

This data is visible in the **Build History** panel on each task.

### Build History API

```bash
GET /webhook/events/{task_id}?limit=20&offset=0
```

Returns a list of all inbound webhook events for a task, newest first.

### Regenerate Token

If a webhook URL is compromised, regenerate the token from the task detail view (hover → refresh icon). The old URL stops working immediately.

### Webhook Secret & Signature Verification

For security, you can set a **webhook secret** on each task. When configured, inbound requests must include a valid signature:

| Provider | Signature Header | Method |
|---|---|---|
| **GitHub** | `X-Hub-Signature-256: sha256=<hex>` | HMAC-SHA256 |
| **GitLab** | `X-Gitlab-Token: <token>` | Exact match |
| **Generic** | `X-Signature: sha256=<hex>` | HMAC-SHA256 |

If a secret is set but no valid signature is provided, the request is rejected with HTTP 401.

**Replay protection**: If `X-Webhook-Timestamp` header is present, requests older than 5 minutes are rejected.

---

## GitHub Actions

### Option A: Simple curl (works immediately)

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: make build
      - name: Notify TODO Platform
        if: always()
        run: |
          STATUS=${{ job.status == 'success' && 'done' || 'failed' }}
          curl -s -X POST "${{ secrets.TODO_WEBHOOK_URL }}" \
            -H "Content-Type: application/json" \
            -d "{\"status\": \"${STATUS}\", \"message\": \"GitHub Actions run ${{ github.run_number }}\"}"
```

### Option B: Native GitHub Webhook (auto-detected)

1. Go to your repo **Settings > Webhooks > Add webhook**
2. Set **Payload URL** to the task's webhook URL
3. Set **Content type** to `application/json`
4. Set **Secret** to the task's webhook secret (optional)
5. Select events: **Workflow runs**, **Check runs**

The platform auto-detects `X-GitHub-Event` header and parses the full payload.

---

## GitLab CI

### Option A: Pipeline webhook (recommended)

1. Go to your GitLab project **Settings > Webhooks**
2. Set **URL** to the task's webhook URL
3. Set **Secret Token** to the task's webhook secret (optional)
4. Check **Pipeline events** and/or **Job events**
5. Click **Add webhook**

### Option B: CI job step

```yaml
notify:
  stage: .post
  script:
    - |
      STATUS=$([ "$CI_JOB_STATUS" = "success" ] && echo "done" || echo "failed")
      curl -s -X POST "$TODO_WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -H "X-Gitlab-Event: Pipeline Hook" \
        -d '{"status": "'$STATUS'", "message": "Pipeline #'$CI_PIPELINE_IID' '$CI_JOB_STATUS'"}'
  when: always
```

---

## Jenkins

### Option A: Notification Plugin

Install the "Notification" plugin in Jenkins and configure HTTP POST notifications.

### Option B: Pipeline step

```groovy
pipeline {
    agent any
    stages {
        stage('Build') { steps { sh 'make build' } }
    }
    post {
        success {
            sh """
                curl -s -X POST ${TODO_WEBHOOK_URL} \
                  -H 'Content-Type: application/json' \
                  -H 'X-Jenkins-Source: todo-platform' \
                  -d '{"build": {"phase": "FINALIZED", "status": "SUCCESS", "number": ${BUILD_NUMBER}, "full_url": "${BUILD_URL}"}}'
            """
        }
        failure {
            sh """
                curl -s -X POST ${TODO_WEBHOOK_URL} \
                  -H 'Content-Type: application/json' \
                  -H 'X-Jenkins-Source: todo-platform' \
                  -d '{"build": {"phase": "FINALIZED", "status": "FAILURE", "number": ${BUILD_NUMBER}, "full_url": "${BUILD_URL}"}}'
            """
        }
    }
}
```

---

## Drone CI

```yaml
steps:
  - name: notify-success
    image: curlimages/curl
    commands:
      - |
        curl -s -X POST "$TODO_WEBHOOK_URL" \
          -H "Content-Type: application/json" \
          -H "X-Drone-Event: build" \
          -d '{"status": "success", "build": {"number": '${DRONE_BUILD_NUMBER}', "link": "'${DRONE_BUILD_LINK}'", "after": "'${DRONE_COMMIT_SHA}'", "target": "'${DRONE_TARGET_BRANCH}'"}}'
    when:
      status: [success]

  - name: notify-failure
    image: curlimages/curl
    commands:
      - |
        curl -s -X POST "$TODO_WEBHOOK_URL" \
          -H "Content-Type: application/json" \
          -H "X-Drone-Event: build" \
          -d '{"status": "failure", "build": {"number": '${DRONE_BUILD_NUMBER}', "link": "'${DRONE_BUILD_LINK}'", "after": "'${DRONE_COMMIT_SHA}'", "target": "'${DRONE_TARGET_BRANCH}'"}}'
    when:
      status: [failure]
```

---

## Bitbucket Pipelines

### Option A: Repository Webhook

1. Go to **Settings > Webhooks > Add webhook**
2. Set URL to the task's callback URL
3. Select triggers: **Build status created**, **Build status updated**

### Option B: Pipeline step

```yaml
pipelines:
  default:
    - step:
        name: Build
        script:
          - npm ci && npm test
        after-script:
          - |
            STATUS=$([ "$BITBUCKET_EXIT_CODE" = "0" ] && echo "done" || echo "failed")
            curl -s -X POST "$TODO_WEBHOOK_URL" \
              -H "Content-Type: application/json" \
              -d '{"status": "'$STATUS'", "message": "Pipeline #'$BITBUCKET_BUILD_NUMBER'"}'
```

---

## CircleCI

```yaml
jobs:
  notify:
    docker:
      - image: cimg/base:stable
    steps:
      - run:
          name: Notify TODO Platform
          command: |
            curl -s -X POST "$TODO_WEBHOOK_URL" \
              -H "Content-Type: application/json" \
              -d '{"status": "done", "build_url": "'$CIRCLE_BUILD_URL'", "commit": "'$CIRCLE_SHA1'", "branch": "'$CIRCLE_BRANCH'"}'
          when: on_success
      - run:
          name: Notify failure
          command: |
            curl -s -X POST "$TODO_WEBHOOK_URL" \
              -H "Content-Type: application/json" \
              -d '{"status": "failed", "build_url": "'$CIRCLE_BUILD_URL'", "commit": "'$CIRCLE_SHA1'", "branch": "'$CIRCLE_BRANCH'"}'
          when: on_fail
```

---

## Integration Templates

The Integrations page provides **one-click templates** for popular CI/CD platforms. Templates auto-fill the integration type, default events, auth method, and include step-by-step setup instructions.

1. Go to **Integrations** → **From Template**
2. Click a platform (GitHub Actions, GitLab CI, Jenkins, Drone, Bitbucket, CircleCI)
3. The form pre-fills with recommended settings
4. Click **View Setup** for platform-specific configuration guide

### API

```bash
GET /integrations/templates           # List all templates
GET /integrations/templates/{id}      # Get full template with setup instructions
```

---

## Outbound Notifications

### Creating an Integration

1. Go to **Integrations** → **+ New Integration** (or **From Template**)
2. Configure:
   - **Type**: Jenkins, Drone, GitHub, GitLab, Bitbucket, CircleCI, Generic Webhook, Webhook (HMAC signed), Email
   - **URL**: Your webhook endpoint
   - **Auth Method**: Bearer Token, Basic Auth, API Key, or None
   - **Custom Headers**: Add any key-value header pairs
   - **Project**: Scope to a specific project or leave blank for global
   - **Events**: Select which events trigger notifications

### Auth Methods

| Method | Headers Sent |
|---|---|
| **Bearer Token** | `Authorization: Bearer {secret}` |
| **Basic Auth** | `Authorization: Basic {base64(user:pass)}` |
| **API Key** | Custom header (default: `X-API-Key: {value}`) |
| **None** | No auth headers |
| **HMAC (webhook type)** | `X-Signature: sha256=...`, `X-Hub-Signature-256: sha256=...` |

### Custom Headers

Add arbitrary HTTP headers to outbound requests. Useful for:
- API gateway routing (`X-Route-To: my-service`)
- Custom correlation IDs (`X-Correlation-Id: ...`)
- Internal service authentication

### Payload

```json
{
  "event": "task.done",
  "project": {
    "id": "uuid",
    "name": "My Project",
    "status": "active",
    "progress": 100.0,
    "total_tasks": 5,
    "done_tasks": 5
  },
  "task": {
    "id": "uuid",
    "title": "Deploy to production",
    "status": "done",
    "priority": "high"
  },
  "timestamp": "2026-03-21T10:00:00Z"
}
```

### Available Events

| Event | Fired when |
|---|---|
| `task.done` | Task status → `done` |
| `task.failed` | Task status → `failed` |
| `task.in_progress` | Task status → `in_progress` |
| `task.created` | New task created |
| `task.due_soon` | Task due date approaching (scheduler) |
| `task.overdue` | Task past due date (scheduler) |
| `project.complete` | All tasks in a project reach `done` |

---

## Webhook Delivery Logs & Health

### Viewing Logs

In the UI, go to **Integrations** → click an integration → **Recent Deliveries**. Use the dropdown filters to narrow by event type or status.

Via API:
```bash
GET /integrations/{id}/deliveries?status=failed&event=task.done&since=2026-01-01&until=2026-12-31&limit=50
GET /deliveries?status=failed&event=task.done   # Cross-integration query
```

### Integration Health

```bash
GET /integrations/{id}/health
```

Returns 7-day stats:
```json
{
  "integration_id": "uuid",
  "period_days": 7,
  "total_deliveries": 42,
  "successes": 40,
  "failures": 2,
  "dead": 0,
  "success_rate": 95.2,
  "avg_latency_ms": 150,
  "last_success_at": "2026-05-29T10:00:00Z"
}
```

Health stats are shown inline on each integration card in the UI.

### Automatic Retries

Failed deliveries are retried automatically with exponential backoff:
- Retry intervals: **1 min**, **5 min**, **30 min**, **2 hours**, **6 hours**
- After all retries exhausted, status becomes `dead`

### Manual Retry

```bash
POST /deliveries/{delivery_id}/retry
```

### Bulk Retry

Retry all failed/dead deliveries for an integration at once:
```bash
POST /integrations/{id}/retry-all
```

### Purging Old Logs

```bash
DELETE /deliveries?older_than_days=30&status=success  # Only purge successful
DELETE /deliveries?older_than_days=30                  # Purge all old
```

---

## Triggering CI/CD Pipelines (Bidirectional Sync)

The platform can **trigger** CI/CD pipelines, not just receive notifications from them.

### GitHub Actions (workflow_dispatch)

```bash
POST /cicd/trigger/github?task_id={optional_task_id}
{
  "repo": "owner/repo",
  "workflow_id": "ci.yml",
  "ref": "main",
  "token": "ghp_...",
  "inputs": {"environment": "staging"}
}
```

### GitLab CI (pipeline trigger)

```bash
POST /cicd/trigger/gitlab?task_id={optional_task_id}
{
  "project_id": "12345",
  "ref": "main",
  "token": "glpat-...",
  "variables": {"DEPLOY_ENV": "staging"},
  "gitlab_url": "https://gitlab.com"
}
```

### Jenkins (build trigger)

```bash
POST /cicd/trigger/jenkins?task_id={optional_task_id}
{
  "url": "https://jenkins.example.com/job/my-app",
  "username": "admin",
  "token": "api-token",
  "parameters": {"BRANCH": "main"}
}
```

### Generic Webhook Trigger

```bash
POST /cicd/trigger/generic?task_id={optional_task_id}
{
  "url": "https://your-ci/trigger",
  "method": "POST",
  "headers": {"Authorization": "Bearer xxx"},
  "body": {"branch": "main"}
}
```

When `task_id` is provided, the trigger is logged in the task's activity history.

---

## Email Notifications

Configure SMTP in your `.env` file, then create an email integration:

1. Go to **Integrations** → **New Integration**
2. Type: **Email**
3. Fill in **To** (comma-separated)
4. Optionally customize the **Subject Prefix** (default: `[TODO Platform]`)
5. Select events

### SMTP Environment Variables

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=app_specific_password
SMTP_FROM=your@gmail.com
SMTP_USE_TLS=true
```

---

## Project-Scoped vs Global Integrations

When creating an integration, the **Project** field is optional:

- **No project selected**: integration fires for all projects
- **Project selected**: integration only fires for events from that project

---

## Security Best Practices

1. **Set webhook secrets** on tasks that receive CI/CD callbacks. This prevents unauthorized status changes if a callback token is leaked.
2. **Rotate callback tokens** periodically or after team member departures.
3. **Use HMAC-signed webhooks** (webhook type) for outbound notifications so the receiver can verify authenticity.
4. **Restrict API keys** to specific projects and minimum required scopes.
5. **Use HTTPS** for all webhook URLs in production.

---

## Testing Integrations

Use the **Test** button in the Integrations page to fire a synthetic notification payload.

For inbound webhooks, test manually:

```bash
curl -X POST https://your-domain/webhook/callback/{token} \
  -H "Content-Type: application/json" \
  -d '{"status": "done", "message": "manual test"}'
```
