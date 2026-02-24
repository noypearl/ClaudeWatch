"""
ClaudeWatch — Real-time observability dashboard for Claude Code sessions.
Backend: FastAPI + watchdog (file-system monitor) + SSE push to frontend.

Run:  uvicorn server:app --reload --port 4821
"""

from __future__ import annotations

import asyncio
import glob
import json
import logging
import os
import time
from collections import deque
from pathlib import Path
from typing import AsyncIterator, Optional

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from watchdog.events import FileModifiedEvent, FileSystemEventHandler
from watchdog.observers import Observer

# ─────────────────────────────────────────────
#  Logging
# ─────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(levelname)s │ %(message)s")
log = logging.getLogger("claudewatch")

# ─────────────────────────────────────────────
#  Anthropic pricing  (USD per 1 M tokens)
#  Updated: Feb 2026
# ─────────────────────────────────────────────
MODEL_PRICING: dict[str, dict[str, float]] = {
    # ── Claude 3.7 ──────────────────────────────
    "claude-3-7-sonnet":                 {"input": 3.00,  "output": 15.00, "cache_write": 3.75,  "cache_read": 0.30},
    "claude-3-7-sonnet-20250219":        {"input": 3.00,  "output": 15.00, "cache_write": 3.75,  "cache_read": 0.30},
    # ── Claude 3.5 ──────────────────────────────
    "claude-3-5-sonnet":                 {"input": 3.00,  "output": 15.00, "cache_write": 3.75,  "cache_read": 0.30},
    "claude-3-5-sonnet-20241022":        {"input": 3.00,  "output": 15.00, "cache_write": 3.75,  "cache_read": 0.30},
    "claude-3-5-sonnet-20240620":        {"input": 3.00,  "output": 15.00, "cache_write": 3.75,  "cache_read": 0.30},
    "claude-3-5-haiku":                  {"input": 0.80,  "output": 4.00,  "cache_write": 1.00,  "cache_read": 0.08},
    "claude-3-5-haiku-20241022":         {"input": 0.80,  "output": 4.00,  "cache_write": 1.00,  "cache_read": 0.08},
    # ── Claude 3 Opus ────────────────────────────
    "claude-3-opus":                     {"input": 15.00, "output": 75.00, "cache_write": 18.75, "cache_read": 1.50},
    "claude-3-opus-20240229":            {"input": 15.00, "output": 75.00, "cache_write": 18.75, "cache_read": 1.50},
    # ── Claude 4 family ──────────────────────────
    "claude-opus-4":                     {"input": 15.00, "output": 75.00, "cache_write": 18.75, "cache_read": 1.50},
    "claude-opus-4-5":                   {"input": 15.00, "output": 75.00, "cache_write": 18.75, "cache_read": 1.50},
    "claude-opus-4-6":                   {"input": 15.00, "output": 75.00, "cache_write": 18.75, "cache_read": 1.50},
    "claude-sonnet-4":                   {"input": 3.00,  "output": 15.00, "cache_write": 3.75,  "cache_read": 0.30},
    "claude-sonnet-4-5":                 {"input": 3.00,  "output": 15.00, "cache_write": 3.75,  "cache_read": 0.30},
    "claude-sonnet-4-6":                 {"input": 3.00,  "output": 15.00, "cache_write": 3.75,  "cache_read": 0.30},
    "claude-haiku-4":                    {"input": 0.80,  "output": 4.00,  "cache_write": 1.00,  "cache_read": 0.08},
    "claude-haiku-4-5":                  {"input": 0.80,  "output": 4.00,  "cache_write": 1.00,  "cache_read": 0.08},
    "claude-haiku-4-6":                  {"input": 0.80,  "output": 4.00,  "cache_write": 1.00,  "cache_read": 0.08},
    # ── Claude 3 Sonnet / Haiku ─────────────────
    "claude-3-sonnet":                   {"input": 3.00,  "output": 15.00, "cache_write": 3.75,  "cache_read": 0.30},
    "claude-3-haiku":                    {"input": 0.25,  "output": 1.25,  "cache_write": 0.30,  "cache_read": 0.03},
    "claude-3-haiku-20240307":           {"input": 0.25,  "output": 1.25,  "cache_write": 0.30,  "cache_read": 0.03},
}

_FALLBACK_PRICING = {"input": 3.00, "output": 15.00, "cache_write": 3.75, "cache_read": 0.30}


def _pricing_for(model: str) -> dict[str, float]:
    """Return pricing dict for a model string, using prefix-match fallback."""
    if not model:
        return _FALLBACK_PRICING
    # Silently ignore synthetic/internal model identifiers used by Claude Code
    if model.startswith("<") and model.endswith(">"):
        return _FALLBACK_PRICING
    if model in MODEL_PRICING:
        return MODEL_PRICING[model]
    # prefix match (e.g. "claude-3-7-sonnet-20250219" → "claude-3-7-sonnet")
    for key in MODEL_PRICING:
        if model.startswith(key):
            return MODEL_PRICING[key]
    log.warning("Unknown model '%s' — using fallback pricing", model)
    return _FALLBACK_PRICING


