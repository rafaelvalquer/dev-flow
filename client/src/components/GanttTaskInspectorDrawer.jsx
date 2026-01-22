// src/components/GanttTaskInspectorDrawer.jsx
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { AlertTriangle, ExternalLink, Link2, Link2Off } from "lucide-react";

function cn(...a) {
  return a.filter(Boolean).join(" ");
}

function fmtDateBR(d) {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export default function GanttTaskInspectorDrawer({
  open,
  onOpenChange,

  task,
  issue,

  dueDate,
  overdueDays,

  prevTask,
  nextTask,

  chainActive,

  onOpenJira,
  onToggleRisk,
  onShiftDates,
  onToggleChain,
  onSelectTask,
}) {
  const isProject = task?.type === "project";
  const isTask = task?.type === "task";

  const issueKey = task?.issueKey || "—";
  const summary = issue?.summary || task?.summary || "—";
  const priority =
    issue?.priorityName ||
    issue?.priority ||
    issue?.fields?.priority?.name ||
    "—";

  const statusName =
    issue?.statusName ||
    issue?.status ||
    issue?.fields?.status?.name ||
    task?.statusName ||
    "—";

  const hasOverdue = Boolean(overdueDays && overdueDays > 0);

  const risk = Boolean(task?.risk);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] max-w-[92vw] p-0">
        <div className="flex h-full flex-col">
          <SheetHeader className="space-y-1">
            <SheetTitle className="text-base font-semibold">
              {task?.type === "task" ? "Atividade" : "Ticket"}
            </SheetTitle>

            <SheetDescription className="text-xs text-zinc-500">
              {task?.type === "task"
                ? "Detalhes da atividade selecionada e ações rápidas."
                : "Detalhes do ticket selecionado."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-auto px-5 pb-5">
            {/* HEADER / IDENTIDADE */}
            <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="rounded-full bg-zinc-900 text-white">
                      {issueKey}
                    </Badge>

                    {risk ? (
                      <Badge className="rounded-full bg-orange-600 text-white">
                        Risco
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-2 line-clamp-3 text-sm font-semibold text-zinc-900">
                    {summary}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                      Prioridade:{" "}
                      <span className="ml-1 font-semibold">{priority}</span>
                    </Badge>

                    <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                      Status:{" "}
                      <span className="ml-1 font-semibold">{statusName}</span>
                    </Badge>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 rounded-xl border-zinc-200 bg-white"
                  onClick={() => onOpenJira?.(issueKey)}
                  title="Abrir no Jira"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Jira
                </Button>
              </div>

              <Separator className="my-3" />

              {/* DueDate + Atraso */}
              <div className="grid gap-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-zinc-600">DueDate</div>
                  <div className="font-semibold text-zinc-900">
                    {dueDate ? fmtDateBR(dueDate) : "—"}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="text-zinc-600">Atraso</div>
                  <div className="flex items-center gap-2">
                    {hasOverdue ? (
                      <Badge className="rounded-full bg-red-600 text-white">
                        <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                        {overdueDays} dias
                      </Badge>
                    ) : (
                      <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                        —
                      </Badge>
                    )}
                  </div>
                </div>

                {isTask ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-zinc-600">Período</div>
                    <div className="font-semibold text-zinc-900">
                      {fmtDateBR(task?.start)} → {fmtDateBR(task?.end)}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* AÇÕES (TASK) */}
            {isTask ? (
              <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="text-sm font-semibold text-zinc-900">
                  Ações rápidas
                </div>

                <div className="mt-3 grid gap-2">
                  {/* RISCO */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-zinc-600">
                      Marcar como risco
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "rounded-xl border-zinc-200 bg-white",
                        risk && "border-orange-200 bg-orange-50 text-orange-700"
                      )}
                      onClick={() => onToggleRisk?.()}
                    >
                      {risk ? "Remover" : "Marcar"}
                    </Button>
                  </div>

                  {/* SHIFT DATES */}
                  <div className="mt-2">
                    <div className="text-sm text-zinc-600">Mover datas</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[
                        ["-5", -5],
                        ["-1", -1],
                        ["+1", +1],
                        ["+5", +5],
                      ].map(([label, delta]) => (
                        <Button
                          key={label}
                          type="button"
                          variant="outline"
                          className="h-9 rounded-xl border-zinc-200 bg-white"
                          onClick={() => onShiftDates?.(delta)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                    <div className="mt-2 text-[11px] text-zinc-500">
                      Usa o mesmo fluxo do drag/resize e respeita cascata se o
                      encadeamento estiver ativo.
                    </div>
                  </div>

                  {/* TOGGLE CHAIN */}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-sm text-zinc-600">Encadeamento</div>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "rounded-xl border-zinc-200 bg-white",
                        chainActive && "border-red-200 bg-red-50 text-red-700"
                      )}
                      onClick={() => onToggleChain?.()}
                      title={
                        chainActive
                          ? "Encadeamento ATIVO"
                          : "Encadeamento INATIVO"
                      }
                    >
                      {chainActive ? (
                        <>
                          <Link2 className="mr-2 h-4 w-4" />
                          Ativo
                        </>
                      ) : (
                        <>
                          <Link2Off className="mr-2 h-4 w-4" />
                          Inativo
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* DEPENDÊNCIAS (TASK) */}
            {isTask ? (
              <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="text-sm font-semibold text-zinc-900">
                  Dependências do ticket
                </div>

                <Separator className="my-3" />

                <div className="grid gap-3">
                  {/* PREV */}
                  <div>
                    <div className="text-xs font-semibold text-zinc-600">
                      Prev (anterior)
                    </div>
                    {prevTask ? (
                      <button
                        type="button"
                        onClick={() => onSelectTask?.(prevTask.id)}
                        className="mt-2 w-full rounded-xl border border-zinc-200 bg-white p-3 text-left hover:bg-zinc-50"
                      >
                        <div className="truncate text-sm font-semibold text-zinc-900">
                          {prevTask.name}
                        </div>
                        <div className="mt-1 text-xs text-zinc-600">
                          {fmtDateBR(prevTask.start)} →{" "}
                          {fmtDateBR(prevTask.end)}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {prevTask.recurso
                            ? `Recurso: ${prevTask.recurso}`
                            : ""}
                          {prevTask.area ? ` • Área: ${prevTask.area}` : ""}
                        </div>
                      </button>
                    ) : (
                      <div className="mt-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                        —
                      </div>
                    )}
                  </div>

                  {/* NEXT */}
                  <div>
                    <div className="text-xs font-semibold text-zinc-600">
                      Next (próxima)
                    </div>
                    {nextTask ? (
                      <button
                        type="button"
                        onClick={() => onSelectTask?.(nextTask.id)}
                        className="mt-2 w-full rounded-xl border border-zinc-200 bg-white p-3 text-left hover:bg-zinc-50"
                      >
                        <div className="truncate text-sm font-semibold text-zinc-900">
                          {nextTask.name}
                        </div>
                        <div className="mt-1 text-xs text-zinc-600">
                          {fmtDateBR(nextTask.start)} →{" "}
                          {fmtDateBR(nextTask.end)}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {nextTask.recurso
                            ? `Recurso: ${nextTask.recurso}`
                            : ""}
                          {nextTask.area ? ` • Área: ${nextTask.area}` : ""}
                        </div>
                      </button>
                    ) : (
                      <div className="mt-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                        —
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {/* RODAPÉ */}
            <div className="mt-3 text-[11px] text-zinc-500">
              Clique em qualquer item para selecionar no Gantt.
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
