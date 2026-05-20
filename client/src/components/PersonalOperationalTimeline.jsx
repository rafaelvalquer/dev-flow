import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  CalendarClock,
  ChevronDown,
  Clock,
  Filter,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  Search,
  UserRound,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { jiraGetComments, jiraGetIssueChangelog } from "../lib/jiraClient";
import { adfSafeToText } from "../utils/gmudUtils";

const PERIOD_OPTIONS = [
  { id: "today", label: "Hoje" },
  { id: "7", label: "7 dias" },
  { id: "30", label: "30 dias" },
  { id: "custom", label: "Personalizado" },
];

const EVENT_TYPES = {
  comment: {
    label: "Comentario",
    group: "comentarios",
    color: "#3b82f6",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  status_changed: {
    label: "Status",
    group: "status",
    color: "#ef4444",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  assignee_changed: {
    label: "Responsavel",
    group: "responsavel",
    color: "#8b5cf6",
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
  priority_changed: {
    label: "Prioridade",
    group: "prioridade",
    color: "#f59e0b",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  date_changed: {
    label: "Data",
    group: "data",
    color: "#14b8a6",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  label_changed: {
    label: "Label",
    group: "campo",
    color: "#0d9488",
    className: "border-teal-200 bg-teal-50 text-teal-700",
  },
  attachment_changed: {
    label: "Anexo",
    group: "outros",
    color: "#94a3b8",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  },
  field_changed: {
    label: "Campo",
    group: "campo",
    color: "#6366f1",
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  other: {
    label: "Outros",
    group: "outros",
    color: "#a1a1aa",
    className: "border-zinc-200 bg-zinc-50 text-zinc-700",
  },
};

const CHART_KEYS = [
  { key: "comentarios", label: "Comentarios", color: EVENT_TYPES.comment.color },
  { key: "status", label: "Status", color: EVENT_TYPES.status_changed.color },
  { key: "responsavel", label: "Responsavel", color: EVENT_TYPES.assignee_changed.color },
  { key: "prioridade", label: "Prioridade", color: EVENT_TYPES.priority_changed.color },
  { key: "data", label: "Data", color: EVENT_TYPES.date_changed.color },
  { key: "campo", label: "Campo", color: EVENT_TYPES.field_changed.color },
  { key: "outros", label: "Outros", color: EVENT_TYPES.other.color },
];

function cn(...items) {
  return items.filter(Boolean).join(" ");
}

function normalizePlain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getIssueKey(issue) {
  return String(issue?.key || issue?.issueKey || "")
    .trim()
    .toUpperCase();
}

function getIssueSummary(issue) {
  return issue?.summary || issue?.fields?.summary || "Sem resumo";
}

function getIssueStatus(issue) {
  return issue?.statusName || issue?.fields?.status?.name || issue?.status?.name || "Sem status";
}

function getIssuePriority(issue) {
  return issue?.priorityName || issue?.priority || issue?.fields?.priority?.name || "Nao informado";
}

function getIssueOwner(issue) {
  return (
    issue?.assignee ||
    issue?.assigneeDisplayName ||
    issue?.fields?.assignee?.displayName ||
    "Sem responsavel"
  );
}

function actorName(actor) {
  return actor?.displayName || actor?.name || actor?.emailAddress || "Jira";
}

function actorAvatar(actor) {
  return actor?.avatarUrls?.["48x48"] || actor?.avatarUrls?.["32x32"] || "";
}

function parseDate(value) {
  if (!value) return null;
  const normalized = String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toYmd(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDayLabel(ymd) {
  const today = toYmd(new Date());
  const yesterday = toYmd(addDays(new Date(), -1));
  if (ymd === today) return "Hoje";
  if (ymd === yesterday) return "Ontem";
  const [year, month, day] = String(ymd || "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : ymd || "--";
}

function formatTime(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return "--:--";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatShortDate(date) {
  if (!date) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function periodRange(period, customFrom, customTo) {
  const today = startOfDay(new Date());
  if (period === "today") return { from: today, to: endOfDay(new Date()) };
  if (period === "30") return { from: startOfDay(addDays(today, -29)), to: endOfDay(new Date()) };
  if (period === "custom") {
    const from = customFrom ? startOfDay(new Date(`${customFrom}T00:00:00`)) : null;
    const to = customTo ? endOfDay(new Date(`${customTo}T00:00:00`)) : null;
    return { from, to };
  }
  return { from: startOfDay(addDays(today, -6)), to: endOfDay(new Date()) };
}

function classifyChange(item = {}) {
  const field = normalizePlain(item.field || item.fieldId || "");
  if (field === "status") return "status_changed";
  if (field === "assignee" || field === "responsavel" || field === "responsavel jira") {
    return "assignee_changed";
  }
  if (field === "priority" || field === "prioridade") return "priority_changed";
  if (
    field.includes("date") ||
    field.includes("data") ||
    field.includes("due") ||
    field.includes("duedate")
  ) {
    return "date_changed";
  }
  if (field === "labels" || field === "label") return "label_changed";
  if (field === "attachment" || field === "anexo") return "attachment_changed";
  return field ? "field_changed" : "other";
}

function buildIssueMeta(issue) {
  return {
    issueKey: getIssueKey(issue),
    issueSummary: getIssueSummary(issue),
    currentStatus: getIssueStatus(issue),
    currentPriority: getIssuePriority(issue),
    currentOwner: getIssueOwner(issue),
  };
}

function normalizeComment(comment, issue) {
  const createdAt = parseDate(comment?.created || comment?.updated);
  if (!createdAt) return null;
  const meta = buildIssueMeta(issue);
  const text = String(adfSafeToText(comment?.body) || "").trim();
  return {
    id: `${meta.issueKey}-comment-${comment?.id || createdAt.getTime()}`,
    ...meta,
    type: "comment",
    actorName: actorName(comment?.author || comment?.updateAuthor),
    actorAvatar: actorAvatar(comment?.author || comment?.updateAuthor),
    createdAt,
    field: "comment",
    from: "",
    to: "",
    commentBody: text,
  };
}

function normalizeChange(history, item, issue, index) {
  const createdAt = parseDate(history?.created);
  if (!createdAt) return null;
  const meta = buildIssueMeta(issue);
  const type = classifyChange(item);
  return {
    id: `${meta.issueKey}-${history?.id || createdAt.getTime()}-${index}`,
    ...meta,
    type,
    actorName: actorName(history?.author),
    actorAvatar: actorAvatar(history?.author),
    createdAt,
    field: item?.field || item?.fieldId || "Campo",
    from: item?.fromString || item?.from || "",
    to: item?.toString || item?.to || "",
    commentBody: null,
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function eventSentence(event) {
  const type = EVENT_TYPES[event.type] || EVENT_TYPES.other;
  if (event.type === "comment") return `${event.actorName} comentou em ${event.issueKey}`;
  if (event.type === "status_changed") return `${event.actorName} alterou status de ${event.issueKey}`;
  if (event.type === "assignee_changed") return `${event.actorName} alterou responsavel de ${event.issueKey}`;
  if (event.type === "priority_changed") return `${event.actorName} alterou prioridade de ${event.issueKey}`;
  if (event.type === "date_changed") return `${event.actorName} alterou data de ${event.issueKey}`;
  return `${event.actorName} alterou ${type.label.toLowerCase()} em ${event.issueKey}`;
}

function typeBadgeClass(type) {
  return (EVENT_TYPES[type] || EVENT_TYPES.other).className;
}

function typeLabel(type) {
  return (EVENT_TYPES[type] || EVENT_TYPES.other).label;
}

function TimelineChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const visiblePayload = payload.filter((item) => Number(item?.value || 0) > 0);
  const total = visiblePayload.reduce(
    (sum, item) => sum + Number(item?.value || 0),
    0,
  );

  return (
    <div className="min-w-[180px] rounded-2xl border border-zinc-200 bg-white/95 p-3 text-sm shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-semibold text-zinc-950">{label}</span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
          {total}
        </span>
      </div>
      <div className="grid gap-1.5">
        {visiblePayload.length ? (
          visiblePayload.map((item) => {
            const chartEntry = CHART_KEYS.find(
              (entry) => entry.key === item.dataKey,
            );
            return (
              <div
                key={item.dataKey}
                className="flex items-center justify-between gap-4 text-xs"
              >
                <span className="inline-flex items-center gap-2 text-zinc-600">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: chartEntry?.color || item.color }}
                  />
                  {item.name}
                </span>
                <span className="font-semibold text-zinc-900">{item.value}</span>
              </div>
            );
          })
        ) : (
          <div className="text-xs text-zinc-500">Sem eventos.</div>
        )}
      </div>
    </div>
  );
}

export default function PersonalOperationalTimeline({
  rows,
  loadingTickets,
  onOpenDetails,
}) {
  const [events, setEvents] = useState([]);
  const [failures, setFailures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [period, setPeriod] = useState("7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [actorFilter, setActorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [ticketQuery, setTicketQuery] = useState("");
  const [timelineOpen, setTimelineOpen] = useState(false);

  const personalRows = useMemo(
    () => (Array.isArray(rows) ? rows.filter((issue) => getIssueKey(issue)) : []),
    [rows],
  );
  const rowKeySig = useMemo(
    () => personalRows.map((issue) => getIssueKey(issue)).join("|"),
    [personalRows],
  );

  const load = useCallback(async () => {
    if (!personalRows.length) {
      setEvents([]);
      setFailures([]);
      return;
    }

    setLoading(true);
    setFailures([]);
    try {
      const result = await mapWithConcurrency(personalRows, 4, async (issue) => {
        const key = getIssueKey(issue);
        try {
          const [commentsResult, changelogResult] = await Promise.allSettled([
            jiraGetComments(key),
            jiraGetIssueChangelog(key, { maxResults: 100 }),
          ]);

          const issueEvents = [];
          const issueFailures = [];

          if (commentsResult.status === "fulfilled") {
            const list =
              commentsResult.value?.comments ||
              commentsResult.value?.values ||
              commentsResult.value ||
              [];
            if (Array.isArray(list)) {
              issueEvents.push(
                ...list
                  .map((comment) => normalizeComment(comment, issue))
                  .filter(Boolean),
              );
            }
          } else {
            issueFailures.push({
              key,
              source: "comments",
              message: commentsResult.reason?.message || String(commentsResult.reason),
            });
          }

          if (changelogResult.status === "fulfilled") {
            const histories =
              changelogResult.value?.values ||
              changelogResult.value?.histories ||
              [];
            if (Array.isArray(histories)) {
              histories.forEach((history) => {
                (history?.items || []).forEach((item, index) => {
                  const event = normalizeChange(history, item, issue, index);
                  if (event) issueEvents.push(event);
                });
              });
            }
          } else {
            issueFailures.push({
              key,
              source: "changelog",
              message: changelogResult.reason?.message || String(changelogResult.reason),
            });
          }

          return { events: issueEvents, failures: issueFailures };
        } catch (error) {
          return {
            events: [],
            failures: [{ key, source: "issue", message: error?.message || String(error) }],
          };
        }
      });

      setEvents(
        result
          .flatMap((entry) => entry?.events || [])
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      );
      setFailures(result.flatMap((entry) => entry?.failures || []));
    } finally {
      setLoading(false);
    }
  }, [personalRows]);

  useEffect(() => {
    load();
  }, [load, reloadNonce, rowKeySig]);

  const availableActors = useMemo(
    () =>
      Array.from(new Set(events.map((event) => event.actorName).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [events],
  );

  const availableStatuses = useMemo(
    () =>
      Array.from(new Set(personalRows.map(getIssueStatus).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [personalRows],
  );

  const filteredEvents = useMemo(() => {
    const { from, to } = periodRange(period, customFrom, customTo);
    const q = normalizePlain(ticketQuery);
    const typeSet = new Set(selectedTypes);

    return events.filter((event) => {
      if (from && event.createdAt.getTime() < from.getTime()) return false;
      if (to && event.createdAt.getTime() > to.getTime()) return false;
      if (typeSet.size && !typeSet.has(event.type)) return false;
      if (actorFilter && event.actorName !== actorFilter) return false;
      if (statusFilter && event.currentStatus !== statusFilter) return false;
      if (q) {
        const hay = normalizePlain(
          `${event.issueKey} ${event.issueSummary} ${event.actorName} ${event.currentStatus}`,
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [actorFilter, customFrom, customTo, events, period, selectedTypes, statusFilter, ticketQuery]);

  const summary = useMemo(() => {
    const todayYmd = toYmd(new Date());
    const people = new Set();
    const tickets = new Set();
    filteredEvents.forEach((event) => {
      if (event.actorName) people.add(event.actorName);
      if (event.issueKey) tickets.add(event.issueKey);
    });
    return {
      today: filteredEvents.filter((event) => toYmd(event.createdAt) === todayYmd).length,
      comments: filteredEvents.filter((event) => event.type === "comment").length,
      status: filteredEvents.filter((event) => event.type === "status_changed").length,
      fields: filteredEvents.filter((event) => event.type !== "comment" && event.type !== "status_changed").length,
      people: people.size,
      tickets: tickets.size,
    };
  }, [filteredEvents]);

  const chartData = useMemo(() => {
    const byDay = new Map();
    filteredEvents.forEach((event) => {
      const ymd = toYmd(event.createdAt);
      const group = (EVENT_TYPES[event.type] || EVENT_TYPES.other).group;
      if (!byDay.has(ymd)) {
        byDay.set(ymd, {
          ymd,
          label: formatShortDate(event.createdAt),
          comentarios: 0,
          status: 0,
          responsavel: 0,
          prioridade: 0,
          data: 0,
          campo: 0,
          outros: 0,
        });
      }
      const row = byDay.get(ymd);
      row[group] = (row[group] || 0) + 1;
    });
    return Array.from(byDay.values()).sort((a, b) => a.ymd.localeCompare(b.ymd));
  }, [filteredEvents]);

  const groupedEvents = useMemo(() => {
    const groups = new Map();
    filteredEvents.forEach((event) => {
      const ymd = toYmd(event.createdAt);
      if (!groups.has(ymd)) groups.set(ymd, []);
      groups.get(ymd).push(event);
    });
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredEvents]);

  function toggleType(type) {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type],
    );
  }

  const showInitialLoading = (loading || loadingTickets) && !events.length;

  return (
    <section className="grid gap-4">
      <Card className="overflow-hidden rounded-2xl border-zinc-200 bg-gradient-to-br from-white via-white to-zinc-50 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-base text-zinc-900">Timeline Operacional</CardTitle>
              <CardDescription>
                Linha do tempo de comentários e mudanças Jira nos meus tickets carregados.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReloadNonce((value) => value + 1)}
              disabled={loading || loadingTickets || !personalRows.length}
              className="rounded-xl border-zinc-200 bg-white"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 h-4 w-4" />
              )}
              Atualizar timeline
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {[
            ["Eventos hoje", summary.today, Activity],
            ["Comentários", summary.comments, MessageSquareText],
            ["Mudanças de status", summary.status, CalendarClock],
            ["Campos alterados", summary.fields, Filter],
            ["Pessoas ativas", summary.people, UserRound],
            ["Tickets movimentados", summary.tickets, Clock],
          ].map(([label, value, Icon]) => (
            <div key={label} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                <span>{label}</span>
                <Icon className="h-4 w-4 text-zinc-400" />
              </div>
              <div className="mt-2 text-2xl font-bold text-zinc-950">{value}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
        <CardContent className="grid gap-3 p-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              {PERIOD_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant="outline"
                  onClick={() => setPeriod(option.id)}
                  className={cn(
                    "rounded-xl border-zinc-200 bg-white",
                    period === option.id && "border-red-200 bg-red-50 text-red-700",
                  )}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {period === "custom" ? (
                <>
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(event) => setCustomFrom(event.target.value)}
                    className="h-10 w-[150px] rounded-xl border-zinc-200"
                  />
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(event) => setCustomTo(event.target.value)}
                    className="h-10 w-[150px] rounded-xl border-zinc-200"
                  />
                </>
              ) : null}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="rounded-xl border-zinc-200 bg-white">
                    <Filter className="mr-2 h-4 w-4" />
                    Tipo
                    {selectedTypes.length ? (
                      <Badge className="ml-2 rounded-full bg-zinc-900 text-white">
                        {selectedTypes.length}
                      </Badge>
                    ) : null}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64">
                  <DropdownMenuLabel>Tipo de evento</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {Object.entries(EVENT_TYPES).map(([key, item]) => (
                    <DropdownMenuCheckboxItem
                      key={key}
                      checked={selectedTypes.includes(key)}
                      onCheckedChange={() => toggleType(key)}
                    >
                      {item.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => setSelectedTypes([])}
                  >
                    Limpar
                  </Button>
                </DropdownMenuContent>
              </DropdownMenu>

              <select
                value={actorFilter}
                onChange={(event) => setActorFilter(event.target.value)}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">Todas as pessoas</option>
                {availableActors.map((actor) => (
                  <option key={actor} value={actor}>
                    {actor}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">Todos os status</option>
                {availableStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>

              <div className="relative w-full sm:w-[260px]">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                <Input
                  value={ticketQuery}
                  onChange={(event) => setTicketQuery(event.target.value)}
                  placeholder="Buscar ticket..."
                  className="h-10 rounded-xl border-zinc-200 bg-white pl-9"
                />
              </div>
            </div>
          </div>

          {failures.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {failures.length} leitura(s) parcial(is) falharam. A timeline exibiu os dados disponíveis.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl border-zinc-200 bg-gradient-to-br from-white via-white to-zinc-50 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-zinc-900">Eventos por dia</CardTitle>
          <CardDescription>Volume operacional por tipo de evento no período selecionado.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {showInitialLoading ? (
            <Skeleton className="h-[280px] w-full rounded-2xl" />
          ) : chartData.length ? (
            <>
              <div className="h-[260px] rounded-2xl border border-zinc-100 bg-white/80 p-3 shadow-inner">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    barCategoryGap="30%"
                    margin={{ top: 12, right: 18, left: -14, bottom: 4 }}
                  >
                    <defs>
                      {CHART_KEYS.map((entry) => (
                        <linearGradient
                          key={entry.key}
                          id={`timeline-${entry.key}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor={entry.color} stopOpacity={0.95} />
                          <stop offset="100%" stopColor={entry.color} stopOpacity={0.72} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid
                      stroke="#e4e4e7"
                      strokeDasharray="4 6"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "#71717a", fontSize: 12, fontWeight: 600 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "#71717a", fontSize: 12 }}
                    />
                    <RechartsTooltip
                      cursor={{ fill: "rgba(24, 24, 27, 0.05)", radius: 12 }}
                      content={<TimelineChartTooltip />}
                    />
                    {CHART_KEYS.map((entry) => (
                      <Bar
                        key={entry.key}
                        dataKey={entry.key}
                        stackId="timeline"
                        name={entry.label}
                        fill={`url(#timeline-${entry.key})`}
                        radius={[7, 7, 0, 0]}
                        maxBarSize={48}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {CHART_KEYS.map((entry) => (
                  <span
                    key={entry.key}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 shadow-sm"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    {entry.label}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="grid h-[280px] place-items-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-500">
              Nenhum evento encontrado para o período.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl border-zinc-200 bg-white shadow-sm">
        <CardHeader className="p-0">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition hover:bg-zinc-50"
            aria-expanded={timelineOpen}
            aria-controls="personal-operational-timeline-content"
            onClick={() => setTimelineOpen((open) => !open)}
          >
            <span className="min-w-0">
              <CardTitle className="text-base text-zinc-900">Linha do tempo do Jira</CardTitle>
              <CardDescription className="mt-1">
                {filteredEvents.length} evento(s) encontrados nos tickets da minha carteira.
              </CardDescription>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                {timelineOpen ? "Recolher" : "Expandir"}
              </Badge>
              <ChevronDown
                className={cn(
                  "h-5 w-5 text-zinc-500 transition-transform",
                  timelineOpen && "rotate-180",
                )}
              />
            </span>
          </button>
        </CardHeader>
        {timelineOpen ? (
        <CardContent
          id="personal-operational-timeline-content"
          className="grid gap-5 border-t border-zinc-100 pt-5"
        >
          {showInitialLoading ? (
            <div className="grid gap-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-24 rounded-2xl" />
              ))}
            </div>
          ) : groupedEvents.length ? (
            groupedEvents.map(([ymd, list]) => (
              <div key={ymd} className="grid gap-3">
                <div className="sticky top-[76px] z-10 flex items-center gap-2 bg-white/90 py-1 backdrop-blur">
                  <div className="text-sm font-bold text-zinc-950">{formatDayLabel(ymd)}</div>
                  <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                    {list.length}
                  </Badge>
                </div>

                <div className="relative grid gap-3 border-l border-zinc-200 pl-4">
                  {list.map((event) => (
                    <article key={event.id} className="relative rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                      <span className="absolute -left-[23px] top-5 h-3 w-3 rounded-full border-2 border-white bg-red-600 shadow" />
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-zinc-500">
                              {formatTime(event.createdAt)}
                            </span>
                            <Badge className={cn("rounded-full border", typeBadgeClass(event.type))}>
                              {typeLabel(event.type)}
                            </Badge>
                            <button
                              type="button"
                              className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 hover:bg-red-50 hover:text-red-700"
                              onClick={() => onOpenDetails?.(event.issueKey)}
                            >
                              {event.issueKey}
                            </button>
                            <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                              {event.currentStatus}
                            </Badge>
                          </div>

                          <div className="mt-2 text-sm font-semibold text-zinc-950">
                            {eventSentence(event)}
                          </div>
                          <div className="mt-1 line-clamp-2 text-sm text-zinc-600">
                            {event.issueSummary}
                          </div>

                          {event.type === "comment" ? (
                            <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-sm text-blue-950">
                              {event.commentBody || "Comentario sem texto."}
                            </div>
                          ) : (
                            <div className="mt-3 grid gap-2 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 md:grid-cols-2">
                              <div>
                                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                  De
                                </span>
                                <div className="mt-0.5 break-words font-medium text-zinc-900">
                                  {event.from || "--"}
                                </div>
                              </div>
                              <div>
                                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                  Para
                                </span>
                                <div className="mt-0.5 break-words font-medium text-zinc-900">
                                  {event.to || "--"}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2 text-xs text-zinc-500 lg:max-w-[220px] lg:justify-end lg:text-right">
                          {event.actorAvatar ? (
                            <img
                              src={event.actorAvatar}
                              alt=""
                              className="h-7 w-7 rounded-full border border-zinc-200"
                            />
                          ) : (
                            <div className="grid h-7 w-7 place-items-center rounded-full border border-zinc-200 bg-zinc-100 text-[10px] font-semibold text-zinc-600">
                              {String(event.actorName || "J").slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <span className="line-clamp-2">{event.actorName}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">
              Nenhum evento encontrado com os filtros atuais.
            </div>
          )}
        </CardContent>
        ) : null}
      </Card>
    </section>
  );
}
