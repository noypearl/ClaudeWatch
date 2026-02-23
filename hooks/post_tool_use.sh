#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
#  ClaudWatch — Post-Tool-Use Hook
#  Notifies ClaudWatch that a tool finished, switching status → "thinking"
# ──────────────────────────────────────────────────────────────────────────────

CLAUDWATCH_URL="${CLAUDWATCH_URL:-http://localhost:4821}"
ENDPOINT="${CLAUDWATCH_URL}/api/hook/post-tool-use"

PAYLOAD=$(cat)

curl \
  --silent \
  --max-time 1 \
  --connect-timeout 0.5 \
  --request POST \
  --header "Content-Type: application/json" \
  --data "${PAYLOAD}" \
  "${ENDPOINT}" \
  > /dev/null 2>&1 &

exit 0
