import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowUpDown, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  PERSONAL_QUEUE_COLUMNS,
  PERSONAL_QUEUE_OTHER_STATUS,
  STATUS_OPTIONS,
} from "./amPanelConstants";
import {
  diffDays,
  extractYmd,
  fmtDateBr,
  getIssueKey,
  getReportDueYmd,
  getTicketStatusName,
  isReportIssueOverdue,
  normalizePlain,
  parseIsoYmdLocal,
  priorityColor,
  startOfTodayLocal,
} from "./amPanelUtils";

function getIssueTypeInfo(ticket) {
  const raw = ticket?.fields?.issuetype || ticket?.issuetype || {};
  const name =
    ticket?.issueType ||
    ticket?.issueTypeName ||
    raw?.name ||
    ticket?.type ||
    "";
  const iconUrl =
    ticket?.issueTypeIconUrl || ticket?.issueTypeIcon || raw?.iconUrl || "";
  return { name, iconUrl };
}

function IssueTypeIcon({ ticket, className = "" }) {
  const [failed, setFailed] = useState(false);
  const info = getIssueTypeInfo(ticket);
  const label = info.name ? "Tipo do ticket: " + info.name : "Tipo do ticket";
  const fallback = String(info.name || "?").trim().charAt(0).toUpperCase() || "?";

  if (info.iconUrl && !failed) {
    return (
      <img
        src={info.iconUrl}
        alt=""
        title={label}
        aria-label={label}
        className={cn("h-4 w-4 shrink-0 object-contain", className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-zinc-200 bg-white text-[9px] font-bold uppercase text-zinc-600",
        className,
      )}
    >
      {fallback}
    </span>
  );
}
function getQueueStatus(issue) {
  const raw = getTicketStatusName(issue) || PERSONAL_QUEUE_OTHER_STATUS;
  const match = STATUS_OPTIONS.find(
    (status) => normalizePlain(status) === normalizePlain(raw),
  );
  return match || PERSONAL_QUEUE_OTHER_STATUS;
}

function getQueueSummary(issue) {
  return issue?.summary || issue?.fields?.summary || "Sem resumo";
}

function getQueuePriority(issue) {
  return (
    issue?.priorityName ||
    issue?.priority ||
    issue?.fields?.priority?.name ||
    "Não informado"
  );
}

function getQueueDueYmd(issue) {
  return (
    extractYmd(issue?.customfield_11519 || issue?.fields?.customfield_11519) ||
    getReportDueYmd(issue)
  );
}

function getQueueUpdatedLabel(issue) {
  const raw = issue?.updatedRaw || issue?.updated || issue?.fields?.updated;
  if (!raw) return "Sem atualizacao";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "Sem atualizacao";
  const days = diffDays(startOfTodayLocal(), date);
  if (days <= 0) return "Atualizado hoje";
  if (days === 1) return "Atualizado ontem";
  return `${days}d sem atualizacao`;
}

function getQueueHealth(issue) {
  if (isReportIssueOverdue(issue)) {
    return {
      label: "🔥 Atrasado",
      className: "border-red-200 bg-red-50 text-red-700",
    };
  }

  const due = parseIsoYmdLocal(getQueueDueYmd(issue));
  if (due) {
    const days = diffDays(due, startOfTodayLocal());
    if (days >= 0 && days <= 7) {
      return {
        label: days === 0 ? "⏳ Hoje" : `⏳ ${days}d`,
        className: "border-amber-200 bg-amber-50 text-amber-800",
      };
    }
  }

  return {
    label: "✅ Em dia",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
}

export default function PersonalQueueView({
  rows,
  loading,
  movingKeys,
  onOpenDetails,
  onMoveStatus,
  title = "Minha Fila",
  description = "Kanban pessoal por status. Arraste um ticket para mover no Jira.",
  actionableLabel = "moviveis",
}) {
  const [activeId, setActiveId] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ticketsByKey = useMemo(() => {
    const map = new Map();
    (rows || []).forEach((issue) => {
      const key = getIssueKey(issue);
      if (key) map.set(key, issue);
    });
    return map;
  }, [rows]);

  const grouped = useMemo(() => {
    const base = Object.fromEntries(
      PERSONAL_QUEUE_COLUMNS.map((status) => [status, []]),
    );

    (rows || []).forEach((issue) => {
      const status = getQueueStatus(issue);
      base[status] = [...(base[status] || []), issue];
    });

    Object.keys(base).forEach((status) => {
      base[status] = [...base[status]].sort((a, b) => {
        const aDue = getQueueDueYmd(a) || "9999-12-31";
        const bDue = getQueueDueYmd(b) || "9999-12-31";
        if (aDue !== bDue) return aDue.localeCompare(bDue);
        return getQueueSummary(a).localeCompare(getQueueSummary(b));
      });
    });

    return base;
  }, [rows]);

  const activeTicket = activeId ? ticketsByKey.get(activeId) : null;
  const total = rows?.length || 0;
  const actionable = (rows || []).filter(
    (issue) => getQueueStatus(issue) !== PERSONAL_QUEUE_OTHER_STATUS,
  ).length;
  const dropAnimation = {
    duration: 260,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  };

  function getTargetStatus(over) {
    const status = over?.data?.current?.status;
    if (status) return status;
    const id = String(over?.id || "");
    if (id.startsWith("column:")) return id.slice("column:".length);
    const overTicket = ticketsByKey.get(id);
    return overTicket ? getQueueStatus(overTicket) : "";
  }

  async function handleDragEnd(event) {
    const key = String(event?.active?.id || "")
      .trim()
      .toUpperCase();
    const targetStatus = getTargetStatus(event?.over);
    const issue = key ? ticketsByKey.get(key) : null;
    const sourceStatus = issue ? getQueueStatus(issue) : "";

    setActiveId(null);

    if (
      !key ||
      !issue ||
      !targetStatus ||
      targetStatus === PERSONAL_QUEUE_OTHER_STATUS ||
      sourceStatus === targetStatus
    ) {
      return;
    }

    await onMoveStatus?.(key, targetStatus, sourceStatus);
  }

  if (loading && !total) {
    return (
      <section className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[520px] rounded-3xl" />
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <Card className="overflow-hidden rounded-3xl border-zinc-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-base text-zinc-900">
                {title}
              </CardTitle>
              <CardDescription>
                {description}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {loading && total ? (
                <Badge className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Atualizando
                </Badge>
              ) : null}
              <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                {total} tickets
              </Badge>
              <Badge className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
                {actionable} {actionableLabel}
              </Badge>
              <Badge className="rounded-full border border-red-200 bg-red-50 text-red-700">
                {(rows || []).filter((issue) => isReportIssueOverdue(issue)).length} atrasados
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event) => setActiveId(event.active?.id || null)}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto pb-4">
          <div className="grid w-max grid-flow-col auto-cols-[minmax(280px,320px)] items-start gap-4">
            {PERSONAL_QUEUE_COLUMNS.map((status) => (
              <PersonalQueueColumn
                key={status}
                status={status}
                tickets={grouped[status] || []}
                movingKeys={movingKeys}
                onOpenDetails={onOpenDetails}
                loading={loading}
              />
            ))}
          </div>
        </div>

        <DragOverlay dropAnimation={dropAnimation}>
          <AnimatePresence mode="popLayout">
            {activeTicket ? (
              <PersonalQueueCard
                key={getIssueKey(activeTicket)}
                ticket={activeTicket}
                moving={false}
                overlay
                onOpenDetails={onOpenDetails}
              />
            ) : null}
          </AnimatePresence>
        </DragOverlay>
      </DndContext>
    </section>
  );
}

function PersonalQueueColumn({
  status,
  tickets,
  movingKeys,
  onOpenDetails,
  loading = false,
}) {
  const isOther = status === PERSONAL_QUEUE_OTHER_STATUS;
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${status}`,
    data: { type: "column", status },
    disabled: isOther,
  });
  const ids = tickets.map((ticket) => getIssueKey(ticket)).filter(Boolean);

  return (
    <motion.div
      ref={setNodeRef}
      layout
      className="w-full min-w-0"
      initial={{ opacity: 0, y: 12 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: isOver && !isOther ? 1.015 : 1,
      }}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 360, damping: 30 }}
    >
      <Card
        className={cn(
          "flex max-h-[74vh] min-h-[440px] flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200",
          isOver && !isOther
            ? "border-red-300 bg-red-50/50 shadow-lg ring-2 ring-red-100"
            : "border-zinc-200",
          isOther && "bg-zinc-50/80",
        )}
      >
        <CardHeader className="border-b border-zinc-100 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" />
              ) : null}
              <CardTitle className="truncate text-sm text-zinc-900">
                {status}
              </CardTitle>
            </div>
            <Badge className="shrink-0 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-700">
              {tickets.length}
            </Badge>
          </div>
          <CardDescription className="line-clamp-1 text-xs">
            {isOther ? "Status fora do fluxo mapeado" : "Solte aqui para mover"}
          </CardDescription>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="grid min-w-0 gap-2">
              <AnimatePresence mode="popLayout" initial={false}>
                {tickets.length ? (
                  tickets.map((ticket) => {
                    const key = getIssueKey(ticket);
                    return (
                      <motion.div
                        key={key}
                        layout
                        className="w-full min-w-0"
                        initial={{ opacity: 0, y: 10, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.96 }}
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 34,
                        }}
                      >
                        <PersonalQueueCard
                          ticket={ticket}
                          disabled={isOther}
                          moving={movingKeys?.has(key)}
                          onOpenDetails={onOpenDetails}
                        />
                      </motion.div>
                    );
                  })
                ) : loading ? (
                  <motion.div
                    key={`loading-${status}`}
                    layout
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    className="grid gap-2"
                  >
                    <Skeleton className="h-28 rounded-xl" />
                    <Skeleton className="h-24 rounded-xl" />
                  </motion.div>
                ) : (
                  <motion.div
                    key={`empty-${status}`}
                    layout
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{
                      opacity: 1,
                      scale: isOver && !isOther ? 1.02 : 1,
                      borderColor:
                        isOver && !isOther
                          ? "rgb(248 113 113)"
                          : "rgb(228 228 231)",
                      backgroundColor:
                        isOver && !isOther
                          ? "rgb(254 242 242)"
                          : "rgb(250 250 250)",
                    }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 360, damping: 30 }}
                    className="grid min-h-[128px] place-items-center rounded-2xl border border-dashed px-3 text-center text-xs text-zinc-500"
                  >
                    {isOver && !isOther
                      ? "Solte para mover aqui."
                      : "Nenhum ticket aqui."}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </SortableContext>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function PersonalQueueCard({
  ticket,
  moving = false,
  disabled = false,
  overlay = false,
  onOpenDetails,
}) {
  const key = getIssueKey(ticket);
  const status = getQueueStatus(ticket);
  const priority = getQueuePriority(ticket);
  const dueYmd = getQueueDueYmd(ticket);
  const health = getQueueHealth(ticket);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: key,
    data: { type: "ticket", status },
    disabled: disabled || moving || overlay,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cn(
        "w-full min-w-0 max-w-full touch-none",
        overlay && "w-[300px]",
      )}
    >
      <motion.div
        layout
        initial={overlay ? false : { opacity: 0, y: 8, scale: 0.98 }}
        animate={{
          opacity: isDragging ? 0.35 : 1,
          y: 0,
          scale: overlay ? 1.04 : 1,
        }}
        exit={{ opacity: 0, y: -8, scale: 0.96 }}
        whileHover={overlay || moving ? undefined : { y: -3, scale: 1.01 }}
        whileTap={overlay || moving ? undefined : { scale: 0.985 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className={cn(
          "group w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-zinc-200 bg-white p-2.5 shadow-sm transition-colors",
          "hover:border-red-200 hover:shadow-md",
          isDragging && "opacity-40",
          overlay && "border-red-200 shadow-2xl ring-4 ring-red-100",
          moving && "pointer-events-none opacity-70",
        )}
      >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onOpenDetails?.(key)}
        >
          <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
            <IssueTypeIcon ticket={ticket} />
            <motion.code
              layout
              whileHover={{ scale: 1.04 }}
              transition={{ type: "spring", stiffness: 500, damping: 28 }}
              className="inline-block rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-700"
            >
              {key}
            </motion.code>
            <span className="max-w-[132px] truncate rounded-full border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
              {status}
            </span>
          </span>
          <h3 className="mt-2 line-clamp-3 whitespace-normal break-words text-[13px] font-semibold leading-5 text-zinc-950 [overflow-wrap:anywhere]">
            {getQueueSummary(ticket)}
          </h3>
        </button>

        <motion.button
          type="button"
          whileHover={
            disabled || moving
              ? undefined
              : { rotate: -6, scale: 1.08 }
          }
          whileTap={disabled || moving ? undefined : { rotate: 0, scale: 0.94 }}
          transition={{ type: "spring", stiffness: 520, damping: 24 }}
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500",
            "cursor-grab active:cursor-grabbing",
            (disabled || moving) && "cursor-not-allowed opacity-50",
          )}
          title={disabled ? "Status fora do fluxo mapeado" : "Arrastar ticket"}
          {...attributes}
          {...listeners}
        >
          <ArrowUpDown className="h-4 w-4" />
        </motion.button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            health.className,
          )}
        >
          {health.label}
        </Badge>
        <Badge
          className="rounded-full border bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-700"
          style={{ borderColor: priorityColor(priority), color: priorityColor(priority) }}
        >
          {priority}
        </Badge>
        {dueYmd ? (
          <Badge className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
            {fmtDateBr(dueYmd)}
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2 text-[11px] text-zinc-500">
        <span className="min-w-0 flex-1 truncate">{getQueueUpdatedLabel(ticket)}</span>
        <AnimatePresence initial={false}>
          {moving ? (
            <motion.span
              key="moving"
              initial={{ opacity: 0, x: 8, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 8, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="inline-flex items-center gap-1 font-semibold text-red-600"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Movendo...
            </motion.span>
          ) : (
            <motion.button
              key="details"
              type="button"
              initial={{ opacity: 0, x: 8, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 8, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 transition hover:border-red-200 hover:text-red-700"
              onClick={() => onOpenDetails?.(key)}
            >
              Detalhes
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      </motion.div>
    </article>
  );
}



