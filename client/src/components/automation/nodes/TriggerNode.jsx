import React, { memo, useMemo } from "react";
import { Handle, Position } from "reactflow";
import { Zap, CheckCircle2, XCircle } from "lucide-react";
import { TRIGGER_TYPES } from "@/components/automation/automationTemplates";
import { getNodeTone } from "@/components/automation/automationTheme";

function labelOf(key) {
  return TRIGGER_TYPES.find((t) => t.key === key)?.label || key;
}

function TriggerNode({ data, selected }) {
  const execStatus = data?.execStatus || "";
  const tone = getNodeTone("triggerNode", {
    selected,
    execStatus,
    disabled: data?.enabled === false,
  });

  const trgType = data?.trigger?.type || "";
  const trgLabel = useMemo(() => labelOf(trgType), [trgType]);

  const ExecIcon =
    execStatus === "success"
      ? CheckCircle2
      : execStatus === "error"
      ? XCircle
      : null;

  return (
    <div className={tone.wrap}>
      <div className={tone.headerBar} />
      <div className={tone.body}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50">
                <Zap className="h-4 w-4 text-zinc-700" />
              </span>
              <div className="truncate text-sm font-semibold">
                {data?.name || "Gatilho"}
              </div>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={tone.chip}>{trgLabel}</span>
              {data?.enabled === false ? (
                <span className={tone.chip}>Desativado</span>
              ) : null}
            </div>
          </div>

          {execStatus ? (
            <span className={tone.execChip}>
              {ExecIcon ? <ExecIcon className="mr-1 h-3.5 w-3.5" /> : null}
              {execStatus === "success" ? "Executada" : "Erro"}
            </span>
          ) : null}
        </div>

        {data?.hint ? (
          <div className="mt-2 text-[11px] text-zinc-600">{data.hint}</div>
        ) : null}
        {data?.execAt ? (
          <div className="mt-1 text-[11px] text-zinc-500">
            Última: {String(data.execAt)}
          </div>
        ) : null}
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

export default memo(TriggerNode);
