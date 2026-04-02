import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Clock3, FolderKanban, ShieldAlert, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
    <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-zinc-900">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {items?.length ? (
          items.map((item) => (
            <div
              key={`${title}-${item.name}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
            >
              <span className="truncate text-sm font-medium text-zinc-800">
                {item.name}
              </span>
              <Badge className="rounded-full bg-zinc-900 text-white">
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

function ActionQueueCard({ item, onOpenDetails, onOpenSchedule }) {
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
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
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
        </div>
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
}) {
  const presets = ["all", "mine", "overdue", "noSchedule", "atRisk", "next7d"];

  return (
    <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-900">
              Atalhos do módulo
            </div>
            <div className="text-xs text-zinc-500">
              O mesmo recorte alimenta Ações, Portfólio, Calendário, Gantt e Dashboard.
            </div>
          </div>

          <div className="w-full lg:w-[280px]">
            <Input
              value={ownerFocus}
              onChange={(event) => setOwnerFocus?.(event.target.value)}
              placeholder="Meu nome para 'Meus projetos'"
              className="h-10 rounded-xl border-zinc-200 bg-white focus-visible:ring-red-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => {
            const count = presetCounts?.[preset] || 0;
            return (
              <Button
                key={preset}
                type="button"
                variant="outline"
                className={cn(
                  "rounded-xl border-zinc-200 bg-white",
                  activePreset === preset &&
                    "border-red-200 bg-red-50 text-red-700"
                )}
                onClick={() => setActivePreset?.(preset)}
                disabled={preset === "mine" && !String(ownerFocus || "").trim()}
              >
                {getPoPresetLabel(preset)}
                <Badge className="ml-2 rounded-full bg-zinc-900 text-white">
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
  insights,
  onOpenDetails,
  onOpenSchedule,
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
        title: "Planejar",
        value:
          insights?.portfolio?.lanes?.find(
            (lane) => lane.name === "prontos para planejar"
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
    [insights]
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
    [insights]
  );

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {laneCards.map((card) => (
          <MiniMetric key={card.title} {...card} />
        ))}
      </div>

      <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-zinc-900">
            Fila de ação do P.O
          </CardTitle>
          <CardDescription>
            Ordenação automática por prioridade operacional para responder rápido ao que precisa de ação agora.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {(insights?.actionQueue || []).slice(0, 8).map((item) => (
            <ActionQueueCard
              key={item.key}
              item={item}
              onOpenDetails={onOpenDetails}
              onOpenSchedule={onOpenSchedule}
            />
          ))}

          {!insights?.actionQueue?.length ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
              Nenhum item relevante para a fila com o filtro atual.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
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
                <div className="mt-1 text-xs text-zinc-600">{ritual.subtitle}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-zinc-900">
              Concluídos recentes
            </CardTitle>
            <CardDescription>
              Fechamentos mais recentes para o fechamento semanal e status report.
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
        </Card>
      </div>
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

export function POPortfolioHub({ insights, onOpenDetails }) {
  const [portfolioTab, setPortfolioTab] = useState("portfolio");

  return (
    <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-zinc-900">Leituras de portfólio</CardTitle>
        <CardDescription>
          Consolida performance, capacidade, riscos e roadmap sobre a mesma base operacional do módulo P.O.
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
                title="Projetos no recorte"
                value={insights?.portfolio?.total || 0}
                subtitle="Base ativa do módulo P.O"
                tone="neutral"
              />
              <MiniMetric
                title="Projetos em risco"
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
                tone={Number(insights?.portfolio?.throughputDelta || 0) >= 0 ? "success" : "danger"}
              />
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <CompactList title="Status macro" items={insights?.portfolio?.statusMacro} />
              <CompactList title="Faixas de aging" items={insights?.portfolio?.aging} />
            </div>

            <div className="grid gap-3 xl:grid-cols-3">
              <CompactList title="Responsáveis" items={insights?.portfolio?.owners} />
              <CompactList title="Diretorias" items={insights?.portfolio?.directorates} />
              <CompactList title="Componentes" items={insights?.portfolio?.components} />
            </div>
          </TabsContent>

          <TabsContent value="capacity" className="mt-4 grid gap-3">
            {(insights?.resourceRows || []).map((row) => (
              <Card key={row.resource} className="rounded-2xl border-zinc-200 bg-white shadow-sm">
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
