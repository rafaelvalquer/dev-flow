import React from "react";
import { Badge } from "@/components/ui/badge";
import { Handle, Position } from "reactflow";

export default function ActionNode({ data, selected }) {
  return (
    <div
      className={[
        "min-w-[260px] rounded-2xl border bg-white p-3 shadow-sm",
        selected ? "border-red-300 ring-2 ring-red-100" : "border-zinc-200",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-zinc-900">
            {data.name || "Ação"}
          </div>
          <div className="mt-1 text-[11px] text-zinc-600">
            {data.action?.type}
          </div>
        </div>
        <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
          Ação
        </Badge>
      </div>

      <div className="mt-2 text-[11px] text-zinc-600 line-clamp-2">
        {data.preview || "Edite no Inspector"}
      </div>

      <Handle type="target" position={Position.Top} />
    </div>
  );
}
