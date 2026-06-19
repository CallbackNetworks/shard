"""
Predefined integration templates for popular CI/CD platforms.
Each template provides default configuration, setup instructions, and payload examples.
"""

TEMPLATES = {
    "github_actions": {
        "id": "github_actions",
        "name": "GitHub Actions",
        "provider": "github",
        "icon": "github",
        "description": "Receive notifications from GitHub Actions workflow runs",
        "type": "github",
        "default_events": ["task.done", "task.failed", "project.complete"],
        "auth_type": "bearer",
        "setup_instructions": """## Setup GitHub Actions Integration

### Option A: Auto-detect (recommended)
Add a step at the end of your workflow that POSTs to the task's webhook URL.
The platform will auto-detect the GitHub payload format.

```yaml
- name: Notify Shard
  if: always()
  env:
    WEBHOOK_URL: ${{ secrets.TODO_WEBHOOK_URL }}
  run: |
    STATUS="${{ job.status == 'success' && 'done' || 'failed' }}"
    curl -s -X POST "$WEBHOOK_URL" \\
      -H "Content-Type: application/json" \\
      -H "X-GitHub-Event: workflow_run" \\
      -d '{"status": "'$STATUS'", "message": "Workflow ${{ github.workflow }} #${{ github.run_number }}"}'
```

### Option B: Native GitHub Webhook
1. Go to your repo Settings > Webhooks > Add webhook
2. Set Payload URL to the task's webhook URL
3. Set Content type to `application/json`
4. Set Secret to the task's webhook secret (if configured)
5. Select events: Workflow runs, Check runs

### Signature Verification
If you set a webhook secret on the task, GitHub will sign payloads with HMAC-SHA256.
The platform verifies `X-Hub-Signature-256` automatically.
""",
        "example_payload": {
            "status": "done",
            "message": "Workflow 'CI' #42 completed successfully",
        },
    },
    "gitlab_ci": {
        "id": "gitlab_ci",
        "name": "GitLab CI/CD",
        "provider": "gitlab",
        "icon": "gitlab",
        "description": "Receive notifications from GitLab CI/CD pipelines",
        "type": "gitlab",
        "default_events": ["task.done", "task.failed", "project.complete"],
        "auth_type": "bearer",
        "setup_instructions": """## Setup GitLab CI Integration

### Option A: Pipeline webhook (recommended)
1. Go to your GitLab project > Settings > Webhooks
2. Set URL to the task's webhook URL
3. Set Secret Token to the task's webhook secret (if configured)
4. Check "Pipeline events" and/or "Job events"
5. Click "Add webhook"

The platform auto-detects GitLab payloads via the `X-Gitlab-Event` header.

### Option B: CI job step
Add to your `.gitlab-ci.yml`:

```yaml
notify:
  stage: .post
  script:
    - |
      STATUS=$([ "$CI_JOB_STATUS" = "success" ] && echo "done" || echo "failed")
      curl -s -X POST "$TODO_WEBHOOK_URL" \\
        -H "Content-Type: application/json" \\
        -H "X-Gitlab-Event: Pipeline Hook" \\
        -d '{"status": "'$STATUS'", "message": "Pipeline #'$CI_PIPELINE_IID' '$CI_JOB_STATUS'"}'
  when: always
```

### Signature Verification
GitLab uses `X-Gitlab-Token` header. Set the same secret token on both sides.
""",
        "example_payload": {
            "status": "done",
            "message": "Pipeline #123 success",
        },
    },
    "jenkins": {
        "id": "jenkins",
        "name": "Jenkins",
        "provider": "jenkins",
        "icon": "jenkins",
        "description": "Receive build notifications from Jenkins",
        "type": "jenkins",
        "default_events": ["task.done", "task.failed", "project.complete"],
        "auth_type": "bearer",
        "setup_instructions": """## Setup Jenkins Integration

### Option A: Notification Plugin
1. Install the "Notification" plugin in Jenkins
2. In your job config, add a Post-build Action > HTTP Notification
3. Set URL to the task's webhook URL
4. Format: JSON

### Option B: Pipeline step
In your `Jenkinsfile`:

```groovy
pipeline {
  agent any
  stages {
    stage('Build') { steps { sh 'make build' } }
  }
  post {
    success {
      sh '''
        curl -s -X POST "${TODO_WEBHOOK_URL}" \\
          -H "Content-Type: application/json" \\
          -H "X-Jenkins-Source: shard" \\
          -d '{"build": {"phase": "FINALIZED", "status": "SUCCESS", "number": '${BUILD_NUMBER}', "full_url": "'${BUILD_URL}'"}}'
      '''
    }
    failure {
      sh '''
        curl -s -X POST "${TODO_WEBHOOK_URL}" \\
          -H "Content-Type: application/json" \\
          -H "X-Jenkins-Source: shard" \\
          -d '{"build": {"phase": "FINALIZED", "status": "FAILURE", "number": '${BUILD_NUMBER}', "full_url": "'${BUILD_URL}'"}}'
      '''
    }
  }
}
```

### Option C: Generic Webhook Trigger Plugin
Use the plugin to trigger builds and report back. The platform recognizes
Jenkins payload format (`build.phase`, `build.status`).

### Self-signed TLS
If your Jenkins uses a self-signed certificate, make sure the platform can reach it.
""",
        "example_payload": {
            "build": {
                "phase": "FINALIZED",
                "status": "SUCCESS",
                "number": 42,
                "full_url": "https://jenkins.example.com/job/my-app/42/",
            }
        },
    },
    "drone": {
        "id": "drone",
        "name": "Drone CI",
        "provider": "drone",
        "icon": "drone",
        "description": "Receive build notifications from Drone CI",
        "type": "drone",
        "default_events": ["task.done", "task.failed", "project.complete"],
        "auth_type": "bearer",
        "setup_instructions": """## Setup Drone CI Integration

Add a notification step to your `.drone.yml`:

```yaml
kind: pipeline
type: docker
name: default

steps:
  - name: build
    image: node:18
    commands:
      - npm ci
      - npm test

  - name: notify-success
    image: curlimages/curl
    commands:
      - |
        curl -s -X POST "$TODO_WEBHOOK_URL" \\
          -H "Content-Type: application/json" \\
          -H "X-Drone-Event: build" \\
          -d '{"status": "success", "build": {"number": '${DRONE_BUILD_NUMBER}', "link": "'${DRONE_BUILD_LINK}'", "after": "'${DRONE_COMMIT_SHA}'", "target": "'${DRONE_TARGET_BRANCH}'", "trigger": "'${DRONE_COMMIT_AUTHOR}'"}}'
    when:
      status: [success]

  - name: notify-failure
    image: curlimages/curl
    commands:
      - |
        curl -s -X POST "$TODO_WEBHOOK_URL" \\
          -H "Content-Type: application/json" \\
          -H "X-Drone-Event: build" \\
          -d '{"status": "failure", "build": {"number": '${DRONE_BUILD_NUMBER}', "link": "'${DRONE_BUILD_LINK}'", "after": "'${DRONE_COMMIT_SHA}'", "target": "'${DRONE_TARGET_BRANCH}'", "trigger": "'${DRONE_COMMIT_AUTHOR}'"}}'
    when:
      status: [failure]
```

The platform auto-detects Drone payloads via the `X-Drone-Event` header.
""",
        "example_payload": {
            "status": "success",
            "build": {
                "number": 42,
                "link": "https://drone.example.com/owner/repo/42",
                "after": "abc1234",
                "target": "main",
                "trigger": "user",
            },
        },
    },
    "bitbucket": {
        "id": "bitbucket",
        "name": "Bitbucket Pipelines",
        "provider": "bitbucket",
        "icon": "bitbucket",
        "description": "Receive notifications from Bitbucket Pipelines",
        "type": "bitbucket",
        "default_events": ["task.done", "task.failed", "project.complete"],
        "auth_type": "bearer",
        "setup_instructions": """## Setup Bitbucket Pipelines Integration

### Option A: Repository Webhook
1. Go to your Bitbucket repo > Settings > Webhooks
2. Add a webhook with the task's callback URL
3. Select triggers: "Build status created", "Build status updated"

### Option B: Pipeline step
In your `bitbucket-pipelines.yml`:

```yaml
pipelines:
  default:
    - step:
        name: Build
        script:
          - npm ci
          - npm test
        after-script:
          - |
            if [ "$BITBUCKET_EXIT_CODE" = "0" ]; then
              STATUS="done"
            else
              STATUS="failed"
            fi
            curl -s -X POST "$TODO_WEBHOOK_URL" \\
              -H "Content-Type: application/json" \\
              -d '{"status": "'$STATUS'", "message": "Pipeline #'$BITBUCKET_BUILD_NUMBER' '$STATUS'"}'
```

The platform auto-detects Bitbucket payloads via the `X-Event-Key` header.
""",
        "example_payload": {
            "status": "done",
            "message": "Pipeline #5 done",
        },
    },
    "circleci": {
        "id": "circleci",
        "name": "CircleCI",
        "provider": "generic",
        "icon": "circleci",
        "description": "Receive notifications from CircleCI workflows",
        "type": "circleci",
        "default_events": ["task.done", "task.failed", "project.complete"],
        "auth_type": "bearer",
        "setup_instructions": """## Setup CircleCI Integration

### Option A: Webhook (CircleCI Webhooks feature)
1. Go to Project Settings > Webhooks
2. Add a webhook with the task's callback URL
3. Select events: "workflow-completed"

### Option B: Job step
In your `.circleci/config.yml`:

```yaml
jobs:
  notify:
    docker:
      - image: cimg/base:stable
    steps:
      - run:
          name: Notify Shard
          command: |
            curl -s -X POST "$TODO_WEBHOOK_URL" \\
              -H "Content-Type: application/json" \\
              -d '{"status": "done", "message": "CircleCI workflow completed", "build_url": "'$CIRCLE_BUILD_URL'", "commit": "'$CIRCLE_SHA1'", "branch": "'$CIRCLE_BRANCH'"}'
          when: on_success
      - run:
          name: Notify failure
          command: |
            curl -s -X POST "$TODO_WEBHOOK_URL" \\
              -H "Content-Type: application/json" \\
              -d '{"status": "failed", "message": "CircleCI workflow failed", "build_url": "'$CIRCLE_BUILD_URL'", "commit": "'$CIRCLE_SHA1'", "branch": "'$CIRCLE_BRANCH'"}'
          when: on_fail

workflows:
  build-and-notify:
    jobs:
      - build
      - notify:
          requires: [build]
```
""",
        "example_payload": {
            "status": "done",
            "message": "CircleCI workflow completed",
            "build_url": "https://app.circleci.com/pipelines/github/owner/repo/42",
            "commit": "abc1234",
            "branch": "main",
        },
    },
}


def get_all_templates() -> list[dict]:
    """Return all available integration templates."""
    return [
        {
            "id": t["id"],
            "name": t["name"],
            "provider": t["provider"],
            "icon": t["icon"],
            "description": t["description"],
            "type": t["type"],
            "default_events": t["default_events"],
            "auth_type": t["auth_type"],
        }
        for t in TEMPLATES.values()
    ]


def get_template(template_id: str) -> dict | None:
    """Return full template details including setup instructions."""
    return TEMPLATES.get(template_id)
