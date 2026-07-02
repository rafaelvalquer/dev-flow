import { useMemo } from "react";
import ReactECharts from "echarts-for-react";

import { EmptyWidgetText } from "../components/EmptyWidgetText";
import {
  getPriority,
  getStatus,
  norm,
} from "../utils/developerTicketUtils";

const PRIORITY_META = [
  { key: "highest", label: "Highest", color: "#b91c1c" },
  { key: "high", label: "High", color: "#f97316" },
  { key: "medium", label: "Medium", color: "#2563eb" },
  { key: "low", label: "Low", color: "#059669" },
  { key: "other", label: "Outras", color: "#64748b" },
];

const STATUS_COLORS = [
  "#334155",
  "#475569",
  "#0f766e",
  "#2563eb",
  "#7c3aed",
  "#b45309",
  "#4b5563",
];

function priorityKey(priority) {
  const normalized = norm(priority);
  if (normalized.includes("highest")) return "highest";
  if (normalized.includes("high") || normalized.includes("alta")) return "high";
  if (normalized.includes("medium") || normalized.includes("media")) return "medium";
  if (normalized.includes("low") || normalized.includes("baixa")) return "low";
  return "other";
}

function numberBr(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function pct(value, total) {
  if (!total) return "0%";
  return `${Math.round((Number(value || 0) / total) * 1000) / 10}%`;
}

function buildTreemapData(rows = []) {
  const statusMap = new Map();

  rows.forEach((issue) => {
    const status = String(getStatus(issue) || "").trim() || "Sem status";
    const priority = getPriority(issue);
    const pKey = priorityKey(priority);
    const pMeta =
      PRIORITY_META.find((item) => item.key === pKey) ||
      PRIORITY_META[PRIORITY_META.length - 1];

    if (!statusMap.has(status)) {
      statusMap.set(status, {
        status,
        count: 0,
        priorities: new Map(),
      });
    }

    const statusEntry = statusMap.get(status);
    statusEntry.count += 1;

    const priorityEntry = statusEntry.priorities.get(pKey) || {
      priorityKey: pKey,
      priority: pMeta.label,
      count: 0,
      color: pMeta.color,
    };
    priorityEntry.count += 1;
    statusEntry.priorities.set(pKey, priorityEntry);
  });

  return Array.from(statusMap.values())
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status, "pt-BR"))
    .map((statusEntry, index) => ({
      name: statusEntry.status,
      value: statusEntry.count,
      itemStyle: {
        color: STATUS_COLORS[index % STATUS_COLORS.length],
      },
      payload: {
        level: "status",
        status: statusEntry.status,
        count: statusEntry.count,
      },
      children: Array.from(statusEntry.priorities.values())
        .sort((a, b) => b.count - a.count || a.priority.localeCompare(b.priority))
        .map((priorityEntry) => ({
          name: priorityEntry.priority,
          value: priorityEntry.count,
          itemStyle: {
            color: priorityEntry.color,
          },
          payload: {
            level: "priority",
            status: statusEntry.status,
            priority: priorityEntry.priorityKey,
            priorityLabel: priorityEntry.priority,
            count: priorityEntry.count,
          },
        })),
    }));
}

export function PortfolioTreemapWidget({
  rows,
  onApplyFilter,
  onClearFilter,
}) {
  const total = rows?.length || 0;
  const data = useMemo(() => buildTreemapData(rows), [rows]);

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
            `Carteira: ${pct(count, total)}`,
          ];

          if (payload.level === "priority") {
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
              if (payload.level === "priority") {
                return `${payload.status}\n${params.name} · ${numberBr(
                  params.value,
                )}`;
              }

              return `${params.name}\n${numberBr(params.value)}`;
            },
          },
          upperLabel: {
            show: true,
            height: 22,
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 850,
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
                color: "#ffffff",
                fontSize: 11,
                fontWeight: 850,
              },
              label: {
                show: true,
                formatter: (params) => `${params.name}\n${numberBr(params.value)}`,
              },
              itemStyle: {
                borderColor: "#ffffff",
                borderWidth: 2,
                gapWidth: 2,
              },
            },
            {
              label: {
                show: true,
              },
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
    [data, total],
  );

  const events = useMemo(
    () => ({
      click: (params) => {
        const payload = params.data?.payload;
        if (!payload) {
          onClearFilter?.();
          return;
        }

        onApplyFilter?.({
          status: payload.status || "all",
          priority: payload.level === "priority" ? payload.priority : "all",
        });
      },
    }),
    [onApplyFilter, onClearFilter],
  );

  function handleChartReady(chart) {
    const zr = chart?.getZr?.();
    if (!zr) return;

    zr.on("click", (event) => {
      if (!event.target) onClearFilter?.();
    });
  }

  if (!total) {
    return <EmptyWidgetText text="Sem tickets ativos para montar o mapa." />;
  }

  return (
    <div className="developer-portfolio-map">
      <div className="developer-portfolio-map__toolbar">
        <span>{numberBr(total)} tickets ativos</span>
        <button type="button" onClick={() => onClearFilter?.()}>
          Limpar filtro
        </button>
      </div>
      <ReactECharts
        className="developer-portfolio-map__chart"
        option={option}
        onEvents={events}
        onChartReady={handleChartReady}
        notMerge
        lazyUpdate
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
