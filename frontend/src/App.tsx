import { BookOpen, Eye, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { ActivityStream } from "./components/ActivityStream";
import { CostTicker } from "./components/CostTicker";
import { ProjectSelector } from "./components/ProjectSelector";
import { StatusBadge } from "./components/StatusBadge";
import { useClaudWatch } from "./hooks/useClaudWatch";

export default function App() {
  const {
    messages,
    stats,
    connected,
    sparkPoints,
    projects,
    memory,
    loadProjects,
    switchSession,
  } = useClaudWatch();

  const [autoScroll, setAutoScroll] = useState(true);
  const [memoryDismissed, setMemoryDismissed] = useState(false);

  // Reset dismiss state when new memory content arrives
  const memoryKey = memory?.path ?? "";

  return (
    <div className="min-h-screen bg-cw-bg text-cw-text flex flex-col">
      {/* ── Top nav ───────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-cw-border bg-cw-bg/90 backdrop-blur-sm">
        <div className="max-w-[1600px] mx-auto px-4 h-12 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="p-1.5 rounded-lg bg-cw-accent/10 border border-cw-accent/20">
              <Eye size={14} className="text-cw-accent" />
            </div>
            <span className="font-bold text-cw-text tracking-tight">
              Claud<span className="text-cw-accent">Watch</span>
            </span>
          </div>

          {/* Project selector */}
          <div className="hidden md:flex items-center min-w-0 flex-1">
            <ProjectSelector
              projects={projects}
              activeSessionId={stats.session_id}
              onSwitch={switchSession}
              onRefresh={loadProjects}
            />
          </div>

          {/* Status + controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge
              status={stats.agent_status}
              currentTool={stats.current_tool}
              connected={connected}
              sessionId={stats.session_id}
            />
            <button
              onClick={() => setAutoScroll((p) => !p)}
              title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
              className={`p-1.5 rounded-lg border text-xs transition-colors ${
                autoScroll
                  ? "border-cw-accent/30 bg-cw-accent/10 text-cw-accent"
                  : "border-cw-border bg-cw-surface text-cw-subtle hover:text-cw-text"
              }`}
            >
              <RotateCcw size={12} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main layout ─────────────────────────────────────── */}
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-4 py-4">
        <div className="flex gap-4 h-[calc(100vh-64px)]">

          {/* Activity stream — scrollable */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-cw-subtle uppercase tracking-wider">
                Activity Stream
              </h2>
              <span className="text-xs text-cw-muted font-mono">
                {messages.length} entries
              </span>
            </div>
            <div
              className="flex-1 overflow-y-auto rounded-xl border border-cw-border bg-cw-bg p-3"
              style={{ contain: "strict" }}
            >
              <ActivityStream messages={messages} autoScroll={autoScroll} />
            </div>
          </div>

          {/* Right sidebar */}
          <aside className="w-72 flex-shrink-0 flex flex-col gap-4 overflow-y-auto">
            {/* Cost + Tokens */}
            <div>
              <h2 className="text-xs font-semibold text-cw-subtle uppercase tracking-wider mb-3">
                Cost &amp; Tokens
              </h2>
              <CostTicker stats={stats} sparkPoints={sparkPoints} />
            </div>

            {/* MEMORY.md panel */}
            {memory && !memoryDismissed && (
              <div
                key={memoryKey}
                className="bg-cw-surface border border-cw-green/30 rounded-xl overflow-hidden animate-fade-in"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-cw-green/20 bg-cw-green/5">
                  <div className="flex items-center gap-2">
                    <BookOpen size={12} className="text-cw-green flex-shrink-0" />
                    <h3 className="text-xs font-semibold text-cw-green uppercase tracking-wider">
                      Memory
                    </h3>
                    {/* Live pulse indicator */}
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cw-green opacity-60" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cw-green" />
                    </span>
                  </div>
                  <button
                    onClick={() => setMemoryDismissed(true)}
                    className="p-0.5 rounded text-cw-subtle hover:text-cw-text transition-colors"
                    title="Dismiss"
                  >
                    <X size={11} />
                  </button>
                </div>
                <div className="p-3 max-h-52 overflow-y-auto">
                  <pre className="text-[11px] text-cw-text/80 font-mono leading-relaxed whitespace-pre-wrap break-words">
                    {memory.content}
                  </pre>
                </div>
                <div className="px-3 py-1.5 border-t border-cw-border/50">
                  <span className="font-mono text-[9px] text-cw-muted truncate block">
                    {memory.path}
                  </span>
                </div>
              </div>
            )}

            {/* Session info card */}
            <div className="bg-cw-surface border border-cw-border rounded-xl p-4">
              <h3 className="text-xs font-semibold text-cw-subtle uppercase tracking-wider mb-3">
                Session Info
              </h3>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-cw-subtle">Session</span>
                  <span className="text-cw-text truncate max-w-[140px]">
                    {stats.session_id ? stats.session_id.slice(0, 12) + "…" : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cw-subtle">Messages</span>
                  <span className="text-cw-text">{messages.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cw-subtle">Status</span>
                  <span
                    className={
                      stats.agent_status === "idle"
                        ? "text-cw-subtle"
                        : stats.agent_status === "thinking"
                        ? "text-cw-yellow"
                        : "text-cw-orange"
                    }
                  >
                    {stats.agent_status}
                  </span>
                </div>
                {stats.current_tool && (
                  <div className="flex justify-between">
                    <span className="text-cw-subtle">Tool</span>
                    <span className="text-cw-orange">{stats.current_tool}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Projects summary card */}
            {projects.length > 0 && (
              <div className="bg-cw-surface border border-cw-border rounded-xl p-4">
                <h3 className="text-xs font-semibold text-cw-subtle uppercase tracking-wider mb-3">
                  Projects
                </h3>
                <div className="space-y-2">
                  {projects.slice(0, 5).map((p) => (
                    <div key={p.project_path} className="flex items-center gap-2">
                      {p.is_active && (
                        <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cw-green opacity-60" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cw-green" />
                        </span>
                      )}
                      {!p.is_active && (
                        <span className="h-1.5 w-1.5 rounded-full bg-cw-muted flex-shrink-0" />
                      )}
                      <span className="flex-1 text-xs text-cw-text truncate font-medium">
                        {p.project_name}
                      </span>
                      {p.total_project_cost > 0 && (
                        <span className="text-[10px] text-cw-green font-mono flex-shrink-0">
                          ${p.total_project_cost.toFixed(2)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* How-to card */}
            <div className="bg-cw-surface/50 border border-cw-border/50 rounded-xl p-4">
              <h3 className="text-xs font-semibold text-cw-subtle uppercase tracking-wider mb-2">
                Quick Start
              </h3>
              <div className="text-xs text-cw-subtle space-y-1.5 leading-relaxed">
                <p>1. Start ClaudWatch backend</p>
                <pre className="bg-cw-bg border border-cw-border rounded p-1.5 text-cw-text text-[11px] overflow-auto">
                  cd backend{"\n"}uvicorn server:app --port 4821
                </pre>
                <p>2. Run Claude Code with hooks</p>
                <pre className="bg-cw-bg border border-cw-border rounded p-1.5 text-cw-text text-[11px] overflow-auto">
                  claude --pre-tool-use{"\n"}  ~/.claude/hooks/pre_tool.sh
                </pre>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
