import { cn } from "@/lib/utils";

export const NODE_TONES = {
  ticketNode: {
    key: "ticket",
    label: "Ticket",
    header: "bg-indigo-500/10",
    border: "border-indigo-200",
    tint: "bg-indigo-50/40",
    text: "text-indigo-900",
    mini: "#6366F1",
  },
  subtaskNode: {
    key: "subtask",
    label: "Subtarefa",
    header: "bg-amber-500/10",
    border: "border-amber-200",
    tint: "bg-amber-50/40",
    text: "text-amber-900",
    mini: "#F59E0B",
  },
  activityNode: {
    key: "activity",
    label: "Atividade",
    header: "bg-cyan-500/10",
    border: "border-cyan-200",
    tint: "bg-cyan-50/40",
    text: "text-cyan-900",
    mini: "#06B6D4",
  },
  triggerNode: {
    key: "trigger",
    label: "Trigger",
    header: "bg-violet-500/10",
    border: "border-violet-200",
    tint: "bg-violet-50/40",
    text: "text-violet-900",
    mini: "#8B5CF6",
  },
  actionNode: {
    key: "action",
    label: "Action",
    header: "bg-emerald-500/10",
    border: "border-emerald-200",
    tint: "bg-emerald-50/40",
    text: "text-emerald-900",
    mini: "#10B981",
  },
  gateNode: {
    key: "gate",
    label: "AND",
    header: "bg-orange-500/10",
    border: "border-orange-200",
    tint: "bg-orange-50/40",
    text: "text-orange-900",
    mini: "#F97316",
  },
};

export function execTone(execStatus) {
  const s = String(execStatus || "");
  if (s === "success") {
    return {
      ring: "ring-emerald-300/50",
      badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
      tint: "bg-emerald-50/30",
      edge: { stroke: "#10B981", animated: true },
    };
  }
  if (s === "error") {
    return {
      ring: "ring-rose-300/50",
      badge: "border-rose-200 bg-rose-50 text-rose-700",
      tint: "bg-rose-50/30",
      edge: { stroke: "#F43F5E", animated: false },
    };
  }
  return {
    ring: "",
    badge: "border-zinc-200 bg-zinc-50 text-zinc-700",
    tint: "",
    edge: { stroke: "#A1A1AA", animated: false },
  };
}

export function getNodeTone(
  nodeType,
  { selected = false, execStatus = "", disabled = false } = {}
) {
  const t = NODE_TONES[nodeType] || NODE_TONES.triggerNode;
  const ex = execTone(execStatus);

  return {
    wrap: cn(
      "rounded-2xl border bg-white shadow-sm transition",
      "min-w-[260px] max-w-[320px]",
      t.border,
      selected && "ring-2 ring-zinc-900/10 ring-offset-2",
      ex.ring,
      ex.tint,
      disabled && "opacity-60"
    ),
    headerBar: cn("h-2 w-full rounded-t-2xl", t.header),
    body: cn("px-3 py-2", t.text),
    sub: "text-[11px] text-zinc-600",
    chip: cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]",
      "border-zinc-200 bg-zinc-50 text-zinc-700"
    ),
    execChip: cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]",
      ex.badge
    ),
  };
}

export function minimapColor(nodeType) {
  return (NODE_TONES[nodeType] || NODE_TONES.triggerNode).mini;
}

// Ticket status pill (heurística por texto)
export function ticketStatusTone(status) {
  const s = String(status || "").toLowerCase();
  if (/(done|conclu|fechad|resolvid)/.test(s))
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (/(progress|andamento|fazendo|doing)/.test(s))
    return "border-amber-200 bg-amber-50 text-amber-800";
  if (/(bloq|blocked|imped)/.test(s))
    return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}
