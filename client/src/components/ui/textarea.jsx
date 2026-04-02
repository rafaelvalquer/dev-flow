import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef(function Textarea(
  { className, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[120px] w-full rounded-2xl border border-zinc-200/80 bg-white/92 px-4 py-3 text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]",
        "placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});

export { Textarea };
