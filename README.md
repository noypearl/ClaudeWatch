# 👁 ClaudWatch

> Real-time observability dashboard for **Claude Code** agent sessions.  
> Tail local JSONL logs, calculate live costs, and visualise the Plan → Act → Observe loop — all in your browser.

---

## Features

| Feature | Details |
|---|---|
| **Live Activity Stream** | Every user message, assistant turn, tool call and result rendered as a threaded tree |
| **Cost Ticker** | Cumulative USD cost, input/output/cache token breakdown, updated in real-time |
| **Tokens/sec Sparkline** | `recharts` area chart showing output throughput over the last 60 samples |
| **Agent Status Badge** | `idle` → `thinking` → `tool_running` indicator driven by lifecycle hooks |
| **Plan-Act-Observe Tree** | Tool calls nest under the assistant message that triggered them; results nest under their tool call |
| **Auto Session Switch** | Automatically detects the most recently modified `.jsonl` and switches on new sessions |
| **Zero Config** | One `./start.sh` installs everything and launches both servers |

---

## Architecture

```
~/.claude/projects/**/*.jsonl   ← data source (Claude Code writes here)
        │
        │  watchdog (filesystem events)
        ▼
┌─────────────────────────┐
│   FastAPI backend        │  :4821
│   server.py              │──── SSE /api/stream ──────────────────────┐
│   • FileTailer           │──── GET /api/snapshot                      │
│   • JSONL parser         │──── POST /api/hook/pre-tool-use            │
│   • Cost calculator      │──── POST /api/hook/post-tool-use           │
│   • SSE broadcaster      │──── POST /api/hook/stop                    │
└─────────────────────────┘                                             │
                                                                        ▼
                                                          ┌─────────────────────────┐
                                                          │   React / Vite frontend  │  :5173
                                                          │   • ActivityStream       │
                                                          │   • CostTicker           │
                                                          │   • TokenSparkline       │
                                                          │   • StatusBadge          │
                                                          └─────────────────────────┘
hooks/pre_tool_use.sh  ──POST──▶  /api/hook/pre-tool-use
hooks/post_tool_use.sh ──POST──▶  /api/hook/post-tool-use
hooks/stop.sh          ──POST──▶  /api/hook/stop
```

---

## Prerequisites

| Tool | Minimum version |
|---|---|
| Python | 3.11+ |
| Node.js | 18+ |
| npm | 9+ |
| Claude Code | any recent version |

---

## Quick Start

```bash
# 1. Clone / open the project
cd ~/Documents/ClaudeWatch

# 2. Run the one-shot startup script (dev mode)
./start.sh

# Backend  → http://localhost:4821
# Frontend → http://localhost:5173
```

That's it. `start.sh` will:

1. Create `backend/.venv` and `pip install` all Python deps
2. `npm install` the frontend
3. Copy hook scripts to `~/.claude/hooks/`
4. Launch the FastAPI backend (with `--reload`) and the Vite dev server in parallel

Open **http://localhost:5173** in your browser, then start a Claude Code session — the stream will populate automatically.

### Production mode (single process)

```bash
./start.sh --prod
# Builds the frontend → frontend/dist/
# FastAPI serves the built UI at http://localhost:4821
```

---

## Manual Setup

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --host 127.0.0.1 --port 4821 --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev        # dev server at :5173
# or
npm run build      # production build → dist/
```

---

## Hook Integration

Hooks let ClaudWatch show a live **"Agent is running tool…"** indicator in the UI without waiting for the next log flush.

### Automatic (via `start.sh`)

`start.sh` copies the hook scripts to `~/.claude/hooks/`. To also auto-write `~/.claude/settings.json`, open `start.sh` and flip:

```bash
ENABLE_HOOKS=true   # line 66
```

> ⚠️ Only do this if `~/.claude/settings.json` does not yet exist. If it does, merge manually (see below).

### Manual — merge into `~/.claude/settings.json`

Add the following `hooks` block (use `claude_settings_snippet.json` as a reference):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [{ "type": "command", "command": "$HOME/.claude/hooks/pre_tool_use.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [{ "type": "command", "command": "$HOME/.claude/hooks/post_tool_use.sh" }]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "command", "command": "$HOME/.claude/hooks/stop.sh" }]
      }
    ]
  }
}
```

