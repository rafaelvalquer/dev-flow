import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AUTOMATION_PRESETS,
  TRIGGER_TYPES,
  ACTION_TYPES,
} from "../automationTemplates";
import {
  GripVertical,
  Zap,
  CheckSquare,
  CalendarClock,
  Ticket,
  MessageSquareText,
  ArrowRightLeft,
  UserRoundCog,
} from "lucide-react";

function labelOf(list, key) {
  return list.find((x) => x.key === key)?.label || key;
}

function groupKey(preset) {
  const t = preset?.trigger?.type || "";
  if (t.startsWith("subtask.")) return "Subtarefas";
  if (t.startsWith("activity.")) return "Atividades";
  return "Ticket";
}

function iconForPreset(p) {
  const trg = p?.trigger?.type || "";
  const act = p?.action?.type || "";
  if (trg.startsWith("ticket.")) return Ticket;
  if (trg.startsWith("subtask.")) return CheckSquare;
  if (trg.startsWith("activity.")) return CalendarClock;

  if (act === "jira.comment") return MessageSquareText;
  if (act === "jira.transition") return ArrowRightLeft;
  if (act === "jira.assign") return UserRoundCog;
  return Zap;
}

export default function AutomationTemplates({ onPickTemplate }) {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = String(query || "")
      .trim()
      .toLowerCase();
    const items = (AUTOMATION_PRESETS || []).filter((p) => {
      if (!q) return true;
      const hay =
        `${p.title} ${p.trigger?.type} ${p.action?.type}`.toLowerCase();
      return hay.includes(q);
    });

    const g = { Ticket: [], Subtarefas: [], Atividades: [] };
    for (const p of items) g[groupKey(p)].push(p);
    return g;
  }, [query]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar templates…"
          className="h-9 rounded-xl"
        />
        <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
          {Object.values(grouped).flat().length || 0} itens
        </Badge>
      </div>

      {Object.entries(grouped).map(([group, items]) => {
        if (!items.length) return null;
        return (
          <div key={group} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-zinc-900">
                {group}
              </div>
              <div className="text-[11px] text-zinc-500">
                arraste para o canvas
              </div>
            </div>

            <div className="space-y-2">
              {items.map((p) => {
                const Icon = iconForPreset(p);
                const trgLabel = labelOf(TRIGGER_TYPES, p.trigger?.type);
                const actLabel = labelOf(ACTION_TYPES, p.action?.type);

                return (
                  <button
                    key={p.id}
                    type="button"
                    className={cn(
                      "w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-left",
                      "transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/10"
                    )}
                    onClick={() => onPickTemplate?.(p)}
                    draggable
                    onDragStart={(e) => {
                      const payload = JSON.stringify(p);
                      e.dataTransfer.setData(
                        "application/reactflow",
                        "automationTemplate"
                      );
                      e.dataTransfer.setData("application/json", payload);
                      e.dataTransfer.setData(
                        "application/automation-template",
                        payload
                      );
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50">
                        <Icon className="h-4 w-4 text-zinc-700" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-semibold text-zinc-900">
                            {p.title}
                          </div>
                          <GripVertical className="h-4 w-4 text-zinc-400" />
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
                          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5">
                            {trgLabel}
                          </span>
                          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5">
                            {actLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {!Object.values(grouped).flat().length ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
          Nenhum template encontrado.
        </div>
      ) : null}
    </div>
  );
}
