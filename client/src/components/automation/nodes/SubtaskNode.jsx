import React, { memo, useMemo } from "react";
import { Handle, Position } from "reactflow";
import { CheckSquare } from "lucide-react";
import { getNodeTone } from "@/components/automation/automationTheme";

function normalizeStatus(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return v.name || v.status || v.label || "";
  return String(v);
}

function statusPillClass(statusRaw, doneFlag) {
  const s = String(statusRaw || "")
    .trim()
    .toLowerCase();

  const isDone =
    doneFlag === true ||
    s.includes("done") ||
    s.includes("conclu") ||
    s.includes("fechad") ||
    s.includes("resolvid") ||
    s.includes("closed");

  const isBacklog =
    s.includes("backlog") ||
    s === "to do" ||
    s === "todo" ||
    s.includes("a fazer") ||
    s.includes("aberto") ||
    s.includes("open");

  const isDoing =
    s.includes("doing") ||
    s.includes("in progress") ||
    s.includes("andamento") ||
    s.includes("progress");

  const isBlocked =
    s.includes("blocked") || s.includes("bloque") || s.includes("imped");

  if (isDone) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (isBlocked) return "border-red-200 bg-red-50 text-red-700";
  if (isDoing) return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (isBacklog) return "border-zinc-200 bg-zinc-50 text-zinc-700";
  return "border-zinc-200 bg-white text-zinc-700";
}

function SubtaskNode({ data, selected }) {
  const tone = getNodeTone("subtaskNode", { selected });

  const title = data?.title || "Subtarefa";
  const jiraKey = data?.jiraKey || data?.key || "";

  const statusText = useMemo(() => {
    const raw =
      normalizeStatus(data?.status) ||
      normalizeStatus(data?.jiraStatus) ||
      normalizeStatus(data?.state) ||
      normalizeStatus(data?.column);

    // se não tiver texto mas vier done=true, mostra algo útil
    if (!raw && data?.done === true) return "Concluído";
    return raw;
  }, [data?.status, data?.jiraStatus, data?.state, data?.column, data?.done]);

  const pillCls = useMemo(
    () => statusPillClass(statusText, data?.done),
    [statusText, data?.done]
  );

  return (
    <div className={tone.wrap}>
      <div className={tone.headerBar} />

      <div className={tone.body}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50">
                <CheckSquare className="h-4 w-4 text-zinc-700" />
              </span>

              <div className="truncate text-sm font-semibold">{title}</div>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
              <span>{jiraKey ? `Key: ${jiraKey}` : "—"}</span>

              {statusText ? (
                <span
                  className={[
                    "inline-flex items-center rounded-full border px-2 py-0.5",
                    "text-[11px] font-medium",
                    pillCls,
                  ].join(" ")}
                  title="Status da subtarefa"
                >
                  {statusText}
                </span>
              ) : null}
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

export default memo(SubtaskNode);
