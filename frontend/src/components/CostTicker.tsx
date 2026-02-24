import { BookOpen, Cpu, Database, DollarSign, GitBranch, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import type { SparkPoint, Stats } from "../types";
import { TokenSparkline } from "./TokenSparkline";

/** Countdown to the next top-of-hour (Anthropic rate-limit window reset). */
function useHourReset() {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    function calc() {
      const now = new Date();
      const next = new Date(now);
      next.setHours(now.getHours() + 1, 0, 0, 0);
      setSecondsLeft(Math.round((next.getTime() - now.getTime()) / 1000));
    }
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, []);

  const m = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const s = String(secondsLeft % 60).padStart(2, "0");
  const pct = secondsLeft / 3600; // fraction of hour remaining

  // colour shifts from green → yellow → red as the reset approaches
  const color =
    secondsLeft > 600 ? "text-cw-green" :
    secondsLeft > 120 ? "text-cw-yellow" :
                        "text-cw-red";

  return { display: `${m}:${s}`, pct, color };
}

interface Props {
  stats: Stats;
  sparkPoints: SparkPoint[];
}

function StatRow({
  icon: Icon,
  label,
  value,
  sub,
  color = "text-cw-text",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-cw-border/50 last:border-0">
      <div className="flex items-center gap-2 text-cw-subtle text-xs">
        <Icon size={12} />
        {label}
      </div>
      <div className={`text-right ${color}`}>
        <span className="font-mono text-sm font-medium">{value}</span>
        {sub && <span className="text-xs text-cw-subtle ml-1">{sub}</span>}
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toString();
}

export function CostTicker({ stats, sparkPoints }: Props) {
  const totalTokens = stats.total_input_tokens + stats.total_output_tokens;
  const reset = useHourReset();

  const hasSubagents = (stats.active_agent_count ?? 0) > 0 ||
    (stats.subagent_cost ?? 0) > 0;

  const combinedCost = stats.total_cost + (stats.subagent_cost ?? 0);
  const combinedInput  = stats.total_input_tokens  + (stats.subagent_input_tokens  ?? 0);
  const combinedOutput = stats.total_output_tokens + (stats.subagent_output_tokens ?? 0);

  return (
    <div className="bg-cw-surface border border-cw-border rounded-xl p-4 flex flex-col gap-3">
      {/* Cost headline */}
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-cw-green/10 border border-cw-green/20">
          <DollarSign size={14} className="text-cw-green" />
        </div>
        <span className="text-xs font-semibold text-cw-subtle uppercase tracking-wider">
          {hasSubagents ? "Combined Cost" : "Session Cost"}
        </span>
      </div>

      {/* Main cost figure */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-bold font-mono text-cw-green">
            ${combinedCost.toFixed(4)}
          </span>
          <span className="text-xs text-cw-subtle">USD</span>
        </div>

        {/* Subagent cost breakdown pill (only when agents are active) */}
        {hasSubagents && (
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1.5 text-[10px] font-mono">
              <span className="text-cw-subtle">Session</span>
              <span className="text-cw-green">${stats.total_cost.toFixed(4)}</span>
            </div>
            {(stats.subagent_cost ?? 0) > 0 && (
              <>
                <span className="text-cw-muted opacity-40">+</span>
                <div className="flex items-center gap-1 text-[10px] font-mono">
                  <GitBranch size={9} className="text-cw-purple" />
                  <span className="text-cw-subtle">Agents</span>
                  <span className="text-cw-purple">${(stats.subagent_cost ?? 0).toFixed(4)}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Token breakdown */}
      <div className="mt-1">
        <StatRow
          icon={BookOpen}
          label="Input tokens"
          value={fmt(hasSubagents ? combinedInput : stats.total_input_tokens)}
          color="text-cw-text"
        />
        <StatRow
          icon={Cpu}
          label="Output tokens"
          value={fmt(hasSubagents ? combinedOutput : stats.total_output_tokens)}
          color="text-cw-accent"
        />
        <StatRow
          icon={Database}
          label="Cache write"
          value={fmt(stats.total_cache_write)}
          color="text-cw-purple"
        />
        <StatRow
          icon={Database}
          label="Cache read"
          value={fmt(stats.total_cache_read)}
          color="text-cw-yellow"
        />
        <StatRow
          icon={DollarSign}
          label="Total tokens"
          value={fmt(hasSubagents ? combinedInput + combinedOutput : totalTokens)}
          color="text-cw-text"
        />

        {/* Active subagent count row */}
        {(stats.active_agent_count ?? 0) > 0 && (
          <div className="flex items-center justify-between pt-1.5 mt-0.5 border-t border-cw-border/30">
            <div className="flex items-center gap-2 text-cw-subtle text-xs">
              <GitBranch size={12} />
              Active agents
            </div>
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cw-green opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cw-green" />
              </span>
              <span className="font-mono text-sm font-medium text-cw-green">
                {stats.active_agent_count}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Rate-limit reset countdown */}
      <div className="border-t border-cw-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs text-cw-subtle uppercase tracking-wider font-semibold">
            <Timer size={11} />
            Rate limit resets
          </div>
          <span className={`font-mono text-sm font-bold ${reset.color}`}>
            {reset.display}
          </span>
        </div>
        {/* Progress bar — full = lots of time left, empty = almost reset */}
        <div className="h-1 rounded-full bg-cw-muted/40 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${reset.pct * 100}%`,
              background:
                reset.pct > 0.167
                  ? "rgb(63,185,80)"   // cw-green
                  : reset.pct > 0.033
                  ? "rgb(210,153,34)"  // cw-yellow
                  : "rgb(248,81,73)",  // cw-red
            }}
          />
        </div>
      </div>

      {/* Sparkline */}
      <div className="border-t border-cw-border pt-3">
        <p className="text-xs text-cw-subtle mb-2 uppercase tracking-wider font-semibold">
          Output throughput
        </p>
        <TokenSparkline data={sparkPoints} currentTps={stats.tokens_per_second} />
      </div>
    </div>
  );
}