def calc_turn_cost(model: str, usage: dict) -> float:
    """Calculate USD cost for one assistant turn's usage block."""
    p = _pricing_for(model)
    inp   = usage.get("input_tokens", 0)
    out   = usage.get("output_tokens", 0)
    cw    = usage.get("cache_creation_input_tokens", 0)
    cr    = usage.get("cache_read_input_tokens", 0)
    # cache_creation counts separately from raw input_tokens in Claude API
    cost  = (inp  / 1_000_000) * p["input"]
    cost += (out  / 1_000_000) * p["output"]
    cost += (cw   / 1_000_000) * p["cache_write"]
    cost += (cr   / 1_000_000) * p["cache_read"]
    return cost


# ─────────────────────────────────────────────
#  Shared in-memory state
# ─────────────────────────────────────────────
class SessionState:
    def __init__(self):
        self.reset()

    def reset(self):
        self.session_id: str = ""
        self.active_file: str = ""
        self.total_cost: float = 0.0
        self.total_input_tokens: int = 0
        self.total_output_tokens: int = 0
        self.total_cache_write: int = 0
        self.total_cache_read: int = 0
        self.messages: list[dict] = []
        # Token-rate tracking: (timestamp, cumulative_output_tokens)
        self.token_history: deque[tuple[float, int]] = deque(maxlen=60)
        self.agent_status: str = "idle"   # idle | thinking | tool_running
        self.current_tool: str = ""


STATE = SessionState()

# SSE subscriber queues — one asyncio.Queue per connected browser tab
_subscribers: list[asyncio.Queue] = []

# Memory tracking — watch MEMORY.md in the active project's cwd
_memory_state: dict = {"path": "", "mtime": 0.0}


async def _broadcast(event: str, data: dict):
    """Push a JSON event to all SSE subscribers."""
    payload = json.dumps(data)
    dead: list[asyncio.Queue] = []
    for q in _subscribers:
        try:
            q.put_nowait({"event": event, "data": payload})
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _subscribers.remove(q)


# ─────────────────────────────────────────────
#  Agent Registry — in-memory multi-agent state
# ─────────────────────────────────────────────

# agent_id → metadata dict
AGENT_REGISTRY: dict[str, dict] = {}

# Per-agent file tailers (session_id → FileTailer)
_agent_tailers: dict[str, "FileTailer"] = {}


def _infer_agent_type(task: str) -> str:
    """Heuristically classify an agent's type from its task description."""
    t = task.lower()
    if any(w in t for w in ["explore", "search", "find", "look", "investigate", "browse", "read", "check", "scan", "examine"]):
        return "Explore"
    if any(w in t for w in ["plan", "design", "architect", "strategy", "outline", "analyze", "review", "assess"]):
        return "Plan"
    return "General"


def _make_agent_dict(
    agent_id: str,
    parent_id: Optional[str] = None,
    agent_type: str = "General",
    purpose: str = "",
    status: str = "spawning",
    file_path: str = "",
) -> dict:
    return {
        "agent_id": agent_id,
        "parent_id": parent_id,
        "type": agent_type,
        "purpose": purpose[:300] if purpose else "",
        "status": status,
        "log_tail": [],
        "spawned_at": time.time(),
        "file_path": file_path,
        "tokens": {"input": 0, "output": 0},
        "cost": 0.0,
    }


async def _broadcast_agent_update(agent_id: str):
    """Broadcast agent state to all SSE subscribers."""
    agent = AGENT_REGISTRY.get(agent_id)
    if agent:
        await _broadcast("agent_update", agent)


def _agents_payload() -> list[dict]:
    return list(AGENT_REGISTRY.values())


async def _register_task_agent(ev: dict):
    """Register a pending subagent discovered via a Task tool_use event."""
    tool_input = ev.get("toolInput") or {}
    # Claude Code Task tool uses 'prompt' as the primary field;
    # fall back to other common variants
    task_desc = (
        tool_input.get("prompt") or
        tool_input.get("description") or
        tool_input.get("task") or
        tool_input.get("message") or
        # Last resort: dump the whole input as a string for display
        (", ".join(f"{k}: {v}" for k, v in tool_input.items() if isinstance(v, str))[:300])
        if tool_input else ""
    )
    tool_use_id = ev.get("toolUseId", "")
    if not tool_use_id:
        return
    if tool_use_id in AGENT_REGISTRY:
        return   # already registered

    agent_type = _infer_agent_type(task_desc)
    AGENT_REGISTRY[tool_use_id] = _make_agent_dict(
        agent_id=tool_use_id,
        parent_id=STATE.session_id or None,
        agent_type=agent_type,
        purpose=task_desc,
        status="spawning",
    )
    await _broadcast_agent_update(tool_use_id)
    log.info("Registered pending subagent %s (%s): %.60s", tool_use_id, agent_type, task_desc)


