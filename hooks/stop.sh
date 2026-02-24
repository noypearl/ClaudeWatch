#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
#  ClaudeWatch — Stop Hook
#  Called when Claude Code session ends; sets status → "idle"
# ──────────────────────────────────────────────────────────────────────────────

CLAUDEWATCH_URL="${CLAUDEWATCH_URL:-http://localhost:4821}"

curl \
  --silent \
  --max-time 1 \
  --connect-timeout 0.5 \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{}' \
  "${CLAUDEWATCH_URL}/api/hook/stop" \
  > /dev/null 2>&1 &

exit 0
