import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Responsive, useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./DeveloperCenterTab.css";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Bookmark,
  CalendarDays,
  Clock,
  CloudUpload,
  Copy,
  FileText,
  Filter,
  Grid2X2,
  Grip,
  ListChecks,
  MessageSquare,
  MoreVertical,
  NotebookPen,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Settings2,
  Sparkles,
  TimerReset,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import ChecklistGMUDTab from "./ChecklistGMUDTab";
import {
  createDeveloperStickyNote,
  deleteDeveloperStickyNote,
  fetchDeveloperWorkspace,
  registerDeveloperRecentTicket,
  saveDeveloperWorkspacePreferences,
} from "../lib/developerWorkspace";
import { cn } from "@/lib/utils";

const WIDGETS = [
  { id: "queue", label: "Minha fila" },
  { id: "nextActions", label: "Proximas acoes" },
  { id: "risk", label: "Tickets em risco" },
  { id: "calendar", label: "Calendario" },
  { id: "recent", label: "Ultimos acessados" },
  { id: "notes", label: "Notas pessoais" },
  { id: "productivity", label: "Atalhos rapidos" },
];

const DEFAULT_VISIBLE_WIDGETS = WIDGETS.map((widget) => widget.id);
const DEFAULT_LAYOUTS = {
  lg: [
    { i: "queue", x: 0, y: 0, w: 6, h: 5, minW: 5, minH: 4 },
    { i: "risk", x: 6, y: 0, w: 3, h: 5, minW: 3, minH: 4 },
    { i: "nextActions", x: 9, y: 0, w: 3, h: 5, minW: 3, minH: 4 },
    { i: "calendar", x: 0, y: 5, w: 5, h: 6, minW: 4, minH: 5 },
    { i: "recent", x: 5, y: 5, w: 2, h: 6, minW: 2, minH: 5 },
    { i: "productivity", x: 7, y: 5, w: 2, h: 6, minW: 2, minH: 5 },
    { i: "notes", x: 9, y: 5, w: 3, h: 6, minW: 3, minH: 5 },
  ],
  md: [
    { i: "queue", x: 0, y: 0, w: 6, h: 6 },
    { i: "risk", x: 6, y: 0, w: 4, h: 5 },
    { i: "nextActions", x: 6, y: 5, w: 4, h: 5 },
    { i: "calendar", x: 0, y: 6, w: 6, h: 6 },
    { i: "recent", x: 6, y: 10, w: 4, h: 5 },
    { i: "productivity", x: 0, y: 12, w: 5, h: 5 },
    { i: "notes", x: 5, y: 15, w: 5, h: 5 },
  ],
  sm: WIDGETS.map((widget, index) => ({
    i: widget.id,
    x: 0,
    y: index * 5,
    w: 6,
    h: widget.id === "queue" ? 8 : 5,
  })),
};

const GRID_BREAKPOINTS = {
  lg: { cols: 12, w: 3, h: 4, minW: 2, minH: 3 },
  md: { cols: 10, w: 4, h: 4, minW: 3, minH: 3 },
  sm: { cols: 6, w: 6, h: 4, minW: 6, minH: 3 },
};

const EMPTY_WORKSPACE = {
  preferences: {
    visibleWidgets: DEFAULT_VISIBLE_WIDGETS,
    density: "comfortable",
    sortBy: "dueDate",
    startMode: "workspace",
    autoSyncOnOpen: true,
  },
  layout: DEFAULT_LAYOUTS,
  recentTickets: [],
  stickyNotes: [],
  notesByTicket: {},
};

const STATUS_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "Para Dev", label: "Para Dev" },
  { value: "Desenvolvimento", label: "Desenvolvimento" },
  { value: "Para Homolog.", label: "Para Homolog." },
  { value: "Homologacao", label: "Homologacao" },
  { value: "Para Deploy", label: "Para Deploy" },
];

