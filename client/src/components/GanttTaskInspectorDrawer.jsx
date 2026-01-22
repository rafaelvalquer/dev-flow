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

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Link2,
  Link2Off,
  ShieldAlert,
} from "lucide-react";

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

function toneByStatus(statusName) {
  const s = String(statusName || "").toLowerCase();

  // done / finalizado
  if (/(done|conclu|resol|closed|fechad)/i.test(s)) {
    return {
      pill: "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[0_1px_0_rgba(16,185,129,0.12)]",
      dot: "bg-emerald-500",
      label: "Concluído",
      topBar: "bg-emerald-500",
    };
  }

  // bloqueado / backlog
  if (/(bloq|blocked|imped|backlog)/i.test(s)) {
    return {
      pill: "border-red-200 bg-red-50 text-red-700 shadow-[0_1px_0_rgba(239,68,68,0.14)]",
      dot: "bg-red-500",
      label: "Bloqueado/Backlog",
      topBar: "bg-red-600",
    };
  }

  // validação / QA / review
  if (/(review|valida|homolog|qa|teste|aprova)/i.test(s)) {
    return {
      pill: "border-amber-200 bg-amber-50 text-amber-800 shadow-[0_1px_0_rgba(245,158,11,0.14)]",
      dot: "bg-amber-500",
      label: "Validação",
      topBar: "bg-amber-500",
    };
  }

  // em andamento
  if (/(andamento|in progress|doing|progresso|em exec|implement)/i.test(s)) {
    return {
      pill: "border-sky-200 bg-sky-50 text-sky-700 shadow-[0_1px_0_rgba(14,165,233,0.14)]",
      dot: "bg-sky-500",
      label: "Em andamento",
      topBar: "bg-sky-500",
    };
  }

  // default
  return {
    pill: "border-zinc-200 bg-white text-zinc-700 shadow-[0_1px_0_rgba(24,24,27,0.06)]",
    dot: "bg-zinc-400",
    label: "Status",
    topBar: "bg-zinc-400",
  };
}

function toneByPriority(priority) {
  const p = String(priority || "").toLowerCase();

  if (
    /(highest|alta|high|critical|critica|crítica|blocker|urgent|urgente)/i.test(
      p
    )
  ) {
    return {
      pill: "border-red-200 bg-red-50 text-red-700 shadow-[0_1px_0_rgba(239,68,68,0.14)]",
      dot: "bg-red-500",
      label: "Alta",
    };
  }

  if (/(medium|m[eé]dia|med|normal)/i.test(p)) {
    return {
      pill: "border-amber-200 bg-amber-50 text-amber-800 shadow-[0_1px_0_rgba(245,158,11,0.14)]",
      dot: "bg-amber-500",
      label: "Média",
    };
  }

  if (/(low|baixa|minor|trivial)/i.test(p)) {
    return {
      pill: "border-zinc-200 bg-white text-zinc-700 shadow-[0_1px_0_rgba(24,24,27,0.06)]",
      dot: "bg-zinc-400",
      label: "Baixa",
    };
  }

  return {
    pill: "border-zinc-200 bg-white text-zinc-700 shadow-[0_1px_0_rgba(24,24,27,0.06)]",
    dot: "bg-zinc-400",
    label: "Prioridade",
  };
}

function pillBase(className) {
  return cn(
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
    className
  );
}

function miniChip(label, tone = "zinc") {
  const base =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold";

  const cls =
    tone === "red"
      ? cn(base, "border-red-200 bg-red-50 text-red-700")
      : tone === "amber"
      ? cn(base, "border-amber-200 bg-amber-50 text-amber-800")
      : tone === "emerald"
      ? cn(base, "border-emerald-200 bg-emerald-50 text-emerald-700")
      : tone === "sky"
      ? cn(base, "border-sky-200 bg-sky-50 text-sky-700")
      : cn(base, "border-zinc-200 bg-white text-zinc-700");

  return <span className={cls}>{label}</span>;
}

