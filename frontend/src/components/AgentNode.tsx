/**
 * AgentNode — Custom ReactFlow node representing a single agent in the swarm.
 *
 * Visual design:
 *   • Explore → blue border  (#388bfd)
 *   • Plan    → purple border (#bc8cff)
 *   • General → green border  (#3fb950)
 *
 * States:
 *   • spawning  → pulsing border, "Spawning…" badge
 *   • running   → solid border, status badge
 *   • complete  → dimmed node, "✅ Task Complete" badge
 *   • error     → red border, "⚠ Error" badge
 */
import { memo, useEffect, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { motion, AnimatePresence } from "framer-motion";
import { GitBranch, Cpu, Clock, ChevronDown, ChevronUp } from "lucide-react";
import type { AgentInfo, AgentType } from "../types";

// ── Type configuration ────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  AgentType,
  { emoji: string; color: string; glow: string; label: string }
> = {
  Explore: {
    emoji: "🕵️",
    color: "#388bfd",
    glow: "rgba(56,139,253,0.45)",
    label: "Explore",
  },
  Plan: {
    emoji: "🧠",
    color: "#bc8cff",
    glow: "rgba(188,140,255,0.45)",
    label: "Plan",
  },
  General: {
    emoji: "⚙️",
    color: "#3fb950",
    glow: "rgba(63,185,80,0.45)",
    label: "General",
  },
};

// ── Elapsed time helper ───────────────────────────────────────────────────────

function elapsedStr(spawnedAt: number): string {
  if (!spawnedAt) return "";
  const diff = Math.max(0, Date.now() / 1000 - spawnedAt);
  if (diff < 60) return `${Math.floor(diff)}s`;
  const m = Math.floor(diff / 60);
  const s = Math.floor(diff % 60);
  if (diff < 3600) return `${m}m ${s}s`;
  return `${Math.floor(diff / 3600)}h ${m % 60}m`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: AgentInfo["status"] }) {
  if (status === "complete") {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-900/50 text-green-400 border border-green-700/50">
        ✅ Complete
      </span>
    );
  }
  if (status === "spawning") {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-900/50 text-yellow-400 border border-yellow-700/50 animate-pulse">
        ⏳ Spawning
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-900/50 text-red-400 border border-red-700/50">
        ⚠ Error
      </span>
    );
  }
  // running
  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/50">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-400" />
      </span>
      Running
    </span>
  );
}

// ── Agent node data shape (passed via ReactFlow node.data) ─────────────────────

export interface AgentNodeData {
  agent: AgentInfo;
  pulsing: boolean;
  /** Human-readable project name derived from file_path / projects list */
  projectName: string;
  /** Truncated purpose of the direct parent agent (if any) */
  parentPurpose?: string;
  /** 0 = root, 1 = first child, etc. */
  depth: number;
  [key: string]: unknown;
}

// ── Main component ─────────────────────────────────────────────────────────────

