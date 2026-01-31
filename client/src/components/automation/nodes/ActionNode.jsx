import React, { memo, useMemo } from "react";
import { Handle, Position } from "reactflow";
import {
  PlayCircle,
  CheckCircle2,
  XCircle,
  MessageSquareText,
  ArrowRightLeft,
  UserRoundCog,
} from "lucide-react";
import { ACTION_TYPES } from "@/components/automation/automationTemplates";
import { getNodeTone } from "@/components/automation/automationTheme";

function labelOf(key) {
  return ACTION_TYPES.find((t) => t.key === key)?.label || key;
}
function iconOf(actionType) {
  if (actionType === "jira.comment") return MessageSquareText;
  if (actionType === "jira.transition") return ArrowRightLeft;
  if (actionType === "jira.assign") return UserRoundCog;
  return PlayCircle;
}

function ActionNode({ data, selected }) {
  const execStatus = data?.execStatus || "";
  const tone = getNodeTone("actionNode", { selected, execStatus });

  const actType = data?.action?.type || "";
  const actLabel = useMemo(() => labelOf(actType), [actType]);
  const Icon = iconOf(actType);

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
                <Icon className="h-4 w-4 text-zinc-700" />
              </span>
              <div className="truncate text-sm font-semibold">
                {data?.name || "Ação"}
              </div>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={tone.chip}>{actLabel}</span>
            </div>
          </div>

          {execStatus ? (
            <span className={tone.execChip}>
              {ExecIcon ? <ExecIcon className="mr-1 h-3.5 w-3.5" /> : null}
              {execStatus === "success" ? "Ok" : "Erro"}
            </span>
          ) : null}
        </div>

        {data?.preview ? (
          <div className="mt-2 line-clamp-3 text-[11px] text-zinc-600">
            {data.preview}
          </div>
        ) : (
          <div className="mt-2 text-[11px] text-zinc-500">
            Configure no Inspector.
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-zinc-400"
      />
    </div>
  );
}

export default memo(ActionNode);