function StatCard({ label, value, tone, icon }) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-white/70 p-3 shadow-sm backdrop-blur",
        tone === "danger" && "border-red-200",
        tone === "success" && "border-emerald-200",
        tone === "neutral" && "border-zinc-200"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-zinc-500">{label}</div>
        {icon ? (
          <div
            className={cn(
              "rounded-full border p-1.5",
              tone === "danger" && "border-red-200 bg-red-50 text-red-700",
              tone === "success" &&
                "border-emerald-200 bg-emerald-50 text-emerald-700",
              tone === "neutral" && "border-zinc-200 bg-white text-zinc-700"
            )}
          >
            {icon}
          </div>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-1 text-sm font-semibold",
          tone === "danger" && "text-red-700",
          tone === "success" && "text-emerald-700",
          tone === "neutral" && "text-zinc-900"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function DepCard({ dir, t, onClick }) {
  if (!t) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/50 p-3 text-xs text-zinc-600">
        —
      </div>
    );
  }

  const Icon = dir === "prev" ? ArrowLeft : ArrowRight;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full rounded-2xl border border-zinc-200 bg-white/70 p-3 text-left shadow-sm backdrop-blur transition",
        "hover:-translate-y-[1px] hover:border-red-200 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-700 group-hover:border-red-200 group-hover:bg-red-50 group-hover:text-red-700">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-zinc-900">
                {t.name}
              </div>
              <div className="mt-0.5 text-[11px] font-medium text-zinc-500">
                {fmtDateBR(t.start)} → {fmtDateBR(t.end)}
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {t.recurso ? miniChip(`Recurso: ${t.recurso}`, "sky") : null}
            {t.area ? miniChip(`Área: ${t.area}`, "zinc") : null}
          </div>
        </div>

        <span className="mt-1 inline-flex items-center text-[11px] font-semibold text-zinc-400 group-hover:text-red-600">
          Ver
        </span>
      </div>
    </button>
  );
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

  const activityName =
    isTask && (task?.name || task?.activityName)
      ? String(task?.name || task?.activityName)
      : "";

  const hasOverdue = Boolean(overdueDays && overdueDays > 0);
  const risk = Boolean(task?.risk || String(task?.risco || "").trim());

  const statusTone = toneByStatus(statusName);
  const priorityTone = toneByPriority(priority);

  // Status bar no topo (overdue ganha prioridade visual)
  const topBarClass = hasOverdue
    ? "bg-red-600"
    : statusTone?.topBar || "bg-emerald-500";

  const headerTitle = isTask ? "Atividade" : "Ticket";
  const headerSubtitle = isTask
    ? "Mini-inspector • ações rápidas e dependências"
    : "Mini-inspector • visão executiva do ticket";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-[420px] max-w-[92vw] p-0",
          "bg-gradient-to-b from-zinc-50 via-white to-white"
        )}
      >
        {/* Top status bar */}
        <div className={cn("h-1 w-full", topBarClass)} />

        <div className="flex h-full flex-col">
          {/* HEADER (sticky) */}
          <div className="sticky top-0 z-20 border-b border-zinc-200/70 bg-white/70 backdrop-blur">
            <SheetHeader className="space-y-1 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="text-[13px] font-semibold text-zinc-900">
                    {headerTitle}
                  </SheetTitle>

                  <SheetDescription className="text-xs text-zinc-500">
                    {headerSubtitle}
                  </SheetDescription>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {/* IssueKey pill premium (SEM avatar) */}
                    <div
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold tracking-wide",
                        "border-red-200 bg-red-50 text-red-700",
                        "shadow-[0_8px_24px_rgba(227,6,19,0.08)]"
                      )}
                      title="Issue Key"
                    >
                      {issueKey}
                    </div>

                    {/* ✅ Destaque da tarefa selecionada */}
                    {isTask && activityName ? (
                      <div
                        className={cn(
                          "inline-flex max-w-[320px] items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold",
                          "border-zinc-200 bg-white text-zinc-800",
                          "shadow-[0_8px_24px_rgba(24,24,27,0.06)]"
                        )}
                        title="Atividade selecionada"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full bg-red-600" />
                        <span className="truncate">{activityName}</span>
                      </div>
                    ) : null}

                    {/* Risk chip forte */}
                    {risk ? (
                      <div
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold",
                          "border-orange-200 bg-orange-50 text-orange-800",
                          "shadow-[0_8px_24px_rgba(249,115,22,0.10)]"
                        )}
                        title="Marcado como risco"
                      >
                        <ShieldAlert className="h-4 w-4" />
                        Risco
                      </div>
                    ) : null}

                    {/* Overdue chip */}
                    {hasOverdue ? (
                      <div
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold",
                          "border-red-200 bg-red-600 text-white shadow-[0_10px_26px_rgba(239,68,68,0.22)]"
                        )}
                        title="Atraso"
                      >
                        <AlertTriangle className="h-4 w-4" />
                        {overdueDays}d atraso
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Quick actions icons */}
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "h-10 w-10 rounded-2xl border-zinc-200 bg-white/70 p-0 shadow-sm backdrop-blur",
                      "hover:border-red-200 hover:bg-red-50"
                    )}
                    onClick={() => onOpenJira?.(issueKey)}
                    title="Abrir no Jira"
                  >
                    <ExternalLink className="h-4 w-4 text-zinc-700" />
                  </Button>

                  {isTask ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "h-10 w-10 rounded-2xl p-0 shadow-sm backdrop-blur transition",
                          risk
                            ? "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100"
                            : "border-zinc-200 bg-white/70 text-zinc-700 hover:border-orange-200 hover:bg-orange-50"
                        )}
                        onClick={() => onToggleRisk?.()}
                        title={risk ? "Remover risco" : "Marcar como risco"}
                      >
                        <ShieldAlert className="h-4 w-4" />
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "h-10 w-10 rounded-2xl p-0 shadow-sm backdrop-blur transition",
                          chainActive
                            ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                            : "border-zinc-200 bg-white/70 text-zinc-700 hover:border-red-200 hover:bg-red-50"
                        )}
                        onClick={() => onToggleChain?.()}
                        title={
                          chainActive
                            ? "Encadeamento ATIVO (clique para desativar)"
                            : "Encadeamento INATIVO (clique para ativar)"
                        }
                      >
                        {chainActive ? (
                          <Link2 className="h-4 w-4" />
                        ) : (
                          <Link2Off className="h-4 w-4" />
                        )}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </SheetHeader>
          </div>

          {/* BODY (scroll) */}
          <div className="flex-1 overflow-auto px-5 pb-6">
            {/* RESUMO DO TICKET */}
            <div className="mt-4 rounded-3xl border border-zinc-200/70 bg-white/70 p-4 shadow-sm backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-zinc-500">
                    Resumo do ticket
                  </div>

                  <div className="mt-1 line-clamp-3 text-[15px] font-semibold leading-snug text-zinc-900">
                    {summary}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {/* Priority */}
                    <span
                      className={pillBase(priorityTone.pill)}
                      title="Prioridade"
                    >
                      <span
                        className={cn("h-2 w-2 rounded-full", priorityTone.dot)}
                      />
                      {priorityTone.label}:{" "}
                      <span className="font-extrabold">{priority}</span>
                    </span>

                    {/* Status */}
                    <span className={pillBase(statusTone.pill)} title="Status">
                      <span
                        className={cn("h-2 w-2 rounded-full", statusTone.dot)}
                      />
                      {statusTone.label}:{" "}
                      <span className="font-extrabold">{statusName}</span>
                    </span>
                  </div>

                  {/* Risco banner elegante */}
                  {risk ? (
                    <div
                      className={cn(
                        "mt-3 rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2",
                        "shadow-[0_10px_24px_rgba(249,115,22,0.10)]"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <ShieldAlert className="mt-0.5 h-4 w-4 text-orange-700" />
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold text-orange-800">
                            Ticket marcado como risco
                          </div>
                          <div className="mt-0.5 text-[11px] text-orange-900/80">
                            Use isso para destacar atenção no fluxo PO e
                            alinhamento.
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* CTA Jira mais forte */}
                <Button
                  type="button"
                  onClick={() => onOpenJira?.(issueKey)}
                  className={cn(
                    "shrink-0 rounded-2xl bg-red-600 text-white shadow-sm",
                    "hover:bg-red-700"
                  )}
                  title="Abrir no Jira"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Abrir Jira
                </Button>
              </div>
            </div>

            {/* DATAS (cards) */}
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold text-zinc-700">Datas</div>
                <div className="text-[11px] text-zinc-500">
                  DueDate • atraso • período
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <StatCard
                  label="DueDate"
                  value={dueDate ? fmtDateBR(dueDate) : "—"}
                  tone="neutral"
                />

                <StatCard
                  label="Status do prazo"
                  value={
                    hasOverdue ? `${overdueDays} dias em atraso` : "Em dia"
                  }
                  tone={hasOverdue ? "danger" : "success"}
                  icon={
                    hasOverdue ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : (
                      <span className="text-[11px] font-black">✓</span>
                    )
                  }
                />

                <StatCard
                  label="Período"
                  value={
                    isTask
                      ? `${fmtDateBR(task?.start)} → ${fmtDateBR(task?.end)}`
                      : "—"
                  }
                  tone="neutral"
                />
              </div>

              <div className="mt-2 text-[11px] text-zinc-500">
                {hasOverdue ? (
                  <span className="font-semibold text-red-700">
                    Atraso calculado com base no DueDate do ticket.
                  </span>
                ) : (
                  <span className="font-semibold text-emerald-700">
                    Tudo em dia no momento.
                  </span>
                )}
              </div>
            </div>

            {/* AÇÕES RÁPIDAS (task only) */}
            {isTask ? (
              <div className="mt-5 rounded-3xl border border-zinc-200/70 bg-white/70 p-4 shadow-sm backdrop-blur">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">
                      Ações rápidas
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      Aplicadas no mesmo fluxo de persistência do Gantt.
                    </div>
                  </div>

                  <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-600" />
                    Execução segura
                  </Badge>
                </div>

                <Separator className="my-3" />

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "h-11 justify-start rounded-2xl border-zinc-200 bg-white/70 shadow-sm backdrop-blur",
                      "hover:border-orange-200 hover:bg-orange-50"
                    )}
                    onClick={() => onToggleRisk?.()}
                    title={risk ? "Remover risco" : "Marcar como risco"}
                  >
                    <ShieldAlert className="mr-2 h-4 w-4" />
                    {risk ? "Remover risco" : "Marcar risco"}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "h-11 justify-start rounded-2xl shadow-sm backdrop-blur",
                      chainActive
                        ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                        : "border-zinc-200 bg-white/70 text-zinc-700 hover:border-red-200 hover:bg-red-50"
                    )}
                    onClick={() => onToggleChain?.()}
                    title={
                      chainActive
                        ? "Encadeamento ATIVO"
                        : "Encadeamento INATIVO"
                    }
                  >
                    {chainActive ? (
                      <Link2 className="mr-2 h-4 w-4" />
                    ) : (
                      <Link2Off className="mr-2 h-4 w-4" />
                    )}
                    Encadeamento
                  </Button>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-zinc-700">
                      Mover datas
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      respeita cascata do encadeamento
                    </div>
                  </div>

                  <div className="mt-2 inline-flex w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white/70 shadow-sm backdrop-blur">
                    {[
                      ["-5", -5],
                      ["-1", -1],
                      ["+1", +1],
                      ["+5", +5],
                    ].map(([label, delta], idx, arr) => {
                      const isLast = idx === arr.length - 1;

                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() => onShiftDates?.(delta)}
                          className={cn(
                            "flex-1 px-3 py-2 text-sm font-extrabold text-zinc-700 transition",
                            "hover:bg-red-50 hover:text-red-700",
                            !isLast && "border-r border-zinc-200"
                          )}
                          title={`Mover ${label} dia(s)`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-2 text-[11px] text-zinc-500">
                    Dica: use isso para ajustes finos sem arrastar a barra.
                  </div>
                </div>
              </div>
            ) : null}

            {/* DEPENDÊNCIAS (task only) */}
            {isTask ? (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold text-zinc-700">
                    Dependências do ticket
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    anterior • próxima
                  </div>
                </div>

                <div className="grid gap-3">
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-zinc-500">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700">
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </span>
                      Prev (anterior)
                    </div>

                    <DepCard
                      dir="prev"
                      t={prevTask}
                      onClick={() => prevTask && onSelectTask?.(prevTask.id)}
                    />
                  </div>

                  <div>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-zinc-500">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                      Next (próxima)
                    </div>

                    <DepCard
                      dir="next"
                      t={nextTask}
                      onClick={() => nextTask && onSelectTask?.(nextTask.id)}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {/* FOOTER */}
            <div className="mt-5 rounded-2xl border border-zinc-200/70 bg-white/60 px-3 py-2 text-[11px] text-zinc-500 shadow-sm backdrop-blur">
              Clique em qualquer item para selecionar no Gantt.
              <span className="ml-2 font-semibold text-zinc-700">
                (foco no drawer)
              </span>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
