import React, { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts";
import ReactECharts from "echarts-for-react";
import { MapPin } from "lucide-react";

import brasilUfGeoJson from "@/data/brasil-uf.geo.json";

const MAP_NAME = "BR";
const BRAZIL_UFS = [
  { uf: "AC", stateName: "Acre" },
  { uf: "AL", stateName: "Alagoas" },
  { uf: "AP", stateName: "Amapa" },
  { uf: "AM", stateName: "Amazonas" },
  { uf: "BA", stateName: "Bahia" },
  { uf: "CE", stateName: "Ceara" },
  { uf: "DF", stateName: "Distrito Federal" },
  { uf: "ES", stateName: "Espirito Santo" },
  { uf: "GO", stateName: "Goias" },
  { uf: "MA", stateName: "Maranhao" },
  { uf: "MT", stateName: "Mato Grosso" },
  { uf: "MS", stateName: "Mato Grosso do Sul" },
  { uf: "MG", stateName: "Minas Gerais" },
  { uf: "PA", stateName: "Para" },
  { uf: "PB", stateName: "Paraiba" },
  { uf: "PR", stateName: "Parana" },
  { uf: "PE", stateName: "Pernambuco" },
  { uf: "PI", stateName: "Piaui" },
  { uf: "RJ", stateName: "Rio de Janeiro" },
  { uf: "RN", stateName: "Rio Grande do Norte" },
  { uf: "RS", stateName: "Rio Grande do Sul" },
  { uf: "RO", stateName: "Rondonia" },
  { uf: "RR", stateName: "Roraima" },
  { uf: "SC", stateName: "Santa Catarina" },
  { uf: "SP", stateName: "Sao Paulo" },
  { uf: "SE", stateName: "Sergipe" },
  { uf: "TO", stateName: "Tocantins" },
];

let mapRegistered = false;

function ensureBrazilMapRegistered() {
  if (mapRegistered) return;

  const geoJson = {
    ...brasilUfGeoJson,
    features: brasilUfGeoJson.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        name: feature.properties?.sigla || feature.properties?.name,
      },
    })),
  };

  echarts.registerMap(MAP_NAME, geoJson);
  mapRegistered = true;
}

ensureBrazilMapRegistered();

