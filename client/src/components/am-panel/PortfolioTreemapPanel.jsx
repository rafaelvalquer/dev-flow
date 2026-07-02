import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { FilterX, LayoutDashboard, Search, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ALL = "all";

const STATUS_COLORS = [
  "#334155",
  "#2563eb",
  "#0f766e",
  "#7c3aed",
  "#b45309",
  "#475569",
  "#64748b",
  "#0891b2",
];

const DEADLINE_OPTIONS = [
  { label: "Prazo ok", value: "ok" },
  { label: "Prazo estourado", value: "overdue" },
  { label: "Sem prazo", value: "missing" },
];

function clean(value, fallback = "Nao informado") {
  const text = String(value || "").trim();
  return text || fallback;
}

function numberBr(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function pct(value, total) {
  if (!total) return "0%";
  return `${Math.round((Number(value || 0) / total) * 1000) / 10}%`;
}

function uniqueSorted(rows, getter) {
  const counts = new Map();
  rows.forEach((row) => {
    const raw = getter(row);
    const values = Array.isArray(raw) ? raw : [raw];
    values.forEach((value) => {
      const label = clean(value);
      counts.set(label, (counts.get(label) || 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .map(([label, count]) => ({ label, count }));
}

function ticketAreas(ticket) {
  const areas = [
    ...(Array.isArray(ticket?.directorias) ? ticket.directorias : []),
    ...(Array.isArray(ticket?.components) ? ticket.components : []),
  ]
    .map((item) => clean(item, ""))
    .filter(Boolean);

  return areas.length ? areas : ["Sem diretoria"];
}

function ticketMatchesQuery(ticket, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  return [ticket?.key, ticket?.summary, ticket?.owner, ticket?.status]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(q));
}

function startOfTodayLocal() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function getDeadlineBucket(ticket, today) {
  const dueDate = ticket?.effectiveDueDate;
  if (!dueDate) return "missing";

  const comparableDate = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(comparableDate.getTime())) return "missing";

  return comparableDate.getTime() < today.getTime() ? "overdue" : "ok";
}

function buildStatusColorMap(statuses) {
  const colorMap = new Map();
  statuses.forEach((item, index) => {
    colorMap.set(item.label, STATUS_COLORS[index % STATUS_COLORS.length]);
  });
  return colorMap;
}

function buildStatusLegendItems(statuses, activeStatus) {
  const maxVisible = 7;
  const topStatuses = statuses.slice(0, maxVisible);
  const activeOutsideTop =
    activeStatus !== ALL &&
    activeStatus &&
    !topStatuses.some((item) => item.label === activeStatus);

  const visibleStatuses = activeOutsideTop
    ? [...statuses.slice(0, Math.max(0, maxVisible - 1)), statuses.find((item) => item.label === activeStatus)].filter(Boolean)
    : topStatuses;

  const visibleSet = new Set(visibleStatuses.map((item) => item.label));
  const otherStatuses = statuses.filter((item) => !visibleSet.has(item.label));
  const otherCount = otherStatuses.reduce((sum, item) => sum + item.count, 0);

  return {
    visible: visibleStatuses,
    other:
      otherStatuses.length > 0
        ? {
            label: "Outros",
            count: otherCount,
            title: otherStatuses
              .map((item) => `${item.label} (${numberBr(item.count)})`)
              .join(", "),
          }
        : null,
  };
}

function buildTreemapData(rows, statusColorMap) {
  const statusMap = new Map();

  rows.forEach((ticket) => {
    const status = clean(ticket?.status, "Sem status");
    const owner = clean(ticket?.owner, "Sem responsavel");

    if (!statusMap.has(status)) {
      statusMap.set(status, {
        status,
        count: 0,
        owners: new Map(),
      });
    }

    const statusEntry = statusMap.get(status);
    statusEntry.count += 1;

    const ownerEntry = statusEntry.owners.get(owner) || {
      owner,
      count: 0,
    };
    ownerEntry.count += 1;
    statusEntry.owners.set(owner, ownerEntry);
  });

  return Array.from(statusMap.values())
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status, "pt-BR"))
    .map((statusEntry, index) => ({
      name: statusEntry.status,
      value: statusEntry.count,
      itemStyle: {
        color:
          statusColorMap.get(statusEntry.status) ||
          STATUS_COLORS[index % STATUS_COLORS.length],
      },
      payload: {
        level: "status",
        status: statusEntry.status,
        count: statusEntry.count,
      },
      children: Array.from(statusEntry.owners.values())
        .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner, "pt-BR"))
        .map((ownerEntry) => ({
          name: ownerEntry.owner,
          value: ownerEntry.count,
          itemStyle: {
            color:
              statusColorMap.get(statusEntry.status) ||
              STATUS_COLORS[index % STATUS_COLORS.length],
          },
          payload: {
            level: "owner",
            status: statusEntry.status,
            owner: ownerEntry.owner,
            count: ownerEntry.count,
          },
        })),
    }));
}

function StatusLegend({ items, other, activeStatus, colorMap, onSelectStatus }) {
  if (!items.length && !other) return null;

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold text-zinc-500">
          Status:
        </span>
        {items.map((item) => {
          const active = activeStatus === item.label;
          return (
            <button
              key={item.label}
              type="button"
              title={item.label}
              onClick={() => onSelectStatus(item.label)}
              className={[
                "inline-flex max-w-[180px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition",
                active
                  ? "border-sky-300 bg-white text-sky-800 shadow-sm ring-2 ring-sky-100"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-sky-200 hover:text-sky-800",
              ].join(" ")}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: colorMap.get(item.label) || STATUS_COLORS[0] }}
              />
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="shrink-0 text-zinc-500">{numberBr(item.count)}</span>
            </button>
          );
        })}
        {other ? (
          <span
            title={other.title}
            className="inline-flex max-w-[180px] items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-500"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px] bg-zinc-300" />
            <span className="min-w-0 truncate">{other.label}</span>
            <span className="shrink-0">{numberBr(other.count)}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  maxLabelLength = 32,
  showCounts = true,
}) {
  const formatOptionLabel = (option) => {
    const labelText = String(option.label || "");
    const compactLabel =
      labelText.length > maxLabelLength
        ? `${labelText.slice(0, Math.max(1, maxLabelLength - 3)).trimEnd()}...`
        : labelText;
    return showCounts && Number.isFinite(Number(option.count))
      ? `${compactLabel} (${numberBr(option.count)})`
      : compactLabel;
  };

  return (
    <label className="grid min-w-0 max-w-full gap-1 text-xs font-semibold text-zinc-600">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full min-w-0 max-w-full truncate rounded-lg border border-zinc-200 bg-white px-2.5 text-sm font-medium text-zinc-800 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
      >
        <option value={ALL}>Todos</option>
        {options.map((option) => (
          <option
            key={option.value || option.label}
            value={option.value || option.label}
            title={option.label}
          >
            {formatOptionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function PortfolioTreemapPanel({
  rows = [],
  loading = false,
  onOpenDrill,
  variant = "default",
}) {
  const [filters, setFilters] = useState({
    owner: ALL,
    status: ALL,
    priority: ALL,
    deadline: ALL,
    issueType: ALL,
    area: ALL,
    query: "",
  });

  const openRows = useMemo(
    () => (Array.isArray(rows) ? rows.filter((ticket) => !ticket?.done) : []),
    [rows]
  );

  const filterOptions = useMemo(
    () => ({
      owners: uniqueSorted(openRows, (ticket) => ticket?.owner),
      statuses: uniqueSorted(openRows, (ticket) => ticket?.status),
      priorities: uniqueSorted(openRows, (ticket) => ticket?.priority),
      issueTypes: uniqueSorted(openRows, (ticket) => ticket?.issueType),
      areas: uniqueSorted(openRows, ticketAreas),
    }),
    [openRows]
  );

  const today = useMemo(() => startOfTodayLocal(), []);

  const filteredRows = useMemo(
    () =>
      openRows.filter((ticket) => {
        if (filters.owner !== ALL && clean(ticket?.owner, "Sem responsavel") !== filters.owner) {
          return false;
        }
        if (filters.status !== ALL && clean(ticket?.status, "Sem status") !== filters.status) {
          return false;
        }
        if (filters.priority !== ALL && clean(ticket?.priority) !== filters.priority) {
          return false;
        }
        if (
          filters.deadline !== ALL &&
          getDeadlineBucket(ticket, today) !== filters.deadline
        ) {
          return false;
        }
        if (filters.issueType !== ALL && clean(ticket?.issueType) !== filters.issueType) {
          return false;
        }
        if (filters.area !== ALL && !ticketAreas(ticket).includes(filters.area)) {
          return false;
        }
        return ticketMatchesQuery(ticket, filters.query);
      }),
    [openRows, filters, today]
  );

  const filteredStatusCounts = useMemo(
    () => uniqueSorted(filteredRows, (ticket) => ticket?.status),
    [filteredRows]
  );

  const statusColorMap = useMemo(
    () => buildStatusColorMap(filteredStatusCounts),
    [filteredStatusCounts]
  );

  const statusLegend = useMemo(
    () => buildStatusLegendItems(filteredStatusCounts, filters.status),
    [filteredStatusCounts, filters.status]
  );

  const data = useMemo(
    () => buildTreemapData(filteredRows, statusColorMap),
    [filteredRows, statusColorMap]
  );
  const activeFilterCount = Object.entries(filters).filter(([key, value]) =>
    key === "query" ? Boolean(value.trim()) : value !== ALL
  ).length;
  const isFull = variant === "full";
  const chartHeight = isFull ? 560 : 340;

  const setFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      owner: ALL,
      status: ALL,
      priority: ALL,
      deadline: ALL,
      issueType: ALL,
      area: ALL,
      query: "",
    });
  };

  const toggleStatusFilter = (status) => {
    setFilters((current) => ({
      ...current,
      status: current.status === status ? ALL : status,
      owner: ALL,
    }));
  };

  const option = useMemo(
    () => ({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        confine: true,
        borderWidth: 1,
        formatter: (params) => {
          const payload = params.data?.payload || {};
          const count = payload.count || params.value || 0;
          const lines = [
            `<strong>${params.name}</strong>`,
            `Tickets: ${numberBr(count)}`,
            `Carteira filtrada: ${pct(count, filteredRows.length)}`,
          ];

          if (payload.level === "owner") {
            lines.splice(1, 0, `Status: ${payload.status}`);
          }

          return lines.join("<br/>");
        },
      },
      series: [
        {
          type: "treemap",
          data,
          roam: false,
          nodeClick: false,
          breadcrumb: {
            show: false,
          },
          top: 8,
          right: 8,
          bottom: 8,
          left: 8,
          label: {
            show: true,
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 800,
            overflow: "truncate",
            formatter: (params) => {
              const payload = params.data?.payload || {};
              if (payload.level === "owner") {
                return `${params.name}\n${numberBr(params.value)}`;
              }
              return `${params.name}\n${numberBr(params.value)}`;
            },
          },
          upperLabel: {
            show: true,
            height: 24,
            color: "#334155",
            fontSize: 11,
            fontWeight: 850,
            overflow: "truncate",
            formatter: (params) => params.name,
          },
          itemStyle: {
            borderColor: "#ffffff",
            borderWidth: 2,
            gapWidth: 2,
          },
          levels: [
            {
              itemStyle: {
                borderWidth: 0,
                gapWidth: 2,
              },
            },
            {
              upperLabel: {
                show: true,
                height: 24,
                color: "#334155",
                fontSize: 11,
                fontWeight: 850,
                overflow: "truncate",
                formatter: (params) => params.name,
              },
              itemStyle: {
                borderColor: "#ffffff",
                borderWidth: 2,
                gapWidth: 2,
              },
            },
            {
              itemStyle: {
                borderColor: "#ffffff",
                borderWidth: 2,
                gapWidth: 1,
              },
            },
          ],
        },
      ],
    }),
    [data, filteredRows.length]
  );

  const events = useMemo(
    () => ({
      click: (params) => {
        const payload = params.data?.payload;
        if (!payload) return;

        if (payload.level === "status") {
          setFilters((current) => ({
            ...current,
            status: payload.status || ALL,
            owner: ALL,
          }));
          return;
        }

        if (payload.level === "owner") {
          setFilters((current) => ({
            ...current,
            status: payload.status || ALL,
            owner: payload.owner || ALL,
          }));
        }
      },
    }),
    []
  );

  const handleOpenDrill = () => {
    onOpenDrill?.({
      title: `Mapa da carteira: ${numberBr(filteredRows.length)} ticket(s)`,
      items: filteredRows,
    });
  };

  return (
    <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-sky-100 bg-sky-50 text-sky-700">
              <LayoutDashboard className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-950">
                Mapa da carteira
              </h3>
              <p className="text-xs text-zinc-500">
                Tickets abertos por status e responsavel.
              </p>
              <p className="mt-1 text-[11px] font-medium text-zinc-400">
                Cor = status | Bloco interno = responsavel | Tamanho = quantidade
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-xs text-zinc-700">
            {numberBr(filteredRows.length)} de {numberBr(openRows.length)}
          </Badge>
          {activeFilterCount > 0 ? (
            <Badge className="rounded-full border border-sky-100 bg-sky-50 text-xs text-sky-700">
              {activeFilterCount} filtro(s)
            </Badge>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
            onClick={clearFilters}
            disabled={!activeFilterCount}
          >
            <FilterX className="mr-1.5 h-3.5 w-3.5" />
            Limpar
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-lg bg-sky-700 text-white hover:bg-sky-800"
            onClick={handleOpenDrill}
            disabled={!filteredRows.length}
          >
            <UsersRound className="mr-1.5 h-3.5 w-3.5" />
            Ver tickets
          </Button>
        </div>
      </div>

      <StatusLegend
        items={statusLegend.visible}
        other={statusLegend.other}
        activeStatus={filters.status}
        colorMap={statusColorMap}
        onSelectStatus={toggleStatusFilter}
      />

      <div
        className={
          isFull
            ? "mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]"
            : "mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]"
        }
      >
        <div
          className={
            isFull
              ? "min-h-[580px] rounded-lg border border-zinc-200 bg-zinc-50 p-2"
              : "min-h-[360px] rounded-lg border border-zinc-200 bg-zinc-50 p-2"
          }
        >
          {loading ? (
            <div
              className="grid place-items-center text-sm font-medium text-zinc-500"
              style={{ height: chartHeight }}
            >
              Carregando carteira...
            </div>
          ) : filteredRows.length ? (
            <ReactECharts
              option={option}
              onEvents={events}
              notMerge
              lazyUpdate
              style={{ height: chartHeight, width: "100%" }}
            />
          ) : (
            <div
              className="grid place-items-center px-4 text-center"
              style={{ height: chartHeight }}
            >
              <div>
                <div className="text-sm font-semibold text-zinc-800">
                  Sem tickets para este recorte
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  Ajuste os filtros ou limpe a selecao para ver a carteira aberta.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid content-start gap-3 rounded-lg border border-zinc-200 bg-white p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              value={filters.query}
              onChange={(event) => setFilter("query", event.target.value)}
              className="h-9 rounded-lg border-zinc-200 pl-8 text-sm"
              placeholder="Buscar key ou titulo"
            />
          </div>

          <FilterSelect
            label="Status"
            value={filters.status}
            options={filterOptions.statuses}
            onChange={(value) => setFilter("status", value)}
          />
          <FilterSelect
            label="Responsavel"
            value={filters.owner}
            options={filterOptions.owners}
            onChange={(value) => setFilter("owner", value)}
            maxLabelLength={20}
          />
          <FilterSelect
            label="Prioridade"
            value={filters.priority}
            options={filterOptions.priorities}
            onChange={(value) => setFilter("priority", value)}
          />
          <FilterSelect
            label="Prazo"
            value={filters.deadline}
            options={DEADLINE_OPTIONS}
            onChange={(value) => setFilter("deadline", value)}
            showCounts={false}
          />
          <FilterSelect
            label="Tipo"
            value={filters.issueType}
            options={filterOptions.issueTypes}
            onChange={(value) => setFilter("issueType", value)}
          />
          <FilterSelect
            label="Diretoria"
            value={filters.area}
            options={filterOptions.areas}
            onChange={(value) => setFilter("area", value)}
          />
        </div>
      </div>
    </section>
  );
}
