import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  Clock3,
  FolderKanban,
  FolderOpen,
  ShieldAlert,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { cn } from "@/lib/utils";
import { getPoPresetLabel } from "../lib/poInsights";

function metricTone(kind) {
  return (
    {
      danger: "border-red-200 bg-red-50 text-red-700",
      warning: "border-amber-200 bg-amber-50 text-amber-800",
      success: "border-emerald-200 bg-emerald-50 text-emerald-700",
      info: "border-sky-200 bg-sky-50 text-sky-700",
      neutral: "border-zinc-200 bg-zinc-50 text-zinc-700",
    }[kind] || "border-zinc-200 bg-zinc-50 text-zinc-700"
  );
}

function fmtDate(date) {
  if (!date || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function truncateText(value, max = 88) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function AccordionCard({
  title,
  description,
  icon: Icon,
  count,
  children,
  className,
}) {
  const [open, setOpen] = useState(true);
  return (
    <Card className={cn("rounded-2xl border-zinc-200 bg-white shadow-sm", className)}>
      <CardHeader className="pb-3">
        <button
          type="button"
          className="flex w-full items-start justify-between gap-3 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <div className="min-w-0">
            <CardTitle className="flex min-w-0 items-center gap-2 text-base text-zinc-900">
              {Icon ? <Icon className="h-4 w-4 shrink-0 text-zinc-500" /> : null}
              <span className="truncate">{title}</span>
              {count != null ? (
                <Badge className="shrink-0 rounded-full bg-zinc-900 text-white">
                  {count}
                </Badge>
              ) : null}
            </CardTitle>
            {description ? <CardDescription className="mt-2">{description}</CardDescription> : null}
          </div>
          <ChevronDown
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-zinc-500 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </CardHeader>
      {open ? children : null}
    </Card>
  );
}

function MiniMetric({ title, value, subtitle, tone = "neutral" }) {
  return (
    <div className={cn("rounded-2xl border p-4", metricTone(tone))}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">
        {title}
      </div>
      <div className="mt-2 text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-xs opacity-80">{subtitle}</div>
    </div>
  );
}

function CompactList({ title, items, emptyText = "Sem dados." }) {
  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-zinc-900">{title}</CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          "grid min-w-0 gap-2 pr-1",
          items?.length ? "max-h-72 overflow-y-auto" : "",
        )}
      >
        {items?.length ? (
          items.map((item) => (
            <div
              key={`${title}-${item.name}`}
              className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm font-medium text-zinc-800">
                {item.name}
              </span>
              <Badge className="shrink-0 rounded-full bg-zinc-900 text-white">
                {item.value}
              </Badge>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
            {emptyText}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActionQueueCard({
  item,
  onOpenDetails,
  onOpenSchedule,
  onOpenDocumentation,
}) {
  return (
    <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-700">
                {item.key}
              </code>
              <Badge
                className={cn(
                  "rounded-full border",
                  item.isBlocked
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : item.isAtRisk
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700",
                )}
              >
                {item.processLane}
              </Badge>
            </div>
            <CardTitle className="mt-2 line-clamp-2 text-base text-zinc-900">
              {item.summary}
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              {item.owner} • {item.statusName || "Sem status"}
            </CardDescription>
          </div>
          <div className="rounded-xl bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600">
            Score {item.queueScore}
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {item.actionReasons?.map((reason) => (
            <Badge
              key={`${item.key}-${reason}`}
              className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700"
            >
              {reason}
            </Badge>
          ))}
        </div>

        <div className="grid gap-2 text-xs text-zinc-600">
          <div className="flex items-center justify-between gap-2">
            <span>Próximo marco</span>
            <span className="font-semibold text-zinc-900">
              {item.nextMilestone?.label || "Sem marco"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>Data limite</span>
            <span className="font-semibold text-zinc-900">
              {item.dueDate ? fmtDate(item.dueDate) : "Sem data"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="rounded-xl bg-red-600 text-white hover:bg-red-700"
            onClick={() => onOpenDetails?.(item.key)}
          >
            Detalhes
          </Button>
          {!item.hasSchedule && onOpenSchedule ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl border-zinc-200 bg-white"
              onClick={() => onOpenSchedule?.(item.raw)}
            >
              Criar cronograma
            </Button>
          ) : null}
          {item.canOrganizeDocumentation && onOpenDocumentation ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
              onClick={() => onOpenDocumentation?.(item)}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              Organizar Documentação
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

const ALARM_HELP_ITEMS = [
  {
    label: "Sem cronograma",
    description: "Ticket nao possui atividades planejadas no cronograma.",
  },
  {
    label: "Sem responsável",
    description: "Ticket não possui assignee/responsável definido.",
  },
  {
    label: "Atrasado",
    description: "Data limite do ticket e anterior ao dia atual.",
  },
  {
    label: "Conflito de recurso",
    description: "Mesmo recurso possui atividades sobrepostas no periodo.",
  },
  {
    label: "Sem inicio",
    description: "Ticket ainda nao foi marcado como iniciado.",
  },
  {
    label: "Vence em breve",
    description: "Ticket vence hoje ou nos próximos 7 dias.",
  },
  {
    label: "Sem avanço",
    description: "Ticket está há 7 dias ou mais sem atualização.",
  },
  {
    label: "Risco",
    description: "Existe atividade com risco marcado no cronograma.",
  },
  {
    label: "Documentacao",
    description: "Ticket em Backlog iniciado ainda sem pasta/documentacao organizada.",
  },
];

function AlarmHelpTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
          aria-label="Ver critérios dos alarmes"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="max-w-[360px] rounded-2xl border-zinc-200 bg-white p-3 text-zinc-800 shadow-xl"
      >
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Criterios dos alarmes
        </div>
        <div className="mt-2 grid gap-2">
          {ALARM_HELP_ITEMS.map((item) => (
            <div key={item.label} className="grid gap-0.5">
              <div className="text-xs font-semibold text-zinc-900">
                {item.label}
              </div>
              <div className="text-xs leading-snug text-zinc-600">
                {item.description}
              </div>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function OperationalItemButton({
  item,
  badge,
  onOpenDetails,
  onOpenSchedule,
  onResolveProblem,
}) {
  const key = item?.key || item?.resource || item?.name || "item";
  const summary =
    item?.summary || item?.activityName || item?.resource || "Sem descricao";
  const reason = item?.briefingReason || item?.reason || item?.statusName;
  const action = item?.recommendedAction;
  const problems = Array.isArray(item?.resolutionProblems)
    ? item.resolutionProblems
    : [];

  return (
    <div
      className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left transition hover:border-zinc-300 hover:bg-white"
    >
      <div className="min-w-0 overflow-hidden">
        <div className="flex min-w-0 items-center gap-2">
          <code className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700">
            {key}
          </code>
          {item?.owner ? (
            <span className="min-w-0 truncate text-xs text-zinc-500">
              {item.owner}
            </span>
          ) : null}
        </div>
        <div className="mt-1 line-clamp-2 break-words text-sm font-medium leading-snug text-zinc-900">
          {summary}
        </div>
        {reason ? (
          <div className="mt-1 line-clamp-2 break-words text-xs leading-snug text-zinc-600">
            {reason}
          </div>
        ) : null}
        {action ? (
          <div className="mt-1 line-clamp-2 break-words text-xs leading-snug text-red-700">
            {action}
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {problems.slice(0, 5).map((problem) => (
            <button
              key={`${key}-${problem.type}`}
              type="button"
              className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-100"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onResolveProblem?.(item, problem);
              }}
              title={problem.recommendedAction || problem.reason}
            >
              {problem.label}
            </button>
          ))}
          {!problems.length && onOpenDetails ? (
            <button
              type="button"
              className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-100"
              onClick={() => onOpenDetails?.(item?.key)}
            >
              Detalhes
            </button>
          ) : null}
        </div>
      </div>
      {badge ? (
        <div className="flex max-w-[136px] shrink-0 items-center rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-center text-[11px] font-bold uppercase leading-tight tracking-[0.12em] text-red-700 shadow-sm">
          <span className="line-clamp-2 break-words">{badge}</span>
        </div>
      ) : null}
    </div>
  );
}

function AlertColumn({
  title,
  count,
  tone,
  items,
  getBadge,
  onOpenDetails,
  onOpenSchedule,
  onResolveProblem,
}) {
  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm text-zinc-900">{title}</CardTitle>
          <Badge className={cn("rounded-full border", metricTone(tone))}>
            {count || 0}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-2 overflow-hidden">
        {(items || []).slice(0, 4).map((item, index) => (
          <OperationalItemButton
            key={`${title}-${item?.key || item?.resource || index}`}
            item={item}
            badge={getBadge?.(item)}
            onOpenDetails={onOpenDetails}
            onOpenSchedule={onOpenSchedule}
            onResolveProblem={onResolveProblem}
          />
        ))}
        {!items?.length ? (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
            Nenhum item neste recorte.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CriticalAlertsPanel({
  insights,
  onOpenDetails,
  onOpenSchedule,
  onResolveProblem,
}) {
  const alerts = insights?.criticalAlerts || {};
  const columns = [
    {
      title: "Atrasados",
      tone: "danger",
      items: alerts.overdue || [],
      getBadge: (item) => `${item.overdueDays || 0}d`,
    },
    {
      title: "Sem cronograma",
      tone: "warning",
      items: alerts.noSchedule || [],
      getBadge: () => "Planejar",
    },
    {
      title: "Conflitos",
      tone: "danger",
      items: alerts.resourceConflicts || [],
      getBadge: () => "Recurso",
    },
    {
      title: "Próximos 7 dias",
      tone: "info",
      items: alerts.dueNext7 || [],
      getBadge: (item) =>
        item.dueInDays === 0 ? "Hoje" : `${item.dueInDays || 0}d`,
    },
    {
      title: "Sem responsável",
      tone: "warning",
      items: alerts.noOwner || [],
      getBadge: () => "Definir",
    },
  ];

  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-red-600" />
          <CardTitle className="text-base text-zinc-900">
            Alertas críticos
          </CardTitle>
        </div>
        <CardDescription>
          Prioriza riscos operacionais que precisam de decisao no rito AM/PO.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {columns.map((column) => (
          <AlertColumn
            key={column.title}
            {...column}
            count={column.items.length}
            onOpenDetails={onOpenDetails}
            onOpenSchedule={onOpenSchedule}
            onResolveProblem={onResolveProblem}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function BriefingColumn({
  title,
  icon: Icon,
  items,
  emptyText,
  getBadge,
  onOpenDetails,
  onOpenSchedule,
  onResolveProblem,
}) {
  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm text-zinc-900">
          {Icon ? <Icon className="h-4 w-4 shrink-0 text-zinc-500" /> : null}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-2 overflow-hidden">
        {(items || []).slice(0, 5).map((item, index) => (
          <OperationalItemButton
            key={`${title}-${item?.key || index}`}
            item={item}
            badge={getBadge?.(item)}
            onOpenDetails={onOpenDetails}
            onOpenSchedule={onOpenSchedule}
            onResolveProblem={onResolveProblem}
          />
        ))}
        {!items?.length ? (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
            {emptyText}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DailyBriefingPanel({
  insights,
  onOpenDetails,
  onOpenSchedule,
  onResolveProblem,
}) {
  const briefing = insights?.dailyBriefing || {};
  const [activeBriefing, setActiveBriefing] = useState("changed");
  const sections = [
    {
      key: "changed",
      title: "O que mudou",
      icon: CalendarClock,
      items: briefing.changed || [],
      emptyText: "Nenhuma mudanca recente.",
      getBadge: (item) =>
        item.resolvedDate
          ? fmtDate(item.resolvedDate)
          : item.updatedDate
            ? fmtDate(item.updatedDate)
            : "Hoje",
    },
    {
      key: "delayed",
      title: "O que atrasou",
      icon: AlertTriangle,
      items: briefing.delayed || [],
      emptyText: "Nenhum atraso no recorte.",
      getBadge: (item) => `${item.overdueDays || 0}d`,
    },
    {
      key: "dueToday",
      title: "Vence hoje",
      icon: Clock3,
      items: briefing.dueToday || [],
      emptyText: "Nada vencendo hoje.",
      getBadge: () => "Hoje",
    },
    {
      key: "recommendedActions",
      title: "Ações recomendadas",
      icon: ShieldAlert,
      items: briefing.recommendedActions || [],
      emptyText: "Sem ações recomendadas.",
      getBadge: (item) => item.resolutionProblems?.[0]?.label || "Ação",
    },
  ];
  const selectedSection =
    sections.find((section) => section.key === activeBriefing) || sections[0];

  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-zinc-600" />
              <CardTitle className="text-base text-zinc-900">
                Resumo diario operacional
              </CardTitle>
            </div>
            <CardDescription className="mt-2">
              Leitura rápida para orientar acompanhamento, cobrança e próximos passos.
            </CardDescription>
          </div>
          <AlarmHelpTooltip />
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-3">
        <div className="flex flex-wrap gap-2 rounded-2xl bg-zinc-100 p-1">
          {sections.map((section) => {
            const SectionIcon = section.icon;
            return (
              <button
                key={section.key}
                type="button"
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition",
                  activeBriefing === section.key
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-600 hover:bg-white/70"
                )}
                onClick={() => setActiveBriefing(section.key)}
              >
                <SectionIcon className="h-3.5 w-3.5" />
                {section.title}
                <Badge className="rounded-full bg-zinc-900 text-white">
                  {section.items.length}
                </Badge>
              </button>
            );
          })}
        </div>

        <BriefingColumn
          title={selectedSection.title}
          icon={selectedSection.icon}
          items={selectedSection.items}
          emptyText={selectedSection.emptyText}
          getBadge={selectedSection.getBadge}
          onOpenDetails={onOpenDetails}
          onOpenSchedule={onOpenSchedule}
          onResolveProblem={onResolveProblem}
        />
      </CardContent>
    </Card>
  );
}

export function POPresetBar({
  activePreset,
  setActivePreset,
  presetCounts,
  ownerFocus,
  setOwnerFocus,
  jiraUser,
  showMinePreset = true,
}) {
  const presets = showMinePreset
    ? ["all", "mine", "overdue", "noSchedule", "atRisk", "next7d"]
    : ["all", "overdue", "noSchedule", "atRisk", "next7d"];

  return (
    <Card className="rounded-xl border-zinc-200 bg-white/90 shadow-none">
      <CardContent className="flex flex-col gap-2.5 p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-700">
              Atalhos do módulo
            </div>
            <div className="text-[11px] text-zinc-500">
              O mesmo recorte alimenta Ações, Portfólio, Calendário, Gantt e
              Dashboard.
            </div>
          </div>

          {showMinePreset ? (
            jiraUser?.accountId ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                Meus projetos: {jiraUser.displayName || "usuario Jira"}
              </div>
            ) : (
              <div className="w-full lg:w-[260px]">
                <Input
                  value={ownerFocus}
                  onChange={(event) => setOwnerFocus?.(event.target.value)}
                  placeholder="Meu nome para 'Meus projetos'"
                  className="h-9 rounded-lg border-zinc-200 bg-white text-sm focus-visible:ring-red-500"
                />
              </div>
            )
          ) : (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-600">
              Visão global do Painel PO
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => {
            const count = presetCounts?.[preset] || 0;
            return (
              <Button
                key={preset}
                type="button"
                variant="outline"
                className={cn(
                  "h-8 rounded-lg border-zinc-200 bg-white px-2.5 text-xs text-zinc-700",
                  activePreset === preset &&
                    "border-red-200 bg-red-50 text-red-700",
                )}
                onClick={() => setActivePreset?.(preset)}
                disabled={
                  preset === "mine" &&
                  !jiraUser?.accountId &&
                  !String(ownerFocus || "").trim()
                }
              >
                {getPoPresetLabel(preset)}
                <Badge className="ml-1.5 rounded-full bg-zinc-800 px-1.5 py-0 text-[10px] text-white">
                  {count}
                </Badge>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function POActionsHub({
  personalMode = false,
  insights,
  onOpenDetails,
  onOpenSchedule,
  onOpenDocumentation,
  onResolveProblem,
}) {
  const laneCards = useMemo(
    () => [
      {
        title: "Triagem",
        value:
          insights?.portfolio?.lanes?.find((lane) => lane.name === "triagem")
            ?.value || 0,
        subtitle: "PRE SAVE e itens sem partida clara",
        tone: "warning",
      },
      {
        title: "Levantamento",
        value:
          insights?.portfolio?.lanes?.find(
            (lane) => lane.name === "levantamento",
          )?.value || 0,
        subtitle: "Requisitos, artefatos e envolvidos",
        tone: "info",
      },
      {
        title: "Planejar",
        value:
          insights?.portfolio?.lanes?.find(
            (lane) => lane.name === "prontos para planejar",
          )?.value || 0,
        subtitle: "Itens que precisam de cronograma",
        tone: "info",
      },
      {
        title: "Em risco",
        value: insights?.portfolio?.atRisk || 0,
        subtitle: "Risco, atraso, conflito ou falta de avanço",
        tone: "danger",
      },
      {
        title: "Concluídos 30d",
        value: insights?.portfolio?.completedLast30 || 0,
        subtitle: "Fechamentos recentes para o rito semanal",
        tone: "success",
      },
    ],
    [insights],
  );

  const weeklyRituals = useMemo(
    () => [
      {
        title: "Planejamento da semana",
        value: insights?.portfolio?.noSchedule || 0,
        subtitle: "Sem cronograma ou prontos para planejar",
      },
      {
        title: "Acompanhamento diário",
        value: insights?.portfolio?.dueThisWeek || 0,
        subtitle: "Vencem nos próximos 7 dias",
      },
      {
        title: "Revisão de riscos",
        value: insights?.risks?.length || 0,
        subtitle: "Tickets com risco ou bloqueio ativo",
      },
      {
        title: "Fechamentos 7/30d",
        value: insights?.doneRecent?.length || 0,
        subtitle: "Concluídos recentes para reporte",
      },
    ],
    [insights],
  );

  return (
    <div className="grid gap-4">
      {!personalMode ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {laneCards.map((card) => (
            <MiniMetric key={card.title} {...card} />
          ))}
        </div>
      ) : null}

      <DailyBriefingPanel
        insights={insights}
        onOpenDetails={onOpenDetails}
        onOpenSchedule={onOpenSchedule}
        onResolveProblem={onResolveProblem}
      />

      <AccordionCard
        title="Fila de ação do P.O"
        description="Ordenação automática por prioridade operacional para responder rápido ao que precisa de ação agora."
        icon={FolderKanban}
        count={insights?.actionQueue?.length || 0}
      >
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {(insights?.actionQueue || []).slice(0, 8).map((item) => (
            <ActionQueueCard
              key={item.key}
              item={item}
              onOpenDetails={onOpenDetails}
              onOpenSchedule={onOpenSchedule}
              onOpenDocumentation={onOpenDocumentation}
            />
          ))}

          {!insights?.actionQueue?.length ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
              Nenhum item relevante para a fila com o filtro atual.
            </div>
          ) : null}
        </CardContent>
      </AccordionCard>

      {!personalMode ? (
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <AccordionCard
          title="Recortes do rito semanal"
          description="Indicadores rápidos para conduzir o rito semanal do P.O."
          icon={CalendarClock}
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-zinc-900">
              Recortes do rito semanal
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {weeklyRituals.map((ritual) => (
              <div
                key={ritual.title}
                className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
              >
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  {ritual.title}
                </div>
                <div className="mt-2 text-2xl font-bold text-zinc-900">
                  {ritual.value}
                </div>
                <div className="mt-1 text-xs text-zinc-600">
                  {ritual.subtitle}
                </div>
              </div>
            ))}
          </CardContent>
        </AccordionCard>

        <AccordionCard
          title="Concluídos recentes"
          description="Fechamentos mais recentes para o fechamento semanal e status report."
          icon={Clock3}
          count={insights?.doneRecent?.length || 0}
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-zinc-900">
              Concluídos recentes
            </CardTitle>
            <CardDescription>
              Fechamentos mais recentes para o fechamento semanal e status
              report.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {(insights?.doneRecent || []).slice(0, 8).map((item) => (
              <button
                key={item.key}
                type="button"
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left transition hover:border-zinc-300 hover:bg-white"
                onClick={() => onOpenDetails?.(item.key)}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">
                    {item.key}
                  </div>
                  <div className="truncate text-xs text-zinc-600">
                    {item.summary}
                  </div>
                </div>
                <Badge className="rounded-full bg-emerald-600 text-white">
                  {item.resolvedDate ? fmtDate(item.resolvedDate) : "30d"}
                </Badge>
              </button>
            ))}

            {!insights?.doneRecent?.length ? (
              <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                Nenhum concluído recente neste recorte.
              </div>
            ) : null}
          </CardContent>
        </AccordionCard>
      </div>
      ) : null}
    </div>
  );
}

function PortfolioTableRow({ item, onOpenDetails, right }) {
  return (
    <button
      type="button"
      className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left transition hover:border-zinc-300 hover:bg-white"
      onClick={() => onOpenDetails?.(item.key)}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700">
            {item.key}
          </code>
          <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
            {item.statusMacroLabel}
          </Badge>
        </div>
        <div className="mt-1 line-clamp-2 text-sm font-medium text-zinc-900">
          {item.summary}
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          {item.owner} • {item.statusName || "Sem status"}
        </div>
      </div>
      {right}
    </button>
  );
}

export function POPortfolioHub({ personalMode = false, insights, onOpenDetails }) {
  const [portfolioTab, setPortfolioTab] = useState("portfolio");

  return (
    <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-zinc-900">
          {personalMode ? "Leituras da minha carteira" : "Leituras de portfólio"}
        </CardTitle>
        <CardDescription>
          {personalMode ? "Consolida performance, capacidade, riscos e roadmap sobre meus tickets atribuídos." : "Consolida performance, capacidade, riscos e roadmap sobre a mesma base operacional do módulo P.O."}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <Tabs value={portfolioTab} onValueChange={setPortfolioTab}>
          <TabsList className="flex h-auto flex-wrap gap-2 rounded-2xl bg-zinc-100 p-1">
            <TabsTrigger value="portfolio" className="rounded-xl">
              <FolderKanban className="mr-2 h-4 w-4" />
              Portfólio
            </TabsTrigger>
            <TabsTrigger value="capacity" className="rounded-xl">
              <Users className="mr-2 h-4 w-4" />
              Capacidade
            </TabsTrigger>
            <TabsTrigger value="risks" className="rounded-xl">
              <ShieldAlert className="mr-2 h-4 w-4" />
              Riscos
            </TabsTrigger>
            <TabsTrigger value="roadmap" className="rounded-xl">
              <CalendarClock className="mr-2 h-4 w-4" />
              Roadmap
            </TabsTrigger>
          </TabsList>

          <TabsContent value="portfolio" className="mt-4 grid gap-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MiniMetric
                title={personalMode ? "Tickets no meu recorte" : "Projetos no recorte"}
                value={insights?.portfolio?.total || 0}
                subtitle={personalMode ? "Tickets atribuídos a mim" : "Base ativa do módulo P.O"}
                tone="neutral"
              />
              <MiniMetric
                title={personalMode ? "Tickets em risco" : "Projetos em risco"}
                value={insights?.portfolio?.atRisk || 0}
                subtitle="Atrasos, risco ou conflito de recurso"
                tone="danger"
              />
              <MiniMetric
                title="Sem cronograma"
                value={insights?.portfolio?.noSchedule || 0}
                subtitle="Prontos para planejar"
                tone="warning"
              />
              <MiniMetric
                title="Throughput 30d"
                value={insights?.portfolio?.throughputDelta || 0}
                subtitle={`${insights?.portfolio?.completedLast30 || 0} concluídos vs ${insights?.portfolio?.createdLast30 || 0} criados`}
                tone={
                  Number(insights?.portfolio?.throughputDelta || 0) >= 0
                    ? "success"
                    : "danger"
                }
              />
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <CompactList
                title="Status macro"
                items={insights?.portfolio?.statusMacro}
              />
              <CompactList
                title="Faixas de aging"
                items={insights?.portfolio?.aging}
              />
            </div>

            <div className="grid gap-3 xl:grid-cols-3">
              <CompactList
                title="Responsáveis"
                items={insights?.portfolio?.owners}
              />
              <CompactList
                title="Diretorias"
                items={insights?.portfolio?.directorates}
              />
              <CompactList
                title="Componentes"
                items={insights?.portfolio?.components}
              />
            </div>
          </TabsContent>

          <TabsContent value="capacity" className="mt-4 grid gap-3">
            {(insights?.resourceRows || []).map((row) => (
              <Card
                key={row.resource}
                className="rounded-2xl border-zinc-200 bg-white shadow-sm"
              >
                <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-base font-semibold text-zinc-900">
                        {row.resource}
                      </div>
                      {row.missing ? (
                        <Badge className="rounded-full border border-amber-200 bg-amber-50 text-amber-800">
                          Sem recurso definido
                        </Badge>
                      ) : null}
                      {row.conflicts ? (
                        <Badge className="rounded-full border border-red-200 bg-red-50 text-red-700">
                          {row.conflicts} conflito(s)
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600">
                      <span>{row.activities} atividade(s)</span>
                      <span>•</span>
                      <span>{row.issues} projeto(s)</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:max-w-[420px] lg:justify-end">
                    {(row.weeklyLoadEntries || []).map((entry) => (
                      <Badge
                        key={`${row.resource}-${entry.name}`}
                        className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700"
                      >
                        {entry.name}: {entry.value}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}

            {!insights?.resourceRows?.length ? (
              <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
                Nenhuma alocação encontrada no recorte atual.
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="risks" className="mt-4 grid gap-3">
            {(insights?.risks || []).slice(0, 16).map((item) => (
              <PortfolioTableRow
                key={item.key}
                item={item}
                onOpenDetails={onOpenDetails}
                right={
                  <div className="flex flex-col items-end gap-2">
                    {item.overdueDays ? (
                      <Badge className="rounded-full bg-red-600 text-white">
                        {item.overdueDays}d atraso
                      </Badge>
                    ) : null}
                    <div className="flex flex-wrap justify-end gap-1">
                      {item.actionReasons?.slice(0, 3).map((reason) => (
                        <Badge
                          key={`${item.key}-${reason}`}
                          className="rounded-full border border-zinc-200 bg-white text-zinc-700"
                        >
                          {reason}
                        </Badge>
                      ))}
                    </div>
                  </div>
                }
              />
            ))}

            {!insights?.risks?.length ? (
              <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
                Nenhum risco relevante encontrado neste filtro.
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="roadmap" className="mt-4 grid gap-3">
            {(insights?.roadmap || []).slice(0, 18).map((item) => (
              <PortfolioTableRow
                key={item.key}
                item={item}
                onOpenDetails={onOpenDetails}
                right={
                  <div className="text-right">
                    <div className="text-xs font-semibold text-zinc-900">
                      {item.nextMilestone?.label || "Sem marco"}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Prazo: {item.dueDate ? fmtDate(item.dueDate) : "Sem data"}
                    </div>
                  </div>
                }
              />
            ))}

            {!insights?.roadmap?.length ? (
              <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
                Nenhum marco planejado para o recorte atual.
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