function numberBr(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function emptyState(uf) {
  const state = BRAZIL_UFS.find((item) => item.uf === uf);
  return {
    uf,
    stateName: state?.stateName || uf,
    count: 0,
    answered: 0,
    abandoned: 0,
    averageTotalFormatted: "0:00",
    averageUraFormatted: "0:00",
    peakHour: "",
    topDdds: [],
  };
}

function StateMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

export default function BrazilCdrHeatmap({ states = [] }) {
  const [selectedUf, setSelectedUf] = useState("");

  const stateByUf = useMemo(() => {
    return new Map((states || []).map((state) => [state.uf, state]));
  }, [states]);

  const mapData = useMemo(
    () =>
      BRAZIL_UFS.map((state) => {
        const payload = stateByUf.get(state.uf) || emptyState(state.uf);
        return {
          name: state.uf,
          value: Number(payload.count || 0),
          payload,
        };
      }),
    [stateByUf],
  );

  const maxValue = Math.max(...mapData.map((item) => item.value), 0);
  const selectedState =
    stateByUf.get(selectedUf) ||
    (selectedUf ? emptyState(selectedUf) : states?.[0] || null);

  useEffect(() => {
    if (!states?.length) {
      setSelectedUf("");
      return;
    }
    setSelectedUf((current) =>
      current && states.some((state) => state.uf === current)
        ? current
        : states[0].uf,
    );
  }, [states]);

  const option = useMemo(
    () => ({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        confine: true,
        borderWidth: 1,
        formatter: (params) => {
          const payload = params.data?.payload || emptyState(params.name);
          return [
            `<strong>${payload.stateName} (${payload.uf})</strong>`,
            `Chamadas: ${numberBr(payload.count)}`,
            `Atendidas: ${numberBr(payload.answered)}`,
            `Abandonadas: ${numberBr(payload.abandoned)}`,
            `TMA total: ${payload.averageTotalFormatted || "0:00"}`,
            `TMA URA: ${payload.averageUraFormatted || "0:00"}`,
            `Pico: ${payload.peakHour || "-"}`,
          ].join("<br/>");
        },
      },
      visualMap: {
        min: 0,
        max: Math.max(maxValue, 1),
        left: 12,
        bottom: 10,
        calculable: true,
        text: ["Mais", "Menos"],
        inRange: {
          color: ["#fee2e2", "#fca5a5", "#ef4444", "#991b1b"],
        },
        textStyle: {
          color: "#52525b",
          fontSize: 11,
        },
      },
      series: [
        {
          name: "Chamadas",
          type: "map",
          map: MAP_NAME,
          roam: true,
          zoom: 1.08,
          scaleLimit: {
            min: 0.85,
            max: 6,
          },
          label: {
            show: true,
            color: "#3f3f46",
            fontSize: 10,
            formatter: "{b}",
          },
          emphasis: {
            label: {
              show: true,
              color: "#111827",
              fontWeight: 700,
            },
            itemStyle: {
              areaColor: "#f97316",
              borderColor: "#111827",
              borderWidth: 1,
            },
          },
          select: {
            label: {
              color: "#111827",
              fontWeight: 700,
            },
            itemStyle: {
              areaColor: "#fb923c",
              borderColor: "#111827",
              borderWidth: 1.5,
            },
          },
          itemStyle: {
            borderColor: "#ffffff",
            borderWidth: 0.9,
            areaColor: "#f4f4f5",
          },
          data: mapData,
        },
      ],
    }),
    [mapData, maxValue],
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">
            Mapa de calor por estado
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Volume de chamadas por UF calculado pelo DDD da coluna ANI.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600">
          <MapPin className="h-3.5 w-3.5 text-red-600" />
          Arraste para mover, role para zoom
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(260px,0.85fr)]">
        <div className="relative min-h-[420px] rounded-lg border border-zinc-100 bg-zinc-50">
          {maxValue === 0 ? (
            <div className="absolute inset-x-4 top-4 z-10 rounded-lg border border-dashed border-zinc-300 bg-white/90 px-3 py-2 text-center text-xs text-zinc-500">
              Sem chamadas com DDD identificado para colorir o mapa.
            </div>
          ) : null}
          <ReactECharts
            className="h-[420px] w-full"
            option={option}
            notMerge
            lazyUpdate
            onEvents={{
              click: (params) => {
                if (params?.name) setSelectedUf(params.name);
              },
            }}
            style={{ height: 420, width: "100%" }}
          />
        </div>

        <aside className="rounded-lg border border-zinc-100 bg-zinc-50 p-3">
          {selectedState ? (
            <div className="grid gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Estado selecionado
                </p>
                <h4 className="mt-1 text-lg font-semibold text-zinc-950">
                  {selectedState.stateName} ({selectedState.uf})
                </h4>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <StateMetric label="Chamadas" value={numberBr(selectedState.count)} />
                <StateMetric
                  label="Atendidas"
                  value={numberBr(selectedState.answered)}
                />
                <StateMetric
                  label="Abandonadas"
                  value={numberBr(selectedState.abandoned)}
                />
                <StateMetric
                  label="Pico"
                  value={selectedState.peakHour || "-"}
                />
                <StateMetric
                  label="Tempo medio total"
                  value={selectedState.averageTotalFormatted || "0:00"}
                />
                <StateMetric
                  label="Tempo medio URA"
                  value={selectedState.averageUraFormatted || "0:00"}
                />
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Top DDDs
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedState.topDdds?.length ? (
                    selectedState.topDdds.map((ddd) => (
                      <span
                        key={ddd.key}
                        className="rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"
                      >
                        {ddd.label}: {numberBr(ddd.count)}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-zinc-500">Sem DDDs.</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid min-h-[220px] place-items-center text-center text-sm text-zinc-500">
              Clique em um estado para ver os detalhes.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
