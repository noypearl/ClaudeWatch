#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
#  ClaudWatch — Pre-Tool-Use Hook
#
#  Claude Code passes the hook payload as JSON on STDIN.
#  Payload shape: { "tool_name": "...", "tool_input": {...}, "session_id": "..." }
#
#  Install:
#    chmod +x ~/.claude/hooks/pre_tool_use.sh
#
#  Register via settings.json:
#    "hooks": { "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "$HOME/.claude/hooks/pre_tool_use.sh" }] }] }
#
#  Or launch Claude Code with:
#    CLAUDE_PRE_TOOL_USE_HOOK="$HOME/.claude/hooks/pre_tool_use.sh" claude
# ──────────────────────────────────────────────────────────────────────────────

CLAUDWATCH_URL="${CLAUDWATCH_URL:-http://localhost:4821}"
ENDPOINT="${CLAUDWATCH_URL}/api/hook/pre-tool-use"

# Read JSON payload from stdin (Claude Code pipes it here)
PAYLOAD=$(cat)

# Fire-and-forget POST — don't block Claude Code if the server is down
curl \
  --silent \
  --max-time 1 \
  --connect-timeout 0.5 \
  --request POST \
  --header "Content-Type: application/json" \
  --data "${PAYLOAD}" \
  "${ENDPOINT}" \
  > /dev/null 2>&1 &

# Always exit 0 so Claude Code continues normally
exit 0
