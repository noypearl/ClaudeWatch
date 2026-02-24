/**
 * ProjectSelector — hierarchical project-first dropdown.
 *
 * Features:
 *  • Bold project name header with pulsing green "Live" dot when active
 *  • Accordion sub-list of the 5 most recent sessions under each project
 *  • Search input to filter by project name, path, or session goal
 *  • Click a session → triggers a session switch
 */
import {
  Check,
  ChevronDown,
  FolderOpen,
  GitBranch,
  RefreshCw,
  Search,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectInfo, SessionSummary } from "../types";

interface Props {
  projects: ProjectInfo[];
  activeSessionId: string;
  onSwitch: (filePath: string) => Promise<void>;
  onRefresh: () => void;
  /** IDs of projects that currently have active subagents */
  activeAgentProjectIds?: Set<string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(unixTs: number): string {
  const diff = Date.now() / 1000 - unixTs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtCost(n: number): string {
  if (n <= 0) return "";
  if (n < 0.001) return `<$0.001`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

// ── Live Dot component ────────────────────────────────────────────────────────

function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative flex h-2 w-2 flex-shrink-0 ${className}`}>
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cw-green opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-cw-green" />
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectSelector({
  projects,
  activeSessionId,
  onSwitch,
  onRefresh,
  activeAgentProjectIds,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // Focus search + reset query when the dropdown opens/closes
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 60);
    } else {
      setQuery("");
    }
  }, [open]);

  // Auto-expand the project that contains the currently active session
  useEffect(() => {
    for (const p of projects) {
      if (p.recent_sessions.some((s) => s.session_id === activeSessionId)) {
        setExpanded((prev) => new Set([...prev, p.project_path]));
        break;
      }
    }
  }, [projects, activeSessionId]);

  // ── Filtering ──────────────────────────────────────────────────────────────
  const lc = query.toLowerCase().trim();
  const filteredProjects =
    lc === ""
      ? projects
      : projects.filter(
          (p) =>
            p.project_name.toLowerCase().includes(lc) ||
            p.project_path.toLowerCase().includes(lc) ||
            p.recent_sessions.some((s) => s.goal.toLowerCase().includes(lc))
        );

  // ── Trigger label ──────────────────────────────────────────────────────────
  const activeProject = projects.find((p) =>
    p.recent_sessions.some((s) => s.session_id === activeSessionId)
  );
  const triggerLabel = activeProject
    ? activeProject.project_name
    : "Select project…";

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function handleSelectSession(s: SessionSummary) {
    if (s.session_id === activeSessionId) {
      setOpen(false);
      return;
    }
    setLoading(s.session_id);
    await onSwitch(s.file_path);
    setLoading(null);
    setOpen(false);
  }

  function toggleExpanded(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((p) => !p)}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium
          transition-colors max-w-[260px]
          ${
            open
              ? "border-cw-accent/50 bg-cw-accent/10 text-cw-text"
              : "border-cw-border bg-cw-surface text-cw-subtle hover:text-cw-text hover:border-cw-muted"
          }`}
      >
        <FolderOpen size={11} className="flex-shrink-0" />
        {activeProject?.is_active && <LiveDot />}
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown
          size={11}
          className={`flex-shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full left-0 mt-1.5 z-50 w-[340px] animate-fade-in
            bg-cw-surface border border-cw-border rounded-xl shadow-2xl shadow-black/70 overflow-hidden"
        >
          {/* ── Header + Search ────────────────────────────────────────────── */}
          <div className="p-2.5 border-b border-cw-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-cw-subtle uppercase tracking-widest">
                Projects ({filteredProjects.length})
              </span>
              <button
                onClick={onRefresh}
                title="Refresh"
                className="p-1 rounded hover:bg-cw-muted/40 text-cw-subtle hover:text-cw-text transition-colors"
              >
                <RefreshCw size={11} />
              </button>
            </div>
            <div className="relative">
              <Search
                size={11}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-cw-subtle pointer-events-none"
              />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search projects or goals…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 text-xs bg-cw-bg border border-cw-border rounded-lg
                  text-cw-text placeholder:text-cw-muted/70 focus:outline-none focus:border-cw-accent/50
                  transition-colors"
              />
            </div>
          </div>

          {/* ── Project list ───────────────────────────────────────────────── */}
          <div className="max-h-[440px] overflow-y-auto">
            {filteredProjects.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-cw-subtle">
                {query
                  ? "No projects or sessions match your search."
                  : "No sessions found in ~/.claude/projects/"}
              </div>
            ) : (
              filteredProjects.map((project) => {
                const isExpanded = expanded.has(project.project_path);
                const hasActiveSession = project.recent_sessions.some(
                  (s) => s.session_id === activeSessionId
                );

                return (
                  <div
                    key={project.project_path}
                    className="border-b border-cw-border/40 last:border-0"
                  >
                    {/* ── Project header row ─────────────────────────────── */}
                    <button
                      onClick={() => toggleExpanded(project.project_path)}
                      className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors
                        ${
                          hasActiveSession
                            ? "bg-cw-accent/5 hover:bg-cw-accent/[0.08]"
                            : "hover:bg-cw-muted/20"
                        }`}
                    >
                      {/* Folder icon */}
                      <div
                        className={`flex-shrink-0 p-1.5 rounded-lg border
                        ${
                          hasActiveSession
                            ? "bg-cw-accent/10 border-cw-accent/20 text-cw-accent"
                            : "bg-cw-muted/20 border-cw-border text-cw-subtle"
                        }`}
                      >
                        <FolderOpen size={11} />
                      </div>

                      {/* Name + path + stats */}
                      <div className="flex-1 min-w-0">
                        {/* Row 1: bold project name + live dot + subagent badge */}
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-bold truncate leading-tight
                            ${hasActiveSession ? "text-cw-accent" : "text-cw-text"}`}
                          >
                            {project.project_name}
                          </span>
                          {project.is_active && (
                            <LiveDot className="mt-px" />
                          )}
                          {activeAgentProjectIds?.has(project.project_path) && (
                            <span className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-cw-purple/15 text-cw-purple border border-cw-purple/20 flex-shrink-0">
                              <GitBranch size={8} />
                              agents
                            </span>
                          )}
                        </div>

                        {/* Row 2: full path */}
                        <div className="font-mono text-[10px] text-cw-muted truncate mt-0.5">
                          {project.project_path}
                        </div>

                        {/* Row 3: session count · time · cost */}
                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-cw-subtle">
                          <span>
                            {project.recent_sessions.length} session
                            {project.recent_sessions.length !== 1 ? "s" : ""}
                          </span>
                          <span className="opacity-30">·</span>
                          <span>{relativeTime(project.last_active_timestamp)}</span>
                          {project.total_project_cost > 0 && (
                            <>
                              <span className="opacity-30">·</span>
                              <span className="text-cw-green font-mono">
                                {fmtCost(project.total_project_cost)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <ChevronDown
                        size={11}
                        className={`flex-shrink-0 text-cw-muted transition-transform duration-150
                          ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </button>

                    {/* ── Session sub-list (accordion) ───────────────────── */}
                    {isExpanded && (
                      <div className="bg-cw-bg/60">
                        {project.recent_sessions.map((s) => {
                          const isActive = s.session_id === activeSessionId;
                          const isLoading = loading === s.session_id;

                          return (
                            <button
                              key={s.file_path}
                              onClick={() => handleSelectSession(s)}
                              disabled={isLoading}
                              className={`w-full text-left pl-10 pr-3 py-2 flex items-start gap-2
                                border-t border-cw-border/30 transition-colors
                                ${isActive ? "bg-cw-accent/10" : "hover:bg-cw-muted/20"}
                                ${isLoading ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
                            >
                              {/* Status icon */}
                              <div className="flex-shrink-0 mt-0.5 w-3.5 flex items-center">
                                {isLoading ? (
                                  <RefreshCw
                                    size={10}
                                    className="text-cw-subtle animate-spin"
                                  />
                                ) : isActive ? (
                                  <Check size={10} className="text-cw-accent" />
                                ) : s.is_active ? (
                                  <Zap size={10} className="text-cw-green" />
                                ) : null}
                              </div>

                              {/* Goal text + meta */}
                              <div className="flex-1 min-w-0">
                                {/* Goal label */}
                                <p
                                  className={`text-[11px] leading-snug line-clamp-2
                                  ${isActive ? "text-cw-accent" : "text-cw-text/90"}`}
                                >
                                  {s.goal || (
                                    <span className="italic text-cw-subtle">
                                      (no goal)
                                    </span>
                                  )}
                                </p>

                                {/* Meta row */}
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="font-mono text-[10px] text-cw-muted">
                                    {s.session_id.slice(0, 8)}…
                                  </span>
                                  <span className="text-[10px] text-cw-subtle">
                                    {relativeTime(s.modified_at)}
                                  </span>
                                  {s.session_cost > 0 && (
                                    <span className="text-[10px] text-cw-green font-mono">
                                      {fmtCost(s.session_cost)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