export const AgentNode = memo(({ data }: NodeProps) => {
  const { agent, pulsing, projectName, parentPurpose, depth } =
    data as AgentNodeData;
  const cfg = TYPE_CONFIG[agent.type] ?? TYPE_CONFIG.General;
  const isComplete = agent.status === "complete";
  const isError = agent.status === "error";

  const borderColor = isComplete
    ? "#da3633"
    : isError
    ? "#f85149"
    : cfg.color;
  const glowColor = isComplete
    ? "rgba(218,54,51,0.2)"
    : isError
    ? "rgba(248,81,73,0.4)"
    : pulsing
    ? cfg.glow
    : "none";

  // Tick elapsed time every second while running/spawning
  const [, setTick] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (isComplete || isError) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isComplete, isError]);

  const totalTokens =
    (agent.tokens?.input ?? 0) + (agent.tokens?.output ?? 0);
  const displayName = projectName || cfg.label;
  const elapsed = agent.spawned_at ? elapsedStr(agent.spawned_at) : "";

  return (
    <motion.div
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: isComplete ? 0.55 : 1 }}
      transition={{ type: "spring", stiffness: 340, damping: 24 }}
      style={{
        border: `2px solid ${borderColor}`,
        boxShadow: pulsing
          ? `0 0 0 3px ${cfg.glow}, 0 0 18px ${glowColor}`
          : `0 0 10px ${glowColor}`,
        transition: "box-shadow 0.4s ease, border-color 0.4s ease",
        minWidth: 240,
        maxWidth: 300,
      }}
      className="relative rounded-xl bg-[#161b22] p-3 select-none"
    >
      {/* ReactFlow connection handles (invisible) */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "transparent", border: "none", top: -1 }}
      />

      {/* ── Header: project name + status ──────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-base leading-none flex-shrink-0">
            {cfg.emoji}
          </span>
          <span
            className="text-xs font-bold tracking-wide truncate"
            style={{ color: borderColor }}
            title={displayName}
          >
            {displayName}
          </span>
        </div>
        <StatusPill status={agent.status} />
      </div>

      {/* ── Type badge + depth + elapsed ───────────────────────────────── */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium"
          style={{
            color: cfg.color,
            background: `${cfg.color}18`,
            border: `1px solid ${cfg.color}30`,
          }}
        >
          {cfg.label}
        </span>
        {depth > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-[#6e7681] bg-[#21262d] rounded px-1.5 py-0.5">
            <GitBranch size={9} />
            depth {depth}
          </span>
        )}
        {elapsed && (
          <span className="flex items-center gap-0.5 text-[10px] text-[#6e7681] ml-auto font-mono">
            <Clock size={9} />
            {elapsed}
          </span>
        )}
      </div>

      {/* ── Purpose ────────────────────────────────────────────────────── */}
      <p className={`text-[11px] text-[#8b949e] leading-snug mb-2 min-h-[28px] ${expanded ? "" : "line-clamp-2"}`}>
        {agent.purpose || (
          <span className="italic opacity-60">Purpose unknown…</span>
        )}
      </p>

      {/* ── Parent relationship ─────────────────────────────────────────── */}
      {parentPurpose && (
        <div className="flex items-center gap-1.5 mb-2 text-[10px] bg-[#21262d]/70 border border-[#30363d] rounded-md px-2 py-1">
          <GitBranch size={9} className="text-[#6e7681] flex-shrink-0" />
          <span className="text-[#6e7681] flex-shrink-0">spawned by:</span>
          <span className="text-[#8b949e] truncate italic">{parentPurpose}</span>
        </div>
      )}

      {/* ── Mini-stream ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {agent.log_tail.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-md bg-black/50 border border-[#21262d] px-2 py-1.5 space-y-0.5 mb-2 overflow-hidden"
          >
            {(expanded ? agent.log_tail : agent.log_tail.slice(-3)).map((line, i) => (
              <p
                key={i}
                className={`text-[10px] text-[#6e7681] font-mono leading-tight ${expanded ? "break-words whitespace-pre-wrap" : "line-clamp-1"}`}
              >
                › {line}
              </p>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Expand / Collapse toggle ────────────────────────────────────── */}
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="nodrag w-full flex items-center justify-center gap-1 mt-1 mb-1 text-[10px] text-[#6e7681] hover:text-[#8b949e] transition-colors rounded py-0.5 hover:bg-[#21262d]/60"
        title={expanded ? "Collapse" : "Expand to see full history"}
      >
        {expanded ? (
          <><ChevronUp size={11} /> Collapse</>
        ) : (
          <><ChevronDown size={11} /> {agent.log_tail.length > 3 ? `Show all ${agent.log_tail.length} lines` : "Expand"}</>
        )}
      </button>

      {/* ── Footer: ID | tokens | cost ──────────────────────────────────── */}
      <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-[#21262d] gap-2">
        <span
          className="font-mono text-[10px] text-[#30363d] truncate max-w-[100px]"
          title={agent.agent_id}
        >
          {agent.agent_id.slice(0, 10)}…
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {totalTokens > 0 && (
            <span className="flex items-center gap-0.5 font-mono text-[10px] text-[#6e7681]">
              <Cpu size={9} />
              {totalTokens.toLocaleString()}
            </span>
          )}
          {agent.cost > 0 && (
            <span className="font-mono text-[10px] text-[#3fb950] font-semibold">
              ${agent.cost.toFixed(4)}
            </span>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "transparent", border: "none", bottom: -1 }}
      />
    </motion.div>
  );
});

AgentNode.displayName = "AgentNode";
