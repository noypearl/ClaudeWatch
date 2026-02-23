import { Activity, Clock, Terminal, Wifi, WifiOff, Zap } from "lucide-react";
import type { AgentStatus } from "../types";

interface Props {
  status: AgentStatus;
  currentTool: string;
  connected: boolean;
  sessionId: string;
}

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; color: string; dot: string; icon: React.ElementType }
> = {
  idle:         { label: "Idle",         color: "text-cw-subtle",  dot: "bg-cw-subtle",  icon: Clock    },
  thinking:     { label: "Thinking…",    color: "text-cw-yellow",  dot: "bg-cw-yellow",  icon: Activity },
  tool_running: { label: "Running Tool", color: "text-cw-orange",  dot: "bg-cw-orange",  icon: Terminal },
};

export function StatusBadge({ status, currentTool, connected, sessionId }: Props) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;
  const Icon = cfg.icon;

  return (
    <div className="flex items-center gap-3">
      {/* Connection pill */}
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${
          connected
            ? "border-cw-green/30 bg-cw-green/10 text-cw-green"
            : "border-cw-red/30 bg-cw-red/10 text-cw-red"
        }`}
      >
        {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
        {connected ? "Live" : "Reconnecting"}
      </div>

      {/* Agent status pill */}
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium
          border-cw-border bg-cw-surface ${cfg.color}`}
      >
        {status !== "idle" && (
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} animate-pulse`} />
        )}
        <Icon size={11} />
        <span>{cfg.label}</span>
        {status === "tool_running" && currentTool && (
          <span className="font-mono text-cw-subtle">· {currentTool}</span>
        )}
      </div>

      {/* Session ID */}
      {sessionId && (
        <div className="hidden sm:flex items-center gap-1 text-xs text-cw-subtle font-mono">
          <Zap size={10} />
          {sessionId.slice(0, 8)}…
        </div>
      )}
    </div>
  );
}