async def _drain_agent_file(agent_id: str, path: str):
    """Read new lines from an agent's JSONL file, update log_tail and token counts."""
    agent = AGENT_REGISTRY.get(agent_id)
    tailer = _agent_tailers.get(agent_id)
    if not agent or not tailer:
        return

    changed = False
    for raw in tailer.drain():
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            continue

        # Track token usage & cost per-agent
        if d.get("type") == "assistant":
            msg = d.get("message", {})
            model = msg.get("model") or ""
            usage = msg.get("usage") or {}
            if usage:
                turn_cost = calc_turn_cost(model, usage)
                agent["cost"] = agent.get("cost", 0.0) + turn_cost
                tok = agent.setdefault("tokens", {"input": 0, "output": 0})
                tok["input"]  += usage.get("input_tokens", 0)
                tok["output"] += usage.get("output_tokens", 0)
                changed = True

            # Also auto-classify type from assistant model if still General
            if agent.get("type") == "General" and model:
                pass  # keep General unless a Task tool_use reclassifies it

        # If purpose is still empty, try to read it from the first real user message
        if not agent.get("purpose") and d.get("type") == "user":
            msg = d.get("message", {})
            content = msg.get("content", "")
            # Skip synthetic tool_result messages
            if isinstance(content, list) and any(
                isinstance(b, dict) and b.get("type") == "tool_result" for b in content
            ):
                pass
            else:
                text = _extract_text(content).strip()
                if len(text) > 8 and not text.startswith("<"):
                    agent["purpose"] = text[:300]
                    agent["type"] = _infer_agent_type(text)
                    changed = True

        # Update log tail (keep last 2 non-empty assistant text lines)
        if d.get("type") == "assistant":
            msg = d.get("message", {})
            content = msg.get("content", "")
            text_line = ""
            if isinstance(content, str):
                text_line = content.strip()[:120]
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        t = (block.get("text") or "").strip()
                        if t:
                            text_line = t[:120]
                            break

            if text_line:
                log_tail: list = agent.setdefault("log_tail", [])
                log_tail.append(text_line)
                if len(log_tail) > 2:
                    agent["log_tail"] = log_tail[-2:]
                changed = True

    if changed:
        await _broadcast_agent_update(agent_id)


# ─────────────────────────────────────────────
#  JSONL parser — produce UI-ready dicts
# ─────────────────────────────────────────────

