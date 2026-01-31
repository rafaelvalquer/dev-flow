import React, { memo } from "react";
import { Handle, Position } from "reactflow";
import { Split } from "lucide-react";
import { getNodeTone } from "@/components/automation/automationTheme";

function GateNode({ data, selected }) {
  const tone = getNodeTone("gateNode", { selected });
  const targets = Array.isArray(data?.targets) ? data.targets : [];

  return (
    <div className={tone.wrap}>
      <div className={tone.headerBar} />
      <div className={tone.body}>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50">
            <Split className="h-4 w-4 text-zinc-700" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Gate (AND)</div>
            <div className="mt-1 text-[11px] text-zinc-600">
              {targets.length} alvo(s) • todas condições verdadeiras
            </div>
          </div>
        </div>

        <div className="mt-2 text-[11px] text-zinc-500">
          Conecte várias subtarefas aqui e depois conecte o Gate em um Trigger.
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-zinc-400"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-zinc-500"
      />
    </div>
  );
}

export default memo(GateNode);
