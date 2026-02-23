import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import type { SparkPoint } from "../types";

interface Props {
  data: SparkPoint[];
  currentTps: number;
}

export function TokenSparkline({ data, currentTps }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-cw-accent font-mono">
          {currentTps.toFixed(1)}
        </span>
        <span className="text-xs text-cw-subtle">tok/s</span>
      </div>

      <div className="h-12 w-full">
        {data.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="tpsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#388bfd" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#388bfd" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <YAxis domain={[0, "auto"]} hide />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-cw-surface border border-cw-border rounded px-2 py-1 text-xs text-cw-text">
                      {(payload[0].value as number).toFixed(1)} tok/s
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="tps"
                stroke="#388bfd"
                strokeWidth={1.5}
                fill="url(#tpsGrad)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-12 flex items-center justify-center text-xs text-cw-muted">
            Waiting for tokens…
          </div>
        )}
      </div>
    </div>
  );
}
