import React, { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { Activity } from "lucide-react";

function numberBr(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function tooltipLine(label, value) {
  return `<div style="display:flex;justify-content:space-between;gap:18px;"><span>${label}</span><strong>${value}</strong></div>`;
}

export default function CdrCallFlowChart({ data = [] }) {
  const hasData = data.some((item) => Number(item.started || 0) > 0 || Number(item.finished || 0) > 0);
  const peak = useMemo(
    () =>
      data.reduce(
        (currentPeak, item) =>
          Number(item.started || 0) > Number(currentPeak.started || 0) ? item : currentPeak,
        data[0] || null,
      ),
    [data],
  );

  const option = useMemo(
    () => ({
      backgroundColor: "transparent",
      color: ["#dc2626", "#2563eb"],
      grid: {
        top: 52,
        right: 22,
        bottom: 34,
        left: 48,
      },
      legend: {
        top: 8,
        right: 8,
        textStyle: {
          color: "#52525b",
          fontSize: 12,
        },
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        axisPointer: {
          type: "cross",
          crossStyle: {
            color: "#71717a",
          },
        },
        formatter: (params) => {
          const payload = params?.[0]?.data?.payload || {};
          return [
            `<strong>${payload.label || ""}</strong>`,
            tooltipLine("Iniciadas", numberBr(payload.started)),
            tooltipLine("Finalizadas", numberBr(payload.finished)),
            tooltipLine("Transferidas", numberBr(payload.transferred)),
            tooltipLine("Abandonadas", numberBr(payload.abandoned)),
            tooltipLine("Duracao media", payload.averageDurationFormatted || "0:00"),
          ].join("");
        },
      },
      xAxis: {
        type: "category",
        data: data.map((item) => item.hour),
        axisLabel: {
          color: "#52525b",
          fontSize: 11,
        },
        axisTick: {
          alignWithLabel: true,
        },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: {
          color: "#52525b",
          fontSize: 11,
        },
        splitLine: {
          lineStyle: {
            color: "#e4e4e7",
            type: "dashed",
          },
        },
      },
      series: [
        {
          name: "Chamadas iniciadas",
          type: "bar",
          barMaxWidth: 28,
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
          },
          data: data.map((item) => ({
            value: item.started,
            payload: item,
          })),
        },
        {
          name: "Chamadas finalizadas",
          type: "line",
          smooth: true,
          symbolSize: 7,
          lineStyle: {
            width: 3,
          },
          areaStyle: {
            opacity: 0.08,
          },
          data: data.map((item) => ({
            value: item.finished,
            payload: item,
          })),
        },
      ],
    }),
    [data],
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">
            Fluxo de chamadas por hora
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Picos por DATA_INICIO_LIGACAO_URA e finalizacoes por DATA_FIM_LIGACAO_URA.
          </p>
        </div>
        {peak ? (
          <div className="inline-flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
            <Activity className="h-3.5 w-3.5" />
            Pico: {peak.label} ({numberBr(peak.started)})
          </div>
        ) : null}
      </div>

      <div className="relative min-h-[340px] rounded-lg border border-zinc-100 bg-zinc-50">
        {!hasData ? (
          <div className="absolute inset-x-4 top-4 z-10 rounded-lg border border-dashed border-zinc-300 bg-white/90 px-3 py-2 text-center text-xs text-zinc-500">
            Sem datas validas para montar o fluxo de chamadas.
          </div>
        ) : null}
        <ReactECharts
          className="h-[340px] w-full"
          option={option}
          notMerge
          lazyUpdate
          style={{ height: 340, width: "100%" }}
        />
      </div>
    </div>
  );
}
