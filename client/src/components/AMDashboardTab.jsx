// src/components/AMDashboardTab.jsx
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  GripVertical,
  Plus,
  Trash2,
  Settings2,
  Lock,
  Unlock,
  RotateCcw,
  LayoutDashboard,
  BarChart3,
  PieChart as PieChartIcon,
  LineChart as LineChartIcon,
  AreaChart as AreaChartIcon,
  Gauge,
} from "lucide-react";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  PieChart,
  Pie,
  LineChart,
  Line,
  AreaChart,
  Area,
} from "recharts";

import { Cell } from "recharts";

import RGL, { Responsive } from "react-grid-layout";

const WidthProvider = RGL.WidthProvider;
// O seu código abaixo já faz a verificação de segurança, então pode manter:
const ResponsiveGridLayout =
  typeof WidthProvider === "function" ? WidthProvider(Responsive) : Responsive;

import "/node_modules/react-grid-layout/css/styles.css";
import "/node_modules/react-resizable/css/styles.css";

function cn(...a) {
  return a.filter(Boolean).join(" ");
}

const LS_KEY = "am_dashboard_layout_v1";

function uid(prefix = "w") {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }
}

/* =========================
   Datas / helpers
========================= */
function extractYmd(v) {
  if (!v) return "";
  if (typeof v === "string") {
    const ymd = v.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "object") {
    const candidate =
      v?.value ||
      v?.date ||
      v?.start ||
      v?.end ||
      v?.startDate ||
      v?.endDate ||
      v?.from ||
      v?.to ||
      "";
    const ymd = String(candidate).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
  }
  const ymd = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
}

