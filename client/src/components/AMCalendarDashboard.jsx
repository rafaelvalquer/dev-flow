// src/components/AMCalendarDashboard.jsx
import { memo, useMemo, useState, useCallback, useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  Legend,
  ReferenceLine,
} from "recharts";

import ReactApexChart from "react-apexcharts";
import { AlertTriangle } from "lucide-react";

/** ✅ React Calendar Timeline */
import Timeline from "react-calendar-timeline";
import "react-calendar-timeline/style.css";

/* =========================
   //#region HELPERS
========================= */

function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      const w = Math.floor(cr?.width || 0);
      const h = Math.floor(cr?.height || 0);

      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
}

function cn(...a) {
  return a.filter(Boolean).join(" ");
}

function normalizeStr(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function toYmd(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : parseDateAny(d);
  if (!dt || Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * ✅ CORREÇÃO DO BUG DO DIA ANTERIOR:
 * "2026-01-17" no JS vira UTC 00:00 -> Brasil (-03) = 16/01 21:00.
 * Então aqui tratamos YYYY-MM-DD como data LOCAL (new Date(y,m-1,d)).
 */
function parseDateAny(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;

  const s = String(v);

  // yyyy-mm-dd => parse LOCAL
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map((x) => Number(x));
    const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function startOfDay(d) {
  const dt = d instanceof Date ? d : parseDateAny(d);
  if (!dt) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
}

function daysBetweenInclusive(start, end) {
  const s0 = startOfDay(start);
  const e0 = startOfDay(end);
  if (!s0 || !e0) return [];

  const s = s0.getTime();
  const e = e0.getTime();

  const out = [];
  for (let t = s; t <= e; t += 24 * 60 * 60 * 1000) out.push(new Date(t));
  return out;
}

function clampNumber(n, min, max) {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function hashStringToIndex(str, mod) {
  const s = String(str || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return mod ? h % mod : 0;
}

function fmtBrDay(ymd) {
  // ymd => dd/MM
  const s = String(ymd || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dd = s.slice(8, 10);
  const mm = s.slice(5, 7);
  return `${dd}/${mm}`;
}

function eventDate(ev) {
  const start = parseDateAny(ev?.start);
  let end = parseDateAny(ev?.end);

  if (!start) return { start: null, end: null };

  // Para allDay, se vier vazio/igual, assume 1 dia (end exclusivo)
  if (!end) end = start;

  if (ev?.allDay) {
    if (end.getTime() === start.getTime()) {
      end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  return { start, end };
}

function eventOverlapsRange(
  evStart,
  evEndInclusive,
  rangeStart,
  rangeEndExclusive
) {
  if (!evStart || !evEndInclusive || !rangeStart || !rangeEndExclusive)
    return false;

  const a0 = evStart.getTime();
  const a1 = evEndInclusive.getTime();
  const b0 = rangeStart.getTime();
  const b1 = rangeEndExclusive.getTime();

  return a0 < b1 && a1 >= b0;
}

function getRecurso(ev) {
  const p = ev?.extendedProps || {};
  return String(p?.recurso || "").trim() || "Sem recurso";
}

function getIssueKey(ev) {
  const p = ev?.extendedProps || {};
  return String(p?.issueKey || ev?.issueKey || "")
    .trim()
    .toUpperCase();
}

function getActivityId(ev) {
  const p = ev?.extendedProps || {};
  return String(p?.activityId || "").trim() || "other";
}

function inferDueDateFromIssue(iss) {
  const raw =
    iss?.dueDateRaw ||
    iss?.dueDate ||
    iss?.fields?.duedate ||
    iss?.fields?.dueDate ||
    iss?.fields?.due_date;

  const s = String(raw || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  // dueDate no fim do dia
  const d = new Date(`${s}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function shortList(arr, max = 3) {
  const list = Array.isArray(arr) ? arr : [];
  if (list.length <= max) return { items: list, rest: 0 };
  return { items: list.slice(0, max), rest: list.length - max };
}

// ✅ lista os dias (ymd) que o evento ocupa dentro do range visível
function eventDayKeysInRange(ev, rangeDaySet) {
  const { start, end } = eventDate(ev);
  if (!start || !end) return [];

  // allDay: end é exclusivo -> para calcular dias, usa end-1ms como inclusivo
  const endInclusive = ev?.allDay ? new Date(end.getTime() - 1) : end;

  const dayKeys = daysBetweenInclusive(start, endInclusive)
    .map(toYmd)
    .filter(Boolean);
  return dayKeys.filter((dk) => rangeDaySet.has(dk));
}

function addDays(d, n) {
  const dt = d instanceof Date ? d : parseDateAny(d);
  if (!dt) return null;
  return new Date(dt.getTime() + n * 24 * 60 * 60 * 1000);
}

/* =========================
   //#region COMPONENT
========================= */
export default memo(function AMCalendarDashboard({
  events,
  calendarioIssues,
  visibleRange,
}) {
  // capacidade por dev/dia (atividades simultâneas)
  const [capacityActsPerDevPerDay, setCapacityActsPerDevPerDay] = useState(3);

  // filtro multi-select (clicar alterna)
  const [hasTouchedDevFilter, setHasTouchedDevFilter] = useState(false);
  const [selectedDevSet, setSelectedDevSet] = useState(() => new Set());

  // range visível do Timeline (ms)
  const [tlVisible, setTlVisible] = useState(() => {
    const rs = parseDateAny(visibleRange?.start) || startOfDay(new Date());
    const re = parseDateAny(visibleRange?.end) || addDays(rs, 30);
    const a = rs ? rs.getTime() : Date.now();
    const b = re ? re.getTime() : a + 30 * 24 * 60 * 60 * 1000;
    return { start: a, end: Math.max(b, a + 24 * 60 * 60 * 1000) };
  });

  const [workloadRef, workloadSize] = useElementSize();

  // =========================
  // Cores
  // =========================
  const DEV_PALETTE = [
    "#2563EB",
    "#7C3AED",
    "#DB2777",
    "#DC2626",
    "#EA580C",
    "#D97706",
    "#059669",
    "#0EA5E9",
    "#14B8A6",
    "#16A34A",
    "#9333EA",
    "#E11D48",
    "#F97316",
    "#84CC16",
    "#06B6D4",
  ];

  const ATIVIDADE_COLOR_BY_ID = {
    devUra: "#2563EB",
    rdm: "#7C3AED",
    gmud: "#F59E0B",
    hml: "#4F46E5",
    deploy: "#16A34A",
    other: "#64748B",
  };

  const ATIVIDADE_LABEL_BY_ID = {
    devUra: "Desenvolvimento de URA",
    rdm: "Preenchimento RDM",
    gmud: "Aprovação GMUD",
    hml: "Homologação",
    deploy: "Implantação",
    other: "Outros",
  };

  function pickDevColor(devName) {
    const idx = hashStringToIndex(devName, DEV_PALETTE.length);
    return DEV_PALETTE[idx];
  }

  // =========================
  // Index dueDate por issueKey
  // =========================
  const dueIndex = useMemo(() => {
    const m = new Map();
    (calendarioIssues || []).forEach((iss) => {
      const key = String(iss?.key || "")
        .trim()
        .toUpperCase();
      if (!key) return;
      const due = inferDueDateFromIssue(iss);
      if (due) m.set(key, due);
    });
    return m;
  }, [calendarioIssues]);

  // =========================
  // Range visível (para charts/heatmap) — usa visibleRange (prop)
  // =========================
  const rangeDays = useMemo(() => {
    const rs = parseDateAny(visibleRange?.start);
    const re = parseDateAny(visibleRange?.end);
    if (!rs || !re) return [];

    // end é exclusivo → último dia visível é end-1ms
    const last = new Date(re.getTime() - 1);
    const days = daysBetweenInclusive(rs, last);

    return days.slice(0, 100);
  }, [visibleRange?.start, visibleRange?.end]);

  const rangeDayKeys = useMemo(() => rangeDays.map(toYmd), [rangeDays]);
  const rangeDaySet = useMemo(() => new Set(rangeDayKeys), [rangeDayKeys]);

  // =========================
  // Eventos dentro do range visível (charts/heatmap)
  // =========================
  const rangedEvents = useMemo(() => {
    const rs = parseDateAny(visibleRange?.start);
    const re = parseDateAny(visibleRange?.end);
    const list = Array.isArray(events) ? events : [];
    if (!rs || !re) return list;

    return list.filter((ev) => {
      const { start, end } = eventDate(ev);
      if (!start || !end) return false;

      const endInclusive = ev?.allDay ? new Date(end.getTime() - 1) : end;
      return eventOverlapsRange(start, endInclusive, rs, re);
    });
  }, [events, visibleRange?.start, visibleRange?.end]);

  const timelineEvents = useMemo(() => {
    const list = Array.isArray(events) ? events : [];

    const a = Number(tlVisible?.start);
    const b = Number(tlVisible?.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return list;

    const rs = new Date(a);
    const re = new Date(b); // end exclusivo

    return list.filter((ev) => {
      const { start, end } = eventDate(ev);
      if (!start || !end) return false;

      const endInclusive = ev?.allDay ? new Date(end.getTime() - 1) : end;
      return eventOverlapsRange(start, endInclusive, rs, re);
    });
  }, [events, tlVisible?.start, tlVisible?.end]);

  const hasChartData = rangedEvents.length > 0;
  const hasTimelineData = timelineEvents.length > 0;

  // =========================
  // Overdue: evento ultrapassa dueDate do ticket
  // =========================
  const isOverdueEvent = useMemo(() => {
    return (ev) => {
      const issueKey = getIssueKey(ev);
      if (!issueKey) return false;

      const due = dueIndex.get(issueKey);
      if (!due) return false;

      const { end } = eventDate(ev);
      if (!end) return false;

      const evEnd = ev?.allDay ? new Date(end.getTime() - 1) : end;
      return evEnd.getTime() > due.getTime();
    };
  }, [dueIndex]);

  const hasData = rangedEvents.length > 0;

  const rangeLabel = useMemo(() => {
    const a = visibleRange?.start ? toYmd(visibleRange.start) : "";
    const b = visibleRange?.end
      ? toYmd(new Date(parseDateAny(visibleRange.end).getTime() - 1))
      : "";
    if (!a || !b) return "—";
    return `${a} → ${b}`;
  }, [visibleRange?.start, visibleRange?.end]);

  // =========================
  // ✅ WORKLOAD (Recharts) - por dia
  // =========================
  const workloadDaily = useMemo(() => {
    const devSet = new Set();
    timelineEvents.forEach((ev) => devSet.add(getRecurso(ev)));
    const devs = Array.from(devSet).sort((a, b) =>
      String(a).localeCompare(String(b))
    );

    const devMeta = devs.map((dev, idx) => {
      const base = normalizeStr(dev).replace(/[^a-z0-9]+/g, "_") || "dev";
      const key = `${base}__${idx}`;
      return { dev, key, color: pickDevColor(dev) };
    });

    const devKeyByName = new Map(devMeta.map((x) => [x.dev, x.key]));

    const base = rangeDayKeys.map((day) => ({
      day,
      total: 0,
      overdueCount: 0,
      overdueTickets: [],
    }));

    const dayIndex = new Map(base.map((row, i) => [row.day, i]));
    const overdueByDay = new Map();

    for (const ev of rangedEvents) {
      const dev = getRecurso(ev);
      const devKey = devKeyByName.get(dev);
      if (!devKey) continue;

      const issueKey = getIssueKey(ev);
      const overdue = isOverdueEvent(ev);

      const dks = eventDayKeysInRange(ev, rangeDaySet);
      for (const dk of dks) {
        const i = dayIndex.get(dk);
        if (i == null) continue;

        base[i][devKey] = (base[i][devKey] || 0) + 1;
        base[i].total += 1;

        if (overdue && issueKey) {
          if (!overdueByDay.has(dk)) overdueByDay.set(dk, new Set());
          overdueByDay.get(dk).add(issueKey);
        }
      }
    }

    for (const row of base) {
      const set = overdueByDay.get(row.day);
      const arr = set ? Array.from(set.values()) : [];
      row.overdueCount = arr.length;
      row.overdueTickets = arr;
    }

    const maxTotal = base.reduce((acc, x) => Math.max(acc, x.total || 0), 0);

    return {
      data: base,
      devMeta,
      devKeyByName,
      maxTotal,
      devCount: devMeta.length,
    };
  }, [rangedEvents, rangeDayKeys, rangeDaySet, isOverdueEvent]);

  const capacityLine = useMemo(() => {
    const capPerDev = clampNumber(capacityActsPerDevPerDay, 1, 20);
    const devCount = Math.max(1, workloadDaily.devCount || 1);
    const capTeam = capPerDev * devCount;

    return {
      capPerDev,
      capTeam,
      label: `Capacidade/dia (time): ${capTeam} (${capPerDev}/dev)`,
    };
  }, [capacityActsPerDevPerDay, workloadDaily.devCount]);

  function WorkloadDailyTooltip({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null;

    const row = payload?.[0]?.payload || {};
    const overdueCount = row?.overdueCount || 0;

    const items = (workloadDaily.devMeta || [])
      .map((d) => ({ ...d, v: row[d.key] || 0 }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);

    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-sm">
        <div className="mb-1 text-sm font-semibold text-zinc-900">
          {fmtBrDay(label)}
        </div>

        <div className="grid gap-1 text-zinc-700">
          <div>
            <span className="font-semibold">Total:</span> {row.total || 0} ativ.
          </div>

          <div
            className={cn(
              "flex items-center gap-1",
              overdueCount ? "text-red-700" : "text-zinc-700"
            )}
          >
            <span className="font-semibold">Atrasos:</span> {overdueCount}
            {overdueCount ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
          </div>
        </div>

        {items.length > 0 && (
          <div className="mt-2 border-t border-zinc-200 pt-2">
            <div className="mb-1 text-[11px] font-semibold text-zinc-700">
              Por recurso:
            </div>
            <div className="grid gap-1">
              {items.slice(0, 6).map((it) => (
                <div
                  key={it.key}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ background: it.color }}
                    />
                    <span className="max-w-[160px] truncate">{it.dev}</span>
                  </div>
                  <div className="font-semibold text-zinc-900">{it.v}</div>
                </div>
              ))}
              {items.length > 6 && (
                <div className="text-[11px] text-zinc-500">
                  +{items.length - 6} outros
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================
  // ✅ HEATMAP (ApexCharts)
  // =========================
  const heatmap = useMemo(() => {
    const devSet = new Set();
    rangedEvents.forEach((ev) => devSet.add(getRecurso(ev)));
    const devs = Array.from(devSet).sort((a, b) =>
      String(a).localeCompare(String(b))
    );

    const matrix = new Map();
    const ensureCell = (dev, dayKey) => {
      if (!matrix.has(dev)) matrix.set(dev, new Map());
      const row = matrix.get(dev);
      if (!row.has(dayKey)) {
        row.set(dayKey, {
          value: 0,
          overdueTickets: new Set(),
          tickets: new Set(),
        });
      }
      return row.get(dayKey);
    };

    for (const ev of rangedEvents) {
      const dev = getRecurso(ev);
      const issueKey = getIssueKey(ev);

      const dayKeys = eventDayKeysInRange(ev, rangeDaySet);
      const overdue = isOverdueEvent(ev);

      for (const dk of dayKeys) {
        const cell = ensureCell(dev, dk);
        cell.value += 1;

        if (issueKey) {
          cell.tickets.add(issueKey);
          if (overdue) cell.overdueTickets.add(issueKey);
        }
      }
    }

    const series = devs.map((dev) => {
      const row = matrix.get(dev) || new Map();

      const data = rangeDayKeys.map((dk) => {
        const cell = row.get(dk) || {
          value: 0,
          overdueTickets: new Set(),
          tickets: new Set(),
        };

        const y = +Number(cell.value || 0).toFixed(0);
        const overdueTickets = Array.from(cell.overdueTickets.values());
        const hasOverdue = overdueTickets.length > 0 && y > 0;

        return {
          x: dk,
          y,
          ...(hasOverdue ? { fillColor: "#DC2626" } : {}),
          meta: {
            dev,
            day: dk,
            overdueTickets,
            ticketsCount: cell.tickets.size,
          },
        };
      });

      return { name: dev, data };
    });

    const maxY = series.reduce((acc, s) => {
      const mx = (s?.data || []).reduce((a, p) => Math.max(a, p?.y || 0), 0);
      return Math.max(acc, mx);
    }, 0);

    return { series, maxY, devs };
  }, [rangedEvents, rangeDayKeys, rangeDaySet, isOverdueEvent]);

  const apexOptions = useMemo(() => {
    const max = Math.max(1, heatmap.maxY || 1);

    const ranges = [
      { from: 0, to: 0, color: "#F4F4F5", name: "0" },
      {
        from: 0.000001,
        to: Math.max(1, max * 0.25),
        color: "#DBEAFE",
        name: "Baixo",
      },
      {
        from: Math.max(1, max * 0.25),
        to: Math.max(2, max * 0.5),
        color: "#93C5FD",
        name: "Médio",
      },
      {
        from: Math.max(2, max * 0.5),
        to: Math.max(3, max * 0.75),
        color: "#3B82F6",
        name: "Alto",
      },
      {
        from: Math.max(3, max * 0.75),
        to: 999,
        color: "#1D4ED8",
        name: "Muito alto",
      },
    ];

    return {
      chart: {
        type: "heatmap",
        toolbar: { show: false },
        animations: { enabled: false },
      },
      plotOptions: {
        heatmap: {
          shadeIntensity: 0.55,
          radius: 2,
          useFillColorAsStroke: false,
          colorScale: { ranges },
        },
      },
      dataLabels: { enabled: false },
      stroke: { width: 1, colors: ["#E4E4E7"] },
      xaxis: {
        type: "category",
        labels: {
          rotate: -45,
          style: { fontSize: "10px" },
          formatter: (v) => fmtBrDay(v),
        },
      },
      yaxis: { labels: { style: { fontSize: "11px" } } },
      tooltip: {
        custom: ({ seriesIndex, dataPointIndex, w }) => {
          const point =
            w?.config?.series?.[seriesIndex]?.data?.[dataPointIndex];
          if (!point) return "";

          const meta = point.meta || {};
          const overdueTickets = Array.isArray(meta.overdueTickets)
            ? meta.overdueTickets
            : [];
          const { items, rest } = shortList(overdueTickets, 3);

          const overdueHtml =
            overdueTickets.length > 0
              ? `
                <div style="margin-top:6px; padding-top:6px; border-top:1px solid #E4E4E7;">
                  <div style="font-weight:700; color:#B91C1C;">⚠ Atrasado</div>
                  <div style="font-size:11px; color:#7F1D1D;">
                    ${items.join(", ")}${rest ? ` (+${rest})` : ""}
                  </div>
                </div>
              `
              : "";

          return `
            <div style="padding:10px; background:#fff; border:1px solid #E4E4E7; border-radius:12px; box-shadow:0 4px 14px rgba(0,0,0,.08); min-width:220px;">
              <div style="font-weight:700; color:#111827; font-size:13px;">${
                meta.dev || "—"
              }</div>
              <div style="color:#6B7280; font-size:11px;">${fmtBrDay(
                meta.day || ""
              )}</div>
              <div style="margin-top:6px; color:#111827; font-size:12px;">
                <span style="font-weight:700;">Carga:</span> ${
                  point.y || 0
                } ativ.
              </div>
              <div style="color:#374151; font-size:11px; margin-top:4px;">
                <span style="font-weight:700;">Tickets (dia):</span> ${
                  meta.ticketsCount || 0
                }
              </div>
              ${overdueHtml}
            </div>
          `;
        },
      },
      legend: { show: false },
    };
  }, [heatmap.maxY]);

  // =========================
  // ✅ TIMELINE (react-calendar-timeline)
  // =========================
  const timelineModel = useMemo(() => {
    // lista de devs do range
    const devSet = new Set();
    rangedEvents.forEach((ev) => devSet.add(getRecurso(ev)));
    const devs = Array.from(devSet).sort((a, b) =>
      String(a).localeCompare(String(b))
    );

    // map dev -> groupId estável
    const groupsAll = devs.map((dev, idx) => ({
      id: `${normalizeStr(dev).replace(/[^a-z0-9]+/g, "_") || "dev"}__${idx}`,
      title: dev,
      _dev: dev,
    }));
    const groupIdByDev = new Map(groupsAll.map((g) => [g._dev, g.id]));

    // aplica filtro multi-select (se tocado)
    const isDevSelected = (dev) => {
      if (!hasTouchedDevFilter) return true;
      return selectedDevSet.has(dev);
    };

    const groups = groupsAll.filter((g) => isDevSelected(g._dev));
    const selectedCount = hasTouchedDevFilter
      ? selectedDevSet.size
      : devs.length;

    // items
    const items = timelineEvents
      .filter((ev) => isDevSelected(getRecurso(ev)))
      .map((ev, idx) => {
        const dev = getRecurso(ev);
        const group = groupIdByDev.get(dev);
        if (!group) return null;

        const issueKey = getIssueKey(ev);
        const activityId = getActivityId(ev);
        const activityLabel = ATIVIDADE_LABEL_BY_ID[activityId] || activityId;

        const { start, end } = eventDate(ev);
        if (!start || !end) return null;

        const startMs = start.getTime();
        let endMs = end.getTime();

        // proteção (end precisa ser > start)
        if (endMs <= startMs) endMs = startMs + 24 * 60 * 60 * 1000;

        // ✅ ID ÚNICO (ev.id pode repetir entre atividades)
        const safeId = `${getIssueKey(ev) || "no"}_${getActivityId(
          ev
        )}_${startMs}_${endMs}_${idx}`;

        const baseColor =
          ATIVIDADE_COLOR_BY_ID[activityId] || ATIVIDADE_COLOR_BY_ID.other;
        const overdue = isOverdueEvent(ev);

        // gradient do atraso (a partir do dia seguinte ao dueDate)
        let backgroundImage = undefined;
        if (overdue && issueKey) {
          const due = dueIndex.get(issueKey);
          if (due) {
            const cutoff = startOfDay(
              new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1)
            );
            const cutoffMs = cutoff?.getTime();

            const sDay = startOfDay(start)?.getTime() ?? startMs;
            const eDay = startOfDay(new Date(endMs))?.getTime() ?? endMs;

            if (cutoffMs && eDay > sDay && cutoffMs > sDay && cutoffMs < eDay) {
              const pct = clampNumber(
                ((cutoffMs - sDay) / (eDay - sDay)) * 100,
                0,
                100
              );
              backgroundImage = `linear-gradient(90deg, ${baseColor} 0%, ${baseColor} ${pct}%, #DC2626 ${pct}%, #DC2626 100%)`;
            }
          }
        }

        const titleParts = [];
        if (issueKey) titleParts.push(issueKey);
        titleParts.push(activityLabel);

        return {
          id: String(ev?.id ?? safeId),
          group,
          title: titleParts.join(" • "),
          start_time: startMs,
          end_time: endMs,
          canMove: false,
          canResize: false,
          itemProps: {
            style: {
              backgroundColor: backgroundImage ? "transparent" : baseColor,
              backgroundImage,
              color: "#fff",
              border: `1px solid ${overdue ? "#DC2626" : baseColor}`,
              borderRadius: 12,
              boxShadow: "0 2px 10px rgba(0,0,0,.08)",
              overflow: "hidden",
            },
          },
          _meta: {
            dev,
            issueKey,
            activityLabel,
            activityId,
            overdue,
            startMs,
            endMs,
          },
        };
      })
      .filter(Boolean);

    return { devs, groupsAll, groups, items, selectedCount };
  }, [
    timelineEvents,
    isOverdueEvent,
    dueIndex,
    hasTouchedDevFilter,
    selectedDevSet,
  ]);

  useEffect(() => {
    const rs = parseDateAny(visibleRange?.start);
    const re = parseDateAny(visibleRange?.end);
    if (!rs || !re) return;

    const a = rs.getTime();
    const b = re.getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return;

    setTlVisible((prev) =>
      prev.start === a && prev.end === b ? prev : { start: a, end: b }
    );
  }, [visibleRange?.start, visibleRange?.end]);

  const toggleDev = useCallback(
    (dev) => {
      setHasTouchedDevFilter(true);
      setSelectedDevSet((prev) => {
        const base = hasTouchedDevFilter
          ? prev
          : new Set(timelineModel.devs || []);
        const next = new Set(base);
        if (next.has(dev)) next.delete(dev);
        else next.add(dev);
        return next;
      });
    },
    [hasTouchedDevFilter, timelineModel.devs]
  );

  const selectAllDevs = useCallback(() => {
    setHasTouchedDevFilter(true);
    setSelectedDevSet(new Set(timelineModel.devs || []));
  }, [timelineModel.devs]);

  const clearAllDevs = useCallback(() => {
    setHasTouchedDevFilter(true);
    setSelectedDevSet(new Set());
  }, []);

  const DAY_MS = 24 * 60 * 60 * 1000;

  const setTimelineDays = useCallback((days, anchor = "start") => {
    setTlVisible((prev) => {
      const baseStart =
        anchor === "today"
          ? startOfDay(new Date())?.getTime() ?? Date.now()
          : prev.start;

      const start = baseStart;
      const end = start + days * DAY_MS;

      return prev.start === start && prev.end === end ? prev : { start, end };
    });
  }, []);

  const goToday = useCallback(() => {
    setTimelineDays(30, "today"); // "Hoje" joga para o mês atual (ajuste se quiser semana)
  }, [setTimelineDays]);

  // Legend formatter (workload daily)
  const devNameByKey = useMemo(() => {
    const m = new Map();
    (workloadDaily.devMeta || []).forEach((d) => m.set(d.key, d.dev));
    return m;
  }, [workloadDaily.devMeta]);

  // =========================
  // UI
  // =========================
  return (
    <TooltipProvider>
      <div className="mt-4 grid gap-3">
        {/* =========================
            PRIMEIRA LINHA (2 cards)
        ========================= */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* WORKLOAD */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-zinc-900">
                  Carga de Trabalho (Capacidade diária)
                </div>
                <div className="text-xs text-zinc-500">
                  Período visível:{" "}
                  <span className="font-medium">{rangeLabel}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                      {capacityLine.label}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    Linha vermelha = capacidade diária do time (capacidade/dev ×
                    nº de devs).
                  </TooltipContent>
                </Tooltip>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">Capacidade/dev</span>
                  <Input
                    type="number"
                    value={capacityActsPerDevPerDay}
                    onChange={(e) =>
                      setCapacityActsPerDevPerDay(e.target.value)
                    }
                    className="h-9 w-20 rounded-xl border-zinc-200 bg-white text-xs focus-visible:ring-red-500"
                    min={1}
                  />
                </div>
              </div>
            </div>

            <div ref={workloadRef} className="mt-3 h-[300px] min-w-0 w-full">
              {!hasChartData ? (
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-600">
                  Sem dados para o período selecionado.
                </div>
              ) : workloadSize.w > 0 && workloadSize.h > 0 ? (
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  minHeight={0}
                >
                  <BarChart
                    data={workloadDaily.data}
                    margin={{ left: 10, right: 10, top: 8, bottom: 6 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11 }}
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={50}
                      tickFormatter={(v) => fmtBrDay(v)}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      label={{
                        value: "Atividades",
                        angle: -90,
                        position: "insideLeft",
                        offset: 0,
                        style: { fontSize: 11 },
                      }}
                    />
                    <ReTooltip content={<WorkloadDailyTooltip />} />
                    <Legend
                      formatter={(k) =>
                        devNameByKey.get(String(k)) || String(k)
                      }
                    />
                    <ReferenceLine
                      y={capacityLine.capTeam}
                      stroke="#DC2626"
                      strokeDasharray="5 5"
                      ifOverflow="extendDomain"
                    />
                    {(workloadDaily.devMeta || []).map((d) => (
                      <Bar
                        key={d.key}
                        dataKey={d.key}
                        stackId="devs"
                        fill={d.color}
                        isAnimationActive={false}
                        radius={[6, 6, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-600">
                  Carregando gráfico…
                </div>
              )}
            </div>

            <div className="mt-2 text-xs text-zinc-600">
              Cada atividade conta{" "}
              <span className="font-semibold">1 por dia</span>.
            </div>
          </div>

          {/* HEATMAP */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-zinc-900">
                  Matriz de Alocação (Heatmap)
                </div>
                <div className="text-xs text-zinc-500">
                  Linhas: desenvolvedores • Colunas: dias • Intensidade:{" "}
                  <span className="font-medium">atividades</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: "#DC2626" }}
                  />
                  Atraso (ultrapassa dueDate)
                </Badge>
              </div>
            </div>

            <div className="mt-3">
              {!hasTimelineData ? (
                <div className="grid h-[320px] place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-600">
                  Sem dados para o período selecionado.
                </div>
              ) : (
                <div className="rounded-xl border border-zinc-200 p-2">
                  <ReactApexChart
                    type="heatmap"
                    options={apexOptions}
                    series={heatmap.series}
                    height={320}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* =========================
            SEGUNDA LINHA (Timeline de Recursos)
        ========================= */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-zinc-900">
                Timeline de Recursos
              </div>
              <div className="text-xs text-zinc-500">
                Visualização por recurso usando{" "}
                <span className="font-medium">react-calendar-timeline</span> •
                cores por tipo de atividade
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={goToday}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => setTimelineDays(7)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
              >
                Semana
              </button>
              <button
                type="button"
                onClick={() => setTimelineDays(30)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
              >
                Mês
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {Object.keys(ATIVIDADE_LABEL_BY_ID).map((id) => (
                <Badge
                  key={id}
                  className="rounded-full border border-zinc-200 bg-white text-zinc-700"
                  title={ATIVIDADE_LABEL_BY_ID[id]}
                >
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: ATIVIDADE_COLOR_BY_ID[id] || "#64748B",
                    }}
                  />
                  <span className="max-w-[180px] truncate">
                    {ATIVIDADE_LABEL_BY_ID[id] || id}
                  </span>
                </Badge>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
            {/* Timeline */}
            <div className="overflow-x-auto">
              {!hasData ? (
                <div className="grid h-[360px] place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-600">
                  Sem dados para o período selecionado.
                </div>
              ) : timelineModel.groups.length === 0 ? (
                <div className="grid h-[360px] place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-600">
                  Nenhum recurso selecionado.
                </div>
              ) : (
                <div className="min-w-[900px] rounded-xl border border-zinc-200 p-2">
                  <Timeline
                    groups={timelineModel.groups}
                    items={timelineModel.items}
                    visibleTimeStart={tlVisible.start}
                    visibleTimeEnd={tlVisible.end}
                    onTimeChange={(start, end, updateScrollCanvas) => {
                      if (typeof updateScrollCanvas === "function")
                        updateScrollCanvas(start, end);
                      setTlVisible((prev) =>
                        prev.start === start && prev.end === end
                          ? prev
                          : { start, end }
                      );
                    }}
                    sidebarWidth={240}
                    lineHeight={52}
                    itemHeightRatio={0.72}
                    stackItems
                    canMove={false}
                    canResize={false}
                    timeSteps={{ day: 1, month: 1, year: 1 }}
                    itemRenderer={({ item, itemContext, getItemProps }) => {
                      const meta = item?._meta || {};
                      const overdue = !!meta.overdue;
                      const dev = meta.dev || "";

                      const props = getItemProps({
                        style: {
                          ...(item?.itemProps?.style || {}),
                          opacity: itemContext.selected ? 0.95 : 1,
                        },
                        title: `${item.title}${dev ? ` — ${dev}` : ""}`,
                      });

                      const { key, ...rest } = props;

                      return (
                        <div key={key} {...rest}>
                          <div className="flex h-full items-center gap-2 px-2">
                            {overdue ? (
                              <span className="text-[11px]">⚠</span>
                            ) : null}
                            <span className="truncate text-[12px] font-medium">
                              {item.title}
                            </span>
                            {dev ? (
                              <span className="ml-auto hidden max-w-[160px] truncate text-[11px] text-white/80 lg:inline">
                                {dev}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>
              )}
            </div>

            {/* Lista de recursos (direita) com multi-select por clique */}
            <div className="rounded-xl border border-zinc-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-zinc-900">
                    Recursos
                  </div>
                  <div className="text-xs text-zinc-500">
                    Selecionados:{" "}
                    <span className="font-medium">
                      {hasTouchedDevFilter
                        ? selectedDevSet.size
                        : timelineModel.devs.length}
                    </span>
                    {" / "}
                    <span className="font-medium">
                      {timelineModel.devs.length}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllDevs}
                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    onClick={clearAllDevs}
                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                  >
                    Limpar
                  </button>
                </div>
              </div>

              <div className="max-h-[320px] overflow-auto pr-1">
                <div className="grid gap-1">
                  {timelineModel.devs.map((dev) => {
                    const active = hasTouchedDevFilter
                      ? selectedDevSet.has(dev)
                      : true;
                    const color = pickDevColor(dev);

                    return (
                      <button
                        key={dev}
                        type="button"
                        onClick={() => toggleDev(dev)}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-xl border px-2 py-2 text-left text-xs transition",
                          active
                            ? "border-zinc-200 bg-white hover:bg-zinc-50"
                            : "border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100"
                        )}
                        title="Clique para alternar"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn("h-2.5 w-2.5 rounded-sm")}
                            style={{ background: active ? color : "#D4D4D8" }}
                          />
                          <span className="max-w-[200px] truncate">{dev}</span>
                        </div>
                        <span
                          className={cn(
                            "text-[11px]",
                            active ? "text-zinc-700" : "text-zinc-400"
                          )}
                        >
                          {active ? "ON" : "OFF"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 text-xs text-zinc-600">
                Clique em um recurso para{" "}
                <span className="font-semibold">habilitar/desabilitar</span>.
              </div>
            </div>
          </div>

          <div className="mt-2 text-xs text-zinc-600">
            Bordas em vermelho indicam atividades que ultrapassam o{" "}
            <span className="font-semibold">Data Limite</span> do ticket.
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
});
