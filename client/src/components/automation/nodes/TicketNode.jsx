import React from "react";
import { Badge } from "@/components/ui/badge";
import { Handle, Position } from "reactflow";

export default function TicketNode({ data }) {
  return (
    <div className="min-w-[260px] rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900">
            {data.ticketKey}
          </div>
          <div className="mt-1 line-clamp-2 text-xs text-zinc-600">
            {data.summary || "—"}
          </div>
        </div>
        <Badge className="border border-red-200 bg-red-50 text-red-700">
          Ticket
        </Badge>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {data.status ? (
          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700">
            {data.status}
          </span>
        ) : null}
        {data.assignee ? (
          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700">
            {data.assignee}
          </span>
        ) : null}
      </div>

      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Top} />
    </div>
  );
}
