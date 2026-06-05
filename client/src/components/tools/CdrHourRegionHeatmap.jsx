import React, { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { Grid3X3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function numberBr(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function tooltipLine(label, value) {
  return `<div style="display:flex;justify-content:space-between;gap:18px;"><span>${label}</span><strong>${value}</strong></div>`;
}

export default function CdrHourRegionHeatmap({ data }) {
  const [mode, setMode] = useState("ddd");
  const hours = data?.hours || [];
  const regions = mode === "ddd" ? data?.ddds || [] : data?.ufs || [];
  const cells = mode === "ddd" ? data?.cellsByDdd || [] : data?.cellsByUf || [];
  const hasData = cells.some((cell) => Number(cell.value || 0) > 0);

  const payloadByPoint = useMemo(() => {
    const map = new Map();
    cells.forEach((cell) => {
      map.set(`${cell.region}:${cell.hour}`, cell);
    });
    return map;
  }, [cells]);

  const maxValue = Math.max(...cells.map((cell) => Number(cell.value || 0)), 0);
  const option = useMemo(
    () => ({
      backgroundColor: "transparent",
      tooltip: {
        position: "top",
        confine: true,
        formatter: (params) => {
          const [x, y, value] = params.data || [];
          const hour = hours[x]?.label || hours[x]?.hour || "-";
          const region = regions[y] || {};
          const payload = payloadByPoint.get(`${region.key}:${hours[x]?.hour}`) || {};
          return [
            `<strong>${region.label || region.key || "-"} - ${hour}</strong>`,
            region.uf ? `<div>${region.stateName || region.uf}</div>` : "",
            tooltipLine("Chamadas", numberBr(value)),
            tooltipLine("Transferidas", numberBr(payload.transferred)),
            tooltipLine("Abandonadas", numberBr(payload.abandoned)),
          ].join("");
        },
      },
      grid: {
        top: 18,
        right: 24,
        bottom: 36,
        left: 76,
      },
      xAxis: {
        type: "category",
        data: hours.map((hour) => hour.hour),
        splitArea: { show: true },
        axisLabel: {
          color: "#52525b",
          fontSize: 11,
        },
      },
      yAxis: {
        type: "category",
        data: regions.map((region) => region.label || region.key),
        splitArea: { show: true },
        axisLabel: {
          color: "#52525b",
          fontSize: 11,
        },
      },
      visualMap: {
        min: 0,
        max: Math.max(maxValue, 1),
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        text: ["Mais", "Menos"],
        inRange: {
          color: ["#f4f4f5", "#fecaca", "#f87171", "#b91c1c"],
        },
        textStyle: {
          color: "#52525b",
          fontSize: 11,
        },
      },
      series: [
        {
          name: "Chamadas",
          type: "heatmap",
          data: cells.map((cell) => [
            hours.findIndex((hour) => hour.hour === cell.hour),
            regions.findIndex((region) => region.key === cell.region),
            cell.value,
          ]),
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(24,24,27,0.25)",
            },
          },
        },
      ],
    }),
    [cells, hours, maxValue, payloadByPoint, regions],
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">
            Heatmap hora x DDD/UF
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Volume regional por horario de inicio da ligacao.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-1">
          {[
            ["ddd", "DDD"],
            ["uf", "UF"],
          ].map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "h-8 rounded-md px-3 text-xs",
                mode === value ? "bg-white text-red-700 shadow-sm" : "text-zinc-600",
              )}
              onClick={() => setMode(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="relative min-h-[380px] rounded-lg border border-zinc-100 bg-zinc-50">
        {!hasData ? (
          <div className="absolute inset-x-4 top-4 z-10 rounded-lg border border-dashed border-zinc-300 bg-white/90 px-3 py-2 text-center text-xs text-zinc-500">
            Sem ANI/data validos para montar o heatmap regional.
          </div>
        ) : null}
        <ReactECharts
          className="h-[380px] w-full"
          option={option}
          notMerge
          lazyUpdate
          style={{ height: 380, width: "100%" }}
        />
      </div>

      {hasData ? (
        <div className="mt-2 inline-flex items-center gap-2 text-xs text-zinc-500">
          <Grid3X3 className="h-3.5 w-3.5" />
          {mode === "ddd" ? "Top 20 DDDs por volume" : "UFs com chamadas no periodo"}
        </div>
      ) : null}
    </div>
  );
}
