import React from "react";
import { Badge } from "@/components/ui/badge";
import { Handle, Position } from "reactflow";

export default function ActivityNode({ data }) {
  const risk = Boolean(data.risk || data.risco);
  return (
    <div
      className={[
        "min-w-[280px] rounded-2xl border bg-white p-3 shadow-sm",
        risk ? "border-red-200" : "border-zinc-200",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-zinc-900">{data.name}</div>
          <div className="mt-1 text-[11px] text-zinc-600">
            {data.data ? `Data: ${data.data}` : "Sem data"}
          </div>
          <div className="mt-1 text-[11px] text-zinc-600">
            {data.recurso || "Sem recurso"} • {data.area || "—"}
          </div>
          <div className="mt-1 text-[11px] text-zinc-600">ID: {data.id}</div>
        </div>

        <Badge
          className={[
            "border",
            risk
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-zinc-200 bg-zinc-50 text-zinc-700",
          ].join(" ")}
        >
          {risk ? "Risco" : "Atividade"}
        </Badge>
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Left} />
    </div>
  );
}
