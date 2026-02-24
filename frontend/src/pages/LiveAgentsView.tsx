/**
 * LiveAgentsView — "Mission Control" page that renders the active agent swarm
 * as a directed node graph using ReactFlow.
 *
 * Uses ReactFlowProvider + an inner SwarmGraph component so that useReactFlow()
 * is available to call fitView() whenever nodes change dynamically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
} from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, GitBranch, Layers, Radio, LayoutGrid } from "lucide-react";
import { AgentNode, type AgentNodeData } from "../components/AgentNode";
import type { AgentInfo, AgentType, ProjectInfo, Stats } from "../types";

// ── Constants ──────────────────────────────────────────────────────────────────

const NODE_W = 280;
const NODE_H = 210;
const H_GAP  = 70;
const V_GAP  = 110;

const NODE_TYPES = { agentNode: AgentNode };

type ViewMode  = "all" | "live";
type TypeFilter = "All" | AgentType;

// ── Project name resolver ──────────────────────────────────────────────────────

/**
 * Given an agent's file_path (a .jsonl session file path like
 * /Users/Noi/.claude/projects/-Users-Noi-Documents-ClaudeWatch/abc.jsonl),
 * try to find the matching project name from the projects list.
 * Falls back to extracting the parent directory name from the path.
 */
function resolveProjectName(filePath: string, projects: ProjectInfo[]): string {
  if (!filePath) return "";
  // Match against known project_dirs (slug like -Users-Noi-Documents-ClaudeWatch)
  for (const p of projects) {
    if (p.project_dir && filePath.includes(p.project_dir)) {
      return p.project_name;
    }
  }
  // Fallback: take the parent directory's last path segment
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length >= 2) {
    // The parent dir is a slug like -Users-Noi-Documents-ClaudeWatch
    // Convert to a readable name: take the last hyphen-separated segment
    const dirSlug = parts[parts.length - 2];
    const segments = dirSlug.split("-").filter(Boolean);
    if (segments.length > 0) return segments[segments.length - 1];
  }
  return "";
}

// ── Layout: BFS tree, top-to-bottom ───────────────────────────────────────────

function computeLayout(
  agents: AgentInfo[],
  mainSessionId: string
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (!agents.length) return positions;

  // Build parent → children map
  const childrenOf = new Map<string | null, string[]>();
  for (const a of agents) {
    const parentKey =
      !a.parent_id || a.parent_id === mainSessionId ? null : a.parent_id;
    const list = childrenOf.get(parentKey) ?? [];
    list.push(a.agent_id);
    childrenOf.set(parentKey, list);
  }

  const queue: { id: string; depth: number; parentX: number }[] = [];
  const roots = childrenOf.get(null) ?? [];

  // Place root row centered at x=0
  const rootTotalW = roots.length * NODE_W + (roots.length - 1) * H_GAP;
  let rootStartX   = -(rootTotalW / 2) + NODE_W / 2;
  roots.forEach((id) => {
    positions.set(id, { x: rootStartX, y: 0 });
    queue.push({ id, depth: 1, parentX: rootStartX });
    rootStartX += NODE_W + H_GAP;
  });

  while (queue.length) {
    const { id, depth, parentX } = queue.shift()!;
    const kids = childrenOf.get(id) ?? [];
    if (!kids.length) continue;
    const totalW = kids.length * NODE_W + (kids.length - 1) * H_GAP;
    let startX   = parentX - totalW / 2 + NODE_W / 2;
    kids.forEach((kidId) => {
      const x = startX;
      const y = depth * (NODE_H + V_GAP);
      startX += NODE_W + H_GAP;
      positions.set(kidId, { x, y });
      queue.push({ id: kidId, depth: depth + 1, parentX: x });
    });
  }

  return positions;
}

// ── Depth map ─────────────────────────────────────────────────────────────────

