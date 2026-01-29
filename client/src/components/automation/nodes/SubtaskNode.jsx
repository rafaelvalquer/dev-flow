import React from "react";
import { Badge } from "@/components/ui/badge";
import { Handle, Position } from "reactflow";

export default function SubtaskNode({ data }) {
  const done = Boolean(data.done);
  return (
    <div
      className={[
        "min-w-[280px] rounded-2xl border bg-white p-3 shadow-sm",
        done ? "border-green-200" : "border-zinc-200",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-zinc-900">
            {data.title}
          </div>
          <div className="mt-1 text-[11px] text-zinc-600">
            {data.cardTitle ? `${data.cardTitle} • ` : ""}
            {data.stepKey || ""}
          </div>
          <div className="mt-1 text-[11px] text-zinc-600">
            {data.jiraKey ? `Jira: ${data.jiraKey}` : "Sem JiraKey"}
          </div>
        </div>
        <Badge
          className={[
            "border",
            done
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-zinc-200 bg-zinc-50 text-zinc-700",
          ].join(" ")}
        >
          {done ? "Concluída" : "Subtarefa"}
        </Badge>
      </div>

      <Handle type="target" position={Position.Right} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
