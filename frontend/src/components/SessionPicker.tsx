import { ArrowLeft, Check, ChevronDown, ChevronRight, FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionInfo } from "../types";

interface Props {
  sessions: SessionInfo[];
  activeSessionId: string;
  onSwitch: (filePath: string) => Promise<void>;
  onRefresh: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeTime(unixTs: number): string {
  const diff = Date.now() / 1000 - unixTs;
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtBytes(n: number): string {
  if (n < 1024)         return `${n} B`;
  if (n < 1024 * 1024)  return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface ProjectGroup {
  name: string;
  path: string;       // e.g. "~/Downloads/chrome-ai-src"
  sessions: SessionInfo[];
  latestModified: number;
  hasActive: boolean;
}

function groupByProject(sessions: SessionInfo[]): ProjectGroup[] {
  // Group by project_path (full path) so identically-named folders in different
  // locations are treated as distinct projects.
  const map = new Map<string, ProjectGroup>();
  for (const s of sessions) {
    const key = s.project_path;
    let g = map.get(key);
    if (!g) {
      g = { name: s.project, path: s.project_path, sessions: [], latestModified: 0, hasActive: false };
      map.set(key, g);
    }
    g.sessions.push(s);
    if (s.modified_at > g.latestModified) g.latestModified = s.modified_at;
    if (s.is_active) g.hasActive = true;
  }
  return Array.from(map.values()).sort((a, b) => b.latestModified - a.latestModified);
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SessionPicker({ sessions, activeSessionId, onSwitch, onRefresh }: Props) {
  const [open, setOpen]                     = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [loading, setLoading]               = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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

  // When dropdown closes, reset to project list
  useEffect(() => {
    if (!open) setSelectedProject(null);
  }, [open]);

  const active   = sessions.find((s) => s.session_id === activeSessionId);
  const projects = groupByProject(sessions);

  async function handleSelectSession(s: SessionInfo) {
    if (s.session_id === activeSessionId) { setOpen(false); return; }
    setLoading(s.session_id);
    await onSwitch(s.file_path);
    setLoading(null);
    setOpen(false);
  }

  // ── Trigger button ───────────────────────────────────────────────────────────
  const triggerLabel = active ? active.project_path : "Select project…";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium
          transition-colors max-w-[220px]
          ${open
            ? "border-cw-accent/50 bg-cw-accent/10 text-cw-text"
            : "border-cw-border bg-cw-surface text-cw-subtle hover:text-cw-text hover:border-cw-muted"
          }`}
      >
        <FolderOpen size={11} className="flex-shrink-0" />
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown
          size={11}
          className={`flex-shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* ── Dropdown ────────────────────────────────────────────────────────── */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 w-72 animate-fade-in
          bg-cw-surface border border-cw-border rounded-xl shadow-2xl shadow-black/60 overflow-hidden">

          {/* ── View A: Project list ─────────────────────────────────────── */}
          {selectedProject === null && (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b border-cw-border">
                <span className="text-xs font-semibold text-cw-subtle uppercase tracking-wider">
                  Projects ({projects.length})
                </span>
                <button
                  onClick={onRefresh}
                  className="p-1 rounded hover:bg-cw-muted/40 text-cw-subtle hover:text-cw-text transition-colors"
                  title="Refresh"
                >
                  <RefreshCw size={11} />
                </button>
              </div>

              <div className="max-h-80 overflow-y-auto">
                {projects.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-cw-subtle">
                    No sessions found in ~/.claude/projects/
                  </div>
                ) : (
                  projects.map((g) => (
                    <button
                      key={g.path}
                      onClick={() => setSelectedProject(g.path)}
                      className={`w-full text-left px-3 py-2.5 flex items-center gap-3
                        border-b border-cw-border/40 last:border-0 transition-colors
                        ${g.hasActive ? "bg-cw-accent/5" : "hover:bg-cw-muted/20"}`}
                    >
                      {/* Folder icon */}
                      <div className={`flex-shrink-0 p-1.5 rounded-lg border
                        ${g.hasActive
                          ? "bg-cw-accent/10 border-cw-accent/20 text-cw-accent"
                          : "bg-cw-muted/20 border-cw-border text-cw-subtle"}`}>
                        <FolderOpen size={12} />
                      </div>

                      {/* Name + path + meta */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold truncate
                            ${g.hasActive ? "text-cw-accent" : "text-cw-text"}`}>
                            {g.name}
                          </span>
                          {g.hasActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full
                              bg-cw-accent/20 text-cw-accent font-medium leading-none flex-shrink-0">
                              active
                            </span>
                          )}
                        </div>
                        {/* Full home-relative path */}
                        <div className="font-mono text-[10px] text-cw-muted truncate mt-0.5">
                          {g.path}
                        </div>
                        <div className="text-[11px] text-cw-subtle mt-0.5">
                          {g.sessions.length} session{g.sessions.length !== 1 ? "s" : ""}
                          <span className="mx-1 opacity-40">·</span>
                          {relativeTime(g.latestModified)}
                        </div>
                      </div>

                      <ChevronRight size={12} className="flex-shrink-0 text-cw-muted" />
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          {/* ── View B: Sessions within a project ───────────────────────── */}
          {selectedProject !== null && (() => {
            const group = projects.find((g) => g.path === selectedProject);
            if (!group) return null;
            return (
              <>
                {/* Sub-header with back button */}
                <div className="flex items-center gap-2 px-2 py-2 border-b border-cw-border">
                  <button
                    onClick={() => setSelectedProject(null)}
                    className="p-1 rounded hover:bg-cw-muted/40 text-cw-subtle hover:text-cw-text transition-colors"
                  >
                    <ArrowLeft size={12} />
                  </button>
                  <FolderOpen size={11} className="text-cw-accent flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-cw-text">{group.name}</span>
                    <span className="font-mono text-[10px] text-cw-muted ml-1.5">{group.path}</span>
                  </div>
                  <span className="text-xs text-cw-subtle ml-auto">
                    {group.sessions.length} session{group.sessions.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {group.sessions.map((s) => {
                    const isActive  = s.session_id === activeSessionId;
                    const isLoading = loading === s.session_id;
                    return (
                      <button
                        key={s.file_path}
                        onClick={() => handleSelectSession(s)}
                        disabled={isLoading}
                        className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5
                          border-b border-cw-border/40 last:border-0 transition-colors
                          ${isActive ? "bg-cw-accent/10" : "hover:bg-cw-muted/20"}
                          ${isLoading ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
                      >
                        {/* Check / spinner */}
                        <div className="flex-shrink-0 w-3.5">
                          {isActive  && <Check      size={12} className="text-cw-accent" />}
                          {isLoading && <RefreshCw  size={12} className="text-cw-subtle animate-spin" />}
                        </div>

                        {/* Session ID */}
                        <div className="flex-1 min-w-0">
                          <span className={`font-mono text-[11px] truncate block
                            ${isActive ? "text-cw-accent" : "text-cw-subtle"}`}>
                            {s.session_id.slice(0, 20)}…
                          </span>
                          {isActive && (
                            <span className="text-[10px] text-cw-accent/70">active session</span>
                          )}
                        </div>

                        {/* Right meta */}
                        <div className="flex-shrink-0 text-right">
                          <div className="text-[11px] text-cw-subtle">{relativeTime(s.modified_at)}</div>
                          <div className="text-[10px] text-cw-muted mt-0.5">{fmtBytes(s.size_bytes)}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
