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

import "@fontsource-variable/inter";

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
  AlertTriangle,
  ExternalLink,
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
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
  ComposedChart,
  Treemap,
} from "recharts";

import { Input } from "@/components/ui/input";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Cell } from "recharts";

import { Responsive as ResponsiveGridLayout } from "react-grid-layout";

import "/node_modules/react-grid-layout/css/styles.css";
import "/node_modules/react-resizable/css/styles.css";

function cn(...a) {
  return a.filter(Boolean).join(" ");
}

const LS_KEY = "am_dashboard_layout_v1";
const LS_SLA_TARGET_KEY = "am_dashboard_sla_target_pct_v1";
const JIRA_BASE_URL = "https://clarobr-jsw-tecnologia.atlassian.net";

function uid(prefix = "w") {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }
}

/* =========================
   //#region Datas / helpers
========================= */
function pad2(n) {
  return String(n).padStart(2, "0");
}

function toYmdLocal(dt) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function parseDateLoose(v) {
  const s = String(v || "").trim();
  if (!s) return null;

  // caso já seja YYYY-MM-DD puro
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return parseIsoYmdLocal(s);
  }

  // Jira às vezes vem com timezone +0000 (sem ":"), normaliza para +00:00
  const normalized = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractYmd(v) {
  if (!v) return "";

  // Date nativo
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return toYmdLocal(v);
  }

  // String (created/updated/resolutiondate do Jira)
  if (typeof v === "string") {
    const s = v.trim();

    // se for só YYYY-MM-DD (duedate)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // tenta parsear como data/hora e converter para dia LOCAL
    const dt = parseDateLoose(s);
    if (dt) return toYmdLocal(dt);

    // fallback seguro
    const ymd = s.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
  }

  // objetos variados (ex: { value: ... })
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
    return extractYmd(candidate);
  }

  return extractYmd(String(v));
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

