# Integrations

## Inbound: CI/CD Webhook

Every task has a unique webhook URL. When a CI/CD pipeline finishes, it POSTs to this URL to update the task's status automatically.

### Get the Webhook URL

1. Go to a project in the management UI (`/app/projects/{id}`)
2. Open any task — the webhook URL is shown in the task detail
3. Format: `https://your-domain/webhook/callback/{callback_token}`

### Request Format

```bash
curl -X POST https://your-domain/webhook/callback/{callback_token} \
  -H "Content-Type: application/json" \
  -d '{"status": "done", "message": "Build #42 passed in 3m 12s"}'
```

**`status`** (required): `todo` | `in_progress` | `done` | `failed`

**`message`** (optional): Human-readable description logged to activity

### Response

```json
{ "ok": true, "task_id": "uuid", "status": "done" }
```

### Regenerate Token

If a webhook URL is compromised, regenerate the token from the task detail view. The old URL stops working immediately.

---

## Drone CI

In your `.drone.yml`:

```yaml
steps:
  - name: notify-todo
    image: curlimages/curl
    commands:
      - |
        curl -s -X POST ${TODO_WEBHOOK_URL} \
          -H "Content-Type: application/json" \
          -d "{\"status\": \"$${DRONE_BUILD_STATUS == 'success' ? 'done' : 'failed'}\", \"message\": \"Drone build #${DRONE_BUILD_NUMBER}\"}"
    environment:
      TODO_WEBHOOK_URL:
        from_secret: TODO_WEBHOOK_URL
    when:
      status:
        - success
        - failure
```

Store the webhook URL as a Drone secret named `TODO_WEBHOOK_URL`.

### Outbound Drone Notifications

To receive notifications _in_ Drone when task statuses change:

1. Go to **Integrations** in the management UI
2. Create a new integration:
   - Type: **Drone**
   - URL: Your Drone webhook endpoint
   - Events: select the events you want
3. Outbound payloads will include `X-Drone-Event: custom`

---

## Jenkins

In your `Jenkinsfile`:

```groovy
pipeline {
    agent any
    stages {
        stage('Build') { ... }
    }
    post {
        success {
            sh """
                curl -s -X POST ${TODO_WEBHOOK_URL} \
                  -H 'Content-Type: application/json' \
                  -d '{"status": "done", "message": "Jenkins build ${env.BUILD_NUMBER} succeeded"}'
            """
        }
        failure {
            sh """
                curl -s -X POST ${TODO_WEBHOOK_URL} \
                  -H 'Content-Type: application/json' \
                  -d '{"status": "failed", "message": "Jenkins build ${env.BUILD_NUMBER} failed"}'
            """
        }
    }
}
```

Set `TODO_WEBHOOK_URL` as a Jenkins credential (Secret text).

### Outbound Jenkins Notifications

Create an integration with Type: **Jenkins**. Outbound payloads include `X-Jenkins-Source: todo-platform`.

---

## GitHub Actions

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

---

## Outbound Notifications (Generic Webhook)

Any service that can receive an HTTP POST works as a notification target.

1. Go to **Integrations** → **New Integration**
2. Type: **Generic**
3. Enter your webhook URL
4. (Optional) Enter a **secret** — sent as `Authorization: Bearer {secret}`
5. Select events to subscribe to

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

### HMAC Signature Verification

When an integration has a `secret` set, outbound webhook payloads are signed:
- `Authorization: Bearer {secret}`
- `X-Signature: sha256={hex_digest}` — HMAC-SHA256 over the raw JSON body
- `X-Hub-Signature-256: sha256={hex_digest}` — same, for GitHub-compatible verification