def _extract_text(content) -> str:
    """Flatten content (string or list of blocks) to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(block.get("text", ""))
                elif block.get("type") == "tool_result":
                    inner = block.get("content", "")
                    parts.append(_extract_text(inner))
        return "\n".join(p for p in parts if p)
    return str(content)


def parse_line(raw: str) -> Optional[dict]:
    """
    Parse one JSONL line and return a UI event dict, or None to skip.

    Returned dict shape:
      {
        "uuid": str,
        "parentUuid": str | None,
        "sessionId": str,
        "timestamp": str,
        "type": "user" | "assistant" | "tool_use" | "tool_result",
        "role": str,
        "model": str | None,
        "text": str,           # human-readable content
        "toolName": str | None,
        "toolInput": dict | None,
        "toolUseId": str | None,
        "usage": dict | None,
        "cost": float,
        "cumulative_cost": float,
        "total_input_tokens": int,
        "total_output_tokens": int,
      }
    """
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        return None

    entry_type = d.get("type", "")
    if entry_type not in ("user", "assistant"):
        return None

    msg = d.get("message", {})
    role = msg.get("role", entry_type)
    content = msg.get("content", "")
    model = msg.get("model") or ""
    usage = msg.get("usage") or {}

    turn_cost = 0.0
    if usage and role == "assistant":
        turn_cost = calc_turn_cost(model, usage)
        STATE.total_cost += turn_cost
        STATE.total_input_tokens  += usage.get("input_tokens", 0)
        STATE.total_output_tokens += usage.get("output_tokens", 0)
        STATE.total_cache_write   += usage.get("cache_creation_input_tokens", 0)
        STATE.total_cache_read    += usage.get("cache_read_input_tokens", 0)
        STATE.token_history.append((time.time(), STATE.total_output_tokens))

    uuid       = d.get("uuid", "")
    parent_uuid = d.get("parentUuid")
    session_id = d.get("sessionId", "")
    timestamp  = d.get("timestamp", "")

    # ── Determine UI type ──────────────────────────────
    if isinstance(content, list):
        events: list[dict] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type", "")

            if btype == "text":
                events.append({
                    "uuid": uuid,
                    "parentUuid": parent_uuid,
                    "sessionId": session_id,
                    "timestamp": timestamp,
                    "type": "assistant",
                    "role": "assistant",
                    "model": model,
                    "text": block.get("text", ""),
                    "toolName": None,
                    "toolInput": None,
                    "toolUseId": None,
                    "usage": usage,
                    "cost": turn_cost,
                    "cumulative_cost": STATE.total_cost,
                    "total_input_tokens": STATE.total_input_tokens,
                    "total_output_tokens": STATE.total_output_tokens,
                })

            elif btype == "tool_use":
                events.append({
                    "uuid": uuid,
                    "parentUuid": parent_uuid,
                    "sessionId": session_id,
                    "timestamp": timestamp,
                    "type": "tool_use",
                    "role": "assistant",
                    "model": model,
                    "text": f"Using tool: {block.get('name', '')}",
                    "toolName": block.get("name"),
                    "toolInput": block.get("input"),
                    "toolUseId": block.get("id"),
                    "usage": usage,
                    "cost": turn_cost,
                    "cumulative_cost": STATE.total_cost,
                    "total_input_tokens": STATE.total_input_tokens,
                    "total_output_tokens": STATE.total_output_tokens,
                })
                STATE.current_tool = block.get("name", "")
                STATE.agent_status = "tool_running"

            elif btype == "tool_result":
                tool_text = _extract_text(block.get("content", ""))
                events.append({
                    "uuid": uuid,
                    "parentUuid": parent_uuid,
                    "sessionId": session_id,
                    "timestamp": timestamp,
                    "type": "tool_result",
                    "role": "tool",
                    "model": None,
                    "text": tool_text[:400] + ("…" if len(tool_text) > 400 else ""),
                    "toolName": None,
                    "toolInput": None,
                    "toolUseId": block.get("tool_use_id"),
                    "usage": None,
                    "cost": 0.0,
                    "cumulative_cost": STATE.total_cost,
                    "total_input_tokens": STATE.total_input_tokens,
                    "total_output_tokens": STATE.total_output_tokens,
                })
                STATE.agent_status = "thinking"

        return events if events else None

    else:
        # Plain user message
        text = _extract_text(content)
        if not text:
            return None
        return [{
            "uuid": uuid,
            "parentUuid": parent_uuid,
            "sessionId": session_id,
            "timestamp": timestamp,
            "type": "user",
            "role": "user",
            "model": None,
            "text": text,
            "toolName": None,
            "toolInput": None,
            "toolUseId": None,
            "usage": None,
            "cost": 0.0,
            "cumulative_cost": STATE.total_cost,
            "total_input_tokens": STATE.total_input_tokens,
            "total_output_tokens": STATE.total_output_tokens,
        }]


# ─────────────────────────────────────────────
#  File tailer
# ─────────────────────────────────────────────
class FileTailer:
    """Track read position in a file and yield only new lines."""

    def __init__(self, path: str):
        self.path = path
        self._offset = 0

    def set_path(self, path: str):
        self.path = path
        self._offset = 0

    def drain(self) -> list[str]:
        """Return all lines added since last drain."""
        if not os.path.exists(self.path):
            return []
        lines: list[str] = []
        try:
            with open(self.path, "r", encoding="utf-8", errors="replace") as fh:
                fh.seek(self._offset)
                chunk = fh.read()
                self._offset = fh.tell()
        except OSError:
            return []
        for line in chunk.splitlines():
            line = line.strip()
            if line:
                lines.append(line)
        return lines


TAILER = FileTailer("")


def find_active_log() -> str:
    """Return path to the most recently modified .jsonl under ~/.claude/projects/."""
    base = Path.home() / ".claude" / "projects"
    candidates = list(base.rglob("*.jsonl"))
    if not candidates:
        return ""
    return str(max(candidates, key=lambda p: p.stat().st_mtime))


# ─────────────────────────────────────────────
#  Watchdog handler
# ─────────────────────────────────────────────
class LogHandler(FileSystemEventHandler):
    def __init__(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop

    def on_modified(self, event):
        if isinstance(event, FileModifiedEvent) and event.src_path.endswith(".jsonl"):
            asyncio.run_coroutine_threadsafe(self._process(event.src_path), self._loop)

    def on_created(self, event):
        if event.src_path.endswith(".jsonl"):
            asyncio.run_coroutine_threadsafe(self._process(event.src_path), self._loop)

    async def _process(self, path: str):
        file_stem = Path(path).stem

        # ── 1. Currently active main session ──────────────────────────────
        if path == TAILER.path:
            for raw in TAILER.drain():
                result = parse_line(raw)
                if result is None:
                    continue
                events = result if isinstance(result, list) else [result]
                for ev in events:
                    STATE.messages.append(ev)
                    await _broadcast("log_entry", ev)
                    # Detect Task tool spawning a subagent
                    if ev.get("type") == "tool_use" and ev.get("toolName") == "Task":
                        await _register_task_agent(ev)
            await _broadcast("stats", _stats_payload())
            await _check_memory_update()
            return

        # ── 2. Known subagent tailer ───────────────────────────────────────
        if file_stem in _agent_tailers:
            await _drain_agent_file(file_stem, path)
            await _broadcast("stats", _stats_payload())
            return

        # ── 3. Brand-new file ─────────────────────────────────────────────
        if TAILER.path:
            current_dir = Path(TAILER.path).parent
            new_dir     = Path(path).parent
            if new_dir == current_dir:
                # Same project directory → treat as new subagent session file
                log.info("New subagent file detected: %s", path)
                if file_stem not in AGENT_REGISTRY:
                    AGENT_REGISTRY[file_stem] = _make_agent_dict(
                        agent_id=file_stem,
                        parent_id=STATE.session_id,
                        agent_type="General",
                        purpose="",
                        status="running",
                        file_path=path,
                    )
                else:
                    # Hook may have pre-registered it — just set file path & status
                    AGENT_REGISTRY[file_stem]["file_path"] = path
                    if AGENT_REGISTRY[file_stem].get("status") == "spawning":
                        AGENT_REGISTRY[file_stem]["status"] = "running"

                _agent_tailers[file_stem] = FileTailer(path)
                await _drain_agent_file(file_stem, path)
                await _broadcast_agent_update(file_stem)
                await _broadcast("stats", _stats_payload())
                return

        # ── 4. Different directory or no main session → switch main session
        log.info("Switching to log: %s", path)
        # Clear the per-project agent registry when switching to a new project
        AGENT_REGISTRY.clear()
        _agent_tailers.clear()
        STATE.reset()
        STATE.active_file = path
        STATE.session_id  = file_stem
        TAILER.set_path(path)
        await _broadcast("session_reset", {
            "session_id": STATE.session_id,
            "active_file": path,
        })
        # Reset memory watcher so MEMORY.md for new project is re-read
        _memory_state["path"] = ""
        await _check_memory_update()

        for raw in TAILER.drain():
            result = parse_line(raw)
            if result is None:
                continue
            events = result if isinstance(result, list) else [result]
            for ev in events:
                STATE.messages.append(ev)
                await _broadcast("log_entry", ev)
                if ev.get("type") == "tool_use" and ev.get("toolName") == "Task":
                    await _register_task_agent(ev)

        await _broadcast("stats", _stats_payload())


def _stats_payload() -> dict:
    tps = _tokens_per_second()
    subagent_cost   = sum(a.get("cost", 0.0) for a in AGENT_REGISTRY.values())
    subagent_input  = sum(a.get("tokens", {}).get("input",  0) for a in AGENT_REGISTRY.values())
    subagent_output = sum(a.get("tokens", {}).get("output", 0) for a in AGENT_REGISTRY.values())
    active_count    = sum(1 for a in AGENT_REGISTRY.values() if a.get("status") in ("spawning", "running"))
    return {
        "total_cost": round(STATE.total_cost, 6),
        "total_input_tokens": STATE.total_input_tokens,
        "total_output_tokens": STATE.total_output_tokens,
        "total_cache_write": STATE.total_cache_write,
        "total_cache_read": STATE.total_cache_read,
        "agent_status": STATE.agent_status,
        "current_tool": STATE.current_tool,
        "session_id": STATE.session_id,
        "active_file": STATE.active_file,
        "tokens_per_second": tps,
        "subagent_cost": round(subagent_cost, 6),
        "subagent_input_tokens": subagent_input,
        "subagent_output_tokens": subagent_output,
        "active_agent_count": active_count,
    }


async def _check_memory_update():
    """Broadcast memory_update if MEMORY.md in the active project's cwd changed."""
    if not STATE.active_file:
        return
    cwd = _read_cwd(STATE.active_file)
    if not cwd or not os.path.isdir(cwd):
        return
    memory_file = Path(cwd) / "MEMORY.md"
    try:
        mtime = memory_file.stat().st_mtime
    except OSError:
        return
    current_path = str(memory_file)
    if current_path != _memory_state["path"] or mtime != _memory_state["mtime"]:
        _memory_state["path"] = current_path
        _memory_state["mtime"] = mtime
        try:
            content = memory_file.read_text(encoding="utf-8", errors="replace")
            await _broadcast("memory_update", {"content": content, "path": current_path})
            log.info("Memory update from %s", current_path)
        except OSError:
            pass