function issueTypeKind(issueTypeName, isSubtask) {
  if (isSubtask) return "subtask";

  const s = String(issueTypeName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // se você ainda quiser separar Story de outros "principais", mantém isso:
  if (/(historia|story|hist)/.test(s)) return "story";

  return "other";
}

function dueBucketLabel(t, today0) {
  if (!t?.effectiveDueDate) return "Sem data limite";

  // delta = due - hoje
  const delta = diffDays(t.effectiveDueDate, today0);

  if (delta < 0) return "Atrasado";
  if (delta === 0) return "Hoje";
  if (delta <= 2) return "1-2 dias";
  if (delta <= 7) return "3-7 dias";
  if (delta <= 14) return "8-14 dias";
  if (delta <= 30) return "15-30 dias";
  return "30+ dias";
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

function normalizeIssue(t) {
  const f = t?.fields || {};

  const issueType = f?.issuetype?.name || t?.issueType || "—";

  const isSubtask =
    Boolean(f?.issuetype?.subtask) ||
    /subtarefa|sub-task|subtask/i.test(issueType);

  const reporter =
    f?.reporter?.displayName || t?.reporterName || t?.reporter || "—";
  const priority = t?.priorityName || f?.priority?.name || "Não informado";
  const summary = f?.summary || t?.summary || "—";

  const size =
    t?.sizeValue ||
    f?.customfield_10988?.value ||
    f?.customfield_10988?.name ||
    "Não informado";

  const created = f?.created || t?.createdRaw || t?.created || "";
  const updated = f?.updated || t?.updatedRaw || t?.updated || "";

  const status = f?.status?.name || t?.statusName || t?.status?.name || "—";

  const owner = f?.assignee?.displayName || t?.assignee || "Sem responsável";

  const dueBaseYmd = extractYmd(f?.duedate || t?.duedate || t?.dueDateRaw);
  const dueAltYmd = extractYmd(f?.customfield_11519 || t?.customfield_11519);

  const dueBaseDate = parseIsoYmdLocal(dueBaseYmd);
  const dueAltDate = parseIsoYmdLocal(dueAltYmd);

  const hasDueAlt = Boolean(dueAltDate);
  const effectiveDueDate = dueAltDate || dueBaseDate;

  const components = Array.isArray(f?.components)
    ? f.components.map((c) => c?.name).filter(Boolean)
    : [];

  const directorias = toNamesArray(f?.customfield_11520);

  const hasSchedule = hasCronogramaField(f?.customfield_14017);

  // ✅ importantíssimo para séries de "concluídos por dia"
  const resolutionDate =
    f?.resolutiondate ||
    t?.resolutiondate ||
    t?.resolutionDateRaw ||
    t?.doneAt ||
    "";

  const done = isDoneStatus(status);

  return {
    _raw: t,
    key: t?.key || "",
    summary,
    priority,
    size,
    created,
    updated,
    status,
    owner,
    issueType,
    isSubtask,
    reporter,
    dueBaseYmd,
    dueAltYmd,
    hasDueAlt,
    effectiveDueDate,
    components,
    directorias,
    hasSchedule,
    resolutionDate,
    done,
  };
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
    const content = v?.content;
    if (Array.isArray(content) && content.length > 0) return true;

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
    allowedViz: ["bar", "barh", "donut", "pie", "treemap"],
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
    allowedViz: ["bar", "barh", "donut", "pie", "treemap"],
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
    allowedViz: ["bar", "barh"],
  },
  {
    metric: "components",
    title: "Componentes",
    subtitle: "Top componentes",
    defaultViz: "bar",
    allowedViz: ["bar", "barh", "donut", "pie", "treemap"],
  },
  {
    metric: "directorates",
    title: "Diretorias",
    subtitle: "Top diretorias",
    defaultViz: "bar",
    allowedViz: ["bar", "barh", "donut", "pie", "treemap"], // ✅
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
  {
    metric: "dueBuckets",
    title: "Vencimento (buckets)",
    subtitle: "Distribuição por prazo (abertos)",
    defaultViz: "bar",
    allowedViz: ["bar", "donut", "pie"],
  },
  {
    metric: "issueType",
    title: "Tipo do ticket",
    subtitle: "Quantidade por issueType",
    defaultViz: "bar",
    allowedViz: ["bar", "donut", "pie"],
  },
  {
    metric: "reporter",
    title: "Reportado por",
    subtitle: "Top reporters",
    defaultViz: "bar",
    allowedViz: ["bar", "barh", "donut", "pie", "treemap"],
  },
  {
    metric: "donePerDay",
    title: "Concluídos por dia",
    subtitle: "Últimos 30 dias (somente Done)",
    defaultViz: "line",
    allowedViz: ["line", "area"],
  },
  {
    metric: "slaCompliance",
    title: "SLA Compliance (meta)",
    subtitle: "Percentual dentro do prazo (exclui Done e Sem data limite)",
    defaultViz: "gauge",
    allowedViz: ["gauge", "kpi"],
  },
  {
    metric: "createdVsDonePerDay",
    title: "Criados vs Concluídos por dia",
    subtitle: "Principal x Subtarefas (últimos 30 dias)",
    defaultViz: "composed",
    allowedViz: ["composed", "multiLine"],
  },
];

const VIZ_LABEL = {
  bar: "Barras",
  barh: "Barras horizontais", // ✅ NEW
  treemap: "Treemap", // ✅ NEW
  pie: "Pizza",
  donut: "Donut",
  line: "Linha",
  multiLine: "Linhas múltiplas", // ✅ NEW
  area: "Área",
  stack: "Barras empilhadas",
  kpi: "KPI",
  gauge: "Gauge",
  composed: "Composto",
};

const VIZ_ICON = {
  bar: BarChart3,
  barh: BarChart3, // ✅ NEW
  treemap: PieChartIcon, // ✅ NEW (pode trocar se quiser)
  pie: PieChartIcon,
  donut: PieChartIcon,
  line: LineChartIcon,
  multiLine: LineChartIcon, // ✅ NEW
  area: AreaChartIcon,
  stack: BarChart3,
  kpi: Gauge,
  gauge: Gauge,
  composed: BarChart3,
};

const CHART_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#334155",
  "#d946ef",
  "#84cc16",
];

const METRIC_ACCENT = {
  createdPerDay: "#3b82f6", // blue
  updatedPerDay: "#6366f1", // indigo
  priority: "#f59e0b", // amber
  status: "#8b5cf6", // violet
  owner: "#22c55e", // green
  sla: "#ef4444", // red
  size: "#06b6d4", // cyan
  aging: "#eab308", // yellow
  components: "#0ea5e9", // sky
  directorates: "#a855f7", // purple
  noAssignee: "#f97316", // orange
  noSchedule: "#64748b", // slate
};

function hexToRgba(hex, alpha = 1) {
  const h = String(hex || "")
    .replace("#", "")
    .trim();
  if (h.length !== 6) return `rgba(100,116,139,${alpha})`; // fallback slate
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function metricAccent(metricKey) {
  return METRIC_ACCENT[metricKey] || "#3b82f6";
}

const PRIORITY_COLORS = {
  HIGHEST: "#b91c1c",
  HIGH: "#d97706",
  MEDIUM: "#3b82f6",
  LOW: "#22c55e",
  LOWEST: "#6b7280",
  "Não informado": "#6b7280",
};

const AGING_COLORS = ["#22c55e", "#eab308", "#f97316", "#ef4444", "#b91c1c"];

function metricDef(metricKey) {
  return METRICS.find((m) => m.metric === metricKey) || null;
}

/* =========================
   Layout padrão (12 colunas no lg)
========================= */
function buildDefaultConfig() {
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

  const makeSmaller = (cols) =>
    lg.map((it) => ({
      ...it,
      x: Math.min(it.x, cols - it.w),
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

function validateLayouts(layouts, widgets, colsMap) {
  const widgetIds = new Set(widgets.map((w) => w.id));
  const validated = {};

  for (const bp in layouts) {
    const col = colsMap[bp] || 12;
    const l = layouts[bp] || [];
    const seen = new Set();
    const fixed = l
      .filter(
        (item) => widgetIds.has(item.i) && !seen.has(item.i) && seen.add(item.i)
      )
      .map((item) => ({
        ...item,
        x: Math.max(0, Math.min(item.x, col - item.w)),
        w: Math.max(1, Math.min(item.w, col)),
        y: Math.max(0, item.y),
        h: Math.max(1, item.h),
      }));

    // Sort by y, then x to avoid overlaps
    fixed.sort((a, b) => a.y - b.y || a.x - b.x);

    // Simple overlap resolution: push down if overlap
    for (let i = 0; i < fixed.length; i++) {
      for (let j = i + 1; j < fixed.length; j++) {
        if (
          fixed[j].y < fixed[i].y + fixed[i].h &&
          fixed[j].x < fixed[i].x + fixed[i].w &&
          fixed[j].x + fixed[j].w > fixed[i].x &&
          fixed[j].y + fixed[j].h > fixed[i].y
        ) {
          fixed[j].y = fixed[i].y + fixed[i].h;
        }
      }
    }

    validated[bp] = fixed;
  }

  return validated;
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.widgets) || typeof parsed.layouts !== "object")
      return null;

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

function widgetGridSize(widget) {
  const v = String(widget?.viz || "");
  if (v === "kpi") return { w: 3, h: 3 };
  if (v === "gauge") return { w: 4, h: 4 };
  if (v === "line" || v === "area") return { w: 6, h: 4 };
  if (v === "composed") return { w: 6, h: 4 };
  return { w: 4, h: 4 };
}

function normalizeAndFillLayouts(layouts, widgets, colsMap) {
  const widgetIds = widgets.map((w) => w.id);
  const widgetById = new Map(widgets.map((w) => [w.id, w]));
  const out = {};

  for (const bp of Object.keys(colsMap)) {
    const cols = colsMap[bp] ?? 12;
    const l = Array.isArray(layouts?.[bp]) ? layouts[bp] : [];

    const seen = new Set();
    const normalized = [];

    // mantém o que existe e é válido
    for (const it of l) {
      if (!it?.i) continue;
      if (!widgetById.has(it.i)) continue;
      if (seen.has(it.i)) continue;
      seen.add(it.i);

      normalized.push({
        ...it,
        w: Math.max(1, Math.min(it.w || 4, cols)),
        h: Math.max(1, it.h || 4),
        x: Math.max(
          0,
          Math.min(it.x || 0, cols - Math.max(1, Math.min(it.w || 4, cols)))
        ),
        y: Number.isFinite(it.y) ? Math.max(0, it.y) : Infinity,
      });
    }

    // adiciona widgets que faltam (isso evita “tudo empilhado”)
    for (const id of widgetIds) {
      if (seen.has(id)) continue;
      const sz = widgetGridSize(widgetById.get(id));
      normalized.push({ i: id, x: 0, y: Infinity, ...sz });
    }

    out[bp] = normalized;
  }

  return out;
}

function hasInfinityY(layouts) {
  for (const bp in layouts) {
    const l = layouts[bp] || [];
    if (l.some((it) => !Number.isFinite(it.y))) return true;
  }
  return false;
}

function hasOverlapInAnyBp(layouts) {
  for (const bp in layouts) {
    const l = layouts[bp] || [];
    for (let i = 0; i < l.length; i++) {
      for (let j = i + 1; j < l.length; j++) {
        const a = l[i];
        const b = l[j];

        const overlap =
          b.y < a.y + a.h &&
          b.x < a.x + a.w &&
          b.x + b.w > a.x &&
          b.y + b.h > a.y;

        if (overlap) return true;
      }
    }
  }
  return false;
}

// organiza em “linhas”, respeitando a ordem do array widgets
function packLayoutsByWidgetOrder(layouts, widgets, colsMap) {
  const widgetIds = widgets.map((w) => w.id);
  const out = {};

  for (const bp of Object.keys(colsMap)) {
    const cols = colsMap[bp] ?? 12;
    const list = Array.isArray(layouts?.[bp]) ? layouts[bp] : [];
    const byId = new Map(list.map((it) => [it.i, it]));

    let x = 0;
    let y = 0;
    let rowH = 0;

    out[bp] = widgetIds.map((id) => {
      const base = byId.get(id);
      const w0 = Math.max(1, Math.min(base?.w || 4, cols));
      const h0 = Math.max(1, base?.h || 4);

      if (x + w0 > cols) {
        x = 0;
        y += rowH || 1;
        rowH = 0;
      }

      const placed = { ...(base || { i: id }), i: id, x, y, w: w0, h: h0 };

      x += w0;
      rowH = Math.max(rowH, h0);

      return placed;
    });
  }

  return out;
}

// trava o layout no modo OFF (garantia extra)
function withStatic(layouts, lock) {
  if (!lock) return layouts;
  const out = {};
  for (const bp in layouts) {
    out[bp] = (layouts[bp] || []).map((it) => ({ ...it, static: true }));
  }
  return out;
}

/* =========================
   //#region Component
========================= */
export default function AMDashboardTab({
  rows = [],
  doneRows = [],
  loading = false,
}) {
  const [editMode, setEditMode] = useState(false);

  const defaultConfig = useMemo(() => buildDefaultConfig(), []);
  const [widgets, setWidgets] = useState(defaultConfig.widgets);
  const [layouts, setLayouts] = useState(defaultConfig.layouts);

  const [ready, setReady] = useState(false);
  const hydratedRef = useRef(false);

  const [slaTargetPct, setSlaTargetPct] = useState(90);
  const [slaCfgOpen, setSlaCfgOpen] = useState(false);
  const [slaCfgValue, setSlaCfgValue] = useState("90");

  const [drillOpen, setDrillOpen] = useState(false);
  const [drillTitle, setDrillTitle] = useState("");
  const [drillItems, setDrillItems] = useState([]);

  const [gridRef, gridWidth] = useElementWidth();

  const saveSlaTarget = useCallback((next) => {
    const n = Math.max(1, Math.min(100, Number(next)));
    if (!Number.isFinite(n)) return;

    setSlaTargetPct(n);
    setSlaCfgValue(String(n));

    try {
      localStorage.setItem(LS_SLA_TARGET_KEY, String(n));
    } catch {}
  }, []);

  const colsMap = useMemo(
    () => ({
      lg: 12,
      md: 10,
      sm: 6,
      xs: 4,
      xxs: 2,
    }),
    []
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!ready) return;

    const stored = loadFromStorage();
    if (stored) {
      // 1) garante que TODOS widgets existam em TODOS breakpoints
      const filled = normalizeAndFillLayouts(
        stored.layouts,
        stored.widgets,
        colsMap
      );

      // 2) valida/clampa
      const validated = validateLayouts(filled, stored.widgets, colsMap);

      // 3) se tiver Infinity (itens “sem posição”) ou overlap, auto organiza
      const needsPack = hasInfinityY(validated) || hasOverlapInAnyBp(validated);
      const finalLayouts = needsPack
        ? packLayoutsByWidgetOrder(validated, stored.widgets, colsMap)
        : validated;

      setWidgets(stored.widgets);
      setLayouts(finalLayouts);
    }

    hydratedRef.current = true;
  }, [ready, colsMap]);

  useEffect(() => {
    if (!ready) return;
    if (!hydratedRef.current) return;

    saveToStorage({ widgets, layouts });
  }, [ready, widgets, layouts]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(LS_SLA_TARGET_KEY);
      if (v != null) {
        const num = Number(v);
        if (Number.isFinite(num) && num > 0 && num <= 100) {
          setSlaTargetPct(num);
          setSlaCfgValue(String(num));
        }
      }
    } catch {}
  }, []);

  const normalizedOpen = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    return list.map(normalizeIssue);
  }, [rows]);

  const normalizedDoneFull = useMemo(() => {
    const list = Array.isArray(doneRows) ? doneRows : [];
    return list.map(normalizeIssue);
  }, [doneRows]);

  // ✅ junta tudo e remove duplicados por KEY
  const normalizedAll = useMemo(() => {
    const byKey = new Map();
    for (const t of [...normalizedOpen, ...normalizedDoneFull]) {
      if (t?.key) byKey.set(t.key, t);
    }
    return Array.from(byKey.values());
  }, [normalizedOpen, normalizedDoneFull]);

  const autoOrganize = useCallback(() => {
    setLayouts((prev) => {
      const filled = normalizeAndFillLayouts(prev, widgets, colsMap);
      const validated = validateLayouts(filled, widgets, colsMap);
      return packLayoutsByWidgetOrder(validated, widgets, colsMap);
    });
  }, [widgets, colsMap]);

  const openDrill = useCallback(
    ({ metric, label }) => {
      const today0 = startOfTodayLocal();
      const m = String(metric || "");
      const name = String(label || "").trim();

      const listAll = normalizedAll || [];
      const listOpen = listAll.filter((t) => !t.done);
      const listDone = listAll.filter((t) => t.done);

      const pick = (arr) => {
        setDrillItems(arr);
        setDrillTitle(`${metricDef(m)?.title || m}: ${name}`);
        setDrillOpen(true);
      };

      if (!name) return;

      switch (m) {
        case "priority":
          return pick(listOpen.filter((t) => t.priority === name));

        case "status":
          return pick(listOpen.filter((t) => t.status === name));

        case "owner":
          return pick(listOpen.filter((t) => t.owner === name));

        case "size":
          return pick(listOpen.filter((t) => t.size === name));

        case "issueType":
          return pick(listOpen.filter((t) => t.issueType === name));

        case "reporter":
          return pick(listOpen.filter((t) => t.reporter === name));

        case "dueBuckets": {
          return pick(
            listOpen.filter((t) => dueBucketLabel(t, today0) === name)
          );
        }

        case "sla": {
          if (name === "Dentro do prazo") {
            return pick(
              listOpen.filter(
                (t) => t.effectiveDueDate && t.effectiveDueDate >= today0
              )
            );
          }

          if (name === "Data limite estourada") {
            return pick(
              listOpen.filter(
                (t) =>
                  t.effectiveDueDate &&
                  t.effectiveDueDate < today0 &&
                  !t.hasDueAlt
              )
            );
          }

          if (name === "Data limite alterada estourada") {
            return pick(
              listOpen.filter(
                (t) =>
                  t.effectiveDueDate &&
                  t.effectiveDueDate < today0 &&
                  t.hasDueAlt
              )
            );
          }

          if (name === "Sem data limite") {
            return pick(listOpen.filter((t) => !t.effectiveDueDate));
          }

          if (name === "Concluídos") {
            return pick(listDone);
          }

          return;
        }

        case "slaCompliance": {
          return pick(listOpen.filter((t) => Boolean(t.effectiveDueDate)));
        }

        case "aging": {
          const today0 = startOfTodayLocal();

          const inBucket = (t) => {
            const ymd = extractYmd(t.created);
            const d = parseIsoYmdLocal(ymd);
            if (!d) return false;

            const age = Math.max(0, diffDays(today0, d));

            if (name === "0-2d") return age <= 2;
            if (name === "3-7d") return age >= 3 && age <= 7;
            if (name === "8-14d") return age >= 8 && age <= 14;
            if (name === "15-30d") return age >= 15 && age <= 30;
            if (name === "30+d") return age >= 31;
            return false;
          };

          return pick(listOpen.filter(inBucket));
        }

        default:
          return;
      }
    },
    [normalizedAll]
  );

  function ymdLocal(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function brLabelFromYmd(ymd) {
    // "2026-01-05" -> "05/01"
    if (!ymd) return "";
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}`;
  }

  function buildCreatedVsDoneByDay({
    allTickets = [],
    doneTickets = [],
    days = 30,
  }) {
    const today0 = startOfTodayLocal();

    const daysList = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today0);
      d.setDate(d.getDate() - i);
      daysList.push(extractYmd(d));
    }

    const createdStory = new Map(daysList.map((d) => [d, 0]));
    const createdSub = new Map(daysList.map((d) => [d, 0]));
    const doneStory = new Map(daysList.map((d) => [d, 0]));
    const doneSub = new Map(daysList.map((d) => [d, 0]));

    // CREATED: todos os tickets
    for (const t of allTickets) {
      const ymd = extractYmd(t?.created);
      if (!ymd || !createdStory.has(ymd)) continue;

      const kind = issueTypeKind(t?.issueType, t?.isSubtask);

      if (kind === "subtask") {
        createdSub.set(ymd, (createdSub.get(ymd) || 0) + 1);
      } else {
        // ✅ inclui story + other como "principal"
        createdStory.set(ymd, (createdStory.get(ymd) || 0) + 1);
      }
    }

    // DONE: resolutionDate, fallback para updated
    for (const t of doneTickets) {
      const ymd = extractYmd(t?.resolutionDate || t?.updated);
      if (!ymd || !doneStory.has(ymd)) continue;

      const kind = issueTypeKind(t?.issueType, t?.isSubtask);

      if (kind === "subtask") {
        doneSub.set(ymd, (doneSub.get(ymd) || 0) + 1);
      } else {
        doneStory.set(ymd, (doneStory.get(ymd) || 0) + 1);
      }
    }

    return daysList.map((ymd) => ({
      ymd,
      day: fmtShortBRFromYmd(ymd),

      createdStory: createdStory.get(ymd) || 0,
      createdSubtask: createdSub.get(ymd) || 0,

      doneStory: doneStory.get(ymd) || 0,
      doneSubtask: doneSub.get(ymd) || 0,

      createdTotal: (createdStory.get(ymd) || 0) + (createdSub.get(ymd) || 0),
      doneTotal: (doneStory.get(ymd) || 0) + (doneSub.get(ymd) || 0),
    }));
  }

  const dashData = useMemo(() => {
    const listAll = normalizedAll || [];
    const openList = listAll.filter((t) => !t.done);
    const doneList = listAll.filter((t) => t.done);

    const priorityOrder = new Map([
      ["HIGHEST", 1],
      ["HIGH", 2],
      ["MEDIUM", 3],
      ["LOW", 4],
      ["LOWEST", 5],
    ]);

    // ✅ PRIORIDADE (somente abertos)
    const priorityCounts = countBy(openList, (x) => x.priority)
      .sort((a, b) => {
        const pa = priorityOrder.get(String(a.name || "").toUpperCase()) || 99;
        const pb = priorityOrder.get(String(b.name || "").toUpperCase()) || 99;
        if (pa !== pb) return pa - pb;
        return b.value - a.value;
      })
      .map((item, idx) => ({
        ...item,
        fill:
          PRIORITY_COLORS[item.name.toUpperCase()] ||
          CHART_COLORS[idx % CHART_COLORS.length],
      }));

    // ✅ TAMANHO (somente abertos)
    const sizeCounts = countBy(openList, (x) => x.size)
      .sort((a, b) => b.value - a.value)
      .map((item, idx) => ({
        ...item,
        fill: CHART_COLORS[idx % CHART_COLORS.length],
      }));

    // ✅ STATUS (somente abertos)
    const statusCounts = countBy(openList, (x) => x.status)
      .sort((a, b) => b.value - a.value)
      .map((item, idx) => ({
        ...item,
        fill: CHART_COLORS[idx % CHART_COLORS.length],
      }));

    // ✅ OWNER (somente abertos)
    const ownerCounts = topN(
      countBy(openList, (x) => x.owner).sort((a, b) => b.value - a.value),
      12
    ).map((item, idx) => ({
      ...item,
      fill: CHART_COLORS[idx % CHART_COLORS.length],
    }));

    // ✅ correto: inclui abertos + concluídos
    const createdSeries = buildLastNDaysSeries(listAll, (x) => x.created, 30);
    const updatedSeries = buildLastNDaysSeries(listAll, (x) => x.updated, 30);

    const today0 = startOfTodayLocal();

    // ✅ ISSUE TYPE (somente abertos)
    const issueTypeCounts = countBy(openList, (x) => x.issueType)
      .sort((a, b) => b.value - a.value)
      .map((item, idx) => ({
        ...item,
        fill: CHART_COLORS[idx % CHART_COLORS.length],
      }));

    // ✅ REPORTER (somente abertos)
    const reporterCounts = topN(
      countBy(openList, (x) => x.reporter).sort((a, b) => b.value - a.value),
      12
    ).map((item, idx) => ({
      ...item,
      fill: CHART_COLORS[idx % CHART_COLORS.length],
    }));

    // ✅ DUE BUCKETS já era de abertos (mantém)
    const bucketOrder = new Map([
      ["Atrasado", 1],
      ["Hoje", 2],
      ["1-2 dias", 3],
      ["3-7 dias", 4],
      ["8-14 dias", 5],
      ["15-30 dias", 6],
      ["30+ dias", 7],
      ["Sem data limite", 99],
    ]);

    const dueBucketsCounts = countBy(openList, (x) => dueBucketLabel(x, today0))
      .sort((a, b) => {
        const oa = bucketOrder.get(a.name) ?? 999;
        const ob = bucketOrder.get(b.name) ?? 999;
        if (oa !== ob) return oa - ob;
        return b.value - a.value;
      })
      .map((item, idx) => ({
        ...item,
        fill: CHART_COLORS[idx % CHART_COLORS.length],
      }));

    // ✅ SLA (somente abertos)
    let inside = 0;
    let overdueBase = 0;
    let overdueAlt = 0;
    let noDue = 0;

    for (const t of openList) {
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

    const overdueTotal = overdueBase + overdueAlt;
    const eligible = inside + overdueTotal; // exclui Done e Sem data limite
    const slaCompliancePct =
      eligible > 0 ? Math.round((inside / eligible) * 1000) / 10 : 100;

    const slaBreach = slaCompliancePct < slaTargetPct;

    const slaCompliance = {
      pct: slaCompliancePct,
      targetPct: slaTargetPct,
      eligibleTotal: eligible,
      inside,
      overdueTotal,
      breach: slaBreach,
    };

    // ✅ SLA charts SEM "Concluídos"
    const slaPie = [
      { name: "Dentro do prazo", value: inside, fill: "#22c55e" },
      { name: "Data limite estourada", value: overdueBase, fill: "#ef4444" },
      {
        name: "Data limite alterada estourada",
        value: overdueAlt,
        fill: "#f59e0b",
      },
      { name: "Sem data limite", value: noDue, fill: "#6b7280" },
    ].filter((x) => x.value > 0);

    const slaStack = [
      {
        name: "SLA",
        dentro: inside,
        estourada: overdueBase,
        alterada: overdueAlt,
        semData: noDue,
      },
    ];

    // ✅ AGING (somente abertos)
    const aging = new Map([
      ["0-2d", 0],
      ["3-7d", 0],
      ["8-14d", 0],
      ["15-30d", 0],
      ["30+d", 0],
    ]);

    for (const t of openList) {
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

    const agingCounts = Array.from(aging.entries())
      .map(([name, value]) => ({ name, value }))
      .map((item, idx) => ({ ...item, fill: AGING_COLORS[idx] }));

    // ✅ COMPONENTS (somente abertos)
    const componentsAll = [];
    for (const t of openList)
      for (const c of t.components) componentsAll.push(c);

    const componentsCounts = topN(
      countBy(componentsAll, (x) => x),
      12
    ).map((item, idx) => ({
      ...item,
      fill: CHART_COLORS[idx % CHART_COLORS.length],
    }));

    // ✅ DIRECTORIAS (somente abertos)
    const dirsAll = [];
    for (const t of openList) {
      const dirs = Array.isArray(t?.diretorias) ? t.diretorias : [];
      for (const d of dirs) dirsAll.push(d);
    }

    const directoratesCounts = topN(
      countBy(dirsAll, (x) => x),
      12
    ).map((item, idx) => ({
      ...item,
      fill: CHART_COLORS[idx % CHART_COLORS.length],
    }));

    // ✅ KPI (sem Done nos “sem responsável/cronograma”)
    const noAssigneeCount = openList.filter(
      (t) => String(t.owner || "").toLowerCase() === "sem responsável"
    ).length;

    const noScheduleCount = openList.filter((t) => !t.hasSchedule).length;

    // ✅ SOMENTE DONE nos gráficos certos:
    const donePerDaySeries = buildLastNDaysSeries(
      doneList,
      (x) => x.resolutionDate || x.updated, // ✅ fallback
      30
    );

    const createdVsDoneSeries = buildCreatedVsDoneByDay({
      allTickets: listAll, // ✅ normalizedAll
      doneTickets: doneList, // ✅ somente Done
      days: 30,
    });

    console.log("DONE LIST SIZE:", doneList.length);
    console.log(
      "DONE SAMPLE:",
      doneList.slice(0, 3).map((d) => ({
        key: d.key,
        status: d.status,
        issueType: d.issueType,
        resolutionDate: d.resolutionDate,
        updated: d.updated,
      }))
    );

    return {
      priorityCounts,
      sizeCounts,
      statusCounts,
      ownerCounts,
      createdSeries,
      updatedSeries,
      donePerDaySeries,
      slaPie,
      slaStack,
      agingCounts,
      componentsCounts,
      directoratesCounts,
      dueBucketsCounts,
      issueTypeCounts,
      reporterCounts,
      kpis: {
        total: listAll.length, // mantém o total geral (abertos + concluídos)
        noAssigneeCount,
        noScheduleCount,
        overdueCount: overdueBase + overdueAlt,
      },
      slaCompliance,
      createdVsDoneSeries,
    };
  }, [normalizedAll, slaTargetPct, rows, doneRows]);

  const addWidget = useCallback(() => {
    const used = new Set(widgets.map((w) => w.metric));
    const candidate = METRICS.find((m) => !used.has(m.metric)) || METRICS[0];

    const def = metricDef(candidate.metric);
    const next = {
      id: uid("w"),
      metric: candidate.metric,
      viz: def?.defaultViz || "bar",
    };

    setWidgets((prev) => [...prev, next]);

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

  const onLayoutChange = useCallback(
    (currentLayout, allLayouts) => {
      // garante que TODOS widgets existam em TODOS breakpoints
      const filled = normalizeAndFillLayouts(allLayouts, widgets, colsMap);

      // valida/clampa e remove bagunça
      const validated = validateLayouts(filled, widgets, colsMap);

      setLayouts(validated);
    },
    [widgets, colsMap]
  );

  const isBusy = Boolean(loading);

  const gridLayouts = useMemo(
    () => withStatic(layouts, !editMode),
    [layouts, editMode]
  );

  return (
    <TooltipProvider>
      <div className="grid gap-4 font-sans antialiased">
        <div className="rounded-3xl bg-gradient-to-br from-zinc-50 via-white to-blue-50 p-0.5">
          <Card className="relative overflow-hidden rounded-3xl border-zinc-200/70 bg-white/70 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.45)] backdrop-blur">
            {/* glow sutil */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(59,130,246,0.10),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.08),transparent_40%)]" />

            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/25 ring-1 ring-white/40">
                    <LayoutDashboard className="h-5 w-5" />
                  </div>

                  <div className="min-w-0">
                    <CardTitle className="text-[15px] font-semibold tracking-tight text-zinc-900">
                      Dashboard de Tickets
                    </CardTitle>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Badge className="rounded-full border border-zinc-200/70 bg-white/70 text-zinc-700 shadow-sm backdrop-blur">
                        Total: {dashData?.kpis?.total ?? 0}
                      </Badge>
                      <Badge className="rounded-full border border-zinc-200/70 bg-white/70 text-zinc-700 shadow-sm backdrop-blur">
                        Atrasados: {dashData?.kpis?.overdueCount ?? 0}
                      </Badge>
                      <Badge className="rounded-full border border-zinc-200/70 bg-white/70 text-zinc-700 shadow-sm backdrop-blur">
                        Sem responsável: {dashData?.kpis?.noAssigneeCount ?? 0}
                      </Badge>
                      <Badge className="rounded-full border border-zinc-200/70 bg-white/70 text-zinc-700 shadow-sm backdrop-blur">
                        Sem cronograma: {dashData?.kpis?.noScheduleCount ?? 0}
                      </Badge>
                      <Badge className="rounded-full border border-zinc-200/70 bg-white/70 text-zinc-700 shadow-sm backdrop-blur">
                        SLA: {dashData?.slaCompliance?.pct ?? 0}% (meta{" "}
                        {dashData?.slaCompliance?.targetPct ?? 90}%)
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        className="rounded-xl border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur hover:bg-white hover:shadow-md transition-all"
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
                        className="rounded-xl bg-gradient-to-b from-blue-600 to-blue-700 text-white shadow-md shadow-blue-600/20 hover:shadow-lg hover:shadow-blue-600/25 transition-all"
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
                    className="rounded-xl border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur hover:bg-white hover:shadow-md transition-all"
                    onClick={autoOrganize}
                    disabled={isBusy}
                    title="Reorganiza automaticamente os widgets"
                  >
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    Auto organizar
                  </Button>

                  <Button
                    variant="outline"
                    className="rounded-xl border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur hover:bg-white hover:shadow-md transition-all"
                    onClick={() => setSlaCfgOpen(true)}
                    disabled={isBusy}
                  >
                    <Gauge className="mr-2 h-4 w-4" />
                    Meta SLA
                  </Button>

                  <Button
                    variant="outline"
                    className="rounded-xl border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur hover:bg-white hover:shadow-md transition-all"
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

              <div ref={gridRef} className="w-full">
                {gridWidth <= 0 ? (
                  <DashboardSkeleton />
                ) : (
                  <ResponsiveGridLayout
                    width={gridWidth}
                    className="layout"
                    layouts={gridLayouts}
                    onLayoutChange={editMode ? onLayoutChange : undefined}
                    breakpoints={{
                      lg: 1200,
                      md: 996,
                      sm: 768,
                      xs: 480,
                      xxs: 0,
                    }}
                    cols={colsMap}
                    rowHeight={90}
                    margin={[12, 12]}
                    containerPadding={[0, 0]}
                    isDraggable={editMode}
                    isResizable={editMode}
                    draggableHandle={
                      editMode ? ".am-dash-drag" : ".__no_handle__"
                    }
                    draggableCancel=".am-dash-nodrag"
                    resizeHandles={editMode ? ["se", "s", "e"] : []}
                    compactType="vertical"
                    preventCollision={false}
                    useCSSTransforms={true}
                    autoSize={true}
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
                          onDrill={openDrill}
                        />
                      </div>
                    ))}
                  </ResponsiveGridLayout>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={slaCfgOpen} onOpenChange={setSlaCfgOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configurar meta de SLA</DialogTitle>
            <DialogDescription>
              Defina o alvo de “tickets dentro do prazo” (somente tickets com
              data limite).
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <div className="text-sm text-zinc-600">Meta (%)</div>
            <Input
              value={slaCfgValue}
              onChange={(e) => setSlaCfgValue(e.target.value)}
              inputMode="numeric"
              placeholder="90"
            />
            <div className="text-xs text-zinc-500">
              Intervalo recomendado: 80 a 95.
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSlaCfgOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                saveSlaTarget(slaCfgValue);
                setSlaCfgOpen(false);
              }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={drillOpen} onOpenChange={setDrillOpen}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{drillTitle}</DialogTitle>
            <DialogDescription>{drillItems.length} ticket(s)</DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-auto rounded-xl border border-zinc-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left">Key</th>
                  <th className="px-3 py-2 text-left">Resumo</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Prioridade</th>
                  <th className="px-3 py-2 text-left">Responsável</th>
                  <th className="px-3 py-2 text-left">Data Limite</th>
                </tr>
              </thead>

              <tbody>
                {drillItems.map((t) => {
                  const key = t?.key || "—";
                  const summary = t?.summary || "—";
                  const due = t?.dueAltYmd || t?.dueBaseYmd || "";
                  const url =
                    t?._raw?.link ||
                    t?._raw?.url ||
                    (JIRA_BASE_URL
                      ? `${JIRA_BASE_URL.replace(/\/$/, "")}/browse/${key}`
                      : "");

                  return (
                    <tr key={key} className="border-b hover:bg-zinc-50">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
                          >
                            {key}
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <span className="font-semibold">{key}</span>
                        )}
                      </td>

                      <td className="px-3 py-2 min-w-[360px]">{summary}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {t?.status || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {t?.priority || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {t?.owner || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {due ? fmtShortBRFromYmd(due) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
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
  onDrill,
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
      case "dueBuckets":
        return d.dueBucketsCounts || [];
      case "issueType":
        return d.issueTypeCounts || [];
      case "reporter":
        return d.reporterCounts || [];
      case "donePerDay":
        return d.donePerDaySeries || [];
      case "slaCompliance":
        return d.slaCompliance || { pct: 0, targetPct: 90, breach: false };
      case "createdVsDonePerDay":
        return d.createdVsDoneSeries || [];

      default:
        return [];
    }
  }, [dashData, widget.metric, currentViz]);

  let accent = metricAccent(widget.metric);

  if (widget.metric === "slaCompliance") {
    const breach = Boolean(dashData?.slaCompliance?.breach);
    accent = breach ? "#ef4444" : "#22c55e";
  }
  const accentSoft = hexToRgba(accent, 0.14);
  const accentLine = hexToRgba(accent, 0.55);

  return (
    <Card
      className={cn(
        "group relative h-full flex flex-col rounded-3xl border-zinc-200/70 bg-white/70 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.55)] backdrop-blur overflow-hidden",
        !editMode &&
          "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_55px_-35px_rgba(15,23,42,0.60)]"
      )}
      style={{
        "--accent": accent,
        "--accentSoft": accentSoft,
        "--accentLine": accentLine,
      }}
    >
      {/* topo com highlight (dinâmico por métrica) */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--accentLine), transparent)",
        }}
      />

      {/* borda lateral premium */}
      <div
        className="pointer-events-none absolute left-0 top-0 h-full w-[3px] opacity-80"
        style={{
          background:
            "linear-gradient(180deg, transparent, var(--accent), transparent)",
        }}
      />

      {/* glow dinâmico */}
      <div
        className="pointer-events-none absolute -right-14 -top-14 h-32 w-32 rounded-full blur-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ backgroundColor: "var(--accentSoft)" }}
      />

      <CardHeader className="shrink-0 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5",
                  editMode ? "am-dash-drag cursor-move" : "cursor-default"
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

                  <Badge
                    className="rounded-full border bg-white/70 text-zinc-700 shadow-sm backdrop-blur"
                    style={{
                      borderColor: hexToRgba(accent, 0.22),
                      backgroundColor: hexToRgba(accent, 0.08),
                    }}
                  >
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur hover:bg-white hover:shadow-md transition-all"
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur hover:bg-white hover:shadow-md transition-all"
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
          <WidgetBody
            metric={widget.metric}
            viz={currentViz}
            data={data}
            accent={accent}
            onItemClick={(label) => onDrill?.({ metric: widget.metric, label })}
          />
        </div>
      </CardContent>
    </Card>
  );
});

function fmtTooltipValue(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Intl.NumberFormat("pt-BR").format(v);
  }
  return String(v ?? "");
}

function ShadcnChartTooltip({ active, payload, label }) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;

  // título do tooltip (eixo X) ou nome do slice (pizza)
  const title =
    String(label ?? "").trim() ||
    String(payload?.[0]?.payload?.name ?? "").trim() ||
    "—";

  // monta itens do tooltip
  const items = payload
    .map((p) => {
      const color =
        p?.color ||
        p?.fill ||
        p?.payload?.fill ||
        p?.payload?.stroke ||
        "#94a3b8";

      // nome da série (Tickets / Dentro do prazo / etc)
      const nameRaw = String(p?.name ?? p?.dataKey ?? "").trim();
      const name = nameRaw && nameRaw !== "value" ? nameRaw : "Tickets";

      return {
        key: `${name}-${String(p?.dataKey ?? "")}`,
        name,
        color,
        value: p?.value,
      };
    })
    .filter((x) => x.name && x.value !== undefined && x.value !== null);

  // se for pizza/donut, geralmente vem 1 item com name "value" ou "Tickets" — deixa mais clean
  const prettyItems =
    items.length === 1 ? [{ ...items[0], name: "Quantidade" }] : items;

  return (
    <div className="pointer-events-none select-none">
      <div
        className={cn(
          "rounded-xl border border-white/10 bg-zinc-950/90 px-3 py-2",
          "shadow-[0_18px_45px_-30px_rgba(0,0,0,0.90)] backdrop-blur"
        )}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="max-w-[220px] truncate text-[11px] font-medium text-zinc-100">
            {title}
          </div>
        </div>

        <div className="space-y-1">
          {prettyItems.map((it) => (
            <div
              key={it.key}
              className="flex items-center justify-between gap-4 text-[11px]"
            >
              <div className="min-w-0 inline-flex items-center gap-2 text-zinc-200">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: it.color }}
                />
                <span className="max-w-[170px] truncate">{it.name}</span>
              </div>

              <div className="tabular-nums font-semibold text-zinc-50">
                {fmtTooltipValue(it.value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MinimalLegend({ payload }) {
  const items = Array.isArray(payload) ? payload : [];

  // remove duplicados e itens vazios
  const uniq = [];
  const seen = new Set();

  for (const it of items) {
    const label = String(it?.value ?? it?.payload?.name ?? it?.dataKey ?? "")
      .trim()
      .replace(/^value$/i, "Tickets");

    if (!label || seen.has(label)) continue;
    seen.add(label);

    const color =
      it?.color ||
      it?.payload?.fill ||
      it?.payload?.stroke ||
      it?.payload?.color ||
      "#64748b";

    uniq.push({ label, color });
  }

  if (!uniq.length) return null;

  // se tiver muito item (pizza), limita pra não virar bagunça
  const MAX = 10;
  const shown = uniq.slice(0, MAX);
  const remaining = uniq.length - shown.length;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-600">
      {shown.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: it.color }}
          />
          <span className="max-w-[160px] truncate">{it.label}</span>
        </span>
      ))}

      {remaining > 0 ? (
        <span className="text-[11px] text-zinc-400">+{remaining}</span>
      ) : null}
    </div>
  );
}

const RECHARTS_TOOLTIP_BASE = {
  wrapperStyle: { outline: "none", zIndex: 9999, pointerEvents: "none" },
  allowEscapeViewBox: { x: false, y: false }, // ✅ não deixa fugir do chart
  reverseDirection: { x: true, y: true }, // ✅ inverte quando encostar na borda
  offset: 12, // ✅ distância do cursor
  isAnimationActive: false, // ✅ evita flicker/sumiço
};

function WidgetBody({ metric, viz, data, accent = "#3b82f6", onItemClick }) {
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

  if (viz === "composed") {
    const series = Array.isArray(data) ? data : [];
    if (!series.length) return <EmptyChart text="Sem dados suficientes." />;

    return (
      <ChartFrame minHeight={160}>
        {({ width, height }) => (
          <ComposedChart width={width} height={height} data={series}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />

            <RTooltip
              {...RECHARTS_TOOLTIP_BASE}
              content={<ShadcnChartTooltip />}
              cursor={{ stroke: "rgba(15,23,42,0.25)", strokeWidth: 1 }}
            />

            <Legend
              verticalAlign="bottom"
              align="left"
              height={28}
              content={MinimalLegend}
            />

            {/* ✅ Criados (barras empilhadas) */}
            <Bar
              dataKey="createdStory"
              stackId="created"
              name="Criados Principal"
              fill="#3b82f6"
            />

            <Bar
              dataKey="createdSubtask"
              stackId="created"
              name="Criados Subtarefas"
              fill="#06b6d4"
            />

            <Line
              type="monotone"
              dataKey="doneStory"
              name="Concluídos Principal"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
            />

            <Line
              type="monotone"
              dataKey="doneSubtask"
              name="Concluídos Subtarefas"
              stroke="#84cc16"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        )}
      </ChartFrame>
    );
  }

  if (viz === "multiLine") {
    const series = Array.isArray(data) ? data : [];
    if (!series.length) return <EmptyChart text="Sem dados suficientes." />;

    return (
      <ChartFrame minHeight={160}>
        {({ width, height }) => (
          <LineChart width={width} height={height} data={series}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />

            <RTooltip
              {...RECHARTS_TOOLTIP_BASE}
              content={<ShadcnChartTooltip />}
              cursor={{ stroke: "rgba(15,23,42,0.25)", strokeWidth: 1 }}
            />

            <Legend
              verticalAlign="bottom"
              align="left"
              height={28}
              content={MinimalLegend}
            />

            <Line
              type="monotone"
              dataKey="createdStory"
              name="Criados Principal"
              stroke="#3b82f6"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="createdSubtask"
              name="Criados Subtarefas"
              stroke="#06b6d4"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="doneStory"
              name="Concluídos Principal"
              stroke="#22c55e"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="doneSubtask"
              name="Concluídos Subtarefas"
              stroke="#84cc16"
              dot={false}
            />
          </LineChart>
        )}
      </ChartFrame>
    );
  }

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
              <RTooltip
                {...RECHARTS_TOOLTIP_BASE}
                content={<ShadcnChartTooltip />}
                cursor={{ stroke: "rgba(15,23,42,0.25)", strokeWidth: 1 }}
              />

              <Legend
                verticalAlign="bottom"
                align="left"
                height={24}
                content={MinimalLegend}
              />

              <Line
                type="monotone"
                dataKey="value"
                name="Tickets"
                stroke={accent}
                dot={false}
              />
            </LineChart>
          )}
        </ChartFrame>
      );
    }

    return (
      <ChartFrame minHeight={160}>
        {({ width, height }) => (
          <AreaChart width={width} height={height} data={series}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <RTooltip
              {...RECHARTS_TOOLTIP_BASE}
              content={<ShadcnChartTooltip />}
              cursor={{ stroke: "rgba(15,23,42,0.25)", strokeWidth: 1 }}
            />

            <Legend
              verticalAlign="bottom"
              align="left"
              height={24}
              content={MinimalLegend}
            />

            <Area
              type="monotone"
              dataKey="value"
              name="Tickets"
              fill={accent}
              fillOpacity={0.25}
              stroke={accent}
            />
          </AreaChart>
        )}
      </ChartFrame>
    );
  }

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
            <RTooltip
              {...RECHARTS_TOOLTIP_BASE}
              content={<ShadcnChartTooltip />}
              cursor={{ fill: "rgba(15,23,42,0.06)" }}
            />

            <Legend
              verticalAlign="bottom"
              align="left"
              height={32}
              content={MinimalLegend}
            />

            <Bar
              dataKey="dentro"
              stackId="a"
              name="Dentro do prazo"
              fill="#22c55e"
            />
            <Bar
              dataKey="estourada"
              stackId="a"
              name="Data limite estourada"
              fill="#ef4444"
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
              fill="#3b82f6"
            />
          </BarChart>
        )}
      </ChartFrame>
    );
  }

  if (viz === "treemap") {
    const series = Array.isArray(data) ? data : [];
    if (!series.length) return <EmptyChart text="Sem dados para treemap." />;

    return (
      <ChartFrame minHeight={160}>
        {({ width, height }) => (
          <Treemap
            width={width}
            height={height}
            data={series}
            dataKey="value"
            nameKey="name"
            stroke="rgba(255,255,255,0.85)"
            fill={accent}
            isAnimationActive={false}
          >
            <RTooltip content={<ShadcnChartTooltip />} />
          </Treemap>
        )}
      </ChartFrame>
    );
  }

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
              <RTooltip
                {...RECHARTS_TOOLTIP_BASE}
                content={<ShadcnChartTooltip />}
              />

              <Legend
                verticalAlign="bottom"
                align="left"
                height={44}
                content={MinimalLegend}
              />

              <Pie
                data={series}
                dataKey="value"
                nameKey="name"
                cx={width / 2}
                cy={height / 2}
                innerRadius={inner}
                outerRadius={radius}
                onClick={(p) => onItemClick?.(p?.name)}
              >
                {series.map((entry, idx) => (
                  <Cell
                    key={`cell-${idx}`}
                    fill={entry.fill || CHART_COLORS[idx % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
            </PieChart>
          );
        }}
      </ChartFrame>
    );
  }

  if (viz === "barh") {
    const series = Array.isArray(data) ? data : [];
    if (!series.length) return <EmptyChart text="Sem dados para barras." />;

    return (
      <ChartFrame minHeight={160}>
        {({ width, height }) => (
          <BarChart
            layout="vertical"
            width={width}
            height={height}
            data={series}
            margin={{ top: 5, right: 16, bottom: 5, left: 24 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              tick={{ fontSize: 11 }}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11 }}
              width={110}
            />

            <RTooltip
              {...RECHARTS_TOOLTIP_BASE}
              content={<ShadcnChartTooltip />}
              cursor={{ fill: "rgba(15,23,42,0.06)" }}
            />

            <Bar
              dataKey="value"
              name="Tickets"
              fill={accent}
              onClick={(e) => onItemClick?.(e?.payload?.name)}
            >
              {series.map((entry, idx) => (
                <Cell
                  key={`cell-${idx}`}
                  fill={entry?.fill || CHART_COLORS[idx % CHART_COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        )}
      </ChartFrame>
    );
  }

  if (viz === "bar") {
    const series = Array.isArray(data) ? data : [];
    if (!series.length) return <EmptyChart text="Sem dados para barras." />;

    const needsAngle = series.length > 8;

    // ✅ Dataset comum: [{ name, value, fill }]
    const isValueSeries = series.some((x) => typeof x?.value === "number");

    // ✅ Dataset SLA stack (fallback de segurança): [{ name: "SLA", dentro, estourada, ... }]
    const sample = series?.[0] || {};
    const looksLikeStack =
      !isValueSeries && ("dentro" in sample || "estourada" in sample);

    if (looksLikeStack) {
      // Mantém seu comportamento antigo caso chegue dados empilhados aqui por engano
      return (
        <ChartFrame minHeight={160}>
          {({ width, height }) => (
            <BarChart width={width} height={height} data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <RTooltip
                {...RECHARTS_TOOLTIP_BASE}
                content={<ShadcnChartTooltip />}
                cursor={{ fill: "rgba(15,23,42,0.06)" }}
              />

              <Legend
                verticalAlign="bottom"
                align="left"
                height={24}
                content={MinimalLegend}
              />

              <Bar
                dataKey="dentro"
                stackId="a"
                name="Dentro do prazo"
                fill="#22c55e"
              />
              <Bar
                dataKey="estourada"
                stackId="a"
                name="Data limite estourada"
                fill="#ef4444"
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
                fill="#3b82f6"
              />
            </BarChart>
          )}
        </ChartFrame>
      );
    }

    // ✅ CORRETO: gráfico de barras genérico (Status, Owner, Aging, Priority, etc)
    return (
      <ChartFrame minHeight={160}>
        {({ width, height }) => (
          <BarChart
            width={width}
            height={height}
            data={series}
            margin={{ top: 5, right: 16, bottom: needsAngle ? 20 : 5, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11 }}
              angle={needsAngle ? -25 : 0}
              textAnchor={needsAngle ? "end" : "middle"}
            />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <RTooltip
              {...RECHARTS_TOOLTIP_BASE}
              content={<ShadcnChartTooltip />}
              cursor={{ fill: "rgba(15,23,42,0.06)" }}
            />

            <Legend
              verticalAlign="bottom"
              align="left"
              height={24}
              content={MinimalLegend}
            />

            <Bar
              dataKey="value"
              name="Tickets"
              fill={accent}
              onClick={(e) => onItemClick?.(e?.payload?.name)}
            >
              {series.map((entry, idx) => (
                <Cell
                  key={`cell-${idx}`}
                  fill={entry?.fill || CHART_COLORS[idx % CHART_COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        )}
      </ChartFrame>
    );
  }

  if (viz === "gauge") {
    const info = typeof data === "object" && data ? data : null;

    // Quando o widget for slaCompliance, o "data" vai vir do dashData abaixo (ajuste no passo 14)
    // mas aqui garantimos fallback:
    const pct = Number(info?.pct ?? 0);
    const targetPct = Number(info?.targetPct ?? 90);
    const breach = Boolean(info?.breach);

    const safePct = Math.max(0, Math.min(100, pct));

    return (
      <div
        className="h-full rounded-2xl border border-zinc-100 bg-zinc-50/40 p-3 cursor-pointer hover:bg-zinc-50/70 transition"
        onClick={() => onItemClick?.("SLA Compliance")}
        title="Clique para ver os tickets elegíveis"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-zinc-600">
            Meta: <span className="font-semibold">{targetPct}%</span>
          </div>

          {breach ? (
            <Badge className="rounded-full bg-red-600 text-white">
              <AlertTriangle className="mr-1 h-3.5 w-3.5" />
              Abaixo da meta
            </Badge>
          ) : (
            <Badge className="rounded-full bg-green-600 text-white">OK</Badge>
          )}
        </div>

        <div className="mt-2 grid place-items-center">
          <RadialBarChart
            width={240}
            height={180}
            cx="50%"
            cy="60%"
            innerRadius={60}
            outerRadius={90}
            barSize={14}
            data={[{ name: "SLA", value: safePct }]}
            startAngle={180}
            endAngle={0}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />

            <RadialBar
              background
              clockWise
              dataKey="value"
              cornerRadius={8}
              fill={accent}
            />
          </RadialBarChart>

          <div className="-mt-10 text-center">
            <div className="text-4xl font-bold tracking-tight text-zinc-900">
              {safePct.toFixed(1)}%
            </div>
            <div className="text-xs text-zinc-500">SLA Compliance</div>
          </div>
        </div>
      </div>
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

function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  return [ref, width];
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
      className="relative h-full w-full min-w-0 overflow-visible rounded-2xl border border-zinc-100/70 bg-gradient-to-br from-white to-zinc-50/50 p-2"
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
