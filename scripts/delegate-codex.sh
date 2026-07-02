#!/usr/bin/env bash
set -euo pipefail

# delegate-codex.sh — Run a Codex task in an isolated git worktree,
# auto-apply changes back to the current working directory.
#
# Usage:
#   ./scripts/delegate-codex.sh '<task description>' [model]
#
# The task runs against the last commit (HEAD). Uncommitted changes
# in the main worktree are NOT visible to Codex — commit first if
# Codex needs to see them.

TASK="${1:?Usage: delegate-codex.sh '<task description>' [model]}"
MODEL="${2:-gpt-5.5}"

TASK_ID="$(date +%s%N | cut -c1-13)"
WORKTREE_DIR="/tmp/codex-task-${TASK_ID}"
BRANCH_NAME="codex-task-${TASK_ID}"
ORIGINAL_DIR="$(pwd)"
MESSAGE_FILE="/tmp/codex-message-${TASK_ID}.txt"
DIFF_FILE="/tmp/codex-diff-${TASK_ID}.patch"
START_TIME="$(date +%s)"

cleanup() {
    cd "$ORIGINAL_DIR" 2>/dev/null || true
    git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
    git branch -D "$BRANCH_NAME" 2>/dev/null || true
    rm -f "$MESSAGE_FILE" 2>/dev/null || true
}
trap cleanup EXIT

echo "=== CODEX DELEGATION ==="
echo "Task:    $TASK"
echo "Model:   $MODEL"
echo "Task ID: $TASK_ID"
echo ""

echo ">>> Creating isolated worktree from HEAD..."
git worktree add "$WORKTREE_DIR" -b "$BRANCH_NAME" HEAD --quiet

echo ">>> Running Codex..."
cd "$WORKTREE_DIR"

CODEX_OUTPUT=$(codex exec \
    --dangerously-bypass-approvals-and-sandbox \
    -m "$MODEL" \
    -o "$MESSAGE_FILE" \
    "$TASK" 2>/dev/null) || true

git add -A 2>/dev/null || true
DIFF="$(git diff --cached HEAD)" || true

cd "$ORIGINAL_DIR"

ELAPSED=$(( $(date +%s) - START_TIME ))

echo ""
echo "=== RESULT (${ELAPSED}s) ==="

if [ -n "$DIFF" ]; then
    echo "$DIFF" > "$DIFF_FILE"

    if git apply --check "$DIFF_FILE" 2>/dev/null; then
        git apply "$DIFF_FILE"
        echo "Status:  APPLIED"
        echo ""
        echo "--- DIFF ---"
        echo "$DIFF"
    else
        echo "Status:  CONFLICT"
        echo "Patch:   $DIFF_FILE"
        echo ""
        echo "--- DIFF (not applied) ---"
        echo "$DIFF"
    fi

    rm -f "$DIFF_FILE" 2>/dev/null || true
else
    echo "Status:  NO CHANGES"
fi

if [ -f "$MESSAGE_FILE" ] && [ -s "$MESSAGE_FILE" ]; then
    echo ""
    echo "--- CODEX MESSAGE ---"
    cat "$MESSAGE_FILE"
fi

echo ""
echo "=== DONE ==="