To verify on the receiving end:
```python
import hashlib, hmac

expected = hmac.new(secret.encode(), request_body, hashlib.sha256).hexdigest()
received = request.headers["X-Signature"].removeprefix("sha256=")
assert hmac.compare_digest(expected, received)
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

## Webhook Delivery Logs & Retries

Every outbound webhook delivery is logged in a `WebhookDelivery` record with full request/response details.

### Viewing Logs

In the management UI, go to **Integrations** → click an integration → **Delivery Logs**.

Via API:
```bash
GET /integrations/{id}/deliveries?status=failed&limit=50
```

### Automatic Retries

Failed deliveries are retried automatically by the background scheduler with exponential backoff:
- Retry intervals: **1 min**, **5 min**, **30 min**, **2 hours**, **6 hours**
- After all retries are exhausted, the delivery status becomes `dead`

### Manual Retry

```bash
POST /deliveries/{delivery_id}/retry
```

Resets the attempt counter and re-sends the webhook immediately. Only works on `failed` or `dead` deliveries.

### Purging Old Logs

```bash
DELETE /deliveries?older_than_days=30
```

---

## Email Notifications

Configure SMTP in your `.env` file (see [Deployment](deployment.md)), then create an email integration:

1. Go to **Integrations** → **New Integration**
2. Type: **Email**
3. Fill in **To** (comma-separated)
4. Optionally customize the **Subject Prefix** (default: `[TODO Platform]`)
5. Select events

The email body includes a formatted summary of the event, project, and task.

### SMTP Environment Variables

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=app_specific_password
SMTP_FROM=your@gmail.com
SMTP_USE_TLS=true
```

For Gmail, use an [App Password](https://support.google.com/accounts/answer/185833) rather than your account password.

---

## Project-Scoped vs Global Integrations

When creating an integration, the **Project** field is optional:

- **No project selected**: integration fires for all projects
- **Project selected**: integration only fires for events from that project

This lets you have a global Slack/webhook for all activity and project-specific ones for targeted alerts.

---

## API Keys for External Automation

For scripts or AI agents that need to read or write tasks programmatically:

1. Go to **API Keys** → **New Key**
2. Choose scopes: `read`, `write`, `admin`
3. Optionally restrict to a specific project
4. Copy the key (shown only once, starts with `tdp_`)

Use the key in the `X-API-Key` header:

```bash
curl https://your-domain/api/v1/summary \
  -H "X-API-Key: tdp_your_key_here"
```

See [API Reference](api.md#external-api-v1) for full endpoint documentation.

---

## Workflow Rules (Automation)

Workflow rules let you automate actions when tasks are created or updated.

### Creating a Rule

1. Go to **Workflow Rules** in the sidebar
2. Click **New Rule**
3. Configure:
   - **Trigger**: when the rule fires (`task.created`, `task.status_changed`, `task.label_added`, `task.priority_changed`)
   - **Conditions**: optional filters (e.g., priority = high, status = done)
   - **Actions**: what to do (set status, assign, add label, add comment, fire event)
4. Optionally scope to a specific project

### Example Rules

**Auto-assign high-priority tasks:**
- Trigger: `task.created`
- Condition: `priority eq high`
- Action: `set_assignee = alice`

**Close parent when all subtasks done:**
- Trigger: `task.status_changed`
- Condition: `status eq done`
- Action: `fire_event = task.done` (triggers notification)

### Dry-run Testing

Use the **Test** button to simulate a rule against a specific task without executing actions:
```bash
POST /workflow-rules/{rule_id}/test?task_id={task_id}
```

---

## LLM Assistant

The built-in AI assistant can read and modify your tasks via natural language.

### Setup

Set these environment variables:
```env
LLM_PROVIDER=claude          # or openai, or stub (default)
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-6
```

### Usage

Click the assistant button (bottom-right of the management UI). The assistant can:
- Summarize project status
- List and search tasks
- Create tasks and subtasks
- Update task status, priority, and assignee
- Manage labels
- Analyze workload distribution
- Review recent activity

Quick-action buttons in empty conversations: **Summary**, **Overdue**, **Workload**, **Recent**, **Plan today**.

---

## Testing Integrations

Use the **Test** button in the Integrations page to fire a synthetic notification payload and verify your endpoint is reachable.

For the inbound webhook, test manually:

```bash
curl -X POST https://your-domain/webhook/callback/{token} \
  -H "Content-Type: application/json" \
  -d '{"status": "done", "message": "manual test"}'
```
