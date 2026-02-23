/**
 * ActivityStream — renders the Plan-Act-Observe threaded message tree.
 *
 * Threading rules:
 *   • A `tool_use` entry is nested under its parent assistant message.
 *   • A `tool_result` entry is nested under the `tool_use` that matches
 *     its `toolUseId`.
 *   • Everything else is top-level.
 */
import { Inbox } from "lucide-react";
import { useEffect, useRef } from "react";
import type { LogEntry } from "../types";
import { MessageBubble } from "./MessageBubble";

interface Props {
  messages: LogEntry[];
  autoScroll: boolean;
}

// ── Tree builder ───────────────────────────────────────────────────────────────

interface TreeNode {
  entry: LogEntry;
  children: TreeNode[];
}

function buildTree(messages: LogEntry[]): TreeNode[] {
  const byUuid = new Map<string, TreeNode>();
  const byToolUseId = new Map<string, TreeNode>(); // tool_use id → node
  const roots: TreeNode[] = [];

  for (const entry of messages) {
    const node: TreeNode = { entry, children: [] };
    byUuid.set(entry.uuid + entry.type, node);

    if (entry.type === "tool_use" && entry.toolUseId) {
      byToolUseId.set(entry.toolUseId, node);
    }

    if (entry.type === "tool_result" && entry.toolUseId) {
      // Attach to the tool_use node
      const parent = byToolUseId.get(entry.toolUseId);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }

    if (
      entry.type === "tool_use" &&
      entry.parentUuid
    ) {
      // Attach to the assistant message that triggered it
      const parentNode = byUuid.get(entry.parentUuid + "assistant");
      if (parentNode) {
        parentNode.children.push(node);
        continue;
      }
    }

    roots.push(node);
  }

  return roots;
}

// ── Recursive renderer ─────────────────────────────────────────────────────────

function RenderNode({ node }: { node: TreeNode }) {
  return (
    <MessageBubble entry={node.entry}>
      {node.children.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          {node.children.map((child) => (
            <RenderNode key={child.entry.uuid + child.entry.type} node={child} />
          ))}
        </div>
      )}
    </MessageBubble>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export function ActivityStream({ messages, autoScroll }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  const tree = buildTree(messages);

  if (tree.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-cw-subtle">
        <Inbox size={36} className="opacity-30" />
        <div className="text-center">
          <p className="font-medium text-sm">Waiting for Claude Code activity…</p>
          <p className="text-xs mt-1 opacity-60">
            Start a Claude Code session to see the stream.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pb-4">
      {tree.map((node) => (
        <RenderNode key={node.entry.uuid + node.entry.type} node={node} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
