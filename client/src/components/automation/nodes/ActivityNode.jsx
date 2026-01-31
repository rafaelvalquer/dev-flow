import React, { memo } from "react";
import { Handle, Position } from "reactflow";
import { CalendarClock } from "lucide-react";
import { getNodeTone } from "@/components/automation/automationTheme";

function ActivityNode({ data, selected }) {
  const tone = getNodeTone("activityNode", { selected });
  const name = data?.name || "Atividade";
  const id = data?.id || "";

  return (
    <div className={tone.wrap}>
      <div className={tone.headerBar} />
      <div className={tone.body}>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50">
            <CalendarClock className="h-4 w-4 text-zinc-700" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{name}</div>
            <div className="mt-1 text-[11px] text-zinc-600">
              {id ? `ID: ${id}` : "—"}
            </div>
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-zinc-400"
      />
    </div>
  );
}

export default memo(ActivityNode);