function computeDepths(
  agents: AgentInfo[],
  mainSessionId: string
): Map<string, number> {
  const depths = new Map<string, number>();
  const agentById = new Map(agents.map((a) => [a.agent_id, a]));

  function getDepth(id: string): number {
    if (depths.has(id)) return depths.get(id)!;
    const agent = agentById.get(id);
    if (!agent || !agent.parent_id || agent.parent_id === mainSessionId) {
      depths.set(id, 0);
      return 0;
    }
    const d = getDepth(agent.parent_id) + 1;
    depths.set(id, d);
    return d;
  }

  agents.forEach((a) => getDepth(a.agent_id));
  return depths;
}

// ── Edge color by child agent type ────────────────────────────────────────────

const TYPE_EDGE_COLOR: Record<AgentType, string> = {
  Explore: "#388bfd",
  Plan:    "#bc8cff",
  General: "#3fb950",
};

// ── Graph data builder ─────────────────────────────────────────────────────────

function buildGraph(
  agents: AgentInfo[],
  pulsingAgents: Set<string>,
  mainSessionId: string,
  projects: ProjectInfo[]
): { nodes: Node[]; edges: Edge[] } {
  const layout  = computeLayout(agents, mainSessionId);
  const depths  = computeDepths(agents, mainSessionId);
  const byId    = new Map(agents.map((a) => [a.agent_id, a]));

  const nodes: Node[] = agents.map((agent) => {
    const pos         = layout.get(agent.agent_id) ?? { x: 0, y: 0 };
    const depth       = depths.get(agent.agent_id) ?? 0;
    const projectName = resolveProjectName(agent.file_path, projects);

    // Parent purpose: the parent agent's purpose, truncated
    let parentPurpose: string | undefined;
    if (agent.parent_id && agent.parent_id !== mainSessionId && byId.has(agent.parent_id)) {
      const parent = byId.get(agent.parent_id);
      if (parent?.purpose) {
        parentPurpose =
          parent.purpose.length > 60
            ? parent.purpose.slice(0, 57) + "…"
            : parent.purpose;
      }
    }

    return {
      id:       agent.agent_id,
      type:     "agentNode",
      position: pos,
      data:     {
        agent,
        pulsing:      pulsingAgents.has(agent.agent_id),
        projectName,
        parentPurpose,
        depth,
      } satisfies AgentNodeData,
    };
  });

  const edges: Edge[] = agents
    .filter((a) => a.parent_id && a.parent_id !== mainSessionId)
    .map((a) => {
      const isActive = a.status === "running" || a.status === "spawning";
      const color    = TYPE_EDGE_COLOR[a.type] ?? "#30363d";
      const edgeColor = isActive ? color : "#30363d";
      return {
        id:        `${a.parent_id}->${a.agent_id}`,
        source:    a.parent_id!,
        target:    a.agent_id,
        animated:  isActive,
        label:     isActive ? "spawns" : undefined,
        labelStyle: {
          fontSize: 9,
          fill: edgeColor,
          fontFamily: "monospace",
        },
        labelBgStyle: {
          fill: "#0d1117",
          fillOpacity: 0.85,
        },
        markerEnd: {
          type:   MarkerType.ArrowClosed,
          color:  edgeColor,
          width:  14,
          height: 14,
        },
        style: {
          stroke:      edgeColor,
          strokeWidth: isActive ? 2 : 1.5,
          opacity:     isActive ? 1 : 0.5,
        },
      };
    });

  return { nodes, edges };
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 select-none">
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 22 }}
        className="bg-cw-surface border border-cw-border rounded-2xl p-10 max-w-sm"
      >
        <div className="text-5xl mb-4">{filtered ? "🔍" : "🤖"}</div>
        <h3 className="text-sm font-semibold text-cw-text mb-1">
          {filtered ? "No agents match the filter" : "No agents in the swarm yet"}
        </h3>
        <p className="text-xs text-cw-subtle leading-relaxed">
          {filtered
            ? 'Try switching to "All" or clearing the type filter to see more agents.'
            : <>
                Nodes will appear here in real-time when Claude Code spawns
                sub-agents via the{" "}
                <code className="font-mono text-cw-accent">Task</code> tool
                or lifecycle hooks.
              </>
          }
        </p>
        {!filtered && (
          <div className="mt-5 text-[11px] text-cw-muted font-mono bg-cw-bg border border-cw-border rounded-lg px-3 py-2 text-left">
            <p className="text-cw-subtle mb-1"># Enable hooks in claude_settings.json:</p>
            <p className="text-cw-text">"SubagentStart":</p>
            <p className="text-cw-accent pl-2">hooks/subagent_start.sh</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Stats bar ──────────────────────────────────────────────────────────────────

function AgentsStatsBar({
  agents,
  allAgents,
  stats,
}: {
  agents: AgentInfo[];
  allAgents: AgentInfo[];
  stats: Stats;
}) {
  const running  = agents.filter((a) => a.status === "running").length;
  const spawning = agents.filter((a) => a.status === "spawning").length;
  const complete = agents.filter((a) => a.status === "complete").length;
  const totalCost = stats.total_cost + (stats.subagent_cost ?? 0);
  const isFiltered = agents.length !== allAgents.length;

  return (
    <div className="flex items-center gap-4 px-4 py-2.5 border-b border-cw-border bg-cw-surface/60 text-xs font-mono flex-shrink-0">
      <div className="flex items-center gap-1.5 text-cw-subtle">
        <Layers size={11} />
        <span className="text-cw-text font-semibold">{agents.length}</span>
        {isFiltered && (
          <span className="text-cw-muted">/ {allAgents.length}</span>
        )}
        <span>agent{agents.length !== 1 ? "s" : ""}</span>
      </div>

      {running > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-400" />
          </span>
          <span className="text-blue-400">{running} running</span>
        </div>
      )}
      {spawning > 0 && (
        <div className="flex items-center gap-1.5 text-yellow-400">
          <span className="animate-pulse">⏳</span>
          <span>{spawning} spawning</span>
        </div>
      )}
      {complete > 0 && (
        <div className="flex items-center gap-1.5 text-cw-subtle">
          <span>✅</span>
          <span>{complete} complete</span>
        </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-1.5 text-cw-subtle">
        <Cpu size={11} />
        <span>
          Combined:{" "}
          <span className="text-cw-green font-bold">${totalCost.toFixed(4)}</span>
        </span>
      </div>

      {(stats.subagent_input_tokens > 0 || stats.subagent_output_tokens > 0) && (
        <div className="flex items-center gap-1 text-cw-subtle">
          <GitBranch size={11} />
          <span>
            Subagent:{" "}
            <span className="text-cw-purple">
              {(
                stats.subagent_input_tokens + stats.subagent_output_tokens
              ).toLocaleString()}
            </span>{" "}
            tok
          </span>
        </div>
      )}
    </div>
  );
}

// ── Inner graph component (needs to be inside ReactFlowProvider) ───────────────

interface SwarmGraphProps {
  agents: AgentInfo[];
  pulsingAgents: Set<string>;
  mainSessionId: string;
  projects: ProjectInfo[];
}

function SwarmGraph({ agents, pulsingAgents, mainSessionId, projects }: SwarmGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const fitTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Rebuild graph and re-fit whenever agents or pulse state change
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = buildGraph(
      agents,
      pulsingAgents,
      mainSessionId,
      projects
    );
    setNodes(newNodes);
    setEdges(newEdges);

    if (newNodes.length > 0) {
      // Clear any pending fit and schedule a new one.
      // Two nested rAFs ensure React has committed the DOM and ReactFlow
      // has finished its own layout pass before we call fitView.
      clearTimeout(fitTimerRef.current);
      fitTimerRef.current = setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            fitView({ padding: 0.18, duration: 400 });
          });
        });
      }, 50);
    }

    return () => clearTimeout(fitTimerRef.current);
  }, [agents, pulsingAgents, mainSessionId, projects, setNodes, setEdges, fitView]);

  const miniMapNodeColor = useCallback((node: Node) => {
    const data = node.data as AgentNodeData;
    const t = data?.agent?.type;
    if (t === "Explore") return "#388bfd";
    if (t === "Plan")    return "#bc8cff";
    return "#3fb950";
  }, []);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        colorMode="dark"
        minZoom={0.15}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#21262d" gap={24} size={1} />
        <Controls
          style={{
            background: "#161b22",
            border: "1px solid #21262d",
            borderRadius: "8px",
          }}
        />
        <MiniMap
          nodeColor={miniMapNodeColor}
          maskColor="rgba(13,17,23,0.7)"
          style={{
            background: "#161b22",
            border: "1px solid #21262d",
            borderRadius: "8px",
          }}
        />
      </ReactFlow>
    </div>
  );
}