function parseIsoYmdLocal(ymd) {
  const s = String(ymd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function startOfTodayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function diffDays(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function fmtShortBRFromYmd(ymd) {
  const dt = parseIsoYmdLocal(ymd);
  if (!dt) return ymd;
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function isDoneStatus(statusName) {
  const s = String(statusName || "").toUpperCase();
  return /(DONE|CONCLU|RESOLV|CLOSED|FECHAD)/i.test(s);
}

function toNamesArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        typeof x === "string" ? x : x?.value || x?.name || x?.label || ""
      )
      .map((s) => String(s).trim())
      .filter(Boolean);
  }
  if (typeof v === "string") return [v.trim()].filter(Boolean);
  if (typeof v === "object") {
    const one = v?.value || v?.name || v?.label || "";
    return [String(one).trim()].filter(Boolean);
  }
  return [String(v)].filter(Boolean);
}

function hasCronogramaField(v) {
  if (!v) return false;

  if (typeof v === "string") {
    const t = v.trim();
    return Boolean(t && t !== "—");
  }

  if (typeof v === "object") {
    // ADF padrão do Jira
    const content = v?.content;
    if (Array.isArray(content) && content.length > 0) return true;

    // fallback: objeto “grande o suficiente”
    try {
      const s = JSON.stringify(v);
      return s.length > 40;
    } catch {
      return true;
    }
  }

  return true;
}

function topN(items, n = 10) {
  return [...(items || [])].sort((a, b) => b.value - a.value).slice(0, n);
}

function countBy(list, getKey) {
  const m = new Map();
  for (const item of list) {
    const k = String(getKey(item) || "").trim() || "—";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
}

function buildLastNDaysSeries(list, getYmd, nDays = 30) {
  const today0 = startOfTodayLocal();
  const days = [];

  for (let i = nDays - 1; i >= 0; i--) {
    const dt = new Date(today0);
    dt.setDate(dt.getDate() - i);
    const ymd = extractYmd(dt);
    days.push(ymd);
  }

  const m = new Map(days.map((d) => [d, 0]));

  for (const item of list) {
    const ymd = extractYmd(getYmd(item));
    if (ymd && m.has(ymd)) m.set(ymd, (m.get(ymd) || 0) + 1);
  }

  return days.map((ymd) => ({
    date: fmtShortBRFromYmd(ymd),
    value: m.get(ymd) || 0,
  }));
}

/* =========================
   Catálogo de métricas/widgets
========================= */
const METRICS = [
  {
    metric: "priority",
    title: "Prioridade do ticket",
    subtitle: "Quantidade por prioridade",
    defaultViz: "bar",
    allowedViz: ["bar", "donut", "pie"],
  },
  {
    metric: "size",
    title: "Tamanho do ticket",
    subtitle: "Distribuição por tamanho",
    defaultViz: "pie",
    allowedViz: ["pie", "donut", "bar"],
  },
  {
    metric: "createdPerDay",
    title: "Criados por dia",
    subtitle: "Últimos 30 dias",
    defaultViz: "line",
    allowedViz: ["line", "area"],
  },
  {
    metric: "updatedPerDay",
    title: "Atualizados por dia",
    subtitle: "Últimos 30 dias",
    defaultViz: "area",
    allowedViz: ["area", "line"],
  },
  {
    metric: "owner",
    title: "Tickets por responsável",
    subtitle: "Top responsáveis",
    defaultViz: "bar",
    allowedViz: ["bar", "donut", "pie"],
  },
  {
    metric: "status",
    title: "Distribuição por status",
    subtitle: "Quantidade por status",
    defaultViz: "bar",
    allowedViz: ["bar", "donut", "pie"],
  },
  {
    metric: "sla",
    title: "Dentro do prazo vs Estourados",
    subtitle: "SLA por data limite (original/alterada)",
    defaultViz: "stack",
    allowedViz: ["stack", "donut", "bar"],
  },
  {
    metric: "aging",
    title: "Aging (idade do ticket)",
    subtitle: "Faixas de dias desde criação",
    defaultViz: "bar",
    allowedViz: ["bar"],
  },
  {
    metric: "components",
    title: "Componentes",
    subtitle: "Top componentes",
    defaultViz: "bar",
    allowedViz: ["bar", "donut", "pie"],
  },
  {
    metric: "directorates",
    title: "Diretorias",
    subtitle: "Top diretorias",
    defaultViz: "bar",
    allowedViz: ["bar", "donut", "pie"],
  },
  {
    metric: "noAssignee",
    title: "Sem responsável",
    subtitle: "Tickets sem assignee",
    defaultViz: "kpi",
    allowedViz: ["kpi", "donut"],
  },
  {
    metric: "noSchedule",
    title: "Sem cronograma",
    subtitle: "Tickets sem customfield_14017",
    defaultViz: "kpi",
    allowedViz: ["kpi", "donut"],
  },
];

const VIZ_LABEL = {
  bar: "Barras",
  pie: "Pizza",
  donut: "Donut",
  line: "Linha",
  area: "Área",
  stack: "Barras empilhadas",
  kpi: "KPI",
};

const VIZ_ICON = {
  bar: BarChart3,
  pie: PieChartIcon,
  donut: PieChartIcon,
  line: LineChartIcon,
  area: AreaChartIcon,
  stack: BarChart3,
  kpi: Gauge,
};

const CHART_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#0f172a",
  "#a21caf",
  "#65a30d",
];

function metricDef(metricKey) {
  return METRICS.find((m) => m.metric === metricKey) || null;
}

/* =========================
   Layout padrão (12 colunas no lg)
========================= */
function buildDefaultConfig() {
  // Widgets padrão (>= 8)
  const widgets = [
    { id: uid("w"), metric: "createdPerDay", viz: "line" },
    { id: uid("w"), metric: "updatedPerDay", viz: "area" },
    { id: uid("w"), metric: "priority", viz: "bar" },
    { id: uid("w"), metric: "status", viz: "bar" },
    { id: uid("w"), metric: "owner", viz: "bar" },
    { id: uid("w"), metric: "sla", viz: "stack" },
    { id: uid("w"), metric: "size", viz: "donut" },
    { id: uid("w"), metric: "aging", viz: "bar" },
    { id: uid("w"), metric: "components", viz: "bar" },
    { id: uid("w"), metric: "directorates", viz: "bar" },
    { id: uid("w"), metric: "noAssignee", viz: "kpi" },
    { id: uid("w"), metric: "noSchedule", viz: "kpi" },
  ];

  // Tamanhos:
  // - grandes (linhas/áreas): 6x4
  // - médios (barras/pizza): 4x4 ou 3x4
  // - kpi: 3x3
  const lg = [
    { i: widgets[0].id, x: 0, y: 0, w: 6, h: 4 },
    { i: widgets[1].id, x: 6, y: 0, w: 6, h: 4 },

    { i: widgets[2].id, x: 0, y: 4, w: 4, h: 4 },
    { i: widgets[3].id, x: 4, y: 4, w: 4, h: 4 },
    { i: widgets[4].id, x: 8, y: 4, w: 4, h: 4 },

    { i: widgets[5].id, x: 0, y: 8, w: 6, h: 4 },
    { i: widgets[6].id, x: 6, y: 8, w: 3, h: 4 },
    { i: widgets[7].id, x: 9, y: 8, w: 3, h: 4 },

    { i: widgets[8].id, x: 0, y: 12, w: 6, h: 4 },
    { i: widgets[9].id, x: 6, y: 12, w: 6, h: 4 },

    { i: widgets[10].id, x: 0, y: 16, w: 3, h: 3 },
    { i: widgets[11].id, x: 3, y: 16, w: 3, h: 3 },
  ];

  // “Degrada” automaticamente para breakpoints menores
  const makeSmaller = (cols) =>
    lg.map((it) => ({
      ...it,
      x: Math.min(it.x, cols - 1),
      w: Math.min(it.w, cols),
    }));

  return {
    widgets,
    layouts: {
      lg,
      md: makeSmaller(10),
      sm: makeSmaller(6),
      xs: makeSmaller(4),
      xxs: makeSmaller(2),
    },
  };
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.widgets) || typeof parsed.layouts !== "object")
      return null;

    // Validação mínima
    const widgets = parsed.widgets
      .filter((w) => w && w.id && w.metric)
      .map((w) => ({
        id: String(w.id),
        metric: String(w.metric),
        viz: String(w.viz || metricDef(w.metric)?.defaultViz || "bar"),
      }));

    const layouts = parsed.layouts || {};
    return { widgets, layouts };
  } catch {
    return null;
  }
}