### Exact CLI syntax (per-session override)

```bash
# Point hooks at a custom ClaudWatch port
CLAUDWATCH_URL=http://localhost:4821 claude

# Or pass hooks directly on the command line
claude \
  --pre-tool-use  "$HOME/.claude/hooks/pre_tool_use.sh" \
  --post-tool-use "$HOME/.claude/hooks/post_tool_use.sh"
```

---

## Pricing Reference

Costs are calculated per assistant turn using the `usage` block in each JSONL line.  
All four token buckets are accounted for:

| Bucket | Field |
|---|---|
| Input | `input_tokens` |
| Output | `output_tokens` |
| Cache write | `cache_creation_input_tokens` |
| Cache read | `cache_read_input_tokens` |

Current rates (USD per 1 M tokens):

| Model | Input | Output | Cache write | Cache read |
|---|---|---|---|---|
| claude-3-7-sonnet | $3.00 | $15.00 | $3.75 | $0.30 |
| claude-3-5-sonnet | $3.00 | $15.00 | $3.75 | $0.30 |
| claude-3-5-haiku | $0.80 | $4.00 | $1.00 | $0.08 |
| claude-3-opus | $15.00 | $75.00 | $18.75 | $1.50 |
| claude-opus-4 / claude-opus-4-6 | $15.00 | $75.00 | $18.75 | $1.50 |

Unknown models fall back to claude-3-5-sonnet rates. Update `MODEL_PRICING` in `backend/server.py` to add new models.

---

## Project Structure

```
ClaudeWatch/
├── backend/
│   ├── server.py              # FastAPI: log tailer, SSE, hook endpoints, cost calc
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── src/
│       ├── App.tsx                      # Root layout
│       ├── types.ts                     # LogEntry, Stats, SparkPoint
│       ├── index.css                    # Tailwind + custom scrollbar / prose
│       ├── hooks/
│       │   └── useClaudWatch.ts         # SSE state machine + auto-reconnect
│       └── components/
│           ├── ActivityStream.tsx       # Plan-Act-Observe tree builder
│           ├── MessageBubble.tsx        # User / assistant / tool_use / tool_result
│           ├── CostTicker.tsx           # Cost card + token breakdown rows
│           ├── TokenSparkline.tsx       # recharts area sparkline
│           └── StatusBadge.tsx          # Live / idle / thinking / tool_running
├── hooks/
│   ├── pre_tool_use.sh        # POSTs to /api/hook/pre-tool-use
│   ├── post_tool_use.sh       # POSTs to /api/hook/post-tool-use
│   └── stop.sh                # POSTs to /api/hook/stop
├── claude_settings_snippet.json   # Paste into ~/.claude/settings.json
└── start.sh                   # One-shot setup + launch (dev & prod modes)
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/stream` | SSE stream — push events to all connected tabs |
| `GET` | `/api/snapshot` | Current state snapshot (stats + last 200 messages) |
| `GET` | `/api/status` | Stats object only |
| `POST` | `/api/hook/pre-tool-use` | Set status → `tool_running` |
| `POST` | `/api/hook/post-tool-use` | Set status → `thinking` |
| `POST` | `/api/hook/stop` | Set status → `idle` |

### SSE Event Types

| Event | Payload |
|---|---|
| `snapshot` | `{ stats, messages[] }` — sent once on connect |
| `log_entry` | Single `LogEntry` — new line parsed from the JSONL |
| `stats` | `Stats` object — heartbeat every 2 s |
| `status_change` | `{ agent_status, current_tool }` — from hooks |
| `session_reset` | `{ session_id, active_file }` — new `.jsonl` detected |
| `ping` | `{}` — keepalive every 15 s |

---

## Troubleshooting

**Stream shows "Waiting for Claude Code activity…"**  
→ Check that `~/.claude/projects/` exists and contains `.jsonl` files.  
→ Verify the backend is running: `curl http://localhost:4821/api/status`

**Status badge always shows "Idle" even during a run**  
→ Hooks are not registered. Follow the [Hook Integration](#hook-integration) steps above.

**`pip install` fails**  
→ Ensure Python 3.11+ is active: `python3 --version`

**Port already in use**  
→ Change `BACKEND_PORT` / `FRONTEND_PORT` at the top of `start.sh` and update `vite.config.ts` proxy target accordingly.
