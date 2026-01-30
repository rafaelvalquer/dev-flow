// src/components/automation/nodes/GateNode.jsx
import React from "react";
import { Badge } from "@/components/ui/badge";
import { Handle, Position } from "reactflow";

export default function GateNode({ data, selected }) {
  const targets = Array.isArray(data?.targets) ? data.targets : [];
  const count = targets.length;

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
            {data?.name || "Centralizador (AND)"}
          </div>
          <div className="mt-1 text-[11px] text-zinc-600">
            {count
              ? `${count} subtarefa(s) conectada(s)`
              : "Conecte várias subtarefas aqui"}
          </div>
        </div>

        <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
          AND
        </Badge>
      </div>

      <div className="mt-2 text-[11px] text-zinc-600">
        Dispara quando <span className="font-semibold">todas</span> as
        subtarefas conectadas estiverem concluídas.
      </div>

      {/* Aceita conexões vindo de qualquer lado */}
      <Handle type="target" position={Position.Left} id="inL" />
      <Handle type="target" position={Position.Right} id="inR" />

      {/* Saída para conectar no Trigger */}
      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  );
}
