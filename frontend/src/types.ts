export type AgentStatus = "idle" | "thinking" | "tool_running";

export interface LogEntry {
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  type: "user" | "assistant" | "tool_use" | "tool_result";
  role: string;
  model: string | null;
  text: string;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  toolUseId: string | null;
  usage: Record<string, number> | null;
  cost: number;
  cumulative_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export interface Stats {
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_write: number;
  total_cache_read: number;
  agent_status: AgentStatus;
  current_tool: string;
  session_id: string;
  active_file: string;
  tokens_per_second: number;
}

export interface Snapshot {
  stats: Stats;
  messages: LogEntry[];
}

// For the sparkline — (time offset ms, tokens/s)
export interface SparkPoint {
  t: number;
  tps: number;
}

export interface SessionInfo {
  session_id: string;
  file_path: string;
  /** Last path segment of the real cwd, e.g. "chrome-ai-src" */
  project: string;
  /** Home-relative real path, e.g. "~/Downloads/chrome-ai-src" */
  project_path: string;
  /** Raw encoded directory slug, e.g. "-Users-Noi-Downloads-chrome-ai-src" */
  project_dir: string;
  size_bytes: number;
  /** Unix timestamp (seconds, float) */
  modified_at: number;
  is_active: boolean;
}

/** A lightweight session summary returned by /api/projects */
export interface SessionSummary {
  session_id: string;
  file_path: string;
  /** First human user message — used as a "goal" label */
  goal: string;
  /** Unix timestamp (seconds, float) */
  modified_at: number;
  size_bytes: number;
  /** True if the file was modified within the last 60 s */
  is_active: boolean;
  session_cost: number;
}

/** One project directory with aggregated metadata */
export interface ProjectInfo {
  project_name: string;
  project_path: string;
  project_dir: string;
  /** Unix timestamp of the most recently modified session */
  last_active_timestamp: number;
  /** Sum of costs across ALL sessions in this project */
  total_project_cost: number;
  /** True if any session was modified within the last 60 s */
  is_active: boolean;
  /** Up to 5 most recent sessions */
  recent_sessions: SessionSummary[];
}

/** Payload for the memory_update SSE event */
export interface MemoryUpdate {
  content: string;
  path: string;
}