def _tokens_per_second(window: float = 10.0) -> float:
    """Compute output tokens/sec over the last `window` seconds."""
    now = time.time()
    hist = [h for h in STATE.token_history if now - h[0] <= window]
    if len(hist) < 2:
        return 0.0
    dt = hist[-1][0] - hist[0][0]
    if dt <= 0:
        return 0.0
    return round((hist[-1][1] - hist[0][1]) / dt, 2)


# ─────────────────────────────────────────────
#  FastAPI app
# ─────────────────────────────────────────────
app = FastAPI(title="ClaudeWatch", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── SSE stream ─────────────────────────────────
@app.get("/api/stream")
async def stream(request: Request):
    queue: asyncio.Queue = asyncio.Queue(maxsize=500)
    _subscribers.append(queue)

    async def event_generator() -> AsyncIterator[dict]:
        # Send current state snapshot on connect
        yield {
            "event": "snapshot",
            "data": json.dumps({
                "stats": _stats_payload(),
                "messages": STATE.messages[-200:],  # last 200 messages
                "agents": _agents_payload(),
            }),
        }
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield item
                except asyncio.TimeoutError:
                    # Heartbeat to keep connection alive
                    yield {"event": "ping", "data": "{}"}
        finally:
            try:
                _subscribers.remove(queue)
            except ValueError:
                pass

    return EventSourceResponse(event_generator())


# ── REST: snapshot ──────────────────────────────
@app.get("/api/snapshot")
async def snapshot():
    return {
        "stats": _stats_payload(),
        "messages": STATE.messages[-200:],
        "agents": _agents_payload(),
    }


# ── REST: active log info ───────────────────────
@app.get("/api/status")
async def api_status():
    return _stats_payload()


# ── REST: list all sessions ──────────────────────

def _read_cwd(file_path: str) -> str:
    """
    Read the 'cwd' field from the first JSONL entry that has it.
    This is the only reliable way to get the real project path because the
    directory slug (e.g. '-Users-USERNAME-Downloads-blah-bleu') cannot be
    decoded unambiguously when folder names themselves contain dashes.
    Only scans the first 20 lines to stay fast.
    """
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh):
                if i >= 20:
                    break
                try:
                    d = json.loads(line)
                    cwd = d.get("cwd", "")
                    if cwd:
                        return cwd
                except json.JSONDecodeError:
                    pass
    except OSError:
        pass
    return ""