const PRIORITY_FILTERS = [
  { value: "all", label: "Todas" },
  { value: "highest", label: "Highest" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const DUE_FILTERS = [
  { value: "all", label: "Qualquer prazo" },
  { value: "overdue", label: "Atrasados" },
  { value: "today", label: "Hoje" },
  { value: "week", label: "Esta semana" },
  { value: "none", label: "Sem data" },
];

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeTicketKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getIssueKey(issue) {
  return normalizeTicketKey(issue?.key || issue?.issueKey || issue?.ticketKey);
}

function getSummary(issue) {
  return issue?.summary || issue?.fields?.summary || "Sem resumo";
}

function getStatus(issue) {
  return issue?.statusName || issue?.fields?.status?.name || issue?.status || "";
}

function getPriority(issue) {
  return (
    issue?.priorityName ||
    issue?.priority ||
    issue?.fields?.priority?.name ||
    "Nao informado"
  );
}

function getAssigneeAccountId(issue) {
  return (
    issue?.assigneeAccountId ||
    issue?.fields?.assignee?.accountId ||
    issue?.assignee?.accountId ||
    ""
  );
}

function getAssigneeName(issue) {
  return (
    issue?.assigneeDisplayName ||
    issue?.assignee ||
    issue?.fields?.assignee?.displayName ||
    "Sem responsavel"
  );
}

function extractYmd(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const ymd = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "object") {
    return extractYmd(
      value.value || value.date || value.start || value.end || value.startDate,
    );
  }
  return "";
}

function getDueYmd(issue) {
  return extractYmd(
    issue?.customfield_11519 ||
      issue?.dueDateRaw ||
      issue?.dueDate ||
      issue?.duedate ||
      issue?.fields?.customfield_11519 ||
      issue?.fields?.duedate,
  );
}

function parseYmdLocal(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function todayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function diffDaysFromToday(ymd) {
  const date = parseYmdLocal(ymd);
  if (!date) return null;
  return Math.round((date.getTime() - todayLocal().getTime()) / 86400000);
}

function fmtDateBr(ymd) {
  if (!ymd) return "Sem data";
  const [y, m, d] = String(ymd).slice(0, 10).split("-");
  if (!y || !m || !d) return String(ymd);
  return `${d}/${m}/${y}`;
}

function isDone(issue) {
  return /(done|conclu|closed|resolv|fechad)/i.test(norm(getStatus(issue)));
}

function hasEvidence(issue) {
  const attachments = issue?.attachments || issue?.fields?.attachment || [];
  return Array.isArray(attachments) && attachments.length > 0;
}

function isAwaitingGmud(issue) {
  return !issue?.cronogramaAdf && !issue?.kanban?.config && !issue?.hasIniciado;
}

function priorityTone(priority) {
  const normalized = norm(priority);
  if (normalized.includes("highest") || normalized.includes("alta"))
    return "danger";
  if (normalized.includes("high")) return "warning";
  if (normalized.includes("medium") || normalized.includes("media"))
    return "info";
  if (normalized.includes("low") || normalized.includes("baixa"))
    return "success";
  return "neutral";
}

function dueLabel(issue) {
  const ymd = getDueYmd(issue);
  if (!ymd) return "Sem data";
  const days = diffDaysFromToday(ymd);
  if (days === null) return fmtDateBr(ymd);
  if (days < 0) return `${Math.abs(days)}d atrasado`;
  if (days === 0) return "Vence hoje";
  if (days === 1) return "Amanha";
  return fmtDateBr(ymd);
}

function dueTone(issue) {
  const days = diffDaysFromToday(getDueYmd(issue));
  if (days === null) return "neutral";
  if (days < 0) return "danger";
  if (days <= 2) return "warning";
  return "success";
}

function getWeekdayLabel(offset) {
  const date = todayLocal();
  date.setDate(date.getDate() + offset);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function getUpdatedDate(issue) {
  const raw = issue?.updated || issue?.updatedRaw || issue?.fields?.updated;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function fmtDateTimeShort(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getProgress(issue) {
  const explicit = Number(issue?.progress || issue?.gmudProgress || 0);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(0, Math.min(100, Math.round(explicit)));
  }

  const status = norm(getStatus(issue));
  if (isDone(issue)) return 100;
  if (status.includes("deploy")) return 82;
  if (status.includes("homolog")) return 62;
  if (status.includes("desenvolv")) return 48;
  if (status.includes("para dev")) return 28;
  if (isAwaitingGmud(issue)) return 12;
  return hasEvidence(issue) ? 40 : 24;
}

function relativeAccessLabel(value) {
  if (!value) return "Agora";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Agora";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "Agora";
  if (minutes < 60) return `Ha ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Ha ${hours} h`;
  return `Ha ${Math.round(hours / 24)} dia`;
}

function getJiraBrowseUrl(ticketKey, issue) {
  const key = normalizeTicketKey(ticketKey || getIssueKey(issue));
  if (!key) return "";
  const envBase = String(import.meta?.env?.VITE_JIRA_BROWSE_BASE || "").trim();
  let inferred = "";

  try {
    const self = issue?.self || issue?.url || "";
    if (self) {
      const url = new URL(self);
      inferred = `${url.protocol}//${url.host}`;
    }
  } catch {
    inferred = "";
  }

  const base = (envBase || inferred || "https://clarobr-jsw-tecnologia.atlassian.net")
    .replace(/\/$/, "");
  return `${base}/browse/${encodeURIComponent(key)}`;
}

function buildRiskRows(rows, limit = 6) {
  return (rows || [])
    .filter((issue) => {
      const days = diffDaysFromToday(getDueYmd(issue));
      return days === null || days <= 2 || !hasEvidence(issue) || isAwaitingGmud(issue);
    })
    .slice(0, limit);
}

function buildNextActions(rows, limit = 6) {
  return (rows || [])
    .map((issue) => {
      const key = getIssueKey(issue);
      if (isAwaitingGmud(issue)) {
        return { key, label: "Criar estrutura GMUD", issue };
      }
      if (!hasEvidence(issue)) {
        return { key, label: "Subir evidencia", issue };
      }
      if (!getDueYmd(issue)) {
        return { key, label: "Definir data limite", issue };
      }
      return { key, label: "Atualizar execucao", issue };
    })
    .slice(0, limit);
}

function buildDailyStatus(rows, riskRows) {
  const active = (rows || []).filter((issue) => !isDone(issue));
  const dueSoon = active.filter((issue) => {
    const days = diffDaysFromToday(getDueYmd(issue));
    return days !== null && days >= 0 && days <= 2;
  });

  const lines = [
    "Status daily - Central do Desenvolvedor",
    `Tickets ativos: ${active.length}`,
    `Vencendo: ${dueSoon.length}`,
    `Em risco: ${(riskRows || []).length}`,
    "",
    "Prioridades:",
    ...(riskRows || []).slice(0, 5).map(
      (issue) => `- ${getIssueKey(issue)}: ${getSummary(issue)} (${dueLabel(issue)})`,
    ),
  ];

  return lines.join("\n").trim();
}

async function copyTextToClipboard(text) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

function stickyGridKey(noteId) {
  const id = String(noteId || "").trim();
  return id ? `sticky:${id}` : "";
}

function getLayoutBottom(layout = []) {
  return (layout || []).reduce(
    (bottom, item) => Math.max(bottom, Number(item?.y || 0) + Number(item?.h || 0)),
    0,
  );
}

function normalizeStickyNotes(notes) {
  return Array.isArray(notes)
    ? notes.filter((note) => note?.id && note?.ticketKey && note?.text)
    : [];
}

function ensureStickyLayouts(layouts, stickyNotes) {
  const notes = normalizeStickyNotes(stickyNotes);
  const stickyKeys = new Set(notes.map((note) => stickyGridKey(note.id)));
  const nextLayouts = {};

  Object.entries(GRID_BREAKPOINTS).forEach(([breakpoint, config]) => {
    const baseLayout = Array.isArray(layouts?.[breakpoint])
      ? layouts[breakpoint]
      : DEFAULT_LAYOUTS[breakpoint] || [];
    const cleaned = baseLayout
      .filter((item) => {
        const key = String(item?.i || "");
        return !key.startsWith("sticky:") || stickyKeys.has(key);
      })
      .map((item) => {
        const key = String(item?.i || "");
        if (!key.startsWith("sticky:")) return item;
        const width = Math.min(config.w, config.cols);
        const minW = Math.min(config.minW, config.cols);
        return {
          ...item,
          minW,
          minH: config.minH,
          w: Math.max(Number(item?.w || 0), width, minW),
          h: Math.max(Number(item?.h || 0), config.h, config.minH),
          x: Math.max(
            0,
            Math.min(Number(item?.x || 0), Math.max(0, config.cols - minW)),
          ),
        };
      });

    notes.forEach((note, index) => {
      const key = stickyGridKey(note.id);
      if (cleaned.some((item) => item.i === key)) return;
      const width = Math.min(config.w, config.cols);
      cleaned.push({
        i: key,
        x: breakpoint === "sm" ? 0 : (index * width) % config.cols,
        y: getLayoutBottom(cleaned),
        w: width,
        h: config.h,
        minW: config.minW,
        minH: config.minH,
      });
    });

    nextLayouts[breakpoint] = cleaned;
  });

  return nextLayouts;
}

function mergeWorkspace(base) {
  const stickyNotes = normalizeStickyNotes(base?.stickyNotes);
  const layout =
    base?.layout && Object.keys(base.layout || {}).length
      ? base.layout
      : DEFAULT_LAYOUTS;

  return {
    ...EMPTY_WORKSPACE,
    ...(base || {}),
    preferences: {
      ...EMPTY_WORKSPACE.preferences,
      ...(base?.preferences || {}),
      visibleWidgets: Array.isArray(base?.preferences?.visibleWidgets)
        ? base.preferences.visibleWidgets
        : DEFAULT_VISIBLE_WIDGETS,
    },
    layout: ensureStickyLayouts(layout, stickyNotes),
    recentTickets: Array.isArray(base?.recentTickets) ? base.recentTickets : [],
    stickyNotes,
    notesByTicket: base?.notesByTicket || {},
  };
}

function findTicketByKey(rows, ticketKey) {
  const key = normalizeTicketKey(ticketKey);
  return (rows || []).find((issue) => getIssueKey(issue) === key) || null;
}

export default function DeveloperCenterTab({
  currentUser,
  poData,
  onConfigureUser,
  onProgressChange,
  onRdmTitleChange,
  onRdmDueDateChange,
}) {
  const [workspace, setWorkspace] = useState(EMPTY_WORKSPACE);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [mode, setMode] = useState("workspace");
  const [selectedTicketKey, setSelectedTicketKey] = useState("");
  const [selectedInitialTab, setSelectedInitialTab] = useState("");
  const [executionContext, setExecutionContext] = useState({
    activeTab: "",
    progress: 0,
  });
  const recentSaveTimer = useRef(null);

  const sourceRows = poData?.rawIssues?.length ? poData.rawIssues : poData?.rows || [];
  const accountId = String(currentUser?.jiraAccountId || "").trim();

  const personalRows = useMemo(() => {
    if (!accountId) return [];
    return (sourceRows || []).filter((issue) => {
      const issueAccountId = String(getAssigneeAccountId(issue)).trim();
      return issueAccountId && issueAccountId === accountId;
    });
  }, [accountId, sourceRows]);

  useEffect(() => {
    poData?.ensureLoaded?.().catch(() => null);
  }, [poData]);

  useEffect(() => {
    let active = true;
    setWorkspaceLoading(true);
    fetchDeveloperWorkspace()
      .then((data) => {
        if (active) setWorkspace(mergeWorkspace(data));
      })
      .catch((err) => {
        console.error(err);
        if (active) toast.error("Nao foi possivel carregar o workspace.");
      })
      .finally(() => {
        if (active) setWorkspaceLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const selectedTicket = useMemo(
    () => findTicketByKey(personalRows, selectedTicketKey),
    [personalRows, selectedTicketKey],
  );

  const updateWorkspaceFromSave = useCallback((nextWorkspace) => {
    if (!nextWorkspace) return;
    setWorkspace(mergeWorkspace(nextWorkspace));
  }, []);

  const registerRecent = useCallback(
    async (ticketKey, patch = {}) => {
      const key = normalizeTicketKey(ticketKey);
      if (!key) return;
      const issue = findTicketByKey(personalRows, key);
      const nextWorkspace = await registerDeveloperRecentTicket(key, {
        summary: patch.summary ?? getSummary(issue),
        status: patch.status ?? getStatus(issue),
        priority: patch.priority ?? getPriority(issue),
        activeTab: patch.activeTab ?? executionContext.activeTab,
        progress: patch.progress ?? executionContext.progress,
      });
      updateWorkspaceFromSave(nextWorkspace);
    },
    [
      executionContext.activeTab,
      executionContext.progress,
      personalRows,
      updateWorkspaceFromSave,
    ],
  );

  function openExecution(ticketKey, opts = {}) {
    const key = normalizeTicketKey(ticketKey);
    if (!key) return;
    const recent = workspace.recentTickets.find(
      (item) => normalizeTicketKey(item.ticketKey) === key,
    );
    setSelectedTicketKey(key);
    setSelectedInitialTab(opts.activeTab ?? recent?.activeTab ?? "");
    setExecutionContext({
      activeTab: opts.activeTab ?? recent?.activeTab ?? "",
      progress: Number(recent?.progress || 0),
    });
    setMode("execution");
    registerRecent(key, {
      activeTab: opts.activeTab ?? recent?.activeTab ?? "",
      progress: Number(recent?.progress || 0),
    }).catch(() => null);
  }

  const handleExecutionContextChange = useCallback((next = {}) => {
    setExecutionContext((prev) => ({
      ...prev,
      ...next,
      progress:
        next.progress === undefined
          ? prev.progress
          : Math.max(0, Math.min(100, Number(next.progress || 0))),
    }));
  }, []);

  const handleChecklistProgress = useCallback(
    (progress) => {
      handleExecutionContextChange({ progress });
      onProgressChange?.(progress);
    },
    [handleExecutionContextChange, onProgressChange],
  );

  useEffect(() => {
    if (mode !== "execution" || !selectedTicketKey) return undefined;
    window.clearTimeout(recentSaveTimer.current);
    recentSaveTimer.current = window.setTimeout(() => {
      registerRecent(selectedTicketKey).catch(() => null);
    }, 900);

    return () => window.clearTimeout(recentSaveTimer.current);
  }, [executionContext, mode, registerRecent, selectedTicketKey]);

  function backToWorkspace() {
    if (selectedTicketKey) registerRecent(selectedTicketKey).catch(() => null);
    setMode("workspace");
  }

  if (mode === "execution") {
    return (
      <div className="developer-center developer-center--execution">
        <div className="developer-execution-return">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={backToWorkspace}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Workspace
          </Button>
          <div className="developer-execution-return__copy">
            <strong>{selectedTicketKey || "Ticket"}</strong>
            <span>{selectedTicket ? getSummary(selectedTicket) : "Execucao operacional"}</span>
          </div>
        </div>
        <ChecklistGMUDTab
          key={selectedTicketKey}
          initialTicketJira={selectedTicketKey}
          initialActiveTab={selectedInitialTab}
          autoSyncOnOpen={workspace.preferences.autoSyncOnOpen !== false}
          onBackToWorkspace={backToWorkspace}
          onExecutionContextChange={handleExecutionContextChange}
          onProgressChange={handleChecklistProgress}
          onRdmTitleChange={onRdmTitleChange}
          onRdmDueDateChange={onRdmDueDateChange}
        />
      </div>
    );
  }

  return (
    <DeveloperWorkspace
      currentUser={currentUser}
      rows={personalRows}
      allRows={sourceRows}
      workspace={workspace}
      loading={Boolean(poData?.loading || workspaceLoading)}
      reloadProgress={poData?.reloadProgress}
      error={poData?.err}
      onReload={() => poData?.reload?.()}
      onConfigureUser={onConfigureUser}
      onOpenExecution={openExecution}
      onWorkspaceSaved={updateWorkspaceFromSave}
    />
  );
}

function DeveloperWorkspace({
  currentUser,
  rows,
  allRows,
  workspace,
  loading,
  reloadProgress,
  error,
  onReload,
  onConfigureUser,
  onOpenExecution,
  onWorkspaceSaved,
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState("all");
  const [pendencyFilter, setPendencyFilter] = useState("all");
  const [layouts, setLayouts] = useState(workspace.layout || DEFAULT_LAYOUTS);
  const [notesDraft, setNotesDraft] = useState({});
  const [noteTicketKey, setNoteTicketKey] = useState("");
  const [expandedWidget, setExpandedWidget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [focusedStickyId, setFocusedStickyId] = useState("");
  const layoutsRef = useRef(layouts);
  const breakpointRef = useRef("lg");
  const stickyRefs = useRef({});
  const layoutSaveTimer = useRef(null);

  useEffect(() => {
    const nextLayouts = ensureStickyLayouts(
      workspace.layout || DEFAULT_LAYOUTS,
      workspace.stickyNotes,
    );
    layoutsRef.current = nextLayouts;
    setLayouts(nextLayouts);
  }, [workspace.layout, workspace.stickyNotes]);

  useEffect(() => {
    setNotesDraft((prev) => ({ ...workspace.notesByTicket, ...prev }));
  }, [workspace.notesByTicket]);

  useEffect(() => {
    return () => {
      window.clearTimeout(layoutSaveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!focusedStickyId) return;
    const node = stickyRefs.current[focusedStickyId];
    if (!node) return;
    window.requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.focus?.({ preventScroll: true });
    });
    const timer = window.setTimeout(() => setFocusedStickyId(""), 2600);
    return () => window.clearTimeout(timer);
  }, [focusedStickyId, workspace.stickyNotes]);

  const preferences = workspace.preferences || EMPTY_WORKSPACE.preferences;
  const visibleWidgets = preferences.visibleWidgets?.length
    ? preferences.visibleWidgets
    : DEFAULT_VISIBLE_WIDGETS;
  const visibleWidgetSet = new Set(visibleWidgets);

  const sortedRows = useMemo(() => {
    const list = [...(rows || [])].filter((issue) => !isDone(issue));
    const sortBy = preferences.sortBy || "dueDate";

    return list.sort((a, b) => {
      if (sortBy === "priority") {
        return norm(getPriority(a)).localeCompare(norm(getPriority(b)));
      }
      if (sortBy === "updated") {
        return (
          (getUpdatedDate(b)?.getTime() || 0) -
          (getUpdatedDate(a)?.getTime() || 0)
        );
      }
      if (sortBy === "status") {
        return getStatus(a).localeCompare(getStatus(b));
      }
      const aDue = getDueYmd(a) || "9999-12-31";
      const bDue = getDueYmd(b) || "9999-12-31";
      return aDue.localeCompare(bDue);
    });
  }, [preferences.sortBy, rows]);

  const filteredRows = useMemo(() => {
    const q = norm(search);
    return sortedRows.filter((issue) => {
      const key = getIssueKey(issue);
      const summary = getSummary(issue);
      if (q && !norm(`${key} ${summary}`).includes(q)) return false;

      if (statusFilter !== "all") {
        const wanted = norm(statusFilter);
        if (!norm(getStatus(issue)).includes(wanted)) return false;
      }

      if (priorityFilter !== "all") {
        if (!norm(getPriority(issue)).includes(priorityFilter)) return false;
      }

      const due = getDueYmd(issue);
      const days = diffDaysFromToday(due);
      if (dueFilter === "none" && due) return false;
      if (dueFilter === "overdue" && !(days !== null && days < 0)) return false;
      if (dueFilter === "today" && days !== 0) return false;
      if (dueFilter === "week" && !(days !== null && days >= 0 && days <= 7))
        return false;

      if (pendencyFilter === "noEvidence" && hasEvidence(issue)) return false;
      if (pendencyFilter === "waitingGmud" && !isAwaitingGmud(issue))
        return false;

      return true;
    });
  }, [dueFilter, pendencyFilter, priorityFilter, search, sortedRows, statusFilter]);

  const stats = useMemo(() => {
    const active = sortedRows.length;
    const dueSoon = sortedRows.filter((issue) => {
      const days = diffDaysFromToday(getDueYmd(issue));
      return days !== null && days >= 0 && days <= 2;
    }).length;
    const noEvidence = sortedRows.filter((issue) => !hasEvidence(issue)).length;
    const waitingGmud = sortedRows.filter(isAwaitingGmud).length;

    return { active, dueSoon, noEvidence, waitingGmud };
  }, [sortedRows]);

  const riskRows = useMemo(() => buildRiskRows(sortedRows, 999), [sortedRows]);
  const nextActions = useMemo(
    () => buildNextActions(sortedRows, 999),
    [sortedRows],
  );

  const noteTickets = useMemo(() => {
    const keys = [
      noteTicketKey,
      ...filteredRows.map(getIssueKey),
      ...(workspace.stickyNotes || []).map((note) => note.ticketKey),
      ...Object.keys(workspace.notesByTicket || {}),
    ]
      .map(normalizeTicketKey)
      .filter(Boolean);
    return Array.from(new Set(keys)).slice(0, 12);
  }, [filteredRows, noteTicketKey, workspace.notesByTicket, workspace.stickyNotes]);

  const contextTicketKey = useMemo(
    () =>
      normalizeTicketKey(
        noteTicketKey ||
          workspace.recentTickets?.[0]?.ticketKey ||
          getIssueKey(filteredRows?.[0]),
      ),
    [filteredRows, noteTicketKey, workspace.recentTickets],
  );
  const contextIssue = useMemo(
    () => findTicketByKey(sortedRows, contextTicketKey),
    [contextTicketKey, sortedRows],
  );

  useEffect(() => {
    if (noteTicketKey) return;
    const first = normalizeTicketKey(
      workspace.recentTickets?.[0]?.ticketKey || filteredRows?.[0]?.key,
    );
    if (first) setNoteTicketKey(first);
  }, [filteredRows, noteTicketKey, workspace.recentTickets]);

  async function saveWorkspace(next = {}) {
    setSaving(true);
    try {
      const saved = await saveDeveloperWorkspacePreferences({
        preferences: {
          ...preferences,
          ...(next.preferences || {}),
        },
        layout: next.layout || layouts,
      });
      onWorkspaceSaved?.(saved);
      toast.success("Workspace salvo.");
    } catch (err) {
      toast.error("Nao foi possivel salvar o workspace.", {
        description: err?.message || String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  async function persistLayouts(nextLayouts, options = {}) {
    layoutsRef.current = nextLayouts;
    setLayouts(nextLayouts);

    window.clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = window.setTimeout(async () => {
      try {
        const saved = await saveDeveloperWorkspacePreferences({
          preferences,
          layout: nextLayouts,
        });
        onWorkspaceSaved?.(saved);
      } catch (err) {
        if (options.toastOnError !== false) {
          toast.error("Nao foi possivel salvar a posicao do workspace.", {
            description: err?.message || String(err),
          });
        }
      }
    }, options.delay ?? 350);
  }

  function handleLayoutChange(_layout, allLayouts) {
    layoutsRef.current = allLayouts;
    setLayouts(allLayouts);
  }

  function handleBreakpointChange(nextBreakpoint) {
    breakpointRef.current = nextBreakpoint || "lg";
  }

  function saveBreakpointLayout(layout) {
    const breakpoint = breakpointRef.current || "lg";
    const nextLayouts = {
      ...layoutsRef.current,
      [breakpoint]: Array.isArray(layout) ? layout : layoutsRef.current?.[breakpoint] || [],
    };
    const normalized = ensureStickyLayouts(nextLayouts, workspace.stickyNotes);
    persistLayouts(normalized, { toastOnError: false, delay: 120 });
  }

  function getNoteTitle(ticketKey) {
    const issue = findTicketByKey([...(sortedRows || []), ...(allRows || [])], ticketKey);
    if (issue) return getSummary(issue);
    const recent = (workspace.recentTickets || []).find(
      (item) => normalizeTicketKey(item.ticketKey) === ticketKey,
    );
    return recent?.summary || ticketKey;
  }

  async function toggleWidget(widgetId, checked) {
    const nextVisible = checked
      ? Array.from(new Set([...visibleWidgets, widgetId]))
      : visibleWidgets.filter((id) => id !== widgetId);
    await saveWorkspace({
      preferences: { visibleWidgets: nextVisible },
    });
  }

  async function saveNote() {
    const key = normalizeTicketKey(noteTicketKey);
    if (!key) return;
    const rawNote = notesDraft[key];
    const text =
      rawNote && typeof rawNote === "object" ? rawNote.text || "" : rawNote || "";
    if (!String(text || "").trim()) {
      toast.warning("Escreva uma nota antes de criar o post-it.");
      return;
    }
    setSaving(true);
    try {
      const title = getNoteTitle(key);
      const saved = await createDeveloperStickyNote({
        ticketKey: key,
        title,
        text,
        color: "yellow",
      });
      const nextWorkspace = mergeWorkspace(saved);
      const created = nextWorkspace.stickyNotes?.[0];
      const nextLayouts = ensureStickyLayouts(layoutsRef.current, nextWorkspace.stickyNotes);

      setNotesDraft((prev) => ({
        ...prev,
        [key]: "",
      }));
      onWorkspaceSaved?.({
        ...nextWorkspace,
        layout: nextLayouts,
      });
      await persistLayouts(nextLayouts, { toastOnError: false, delay: 0 });
      if (created?.id) setFocusedStickyId(created.id);
      toast.success("Post-it criado no workspace.");
    } catch (err) {
      toast.error("Nao foi possivel criar o post-it.", {
        description: err?.message || String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteStickyNote(noteId) {
    const id = String(noteId || "").trim();
    if (!id) return;
    setSaving(true);
    try {
      const saved = await deleteDeveloperStickyNote(id);
      const nextWorkspace = mergeWorkspace(saved);
      const nextLayouts = ensureStickyLayouts(layoutsRef.current, nextWorkspace.stickyNotes);
      onWorkspaceSaved?.({
        ...nextWorkspace,
        layout: nextLayouts,
      });
      await persistLayouts(nextLayouts, { toastOnError: false, delay: 0 });
      toast.success("Post-it removido.");
    } catch (err) {
      toast.error("Nao foi possivel remover o post-it.", {
        description: err?.message || String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  function openExpandedWidget(widgetId) {
    const hasNotes = Object.values(workspace.notesByTicket || {}).some((value) => {
      const text = typeof value === "string" ? value : value?.text || "";
      return String(text || "").trim();
    });
    const emptyChecks = {
      queue: filteredRows.length === 0,
      recent: !workspace.recentTickets?.length,
      risk: riskRows.length === 0,
      actions: nextActions.length === 0,
      notes: !hasNotes,
    };

    if (emptyChecks[widgetId]) {
      toast.info("Nao ha itens para exibir neste momento.");
      return;
    }

    setExpandedWidget(widgetId);
  }

  async function handleQuickAction(action) {
    const key = contextTicketKey;
    if (!key) {
      toast.warning("Selecione ou acesse um ticket para usar este atalho.");
      return;
    }

    if (action === "jira") {
      const url = getJiraBrowseUrl(key, contextIssue);
      if (!url) {
        toast.error("Nao foi possivel montar a URL do Jira.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    if (action === "comment") {
      onOpenExecution(key, { activeTab: "comentarios" });
      return;
    }

    if (action === "evidence") {
      onOpenExecution(key, { activeTab: "evidencias" });
      return;
    }

    if (action === "daily") {
      try {
        const text = buildDailyStatus(sortedRows, riskRows);
        const copied = await copyTextToClipboard(text);
        if (!copied) throw new Error("Clipboard indisponivel.");
        toast.success("Status daily copiado.");
      } catch (err) {
        toast.error("Nao foi possivel copiar o status daily.", {
          description: err?.message || String(err),
        });
      }
    }
  }

  if (!currentUser?.jiraAccountId) {
    return (
      <section className="developer-center developer-workspace">
        <Card className="developer-empty-config">
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Configure seu usuario Jira</CardTitle>
              <CardDescription className="mt-1">
                O Workspace usa seu accountId Jira para montar a fila pessoal da
                Central do Desenvolvedor.
              </CardDescription>
            </div>
            <Button className="rounded-xl bg-red-600 text-white hover:bg-red-700" onClick={onConfigureUser}>
              <Settings2 className="mr-2 h-4 w-4" />
              Abrir Configuracoes
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  const reloadText =
    loading && reloadProgress?.total
      ? `${reloadProgress.loaded || 0}/${reloadProgress.total}`
      : loading
        ? "Atualizando"
        : "Atualizar Jira";

  return (
    <section
      className={cn(
        "developer-center developer-workspace",
        preferences.density === "compact" && "developer-workspace--compact",
      )}
    >
      <div className="developer-workspace__top">
        <div className="developer-workspace__headline">
          <div className="developer-workspace__breadcrumb">
            <span>Central do Desenvolvedor</span>
            <span>/</span>
            <strong>Workspace</strong>
          </div>
          <h2>Bom dia, {currentUser?.name?.split(" ")?.[0] || "Rafael"}</h2>
          <p>
            Aqui esta o que esta acontecendo no seu workspace hoje.
          </p>
        </div>

        <div className="developer-workspace__actions">
          <div className="developer-command-search">
            <Search className="h-5 w-5" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar ticket..."
            />
            <kbd>K</kbd>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="developer-action-button developer-action-button--red">
                <Plus className="mr-2 h-4 w-4" />
                Adicionar widget
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Adicionar ou remover widgets</DropdownMenuLabel>
              {WIDGETS.map((widget) => (
                <DropdownMenuCheckboxItem
                  key={widget.id}
                  checked={visibleWidgetSet.has(widget.id)}
                  onCheckedChange={(checked) => toggleWidget(widget.id, checked)}
                >
                  {widget.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="developer-action-button">
                <Grid2X2 className="mr-2 h-4 w-4" />
                Customizar layout
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Widgets visiveis</DropdownMenuLabel>
              {WIDGETS.map((widget) => (
                <DropdownMenuCheckboxItem
                  key={widget.id}
                  checked={visibleWidgetSet.has(widget.id)}
                  onCheckedChange={(checked) => toggleWidget(widget.id, checked)}
                >
                  {widget.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Densidade</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={preferences.density === "comfortable"}
                onCheckedChange={() =>
                  saveWorkspace({ preferences: { density: "comfortable" } })
                }
              >
                Confortavel
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={preferences.density === "compact"}
                onCheckedChange={() =>
                  saveWorkspace({ preferences: { density: "compact" } })
                }
              >
                Compacto
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Ordenacao padrao</DropdownMenuLabel>
              {[
                ["dueDate", "Data limite"],
                ["priority", "Prioridade"],
                ["updated", "Ultima atualizacao"],
                ["status", "Status"],
              ].map(([value, label]) => (
                <DropdownMenuCheckboxItem
                  key={value}
                  checked={preferences.sortBy === value}
                  onCheckedChange={() =>
                    saveWorkspace({ preferences: { sortBy: value } })
                  }
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            variant="outline"
            className="developer-action-button"
            onClick={() => saveWorkspace({ layout: layouts })}
            disabled={saving}
          >
            <Bookmark className="mr-2 h-4 w-4" />
            Salvar workspace
          </Button>

          <Button
            type="button"
            className="developer-action-button developer-action-button--solid"
            onClick={onReload}
            disabled={loading}
          >
            <RefreshCcw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            {reloadText}
          </Button>
        </div>
      </div>

      <div className="developer-stats">
        <MetricCard
          icon={CalendarDays}
          label="tickets ativos"
          value={stats.active}
          helper="+2 desde ontem"
          tone="danger"
        />
        <MetricCard
          icon={Clock}
          label="vencendo"
          value={stats.dueSoon}
          helper="Vencem hoje ou amanha"
          tone="warning"
        />
        <MetricCard
          icon={TriangleAlert}
          label="sem evidencia"
          value={stats.noEvidence}
          helper="Aguardando envio"
          tone="alert"
        />
        <MetricCard
          icon={FileText}
          label="aguardando GMUD"
          value={stats.waitingGmud}
          helper="Pendencia identificada"
          tone="info"
        />
      </div>

      <div className="developer-filter-strip">
        <FilterSelect
          icon={Filter}
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_FILTERS}
        />
        <FilterSelect
          value={priorityFilter}
          onChange={setPriorityFilter}
          options={PRIORITY_FILTERS}
        />
        <FilterSelect value={dueFilter} onChange={setDueFilter} options={DUE_FILTERS} />
        <FilterSelect
          value={pendencyFilter}
          onChange={setPendencyFilter}
          options={[
            { value: "all", label: "Todas pendencias" },
            { value: "noEvidence", label: "Sem evidencia" },
            { value: "waitingGmud", label: "Aguardando GMUD" },
          ]}
        />
      </div>

      {error ? <div className="developer-error">{error}</div> : null}

      <div ref={containerRef} className="developer-grid">
        {mounted ? (
          <Responsive
            layouts={layouts}
            breakpoints={{ lg: 1100, md: 768, sm: 0 }}
            cols={{ lg: 12, md: 10, sm: 6 }}
            rowHeight={48}
            margin={[16, 16]}
            width={width}
            draggableHandle=".developer-widget__drag, .developer-sticky-note__drag"
            onLayoutChange={handleLayoutChange}
            onBreakpointChange={handleBreakpointChange}
            onDragStop={saveBreakpointLayout}
            onResizeStop={saveBreakpointLayout}
          >
            {visibleWidgetSet.has("queue") ? (
              <div key="queue">
                <WidgetCard title="Minha fila" icon={ListChecks}>
                  <QueueWidget
                    rows={filteredRows}
                    loading={loading}
                    onOpenExecution={onOpenExecution}
                    onShowAll={() => openExpandedWidget("queue")}
                  />
                </WidgetCard>
              </div>
            ) : null}

            {visibleWidgetSet.has("risk") ? (
              <div key="risk">
                <WidgetCard title="Tickets em risco" icon={TriangleAlert}>
                  <RiskWidget
                    rows={sortedRows}
                    onOpenExecution={onOpenExecution}
                    onShowAll={() => openExpandedWidget("risk")}
                  />
                </WidgetCard>
              </div>
            ) : null}

            {visibleWidgetSet.has("nextActions") ? (
              <div key="nextActions">
                <WidgetCard title="Proximas acoes" icon={Sparkles}>
                  <NextActionsWidget
                    rows={sortedRows}
                    onOpenExecution={onOpenExecution}
                    onShowAll={() => openExpandedWidget("actions")}
                  />
                </WidgetCard>
              </div>
            ) : null}

            {visibleWidgetSet.has("calendar") ? (
              <div key="calendar">
                <WidgetCard title="Calendario da semana" icon={CalendarDays}>
                  <CalendarWidget
                    rows={sortedRows}
                    onOpenExecution={onOpenExecution}
                    onShowAll={() => openExpandedWidget("calendar")}
                  />
                </WidgetCard>
              </div>
            ) : null}

            {visibleWidgetSet.has("recent") ? (
              <div key="recent">
                <WidgetCard title="Continuar de onde parei" icon={TimerReset}>
                  <RecentWidget
                    recentTickets={workspace.recentTickets}
                    onOpenExecution={onOpenExecution}
                    onShowAll={() => openExpandedWidget("recent")}
                  />
                </WidgetCard>
              </div>
            ) : null}

            {visibleWidgetSet.has("notes") ? (
              <div key="notes">
                <WidgetCard title="Notas pessoais" icon={NotebookPen}>
                  <NotesWidget
                    noteTickets={noteTickets}
                    noteTicketKey={noteTicketKey}
                    setNoteTicketKey={setNoteTicketKey}
                    notesDraft={notesDraft}
                    setNotesDraft={setNotesDraft}
                    onSave={saveNote}
                    onShowAll={() => openExpandedWidget("notes")}
                    saving={saving}
                  />
                </WidgetCard>
              </div>
            ) : null}

            {visibleWidgetSet.has("productivity") ? (
              <div key="productivity">
                <WidgetCard title="Atalhos rapidos" icon={Grid2X2}>
                  <QuickActionsWidget onAction={handleQuickAction} />
                </WidgetCard>
              </div>
            ) : null}

            {(workspace.stickyNotes || []).map((note) => (
              <div key={stickyGridKey(note.id)} className="developer-sticky-grid-item">
                <StickyNoteCard
                  note={note}
                  focused={focusedStickyId === note.id}
                  saving={saving}
                  onDelete={() => deleteStickyNote(note.id)}
                  ref={(node) => {
                    if (node) stickyRefs.current[note.id] = node;
                    else delete stickyRefs.current[note.id];
                  }}
                />
              </div>
            ))}
          </Responsive>
        ) : null}
      </div>

      <div className="developer-workspace__hint">
        <span>i</span>
        Dica: arraste os widgets pelos indicadores e redimensione pelos cantos.
      </div>

      <ExpandedWorkspaceDialog
        open={Boolean(expandedWidget)}
        widget={expandedWidget}
        rows={filteredRows}
        riskRows={riskRows}
        actions={nextActions}
        recentTickets={workspace.recentTickets}
        notesByTicket={workspace.notesByTicket}
        onOpenChange={(open) => {
          if (!open) setExpandedWidget(null);
        }}
        onOpenExecution={onOpenExecution}
      />
    </section>
  );
}

function MetricCard({ icon: Icon, label, value, helper, tone = "neutral" }) {
  return (
    <Card className={cn("developer-metric", `developer-metric--${tone}`)}>
      <CardContent className="p-4">
        <div className="developer-metric__icon">
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <strong>{value}</strong>
          <span>{label}</span>
          {helper ? <small>{helper}</small> : null}
        </div>
        <MoreVertical className="developer-metric__menu h-4 w-4" />
      </CardContent>
    </Card>
  );
}

function FilterSelect({ icon: Icon, value, onChange, options }) {
  return (
    <label className="developer-select">
      {Icon ? <Icon className="h-4 w-4" /> : null}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function WidgetCard({ title, icon: Icon, children }) {
  return (
    <Card className="developer-widget">
      <CardHeader className="developer-widget__header">
        <div className="developer-widget__header-main">
          <button
            type="button"
            className="developer-widget__drag"
            aria-label="Mover widget"
            title="Mover widget"
          >
            <Grip className="h-4 w-4" />
          </button>
          <CardTitle className="developer-widget__title">
            <Icon className="h-4 w-4" />
            {title}
          </CardTitle>
        </div>
        <button
          type="button"
          className="developer-widget__menu"
          aria-label="Opcoes do widget"
          title="Opcoes do widget"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent className="developer-widget__content">{children}</CardContent>
    </Card>
  );
}

function QueueWidget({ rows, loading, onOpenExecution, onShowAll }) {
  if (loading && !rows.length) return <EmptyWidgetText text="Carregando fila..." />;
  if (!rows.length) return <EmptyWidgetText text="Nenhum ticket encontrado." />;

  return (
    <div className="developer-queue-table">
      {rows.slice(0, 4).map((issue) => (
        <TicketRow
          key={getIssueKey(issue)}
          issue={issue}
          onOpenExecution={onOpenExecution}
        />
      ))}
      <button type="button" className="developer-widget-link" onClick={onShowAll}>
        Ver todos os tickets
      </button>
    </div>
  );
}

function TicketRow({ issue, onOpenExecution, compact = false }) {
  const key = getIssueKey(issue);
  const progress = getProgress(issue);
  const circumference = 2 * Math.PI * 17;
  const offset = circumference - (circumference * progress) / 100;

  return (
    <article className={cn("developer-ticket-row", compact && "is-compact")}>
      <div className="developer-ticket-row__main">
        <button
          type="button"
          className="developer-ticket-row__key"
          onClick={() => onOpenExecution(key)}
          title={`Abrir execucao de ${key}`}
        >
          {key}
        </button>
        <p>{getSummary(issue)}</p>
      </div>
      <div className="developer-ticket-row__badges">
        <Badge className={cn("developer-status-pill", `developer-status-pill--${dueTone(issue)}`)}>
          {getStatus(issue) || "Sem status"}
        </Badge>
      </div>
      <span className={cn("developer-due", `developer-due--${dueTone(issue)}`)}>
        {fmtDateBr(getDueYmd(issue))}
        <small>{dueLabel(issue)}</small>
      </span>
      <div className="developer-ticket-row__footer">
        <div
          className={cn("developer-progress-ring", `developer-progress-ring--${dueTone(issue)}`)}
          title={`Progresso ${progress}%`}
          aria-label={`Progresso ${progress}%`}
        >
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle className="developer-progress-ring__track" cx="20" cy="20" r="17" />
            <circle
              className="developer-progress-ring__fill"
              cx="20"
              cy="20"
              r="17"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <span>{progress}%</span>
        </div>
      </div>
    </article>
  );
}

function ExpandedTicketRow({ issue, onOpenExecution }) {
  const key = getIssueKey(issue);
  const progress = getProgress(issue);

  return (
    <article className="developer-expanded-ticket-row">
      <div className="developer-expanded-ticket-row__main">
        <strong>{key}</strong>
        <p>{getSummary(issue)}</p>
      </div>

      <div className="developer-expanded-ticket-row__badges">
        <Badge className={cn("developer-status-pill", `developer-status-pill--${dueTone(issue)}`)}>
          {getStatus(issue) || "Sem status"}
        </Badge>
        <Badge className={cn("developer-badge", `developer-badge--${priorityTone(getPriority(issue))}`)}>
          {getPriority(issue)}
        </Badge>
      </div>

      <span className={cn("developer-due", `developer-due--${dueTone(issue)}`)}>
        {fmtDateBr(getDueYmd(issue))}
        <small>{dueLabel(issue)}</small>
      </span>

      <div className="developer-progress-cell">
        <span>{progress}%</span>
        <div className="developer-progress-track">
          <div
            className={cn("developer-progress-fill", `developer-progress-fill--${dueTone(issue)}`)}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="developer-open-button"
        onClick={() => onOpenExecution(key)}
      >
        Abrir execucao
      </Button>
    </article>
  );
}

function RiskWidget({ rows, onOpenExecution, onShowAll }) {
  const riskRows = buildRiskRows(rows, 6);

  if (!riskRows.length) return <EmptyWidgetText text="Nenhum risco imediato." />;

  return (
    <div className="developer-list">
      {riskRows.map((issue) => (
        <button
          type="button"
          key={getIssueKey(issue)}
          className={cn("developer-risk-item", `developer-risk-item--${dueTone(issue)}`)}
          onClick={() => onOpenExecution(getIssueKey(issue))}
        >
          <TriangleAlert className="h-4 w-4" />
          <span>
            <strong>{getIssueKey(issue)}</strong>
            <small>{dueLabel(issue)}</small>
          </span>
          <Badge className={cn("developer-badge", `developer-badge--${priorityTone(getPriority(issue))}`)}>
            {priorityTone(getPriority(issue)) === "danger" ? "Critico" : getPriority(issue)}
          </Badge>
        </button>
      ))}
      <button type="button" className="developer-widget-link" onClick={onShowAll}>
        Ver todos em risco
      </button>
    </div>
  );
}

function NextActionsWidget({ rows, onOpenExecution, onShowAll }) {
  const actions = buildNextActions(rows, 6);

  if (!actions.length) return <EmptyWidgetText text="Sem proximas acoes." />;

  return (
    <div className="developer-checklist-actions">
      {actions.map((action) => (
        <button
          type="button"
          key={`${action.key}:${action.label}`}
          className="developer-action-item"
          onClick={() => onOpenExecution(action.key)}
        >
          <span className="developer-checkbox" />
          <span>{action.label}</span>
        </button>
      ))}
      <button type="button" className="developer-widget-link" onClick={onShowAll}>
        Ver todas as acoes
      </button>
    </div>
  );
}

function CalendarWidget({ rows, onOpenExecution, onShowAll }) {
  const groups = [0, 1, 2, 3, 4].map((offset) => {
    const date = todayLocal();
    date.setDate(date.getDate() + offset);
    const ymd = extractYmd(date);
    return {
      offset,
      label: getWeekdayLabel(offset),
      rows: rows.filter((issue) => getDueYmd(issue) === ymd).slice(0, 4),
    };
  });

  return (
    <div className="developer-calendar-board">
      <div className="developer-calendar-board__top">
        <span>19 - 25 de maio de 2025</span>
        <button type="button">Hoje</button>
      </div>
      <div className="developer-calendar-grid">
        <div className="developer-calendar-hours">
          {["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"].map((hour) => (
            <span key={hour}>{hour}</span>
          ))}
        </div>
        {groups.map((group) => (
          <div key={group.offset} className="developer-calendar-day">
            <strong>{group.label}</strong>
            <div className="developer-calendar-day__slots">
              {group.rows.length ? (
                group.rows.map((issue, index) => (
                  <button
                    type="button"
                    key={getIssueKey(issue)}
                    className={cn("developer-calendar-event", `tone-${index % 4}`)}
                    onClick={() => onOpenExecution(getIssueKey(issue))}
                  >
                    <span>
                      {norm(getStatus(issue)).includes("homolog")
                        ? "HML"
                        : norm(getStatus(issue)).includes("deploy")
                          ? "Deploy"
                          : "Dev"}
                    </span>
                    {getIssueKey(issue)}
                  </button>
                ))
              ) : (
                <span className="developer-calendar-empty" />
              )}
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="developer-widget-link" onClick={onShowAll}>
        Ver calendario completo
      </button>
    </div>
  );
}

function RecentWidget({ recentTickets, onOpenExecution, onShowAll }) {
  const items = (recentTickets || []).slice(0, 6);
  if (!items.length) {
    return <EmptyWidgetText text="Abra um ticket para criar seu historico." />;
  }

  return (
    <div className="developer-list">
      {items.map((item) => (
        <button
          type="button"
          key={item.ticketKey}
          className="developer-recent-item"
          onClick={() => onOpenExecution(item.ticketKey, { activeTab: item.activeTab })}
        >
          <span>
            <strong>{item.ticketKey}</strong>
            <small>{item.summary || "Sem resumo"}</small>
          </span>
          <em>{relativeAccessLabel(item.accessedAt)}</em>
        </button>
      ))}
      <button type="button" className="developer-widget-link" onClick={onShowAll}>
        Ver todos os acessados
      </button>
    </div>
  );
}

function NotesWidget({
  noteTickets,
  noteTicketKey,
  setNoteTicketKey,
  notesDraft,
  setNotesDraft,
  onSave,
  onShowAll,
  saving,
}) {
  const key = normalizeTicketKey(noteTicketKey || noteTickets[0]);
  const text = notesDraft?.[key]?.text ?? notesDraft?.[key] ?? "";

  return (
    <div className="developer-notes">
      <select value={key} onChange={(event) => setNoteTicketKey(event.target.value)}>
        {noteTickets.length ? (
          noteTickets.map((ticketKey) => (
            <option key={ticketKey} value={ticketKey}>
              {ticketKey}
            </option>
          ))
        ) : (
          <option value="">Sem ticket</option>
        )}
      </select>
      <Textarea
        value={text}
        onChange={(event) =>
          setNotesDraft((prev) => ({
            ...prev,
            [key]: event.target.value,
          }))
        }
        placeholder="Minhas notas privadas..."
      />
      <Button
        type="button"
        className="rounded-xl bg-red-600 text-white hover:bg-red-700"
        onClick={onSave}
        disabled={!key || saving}
      >
        <Save className="mr-2 h-4 w-4" />
        Criar post-it
      </Button>
      <button type="button" className="developer-widget-link" onClick={onShowAll}>
        Ver todas as notas
      </button>
    </div>
  );
}

const StickyNoteCard = forwardRef(function StickyNoteCard(
  { note, focused, saving, onDelete },
  ref,
) {
  const text = String(note?.text || "").trim();
  const updated = fmtDateTimeShort(note?.updatedAt || note?.createdAt);

  return (
    <article
      ref={ref}
      tabIndex={-1}
      className={cn(
        "developer-sticky-note",
        focused && "developer-sticky-note--focused",
      )}
    >
      <div className="developer-sticky-note__drag" title="Mover post-it">
        <Grip className="h-4 w-4" />
      </div>
      <button
        type="button"
        className="developer-sticky-note__delete"
        onClick={onDelete}
        disabled={saving}
        title="Excluir post-it"
        aria-label={`Excluir post-it ${note?.ticketKey || ""}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <div className="developer-sticky-note__pin" aria-hidden="true" />
      <div className="developer-sticky-note__ticket">
        {normalizeTicketKey(note?.ticketKey)}
      </div>
      <h3>{note?.title || note?.ticketKey || "Nota pessoal"}</h3>
      <p>{text}</p>
      <footer>
        <span>Nota privada</span>
        {updated ? <time dateTime={note?.updatedAt || note?.createdAt}>{updated}</time> : null}
      </footer>
    </article>
  );
});

function QuickActionsWidget({ onAction }) {
  return (
    <div className="developer-quick-actions">
      <QuickAction icon={Grid2X2} label="Abrir Jira" tone="blue" onClick={() => onAction("jira")} />
      <QuickAction icon={MessageSquare} label="Criar comentario" tone="red" onClick={() => onAction("comment")} />
      <QuickAction icon={CloudUpload} label="Subir evidencia" tone="blue" onClick={() => onAction("evidence")} />
      <QuickAction icon={Copy} label="Copiar status daily" tone="red" onClick={() => onAction("daily")} />
    </div>
  );
}

function QuickAction({ icon: Icon, label, tone, onClick }) {
  return (
    <button type="button" className={cn("developer-quick-action", `developer-quick-action--${tone}`)} onClick={onClick}>
      <Icon className="h-6 w-6" />
      <span>{label}</span>
    </button>
  );
}

function ExpandedWorkspaceDialog({
  open,
  widget,
  rows,
  riskRows,
  actions,
  recentTickets,
  notesByTicket,
  onOpenChange,
  onOpenExecution,
}) {
  const titles = {
    queue: ["Todos os tickets", "Fila filtrada do Workspace."],
    recent: ["Ultimos acessados", "Historico recente de execucao."],
    risk: ["Tickets em risco", "Itens com vencimento, evidencia ou GMUD pendente."],
    actions: ["Todas as acoes", "Proximos passos sugeridos para sua fila."],
    calendar: ["Calendario completo", "Tickets organizados por data limite."],
    notes: ["Todas as notas", "Notas privadas salvas no Dev Flow."],
  };
  const [title, description] = titles[widget] || ["Workspace", ""];
  const notesEntries = Object.entries(notesByTicket || {}).filter(([, value]) => {
    const text = typeof value === "string" ? value : value?.text || "";
    return String(text || "").trim();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="developer-expanded-dialog max-w-[min(1180px,calc(100vw-32px))] w-[min(1180px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {widget === "queue" ? (
          <div className="developer-expanded-ticket-list">
            {rows.map((issue) => (
              <ExpandedTicketRow
                key={getIssueKey(issue)}
                issue={issue}
                onOpenExecution={onOpenExecution}
              />
            ))}
          </div>
        ) : null}

        {widget === "risk" ? (
          <div className="developer-list developer-list--expanded">
            {riskRows.map((issue) => (
              <button
                type="button"
                key={getIssueKey(issue)}
                className={cn("developer-risk-item", `developer-risk-item--${dueTone(issue)}`)}
                onClick={() => onOpenExecution(getIssueKey(issue))}
              >
                <TriangleAlert className="h-4 w-4" />
                <span>
                  <strong>{getIssueKey(issue)}</strong>
                  <small>{getSummary(issue)} - {dueLabel(issue)}</small>
                </span>
                <Badge className={cn("developer-badge", `developer-badge--${priorityTone(getPriority(issue))}`)}>
                  {getPriority(issue)}
                </Badge>
              </button>
            ))}
          </div>
        ) : null}

        {widget === "actions" ? (
          <div className="developer-list developer-list--expanded">
            {actions.map((action) => (
              <button
                type="button"
                key={`${action.key}:${action.label}`}
                className="developer-action-item"
                onClick={() => onOpenExecution(action.key)}
              >
                <span className="developer-checkbox" />
                <span>{action.label} - {action.key}</span>
              </button>
            ))}
          </div>
        ) : null}

        {widget === "calendar" ? (
          <div className="developer-expanded-calendar">
            {rows.map((issue) => (
              <button
                type="button"
                key={getIssueKey(issue)}
                onClick={() => onOpenExecution(getIssueKey(issue))}
              >
                <strong>{fmtDateBr(getDueYmd(issue))}</strong>
                <span>{getIssueKey(issue)} - {getSummary(issue)}</span>
                <em>{getStatus(issue) || "Sem status"}</em>
              </button>
            ))}
          </div>
        ) : null}

        {widget === "recent" ? (
          <div className="developer-list developer-list--expanded">
            {(recentTickets || []).map((item) => (
              <button
                type="button"
                key={item.ticketKey}
                className="developer-recent-item"
                onClick={() => onOpenExecution(item.ticketKey, { activeTab: item.activeTab })}
              >
                <span>
                  <strong>{item.ticketKey}</strong>
                  <small>{item.summary || "Sem resumo"}</small>
                </span>
                <em>{relativeAccessLabel(item.accessedAt)}</em>
              </button>
            ))}
          </div>
        ) : null}

        {widget === "notes" ? (
          <div className="developer-expanded-notes">
            {notesEntries.map(([ticketKey, value]) => {
              const text = typeof value === "string" ? value : value?.text || "";
              return (
                <article key={ticketKey}>
                  <strong>{ticketKey}</strong>
                  <p>{text}</p>
                </article>
              );
            })}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EmptyWidgetText({ text }) {
  return <div className="developer-empty-widget">{text}</div>;
}
