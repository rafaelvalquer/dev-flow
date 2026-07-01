// src/components/GanttTab.jsx
import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import { Gantt, ViewMode } from "@rsagiev/gantt-task-react-19";
import "@rsagiev/gantt-task-react-19/dist/index.css";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  GripVertical,
  HelpCircle,
  History,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Link2,
  Link2Off,
} from "lucide-react";

import GanttTaskInspectorDrawer from "./GanttTaskInspectorDrawer";
import {
  addBusinessDays,
  businessDurationDays,
  findHolidayForDate,
  isWorkingDay,
  nextWorkingDay,
  normalizeCalendarSettings,
} from "@/utils/businessCalendar";
import {
  applySimulationDrafts,
  buildSimulationBaseline,
  buildStructuredFilterOptions,
  detectDependencyViolations,
  detectResourceConflicts,
  getSimulationChanges,
  hasSimulationChanges,
  upsertDateDrafts,
  upsertMetaDraft,
} from "./gantt/ganttSimulation";

/* =========================
   Helpers
========================= */
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

function fmtDateBR(d) {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function fmtDateTimeBR(d) {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toDateInputValue(d) {
  const date = safeDate(d);
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safeDate(v) {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v;
  }

  // ✅ evita timezone shift do "YYYY-MM-DD" (que o JS interpreta como UTC)
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    const local = new Date(y, m - 1, d); // local midnight
    return Number.isNaN(local.getTime()) ? null : local;
  }

  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function inclusiveDurationDays(start, end, calendarSettings) {
  if (calendarSettings) {
    return businessDurationDays(start, end, calendarSettings);
  }

  const s = safeDate(start);
  const e = safeDate(end);
  if (!s || !e) return 1;
  const diff = e.getTime() - s.getTime();
  return Math.max(1, Math.ceil(diff / MS_PER_DAY) + 1);
}

function endFromInclusiveDays(start, days, calendarSettings) {
  const s = safeDate(start);
  if (!s) return null;
  const duration = Math.max(1, parseInt(String(days || 1), 10) || 1);
  if (calendarSettings) {
    const workingStart = nextWorkingDay(s, calendarSettings, {
      includeCurrent: true,
    });
    return addBusinessDays(workingStart || s, duration, calendarSettings);
  }
  return addDays(s, duration - 1);
}

function nextStartAfterEnd(end, calendarSettings) {
  const nextDay = addDays(end, 1);
  return calendarSettings
    ? nextWorkingDay(nextDay, calendarSettings, { includeCurrent: true })
    : nextDay;
}

function inclusiveEndFromCalendarEvent(start, eventEnd) {
  const s = safeDate(start);
  const e = safeDate(eventEnd);
  if (!s) return null;
  if (!e) return s;

  const inclusiveEnd = addDays(e, -1);
  return inclusiveEnd < s ? s : inclusiveEnd;
}

function isDoneStatus(statusName) {
  const s = String(statusName || "").toUpperCase();
  return /(DONE|CONCLU|RESOLV|CLOSED|FECHAD)/i.test(s);
}

function getIssueKeyFromTaskId(id) {
  const s = String(id || "");
  if (!s) return "";
  if (s.startsWith("P::")) return s.replace(/^P::/, "").trim();
  const parts = s.split("::");
  return String(parts?.[0] || "")
    .trim()
    .toUpperCase();
}

function getActivityIdFromTaskId(id) {
  const s = String(id || "");
  if (!s || s.startsWith("P::")) return "";
  const parts = s.split("::");
  return String(parts?.[1] || "").trim();
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

  // fim do dia
  const d = new Date(`${s}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function userName(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(userName).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return String(
      value.displayName ||
        value.name ||
        value.value ||
        value.label ||
        value.emailAddress ||
        value.key ||
        ""
    ).trim();
  }
  return String(value).trim();
}

function getIssueOwnerName(issue) {
  return (
    userName(issue?.assignee) ||
    userName(issue?.responsavel) ||
    userName(issue?.owner) ||
    userName(issue?.fields?.assignee) ||
    "Sem responsável"
  );
}

function calcOverdueDays({ dueDate, statusName }) {
  if (!dueDate) return 0;
  if (isDoneStatus(statusName)) return 0;

  const now = new Date();
  if (now.getTime() <= dueDate.getTime()) return 0;

  const ms = now.getTime() - dueDate.getTime();
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return Math.max(1, days || 1);
}

/* =========================
   Tooltip do Gantt (remove "From/To")
========================= */
function GanttTooltipContent({ task, fontSize, fontFamily }) {
  if (isGanttWindowBoundaryTask(task)) return null;

  const isProject = task?.type === "project";
  const issueKey = getIssueKeyFromTaskId(task?.id) || task?.issueKey || "—";

  return (
    <div
      style={{ fontSize, fontFamily }}
      className="min-w-[220px] rounded-xl border border-zinc-200 bg-white p-3 shadow-md"
    >
      <div className="flex items-center gap-2">
        <div className="text-xs font-semibold text-zinc-900">
          {isProject ? `Ticket ${issueKey}` : task?.name || "—"}
        </div>

        {!isProject && task?.risk ? (
          <Badge className="rounded-full bg-orange-600 text-white">Risco</Badge>
        ) : null}
      </div>

      {!isProject ? (
        <div className="mt-1 text-[11px] text-zinc-600">
          {issueKey}
          {task?.recurso ? ` • ${task.recurso}` : ""}
        </div>
      ) : null}

      <div className="mt-2 text-[11px] font-semibold text-zinc-800">
        {fmtDateBR(getTaskOriginalStart(task))} —{" "}
        {fmtDateBR(getTaskOriginalEnd(task))}
      </div>

      {!isProject && task?.isSimulationChanged ? (
        <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">
          Baseline: {fmtDateBR(task.baselineStart)} -{" "}
          {fmtDateBR(task.baselineEnd)}
        </div>
      ) : null}

      {!isProject && task?.area ? (
        <div className="mt-1 text-[11px] text-zinc-500">Área: {task.area}</div>
      ) : null}
    </div>
  );
}

/* =========================
   Cores (mesma ideia do calendário)
========================= */
const CALENDAR_PALETTE = [
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
};

const ATIVIDADE_LABEL_BY_ID = {
  devUra: "Desenvolvimento de URA",
  rdm: "Preenchimento RDM",
  gmud: "Aprovação GMUD",
  hml: "Homologação",
  deploy: "Implantação",
};

function hashStringToIndex(str, mod) {
  const s = String(str || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return mod ? h % mod : 0;
}

function pickColor(key) {
  const k = String(key || "—");
  const idx = hashStringToIndex(k, CALENDAR_PALETTE.length);
  return CALENDAR_PALETTE[idx];
}

const GANTT_PAN_BLOCKED_SELECTOR = [
  "input",
  "button",
  "select",
  "textarea",
  "a",
  "[role='button']",
  "[contenteditable='true']",
  ".cursor-col-resize",
  "[data-gantt-row-drag='true']",
  "._KxSXS",
  "._RRr13",
  "._1KJ6x",
  "._3w_5u",
].join(",");

function isGanttPanBlockedTarget(target) {
  if (!target || typeof target.closest !== "function") return true;
  return Boolean(target.closest(GANTT_PAN_BLOCKED_SELECTOR));
}

function isGanttTimelinePanTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  return Boolean(target.closest("._CZjuD, ._2B2zv, svg"));
}

function getTaskOriginalStart(task) {
  return task?.originalStart instanceof Date ? task.originalStart : task?.start;
}

function getTaskOriginalEnd(task) {
  return task?.originalEnd instanceof Date ? task.originalEnd : task?.end;
}

function cloneDate(date) {
  return date instanceof Date ? new Date(date.getTime()) : date;
}

function addCalendarWindow(date, amount, viewMode) {
  const next = new Date(date);
  if (viewMode === ViewMode.Month) {
    next.setMonth(next.getMonth() + amount);
    return next;
  }
  if (viewMode === ViewMode.Year) {
    next.setFullYear(next.getFullYear() + amount);
    return next;
  }
  next.setDate(next.getDate() + amount);
  return next;
}

function getGanttWindowSpanDays(viewMode) {
  if (viewMode === ViewMode.Day) return 30;
  if (viewMode === ViewMode.Week) return 84;
  if (viewMode === ViewMode.Month) return 365;
  return 1095;
}

function getGanttColumnWidth(viewMode) {
  if (viewMode === ViewMode.Day) return 48;
  if (viewMode === ViewMode.Week) return 70;
  return 90;
}

function getGanttTimelineColumns(viewMode) {
  const spanDays = getGanttWindowSpanDays(viewMode);
  if (viewMode === ViewMode.Day) return spanDays;
  if (viewMode === ViewMode.Week) return Math.ceil(spanDays / 7);
  if (viewMode === ViewMode.Month) return Math.ceil(spanDays / 30);
  return Math.ceil(spanDays / 365);
}

const GANTT_RANGE_LABELS = [
  ["Day", ViewMode.Day],
  ["Week", ViewMode.Week],
  ["Month", ViewMode.Month],
  ["Year", ViewMode.Year],
];

function parsePxValue(value) {
  const parsed = parseFloat(String(value || "").replace("px", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isGanttWindowBoundaryTask(task) {
  return Boolean(task?.isWindowBoundary);
}

function makeGanttWindowBoundaryTask(id, date) {
  const safeBoundaryDate = safeDate(date) || new Date();
  return {
    id,
    name: "",
    type: "task",
    start: cloneDate(safeBoundaryDate),
    end: cloneDate(safeBoundaryDate),
    progress: 0,
    isDisabled: true,
    isWindowBoundary: true,
    displayOrder: Number.POSITIVE_INFINITY,
    styles: {
      backgroundColor: "transparent",
      backgroundSelectedColor: "transparent",
      progressColor: "transparent",
      progressSelectedColor: "transparent",
    },
  };
}

function getTaskIssueKey(task) {
  return String(task?.issueKey || getIssueKeyFromTaskId(task?.id))
    .trim()
    .toUpperCase();
}

function getTaskActivityId(task) {
  return String(task?.activityId || getActivityIdFromTaskId(task?.id)).trim();
}

function getDropPositionFromRowElement(rowEl, clientY) {
  if (!(rowEl instanceof Element)) return "after";
  const rect = rowEl.getBoundingClientRect();
  const y = clientY - rect.top;
  return y < rect.height / 2 ? "before" : "after";
}

function makeEmptyRowDragState() {
  return {
    sourceId: "",
    targetId: "",
    position: "after",
    startX: 0,
    startY: 0,
    isDragging: false,
    pointerId: null,
  };
}

function reorderTaskIds(tasks, sourceId, targetId, position = "after") {
  const rows = Array.isArray(tasks) ? tasks : [];
  const source = rows.find((task) => String(task?.id || "") === String(sourceId));
  const target = rows.find((task) => String(task?.id || "") === String(targetId));
  if (!source || !target) return null;
  if (source.type !== "task" || target.type !== "task") return null;
  if (source.id === target.id) return null;

  const issueKey = getTaskIssueKey(source);
  if (!issueKey || issueKey !== getTaskIssueKey(target)) return null;

  const issueTaskIds = rows
    .filter((task) => task?.type === "task" && getTaskIssueKey(task) === issueKey)
    .map((task) => task.id);

  if (!issueTaskIds.includes(source.id) || !issueTaskIds.includes(target.id)) {
    return null;
  }

  const nextIds = issueTaskIds.filter((id) => id !== source.id);
  const targetIndex = nextIds.indexOf(target.id);
  if (targetIndex < 0) return null;

  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  nextIds.splice(insertIndex, 0, source.id);
  return nextIds;
}

function refreshTaskDependencies(tasks) {
  const previousByIssue = new Map();
  return (Array.isArray(tasks) ? tasks : []).map((task) => {
    if (!task || task.type !== "task") return task;

    const issueKey = getTaskIssueKey(task);
    const prevId = previousByIssue.get(issueKey);
    previousByIssue.set(issueKey, task.id);
    return { ...task, dependencies: prevId ? [prevId] : [] };
  });
}

function applyReorderPreview(tasks, sourceId, targetId, position) {
  const rows = Array.isArray(tasks) ? tasks : [];
  const nextIssueIds = reorderTaskIds(rows, sourceId, targetId, position);
  if (!nextIssueIds) return rows;

  const source = rows.find((task) => String(task?.id || "") === String(sourceId));
  const issueKey = getTaskIssueKey(source);
  const byId = new Map(rows.map((task) => [task?.id, task]));
  const reorderedQueue = nextIssueIds.map((id) => byId.get(id)).filter(Boolean);

  const nextRows = rows.map((task) => {
    if (task?.type !== "task" || getTaskIssueKey(task) !== issueKey) return task;
    return reorderedQueue.shift() || task;
  });

  return refreshTaskDependencies(nextRows);
}

function isNativeScrollbarHit(el, e) {
  const rect = el.getBoundingClientRect();
  const scrollbarSize = 18;
  const hasHorizontal = el.scrollWidth > el.clientWidth;
  const hasVertical = el.scrollHeight > el.clientHeight;

  if (hasHorizontal && e.clientY >= rect.bottom - scrollbarSize) return true;
  if (hasVertical && e.clientX >= rect.right - scrollbarSize) return true;
  return false;
}

function groupAtividadeName(rawName) {
  const original = String(rawName || "").trim();
  if (!original) return "sem atividade";

  let s = original.replace(/\([^)]*\)/g, " ");
  s = s.replace(/\s*[-:]\s*.*$/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  const key = normalizeStr(s || original)
    .replace(/\s+/g, " ")
    .trim();
  return key || "sem atividade";
}

function buildLegendItems(tasks, colorMode) {
  const items = new Map();

  for (const t of tasks || []) {
    if (!t || t.type !== "task") continue;

    let key = "—";
    let label = "—";

    if (colorMode === "ticket") {
      key = t.issueKey || getIssueKeyFromTaskId(t.id);
      label = key || "—";
    } else if (colorMode === "recurso") {
      key = t.recurso || "Sem recurso";
      label = key;
    } else if (colorMode === "atividade") {
      key = t.activityId || groupAtividadeName(t.name);
      label = ATIVIDADE_LABEL_BY_ID[t.activityId] || key;
    } else {
      key = t.issueKey || "—";
      label = key || "—";
    }

    const color = t.styles?.backgroundColor || "#111827";
    if (!items.has(key)) items.set(key, { key, label, color });
  }

  return Array.from(items.values()).sort((a, b) =>
    String(a.label).localeCompare(String(b.label))
  );
}

const PO_CHAIN = ["devUra", "rdm", "gmud", "hml", "deploy"];

/* =========================
   Build tasks (SEU CÓDIGO - mantido + metaOverrides)
========================= */
export function buildGanttTasksFromViewData({
  viewData,
  colorMode,
  filterText,
  onlyInProgress,
  selectedIssueKey,
  groupByTicket,
  quickView,
  collapsedProjects,
  orderOverrides,
  metaOverrides, // ✅ NOVO
  resourceFilter,
  areaFilter,
}) {
  const issues = Array.isArray(viewData?.calendarioIssues)
    ? viewData.calendarioIssues
    : [];
  const events = Array.isArray(viewData?.events) ? viewData.events : [];

  const dateIndex = new Map();
  for (const ev of events) {
    const p = ev?.extendedProps || {};
    const issueKey = String(p.issueKey || ev?.issueKey || "")
      .trim()
      .toUpperCase();
    const activityId = String(p.activityId || "").trim();
    if (!issueKey || !activityId) continue;

    const start = safeDate(ev?.start);
    if (!start) continue;

    // Eventos do calendário usam end exclusivo; o Gantt trabalha com fim inclusivo.
    const end = inclusiveEndFromCalendarEvent(start, ev?.end);

    dateIndex.set(`${issueKey}::${activityId}`, { start, end });
  }

  const metaIndex = new Map();
  for (const iss of issues) {
    const issueKey = String(iss?.key || "")
      .trim()
      .toUpperCase();
    const atividades = Array.isArray(iss?.atividades) ? iss.atividades : [];
    for (const atv of atividades) {
      const activityId = String(atv?.id || "").trim();
      if (!issueKey || !activityId) continue;

      const riscoStr = String(atv?.risco || "").trim();
      const riskFlag = Boolean(atv?.risk) || Boolean(riscoStr);

      metaIndex.set(`${issueKey}::${activityId}`, {
        recurso: String(atv?.recurso || "").trim() || "Sem recurso",
        area: String(atv?.area || "").trim() || "—",
        risk: riskFlag, // ✅ agora entende risco vindo do cronograma
        activityName: String(atv?.name || "").trim() || activityId,
        statusName: String(iss?.statusName || iss?.status || ""),
        summary: String(iss?.summary || ""),
      });
    }
  }

  const filteredIssues = issues.filter((iss) => {
    const issueKey = String(iss?.key || "")
      .trim()
      .toUpperCase();
    if (!issueKey) return false;

    if (onlyInProgress && isDoneStatus(iss?.statusName || iss?.status)) {
      return false;
    }

    if (selectedIssueKey && issueKey !== selectedIssueKey) return false;

    return true;
  });

  const outTasks = [];

  for (const iss of filteredIssues) {
    const issueKey = String(iss?.key || "")
      .trim()
      .toUpperCase();
    const atividades = Array.isArray(iss?.atividades) ? iss.atividades : [];
    if (!issueKey) continue;

    const activityTasks = [];
    for (const atv of atividades) {
      const activityId = String(atv?.id || "").trim();
      if (!activityId) continue;

      const range = dateIndex.get(`${issueKey}::${activityId}`);
      if (!range) continue;

      const baseMeta = metaIndex.get(`${issueKey}::${activityId}`) || {};

      // ✅ aplica override otimista (recurso/área/risco)
      const override = metaOverrides?.get?.(`${issueKey}::${activityId}`) || {};
      const mergedMeta = {
        ...baseMeta,
        ...override,
      };

      const name =
        ATIVIDADE_LABEL_BY_ID[activityId] ||
        mergedMeta.activityName ||
        atv?.name ||
        activityId;

      activityTasks.push({
        id: `${issueKey}::${activityId}`,
        name,
        type: "task",
        start: range.start,
        end: range.end,
        progress: 0,
        isDisabled: false,
        project: groupByTicket ? `P::${issueKey}` : undefined,

        issueKey,
        activityId,

        recurso: String(mergedMeta.recurso || "").trim() || "Sem recurso",
        area: String(mergedMeta.area || "").trim() || "—",
        risk: Boolean(mergedMeta.risk),

        statusName: mergedMeta.statusName || "",
        summary: mergedMeta.summary || "",
      });
    }

    if (!activityTasks.length) continue;

    const issueOwnerName = getIssueOwnerName(iss);
    let ordered = [...activityTasks];

    const customOrder = orderOverrides?.get?.(issueKey) || null;

    if (Array.isArray(customOrder) && customOrder.length) {
      const orderIndex = new Map(customOrder.map((id, idx) => [id, idx]));
      ordered.sort((a, b) => {
        const ai = orderIndex.has(a.activityId)
          ? orderIndex.get(a.activityId)
          : Number.MAX_SAFE_INTEGER;
        const bi = orderIndex.has(b.activityId)
          ? orderIndex.get(b.activityId)
          : Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return a.start.getTime() - b.start.getTime();
      });
    } else if (quickView === "po") {
      const chain = [];
      const rest = [];

      for (const t of ordered) {
        if (PO_CHAIN.includes(t.activityId)) chain.push(t);
        else rest.push(t);
      }

      chain.sort(
        (a, b) =>
          PO_CHAIN.indexOf(a.activityId) - PO_CHAIN.indexOf(b.activityId)
      );
      rest.sort((a, b) => a.start.getTime() - b.start.getTime());

      ordered = [...chain, ...rest];
    } else {
      ordered.sort((a, b) => a.start.getTime() - b.start.getTime());
    }

    const withDeps = ordered.map((t, idx) => {
      if (idx === 0) return { ...t, dependencies: [] };
      const prev = ordered[idx - 1];
      return { ...t, dependencies: [prev.id] };
    });

    if (groupByTicket) {
      const minStart = withDeps.reduce(
        (acc, t) => (t.start < acc ? t.start : acc),
        withDeps[0].start
      );
      const maxEnd = withDeps.reduce(
        (acc, t) => (t.end > acc ? t.end : acc),
        withDeps[0].end
      );

      const projectId = `P::${issueKey}`;
      outTasks.push({
        id: projectId,
        name: `${issueKey}${iss?.summary ? ` — ${iss.summary}` : ""}`,
        type: "project",
        start: minStart,
        end: maxEnd,
        progress: 0,
        isDisabled: true,
        hideChildren: collapsedProjects?.has(projectId) || false,

        issueKey,
        activityId: "",
        recurso: issueOwnerName,
        area: "",
        risk: false,

        statusName: String(iss?.statusName || iss?.status || ""),
        summary: String(iss?.summary || ""),
      });
    }

    outTasks.push(...withDeps);
  }

  const q = normalizeStr(filterText);
  const filteredByText = !q
    ? outTasks
    : outTasks.filter((t) => {
        const hay = normalizeStr(
          [
            t.issueKey,
            t.name,
            t.activityId,
            t.recurso,
            t.area,
            t.summary,
          ].join(" ")
        );
        return hay.includes(q);
      });

  let finalTasks = filteredByText;

  const normalizedResourceFilter = String(resourceFilter || "").trim();
  const normalizedAreaFilter = String(areaFilter || "").trim();
  const hasStructuredFilters = Boolean(
    normalizedResourceFilter || normalizedAreaFilter
  );

  if (hasStructuredFilters) {
    const matchingIssueKeys = new Set();
    const matchingTaskIds = new Set();

    for (const t of filteredByText) {
      if (t?.type !== "task") continue;
      const matchesResource =
        !normalizedResourceFilter ||
        String(t.recurso || "").trim() === normalizedResourceFilter;
      const matchesArea =
        !normalizedAreaFilter ||
        String(t.area || "").trim() === normalizedAreaFilter;

      if (matchesResource && matchesArea) {
        matchingTaskIds.add(t.id);
        if (t.issueKey) matchingIssueKeys.add(t.issueKey);
      }
    }

    finalTasks = filteredByText.filter((t) => {
      if (t?.type === "project") return matchingIssueKeys.has(t.issueKey);
      return matchingTaskIds.has(t?.id);
    });
  }

  const conflictSet = new Set();
  if (quickView === "risco") {
    const byRes = new Map();
    for (const t of finalTasks) {
      if (t.type !== "task") continue;
      const r = String(t.recurso || "Sem recurso");
      if (!byRes.has(r)) byRes.set(r, []);
      byRes.get(r).push(t);
    }

    for (const [, list] of byRes.entries()) {
      list.sort((a, b) => a.start.getTime() - b.start.getTime());
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const cur = list[i];
        if (cur.start < prev.end) {
          conflictSet.add(prev.id);
          conflictSet.add(cur.id);
        }
      }
    }
  }

  const colorMap = new Map();
  for (const t of finalTasks) {
    let colorKey = "—";
    if (colorMode === "ticket") colorKey = t.issueKey || "—";
    else if (colorMode === "recurso") colorKey = t.recurso || "Sem recurso";
    else if (colorMode === "atividade") {
      colorKey = t.activityId || groupAtividadeName(t.name);
    }

    if (!colorMap.has(colorKey)) {
      const fixed =
        colorMode === "atividade"
          ? ATIVIDADE_COLOR_BY_ID[colorKey] || null
          : null;

      colorMap.set(colorKey, fixed || pickColor(colorKey));
    }
  }

  finalTasks = finalTasks.map((t) => {
    let colorKey = "—";
    if (colorMode === "ticket") colorKey = t.issueKey || "—";
    else if (colorMode === "recurso") colorKey = t.recurso || "Sem recurso";
    else if (colorMode === "atividade") {
      colorKey = t.activityId || groupAtividadeName(t.name);
    }

    const baseColor = colorMap.get(colorKey) || pickColor(colorKey);

    // quickView risco/overlap = laranja
    const color =
      quickView === "risco" && conflictSet.has(t.id) ? "#F97316" : baseColor;

    return {
      ...t,
      styles: {
        backgroundColor: color,
        backgroundSelectedColor: color,
        progressColor: color,
        progressSelectedColor: color,
      },
    };
  });

  const ticketOptions = filteredIssues
    .map((x) =>
      String(x?.key || "")
        .trim()
        .toUpperCase()
    )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return { tasks: finalTasks, conflictSet, ticketOptions };
}

/* =========================
   Colunas redimensionáveis
========================= */
const DEFAULT_COL_WIDTHS = {
  ticket: 100,
  atividade: 250,
  recurso: 90,
  area: 70,
  dur: 54,
  start: 96,
  end: 96,
  chain: 42,
};

const MIN_COL_WIDTHS = {
  ticket: 82,
  atividade: 150,
  recurso: 72,
  area: 56,
  dur: 40,
  start: 94,
  end: 94,
  chain: 42,
};

const GANTT_COLUMN_ORDER = [
  "ticket",
  "atividade",
  "recurso",
  "area",
  "dur",
  "start",
  "end",
  "chain",
];
const GANTT_STICKY_COLUMNS = ["ticket", "atividade", "recurso"];
const GANTT_MOBILE_STICKY_COLUMNS = ["ticket", "atividade"];
const GANTT_GRID_GAP_PX = 8;
const GANTT_GRID_PADDING_X_PX = 12;
const GANTT_MAX_VISIBLE_LIST_WIDTH_PX = 560;

function makeGridTemplate(w) {
  const x = w || DEFAULT_COL_WIDTHS;
  return `${x.ticket}px ${x.atividade}px ${x.recurso}px ${x.area}px ${x.dur}px ${x.start}px ${x.end}px ${x.chain}px`;
}

function getGanttTotalListWidth(colWidths) {
  const widths = colWidths || DEFAULT_COL_WIDTHS;
  const sum = GANTT_COLUMN_ORDER.reduce(
    (acc, key) => acc + Number(widths?.[key] ?? DEFAULT_COL_WIDTHS[key] ?? 0),
    0
  );
  return sum + (GANTT_COLUMN_ORDER.length - 1) * GANTT_GRID_GAP_PX + 24;
}

function getGanttStickyListWidth(colWidths) {
  const widths = colWidths || DEFAULT_COL_WIDTHS;
  const sum = GANTT_STICKY_COLUMNS.reduce(
    (acc, key) => acc + Number(widths?.[key] ?? DEFAULT_COL_WIDTHS[key] ?? 0),
    0
  );
  return sum + (GANTT_STICKY_COLUMNS.length - 1) * GANTT_GRID_GAP_PX + 24;
}

function getStickyColumnOffsets(colWidths) {
  const widths = colWidths || DEFAULT_COL_WIDTHS;
  const offsets = {};
  let left = 0;

  for (const key of GANTT_COLUMN_ORDER) {
    offsets[key] = left;
    left += Number(widths?.[key] ?? DEFAULT_COL_WIDTHS[key] ?? 0);
    left += GANTT_GRID_GAP_PX;
  }

  return offsets;
}

function getColumnCellStyle(colKey, colWidths, stickyConfig = {}) {
  const stickyColumns = stickyConfig.stickyColumns || GANTT_STICKY_COLUMNS;
  if (!stickyColumns.includes(colKey)) return undefined;

  const offsets = getStickyColumnOffsets(colWidths);
  return {
    position: "sticky",
    left: `${GANTT_GRID_PADDING_X_PX + (offsets[colKey] || 0)}px`,
    zIndex: stickyConfig.isHeader ? 32 : 22,
  };
}

function getColumnCellClass(colKey, isHeader = false, rowBgClass = "bg-white") {
  const isSticky = GANTT_STICKY_COLUMNS.includes(colKey);
  const isMobileSticky = GANTT_MOBILE_STICKY_COLUMNS.includes(colKey);
  const isDesktopStickyTail =
    colKey === GANTT_STICKY_COLUMNS[GANTT_STICKY_COLUMNS.length - 1];
  const isMobileStickyTail =
    colKey ===
    GANTT_MOBILE_STICKY_COLUMNS[GANTT_MOBILE_STICKY_COLUMNS.length - 1];

  return cn(
    "min-w-0",
    isHeader ? "bg-zinc-50" : rowBgClass,
    isSticky && "gantt-sticky-cell",
    isSticky && !isMobileSticky && "gantt-sticky-desktop-only",
    isDesktopStickyTail && "gantt-sticky-tail",
    isMobileStickyTail && "gantt-sticky-mobile-tail"
  );
}

/* =========================
   TaskListHeader (CUSTOM) - RESIZE
========================= */
function TaskListHeaderFactory({ colWidthsRef, beginResize }) {
  return function TaskListHeader({ headerHeight, rowWidth }) {
    const currentColWidths = colWidthsRef.current;
    const gridTemplateColumns = makeGridTemplate(currentColWidths);

    const HeaderCell = ({ label, colKey }) => (
      <div
        style={getColumnCellStyle(colKey, currentColWidths, {
          isHeader: true,
        })}
        className={cn(
          getColumnCellClass(colKey, true),
          "relative select-none pr-2"
        )}
      >
        <span className="truncate">{label}</span>
        <div
          className="absolute right-0 top-0 z-20 h-full w-2 cursor-col-resize"
          title="Arraste para ajustar a largura"
          onMouseDown={(e) => beginResize(e, colKey)}
        />
      </div>
    );

    return (
      <div
        style={{ height: headerHeight, width: rowWidth, gridTemplateColumns }}
        className="grid gap-2 overflow-hidden border-r border-zinc-200 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] font-semibold text-zinc-700"
      >
        <HeaderCell label="Ticket" colKey="ticket" />
        <HeaderCell label="Atividade" colKey="atividade" />
        <HeaderCell label="Recurso" colKey="recurso" />
        <HeaderCell label="Área" colKey="area" />
        <HeaderCell label="Dias" colKey="dur" />
        <HeaderCell label="Start" colKey="start" />
        <HeaderCell label="End" colKey="end" />
        <HeaderCell label="Encadear" colKey="chain" />
      </div>
    );
  };
}

/* =========================
   TaskListTable (CUSTOM)
   ✅ Recurso/Área editáveis
   ✅ Clique abre inspector
========================= */
function TaskListTableFactory({
  onOpenDetails,
  conflictSet,
  onToggleProject,
  colWidthsRef,
  chainSet,
  lockedSet,
  onToggleChain,
  onChangeDuration,
  onChangeDate,
  onChangeMeta, // ✅ NOVO
  simulationBaseline,
  dependencyViolationSet,
  isSimulationMode,
  rowDragStateRef,
  onRowPointerDown,
  busy,
  getDurationDays,

  onOpenInspectorByTaskId, // ✅ NOVO
  ganttSetSelectedTaskIdRef, // ✅ NOVO (ref p/ selecionar via Drawer)
}) {
  return function TaskListTable({
    rowHeight,
    rowWidth,
    tasks,
    selectedTaskId,
    setSelectedTask,
  }) {
    // ✅ expõe pro pai (Drawer selecionar task)
    useEffect(() => {
      ganttSetSelectedTaskIdRef.current = setSelectedTask;
    }, [setSelectedTask]);

    const taskRows = tasks.filter(
      (t) =>
        !isGanttWindowBoundaryTask(t) &&
        (t.type === "task" || t.type === "project")
    );
    const taskByRowId = useMemo(
      () => new Map(taskRows.map((t) => [String(t.id || ""), t])),
      [taskRows]
    );
    const [hoveredTaskId, setHoveredTaskId] = useState("");
    const dependencyTrailSet = useMemo(() => {
      const activeId = String(hoveredTaskId || selectedTaskId || "");
      if (!activeId) return new Set();
      const byId = new Map(
        taskRows
          .filter((task) => task?.type === "task")
          .map((task) => [String(task.id || ""), task])
      );
      const next = new Set([activeId]);
      const visitPredecessors = (taskId) => {
        const task = byId.get(String(taskId || ""));
        const deps = Array.isArray(task?.dependencies) ? task.dependencies : [];
        for (const depId of deps) {
          const id = String(depId || "");
          if (!id || next.has(id)) continue;
          next.add(id);
          visitPredecessors(id);
        }
      };
      const visitSuccessors = (taskId) => {
        for (const task of byId.values()) {
          const deps = Array.isArray(task?.dependencies)
            ? task.dependencies.map((id) => String(id || ""))
            : [];
          if (!deps.includes(String(taskId || ""))) continue;
          const id = String(task.id || "");
          if (!id || next.has(id)) continue;
          next.add(id);
          visitSuccessors(id);
        }
      };
      visitPredecessors(activeId);
      visitSuccessors(activeId);
      return next;
    }, [hoveredTaskId, selectedTaskId, taskRows]);
    const currentColWidths = colWidthsRef.current;
    const gridTemplateColumns = makeGridTemplate(currentColWidths);

    function calcDurationDays(t) {
      return (
        getDurationDays?.(getTaskOriginalStart(t), getTaskOriginalEnd(t), t) ||
        inclusiveDurationDays(getTaskOriginalStart(t), getTaskOriginalEnd(t))
      );
    }

    // ✅ edição inline (Dias)
    const [editingDurId, setEditingDurId] = useState(null);
    const [editingDurValue, setEditingDurValue] = useState("");
    const [editingDate, setEditingDate] = useState({
      id: null,
      field: null,
      value: "",
    });

    // ✅ edição inline (Recurso/Área)
    const [editingMeta, setEditingMeta] = useState({
      id: null,
      field: null, // "recurso" | "area"
      value: "",
    });

    const canDropOnTask = (sourceId, target) => {
      const source = taskByRowId.get(String(sourceId || ""));
      if (!source || !target) return false;
      if (source.type !== "task" || target.type !== "task") return false;
      if (source.id === target.id) return false;
      return String(source.issueKey || "") === String(target.issueKey || "");
    };

    const beginEditMeta = (t, field) => {
      if (!t || t.type !== "task") return;
      setEditingMeta({
        id: t.id,
        field,
        value: String(t?.[field] || "").trim(),
      });
    };

    const commitEditMeta = (t) => {
      if (!t || t.type !== "task") return;

      const { id, field, value } = editingMeta || {};
      if (id !== t.id || !field) return;

      const trimmed = String(value || "").trim();

      // validação simples / fallback
      const nextValue =
        field === "recurso" ? trimmed || "Sem recurso" : trimmed || "—";

      setEditingMeta({ id: null, field: null, value: "" });

      const current =
        field === "recurso"
          ? String(t.recurso || "").trim() || "Sem recurso"
          : String(t.area || "").trim() || "—";

      if (nextValue !== current) {
        onChangeMeta?.(t, { [field]: nextValue });
      }
    };

    const beginEditDate = (t, field) => {
      if (!t || t.type !== "task") return;
      setEditingDate({
        id: t.id,
        field,
        value: toDateInputValue(
          field === "start" ? getTaskOriginalStart(t) : getTaskOriginalEnd(t)
        ),
      });
    };

    const commitEditDate = (t) => {
      if (!t || t.type !== "task") return;

      const { id, field, value } = editingDate || {};
      if (id !== t.id || !field) return;

      setEditingDate({ id: null, field: null, value: "" });

      const nextDate = safeDate(value);
      const currentDate = safeDate(
        field === "start" ? getTaskOriginalStart(t) : getTaskOriginalEnd(t)
      );
      if (!nextDate || !currentDate) return;

      if (toDateInputValue(nextDate) !== toDateInputValue(currentDate)) {
        onChangeDate?.(t, field, nextDate);
      }
    };

    return (
      <div
        style={{ width: rowWidth }}
        className="h-full overflow-auto border-r border-zinc-200 bg-white"
      >
        {taskRows.map((t) => {
          const selected = t.id === selectedTaskId;
          const isProject = t.type === "project";
          const activeRowDragState = rowDragStateRef?.current || {};
          const isDragOver = activeRowDragState?.targetId === t.id;
          const baseline = simulationBaseline?.get?.(String(t.id || ""));
          const isSimulationChanged = Boolean(t.isSimulationChanged);
          const isDependencyViolation = dependencyViolationSet?.has?.(t.id);
          const isDependencyTrail =
            !isProject && dependencyTrailSet.has(String(t.id || ""));
          const isDragging =
            activeRowDragState?.isDragging &&
            activeRowDragState?.sourceId === t.id;
          const dropPosition = activeRowDragState?.position || "after";
          const isPointerDragging = Boolean(activeRowDragState?.isDragging);
          const canDropHere = canDropOnTask(activeRowDragState?.sourceId, t);
          const rowBgClass = isDragOver && canDropHere
            ? "bg-red-50"
            : selected
            ? "bg-red-50"
            : isDependencyTrail
            ? "bg-sky-50"
            : isSimulationChanged
            ? "bg-amber-50"
            : "bg-white";

          return (
            <div
              key={t.id}
              data-gantt-row-id={t.id}
              style={{ height: rowHeight, gridTemplateColumns }}
              className={cn(
                "relative grid gap-2 px-3 text-[12px]",
                "border-b border-zinc-100",
                rowBgClass,
                isDragging && "opacity-50",
                isDragOver && canDropHere && "bg-red-50",
                "items-center"
              )}
              onMouseEnter={() => setHoveredTaskId(String(t.id || ""))}
              onMouseLeave={() => setHoveredTaskId("")}
              onClick={() => {
                if (isPointerDragging) return;
                const isEditingThisRow =
                  (editingMeta?.id === t.id && editingMeta?.field) ||
                  editingDurId === t.id ||
                  editingDate.id === t.id;

                if (isEditingThisRow) return;

                setSelectedTask(t.id);
                onOpenInspectorByTaskId?.(t.id);
              }}
            >
              {isDragOver && canDropHere ? (
                <span
                  className={cn(
                    "pointer-events-none absolute left-2 right-2 z-10 h-0.5 rounded-full bg-red-600",
                    dropPosition === "before" ? "top-0" : "bottom-0"
                  )}
                />
              ) : null}

              {/* Ticket */}
              <div
                style={getColumnCellStyle("ticket", currentColWidths)}
                className={cn(
                  getColumnCellClass("ticket", false, rowBgClass),
                  "flex items-center gap-2 overflow-hidden"
                )}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor:
                      t.type === "project"
                        ? "#111827"
                        : t.styles?.backgroundColor || "#111827",
                  }}
                  title="Cor do agrupamento atual"
                />

                <button
                  type="button"
                  className="truncate text-left font-semibold text-red-700 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    const issueKey = getIssueKeyFromTaskId(t.id) || t.issueKey;
                    if (issueKey) onOpenDetails?.(issueKey);
                  }}
                  title="Abrir detalhes"
                >
                  {t.issueKey || getIssueKeyFromTaskId(t.id) || "—"}
                </button>
              </div>

              {/* Atividade */}
              <div
                style={getColumnCellStyle("atividade", currentColWidths)}
                className={cn(
                  getColumnCellClass("atividade", false, rowBgClass),
                  "flex items-center gap-2 overflow-hidden"
                )}
              >
                {isProject ? (
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                    title={t.hideChildren ? "Expandir" : "Recolher"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleProject?.(t);
                    }}
                  >
                    {t.hideChildren ? "+" : "–"}
                  </button>
                ) : null}

                {!isProject ? (
                  <button
                    type="button"
                    data-gantt-row-drag="true"
                    className={cn(
                      "inline-flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 active:cursor-grabbing",
                      busy && "cursor-not-allowed opacity-50"
                    )}
                    title="Arrastar atividade"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => {
                      if (busy || isProject) {
                        e.preventDefault();
                        return;
                      }

                      e.preventDefault();
                      e.stopPropagation();
                      onRowPointerDown?.(e, t.id);
                      setSelectedTask(t.id);
                    }}
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                ) : null}

                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    isProject && "font-semibold"
                  )}
                  title={t.name}
                >
                  {t.name}
                </span>

                {!isProject && t.risk ? (
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white"
                    title="Atividade com risco"
                  >
                    <AlertTriangle className="h-3 w-3" />
                  </span>
                ) : null}

                {!isProject && conflictSet?.has(t.id) ? (
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white"
                    title="Conflito de recurso"
                  >
                    <AlertTriangle className="h-3 w-3" />
                  </span>
                ) : null}

                {!isProject && isDependencyViolation ? (
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"
                    title="Dependência quebrada"
                  >
                    <Link2Off className="h-3 w-3" />
                  </span>
                ) : null}

                {!isProject && isSimulationMode && isSimulationChanged ? (
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700"
                    title={
                      baseline
                        ? `Baseline ${fmtDateBR(baseline.start)} - ${fmtDateBR(
                            baseline.end
                          )}`
                        : "Alteração em simulação"
                    }
                  >
                    S
                  </span>
                ) : null}
              </div>

              {/* ✅ Recurso (editável inline) */}
              <div
                style={getColumnCellStyle("recurso", currentColWidths)}
                className={cn(
                  getColumnCellClass("recurso", false, rowBgClass),
                  "overflow-hidden"
                )}
              >
                {isProject ? (
                  <span
                    className="block truncate text-zinc-600"
                    title={t.recurso || "Sem responsável"}
                  >
                    {t.recurso || "Sem responsável"}
                  </span>
                ) : editingMeta.id === t.id &&
                  editingMeta.field === "recurso" ? (
                  <Input
                    autoFocus
                    disabled={busy}
                    className="h-8 rounded-lg border-zinc-200 bg-white px-2 text-[12px] focus-visible:ring-red-500"
                    value={editingMeta.value}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setEditingMeta((p) => ({ ...p, value: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      e.stopPropagation();

                      if (e.key === "Escape") {
                        setEditingMeta({ id: null, field: null, value: "" });
                        e.currentTarget.blur();
                      }
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={() => commitEditMeta(t)}
                    placeholder="Sem recurso"
                    title="Editar recurso (Enter/blur salva)"
                  />
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      beginEditMeta(t, "recurso"); // ou "area"
                    }}
                    className={cn(
                      "w-full truncate text-left text-zinc-700 hover:underline",
                      busy && "opacity-60"
                    )}
                    title="Clique para editar"
                  >
                    {t.recurso || "Sem recurso"}
                  </button>
                )}
              </div>

              {/* ✅ Área (editável inline) */}
              <div className={getColumnCellClass("area", false, rowBgClass)}>
                {isProject ? (
                  <span className="text-zinc-300">—</span>
                ) : editingMeta.id === t.id && editingMeta.field === "area" ? (
                  <Input
                    autoFocus
                    disabled={busy}
                    className="h-8 rounded-lg border-zinc-200 bg-white px-2 text-[12px] focus-visible:ring-red-500"
                    value={editingMeta.value}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setEditingMeta((p) => ({ ...p, value: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Escape") {
                        setEditingMeta({ id: null, field: null, value: "" });
                        e.currentTarget.blur();
                      }
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={() => commitEditMeta(t)}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      beginEditMeta(t, "area");
                    }}
                    className={cn(
                      "w-full truncate text-left text-zinc-700 hover:underline",
                      busy && "opacity-60"
                    )}
                    title="Clique para editar"
                  >
                    {t.area || "—"}
                  </button>
                )}
              </div>

              {/* ✅ Dias (editável) */}
              <div
                className={cn(
                  getColumnCellClass("dur", false, rowBgClass),
                  "flex items-center"
                )}
              >
                {isProject ? (
                  <span className="text-zinc-300">—</span>
                ) : (
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    disabled={busy || t.isDisabled}
                    className="h-8 w-full rounded-lg border-zinc-200 bg-white px-2 text-center text-[12px] focus-visible:ring-red-500"
                    value={
                      editingDurId === t.id
                        ? editingDurValue
                        : String(calcDurationDays(t))
                    }
                    onFocus={() => {
                      setEditingDurId(t.id);
                      setEditingDurValue(String(calcDurationDays(t)));
                      window.requestAnimationFrame(() => {
                        document.activeElement?.select?.();
                      });
                    }}
                    onSelect={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (editingDurId !== t.id) e.currentTarget.select();
                    }}
                    onChange={(e) => {
                      setEditingDurId(t.id);
                      setEditingDurValue(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Escape") {
                        setEditingDurId(null);
                        setEditingDurValue("");
                        e.currentTarget.blur();
                        return;
                      }
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                        return;
                      }
                      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        e.preventDefault();
                        const current = Math.max(
                          1,
                          parseInt(
                            String(
                              editingDurId === t.id
                                ? editingDurValue
                                : calcDurationDays(t)
                            ),
                            10
                          ) || calcDurationDays(t)
                        );
                        const next =
                          e.key === "ArrowUp"
                            ? current + 1
                            : Math.max(1, current - 1);
                        setEditingDurId(t.id);
                        setEditingDurValue(String(next));
                      }
                    }}
                    onBlur={() => {
                      const current = calcDurationDays(t);

                      const parsed = Math.max(
                        1,
                        parseInt(String(editingDurValue || ""), 10) || current
                      );

                      setEditingDurId(null);
                      setEditingDurValue("");

                      if (parsed !== current) {
                        onChangeDuration?.(t, parsed);
                      }
                    }}
                    title="Duração (dias). Ao alterar, ajusta o End. Se encadeado, empurra as próximas."
                  />
                )}
              </div>

              {/* Start / End */}
              <div
                className={cn(
                  getColumnCellClass("start", false, rowBgClass),
                  "flex items-center"
                )}
              >
                {isProject ? (
                  <span className="text-zinc-700">
                    {fmtDateBR(getTaskOriginalStart(t))}
                  </span>
                ) : (
                  <Input
                    type="date"
                    disabled={busy || t.isDisabled}
                    className="h-8 w-full rounded-lg border-zinc-200 bg-white px-1 text-center text-[12px] focus-visible:ring-red-500"
                    value={
                      editingDate.id === t.id && editingDate.field === "start"
                        ? editingDate.value
                        : toDateInputValue(getTaskOriginalStart(t))
                    }
                    onFocus={() => beginEditDate(t, "start")}
                    onChange={(e) => {
                      setEditingDate({
                        id: t.id,
                        field: "start",
                        value: e.target.value,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setEditingDate({ id: null, field: null, value: "" });
                        e.currentTarget.blur();
                      }
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={() => commitEditDate(t)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    title="Alterar data inicial manualmente"
                  />
                )}
              </div>
              <div
                className={cn(
                  getColumnCellClass("end", false, rowBgClass),
                  "flex items-center"
                )}
              >
                {isProject ? (
                  <span className="text-zinc-700">
                    {fmtDateBR(getTaskOriginalEnd(t))}
                  </span>
                ) : (
                  <Input
                    type="date"
                    disabled={busy || t.isDisabled}
                    className="h-8 w-full rounded-lg border-zinc-200 bg-white px-1 text-center text-[12px] focus-visible:ring-red-500"
                    value={
                      editingDate.id === t.id && editingDate.field === "end"
                        ? editingDate.value
                        : toDateInputValue(getTaskOriginalEnd(t))
                    }
                    onFocus={() => beginEditDate(t, "end")}
                    onChange={(e) => {
                      setEditingDate({
                        id: t.id,
                        field: "end",
                        value: e.target.value,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setEditingDate({ id: null, field: null, value: "" });
                        e.currentTarget.blur();
                      }
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={() => commitEditDate(t)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    title="Alterar data final manualmente"
                  />
                )}
              </div>

              {/* Encadear */}
              <div
                className={cn(
                  getColumnCellClass("chain", false, rowBgClass),
                  "flex items-center justify-center"
                )}
              >
                {isProject ? (
                  <span className="text-zinc-300">—</span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleChain?.(t.id);
                    }}
                    title={
                      chainSet?.has(t.id)
                        ? "Encadeamento ATIVO"
                        : "Encadeamento INATIVO"
                    }
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition",
                      chainSet?.has(t.id)
                        ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                        : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
                    )}
                  >
                    {chainSet?.has(t.id) ? (
                      <Link2 className="h-4 w-4" />
                    ) : (
                      <Link2Off className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <div className="px-3 py-2 text-[11px] text-zinc-500">
          Dica: arraste os divisores no cabeçalho para ajustar a largura das
          colunas.
        </div>
      </div>
    );
  };
}

/* =========================
   Component
========================= */
export function GanttTab({
  loading,
  viewData,
  colorMode,
  setColorMode,
  filterText,
  setFilterText,
  onPersistDateChange,
  onOpenDetails,
  onPersistMetaChange,
  changeHistory = [],
  calendarSettings,
}) {
  const effectiveCalendarSettings = useMemo(
    () => normalizeCalendarSettings(calendarSettings),
    [calendarSettings],
  );
  const [viewMode, setViewMode] = useState(ViewMode.Week);
  const [ganttWindowStart, setGanttWindowStart] = useState(null);
  const [groupByTicket, setGroupByTicket] = useState(true);
  const [onlyInProgress, setOnlyInProgress] = useState(true);
  const [calendarOnlyMode, setCalendarOnlyMode] = useState(false);
  const [selectedIssueKey, setSelectedIssueKey] = useState("");
  const [quickView, setQuickView] = useState("po");
  const [collapsedProjects, setCollapsedProjects] = useState(() => new Set());
  const [ganttMode, setGanttMode] = useState("live");
  const [simulationBaseline, setSimulationBaseline] = useState(() => new Map());
  const [simulationDrafts, setSimulationDrafts] = useState(() => new Map());
  const [simulationOrderOverrides, setSimulationOrderOverrides] = useState(
    () => new Map()
  );
  const [resourceFilter, setResourceFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [exportingGantt, setExportingGantt] = useState("");
  const isSimulationMode = ganttMode === "simulation";

  // ✅ drawer inspector
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTaskId, setInspectorTaskId] = useState("");

  // ✅ overrides otimistas: recurso/area/risco
  const [metaOverrides, setMetaOverrides] = useState(() => new Map());
  const [orderOverrides, setOrderOverrides] = useState(() => {
    try {
      const raw = localStorage.getItem("gantt_activityOrder_v1");
      const parsed = raw ? JSON.parse(raw) : {};
      return new Map(
        Object.entries(parsed || {}).filter(([, value]) =>
          Array.isArray(value)
        )
      );
    } catch {
      return new Map();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "gantt_activityOrder_v1",
        JSON.stringify(Object.fromEntries(orderOverrides))
      );
    } catch {}
  }, [orderOverrides]);

  // trava durante persistência
  const [persistingDates, setPersistingDates] = useState(false);
  const [persistingMeta, setPersistingMeta] = useState(false);
  const [interactionLabel, setInteractionLabel] = useState("");
  const [rowDragState, setRowDragState] = useState(() =>
    makeEmptyRowDragState()
  );
  const rowDragStateRef = useRef(rowDragState);
  const rowDragStyleRef = useRef(null);
  const busy = Boolean(loading || persistingDates || persistingMeta || exportingGantt);
  const operationLabel = persistingDates
    ? "salvando cronograma no Jira"
    : persistingMeta
    ? "salvando dados no Jira"
    : exportingGantt
    ? `exportando ${String(exportingGantt).toUpperCase()}`
    : interactionLabel;

  const clearReorderDrag = useCallback(() => {
    const next = makeEmptyRowDragState();
    rowDragStateRef.current = next;
    setRowDragState(next);
    if (rowDragStyleRef.current) {
      document.body.style.cursor = rowDragStyleRef.current.cursor || "";
      document.body.style.userSelect = rowDragStyleRef.current.userSelect || "";
      rowDragStyleRef.current = null;
    }
    setInteractionLabel((label) =>
      label === "arrastando atividade" ? "" : label
    );
  }, []);

  useEffect(() => {
    rowDragStateRef.current = rowDragState;
  }, [rowDragState]);

  const handleRowPointerDown = useCallback(
    (e, taskId) => {
      if (busy || !taskId) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const next = {
        ...makeEmptyRowDragState(),
        sourceId: taskId,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
      };
      rowDragStateRef.current = next;
      setRowDragState(next);
      setInteractionLabel("arrastando atividade");
      rowDragStyleRef.current = {
        cursor: document.body.style.cursor,
        userSelect: document.body.style.userSelect,
      };
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    },
    [busy]
  );

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") clearReorderDrag();
    }

    window.addEventListener("blur", clearReorderDrag);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("blur", clearReorderDrag);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [clearReorderDrag]);

  // ✅ Overrides otimistas para meta (recurso/área/risco)
  // chave: `${issueKey}::${activityId}` -> { recurso?, area?, risk? }
  const [localOverridesMeta, setLocalOverridesMeta] = useState(() => new Map());
  const localOverridesMetaRef = useRef(localOverridesMeta);

  useEffect(() => {
    localOverridesMetaRef.current = localOverridesMeta;
  }, [localOverridesMeta]);

  function makeMetaKey(issueKey, activityId) {
    return `${String(issueKey || "")
      .trim()
      .toUpperCase()}::${String(activityId || "").trim()}`;
  }

  /* =========================
     ✅ Encadear (chain locks)
     (NÃO pode ficar dentro de useEffect)
  ========================= */
  const [chainSet, setChainSet] = useState(() => {
    try {
      const raw = localStorage.getItem("gantt_chainLocks_v1");
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "gantt_chainLocks_v1",
        JSON.stringify(Array.from(chainSet))
      );
    } catch {}
  }, [chainSet]);

  const toggleChain = useCallback((taskId) => {
    setChainSet((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  /* =========================
     colunas redimensionáveis
  ========================= */
  const [colWidths, setColWidths] = useState(() => {
    try {
      const raw = localStorage.getItem("gantt_colWidths_v2");
      if (raw) return { ...DEFAULT_COL_WIDTHS, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_COL_WIDTHS;
  });

  const colWidthsRef = useRef(colWidths);
  useEffect(() => {
    colWidthsRef.current = colWidths;
  }, [colWidths]);

  useEffect(() => {
    try {
      localStorage.setItem("gantt_colWidths_v2", JSON.stringify(colWidths));
    } catch {}
  }, [colWidths]);

  const listCellWidth = useMemo(() => {
    const totalWidth = getGanttTotalListWidth(colWidths);
    const stickyWidth = getGanttStickyListWidth(colWidths);
    return `${Math.min(
      totalWidth,
      Math.max(stickyWidth, GANTT_MAX_VISIBLE_LIST_WIDTH_PX)
    )}px`;
  }, [colWidths]);

  const ganttWrapRef = useRef(null);
  const ganttHorizontalBarRef = useRef(null);
  const ganttVerticalBarRef = useRef(null);
  const isSyncingGanttScrollRef = useRef(false);
  const panRef = useRef(null);
  const suppressPanClickRef = useRef(false);
  const [isGanttPanning, setIsGanttPanning] = useState(false);
  const [hasGanttHorizontalScroll, setHasGanttHorizontalScroll] =
    useState(false);
  const [ganttHorizontalScrollWidth, setGanttHorizontalScrollWidth] =
    useState(0);
  const [ganttVerticalScrollHeight, setGanttVerticalScrollHeight] =
    useState(0);

  /* =========================
     RESIZE (controlado no PAI)
  ========================= */
  const resizeRef = useRef(null);

  const beginResize = useCallback((e, key) => {
    e.preventDefault();
    e.stopPropagation();

    const current = colWidthsRef.current || DEFAULT_COL_WIDTHS;

    resizeRef.current = {
      key,
      startX: e.clientX,
      startW: Number(current?.[key] ?? DEFAULT_COL_WIDTHS[key]),
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function onMove(e) {
      const drag = resizeRef.current;
      if (!drag) return;

      const delta = e.clientX - drag.startX;
      const nextW = Math.max(
        MIN_COL_WIDTHS[drag.key] ?? 60,
        (drag.startW || 0) + delta
      );

      setColWidths((prev) => ({
        ...(prev || DEFAULT_COL_WIDTHS),
        [drag.key]: Math.round(nextW),
      }));
    }

    function onUp() {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  // quick views -> efeitos práticos
  useEffect(() => {
    if (quickView === "recurso") setColorMode?.("recurso");
    if (quickView === "po") setColorMode?.("ticket");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickView]);

  const getGanttHorizontalScrollTarget = useCallback(() => {
    const root = ganttWrapRef.current;
    if (!root) return null;
    return root;
  }, []);

  const beginGanttPan = useCallback((e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (resizeRef.current) return;
    if (isGanttPanBlockedTarget(e.target)) return;
    if (!isGanttTimelinePanTarget(e.target)) return;

    const root = ganttWrapRef.current;
    const horizontalTarget = getGanttHorizontalScrollTarget();
    if (
      !root ||
      !horizontalTarget ||
      horizontalTarget.scrollWidth <= horizontalTarget.clientWidth + 1
    )
      return;
    if (isNativeScrollbarHit(root, e)) return;

    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollElement: horizontalTarget,
      scrollLeft: horizontalTarget.scrollLeft,
      moved: false,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };

    setIsGanttPanning(true);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  }, [getGanttHorizontalScrollTarget]);

  const handleGanttPanClickCapture = useCallback((e) => {
    if (!suppressPanClickRef.current) return;
    suppressPanClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const syncGanttScrollbars = useCallback(() => {
    const root = ganttWrapRef.current;
    const horizontalTarget = getGanttHorizontalScrollTarget();
    const horizontalBar = ganttHorizontalBarRef.current;
    const verticalBar = ganttVerticalBarRef.current;
    if (!root) return;

    const scrollLeft = horizontalTarget?.scrollLeft ?? root.scrollLeft;
    if (horizontalBar && horizontalBar.scrollLeft !== scrollLeft) {
      horizontalBar.scrollLeft = scrollLeft;
    }

    if (verticalBar && verticalBar.scrollTop !== root.scrollTop) {
      verticalBar.scrollTop = root.scrollTop;
    }
  }, [getGanttHorizontalScrollTarget]);

  const handleGanttScroll = useCallback(() => {
    if (isSyncingGanttScrollRef.current) return;
    syncGanttScrollbars();
  }, [syncGanttScrollbars]);

  const handleGanttWheel = useCallback(
    (event) => {
      const root = ganttWrapRef.current;
      const horizontalTarget = getGanttHorizontalScrollTarget();
      if (!root || !horizontalTarget) return;
      if (!isGanttTimelinePanTarget(event.target)) return;

      const dominantDelta =
        Math.abs(event.deltaX) >= Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (!dominantDelta) return;

      const maxScrollLeft =
        horizontalTarget.scrollWidth - horizontalTarget.clientWidth;
      if (maxScrollLeft <= 1) return;

      const previous = horizontalTarget.scrollLeft;
      const next = Math.max(
        0,
        Math.min(maxScrollLeft, previous + dominantDelta)
      );
      if (next === previous) return;

      horizontalTarget.scrollLeft = next;
      syncGanttScrollbars();
      event.preventDefault();
    },
    [getGanttHorizontalScrollTarget, syncGanttScrollbars]
  );

  useEffect(() => {
    const root = ganttWrapRef.current;
    if (!root) return undefined;

    root.addEventListener("wheel", handleGanttWheel, { passive: false });
    return () => {
      root.removeEventListener("wheel", handleGanttWheel);
    };
  }, [handleGanttWheel]);

  const handleGanttHorizontalBarScroll = useCallback(
    (event) => {
      const root = ganttWrapRef.current;
      const horizontalTarget = getGanttHorizontalScrollTarget();
      if (!root || !horizontalTarget) return;

      const nextLeft = event.currentTarget.scrollLeft;
      if (horizontalTarget.scrollLeft === nextLeft) return;

      isSyncingGanttScrollRef.current = true;
      horizontalTarget.scrollLeft = nextLeft;
      window.requestAnimationFrame(() => {
        isSyncingGanttScrollRef.current = false;
        syncGanttScrollbars();
      });
    },
    [getGanttHorizontalScrollTarget, syncGanttScrollbars]
  );

  const handleGanttVerticalBarScroll = useCallback(
    (event) => {
      const root = ganttWrapRef.current;
      if (!root) return;

      const nextTop = event.currentTarget.scrollTop;
      if (root.scrollTop === nextTop) return;

      isSyncingGanttScrollRef.current = true;
      root.scrollTop = nextTop;
      window.requestAnimationFrame(() => {
        isSyncingGanttScrollRef.current = false;
        syncGanttScrollbars();
      });
    },
    [syncGanttScrollbars]
  );

  const finishGanttPan = useCallback((e) => {
    const drag = panRef.current;
    if (!drag) return;
    if (e?.pointerId != null && e.pointerId !== drag.pointerId) return;

    panRef.current = null;
    setIsGanttPanning(false);
    document.body.style.cursor = drag.previousCursor || "";
    document.body.style.userSelect = drag.previousUserSelect || "";

    if (drag.moved) {
      suppressPanClickRef.current = true;
      window.setTimeout(() => {
        suppressPanClickRef.current = false;
      }, 0);
    }
  }, []);

  const handleGanttPanPointerMove = useCallback(
    (e) => {
      const drag = panRef.current;
      const horizontalTarget =
        drag?.scrollElement || getGanttHorizontalScrollTarget();
      if (!drag || !horizontalTarget) return;
      if (e.pointerId !== drag.pointerId) return;

      const deltaX = e.clientX - drag.startX;
      const deltaY = e.clientY - drag.startY;
      if (
        !drag.moved &&
        Math.abs(deltaX) > 4 &&
        Math.abs(deltaX) >= Math.abs(deltaY)
      ) {
        drag.moved = true;
      }

      if (!drag.moved) return;
      horizontalTarget.scrollLeft = drag.scrollLeft - deltaX;
      syncGanttScrollbars();
      e.preventDefault();
    },
    [getGanttHorizontalScrollTarget, syncGanttScrollbars]
  );

  useEffect(() => {
    window.addEventListener("pointermove", handleGanttPanPointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", finishGanttPan);
    window.addEventListener("pointercancel", finishGanttPan);
    window.addEventListener("blur", finishGanttPan);

    return () => {
      window.removeEventListener("pointermove", handleGanttPanPointerMove);
      window.removeEventListener("pointerup", finishGanttPan);
      window.removeEventListener("pointercancel", finishGanttPan);
      window.removeEventListener("blur", finishGanttPan);

      const drag = panRef.current;
      if (drag) {
        document.body.style.cursor = drag.previousCursor || "";
        document.body.style.userSelect = drag.previousUserSelect || "";
      }
      panRef.current = null;
    };
  }, [finishGanttPan, handleGanttPanPointerMove]);

  const effectiveOrderOverrides = isSimulationMode
    ? simulationOrderOverrides
    : orderOverrides;

  const { tasks, conflictSet, ticketOptions } = useMemo(() => {
    return buildGanttTasksFromViewData({
      viewData,
      colorMode,
      filterText,
      onlyInProgress,
      selectedIssueKey,
      groupByTicket,
      quickView,
      collapsedProjects,
      orderOverrides: effectiveOrderOverrides,
      metaOverrides, // ✅ aplica overrides
      resourceFilter,
      areaFilter,
    });
  }, [
    viewData,
    colorMode,
    filterText,
    onlyInProgress,
    selectedIssueKey,
    groupByTicket,
    quickView,
    collapsedProjects,
    effectiveOrderOverrides,
    metaOverrides,
    resourceFilter,
    areaFilter,
  ]);

  const tasksWithMetaOverrides = useMemo(() => {
    const arr = Array.isArray(tasks) ? tasks : [];
    if (!localOverridesMeta || localOverridesMeta.size === 0) return arr;

    return arr.map((t) => {
      if (!t) return t;
      if (t.type !== "task") return t;

      const issueKey = t.issueKey || getIssueKeyFromTaskId(t.id);
      const activityId = t.activityId || getActivityIdFromTaskId(t.id);
      const o = localOverridesMeta.get(makeMetaKey(issueKey, activityId));
      if (!o) return t;

      return { ...t, ...o };
    });
  }, [tasks, localOverridesMeta]);

  const baseSafeTasks = useMemo(() => {
    const arr = Array.isArray(tasksWithMetaOverrides)
      ? tasksWithMetaOverrides
      : [];
    return arr.filter((t) => {
      if (!t) return false;
      if (!(t.start instanceof Date) || Number.isNaN(t.start.getTime()))
        return false;
      if (!(t.end instanceof Date) || Number.isNaN(t.end.getTime()))
        return false;
      return true;
    });
  }, [tasksWithMetaOverrides]);

  const structuredFilterOptions = useMemo(
    () => buildStructuredFilterOptions(baseSafeTasks),
    [baseSafeTasks]
  );

  useEffect(() => {
    if (!isSimulationMode) return;
    setSimulationBaseline((current) =>
      current instanceof Map && current.size
        ? current
        : buildSimulationBaseline(baseSafeTasks)
    );
  }, [baseSafeTasks, isSimulationMode]);

  const safeTasks = useMemo(() => {
    if (!isSimulationMode) return baseSafeTasks;
    return applySimulationDrafts(baseSafeTasks, simulationDrafts).map((task) => {
      if (!task?.isSimulationChanged) return task;
      const baseline = simulationBaseline.get(String(task.id || ""));
      if (!baseline) return task;
      return {
        ...task,
        baselineStart: baseline.start,
        baselineEnd: baseline.end,
      };
    });
  }, [baseSafeTasks, isSimulationMode, simulationBaseline, simulationDrafts]);

  const simulationChanges = useMemo(
    () => getSimulationChanges(simulationDrafts, simulationBaseline),
    [simulationDrafts, simulationBaseline]
  );

  const hasPendingSimulationChanges = hasSimulationChanges(simulationDrafts);

  const displayTasks = useMemo(() => {
    if (
      !rowDragState.isDragging ||
      !rowDragState.sourceId ||
      !rowDragState.targetId
    ) {
      return safeTasks;
    }
    return applyReorderPreview(
      safeTasks,
      rowDragState.sourceId,
      rowDragState.targetId,
      rowDragState.position
    );
  }, [safeTasks, rowDragState]);

  const displayDateRange = useMemo(() => {
    const dates = (displayTasks || [])
      .flatMap((task) => [safeDate(task?.start), safeDate(task?.end)])
      .filter(Boolean)
      .map((date) => date.getTime());

    if (!dates.length) return null;

    return {
      minStart: new Date(Math.min(...dates)),
      maxEnd: new Date(Math.max(...dates)),
    };
  }, [displayTasks]);

  useEffect(() => {
    if (!displayDateRange?.minStart) {
      setGanttWindowStart(null);
      return;
    }

    setGanttWindowStart((current) => {
      const currentDate = safeDate(current);
      if (currentDate) {
        const currentEnd = addDays(
          currentDate,
          getGanttWindowSpanDays(viewMode) - 1
        );
        if (
          currentEnd >= displayDateRange.minStart &&
          currentDate <= displayDateRange.maxEnd
        ) {
          return currentDate;
        }
      }
      return displayDateRange.minStart;
    });
  }, [
    displayDateRange?.maxEnd?.getTime(),
    displayDateRange?.minStart?.getTime(),
    viewMode,
  ]);

  const ganttWindow = useMemo(() => {
    const fallbackStart = displayDateRange?.minStart || new Date();
    const start = safeDate(ganttWindowStart) || fallbackStart;
    const normalizedStart = new Date(start);
    normalizedStart.setHours(0, 0, 0, 0);

    return {
      start: normalizedStart,
      end: addDays(normalizedStart, getGanttWindowSpanDays(viewMode) - 1),
    };
  }, [displayDateRange?.minStart, ganttWindowStart, viewMode]);

  const resetGanttHorizontalScroll = useCallback(() => {
    const horizontalTarget = getGanttHorizontalScrollTarget();
    if (horizontalTarget) horizontalTarget.scrollLeft = 0;
    if (ganttHorizontalBarRef.current) {
      ganttHorizontalBarRef.current.scrollLeft = 0;
    }
    window.requestAnimationFrame(syncGanttScrollbars);
  }, [getGanttHorizontalScrollTarget, syncGanttScrollbars]);

  const shiftGanttCalendar = useCallback(
    (direction) => {
      const factor = direction === "previous" ? -1 : 1;
      const stepDays = getGanttWindowSpanDays(viewMode);
      setGanttWindowStart((current) => {
        const base =
          safeDate(current) ||
          safeDate(displayDateRange?.minStart) ||
          new Date();
        return addCalendarWindow(base, factor * stepDays, viewMode);
      });

      resetGanttHorizontalScroll();
    },
    [
      displayDateRange?.minStart,
      resetGanttHorizontalScroll,
      viewMode,
    ]
  );

  const { taskById, nextById, prevById } = useMemo(() => {
    const tasksOnly = (displayTasks || []).filter((t) => t?.type === "task");

    const taskById = new Map(tasksOnly.map((t) => [t.id, t]));

    const byIssue = new Map();
    for (const t of tasksOnly) {
      if (!byIssue.has(t.issueKey)) byIssue.set(t.issueKey, []);
      byIssue.get(t.issueKey).push(t);
    }

    for (const [issueKey, list] of byIssue.entries()) {
      const arr = [...list];

      if (quickView === "po") {
        arr.sort((a, b) => {
          const ai = PO_CHAIN.indexOf(a.activityId);
          const bi = PO_CHAIN.indexOf(b.activityId);

          const aIn = ai !== -1;
          const bIn = bi !== -1;

          if (aIn && bIn) return ai - bi;
          if (aIn) return -1;
          if (bIn) return 1;

          return a.start.getTime() - b.start.getTime();
        });
      } else {
        arr.sort((a, b) => a.start.getTime() - b.start.getTime());
      }

      byIssue.set(issueKey, arr);
    }

    const nextById = new Map();
    const prevById = new Map();

    for (const [, arr] of byIssue.entries()) {
      for (let i = 0; i < arr.length; i++) {
        const cur = arr[i];
        const next = arr[i + 1];
        const prev = arr[i - 1];

        if (next) nextById.set(cur.id, next.id);
        if (prev) prevById.set(cur.id, prev.id);
      }
    }

    return { taskById, nextById, prevById };
  }, [displayTasks, quickView]);

  // ✅ lockedSet
  const lockedSet = useMemo(() => {
    const locked = new Set();

    for (const [id, prevId] of prevById.entries()) {
      if (prevId && chainSet.has(prevId)) locked.add(id);
    }

    return locked;
  }, [prevById, chainSet]);

  const simulationResourceConflicts = useMemo(
    () =>
      isSimulationMode
        ? detectResourceConflicts(safeTasks)
        : { ids: new Set(), details: [] },
    [isSimulationMode, safeTasks]
  );

  const dependencyViolations = useMemo(
    () =>
      detectDependencyViolations(safeTasks, (end) =>
        nextStartAfterEnd(end, effectiveCalendarSettings)
      ),
    [effectiveCalendarSettings, safeTasks]
  );

  const visibleConflictSet = useMemo(() => {
    const next = new Set(conflictSet || []);
    for (const id of simulationResourceConflicts.ids || []) next.add(id);
    for (const id of dependencyViolations.ids || []) next.add(id);
    return next;
  }, [conflictSet, dependencyViolations, simulationResourceConflicts]);

  const ganttTasks = useMemo(() => {
    const windowStart = ganttWindow?.start;
    const windowEnd = ganttWindow?.end;

    return (displayTasks || [])
      .map((t) => {
        if (!t || !windowStart || !windowEnd) return t;

        const originalStart = safeDate(t.start);
        const originalEnd = safeDate(t.end);
        if (!originalStart || !originalEnd) return null;
        if (originalEnd < windowStart || originalStart > windowEnd) return null;

        const start =
          originalStart < windowStart ? cloneDate(windowStart) : originalStart;
        const end = originalEnd > windowEnd ? cloneDate(windowEnd) : originalEnd;

        const isConflict = visibleConflictSet.has(t.id);
        const nextColor = dependencyViolations.ids.has(t.id)
          ? "#DC2626"
          : isConflict
          ? "#F97316"
          : t.isSimulationChanged
          ? "#D97706"
          : t.styles?.backgroundColor;

        return {
          ...t,
          originalStart,
          originalEnd,
          start,
          end,
          isCalendarClipped:
            start.getTime() !== originalStart.getTime() ||
            end.getTime() !== originalEnd.getTime(),
          isDisabled:
            t.type === "task" ? Boolean(t.isDisabled || lockedSet.has(t.id)) : t.isDisabled,
          styles:
            t.type === "task" && nextColor
              ? {
                  ...(t.styles || {}),
                  backgroundColor: nextColor,
                  backgroundSelectedColor: nextColor,
                  progressColor: nextColor,
                  progressSelectedColor: nextColor,
                }
              : t.styles,
        };
      })
      .filter(Boolean);
  }, [dependencyViolations, displayTasks, ganttWindow, lockedSet, visibleConflictSet]);

  const ganttRenderTasks = useMemo(() => {
    const windowStart = ganttWindow?.start;
    const windowEnd = ganttWindow?.end;
    if (!windowStart || !windowEnd || !(ganttTasks || []).length) {
      return ganttTasks || [];
    }

    const renderTasks =
      viewMode === ViewMode.Day
        ? ganttTasks.map((task) => {
            if (!task || isGanttWindowBoundaryTask(task)) return task;
            const end = safeDate(task.end);
            if (!end) return task;
            return {
              ...task,
              end: addDays(end, 1),
              visualEndAdjusted: true,
            };
          })
        : ganttTasks;

    return [
      ...renderTasks,
      makeGanttWindowBoundaryTask("__gantt_window_start__", windowStart),
      makeGanttWindowBoundaryTask("__gantt_window_end__", windowEnd),
    ];
  }, [ganttTasks, ganttWindow, viewMode]);

  const ganttColumnWidth = useMemo(() => getGanttColumnWidth(viewMode), [viewMode]);
  const ganttVisibleTimelineWidth = useMemo(
    () => getGanttTimelineColumns(viewMode) * ganttColumnWidth,
    [ganttColumnWidth, viewMode]
  );
  const ganttLeadingOffset = ganttColumnWidth;
  const effectiveListCellWidth = calendarOnlyMode ? "" : listCellWidth;
  const effectiveListWidthPx = calendarOnlyMode ? 0 : parsePxValue(listCellWidth);

  const ganttContentWidth = useMemo(() => {
    return effectiveListWidthPx + ganttVisibleTimelineWidth;
  }, [effectiveListWidthPx, ganttVisibleTimelineWidth]);

  const ganttRenderKey = useMemo(
    () =>
      [
        viewMode,
        ganttWindow?.start?.getTime?.() || 0,
        ganttColumnWidth,
        effectiveListWidthPx,
        calendarOnlyMode ? "calendar-only" : "with-table",
      ].join("::"),
    [
      calendarOnlyMode,
      effectiveListWidthPx,
      ganttColumnWidth,
      ganttWindow?.start,
      viewMode,
    ],
  );

  const nonWorkingDayColumns = useMemo(() => {
    if (viewMode !== ViewMode.Day || !ganttWindow?.start) return [];

    const days = getGanttTimelineColumns(viewMode);
    const columns = [];

    for (let index = 0; index < days; index += 1) {
      const date = addDays(ganttWindow.start, index);
      if (isWorkingDay(date, effectiveCalendarSettings)) continue;

      const holiday = findHolidayForDate(date, effectiveCalendarSettings);
      const weekday = new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
      }).format(date);

      columns.push({
        key: date.toISOString(),
        left: effectiveListWidthPx + index * ganttColumnWidth,
        width: ganttColumnWidth,
        label: holiday?.name
          ? `${weekday} - ${holiday.name}`
          : `${weekday} - dia não útil`,
      });
    }

    return columns;
  }, [
    effectiveCalendarSettings,
    effectiveListWidthPx,
    ganttColumnWidth,
    ganttWindow?.start,
    viewMode,
  ]);

  const updateGanttScrollState = useCallback(() => {
    const root = ganttWrapRef.current;
    if (!root) return;

    const horizontalTarget = getGanttHorizontalScrollTarget();
    const hasHorizontal =
      !!horizontalTarget &&
      horizontalTarget.scrollWidth > horizontalTarget.clientWidth + 1;

    setHasGanttHorizontalScroll(hasHorizontal);
    setGanttHorizontalScrollWidth(
      Math.max(
        ganttContentWidth,
        horizontalTarget?.scrollWidth || 0,
        (horizontalTarget?.clientWidth || root.clientWidth || 0) + 1
      )
    );
    setGanttVerticalScrollHeight(
      Math.max(root.scrollHeight, root.clientHeight + 1)
    );
    syncGanttScrollbars();
  }, [ganttContentWidth, getGanttHorizontalScrollTarget, syncGanttScrollbars]);

  useEffect(() => {
    const root = ganttWrapRef.current;
    if (!root) return;

    let rafId = null;
    const scheduleUpdate = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateGanttScrollState();
      });
    };

    scheduleUpdate();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleUpdate)
        : null;

    resizeObserver?.observe(root);
    if (root.firstElementChild) resizeObserver?.observe(root.firstElementChild);
    const horizontalTarget = getGanttHorizontalScrollTarget();
    if (horizontalTarget && horizontalTarget !== root) {
      horizontalTarget.addEventListener("scroll", scheduleUpdate, {
        passive: true,
      });
      resizeObserver?.observe(horizontalTarget);
    }
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (horizontalTarget && horizontalTarget !== root) {
        horizontalTarget.removeEventListener("scroll", scheduleUpdate);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [
    ganttContentWidth,
    getGanttHorizontalScrollTarget,
    safeTasks.length,
    updateGanttScrollState,
    viewMode,
  ]);

  // ✅ issues index
  const issueByKey = useMemo(() => {
    const arr = Array.isArray(viewData?.calendarioIssues)
      ? viewData.calendarioIssues
      : [];
    const m = new Map();
    for (const iss of arr) {
      const k = String(iss?.key || "")
        .trim()
        .toUpperCase();
      if (k) m.set(k, iss);
    }
    return m;
  }, [viewData?.calendarioIssues]);

  // ✅ ref: permite selecionar task via Drawer
  const ganttSetSelectedTaskIdRef = useRef(null);

  const openInspectorByTaskId = useCallback(
    (taskId) => {
      const id = String(taskId || "");
      if (!id) return;
      if (id.startsWith("__gantt_window_")) return;

      setInspectorTaskId(id);
      setInspectorOpen(true);

      // mantém filtro funcionando
      // Abrir/selecionar no Gantt nao deve aplicar filtro de ticket.

      // tenta também selecionar no gantt (highlight/scroll na lista)
      ganttSetSelectedTaskIdRef.current?.(id);
    },
    []
  );

  const selectedInspectorTask = useMemo(() => {
    const id = String(inspectorTaskId || "");
    if (!id) return null;

    // procura em ganttTasks (inclui project)
    const t = (ganttTasks || []).find((x) => x?.id === id);
    if (t) return t;

    // fallback: pode estar filtrado, mas ainda assim mostra algo mínimo
    const issueKey = getIssueKeyFromTaskId(id);
    if (issueKey && id.startsWith("P::")) {
      return { id, type: "project", issueKey };
    }
    return null;
  }, [inspectorTaskId, ganttTasks]);

  const selectedIssue = useMemo(() => {
    const issueKey =
      selectedInspectorTask?.issueKey ||
      getIssueKeyFromTaskId(selectedInspectorTask?.id);
    if (!issueKey) return null;
    return issueByKey.get(String(issueKey).toUpperCase()) || null;
  }, [selectedInspectorTask, issueByKey]);

  const selectedDueDate = useMemo(() => {
    if (!selectedIssue) return null;
    return inferDueDateFromIssue(selectedIssue);
  }, [selectedIssue]);

  const selectedOverdueDays = useMemo(() => {
    const statusName = selectedIssue?.statusName || selectedIssue?.status || "";
    return calcOverdueDays({ dueDate: selectedDueDate, statusName });
  }, [selectedDueDate, selectedIssue]);

  const prevTask = useMemo(() => {
    if (!selectedInspectorTask || selectedInspectorTask.type !== "task")
      return null;
    const prevId = prevById.get(selectedInspectorTask.id);
    if (!prevId) return null;
    return taskById.get(prevId) || null;
  }, [selectedInspectorTask, prevById, taskById]);

  const nextTask = useMemo(() => {
    if (!selectedInspectorTask || selectedInspectorTask.type !== "task")
      return null;
    const nextId = nextById.get(selectedInspectorTask.id);
    if (!nextId) return null;
    return taskById.get(nextId) || null;
  }, [selectedInspectorTask, nextById, taskById]);

  /* =========================
     ✅ Day header: remover dia da semana
  ========================= */
  useEffect(() => {
    if (viewMode !== ViewMode.Day && viewMode !== ViewMode.Week) return;

    const root = ganttWrapRef.current;
    if (!root) return;

    let rafId = null;

    const WEEKDAY_RE =
      /(seg|ter|qua|qui|sex|sab|sáb|dom|mon|tue|wed|thu|fri|sat|sun)/i;

    const fixLabels = () => {
      rafId = null;

      const preferred = root.querySelectorAll(
        ".calendarBottomText, .calendarBottomTextSmall, [class*='calendarBottomText']"
      );

      const nodes = preferred.length
        ? preferred
        : root.querySelectorAll("svg text");

      nodes.forEach((el) => {
        const txt = String(el.textContent || "").trim();
        if (!txt) return;
        if (/\d{4}/.test(txt)) return;
        if (!WEEKDAY_RE.test(txt)) return;

        const m = txt.match(/(\d{1,2})/);
        if (!m) return;

        el.textContent = m[1];
      });
    };

    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(fixLabels);
    };

    // roda algumas vezes no começo (a lib pinta em etapas)
    schedule();
    const t1 = setTimeout(fixLabels, 50);
    const t2 = setTimeout(fixLabels, 150);

    const obs = new MutationObserver(schedule);
    obs.observe(root, { subtree: true, childList: true, characterData: true });

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      obs.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [viewMode]);

  const legendItems = useMemo(
    () => buildLegendItems(safeTasks, colorMode),
    [safeTasks, colorMode]
  );

  const toolbarButton = (active) =>
    cn(
      "h-9 rounded-lg px-3 text-xs font-semibold",
      active
        ? "bg-red-600 text-white hover:bg-red-700"
        : "text-zinc-700 hover:bg-white/70"
    );

  const chipButton = (active) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-semibold transition",
      active
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
    );

  const getBusinessDurationDays = useCallback(
    (start, end) => inclusiveDurationDays(start, end, effectiveCalendarSettings),
    [effectiveCalendarSettings],
  );

  /* =========================
     ✅ handleDateChange
     com cascata quando encadeado
  ========================= */
  const handleDateChange = useCallback(
    async (task) => {
      if (persistingDates || persistingMeta) return false;
      if (isGanttWindowBoundaryTask(task)) return false;
      if (!task || task.type === "project" || task.isDisabled) return false;
      if (task.isCalendarClipped) return false;

      const baseId = String(task.id || "");
      const baseOriginal = taskById.get(baseId) || task;
      const taskStart = safeDate(task.start) || safeDate(getTaskOriginalStart(task));
      const taskEnd = safeDate(task.end) || safeDate(getTaskOriginalEnd(task));
      const normalizedTaskStart =
        effectiveCalendarSettings && taskStart
          ? nextWorkingDay(taskStart, effectiveCalendarSettings, {
              includeCurrent: true,
            }) || taskStart
          : taskStart;
      const normalizedTaskEnd =
        task.visualEndAdjusted && taskEnd ? addDays(taskEnd, -1) : taskEnd;
      const normalizedEnd =
        normalizedTaskStart && normalizedTaskEnd && normalizedTaskEnd < normalizedTaskStart
          ? normalizedTaskStart
          : normalizedTaskEnd;

      const base = {
        ...baseOriginal,
        ...task,
        type: "task",
        issueKey: String(
          (task.issueKey ||
            baseOriginal.issueKey ||
            getIssueKeyFromTaskId(task.id)) ??
            ""
        )
          .trim()
          .toUpperCase(),
        activityId: String(
          (task.activityId ||
            baseOriginal.activityId ||
            getActivityIdFromTaskId(task.id)) ??
            ""
        ).trim(),
        start: normalizedTaskStart,
        end: normalizedEnd,
        visualEndAdjusted: false,
      };

      if (!base.issueKey || !base.activityId) return false;
      if (
        Number.isNaN(base.start.getTime()) ||
        Number.isNaN(base.end.getTime())
      )
        return false;

      const updates = [base];

      const visited = new Set([base.id]);
      let cur = base;

      while (chainSet.has(cur.id)) {
        const nextId = nextById.get(cur.id);
        if (!nextId || visited.has(nextId)) break;

        const next = taskById.get(nextId);
        if (!next) break;

        const nextStart = nextStartAfterEnd(cur.end, effectiveCalendarSettings);

        const nextEnd = endFromInclusiveDays(
          nextStart,
          inclusiveDurationDays(next.start, next.end, effectiveCalendarSettings),
          effectiveCalendarSettings
        );

        const nextUpdate = {
          ...next,
          start: nextStart,
          end: nextEnd,
        };

        updates.push(nextUpdate);
        visited.add(nextId);
        cur = nextUpdate;
      }

      if (isSimulationMode) {
        setSimulationDrafts((prev) => upsertDateDrafts(prev, updates));
        setInteractionLabel("alteração adicionada à simulação");
        window.setTimeout(() => {
          setInteractionLabel((label) =>
            label === "alteração adicionada à simulação" ? "" : label
          );
        }, 1200);
        return true;
      }

      setPersistingDates(true);
      try {
        const ok = await onPersistDateChange?.(updates);
        return ok !== false;
      } catch (err) {
        console.error(err);
        return false;
      } finally {
        setPersistingDates(false);
        setInteractionLabel("");
      }
    },
    [
      persistingDates,
      persistingMeta,
      chainSet,
      nextById,
      taskById,
      onPersistDateChange,
      effectiveCalendarSettings,
      isSimulationMode,
    ]
  );

  const persistMetaPatch = useCallback(
    async (issueKey, activityId, patch) => {
      const ik = String(issueKey || "")
        .trim()
        .toUpperCase();
      const aid = String(activityId || "").trim();
      if (!ik || !aid) return false;

      const key = makeMetaKey(ik, aid);

      const prev = localOverridesMetaRef.current?.get(key) || null;

      // ✅ otimista: atualiza UI imediatamente
      setLocalOverridesMeta((old) => {
        const next = new Map(old || []);
        next.set(key, { ...(prev || {}), ...(patch || {}) });
        return next;
      });

      // ✅ se não tem callback, NÃO quebra a tela
      // (mas avisa que não persiste no Jira)
      if (!onPersistMetaChange) {
        console.warn(
          "[GanttTab] onPersistMetaChange não foi fornecido. A UI será atualizada, mas isso NÃO vai persistir no Jira.",
          { issueKey: ik, activityId: aid, patch }
        );
        return true;
      }

      // trava tela igual dateChange
      if (persistingDates || persistingMeta) return false;

      setPersistingMeta(true);
      try {
        const ok = await onPersistMetaChange(ik, aid, patch);
        if (ok === false) throw new Error("PersistMeta returned false");
        return true;
      } catch (err) {
        console.error(err);

        // ✅ reverte UI
        setLocalOverridesMeta((old) => {
          const next = new Map(old || []);
          if (prev) next.set(key, prev);
          else next.delete(key);
          return next;
        });

        return false;
      } finally {
        setPersistingMeta(false);
      }
    },
    [onPersistMetaChange, persistingDates, persistingMeta]
  );

  const handleDurationChange = useCallback(
    async (task, days) => {
      if (!task || task.type !== "task" || task.isDisabled) return false;

      const d = Math.max(1, parseInt(String(days || 1), 10) || 1);

      // ✅ usa o start "original" (fonte confiável)
      const baseOriginal = taskById.get(String(task.id || "")) || task;

      const start =
        safeDate(getTaskOriginalStart(task)) || safeDate(baseOriginal.start);
      if (!start) return false;

      const workingStart =
        nextWorkingDay(start, effectiveCalendarSettings, {
          includeCurrent: true,
        }) || start;

      const nextEnd = endFromInclusiveDays(
        workingStart,
        d,
        effectiveCalendarSettings,
      );

      return await handleDateChange({
        ...task,
        ...baseOriginal,
        start: workingStart,
        end: nextEnd,
        isCalendarClipped: false,
      });
    },
    [effectiveCalendarSettings, handleDateChange, taskById]
  );

  const handleDateInputChange = useCallback(
    async (task, field, value) => {
      if (!task || task.type !== "task" || task.isDisabled) return false;
      if (field !== "start" && field !== "end") return false;

      const baseOriginal = taskById.get(String(task.id || "")) || task;
      const currentStart =
        safeDate(getTaskOriginalStart(task)) || safeDate(baseOriginal.start);
      const currentEnd =
        safeDate(getTaskOriginalEnd(task)) || safeDate(baseOriginal.end);
      const nextDate = safeDate(value);
      if (!currentStart || !currentEnd || !nextDate) return false;

      const durationDays = inclusiveDurationDays(
        currentStart,
        currentEnd,
        effectiveCalendarSettings,
      );

      let nextStart = currentStart;
      let nextEnd = currentEnd;

      if (field === "start") {
        nextStart =
          nextWorkingDay(nextDate, effectiveCalendarSettings, {
            includeCurrent: true,
          }) || nextDate;
        nextEnd = endFromInclusiveDays(
          nextStart,
          durationDays,
          effectiveCalendarSettings,
        );
      } else {
        nextEnd = nextDate;
        if (nextEnd < currentStart) {
          nextStart = nextEnd;
        }
      }

      return await handleDateChange({
        ...task,
        ...baseOriginal,
        start: nextStart,
        end: nextEnd,
        isCalendarClipped: false,
      });
    },
    [effectiveCalendarSettings, handleDateChange, taskById]
  );

  const handleReorderActivity = useCallback(
    async (sourceId, targetId, position = "after") => {
      if (persistingDates || persistingMeta) return false;

      const baseTaskById = new Map(
        (safeTasks || [])
          .filter((t) => t?.type === "task")
          .map((t) => [t.id, t])
      );
      const source = baseTaskById.get(String(sourceId || ""));
      const target = baseTaskById.get(String(targetId || ""));
      if (!source || !target) return false;
      if (source.type !== "task" || target.type !== "task") return false;
      if (source.id === target.id) return false;

      const issueKey = String(source.issueKey || getIssueKeyFromTaskId(source.id))
        .trim()
        .toUpperCase();
      const targetIssueKey = String(
        target.issueKey || getIssueKeyFromTaskId(target.id)
      )
        .trim()
        .toUpperCase();
      if (!issueKey || issueKey !== targetIssueKey) return false;

      const issueTasks = (safeTasks || []).filter(
        (t) => t?.type === "task" && getTaskIssueKey(t) === issueKey
      );
      const previousIds = issueTasks.map((t) => t.id);
      const nextIds = reorderTaskIds(safeTasks, source.id, target.id, position);
      if (!nextIds) return false;
      if (nextIds.join("|") === previousIds.join("|")) return false;

      const orderedTasks = nextIds
        .map((id) => baseTaskById.get(id))
        .filter((t) => t && t.type === "task");
      if (orderedTasks.length < 2) return false;

      const nextActivityOrder = orderedTasks
        .map((t) => String(t.activityId || getActivityIdFromTaskId(t.id)).trim())
        .filter(Boolean);
      const previousOrder = effectiveOrderOverrides.get(issueKey) || null;

      const validStarts = orderedTasks
        .map((t) => safeDate(t.start))
        .filter(Boolean)
        .map((d) => d.getTime());
      if (!validStarts.length) return false;

      let cursor =
        nextWorkingDay(new Date(Math.min(...validStarts)), effectiveCalendarSettings, {
          includeCurrent: true,
        }) || new Date(Math.min(...validStarts));
      const updates = orderedTasks.map((task) => {
        const nextStart = new Date(cursor);
        const nextEnd = endFromInclusiveDays(
          nextStart,
          inclusiveDurationDays(task.start, task.end, effectiveCalendarSettings),
          effectiveCalendarSettings
        );
        cursor = nextStartAfterEnd(nextEnd, effectiveCalendarSettings);
        return {
          ...task,
          start: nextStart,
          end: nextEnd,
        };
      });

      if (isSimulationMode) {
        setSimulationOrderOverrides((prev) => {
          const next = new Map(prev);
          next.set(issueKey, nextActivityOrder);
          return next;
        });
        setSimulationDrafts((prev) => upsertDateDrafts(prev, updates));
        return true;
      }

      setOrderOverrides((prev) => {
        const next = new Map(prev);
        next.set(issueKey, nextActivityOrder);
        return next;
      });

      setPersistingDates(true);
      try {
        const ok = await onPersistDateChange?.(updates);
        if (ok === false) throw new Error("Persist reorder returned false");
        return true;
      } catch (err) {
        console.error(err);
        setOrderOverrides((prev) => {
          const next = new Map(prev);
          if (previousOrder) next.set(issueKey, previousOrder);
          else next.delete(issueKey);
          return next;
        });
        return false;
      } finally {
        setPersistingDates(false);
        setInteractionLabel("");
      }
    },
    [
      persistingDates,
      persistingMeta,
      safeTasks,
      effectiveOrderOverrides,
      onPersistDateChange,
      effectiveCalendarSettings,
      isSimulationMode,
    ]
  );

  const handleRowDrop = useCallback(
    (sourceId, targetId, position) => {
      clearReorderDrag();
      setInteractionLabel("reordenando cronograma");

      Promise.resolve(handleReorderActivity(sourceId, targetId, position)).finally(
        () => {
          setInteractionLabel("");
        }
      );
    },
    [clearReorderDrag, handleReorderActivity]
  );

  useEffect(() => {
    if (!rowDragState.sourceId) return undefined;

    function getRowAtPoint(clientX, clientY) {
      const el = document.elementFromPoint(clientX, clientY);
      const row = el?.closest?.("[data-gantt-row-id]");
      if (!(row instanceof Element)) return null;
      return {
        id: row.getAttribute("data-gantt-row-id") || "",
        position: getDropPositionFromRowElement(row, clientY),
      };
    }

    function onPointerMove(e) {
      const drag = rowDragStateRef.current;
      if (!drag?.sourceId) return;
      if (drag.pointerId != null && e.pointerId !== drag.pointerId) return;

      const moved =
        drag.isDragging ||
        Math.abs(e.clientY - drag.startY) > 4 ||
        Math.abs(e.clientX - drag.startX) > 4;
      if (!moved) return;

      const row = getRowAtPoint(e.clientX, e.clientY);
      const validPreview =
        row?.id &&
        row.id !== drag.sourceId &&
        reorderTaskIds(safeTasks, drag.sourceId, row.id, row.position);
      const keepLastValidTarget = row?.id === drag.sourceId && drag.targetId;

      const targetId = validPreview
        ? row.id
        : keepLastValidTarget
        ? drag.targetId
        : "";
      const position = validPreview
        ? row.position
        : keepLastValidTarget
        ? drag.position
        : "after";

      const next = {
        ...drag,
        isDragging: true,
        targetId,
        position,
      };

      rowDragStateRef.current = next;
      setRowDragState((prev) => {
        if (
          prev.isDragging === next.isDragging &&
          prev.targetId === next.targetId &&
          prev.position === next.position
        ) {
          return prev;
        }
        return next;
      });

      e.preventDefault();
    }

    function onPointerUp(e) {
      const drag = rowDragStateRef.current;
      if (!drag?.sourceId) return;
      if (drag.pointerId != null && e.pointerId !== drag.pointerId) return;

      const sourceId = drag.sourceId;
      const row = getRowAtPoint(e.clientX, e.clientY);
      let targetId = "";
      let position = "after";

      if (
        row?.id &&
        row.id !== sourceId &&
        reorderTaskIds(safeTasks, sourceId, row.id, row.position)
      ) {
        targetId = row.id;
        position = row.position;
      } else if (row?.id === sourceId && drag.targetId) {
        targetId = drag.targetId;
        position = drag.position;
      }

      if (drag.isDragging && targetId) {
        handleRowDrop(sourceId, targetId, position);
      } else {
        clearReorderDrag();
      }

      e.preventDefault();
    }

    function onPointerCancel() {
      clearReorderDrag();
    }

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [
    rowDragState.sourceId,
    safeTasks,
    handleRowDrop,
    clearReorderDrag,
  ]);

  const openJira = useCallback((issueKey) => {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!key) return;

    const envBase = String(
      import.meta?.env?.VITE_JIRA_BROWSE_BASE || ""
    ).trim();
    const base = (
      envBase || "https://clarobr-jsw-tecnologia.atlassian.net"
    ).replace(/\/$/, "");

    window.open(`${base}/browse/${key}`, "_blank", "noopener,noreferrer");
  }, []);

  // ✅ Clique na barra / linha: abre drawer com selectedTaskId real
  const handleClick = useCallback(
    (task) => {
      if (persistingDates || persistingMeta) return;
      if (isGanttWindowBoundaryTask(task)) return;

      openInspectorByTaskId(task?.id);
    },
    [persistingDates, persistingMeta, openInspectorByTaskId]
  );

  const handleDoubleClick = useCallback(
    (task) => {
      if (persistingDates || persistingMeta) return;
      if (isGanttWindowBoundaryTask(task)) return;
      const issueKey = getIssueKeyFromTaskId(task?.id) || task?.issueKey;
      if (!issueKey) return;
      openJira(issueKey);
    },
    [persistingDates, persistingMeta, openJira]
  );

  const handleToggleProject = useCallback(
    (task) => {
      if (persistingDates || persistingMeta) return;
      const id = String(task?.id || "");
      if (!id.startsWith("P::")) return;

      setCollapsedProjects((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [persistingDates, persistingMeta]
  );

  /* =========================
     ✅ Persistência META (Recurso/Área/Risco)
     - Otimista via metaOverrides
     - Se falhar: reverte
  ========================= */
  const persistMetaChange = useCallback(
    async (issueKey, activityId, patch) => {
      const key = String(issueKey || "")
        .trim()
        .toUpperCase();
      const act = String(activityId || "").trim();
      if (!key || !act) return false;

      const mapKey = `${key}::${act}`;

      if (isSimulationMode) {
        const task = taskById.get(mapKey) || {
          id: mapKey,
          type: "task",
          issueKey: key,
          activityId: act,
        };
        setSimulationDrafts((prev) => upsertMetaDraft(prev, task, patch));
        setInteractionLabel("alteração adicionada à simulação");
        window.setTimeout(() => {
          setInteractionLabel((label) =>
            label === "alteração adicionada à simulação" ? "" : label
          );
        }, 1200);
        return true;
      }

      // snapshot p/ revert
      const prevOverride = metaOverrides.get(mapKey);

      // optimistic apply
      setMetaOverrides((prev) => {
        const next = new Map(prev);
        const cur = next.get(mapKey) || {};
        next.set(mapKey, { ...cur, ...(patch || {}) });
        return next;
      });

      setPersistingMeta(true);
      try {
        if (typeof onPersistMetaChange === "function") {
          const normalizedPatch = { ...(patch || {}) };
          if ("risk" in normalizedPatch && !("risco" in normalizedPatch)) {
            normalizedPatch.risco = normalizedPatch.risk ? "Risco" : "";
          }

          const ok = await onPersistMetaChange(key, act, normalizedPatch);
          if (ok === false)
            throw new Error("onPersistMetaChange returned false");
          return true;
        }

        // fallback (deixa estruturado pro pai)
        console.warn(
          "[GanttTab] onPersistMetaChange não foi fornecido. " +
            "Implemente no componente pai para persistir customfield_14017 no Jira.",
          { issueKey: key, activityId: act, patch }
        );

        throw new Error("Missing onPersistMetaChange");
      } catch (err) {
        console.error(err);

        // revert
        setMetaOverrides((prev) => {
          const next = new Map(prev);
          if (prevOverride == null) next.delete(mapKey);
          else next.set(mapKey, prevOverride);
          return next;
        });

        return false;
      } finally {
        setPersistingMeta(false);
      }
    },
    [isSimulationMode, metaOverrides, onPersistMetaChange, taskById]
  );

  const handleMetaChangeFromGrid = useCallback(
    async (task, patch) => {
      if (!task || task.type !== "task") return;
      const issueKey = task.issueKey || getIssueKeyFromTaskId(task.id);
      const activityId = task.activityId || getActivityIdFromTaskId(task.id);
      if (!issueKey || !activityId) return;

      await persistMetaChange(issueKey, activityId, patch);
    },
    [persistMetaChange]
  );

  // Drawer actions
  const toggleRiskForSelected = useCallback(async () => {
    if (!selectedInspectorTask || selectedInspectorTask.type !== "task") return;

    const issueKey = selectedInspectorTask.issueKey;
    const activityId = selectedInspectorTask.activityId;
    const nextRisk = !Boolean(selectedInspectorTask.risk);

    await persistMetaChange(issueKey, activityId, { risk: nextRisk });
  }, [selectedInspectorTask, persistMetaChange]);

  const shiftDatesForSelected = useCallback(
    async (deltaDays) => {
      if (!selectedInspectorTask || selectedInspectorTask.type !== "task")
        return;

      const baseOriginal =
        taskById.get(String(selectedInspectorTask.id || "")) ||
        selectedInspectorTask;

      const start = safeDate(baseOriginal.start);
      const end = safeDate(baseOriginal.end);
      if (!start || !end) return;

      await handleDateChange({
        ...baseOriginal,
        start: addDays(start, deltaDays),
        end: addDays(end, deltaDays),
      });
    },
    [selectedInspectorTask, taskById, handleDateChange]
  );

  const toggleChainForSelected = useCallback(() => {
    if (!selectedInspectorTask || selectedInspectorTask.type !== "task") return;
    toggleChain(selectedInspectorTask.id);
  }, [selectedInspectorTask, toggleChain]);

  const enterSimulationMode = useCallback(() => {
    setSimulationBaseline(buildSimulationBaseline(baseSafeTasks));
    setSimulationDrafts(new Map());
    setSimulationOrderOverrides(new Map(orderOverrides || []));
    setGanttMode("simulation");
  }, [baseSafeTasks, orderOverrides]);

  const leaveSimulationMode = useCallback(() => {
    setSimulationDrafts(new Map());
    setSimulationOrderOverrides(new Map());
    setSimulationBaseline(new Map());
    setGanttMode("live");
    setInteractionLabel("");
  }, []);

  const applySimulationChanges = useCallback(async () => {
    if (!isSimulationMode || !hasPendingSimulationChanges) return;
    if (persistingDates || persistingMeta) return;

    const changes = simulationChanges;
    const dateUpdates = [];
    const metaUpdates = [];

    for (const change of changes) {
      const task = taskById.get(change.id) || change;
      const original = change.original;
      const start = safeDate(change.start);
      const end = safeDate(change.end);
      const originalStart = safeDate(original?.start);
      const originalEnd = safeDate(original?.end);
      const hasDateChange =
        start &&
        end &&
        (!originalStart ||
          !originalEnd ||
          start.getTime() !== originalStart.getTime() ||
          end.getTime() !== originalEnd.getTime());

      if (hasDateChange) {
        dateUpdates.push({
          ...task,
          type: "task",
          issueKey: change.issueKey,
          activityId: change.activityId,
          start,
          end,
          visualEndAdjusted: false,
        });
      }

      if (change.meta && Object.keys(change.meta).length) {
        const normalizedPatch = { ...(change.meta || {}) };
        if ("risk" in normalizedPatch && !("risco" in normalizedPatch)) {
          normalizedPatch.risco = normalizedPatch.risk ? "Risco" : "";
        }
        metaUpdates.push({
          issueKey: change.issueKey,
          activityId: change.activityId,
          patch: normalizedPatch,
        });
      }
    }

    setPersistingDates(Boolean(dateUpdates.length));
    setPersistingMeta(Boolean(metaUpdates.length));
    try {
      if (dateUpdates.length) {
        const ok = await onPersistDateChange?.(dateUpdates);
        if (ok === false) throw new Error("Persist simulation dates returned false");
      }

      if (metaUpdates.length) {
        if (typeof onPersistMetaChange !== "function") {
          throw new Error("Missing onPersistMetaChange");
        }
        for (const update of metaUpdates) {
          const ok = await onPersistMetaChange(
            update.issueKey,
            update.activityId,
            update.patch
          );
          if (ok === false)
            throw new Error("Persist simulation meta returned false");
        }
      }

      if (simulationOrderOverrides.size) {
        setOrderOverrides(new Map(simulationOrderOverrides));
      }
      leaveSimulationMode();
    } catch (err) {
      console.error(err);
    } finally {
      setPersistingDates(false);
      setPersistingMeta(false);
    }
  }, [
    hasPendingSimulationChanges,
    isSimulationMode,
    leaveSimulationMode,
    onPersistDateChange,
    onPersistMetaChange,
    persistingDates,
    persistingMeta,
    simulationChanges,
    simulationOrderOverrides,
    taskById,
  ]);

  const exportGantt = useCallback(
    async (format) => {
      const target = ganttWrapRef.current;
      if (!target || exportingGantt) return;
      const normalizedFormat = String(format || "").toLowerCase();
      if (normalizedFormat !== "png" && normalizedFormat !== "pdf") return;

      setExportingGantt(normalizedFormat);
      try {
        const [{ default: html2canvas }, jsPdfModule] = await Promise.all([
          import("html2canvas"),
          import("jspdf"),
        ]);
        const canvas = await html2canvas(target, {
          backgroundColor: "#ffffff",
          scale: Math.min(2, window.devicePixelRatio || 1.5),
          useCORS: true,
        });
        const stamp = new Date().toISOString().slice(0, 10);
        const suffix = isSimulationMode ? "simulacao" : "ao-vivo";

        if (normalizedFormat === "png") {
          const link = document.createElement("a");
          link.download = `gantt-${suffix}-${stamp}.png`;
          link.href = canvas.toDataURL("image/png");
          link.click();
          return;
        }

        const { jsPDF } = jsPdfModule;
        const pdf = new jsPDF({
          orientation: canvas.width >= canvas.height ? "landscape" : "portrait",
          unit: "px",
          format: [canvas.width, canvas.height + 48],
        });
        pdf.setFontSize(14);
        pdf.text(`Gantt - ${isSimulationMode ? "Simulação" : "Ao vivo"}`, 24, 24);
        pdf.setFontSize(10);
        pdf.text(`Gerado em ${new Intl.DateTimeFormat("pt-BR").format(new Date())}`, 24, 40);
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 48, canvas.width, canvas.height);
        pdf.save(`gantt-${suffix}-${stamp}.pdf`);
      } catch (err) {
        console.error(err);
      } finally {
        setExportingGantt("");
      }
    },
    [exportingGantt, isSimulationMode]
  );

  /* =========================
     Header / Table custom
  ========================= */
  const TaskListHeader = useMemo(() => {
    return TaskListHeaderFactory({
      colWidthsRef,
      beginResize,
    });
  }, [beginResize]);

  // ✅ Table custom (agora recebe chain/toggle)
  const TaskListTable = useMemo(() => {
    return TaskListTableFactory({
      onOpenDetails,
      conflictSet: visibleConflictSet,
      onToggleProject: handleToggleProject,
      colWidthsRef,
      chainSet,
      onToggleChain: toggleChain,
      onChangeDuration: handleDurationChange,
      onChangeDate: handleDateInputChange,
      onChangeMeta: handleMetaChangeFromGrid,
      simulationBaseline,
      dependencyViolationSet: dependencyViolations.ids,
      isSimulationMode,
      rowDragStateRef,
      onRowPointerDown: handleRowPointerDown,
      busy,
      getDurationDays: getBusinessDurationDays,

      onOpenInspectorByTaskId: openInspectorByTaskId,
      ganttSetSelectedTaskIdRef,
    });
  }, [
    onOpenDetails,
    visibleConflictSet,
    handleToggleProject,
    chainSet,
    lockedSet,
    toggleChain,
    handleDurationChange,
    handleDateInputChange,
    handleMetaChangeFromGrid,
    handleRowPointerDown,
    busy,
    getBusinessDurationDays,
    openInspectorByTaskId,
    simulationBaseline,
    dependencyViolations,
    isSimulationMode,
  ]);

  return (
    <div className="grid gap-3">
      <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
        <CardContent className="relative p-4">
          {/* Overlay de carregamento (trava tela durante persist) */}
          {busy ? (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-[2px]">
              <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                <span className="text-sm font-semibold text-zinc-800">
                  {operationLabel || "Atualizando dados..."}
                </span>
              </div>
            </div>
          ) : null}

          <div
            className={cn(busy && "pointer-events-none select-none opacity-70")}
          >
            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-start">
              <div className="shrink-0">
                <h2 className="text-base font-semibold text-zinc-900">Gantt</h2>
                {operationLabel ? (
                  <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {operationLabel}
                  </div>
                ) : null}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
                <div className="relative w-full md:w-[300px]">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                  <Input
                    value={filterText}
                    onChange={(e) => setFilterText?.(e.target.value)}
                    placeholder="Buscar por ticket, atividade ou recurso..."
                    className="h-10 rounded-xl border-zinc-200 bg-white pl-9 focus-visible:ring-red-500"
                  />
                </div>

                <div className="inline-flex w-full items-center rounded-xl border border-zinc-200 bg-zinc-50 p-1 md:w-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setColorMode?.("ticket")}
                    className={toolbarButton(colorMode === "ticket")}
                  >
                    Por Ticket
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setColorMode?.("recurso")}
                    className={toolbarButton(colorMode === "recurso")}
                  >
                    Por Recurso
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setColorMode?.("atividade")}
                    className={toolbarButton(colorMode === "atividade")}
                  >
                    Por Atividade
                  </Button>
                </div>

                <div className="inline-flex w-full items-center rounded-xl border border-zinc-200 bg-zinc-50 p-1 md:w-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={leaveSimulationMode}
                    className={toolbarButton(!isSimulationMode)}
                    disabled={busy}
                  >
                    Ao vivo
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={enterSimulationMode}
                    className={toolbarButton(isSimulationMode)}
                    disabled={busy}
                  >
                    Simulação
                  </Button>
                </div>
              </div>
            </div>

            {isSimulationMode ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-xs font-semibold text-amber-900">
                  Simulação ativa: {simulationChanges.length} alteração
                  {simulationChanges.length === 1 ? "" : "ões"} pendente
                  {simulationChanges.length === 1 ? "" : "s"}.
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl border-amber-300 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                  onClick={applySimulationChanges}
                  disabled={busy || !hasPendingSimulationChanges}
                >
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  Aplicar todas alterações
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700"
                  onClick={leaveSimulationMode}
                  disabled={busy}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Descartar simulação
                </Button>
                {simulationResourceConflicts.details.length ? (
                  <Badge className="rounded-full bg-orange-600 text-white">
                    <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                    recursos: {simulationResourceConflicts.details.length}
                  </Badge>
                ) : null}
                {dependencyViolations.details.length ? (
                  <Badge className="rounded-full bg-red-600 text-white">
                    <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                    dependências: {dependencyViolations.details.length}
                  </Badge>
                ) : null}
              </div>
            ) : null}

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={chipButton(quickView === "po")}
                onClick={() => setQuickView("po")}
              >
                Fluxo PO (padrão)
              </button>

              <button
                type="button"
                className={chipButton(quickView === "recurso")}
                onClick={() => setQuickView("recurso")}
              >
                Por Recurso
              </button>

              <button
                type="button"
                className={chipButton(quickView === "risco")}
                onClick={() => setQuickView("risco")}
              >
                Risco / Overlap
              </button>

              {quickView === "risco" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge className="rounded-full bg-orange-600 text-white">
                      <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                      conflitos: {conflictSet?.size || 0}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    Marca sobreposição de atividades do mesmo recurso.
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>

            <Separator className="my-3" />

            <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700"
                  onClick={() => shiftGanttCalendar("previous")}
                >
                  <ChevronLeft className="mr-1.5 h-3.5 w-3.5" />
                  Anterior
                </Button>

                <div className="inline-flex items-center rounded-xl border border-zinc-200 bg-white p-1">
                  {GANTT_RANGE_LABELS.map(([label, mode]) => (
                    <Button
                      key={label}
                      type="button"
                      variant="ghost"
                      className={cn(
                        "h-9 rounded-lg px-3 text-xs font-semibold",
                        viewMode === mode
                          ? "bg-zinc-900 text-white hover:bg-zinc-900"
                          : "text-zinc-700 hover:bg-zinc-50"
                      )}
                      onClick={() => {
                        setViewMode(mode);
                        resetGanttHorizontalScroll();
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700"
                  onClick={() => shiftGanttCalendar("next")}
                >
                  Pr&oacute;ximo
                  <ChevronRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>

                <span className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600">
                  {fmtDateBR(ganttWindow.start)} - {fmtDateBR(ganttWindow.end)}
                </span>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex h-10 cursor-help items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-600">
                      <HelpCircle className="h-3.5 w-3.5 text-zinc-400" />
                      {getGanttWindowSpanDays(viewMode)} dias
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[260px]">
                    <div className="grid gap-1 text-xs">
                      <div className="font-semibold text-zinc-900">
                        Quantidade exibida por visão
                      </div>
                      {GANTT_RANGE_LABELS.map(([label, mode]) => (
                        <div
                          key={label}
                          className="flex items-center justify-between gap-5"
                        >
                          <span>{label}</span>
                          <strong>{getGanttWindowSpanDays(mode)} dias</strong>
                        </div>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>

                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "rounded-xl border-zinc-200 bg-white",
                    groupByTicket && "border-red-200 bg-red-50 text-red-700"
                  )}
                  onClick={() => setGroupByTicket((v) => !v)}
                  aria-pressed={groupByTicket}
                >
                  Agrupar por Ticket
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "rounded-xl border-zinc-200 bg-white",
                    onlyInProgress && "border-red-200 bg-red-50 text-red-700"
                  )}
                  onClick={() => setOnlyInProgress((v) => !v)}
                  aria-pressed={onlyInProgress}
                >
                  Somente em andamento
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "rounded-xl border-zinc-200 bg-white",
                    calendarOnlyMode && "border-red-200 bg-red-50 text-red-700"
                  )}
                  onClick={() => {
                    setCalendarOnlyMode((v) => !v);
                    resetGanttHorizontalScroll();
                  }}
                  aria-pressed={calendarOnlyMode}
                >
                  {calendarOnlyMode ? "Mostrar tabela" : "Só calendário"}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl border-zinc-200 bg-white"
                  onClick={() => exportGantt("png")}
                  disabled={busy}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  PNG
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl border-zinc-200 bg-white"
                  onClick={() => exportGantt("pdf")}
                  disabled={busy}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  PDF
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xs font-semibold text-zinc-700">
                  Ticket:
                </div>
                <select
                  value={selectedIssueKey}
                  onChange={(e) => setSelectedIssueKey(e.target.value)}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Todos</option>
                  {ticketOptions.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>

                <select
                  value={resourceFilter}
                  onChange={(e) => setResourceFilter(e.target.value)}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
                  aria-label="Filtrar por recurso"
                >
                  <option value="">Todos recursos</option>
                  {structuredFilterOptions.resources.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>

                <select
                  value={areaFilter}
                  onChange={(e) => setAreaFilter(e.target.value)}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
                  aria-label="Filtrar por área"
                >
                  <option value="">Todas áreas</option>
                  {structuredFilterOptions.areas.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>

              </div>
            </div>

            <div className="mb-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-700">
                  Legenda:
                </span>
                <span className="text-xs text-zinc-500">
                  {colorMode === "ticket"
                    ? "Por Ticket"
                    : colorMode === "recurso"
                    ? "Por Recurso"
                    : "Por Atividade"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 overflow-x-auto">
                {legendItems.slice(0, 18).map((it) => (
                  <span
                    key={it.key}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700"
                    title={it.label}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: it.color }}
                    />
                    <span className="max-w-[260px] truncate">{it.label}</span>
                  </span>
                ))}

                {viewMode === ViewMode.Day ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-zinc-700">
                    <span className="h-2.5 w-2.5 rounded-sm bg-red-200" />
                    <span>Dias não úteis</span>
                  </span>
                ) : null}

                {legendItems.length > 18 ? (
                  <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                    {legendItems.length - 18}
                  </Badge>
                ) : null}
              </div>
            </div>

            {isSimulationMode && simulationChanges.length ? (
              <div className="mb-3 rounded-2xl border border-amber-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold text-amber-800">
                  Baseline do cronograma original
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {simulationChanges.slice(0, 6).map((change) => (
                    <div
                      key={change.id}
                      className="rounded-xl border border-zinc-200 bg-amber-50/50 px-3 py-2 text-xs"
                    >
                      <div className="truncate font-semibold text-zinc-900">
                        {change.issueKey} · {change.name || change.activityId}
                      </div>
                      <div className="mt-1 text-zinc-600">
                        {fmtDateBR(change.original?.start)} -{" "}
                        {fmtDateBR(change.original?.end)} →{" "}
                        <strong>
                          {fmtDateBR(change.start)} - {fmtDateBR(change.end)}
                        </strong>
                      </div>
                      {change.meta && Object.keys(change.meta).length ? (
                        <div className="mt-1 truncate text-amber-700">
                          Meta: {Object.keys(change.meta).join(", ")}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-zinc-200 bg-white">
              <div className="flex">
                <div
                  ref={ganttWrapRef}
                  className={cn(
                    "gantt-scroll-shell h-[68vh] min-w-0 flex-1 max-w-full overflow-x-auto overflow-y-auto pb-2",
                    isGanttPanning ? "cursor-grabbing" : "cursor-grab"
                  )}
                  onScroll={handleGanttScroll}
                  onPointerDown={beginGanttPan}
                  onClickCapture={handleGanttPanClickCapture}
                >
                  {ganttTasks.length > 0 ? (
                    <div
                      key={ganttRenderKey}
                      className="gantt-range-clip"
                      style={{
                        width: `${ganttContentWidth}px`,
                        "--gantt-visible-timeline-width": `${ganttVisibleTimelineWidth}px`,
                        "--gantt-leading-offset": `${ganttLeadingOffset}px`,
                      }}
                    >
                      <Gantt
                        tasks={ganttRenderTasks}
                        viewMode={viewMode}
                        viewDate={ganttWindow.start}
                        preStepsCount={1}
                        locale="pt-BR"
                        onDateChange={handleDateChange}
                        onClick={handleClick}
                        onDoubleClick={handleDoubleClick}
                        onExpanderClick={(task) => handleToggleProject(task)}
                        TooltipContent={GanttTooltipContent}
                        TaskListHeader={TaskListHeader}
                        TaskListTable={TaskListTable}
                        listCellWidth={effectiveListCellWidth}
                        columnWidth={ganttColumnWidth}
                        rowHeight={42}
                        barCornerRadius={8}
                      />
                      {nonWorkingDayColumns.length ? (
                        <div
                          className="gantt-non-working-overlay"
                          aria-hidden="true"
                        >
                          {nonWorkingDayColumns.map((column) => (
                            <span
                              key={column.key}
                              className="gantt-non-working-day"
                              style={{
                                left: `${column.left}px`,
                                width: `${column.width}px`,
                              }}
                              title={column.label}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="p-6 text-sm text-zinc-600">
                      Nenhuma atividade com datas neste período do Gantt.
                      <div className="mt-2 text-xs text-zinc-500">
                        Use Anterior/Próximo para navegar ou ajuste os filtros.
                      </div>
                    </div>
                  )}
                </div>
                <div
                  ref={ganttVerticalBarRef}
                  className={cn(
                    "gantt-vertical-scrollbar h-[68vh]",
                    ganttTasks.length > 0 ? "block" : "hidden"
                  )}
                  onScroll={handleGanttVerticalBarScroll}
                  tabIndex={0}
                  aria-label="Rolagem vertical do Gantt"
                >
                  <div
                    className="w-px"
                    style={{ height: `${ganttVerticalScrollHeight}px` }}
                  />
                </div>
              </div>
              <div
                ref={ganttHorizontalBarRef}
                className={cn(
                  "gantt-horizontal-scrollbar",
                  hasGanttHorizontalScroll ? "block" : "hidden",
                  ganttTasks.length > 0 ? "mr-[18px]" : ""
                )}
                onScroll={handleGanttHorizontalBarScroll}
                tabIndex={0}
                aria-label="Rolagem horizontal do Gantt"
              >
                <div
                  className="h-px"
                  style={{
                    width: `${
                      ganttHorizontalScrollWidth || ganttContentWidth
                    }px`,
                  }}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-900">
                <History className="h-4 w-4 text-red-600" />
                Últimas alterações
              </div>
              {changeHistory.length ? (
                <div className="grid gap-2">
                  {changeHistory.slice(0, 4).map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 text-zinc-700">
                        <strong className="text-zinc-900">{entry.issueKey}</strong>{" "}
                        <span>{entry.activityName}</span>
                        <span className="ml-2 text-zinc-400">
                          {entry.previousRange} → {entry.nextRange}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-500">
                        <span>{fmtDateTimeBR(entry.timestamp)}</span>
                        <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-semibold">
                          {entry.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-3 text-xs text-zinc-500">
                  Nenhuma alteração de cronograma nesta sessão.
                </div>
              )}
            </div>

          </div>
        </CardContent>
      </Card>

      {/* ✅ Drawer Inspector */}
      <GanttTaskInspectorDrawer
        open={inspectorOpen}
        onOpenChange={(v) => {
          setInspectorOpen(v);
          if (!v) setInspectorTaskId("");
        }}
        task={selectedInspectorTask}
        issue={selectedIssue}
        dueDate={selectedDueDate}
        overdueDays={selectedOverdueDays}
        prevTask={prevTask}
        nextTask={nextTask}
        chainActive={Boolean(
          selectedInspectorTask?.type === "task" &&
            chainSet.has(selectedInspectorTask.id)
        )}
        onOpenJira={(k) => openJira(k)}
        onToggleRisk={toggleRiskForSelected}
        onShiftDates={(delta) => shiftDatesForSelected(delta)}
        onToggleChain={toggleChainForSelected}
        onSelectTask={(id) => openInspectorByTaskId(id)}
      />
    </div>
  );
}

export default GanttTab;