def _home_relative(path: str) -> str:
    """Replace the $HOME prefix with '~' for compact display."""
    home = str(Path.home())
    if path.startswith(home):
        return "~" + path[len(home):]
    return path


def list_sessions() -> list[dict]:
    """Return metadata for every .jsonl file under ~/.claude/projects/."""
    base = Path.home() / ".claude" / "projects"
    results: list[dict] = []
    for f in base.rglob("*.jsonl"):
        try:
            stat = f.stat()
        except OSError:
            continue
        project_dir = f.parent.name
        cwd         = _read_cwd(str(f))
        project_path = _home_relative(cwd) if cwd else f"~/.claude/projects/{project_dir}"
        # Human-readable name = last path segment of the actual cwd
        project_name = Path(cwd).name if cwd else project_dir
        results.append({
            "session_id":    f.stem,
            "file_path":     str(f),
            "project":       project_name,   # e.g. "chrome-ai-src"
            "project_path":  project_path,   # e.g. "~/Downloads/chrome-ai-src"
            "project_dir":   project_dir,    # raw slug
            "size_bytes":    stat.st_size,
            "modified_at":   stat.st_mtime,
            "is_active":     str(f) == STATE.active_file,
        })
    results.sort(key=lambda x: x["modified_at"], reverse=True)
    return results


@app.get("/api/sessions")
async def get_sessions():
    return list_sessions()


# ── REST: projects (hierarchical) ────────────────

