import React from "react";

import { cn } from "@/lib/utils";

export default function ToolWorkspaceHeader({
  title,
  icon: Icon,
  status = null,
  actions = null,
  className,
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon ? (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-zinc-50 text-red-600">
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
        <h2 className="min-w-0 truncate text-sm font-semibold text-zinc-950">
          {title}
        </h2>
      </div>

      {status || actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {status}
          {actions}
        </div>
      ) : null}
    </header>
  );
}
