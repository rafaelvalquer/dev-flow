// src/components/GanttTab.jsx
import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import { Gantt, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";

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
  Loader2,
  Search,
  Lock,
  Unlock,
  Link2,
  Link2Off,
} from "lucide-react";

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

function safeDate(v) {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
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

/* =========================
   Tooltip do Gantt (remove "From/To")
========================= */
function GanttTooltipContent({ task, fontSize, fontFamily }) {
  const isProject = task?.type === "project";
  const issueKey = getIssueKeyFromTaskId(task?.id) || task?.issueKey || "—";

  return (
    <div
      style={{ fontSize, fontFamily }}
      className="min-w-[220px] rounded-xl border border-zinc-200 bg-white p-3 shadow-md"
    >
      <div className="text-xs font-semibold text-zinc-900">
        {isProject ? `Ticket ${issueKey}` : task?.name || "—"}
      </div>

      {!isProject ? (
        <div className="mt-1 text-[11px] text-zinc-600">
          {issueKey}
          {task?.recurso ? ` • ${task.recurso}` : ""}
        </div>
      ) : null}

      <div className="mt-2 text-[11px] font-semibold text-zinc-800">
        {fmtDateBR(task?.start)} — {fmtDateBR(task?.end)}
      </div>

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
      key = t.activityId || getActivityIdFromTaskId(t.id) || t.name;
      label = ATIVIDADE_LABEL_BY_ID[key] || t.name || key;
    } else {
      key = t.issueKey || "—";
      label = key;
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
   Build tasks (SEU CÓDIGO - mantido)
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
    let end = safeDate(ev?.end);

    if (!start) continue;
    if (!end || end <= start) end = addDays(start, 1);

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
      metaIndex.set(`${issueKey}::${activityId}`, {
        recurso: String(atv?.recurso || "").trim() || "Sem recurso",
        area: String(atv?.area || "").trim() || "—",
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

      const meta = metaIndex.get(`${issueKey}::${activityId}`) || {};
      const name =
        ATIVIDADE_LABEL_BY_ID[activityId] ||
        meta.activityName ||
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
        recurso: meta.recurso || "Sem recurso",
        area: meta.area || "—",
        statusName: meta.statusName || "",
        summary: meta.summary || "",
      });
    }

    if (!activityTasks.length) continue;

    let ordered = [...activityTasks];

    if (quickView === "po") {
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
        recurso: "",
        area: "",
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
          [t.issueKey, t.name, t.activityId, t.recurso, t.area, t.summary].join(
            " "
          )
        );
        return hay.includes(q);
      });

  let finalTasks = filteredByText;
  if (quickView === "recurso") {
    finalTasks = [...filteredByText].sort((a, b) => {
      if (a.type === "project" && b.type !== "project") return -1;
      if (a.type !== "project" && b.type === "project") return 1;

      const ra = String(a.recurso || "");
      const rb = String(b.recurso || "");
      const c = ra.localeCompare(rb);
      if (c !== 0) return c;
      return a.start.getTime() - b.start.getTime();
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
      colorKey =
        ATIVIDADE_COLOR_BY_ID[t.activityId] ||
        t.activityId ||
        groupAtividadeName(t.name);
    }

    if (!colorMap.has(colorKey)) {
      const fixed =
        colorMode === "atividade" ? ATIVIDADE_COLOR_BY_ID[colorKey] : null;
      colorMap.set(colorKey, fixed || pickColor(colorKey));
    }
  }

  finalTasks = finalTasks.map((t) => {
    let colorKey = "—";
    if (colorMode === "ticket") colorKey = t.issueKey || "—";
    else if (colorMode === "recurso") colorKey = t.recurso || "Sem recurso";
    else if (colorMode === "atividade") {
      colorKey =
        ATIVIDADE_COLOR_BY_ID[t.activityId] ||
        t.activityId ||
        groupAtividadeName(t.name);
    }

    const baseColor = colorMap.get(colorKey) || pickColor(colorKey);

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
  ticket: 120,
  atividade: 360,
  recurso: 160,
  area: 120,
  start: 76,
  end: 76,
  chain: 56,
};

const MIN_COL_WIDTHS = {
  ticket: 90,
  atividade: 220,
  recurso: 120,
  area: 90,
  start: 64,
  end: 64,
  chain: 56,
};

function makeGridTemplate(w) {
  const x = w || DEFAULT_COL_WIDTHS;
  return `${x.ticket}px ${x.atividade}px ${x.recurso}px ${x.area}px ${x.start}px ${x.end}px ${x.chain}px`;
}

/* =========================
   TaskListHeader (CUSTOM) - remove Name/From/To + RESIZE
   (isso elimina o cabeçalho padrão do lib)
========================= */
function TaskListHeaderFactory({ colWidthsRef, beginResize }) {
  return function TaskListHeader({ headerHeight, rowWidth }) {
    const gridTemplateColumns = makeGridTemplate(colWidthsRef.current);

    const HeaderCell = ({ label, colKey }) => (
      <div className="relative min-w-0 select-none pr-2">
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
        className="grid gap-2 border-r border-zinc-200 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] font-semibold text-zinc-700"
      >
        <HeaderCell label="Ticket" colKey="ticket" />
        <HeaderCell label="Atividade" colKey="atividade" />
        <HeaderCell label="Recurso" colKey="recurso" />
        <HeaderCell label="Área" colKey="area" />
        <HeaderCell label="Start" colKey="start" />
        <HeaderCell label="End" colKey="end" />
        <HeaderCell label="Encadear" colKey="chain" />
      </div>
    );
  };
}

/* =========================
   TaskListTable (CUSTOM) - SOMENTE LINHAS (header fica no TaskListHeader)
========================= */
function TaskListTableFactory({
  onOpenDetails,
  conflictSet,
  onToggleProject,
  colWidthsRef,
  chainSet,
  lockedSet,
  onToggleChain,
}) {
  return function TaskListTable({
    rowHeight,
    rowWidth,
    tasks,
    selectedTaskId,
    setSelectedTask,
  }) {
    const taskRows = tasks.filter(
      (t) => t.type === "task" || t.type === "project"
    );

    const gridTemplateColumns = makeGridTemplate(colWidthsRef.current);

    return (
      <div
        style={{ width: rowWidth }}
        className="h-full overflow-auto border-r border-zinc-200 bg-white"
      >
        {taskRows.map((t) => {
          const selected = t.id === selectedTaskId;
          const isProject = t.type === "project";

          return (
            <div
              key={t.id}
              style={{ height: rowHeight, gridTemplateColumns }}
              className={cn(
                "grid gap-2 px-3 text-[12px]",
                "border-b border-zinc-100",
                selected ? "bg-red-50" : "bg-white",
                "items-center"
              )}
              onClick={() => setSelectedTask(t.id)}
            >
              {/* Ticket */}
              <div className="min-w-0 flex items-center gap-2">
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
              <div className="min-w-0 flex items-center gap-2">
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

                <span
                  className={cn("truncate", isProject && "font-semibold")}
                  title={t.name}
                >
                  {t.name}
                </span>

                {!isProject && conflictSet?.has(t.id) ? (
                  <Badge className="ml-auto rounded-full bg-orange-600 text-white">
                    ⚠ conflito
                  </Badge>
                ) : null}
              </div>

              {/* Recurso */}
              <div className="truncate text-zinc-700" title={t.recurso}>
                {isProject ? "—" : t.recurso || "Sem recurso"}
              </div>

              {/* Área */}
              <div className="truncate text-zinc-700" title={t.area}>
                {isProject ? "—" : t.area || "—"}
              </div>

              {/* Start / End */}
              <div className="text-zinc-700">{fmtDateBR(t.start)}</div>
              <div className="text-zinc-700">{fmtDateBR(t.end)}</div>

              {/* Encadear */}
              <div className="flex items-center justify-center">
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
                      <Lock className="h-4 w-4" />
                    ) : (
                      <Unlock className="h-4 w-4" />
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
}) {
  const [viewMode, setViewMode] = useState(ViewMode.Week);
  const [groupByTicket, setGroupByTicket] = useState(true);
  const [onlyInProgress, setOnlyInProgress] = useState(true);
  const [selectedIssueKey, setSelectedIssueKey] = useState("");
  const [quickView, setQuickView] = useState("po");
  const [collapsedProjects, setCollapsedProjects] = useState(() => new Set());

  // trava durante persistência de mudança de datas (drag/resize)
  const [persisting, setPersisting] = useState(false);

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
      const raw = localStorage.getItem("gantt_colWidths_v1");
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
      localStorage.setItem("gantt_colWidths_v1", JSON.stringify(colWidths));
    } catch {}
  }, [colWidths]);

  // ✅ calcula o listCellWidth (7 colunas => 6 gaps)
  const listCellWidth = useMemo(() => {
    const sum = Object.values(colWidths || {}).reduce(
      (acc, v) => acc + Number(v || 0),
      0
    );
    // 7 colunas -> 6 gaps (gap-2 = 8px) = 48px
    // px-3 (12px) em cada lado = 24px
    return `${sum + 48 + 24}px`;
  }, [colWidths]);

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
  ]);

  const safeTasks = useMemo(() => {
    const arr = Array.isArray(tasks) ? tasks : [];
    return arr.filter((t) => {
      if (!t) return false;
      if (!(t.start instanceof Date) || Number.isNaN(t.start.getTime()))
        return false;
      if (!(t.end instanceof Date) || Number.isNaN(t.end.getTime()))
        return false;
      return true;
    });
  }, [tasks]);

  const { taskById, nextById, prevById } = useMemo(() => {
    const tasksOnly = (safeTasks || []).filter((t) => t?.type === "task");

    // id -> task
    const taskById = new Map(tasksOnly.map((t) => [t.id, t]));

    // ticket -> array de tasks ordenadas
    const byIssue = new Map();
    for (const t of tasksOnly) {
      if (!byIssue.has(t.issueKey)) byIssue.set(t.issueKey, []);
      byIssue.get(t.issueKey).push(t);
    }

    // ordena cada ticket no "mesmo critério" que você usa no cascade
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

    // gera next/prev
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
  }, [safeTasks, quickView]);

  /* =========================
     ✅ lockedSet e ganttTasks
     (AGORA dentro do componente)
  ========================= */
  const lockedSet = useMemo(() => {
    const locked = new Set();

    for (const [id, prevId] of prevById.entries()) {
      if (prevId && chainSet.has(prevId)) locked.add(id);
    }

    return locked;
  }, [prevById, chainSet]);

  const ganttTasks = useMemo(() => {
    return (safeTasks || []).map((t) => {
      if (t.type !== "task") return t;
      if (!lockedSet.has(t.id)) return t;
      return { ...t, isDisabled: true };
    });
  }, [safeTasks, lockedSet]);

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

  const findNextTaskSameIssue = useCallback(
    (taskId) => {
      const cur = (ganttTasks || []).find((t) => t?.id === taskId);
      if (!cur || cur.type !== "task") return null;

      const issueTasks = (ganttTasks || []).filter(
        (t) => t.type === "task" && t.issueKey === cur.issueKey
      );

      // ordem baseada no modo atual
      if (quickView === "po") {
        issueTasks.sort((a, b) => {
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
        issueTasks.sort((a, b) => a.start.getTime() - b.start.getTime());
      }

      const idx = issueTasks.findIndex((t) => t.id === taskId);
      return idx >= 0 ? issueTasks[idx + 1] || null : null;
    },
    [ganttTasks, quickView]
  );

  /* =========================
     ✅ handleDateChange (APENAS 1)
     com cascata quando encadeado
  ========================= */
  const handleDateChange = useCallback(
    async (task) => {
      if (persisting) return false;
      if (!task || task.type === "project" || task.isDisabled) return false;

      const baseId = String(task.id || "");
      const baseOriginal = taskById.get(baseId) || task;

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
        start: task.start instanceof Date ? task.start : new Date(task.start),
        end: task.end instanceof Date ? task.end : new Date(task.end),
      };

      if (!base.issueKey || !base.activityId) return false;
      if (
        Number.isNaN(base.start.getTime()) ||
        Number.isNaN(base.end.getTime())
      )
        return false;

      const updates = [base];

      // evita loop caso algum bug gere ciclo
      const visited = new Set([base.id]);

      let cur = base;

      while (chainSet.has(cur.id)) {
        const nextId = nextById.get(cur.id);
        if (!nextId || visited.has(nextId)) break;

        const next = taskById.get(nextId);
        if (!next) break;

        const nextStart = new Date(cur.end);

        const nextDur = Math.max(
          next.end.getTime() - next.start.getTime(),
          24 * 60 * 60 * 1000
        );

        const nextEnd = new Date(nextStart.getTime() + nextDur);

        const nextUpdate = {
          ...next,
          start: nextStart,
          end: nextEnd,
        };

        updates.push(nextUpdate);
        visited.add(nextId);
        cur = nextUpdate;
      }

      setPersisting(true);
      try {
        const ok = await onPersistDateChange?.(updates);
        return ok !== false;
      } catch (err) {
        console.error(err);
        return false;
      } finally {
        setPersisting(false);
      }
    },
    [persisting, chainSet, nextById, taskById, onPersistDateChange]
  );

  const handleClick = useCallback(
    (task) => {
      if (persisting) return;
      const issueKey = getIssueKeyFromTaskId(task?.id) || task?.issueKey;
      if (issueKey) setSelectedIssueKey(issueKey);
    },
    [persisting]
  );

  const handleDoubleClick = useCallback(
    (task) => {
      if (persisting) return;
      const issueKey = getIssueKeyFromTaskId(task?.id) || task?.issueKey;
      if (!issueKey) return;

      const envBase = String(
        import.meta?.env?.VITE_JIRA_BROWSE_BASE || ""
      ).trim();
      const base = (
        envBase || "https://clarobr-jsw-tecnologia.atlassian.net"
      ).replace(/\/$/, "");

      window.open(
        `${base}/browse/${issueKey}`,
        "_blank",
        "noopener,noreferrer"
      );
    },
    [persisting]
  );

  const handleToggleProject = useCallback(
    (task) => {
      if (persisting) return;
      const id = String(task?.id || "");
      if (!id.startsWith("P::")) return;

      setCollapsedProjects((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [persisting]
  );

  // ✅ Header custom remove Name/From/To
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
      conflictSet,
      onToggleProject: handleToggleProject,
      colWidthsRef,
      chainSet,
      lockedSet,
      onToggleChain: toggleChain,
    });
  }, [
    onOpenDetails,
    conflictSet,
    handleToggleProject,
    chainSet,
    lockedSet,
    toggleChain,
  ]);

  const busy = Boolean(loading || persisting);

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
                  {persisting
                    ? "Salvando alteração..."
                    : "Atualizando dados..."}
                </span>
              </div>
            </div>
          ) : null}

          <div
            className={cn(busy && "pointer-events-none select-none opacity-70")}
          >
            <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">Gantt</h2>
                <p className="text-xs text-zinc-500">
                  Arraste/redimensione para alterar datas. Dependências são
                  desenhadas por atividades do ticket.
                </p>
              </div>

              <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
                <div className="relative w-full md:w-[360px]">
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
              </div>
            </div>

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
                <div className="inline-flex items-center rounded-xl border border-zinc-200 bg-white p-1">
                  {[
                    ["Day", ViewMode.Day],
                    ["Week", ViewMode.Week],
                    ["Month", ViewMode.Month],
                    ["Year", ViewMode.Year],
                  ].map(([label, mode]) => (
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
                      onClick={() => setViewMode(mode)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>

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

                {legendItems.length > 18 ? (
                  <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                    {legendItems.length - 18}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
              <div className="w-full overflow-auto">
                {safeTasks.length > 0 ? (
                  <Gantt
                    tasks={ganttTasks}
                    viewMode={viewMode}
                    locale="pt-BR"
                    onDateChange={handleDateChange}
                    onClick={handleClick}
                    onDoubleClick={handleDoubleClick}
                    onExpanderClick={(task) => handleToggleProject(task)}
                    TooltipContent={GanttTooltipContent}
                    TaskListHeader={TaskListHeader}
                    TaskListTable={TaskListTable}
                    listCellWidth={listCellWidth}
                    columnWidth={
                      viewMode === ViewMode.Day
                        ? 48
                        : viewMode === ViewMode.Week
                        ? 70
                        : 90
                    }
                    rowHeight={42}
                    barCornerRadius={8}
                  />
                ) : (
                  <div className="p-6 text-sm text-zinc-600">
                    Nenhuma atividade com datas para exibir no Gantt.
                    <div className="mt-2 text-xs text-zinc-500">
                      Dica: limpe filtros, desmarque “Somente em andamento” ou
                      selecione “Todos”.
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 text-xs text-zinc-600">
              Alterações persistem no Jira em{" "}
              <code className="rounded bg-zinc-100 px-1">
                customfield_14017
              </code>
              . Se ocorrer erro, o Gantt desfaz automaticamente.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default GanttTab;