def _get_first_user_message(file_path: str) -> str:
    """Return the first genuine human user message as a goal label."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh):
                if i >= 80:
                    break
                try:
                    d = json.loads(line)
                    if d.get("type") != "user":
                        continue
                    msg = d.get("message", {})
                    content = msg.get("content", "")
                    # Skip synthetic tool_result user messages
                    if isinstance(content, list):
                        if any(
                            isinstance(b, dict) and b.get("type") == "tool_result"
                            for b in content
                        ):
                            continue
                    text = _extract_text(content).strip()
                    # Skip very short or system-looking messages
                    if len(text) > 8 and not text.startswith("<"):
                        return text[:220]
                except json.JSONDecodeError:
                    pass
    except OSError:
        pass
    return ""


def _calc_session_cost(file_path: str) -> float:
    """Compute the total USD cost for one session JSONL file."""
    total = 0.0
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    d = json.loads(line)
                    if d.get("type") != "assistant":
                        continue
                    msg = d.get("message", {})
                    model = msg.get("model") or ""
                    usage = msg.get("usage") or {}
                    if usage:
                        total += calc_turn_cost(model, usage)
                except json.JSONDecodeError:
                    pass
    except OSError:
        pass
    return total


@app.get("/api/projects")
async def get_projects():
    """Return a hierarchical view: one entry per project dir with its 5 most recent sessions."""
    base = Path.home() / ".claude" / "projects"
    now = time.time()
    projects: list[dict] = []

    if not base.exists():
        return []

    for project_dir in base.iterdir():
        if not project_dir.is_dir():
            continue

        jsonl_files = list(project_dir.glob("*.jsonl"))
        if not jsonl_files:
            continue

        sessions_meta: list[dict] = []
        total_cost: float = 0.0
        latest_mtime: float = 0.0
        project_cwd: str = ""

        for f in jsonl_files:
            try:
                stat = f.stat()
            except OSError:
                continue

            if not project_cwd:
                project_cwd = _read_cwd(str(f))

            session_cost = _calc_session_cost(str(f))
            total_cost += session_cost
            if stat.st_mtime > latest_mtime:
                latest_mtime = stat.st_mtime

            is_active_session = (now - stat.st_mtime) < 60
            goal = _get_first_user_message(str(f))
            sessions_meta.append({
                "session_id":   f.stem,
                "file_path":    str(f),
                "goal":         goal,
                "modified_at":  stat.st_mtime,
                "size_bytes":   stat.st_size,
                "is_active":    is_active_session,
                "session_cost": round(session_cost, 6),
            })

        # Sort all sessions newest-first, keep top 5 for the payload
        sessions_meta.sort(key=lambda x: x["modified_at"], reverse=True)
        recent_sessions = sessions_meta[:5]

        project_name = Path(project_cwd).name if project_cwd else project_dir.name
        project_path = _home_relative(project_cwd) if project_cwd else f"~/.claude/projects/{project_dir.name}"
        project_is_active = any((now - s["modified_at"]) < 60 for s in sessions_meta)

        projects.append({
            "project_name":          project_name,
            "project_path":          project_path,
            "project_dir":           project_dir.name,
            "last_active_timestamp": latest_mtime,
            "total_project_cost":    round(total_cost, 6),
            "is_active":             project_is_active,
            "recent_sessions":       recent_sessions,
        })

    projects.sort(key=lambda x: x["last_active_timestamp"], reverse=True)
    return projects


# ── REST: manually switch active session ─────────
class SwitchPayload(BaseModel):
    file_path: str


@app.post("/api/sessions/switch")
async def switch_session(payload: SwitchPayload):
    path = payload.file_path
    if not os.path.exists(path):
        return JSONResponse({"error": "File not found"}, status_code=404)

    log.info("Manual session switch → %s", path)
    STATE.reset()
    STATE.active_file = path
    STATE.session_id  = Path(path).stem
    TAILER.set_path(path)

    # Load all existing lines from the chosen file
    for raw in TAILER.drain():
        result = parse_line(raw)
        if result is None:
            continue
        evts = result if isinstance(result, list) else [result]
        for ev in evts:
            STATE.messages.append(ev)

    # 1. Tell every subscriber to clear their view
    await _broadcast("session_reset", {
        "session_id": STATE.session_id,
        "active_file": path,
    })
    # 2. Immediately follow with the full snapshot so history reloads
    await _broadcast("snapshot", {
        "stats":    _stats_payload(),
        "messages": STATE.messages[-200:],
        "agents":   _agents_payload(),
    })
    # 3. Check for a MEMORY.md in the new project and broadcast it
    _memory_state["path"] = ""  # force re-read on next check
    await _check_memory_update()

    return {"ok": True, "session_id": STATE.session_id}


# ── Hook: pre-tool-use POST ─────────────────────
class ToolHookPayload(BaseModel):
    tool_name: str = ""
    tool_input: dict = {}
    session_id: str = ""


@app.post("/api/hook/pre-tool-use", status_code=status.HTTP_200_OK)
async def hook_pre_tool_use(payload: ToolHookPayload):
    STATE.agent_status = "tool_running"
    STATE.current_tool = payload.tool_name
    await _broadcast("status_change", {
        "agent_status": "tool_running",
        "current_tool": payload.tool_name,
        "session_id": payload.session_id or STATE.session_id,
    })
    return {"ok": True}


@app.post("/api/hook/post-tool-use", status_code=status.HTTP_200_OK)
async def hook_post_tool_use(payload: ToolHookPayload):
    STATE.agent_status = "thinking"
    STATE.current_tool = ""
    await _broadcast("status_change", {
        "agent_status": "thinking",
        "current_tool": "",
        "session_id": payload.session_id or STATE.session_id,
    })
    return {"ok": True}


@app.post("/api/hook/stop", status_code=status.HTTP_200_OK)
async def hook_stop():
    STATE.agent_status = "idle"
    STATE.current_tool = ""
    await _broadcast("status_change", {
        "agent_status": "idle",
        "current_tool": "",
    })
    return {"ok": True}


# ── Hook: subagent lifecycle ─────────────────────
class SubagentStartPayload(BaseModel):
    agent_id:    str = ""   # new subagent's session ID (or any unique ID)
    parent_id:   str = ""   # parent session ID (defaults to STATE.session_id)
    type:        str = "General"  # Explore | Plan | General
    task:        str = ""   # the task / goal description
    tool_use_id: str = ""   # link to a Task tool_use block in parent JSONL
    session_id:  str = ""   # alias for agent_id (Claude Code hook compat)


class SubagentStopPayload(BaseModel):
    agent_id:   str = ""
    session_id: str = ""   # alias for agent_id


@app.post("/api/hook/subagent-start", status_code=status.HTTP_200_OK)
async def hook_subagent_start(payload: SubagentStartPayload):
    """Register a newly spawned subagent and broadcast its state."""
    # Resolve canonical agent_id
    agent_id = payload.agent_id or payload.session_id or payload.tool_use_id
    if not agent_id:
        agent_id = f"agent_{int(time.time() * 1000)}"

    # If a pending entry exists under the tool_use_id, promote it
    if payload.tool_use_id and payload.tool_use_id in AGENT_REGISTRY and payload.tool_use_id != agent_id:
        entry = AGENT_REGISTRY.pop(payload.tool_use_id)
        entry["agent_id"] = agent_id
        if payload.type:
            entry["type"] = payload.type
        if payload.task:
            entry["purpose"] = payload.task[:300]
        entry["status"] = "running"
        AGENT_REGISTRY[agent_id] = entry
    elif agent_id in AGENT_REGISTRY:
        # Update existing entry
        a = AGENT_REGISTRY[agent_id]
        a["status"] = "running"
        if payload.type:
            a["type"] = payload.type
        if payload.task:
            a["purpose"] = payload.task[:300]
    else:
        # Create fresh entry
        parent = payload.parent_id or STATE.session_id or None
        AGENT_REGISTRY[agent_id] = _make_agent_dict(
            agent_id=agent_id,
            parent_id=parent,
            agent_type=payload.type or _infer_agent_type(payload.task),
            purpose=payload.task,
            status="running",
        )

    await _broadcast_agent_update(agent_id)
    await _broadcast("status_change", {
        "agent_id": agent_id,
        "type": AGENT_REGISTRY[agent_id]["type"],
        "current_goal": AGENT_REGISTRY[agent_id]["purpose"],
        "agent_status": STATE.agent_status,
    })
    log.info("Subagent started: %s (%s)", agent_id, AGENT_REGISTRY[agent_id]["type"])
    return {"ok": True, "agent_id": agent_id}


@app.post("/api/hook/subagent-stop", status_code=status.HTTP_200_OK)
async def hook_subagent_stop(payload: SubagentStopPayload):
    """Mark a subagent as complete and broadcast its final state."""
    agent_id = payload.agent_id or payload.session_id
    if agent_id and agent_id in AGENT_REGISTRY:
        AGENT_REGISTRY[agent_id]["status"] = "complete"
        await _broadcast_agent_update(agent_id)
        log.info("Subagent stopped: %s", agent_id)
    await _broadcast("status_change", {
        "agent_id": agent_id,
        "agent_status": STATE.agent_status,
    })
    return {"ok": True}


# ── REST: agent registry snapshot ────────────────
@app.get("/api/agents")
async def get_agents():
    """Return the current in-memory agent registry."""
    return _agents_payload()


# ── Serve built frontend ─────────────────────────
_FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")


# ─────────────────────────────────────────────
#  Startup / Shutdown: launch watchdog
# ─────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    loop = asyncio.get_event_loop()
    watch_dir = str(Path.home() / ".claude" / "projects")

    # Initialise with the current active log
    active = find_active_log()
    if active:
        log.info("Initial log: %s", active)
        STATE.active_file = active
        STATE.session_id = Path(active).stem
        TAILER.set_path(active)
        # Drain existing lines so UI gets history immediately
        for raw in TAILER.drain():
            result = parse_line(raw)
            if result is None:
                continue
            evts = result if isinstance(result, list) else [result]
            for ev in evts:
                STATE.messages.append(ev)

    handler = LogHandler(loop)
    observer = Observer()
    observer.schedule(handler, watch_dir, recursive=True)
    observer.start()
    log.info("Watching %s", watch_dir)

    # Background stats heartbeat every 2 s + memory watcher
    async def stats_heartbeat():
        while True:
            await asyncio.sleep(2)
            if _subscribers:
                await _broadcast("stats", _stats_payload())
            await _check_memory_update()

    asyncio.create_task(stats_heartbeat())


# ─────────────────────────────────────────────
#  Dev entry-point
# ─────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=4821, reload=True)
