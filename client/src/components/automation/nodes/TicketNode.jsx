import React from "react";
import { Badge } from "@/components/ui/badge";
import { Handle, Position } from "reactflow";

export default function TriggerNode({ data, selected }) {
  const execStatus = String(data?.execStatus || "");
  const executed = execStatus === "success";
  const erro = execStatus === "error";

  const boxCls = [
    "min-w-[260px] rounded-2xl border p-3 shadow-sm",
    executed
      ? "border-green-200 bg-green-50"
      : erro
      ? "border-red-200 bg-red-50"
      : "border-zinc-200 bg-white",
    selected
      ? executed
        ? "ring-2 ring-green-100 border-green-300"
        : erro
        ? "ring-2 ring-red-100 border-red-300"
        : "ring-2 ring-red-100 border-red-300"
      : "",
  ].join(" ");

  const badgeCls = executed
    ? "border border-green-200 bg-green-50 text-green-700"
    : erro
    ? "border border-red-200 bg-red-50 text-red-700"
    : "border border-red-200 bg-red-50 text-red-700";

  const badgeText = executed ? "Executada" : erro ? "Erro" : "Gatilho";

  return (
    <div className={boxCls}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-zinc-900">
            {data?.name || "Gatilho"}
          </div>
          <div className="mt-1 text-[11px] text-zinc-600">
            {data?.trigger?.type}
          </div>
          {executed && data?.execAt ? (
            <div className="mt-1 text-[11px] text-zinc-600">
              Última execução: {new Date(data.execAt).toLocaleString()}
            </div>
          ) : null}
        </div>

        <Badge className={badgeCls}>{badgeText}</Badge>
      </div>

      <div className="mt-2 text-[11px] text-zinc-600 line-clamp-2">
        {data?.hint ||
          "Conecte a uma ação (e opcionalmente a uma subtarefa/atividade)."}
      </div>

      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