// ── Toolbar ────────────────────────────────────────────────────────────────────

interface ToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (t: TypeFilter) => void;
}

function AgentsToolbar({
  viewMode,
  onViewModeChange,
  typeFilter,
  onTypeFilterChange,
}: ToolbarProps) {
  const typeOptions: TypeFilter[] = ["All", "Explore", "Plan"];

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-cw-border bg-cw-bg/80 backdrop-blur-sm flex-shrink-0">
      {/* Live / All toggle */}
      <div className="flex items-center gap-1 bg-cw-surface border border-cw-border rounded-lg p-0.5">
        <button
          onClick={() => onViewModeChange("all")}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            viewMode === "all"
              ? "bg-cw-accent/15 text-cw-accent border border-cw-accent/20"
              : "text-cw-subtle hover:text-cw-text"
          }`}
        >
          <LayoutGrid size={11} />
          All
        </button>
        <button
          onClick={() => onViewModeChange("live")}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            viewMode === "live"
              ? "bg-cw-green/15 text-cw-green border border-cw-green/20"
              : "text-cw-subtle hover:text-cw-text"
          }`}
        >
          <Radio size={11} />
          Live
        </button>
      </div>

      {/* Type filter dropdown */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-cw-subtle font-medium">Type:</span>
        <select
          value={typeFilter}
          onChange={(e) => onTypeFilterChange(e.target.value as TypeFilter)}
          className="text-xs bg-cw-surface border border-cw-border rounded-md px-2 py-1 text-cw-text focus:outline-none focus:border-cw-accent/50 transition-colors cursor-pointer"
        >
          {typeOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt === "All"
                ? "All Types"
                : opt === "Explore"
                ? "🕵️ Explore"
                : "🧠 Plan"}
            </option>
          ))}
        </select>
      </div>

      {/* Active filter indicator */}
      {(viewMode !== "all" || typeFilter !== "All") && (
        <button
          onClick={() => {
            onViewModeChange("all");
            onTypeFilterChange("All");
          }}
          className="text-[10px] text-cw-muted hover:text-cw-text border border-cw-border/50 rounded px-1.5 py-0.5 transition-colors"
        >
          ✕ Reset filters
        </button>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  agents: AgentInfo[];
  pulsingAgents: Set<string>;
  stats: Stats;
  projects: ProjectInfo[];
}

export function LiveAgentsView({ agents, pulsingAgents, stats, projects }: Props) {
  // Default to "all" so both live and offline agents are shown
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");

  const filteredAgents = useMemo(() => {
    let result = agents;
    if (viewMode === "live") {
      result = result.filter(
        (a) => a.status === "running" || a.status === "spawning"
      );
    }
    if (typeFilter !== "All") {
      result = result.filter((a) => a.type === typeFilter);
    }
    return result;
  }, [agents, viewMode, typeFilter]);

  const isFiltered = viewMode !== "all" || typeFilter !== "All";

  return (
    <div
      className="flex flex-col"
      style={{ height: "calc(100vh - 48px)" }}
    >
      {/* Toolbar: Live/All toggle + type filter */}
      <AgentsToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
      />

      {/* Stats bar */}
      <AgentsStatsBar
        agents={filteredAgents}
        allAgents={agents}
        stats={stats}
      />

      {/* Graph canvas or empty state */}
      <AnimatePresence mode="wait">
        {filteredAgents.length === 0 ? (
          <motion.div
            key="empty"
            className="flex-1 flex"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <EmptyState filtered={isFiltered && agents.length > 0} />
          </motion.div>
        ) : (
          <motion.div
            key="graph"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ flex: 1, minHeight: 0, background: "#0d1117" }}
          >
            <ReactFlowProvider>
              <SwarmGraph
                agents={filteredAgents}
                pulsingAgents={pulsingAgents}
                mainSessionId={stats.session_id}
                projects={projects}
              />
            </ReactFlowProvider>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
