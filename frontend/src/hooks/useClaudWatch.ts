/**
 * Central SSE hook — connects to the ClaudWatch backend stream and feeds
 * all shared state: messages, stats, connection status, projects, memory.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentStatus,
  LogEntry,
  MemoryUpdate,
  ProjectInfo,
  SessionInfo,
  SparkPoint,
  Stats,
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

const DEFAULT_STATS: Stats = {
  total_cost: 0,
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_cache_write: 0,
  total_cache_read: 0,
  agent_status: "idle",
  current_tool: "",
  session_id: "",
  active_file: "",
  tokens_per_second: 0,
};

export function useClaudWatch() {
  const [messages, setMessages] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [connected, setConnected] = useState(false);
  const [sparkPoints, setSparkPoints] = useState<SparkPoint[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [memory, setMemory] = useState<MemoryUpdate | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const startTime = useRef<number>(Date.now());

  // ── Data loaders ───────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/sessions`);
      const data = (await r.json()) as SessionInfo[];
      setSessions(data);
    } catch {}
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/projects`);
      const data = (await r.json()) as ProjectInfo[];
      setProjects(data);
    } catch {}
  }, []);

  const switchSession = useCallback(
    async (filePath: string) => {
      try {
        await fetch(`${API_BASE}/api/sessions/switch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_path: filePath }),
        });
        // Refresh both lists so is_active updates immediately
        await Promise.all([loadSessions(), loadProjects()]);
      } catch {}
    },
    [loadSessions, loadProjects]
  );

  const appendSpark = useCallback((tps: number) => {
    setSparkPoints((prev) => {
      const now = Date.now() - startTime.current;
      const next = [...prev, { t: now, tps }];
      return next.length > 60 ? next.slice(next.length - 60) : next;
    });
  }, []);

  // ── SSE connection ─────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource(`${API_BASE}/api/stream`);
    esRef.current = es;

    es.addEventListener("open", () => {
      setConnected(true);
    });

    es.addEventListener("snapshot", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { stats: Stats; messages: LogEntry[] };
        setStats(data.stats);
        setMessages(data.messages);
        appendSpark(data.stats.tokens_per_second);
      } catch {}
    });

    es.addEventListener("log_entry", (e: MessageEvent) => {
      try {
        const entry = JSON.parse(e.data) as LogEntry;
        setMessages((prev) => {
          // Deduplicate by uuid+type
          if (prev.some((m) => m.uuid === entry.uuid && m.type === entry.type)) {
            return prev;
          }
          return [...prev, entry];
        });
      } catch {}
    });

    es.addEventListener("stats", (e: MessageEvent) => {
      try {
        const s = JSON.parse(e.data) as Stats;
        setStats(s);
        appendSpark(s.tokens_per_second);
      } catch {}
    });

    es.addEventListener("status_change", (e: MessageEvent) => {
      try {
        const s = JSON.parse(e.data) as Partial<Stats>;
        setStats((prev) => ({ ...prev, ...s }));
      } catch {}
    });

    // session_reset: a new .jsonl was detected — clear the view and update
    // the active session identifiers so the UI auto-switches.
    es.addEventListener("session_reset", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { session_id: string; active_file: string };
        setMessages([]);
        setStats({
          ...DEFAULT_STATS,
          session_id: data.session_id,
          active_file: data.active_file,
        });
        setSparkPoints([]);
        setMemory(null);
        startTime.current = Date.now();
        // Refresh both lists so the new session appears immediately
        loadProjects();
        loadSessions();
      } catch {
        // Fallback: parse failed, still reset the view
        setMessages([]);
        setStats(DEFAULT_STATS);
        setSparkPoints([]);
        setMemory(null);
        startTime.current = Date.now();
      }
    });

    // memory_update: MEMORY.md in the active project changed
    es.addEventListener("memory_update", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as MemoryUpdate;
        setMemory(data);
      } catch {}
    });

    es.addEventListener("ping", () => {
      /* heartbeat — ignore */
    });

    es.addEventListener("error", () => {
      setConnected(false);
      es.close();
      esRef.current = null;
      reconnectTimer.current = setTimeout(connect, 3000);
    });
  }, [appendSpark, loadProjects, loadSessions]);

  useEffect(() => {
    connect();
    loadSessions();
    loadProjects();
    return () => {
      esRef.current?.close();
      clearTimeout(reconnectTimer.current);
    };
  }, [connect, loadSessions, loadProjects]);

  return {
    messages,
    stats,
    connected,
    sparkPoints,
    sessions,
    projects,
    memory,
    loadSessions,
    loadProjects,
    switchSession,
  };
}