function saveToStorage(payload) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {}
}

/* =========================
   Component
========================= */
export default function AMDashboardTab({ rows = [], loading = false }) {
  const [editMode, setEditMode] = useState(false);

  const defaultConfig = useMemo(() => buildDefaultConfig(), []);
  const [widgets, setWidgets] = useState(defaultConfig.widgets);
  const [layouts, setLayouts] = useState(defaultConfig.layouts);

  const [ready, setReady] = useState(false);
  const hydratedRef = useRef(false);

  // espera 1 frame pro layout existir (evita warning do recharts)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Carrega persistido (1x) - só depois do ready
  useEffect(() => {
    if (!ready) return;

    const stored = loadFromStorage();
    if (stored) {
      setWidgets(stored.widgets);
      setLayouts(stored.layouts);
    }

    hydratedRef.current = true;
  }, [ready]);

  // Persistência - só depois de hidratar
  useEffect(() => {
    if (!ready) return;
    if (!hydratedRef.current) return;

    saveToStorage({ widgets, layouts });
  }, [ready, widgets, layouts]);

  const normalized = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    return list.map((t) => {
      const f = t?.fields || {};
      const priority = t?.priorityName || f?.priority?.name || "Não informado";

      const sizeRaw = f?.customfield_10988;
      const size =
        t?.sizeValue ||
        f?.customfield_10988?.value ||
        f?.customfield_10988?.name ||
        "Não informado";

      const created = f?.created || t?.createdRaw || t?.created || "";
      const updated = f?.updated || t?.updatedRaw || t?.updated || "";

      const status = f?.status?.name || t?.statusName || t?.status?.name || "—";

      const owner =
        f?.assignee?.displayName || t?.assignee || "Sem responsável";

      const dueBaseYmd = extractYmd(f?.duedate || t?.duedate || t?.dueDateRaw);
      const dueAltYmd = extractYmd(
        f?.customfield_11519 || t?.customfield_11519
      );

      const dueBaseDate = parseIsoYmdLocal(dueBaseYmd);
      const dueAltDate = parseIsoYmdLocal(dueAltYmd);

      const hasDueAlt = Boolean(dueAltDate);
      const effectiveDueDate = dueAltDate || dueBaseDate;

      const components = Array.isArray(f?.components)
        ? f.components.map((c) => c?.name).filter(Boolean)
        : [];

      const directorias = toNamesArray(f?.customfield_11520);

      const hasSchedule = hasCronogramaField(f?.customfield_14017);

      //console.log(rows[0]);

      return {
        _raw: t,
        key: t?.key || "",
        priority,
        size,
        created,
        updated,
        status,
        owner,
        dueBaseYmd,
        dueAltYmd,
        hasDueAlt,
        effectiveDueDate,
        components,
        directorias,
        hasSchedule,
        done: isDoneStatus(status),
      };
    });
  }, [rows]);

  const dashData = useMemo(() => {
    const list = normalized;

    // Prioridade (ordem amigável)
    const priorityOrder = new Map([
      ["HIGHEST", 1],
      ["HIGH", 2],
      ["MEDIUM", 3],
      ["LOW", 4],
      ["LOWEST", 5],
    ]);

    const priorityCounts = countBy(list, (x) => x.priority).sort((a, b) => {
      const pa = priorityOrder.get(String(a.name || "").toUpperCase()) || 99;
      const pb = priorityOrder.get(String(b.name || "").toUpperCase()) || 99;
      if (pa !== pb) return pa - pb;
      return b.value - a.value;
    });

    const sizeCounts = countBy(list, (x) => x.size).sort(
      (a, b) => b.value - a.value
    );

    const statusCounts = countBy(list, (x) => x.status).sort(
      (a, b) => b.value - a.value
    );

    const ownerCounts = topN(
      countBy(list, (x) => x.owner).sort((a, b) => b.value - a.value),
      12
    );

    const createdSeries = buildLastNDaysSeries(list, (x) => x.created, 30);
    const updatedSeries = buildLastNDaysSeries(list, (x) => x.updated, 30);

    // SLA
    const today0 = startOfTodayLocal();

    let inside = 0;
    let overdueBase = 0;
    let overdueAlt = 0;
    let noDue = 0;
    let done = 0;

    for (const t of list) {
      if (t.done) {
        done++;
        continue;
      }

      if (!t.effectiveDueDate) {
        noDue++;
        continue;
      }

      if (t.effectiveDueDate.getTime() < today0.getTime()) {
        if (t.hasDueAlt) overdueAlt++;
        else overdueBase++;
      } else {
        inside++;
      }
    }

    const slaPie = [
      { name: "Dentro do prazo", value: inside },
      { name: "Data limite estourada", value: overdueBase },
      { name: "Data limite alterada estourada", value: overdueAlt },
      { name: "Sem data limite", value: noDue },
      { name: "Concluídos", value: done },
    ].filter((x) => x.value > 0);

    const slaStack = [
      {
        name: "SLA",
        dentro: inside,
        estourada: overdueBase,
        alterada: overdueAlt,
        semData: noDue,
        concluidos: done,
      },
    ];

    // Aging buckets
    const aging = new Map([
      ["0-2d", 0],
      ["3-7d", 0],
      ["8-14d", 0],
      ["15-30d", 0],
      ["30+d", 0],
    ]);

    for (const t of list) {
      const ymd = extractYmd(t.created);
      const d = parseIsoYmdLocal(ymd);
      if (!d) continue;

      const age = Math.max(0, diffDays(today0, d));
      if (age <= 2) aging.set("0-2d", aging.get("0-2d") + 1);
      else if (age <= 7) aging.set("3-7d", aging.get("3-7d") + 1);
      else if (age <= 14) aging.set("8-14d", aging.get("8-14d") + 1);
      else if (age <= 30) aging.set("15-30d", aging.get("15-30d") + 1);
      else aging.set("30+d", aging.get("30+d") + 1);
    }

    const agingCounts = Array.from(aging.entries()).map(([name, value]) => ({
      name,
      value,
    }));

    // Componentes
    const componentsAll = [];
    for (const t of list) for (const c of t.components) componentsAll.push(c);

    const componentsCounts = topN(
      countBy(componentsAll, (x) => x),
      12
    );

    // Diretorias
    const dirsAll = [];
    for (const t of list) {
      const dirs = Array.isArray(t?.diretorias) ? t.diretorias : [];
      for (const d of dirs) dirsAll.push(d);
    }

    const directoratesCounts = topN(
      countBy(dirsAll, (x) => x),
      12
    );

    // KPIs
    const noAssigneeCount = list.filter(
      (t) => String(t.owner || "").toLowerCase() === "sem responsável"
    ).length;

    const noScheduleCount = list.filter((t) => !t.hasSchedule).length;

    return {
      priorityCounts,
      sizeCounts,
      statusCounts,
      ownerCounts,
      createdSeries,
      updatedSeries,
      slaPie,
      slaStack,
      agingCounts,
      componentsCounts,
      directoratesCounts,
      kpis: {
        total: list.length,
        noAssigneeCount,
        noScheduleCount,
        overdueCount: overdueBase + overdueAlt,
      },
    };
  }, [normalized]);

  const addWidget = useCallback(() => {
    // adiciona “um padrão”: próximo gráfico ainda não usado, senão prioridade
    const used = new Set(widgets.map((w) => w.metric));
    const candidate = METRICS.find((m) => !used.has(m.metric)) || METRICS[0];

    const def = metricDef(candidate.metric);
    const next = {
      id: uid("w"),
      metric: candidate.metric,
      viz: def?.defaultViz || "bar",
    };

    setWidgets((prev) => [...prev, next]);

    // coloca no final em cada breakpoint
    setLayouts((prev) => {
      const nextLayouts = { ...(prev || {}) };

      for (const bp of Object.keys(nextLayouts)) {
        const l = Array.isArray(nextLayouts[bp]) ? nextLayouts[bp] : [];
        nextLayouts[bp] = [...l, { i: next.id, x: 0, y: Infinity, w: 4, h: 4 }];
      }

      return nextLayouts;
    });
  }, [widgets]);

  const addWidgetByMetric = useCallback((metricKey) => {
    const def = metricDef(metricKey);
    const next = {
      id: uid("w"),
      metric: metricKey,
      viz: def?.defaultViz || "bar",
    };

    setWidgets((prev) => [...prev, next]);

    setLayouts((prev) => {
      const nextLayouts = { ...(prev || {}) };

      for (const bp of Object.keys(nextLayouts)) {
        const l = Array.isArray(nextLayouts[bp]) ? nextLayouts[bp] : [];
        let w = 4;
        let h = 4;

        if (next.viz === "kpi") {
          w = 3;
          h = 3;
        } else if (next.viz === "line" || next.viz === "area") {
          w = 6;
          h = 4;
        }

        nextLayouts[bp] = [...l, { i: next.id, x: 0, y: Infinity, w, h }];
      }

      return nextLayouts;
    });
  }, []);

  const removeWidget = useCallback((id) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
    setLayouts((prev) => {
      const next = { ...(prev || {}) };
      for (const bp of Object.keys(next)) {
        next[bp] = (next[bp] || []).filter((l) => l.i !== id);
      }
      return next;
    });
  }, []);

  const changeWidgetViz = useCallback((id, viz) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, viz } : w)));
  }, []);

  const changeWidgetMetric = useCallback((id, metricKey) => {
    const def = metricDef(metricKey);
    setWidgets((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        return {
          ...w,
          metric: metricKey,
          viz: def?.defaultViz || "bar",
        };
      })
    );
  }, []);

  const resetLayout = useCallback(() => {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
    const fresh = buildDefaultConfig();
    setWidgets(fresh.widgets);
    setLayouts(fresh.layouts);
  }, []);

  const onLayoutChange = useCallback((_, allLayouts) => {
    setLayouts(allLayouts);
  }, []);

  const isBusy = Boolean(loading);

  return (
    <TooltipProvider>
      <div className="grid gap-4">
        {/* Header / actions */}
        <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-red-600 to-red-700 text-white shadow-sm">
                  <LayoutDashboard className="h-5 w-5" />
                </div>

                <div className="min-w-0">
                  <CardTitle className="text-base">
                    Dashboard de Tickets
                  </CardTitle>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                      Total: {dashData?.kpis?.total ?? 0}
                    </Badge>
                    <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                      Atrasados: {dashData?.kpis?.overdueCount ?? 0}
                    </Badge>
                    <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                      Sem responsável: {dashData?.kpis?.noAssigneeCount ?? 0}
                    </Badge>
                    <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                      Sem cronograma: {dashData?.kpis?.noScheduleCount ?? 0}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      className="rounded-xl border-zinc-200 bg-white"
                      onClick={() => setEditMode((v) => !v)}
                    >
                      {editMode ? (
                        <Unlock className="mr-2 h-4 w-4" />
                      ) : (
                        <Lock className="mr-2 h-4 w-4" />
                      )}
                      {editMode ? "Edit mode ON" : "Edit mode OFF"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="rounded-xl">
                    {editMode
                      ? "Arraste e redimensione widgets"
                      : "Bloqueado (sem drag/resize)"}
                  </TooltipContent>
                </Tooltip>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="rounded-xl bg-red-600 text-white hover:bg-red-700"
                      disabled={isBusy}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Adicionar gráfico
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuLabel>Widgets disponíveis</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {METRICS.map((m) => (
                      <DropdownMenuItem
                        key={m.metric}
                        onClick={() => addWidgetByMetric(m.metric)}
                        className="cursor-pointer"
                      >
                        <span className="truncate">{m.title}</span>
                        <span className="ml-auto text-xs text-zinc-500">
                          {m.defaultViz ? VIZ_LABEL[m.defaultViz] : ""}
                        </span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={addWidget}
                      className="cursor-pointer"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Adicionar (automático)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  variant="outline"
                  className="rounded-xl border-zinc-200 bg-white"
                  onClick={resetLayout}
                  disabled={isBusy}
                  title="Limpa localStorage e restaura layout padrão"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Resetar layout
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <Separator className="mb-4" />

            {!ready || (isBusy && !rows?.length) ? (
              <DashboardSkeleton />
            ) : (
              <ResponsiveGridLayout
                className="layout"
                layouts={layouts}
                onLayoutChange={onLayoutChange}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                rowHeight={90}
                margin={[12, 12]}
                containerPadding={[0, 0]}
                isDraggable={editMode}
                isResizable={editMode}
                compactType="vertical"
                draggableHandle=".am-dash-drag"
                draggableCancel=".am-dash-nodrag"
                resizeHandles={["se", "s", "e"]}
                useCSSTransforms={true}
              >
                {widgets.map((w) => (
                  <div key={w.id} className="h-full">
                    <DashboardWidget
                      widget={w}
                      editMode={editMode}
                      dashData={dashData}
                      onRemove={() => removeWidget(w.id)}
                      onChangeViz={(viz) => changeWidgetViz(w.id, viz)}
                      onChangeMetric={(metricKey) =>
                        changeWidgetMetric(w.id, metricKey)
                      }
                    />
                  </div>
                ))}
              </ResponsiveGridLayout>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

/* =========================
   Widget (Card + Chart)
========================= */
const DashboardWidget = memo(function DashboardWidget({
  widget,
  editMode,
  dashData,
  onRemove,
  onChangeViz,
  onChangeMetric,
}) {
  const def = metricDef(widget.metric);
  const title = def?.title || "Widget";
  const subtitle = def?.subtitle || "";

  const allowedViz = def?.allowedViz || ["bar"];
  const currentViz = allowedViz.includes(widget.viz)
    ? widget.viz
    : def?.defaultViz || "bar";

  const IconViz = VIZ_ICON[currentViz] || Settings2;

  const data = useMemo(() => {
    const d = dashData || {};

    switch (widget.metric) {
      case "priority":
        return d.priorityCounts || [];
      case "size":
        return d.sizeCounts || [];
      case "createdPerDay":
        return d.createdSeries || [];
      case "updatedPerDay":
        return d.updatedSeries || [];
      case "owner":
        return d.ownerCounts || [];
      case "status":
        return d.statusCounts || [];
      case "sla":
        // donut/bar usam slaPie; stack usa slaStack
        return currentViz === "stack" ? d.slaStack || [] : d.slaPie || [];
      case "aging":
        return d.agingCounts || [];
      case "components":
        return d.componentsCounts || [];
      case "directorates":
        return d.directoratesCounts || [];
      case "noAssignee":
        return d.kpis?.noAssigneeCount ?? 0;
      case "noSchedule":
        return d.kpis?.noScheduleCount ?? 0;
      default:
        return [];
    }
  }, [dashData, widget.metric, currentViz]);

  return (
    <Card className="h-full flex flex-col rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="shrink-0 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "am-dash-drag inline-flex items-center gap-1.5",
                  editMode ? "cursor-move" : "cursor-default"
                )}
                title={editMode ? "Arrastar widget" : "Edit mode OFF"}
              >
                <GripVertical className="h-4 w-4 text-zinc-400" />
              </span>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-zinc-900">
                    {title}
                  </h3>

                  <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                    <span className="inline-flex items-center gap-1.5">
                      <IconViz className="h-3.5 w-3.5" />
                      {VIZ_LABEL[currentViz] || currentViz}
                    </span>
                  </Badge>
                </div>

                {subtitle ? (
                  <div className="mt-0.5 truncate text-xs text-zinc-500">
                    {subtitle}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="am-dash-nodrag flex items-center gap-2">
            {/* Trocar métrica */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl border-zinc-200 bg-white"
                  title="Trocar gráfico"
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Trocar gráfico</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {METRICS.map((m) => (
                  <DropdownMenuItem
                    key={m.metric}
                    className="cursor-pointer"
                    onClick={() => onChangeMetric?.(m.metric)}
                  >
                    <span className="truncate">{m.title}</span>
                    <span className="ml-auto text-xs text-zinc-500">
                      {VIZ_LABEL[m.defaultViz]}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Trocar tipo de visualização */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl border-zinc-200 bg-white"
                  title="Trocar tipo do gráfico"
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Tipo
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Visualização</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {allowedViz.map((viz) => {
                  const Ico = VIZ_ICON[viz] || BarChart3;
                  return (
                    <DropdownMenuItem
                      key={viz}
                      className="cursor-pointer"
                      onClick={() => onChangeViz?.(viz)}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Ico className="h-4 w-4 text-zinc-600" />
                        {VIZ_LABEL[viz] || viz}
                      </span>
                      {viz === currentViz ? (
                        <Badge className="ml-auto rounded-full bg-zinc-900 text-white">
                          Ativo
                        </Badge>
                      ) : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl border-zinc-200 bg-white hover:bg-red-50"
                  onClick={onRemove}
                  title="Remover widget"
                >
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="rounded-xl">Remover</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 p-4">
        <div className="h-full min-h-[160px] min-w-0 am-dash-nodrag">
          <WidgetBody metric={widget.metric} viz={currentViz} data={data} />
        </div>
      </CardContent>
    </Card>
  );
});

function WidgetBody({ metric, viz, data }) {
  // KPI
  if (viz === "kpi") {
    const value = typeof data === "number" ? data : 0;

    return (
      <div className="grid h-full place-items-center rounded-2xl border border-zinc-100 bg-zinc-50/40">
        <div className="text-center">
          <div className="text-4xl font-bold tracking-tight text-zinc-900">
            {value}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {metric === "noAssignee"
              ? "tickets sem responsável"
              : metric === "noSchedule"
              ? "tickets sem cronograma"
              : "kpi"}
          </div>
        </div>
      </div>
    );
  }

  // Séries
  if (viz === "line" || viz === "area") {
    const series = Array.isArray(data) ? data : [];
    if (!series.length) {
      return <EmptyChart text="Sem dados suficientes para série temporal." />;
    }

    if (viz === "line") {
      return (
        <ChartFrame minHeight={160}>
          {({ width, height }) => (
            <LineChart
              width={width}
              height={height}
              data={series}
              margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <RTooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="value"
                name="Tickets"
                dot={false}
              />
            </LineChart>
          )}
        </ChartFrame>
      );
    }

    // ✅ AREA (sem ResponsiveContainer)
    return (
      <ChartFrame minHeight={160}>
        {({ width, height }) => (
          <AreaChart width={width} height={height} data={series}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <RTooltip />
            <Legend />
            <Area
              type="monotone"
              dataKey="value"
              name="Tickets"
              fillOpacity={0.25}
            />
          </AreaChart>
        )}
      </ChartFrame>
    );
  }

  // SLA empilhado
  if (viz === "stack") {
    const stack = Array.isArray(data) ? data : [];
    if (!stack.length) return <EmptyChart text="Sem dados de SLA." />;

    return (
      <ChartFrame minHeight={160}>
        {({ width, height }) => (
          <BarChart width={width} height={height} data={stack}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <RTooltip />
            <Legend />
            <Bar
              dataKey="dentro"
              stackId="a"
              name="Dentro do prazo"
              fill="#16a34a"
            />
            <Bar
              dataKey="estourada"
              stackId="a"
              name="Data limite estourada"
              fill="#dc2626"
            />
            <Bar
              dataKey="alterada"
              stackId="a"
              name="Data limite alterada estourada"
              fill="#f59e0b"
            />
            <Bar
              dataKey="semData"
              stackId="a"
              name="Sem data limite"
              fill="#6b7280"
            />
            <Bar
              dataKey="concluidos"
              stackId="a"
              name="Concluídos"
              fill="#2563eb"
            />
          </BarChart>
        )}
      </ChartFrame>
    );
  }

  // Pizza/Donut
  if (viz === "pie" || viz === "donut") {
    const series = Array.isArray(data) ? data : [];
    if (!series.length) return <EmptyChart text="Sem dados para pizza." />;

    return (
      <ChartFrame minHeight={160}>
        {({ width, height }) => {
          const radius = Math.max(10, Math.min(width, height) / 2 - 28);
          const inner = viz === "donut" ? radius * 0.55 : 0;

          return (
            <PieChart width={width} height={height}>
              <RTooltip />
              <Legend />
              <Pie
                data={series}
                dataKey="value"
                nameKey="name"
                cx={width / 2}
                cy={height / 2}
                innerRadius={inner}
                outerRadius={radius}
              >
                {series.map((_, idx) => (
                  <Cell
                    key={`cell-${idx}`}
                    fill={CHART_COLORS[idx % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
            </PieChart>
          );
        }}
      </ChartFrame>
    );
  }

  // Barras
  if (viz === "bar") {
    const series = Array.isArray(data) ? data : [];
    if (!series.length) return <EmptyChart text="Sem dados para barras." />;

    return (
      <ChartFrame minHeight={160}>
        {({ width, height }) => (
          <BarChart
            width={width}
            height={height}
            data={series}
            margin={{ top: 5, right: 16, bottom: 5, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <RTooltip />
            <Legend />
            <Bar dataKey="value" name="Tickets">
              {series.map((_, idx) => (
                <Cell
                  key={`cell-${idx}`}
                  fill={CHART_COLORS[idx % CHART_COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        )}
      </ChartFrame>
    );
  }

  return <EmptyChart text="Visualização não suportada." />;
}

function EmptyChart({ text }) {
  return (
    <div className="grid h-full place-items-center rounded-2xl border border-zinc-100 bg-zinc-50/40">
      <div className="max-w-[320px] text-center text-xs text-zinc-500">
        {text}
      </div>
    </div>
  );
}

/* =========================
   Loading Skeleton (grid)
========================= */
function DashboardSkeleton() {
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Skeleton className="h-[360px] w-full rounded-2xl" />
        <Skeleton className="h-[360px] w-full rounded-2xl" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Skeleton className="h-[320px] w-full rounded-2xl" />
        <Skeleton className="h-[320px] w-full rounded-2xl" />
        <Skeleton className="h-[320px] w-full rounded-2xl" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Skeleton className="h-[340px] w-full rounded-2xl" />
        <Skeleton className="h-[340px] w-full rounded-2xl" />
      </div>
    </div>
  );
}

function ChartFrame({ children, minHeight = 160 }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const r = el.getBoundingClientRect();
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);

      // só salva valores válidos
      if (w > 0 && h > 0) setSize({ width: w, height: h });
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);

    const raf = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const ok = size.width > 0 && size.height > 0;

  return (
    <div
      ref={ref}
      className="h-full w-full min-w-0 overflow-hidden"
      style={{ minHeight }}
    >
      {ok ? (
        children(size)
      ) : (
        <EmptyChart text="Calculando tamanho do gráfico..." />
      )}
    </div>
  );
}
