import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleHelp } from "lucide-react";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function numberBr(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function pct(value) {
  return `${Math.round(Number(value || 0) * 1000) / 10}%`;
}

function duration(value) {
  const total = Math.max(0, Math.round(Number(value || 0)));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function DeltaIcon({ value }) {
  if (Number(value || 0) > 0) return <ArrowUpRight className="h-4 w-4 text-emerald-600" />;
  if (Number(value || 0) < 0) return <ArrowDownRight className="h-4 w-4 text-red-600" />;
  return <ArrowRight className="h-4 w-4 text-zinc-500" />;
}

function MetricHelp({ description }) {
  if (!description) return null;
  return (
    <UiTooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-grid h-5 w-5 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
          aria-label="Descricao do indicador"
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">
        {description}
      </TooltipContent>
    </UiTooltip>
  );
}

function ComparisonCard({
  title,
  description,
  leftLabel,
  rightLabel,
  left,
  right,
  delta,
  formatter = numberBr,
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium text-zinc-500">{title}</p>
            <MetricHelp description={description} />
          </div>
          <div className="mt-3 grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">{leftLabel}</span>
              <strong className="text-zinc-900">{formatter(left)}</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">{rightLabel}</span>
              <strong className="text-zinc-900">{formatter(right)}</strong>
            </div>
          </div>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-100 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
          <DeltaIcon value={delta} />
          {formatter(Math.abs(delta || 0))}
        </div>
      </div>
    </div>
  );
}

function RankingComparison({ title, rows, leftLabel, rightLabel, keyRenderer }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-zinc-100" data-pdf-expand>
        <table className="min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-100 text-zinc-700">
            <tr>
              <th className="border-b border-zinc-200 px-3 py-2 font-semibold">Item</th>
              <th className="border-b border-zinc-200 px-3 py-2 font-semibold">{leftLabel}</th>
              <th className="border-b border-zinc-200 px-3 py-2 font-semibold">{rightLabel}</th>
              <th className="border-b border-zinc-200 px-3 py-2 font-semibold">Delta</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length ? (
              rows.map((row) => (
                <tr key={row.key} className="odd:bg-white even:bg-zinc-50">
                  <td className="max-w-[520px] border-b border-zinc-100 px-3 py-2 align-top text-zinc-700">
                    {keyRenderer ? keyRenderer(row) : row.label}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 text-zinc-700">
                    {numberBr(row.left)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 text-zinc-700">
                    {numberBr(row.right)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 text-zinc-700">
                    {row.delta > 0 ? "+" : ""}
                    {numberBr(row.delta)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  Sem dados para comparar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CdrComparisonView({ data }) {
  if (!data) return null;

  const labels = data.comparison?.labels || {
    left: data.left?.label || "Cenario A",
    right: data.right?.label || "Cenario B",
  };
  const metrics = data.comparison?.metrics || {};
  const chartData = data.comparison?.charts?.kpis || [];

  return (
    <TooltipProvider>
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <ComparisonCard
          title="Chamadas"
          leftLabel={labels.left}
          rightLabel={labels.right}
          {...metrics.analyzedCalls}
        />
        <ComparisonCard
          title="TMA total"
          description="Tempo medio da chamada inteira no CDR, considerando o periodo total da ligacao do inicio ao fim."
          leftLabel={labels.left}
          rightLabel={labels.right}
          formatter={duration}
          {...metrics.averageTotalSeconds}
        />
        <ComparisonCard
          title="TMA URA"
          description="Tempo medio apenas dentro da URA, calculado pelo periodo em que a chamada permaneceu no atendimento automatico."
          leftLabel={labels.left}
          rightLabel={labels.right}
          formatter={duration}
          {...metrics.averageUraSeconds}
        />
        <ComparisonCard
          title="Transferencias"
          leftLabel={labels.left}
          rightLabel={labels.right}
          {...metrics.transferTotal}
        />
        <ComparisonCard
          title="Taxa transferencia"
          leftLabel={labels.left}
          rightLabel={labels.right}
          formatter={pct}
          {...metrics.transferRate}
        />
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-zinc-900">
          Indicadores lado a lado
        </h3>
        <div className="mt-3 h-[320px] min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="left" name={labels.left} fill="#dc2626" radius={[6, 6, 0, 0]} />
              <Bar dataKey="right" name={labels.right} fill="#2563eb" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <RankingComparison
          title="Top DNA comparado"
          rows={data.comparison?.charts?.dna || []}
          leftLabel={labels.left}
          rightLabel={labels.right}
          keyRenderer={(row) => (
            <span className="block whitespace-normal break-words font-mono text-[11px]">
              {row.label}
            </span>
          )}
        />
        <RankingComparison
          title="Top skills comparado"
          rows={data.comparison?.charts?.skills || []}
          leftLabel={labels.left}
          rightLabel={labels.right}
        />
      </div>
    </div>
    </TooltipProvider>
  );
}
