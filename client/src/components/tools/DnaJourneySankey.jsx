import React, { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { GitBranch } from "lucide-react";

function numberBr(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function pct(value) {
  return `${Math.round(Number(value || 0) * 1000) / 10}%`;
}

function tooltipLine(label, value) {
  return `<div style="display:flex;justify-content:space-between;gap:18px;"><span>${label}</span><strong>${value}</strong></div>`;
}

export default function DnaJourneySankey({ data, embedded = false }) {
  const nodes = data?.nodes || [];
  const links = data?.links || [];
  const topAbandonmentSteps = data?.topAbandonmentSteps || [];
  const summary = data?.summary || {};
  const hasData = nodes.length > 0 && links.length > 0;

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const option = useMemo(
    () => ({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        confine: true,
        formatter: (params) => {
          if (params.dataType === "edge") {
            const source = nodeById.get(params.data.source);
            const target = nodeById.get(params.data.target);
            return [
              `<strong>${source?.label || params.data.source} -> ${target?.label || params.data.target}</strong>`,
              tooltipLine("Chamadas", numberBr(params.data.value)),
              tooltipLine("Abandonos", numberBr(params.data.abandonments)),
              tooltipLine("Taxa abandono", pct(params.data.abandonmentRate)),
            ].join("");
          }

          const node = params.data || {};
          return [
            `<strong>${node.label || node.code}</strong>`,
            node.description ? `<div>${node.description}</div>` : "",
            tooltipLine("Etapa", node.depth || "-"),
            tooltipLine("Chamadas", numberBr(node.count)),
            tooltipLine("Abandonos", numberBr(node.abandonments)),
            tooltipLine("Taxa abandono", pct(node.abandonmentRate)),
          ].join("");
        },
      },
      series: [
        {
          type: "sankey",
          top: 22,
          right: 24,
          bottom: 22,
          left: 12,
          nodeWidth: 14,
          nodeGap: 10,
          draggable: true,
          emphasis: {
            focus: "adjacency",
          },
          label: {
            color: "#3f3f46",
            fontSize: 10,
            formatter: (params) => params.data.label || params.data.code,
          },
          lineStyle: {
            color: "gradient",
            curveness: 0.5,
            opacity: 0.35,
          },
          itemStyle: {
            borderColor: "#ffffff",
            borderWidth: 1,
          },
          levels: [
            { depth: 0, itemStyle: { color: "#dc2626" } },
            { depth: 1, itemStyle: { color: "#f97316" } },
            { depth: 2, itemStyle: { color: "#eab308" } },
            { depth: 3, itemStyle: { color: "#16a34a" } },
            { depth: 4, itemStyle: { color: "#2563eb" } },
            { depth: 5, itemStyle: { color: "#7c3aed" } },
          ],
          data: nodes.map((node) => ({
            ...node,
            value: node.count,
          })),
          links,
        },
      ],
    }),
    [links, nodeById, nodes],
  );

  return (
    <div className={embedded ? "" : "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">
            Funil de jornada por DNA
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Caminhos navegados pela coluna DNA e pontos com maior abandono.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
          <GitBranch className="h-3.5 w-3.5" />
          {numberBr(summary.validJourneys)} jornada(s)
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,0.85fr)]">
        <div className="relative min-h-[460px] rounded-lg border border-zinc-100 bg-zinc-50">
          {!hasData ? (
            <div className="absolute inset-x-4 top-4 z-10 rounded-lg border border-dashed border-zinc-300 bg-white/90 px-3 py-2 text-center text-xs text-zinc-500">
              Sem DNA suficiente para montar o funil de jornada.
            </div>
          ) : null}
          <ReactECharts
            className="h-[460px] w-full"
            option={option}
            notMerge
            lazyUpdate
            style={{ height: 460, width: "100%" }}
          />
        </div>

        <aside className="rounded-lg border border-zinc-100 bg-zinc-50 p-3">
          <div className="mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Pontos criticos
            </p>
            <h4 className="mt-1 text-sm font-semibold text-zinc-900">
              Abandono por etapa
            </h4>
          </div>
          <div className="grid max-h-[440px] gap-2 overflow-auto pr-1" data-pdf-expand>
            {topAbandonmentSteps.length ? (
              topAbandonmentSteps.map((step, index) => (
                <div
                  key={step.id}
                  className="rounded-lg border border-zinc-100 bg-white px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-zinc-900">
                        #{index + 1} {step.label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        Etapa {step.depth}
                      </p>
                    </div>
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                      {pct(step.abandonmentRate)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-600">
                    <span>Chamadas: {numberBr(step.count)}</span>
                    <span>Aband.: {numberBr(step.abandonments)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-6 text-center text-xs text-zinc-500">
                Sem abandonos identificados no DNA.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
