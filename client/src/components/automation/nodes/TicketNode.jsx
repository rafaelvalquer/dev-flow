import React, { memo } from "react";
import { Ticket } from "lucide-react";
import {
  getNodeTone,
  ticketStatusTone,
} from "@/components/automation/automationTheme";

function initials(name) {
  const s = String(name || "").trim();
  if (!s) return "—";
  return s
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function TicketNode({ data, selected }) {
  const tone = getNodeTone("ticketNode", { selected });

  const key = data?.ticketKey || "—";
  const status = data?.status || "";
  const assignee = data?.assignee || "";

  return (
    <div className={tone.wrap}>
      <div className={tone.headerBar} />
      <div className={tone.body}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50">
                <Ticket className="h-4 w-4 text-zinc-700" />
              </span>
              <div className="truncate text-sm font-semibold">{key}</div>
            </div>
            {data?.summary ? (
              <div className="mt-1 line-clamp-2 text-[11px] text-zinc-600">
                {data.summary}
              </div>
            ) : null}
          </div>

          {status ? (
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${ticketStatusTone(
                status
              )}`}
            >
              {status}
            </span>
          ) : null}
        </div>

        {assignee ? (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-600">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-[10px] font-semibold text-zinc-700">
              {initials(assignee)}
            </span>
            <span className="truncate">Responsável: {assignee}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(TicketNode);
