import React from "react";
import { Badge } from "@/components/ui/badge";
import { Handle, Position } from "reactflow";

export default function TriggerNode({ data, selected }) {
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
            {data.name || "Gatilho"}
          </div>
          <div className="mt-1 text-[11px] text-zinc-600">
            {data.trigger?.type}
          </div>
        </div>
        <Badge className="border border-red-200 bg-red-50 text-red-700">
          Gatilho
        </Badge>
      </div>

      <div className="mt-2 text-[11px] text-zinc-600 line-clamp-2">
        {data.hint ||
          "Conecte a uma ação (e opcionalmente a uma subtarefa/atividade)."}
      </div>

      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
