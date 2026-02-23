import {
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Code2,
  CornerDownRight,
  User,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import type { LogEntry } from "../types";

interface Props {
  entry: LogEntry;
  children?: React.ReactNode; // nested tool_result / tool_use children
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderText(text: string) {
  // Minimal markdown-lite: fenced code blocks
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```")) {
      const inner = part.slice(3).replace(/^[a-z]*\n/, "").replace(/```$/, "");
      return (
        <pre key={i}>
          <code>{inner}</code>
        </pre>
      );
    }
    // Inline code
    const inline = part.split(/(`[^`]+`)/g);
    return (
      <span key={i}>
        {inline.map((chunk, j) =>
          chunk.startsWith("`") && chunk.endsWith("`") ? (
            <code key={j}>{chunk.slice(1, -1)}</code>
          ) : (
            <span key={j} style={{ whiteSpace: "pre-wrap" }}>
              {chunk}
            </span>
          )
        )}
      </span>
    );
  });
}

// ── Sub-component: ToolUse block ───────────────────────────────────────────────

function ToolUseBlock({ entry, children }: Props) {
  const [open, setOpen] = useState(true);

  const inputStr = entry.toolInput
    ? JSON.stringify(entry.toolInput, null, 2)
    : "";
  const preview = inputStr.length > 120 ? inputStr.slice(0, 120) + "…" : inputStr;

  return (
    <div className="ml-4 mt-1 border-l-2 border-cw-orange/40 pl-3 animate-slide-up">
      {/* Header */}
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 text-xs text-cw-orange font-mono font-medium hover:text-cw-text transition-colors w-full text-left py-0.5"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Wrench size={11} />
        <span>{entry.toolName}</span>
        {!open && (
          <span className="text-cw-subtle font-normal ml-1 truncate max-w-xs">
            {preview}
          </span>
        )}
      </button>

      {open && entry.toolInput && (
        <div className="mt-1 mb-1">
          <pre className="!text-xs !bg-cw-bg !border-cw-muted/50 text-cw-subtle overflow-auto max-h-48">
            <code>{inputStr}</code>
          </pre>
        </div>
      )}

      {/* Nested tool result / children */}
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

// ── Sub-component: ToolResult block ───────────────────────────────────────────

function ToolResultBlock({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);
  const preview = entry.text.slice(0, 80) + (entry.text.length > 80 ? "…" : "");

  return (
    <div className="ml-4 mt-0.5 border-l-2 border-cw-green/30 pl-3">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 text-xs text-cw-green/80 font-mono hover:text-cw-green transition-colors w-full text-left py-0.5"
      >
        <CornerDownRight size={11} />
        <ClipboardList size={11} />
        <span className="font-medium">result</span>
        {!open && (
          <span className="text-cw-subtle font-normal ml-1 truncate max-w-xs">
            {preview}
          </span>
        )}
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {open && (
        <pre className="mt-1 !text-xs !bg-cw-bg !border-cw-muted/50 text-cw-subtle overflow-auto max-h-40">
          <code>{entry.text}</code>
        </pre>
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export function MessageBubble({ entry, children }: Props) {
  if (entry.type === "tool_use") {
    return <ToolUseBlock entry={entry}>{children}</ToolUseBlock>;
  }

  if (entry.type === "tool_result") {
    return <ToolResultBlock entry={entry} />;
  }

  const isUser      = entry.role === "user";
  const isAssistant = entry.role === "assistant";

  const Icon = isUser ? User : Bot;
  const iconColor = isUser
    ? "text-cw-subtle bg-cw-muted/40"
    : "text-cw-accent bg-cw-accent/10";

  const borderColor = isUser ? "border-cw-muted/30" : "border-cw-accent/20";
  const bgColor     = isUser ? "bg-cw-surface/60" : "bg-cw-surface";

  return (
    <div className={`flex gap-3 p-3 rounded-xl border ${borderColor} ${bgColor} animate-slide-up`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${iconColor}`}>
        <Icon size={14} />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-semibold ${isUser ? "text-cw-subtle" : "text-cw-accent"}`}>
            {isUser ? "User" : "Claude"}
          </span>
          {entry.model && (
            <span className="text-xs text-cw-muted font-mono">
              {entry.model}
            </span>
          )}
          <span className="text-xs text-cw-muted ml-auto font-mono">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
          {entry.cost > 0 && (
            <span className="text-xs text-cw-green font-mono">
              ${entry.cost.toFixed(5)}
            </span>
          )}
        </div>

        {/* Content */}
        {entry.text && (
          <div className="text-sm text-cw-text leading-relaxed message-text">
            {isAssistant ? renderText(entry.text) : (
              <span style={{ whiteSpace: "pre-wrap" }}>{entry.text}</span>
            )}
          </div>
        )}

        {/* Usage pills */}
        {entry.usage && (
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {entry.usage.input_tokens > 0 && (
              <span className="flex items-center gap-1 text-xs text-cw-subtle">
                <Code2 size={10} />
                {entry.usage.input_tokens.toLocaleString()} in
              </span>
            )}
            {entry.usage.output_tokens > 0 && (
              <span className="flex items-center gap-1 text-xs text-cw-accent">
                <Code2 size={10} />
                {entry.usage.output_tokens.toLocaleString()} out
              </span>
            )}
            {(entry.usage.cache_creation_input_tokens ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-xs text-cw-purple">
                ↑ {(entry.usage.cache_creation_input_tokens ?? 0).toLocaleString()} cached
              </span>
            )}
            {(entry.usage.cache_read_input_tokens ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-xs text-cw-yellow">
                ↓ {(entry.usage.cache_read_input_tokens ?? 0).toLocaleString()} cache hit
              </span>
            )}
          </div>
        )}

        {/* Nested tool calls */}
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}
