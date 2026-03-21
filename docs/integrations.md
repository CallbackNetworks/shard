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

### Available Events

| Event | Fired when |
|---|---|
| `task.done` | Task status → `done` |
| `task.failed` | Task status → `failed` |
| `task.in_progress` | Task status → `in_progress` |
| `task.created` | New task created |
| `project.complete` | All tasks in a project reach `done` |

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

## Testing Integrations

Use the **Test** button in the Integrations page to fire a synthetic notification payload and verify your endpoint is reachable.

For the inbound webhook, test manually:

```bash
curl -X POST https://your-domain/webhook/callback/{token} \
  -H "Content-Type: application/json" \
  -d '{"status": "done", "message": "manual test"}'
```
