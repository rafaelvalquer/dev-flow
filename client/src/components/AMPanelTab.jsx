// src/components/AMPanelTab.jsx
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AnimatePresence, motion } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Tree } from "react-arborist";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Filter,
  FolderOpen,
  FolderPlus,
  History,
  ListChecks,
  Loader2,
  Plus,
  Play,
  RefreshCcw,
  Search,
  Trash2,
  UserX,
  LayoutDashboard,
} from "lucide-react";

import AMCalendarTab from "./AMCalendarTab";
import AMDashboardTab from "./AMDashboardTab";
import CreateJiraIssueDialog from "./CreateJiraIssueDialog";
import { POActionsHub, POPortfolioHub, POPresetBar } from "./POManagementViews";

import { DateValuePicker } from "@/components/ui/date-range-picker";
import {
  jiraEditIssue,
  jiraSearchAssignableUsers,
  jiraSearchUsers,
  jiraTransitionToStatus,
  jiraUpdateIssuePriority,
  jiraSearchJqlAll,
  jiraSearchDoneLastNDays,
} from "../lib/jiraClient";
import {
  ATIVIDADES_PADRAO,
  buildCronogramaADF,
  parseCronogramaADF,
  toCalendarEvents,
} from "../utils/cronograma";
import {
  addBusinessDays,
  businessDurationDays,
  containsNonWorkingDays,
  nextWorkingDay,
  normalizeCalendarSettings,
  toLocalDate,
} from "../utils/businessCalendar";
import {
  buildPoInsights,
  filterPoViewData,
  getScopedIssueKeysFromPreset,
} from "../lib/poInsights";

import {
  applyEventChangeToAtividades,
  buildPoView,
  fetchPoIssueDetail,
  fetchPoIssuesDetailedProgressive,
  makeDefaultCronogramaDraft,
  saveCronogramaToJira,
  fetchPoActiveRows,
  fetchPoDoneLast30Days,
} from "../lib/jiraPoView";

// NOVO: buscar detalhes do ticket + comentar
import {
  createComment,
  getComments,
  getIssue,
  listAttachments,
} from "../lib/jira";
import { adfSafeToText } from "../utils/gmudUtils";
import GanttTab from "./GanttTab";

/* =========================
   // #region HELPERS
========================= */
function cn(...a) {
  return a.filter(Boolean).join(" ");
}
const CLAMP_2 = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  wordBreak: "break-word",
};

const DEFAULT_JIRA_BROWSE_BASE = "https://clarobr-jsw-tecnologia.atlassian.net";
const STANDARD_CRONOGRAMA_IDS = new Set(
  ATIVIDADES_PADRAO.map((atividade) => atividade.id),
);

function createCustomCronogramaActivity() {
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `custom_${nonce}`,
    name: "",
    data: "",
    recurso: "",
    area: "",
    risk: false,
    risco: "",
    isCustom: true,
  };
}

function inferJiraBaseFromSelf(selfUrl) {
  try {
    const u = new URL(selfUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function getJiraBrowseUrl(issueKey, issue) {
  const envBase = String(import.meta?.env?.VITE_JIRA_BROWSE_BASE || "").trim();
  const inferred = inferJiraBaseFromSelf(issue?.self || issue?.url || "");
  const base = (envBase || inferred || DEFAULT_JIRA_BROWSE_BASE).replace(
    /\/$/,
    "",
  );
  return issueKey ? `${base}/browse/${issueKey}` : "";
}

// estilos padrão para botões de navegação (Tickets / Calendário)
function topNavButtonClasses(active) {
  const base =
    "rounded-xl border px-4 py-2 text-sm font-medium transition " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 " +
    "disabled:opacity-60";
  const on =
    "bg-red-600 text-white border-red-600 shadow-sm hover:bg-red-700 hover:border-red-700";
  const off =
    "bg-white text-zinc-900 border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300 hover:shadow-sm";
  return cn(base, active ? on : off);
}

function fmtUpdatedBR(isoOrDate) {
  if (!isoOrDate) return "—";
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function initials(name) {
  const s = String(name || "").trim();
  if (!s) return "SR";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => (p[0] || "").toUpperCase()).join("");
}

const START_FIELDS = [
  "summary",
  "subtasks",
  "status",
  "project",
  "created",
  "description",
  "customfield_10903",
  "duedate",
  "customfield_11519",
  "assignee",
  "creator",
  "components",
  "customfield_11520",
  "customfield_13604",
  "customfield_10015",
  "customfield_11993",
  "priority",
].join(",");

const STATUS_OPTIONS = [
  "Backlog",
  "Refinamento",
  "Artefatos",
  "Planejamento",
  "PRE SAVE",
  "Para testes",
  "Testes",
  "Homologação",
  "Art. Externos",
  "Para Planejar",
  "EM PLANEJAMENTO",
  "Para Dev",
  "Desenvolvimento",
  "Para Homolog.",
  "Homolog. Negócio",
  "Para Deploy",
];
const PERSONAL_QUEUE_OTHER_STATUS = "Outros";
const PERSONAL_QUEUE_COLUMNS = [...STATUS_OPTIONS, PERSONAL_QUEUE_OTHER_STATUS];

const DOCUMENTATION_FOLDER_LABEL = "pasta-criada";
const DOCUMENTATION_SOURCE_FOLDER_ID = "documentation-source";
const DOCUMENTATION_DEFAULT_FOLDERS = [
  "SPEC",
  "Escopo_Tecnico",
  "Audios",
  "Projeto",
  "Mapa_ScripPoint",
];
const LEVANTAMENTO_STATUSES = new Set([
  "Backlog",
  "Refinamento",
  "Artefatos",
  "Para Planejar",
]);
const PRIORITY_OPTIONS = [
  { name: "HIGHEST", color: "#b91c1c" },
  { name: "HIGH", color: "#d97706" },
  { name: "MEDIUM", color: "#3b82f6" },
  { name: "LOW", color: "#22c55e" },
  { name: "LOWEST", color: "#6b7280" },
];

// ADF simples para comentário no Jira
function adfFromPlainText(text) {
  const raw = String(text ?? "");
  const lines = raw.split(/\r?\n/);
  const content = lines.map((line) => {
    const t = String(line ?? "");
    return {
      type: "paragraph",
      content: t ? [{ type: "text", text: t }] : [],
    };
  });
  return {
    type: "doc",
    version: 1,
    content: content.length ? content : [{ type: "paragraph", content: [] }],
  };
}

function truncateText(text, max = 20) {
  const s = String(text || "").trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function fmtDateBr(yyyyMmDd) {
  if (!yyyyMmDd) return "";
  const ymd = String(yyyyMmDd).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return String(yyyyMmDd);
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

function toNamesArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        typeof x === "string" ? x : x?.value || x?.name || x?.label || "",
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

function safeText(v) {
  if (!v) return "";
  const t = String(adfSafeToText(v) || "").trim();
  if (t) return t;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function userName(u) {
  if (!u) return "";
  if (typeof u === "string") return u;
  return u?.displayName || u?.name || u?.emailAddress || "";
}

function getTicketStatusName(t) {
  return t?.statusName || t?.fields?.status?.name || t?.status?.name || "";
}

function normalizePlain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getIssueLabels(issue) {
  const labels = Array.isArray(issue?.labels)
    ? issue.labels
    : Array.isArray(issue?.fields?.labels)
      ? issue.fields.labels
      : [];
  return labels.map((label) => String(label || "").trim()).filter(Boolean);
}

function hasDocumentationFolderLabel(issue) {
  const wanted = normalizePlain(DOCUMENTATION_FOLDER_LABEL);
  return getIssueLabels(issue).some(
    (label) => normalizePlain(label) === wanted,
  );
}

function isLevantamentoStatus(status) {
  return LEVANTAMENTO_STATUSES.has(String(status || "").trim());
}

function isBacklogStatus(status) {
  return normalizePlain(status) === "backlog";
}

function priorityColor(priorityName) {
  const key = String(priorityName || "")
    .trim()
    .toUpperCase();
  return (
    PRIORITY_OPTIONS.find((priority) => priority.name === key)?.color ||
    "#6b7280"
  );
}

function toPriorityOptionName(priorityName) {
  const normalized = normalizePlain(priorityName);
  return (
    PRIORITY_OPTIONS.find(
      (priority) => normalizePlain(priority.name) === normalized,
    )?.name || String(priorityName || "").trim()
  );
}

function sanitizeFileName(value, fallback = "arquivo") {
  const safe = String(value || fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return safe || fallback;
}

function ticketHasIniciadoTag(ticket) {
  if (!ticket) return false;

  // 1) Flags diretas (caso você já tenha isso vindo do buildPoView/fetchPoIssuesDetailed)
  if (
    ticket?.started === true ||
    ticket?.isStarted === true ||
    ticket?.hasStarted === true ||
    ticket?.hasIniciado === true ||
    ticket?.hasIniciadoTag === true
  ) {
    return true;
  }

  // 2) Campos string mais comuns (caso você tenha "preview" de comentário)
  const candidates = [
    ticket?.commentsText,
    ticket?.lastCommentText,
    ticket?.commentText,
    ticket?.startedText,
    ticket?.iniciadoText,
  ];

  for (const s of candidates) {
    if (typeof s === "string" && /\[INICIADO\]/i.test(s)) return true;
  }

  // 3) Jira "fields.comment" (quando vem na busca)
  const commentField = ticket?.fields?.comment || ticket?.comment;

  // Pode vir como string (já convertido)...
  if (typeof commentField === "string") {
    if (/\[INICIADO\]/i.test(commentField)) return true;
  }

  // ...ou como objeto { comments: [...] }
  const jiraComments = commentField?.comments;
  if (Array.isArray(jiraComments)) {
    return jiraComments.some((c) =>
      /\[INICIADO\]/i.test(safeText(c?.body ?? c)),
    );
  }

  // 4) Array direto "ticket.comments" (se você tiver isso no dataset)
  if (Array.isArray(ticket?.comments)) {
    return ticket.comments.some((c) =>
      /\[INICIADO\]/i.test(safeText(c?.body ?? c)),
    );
  }

  return false;
}

function extractYmd(v) {
  if (!v) return "";

  // string (date ou datetime)
  if (typeof v === "string") {
    const ymd = v.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
  }

  // Date nativo
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // objetos (alguns plugins do Jira retornam formatos diferentes)
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
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0); // LOCAL (não UTC)
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function startOfTodayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function diffDays(a, b) {
  // a - b em dias inteiros
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function makeScheduleChangeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDateBRShort(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function addDaysLocal(value, days) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return date;
}

function escapeReportHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeReportIssueKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getReportIssueKey(issue) {
  return normalizeReportIssueKey(issue?.key || issue?.issueKey || issue?.id);
}

function getReportAssignee(issue) {
  return (
    userName(issue?.assignee) ||
    userName(issue?.responsavel) ||
    userName(issue?.owner) ||
    userName(issue?.fields?.assignee) ||
    ""
  ).trim();
}

function isMissingReportAssignee(issue) {
  const assignee = getReportAssignee(issue);
  return (
    !assignee || /sem responsavel|sem responsável|unassigned/i.test(assignee)
  );
}

function getReportDueYmd(issue) {
  return extractYmd(
    issue?.dueDateRaw ||
      issue?.dueDate ||
      issue?.duedate ||
      issue?.fields?.duedate ||
      issue?.fields?.dueDate,
  );
}

function isReportIssueDone(issue) {
  return /conclu|done|resol|fech|cancel/i.test(getTicketStatusName(issue));
}

function isReportIssueOverdue(issue, today = startOfTodayLocal()) {
  if (isReportIssueDone(issue)) return false;
  const due = parseIsoYmdLocal(getReportDueYmd(issue));
  return Boolean(due && diffDays(today, due) > 0);
}

function getEventIssueKey(event) {
  const props = event?.extendedProps || {};
  return normalizeReportIssueKey(
    props.issueKey || event?.issueKey || props.ticket || event?.ticket,
  );
}

function getEventActivityId(event) {
  const props = event?.extendedProps || {};
  return String(props.activityId || props.id || event?.activityId || "").trim();
}

function getEventActivityName(event) {
  const props = event?.extendedProps || {};
  const raw =
    props.activityName ||
    props.atividade ||
    props.name ||
    event?.activityName ||
    event?.title ||
    "Atividade";
  return String(raw)
    .replace(/^[A-Z]+-\d+\s*[-–—]\s*/i, "")
    .trim();
}

function getEventStartYmd(event) {
  return extractYmd(event?.start || event?.startStr || event?.date);
}

function getEventInclusiveEndYmd(event) {
  const startYmd = getEventStartYmd(event);
  const rawEndYmd = extractYmd(event?.end || event?.endStr || event?.start);
  const rawEnd = parseIsoYmdLocal(rawEndYmd);
  const start = parseIsoYmdLocal(startYmd);
  if (!rawEnd) return startYmd;

  // Eventos do calendário chegam com end exclusivo; relatório executivo mostra fim inclusivo.
  const inclusiveEnd = addDaysLocal(rawEnd, -1);
  if (!inclusiveEnd || (start && diffDays(start, inclusiveEnd) > 0)) {
    return startYmd;
  }
  return extractYmd(inclusiveEnd);
}

function inclusiveReportDays(startYmd, endYmd) {
  const start = parseIsoYmdLocal(startYmd);
  const end = parseIsoYmdLocal(endYmd);
  if (!start || !end) return "";
  return String(Math.max(1, diffDays(end, start) + 1));
}

function findReportActivity(issue, activityId, activityName) {
  const activities = Array.isArray(issue?.atividades) ? issue.atividades : [];
  return (
    activities.find((item) => String(item?.id || "") === String(activityId)) ||
    activities.find(
      (item) =>
        String(item?.name || "")
          .trim()
          .toLowerCase() ===
        String(activityName || "")
          .trim()
          .toLowerCase(),
    ) ||
    null
  );
}

function formatReportDate(ymd) {
  return fmtDateBr(ymd) || "—";
}

function formatReportDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function buildReportRowsHtml(rows, columns, emptyText) {
  if (!rows.length) {
    return `<tr><td colspan="${columns.length}" class="empty">${escapeReportHtml(
      emptyText,
    )}</td></tr>`;
  }

  return rows
    .map(
      (row) =>
        `<tr>${columns
          .map(
            (column) => `<td>${escapeReportHtml(row[column.key] || "—")}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
}

function buildExecutiveReportHtml({ viewData, rawIssues, doneRows, filters }) {
  const activeIssues = Array.isArray(rawIssues) ? rawIssues : [];
  const doneIssues = Array.isArray(doneRows) ? doneRows : [];
  const issueMap = new Map();
  [...activeIssues, ...doneIssues].forEach((issue) => {
    const key = getReportIssueKey(issue);
    if (key && !issueMap.has(key)) issueMap.set(key, issue);
  });

  const events = Array.isArray(viewData?.events) ? viewData.events : [];
  const calendarioIssues = Array.isArray(viewData?.calendarioIssues)
    ? viewData.calendarioIssues
    : [];
  calendarioIssues.forEach((issue) => {
    const key = getReportIssueKey(issue);
    if (key && !issueMap.has(key)) issueMap.set(key, issue);
  });

  const scheduledIssueKeys = new Set(
    events.map(getEventIssueKey).filter(Boolean),
  );
  calendarioIssues.forEach((issue) => {
    const key = getReportIssueKey(issue);
    const hasSchedule = (issue?.atividades || []).some((activity) =>
      String(activity?.data || "").trim(),
    );
    if (key && hasSchedule) scheduledIssueKeys.add(key);
  });

  const today = startOfTodayLocal();
  const nextSeven = addDaysLocal(today, 7);
  const nextSevenCount = events.filter((event) => {
    const start = parseIsoYmdLocal(getEventStartYmd(event));
    return start && nextSeven && start >= today && start <= nextSeven;
  }).length;

  const kpis = [
    { label: "Total", value: issueMap.size },
    {
      label: "Atrasados",
      value: activeIssues.filter((issue) => isReportIssueOverdue(issue, today))
        .length,
    },
    {
      label: "Sem cronograma",
      value: activeIssues.filter((issue) => {
        const key = getReportIssueKey(issue);
        return key && !scheduledIssueKeys.has(key);
      }).length,
    },
    {
      label: "Sem responsável",
      value: activeIssues.filter(isMissingReportAssignee).length,
    },
    { label: "Próximos 7 dias", value: nextSevenCount },
  ];

  const calendarRows = events
    .map((event) => {
      const issueKey = getEventIssueKey(event);
      return {
        sortKey: getEventStartYmd(event),
        ticket: issueKey || "—",
        atividade: getEventActivityName(event),
        data: formatReportDate(getEventStartYmd(event)),
        fim: formatReportDate(getEventInclusiveEndYmd(event)),
      };
    })
    .sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));

  const issueByKey = new Map(
    calendarioIssues.map((issue) => [getReportIssueKey(issue), issue]),
  );
  const ganttRows = events
    .map((event) => {
      const issueKey = getEventIssueKey(event);
      const activityName = getEventActivityName(event);
      const activity = findReportActivity(
        issueByKey.get(issueKey),
        getEventActivityId(event),
        activityName,
      );
      const startYmd = getEventStartYmd(event);
      const endYmd = getEventInclusiveEndYmd(event);
      return {
        sortKey: `${issueKey}-${startYmd}-${activityName}`,
        ticket: issueKey || "—",
        atividade: activity?.name || activityName,
        recurso:
          activity?.recurso ||
          event?.extendedProps?.recurso ||
          event?.extendedProps?.resource ||
          "—",
        area:
          activity?.area ||
          event?.extendedProps?.area ||
          event?.extendedProps?.squad ||
          "—",
        dias: inclusiveReportDays(startYmd, endYmd) || "—",
        start: formatReportDate(startYmd),
        end: formatReportDate(endYmd),
      };
    })
    .sort((a, b) =>
      String(a.sortKey).localeCompare(String(b.sortKey), "pt-BR"),
    );

  const maxRows = 80;
  const visibleCalendarRows = calendarRows.slice(0, maxRows);
  const visibleGanttRows = ganttRows.slice(0, maxRows);
  const presetLabels = {
    all: "Todos",
    mine: "Meus projetos",
    overdue: "Atrasados",
    noSchedule: "Sem cronograma",
    risk: "Com risco",
    next7: "Próximos 7 dias",
  };
  const filterParts = [
    `Recorte: ${presetLabels[filters?.activePreset] || filters?.activePreset || "Todos"}`,
    filters?.ownerAccountId
      ? `Responsável Jira: ${filters.ownerFocus || filters.ownerAccountId}`
      : filters?.ownerFocus
        ? `Responsável: ${filters.ownerFocus}`
        : "",
    filters?.calendarFilter ? `Busca: ${filters.calendarFilter}` : "",
    filters?.subView ? `Aba: ${filters.subView}` : "",
  ].filter(Boolean);

  const calendarColumns = [
    { key: "ticket", label: "Ticket" },
    { key: "atividade", label: "Atividade" },
    { key: "data", label: "Data" },
    { key: "fim", label: "Fim" },
  ];
  const ganttColumns = [
    { key: "ticket", label: "Ticket" },
    { key: "atividade", label: "Atividade" },
    { key: "recurso", label: "Recurso" },
    { key: "area", label: "Área" },
    { key: "dias", label: "Dias" },
    { key: "start", label: "Start" },
    { key: "end", label: "End" },
  ];

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Exportação executiva - Painel de Acompanhamento</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f6f7f9; color: #231f20; font-family: Inter, Arial, sans-serif; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px; }
    header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 24px; }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.15; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    p { margin: 0; color: #66535a; }
    .eyebrow { color: #d71920; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .toolbar { display: flex; gap: 10px; align-items: center; }
    button { border: 0; border-radius: 12px; background: #d71920; color: white; cursor: pointer; font-weight: 800; padding: 12px 18px; }
    section { margin: 18px 0; padding: 20px; border: 1px solid #ead7da; border-radius: 18px; background: white; box-shadow: 0 14px 38px rgba(35,31,32,.06); }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .pill { border: 1px solid #ead7da; border-radius: 999px; padding: 7px 10px; color: #66535a; font-size: 12px; font-weight: 700; }
    .kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
    .kpi { border: 1px solid #ead7da; border-radius: 14px; padding: 16px; }
    .kpi strong { display: block; color: #d71920; font-size: 26px; margin-bottom: 4px; }
    .kpi span { color: #66535a; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #eee2e5; padding: 10px 9px; text-align: left; vertical-align: top; }
    th { color: #66535a; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
    .empty { color: #8a7d82; text-align: center; padding: 28px; }
    .note { margin-top: 10px; color: #8a7d82; font-size: 12px; }
    @media (max-width: 900px) { main { padding: 18px; } header { flex-direction: column; } .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media print {
      body { background: white; }
      main { max-width: none; padding: 0; }
      section { box-shadow: none; break-inside: avoid; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="eyebrow">Painel de Acompanhamento (PO)</div>
        <h1>Exportação executiva</h1>
        <p>Relatório gerado em ${escapeReportHtml(formatReportDateTime())}</p>
        <div class="meta">${filterParts
          .map((item) => `<span class="pill">${escapeReportHtml(item)}</span>`)
          .join("")}</div>
      </div>
      <div class="toolbar no-print">
        <button type="button" onclick="window.print()">Imprimir / Salvar PDF</button>
      </div>
    </header>

    <section>
      <h2>KPIs principais</h2>
      <div class="kpis">${kpis
        .map(
          (kpi) =>
            `<div class="kpi"><strong>${escapeReportHtml(
              kpi.value,
            )}</strong><span>${escapeReportHtml(kpi.label)}</span></div>`,
        )
        .join("")}</div>
    </section>

    <section>
      <h2>Resumo de calendário</h2>
      <table>
        <thead><tr>${calendarColumns
          .map((column) => `<th>${escapeReportHtml(column.label)}</th>`)
          .join("")}</tr></thead>
        <tbody>${buildReportRowsHtml(
          visibleCalendarRows,
          calendarColumns,
          "Nenhum evento de calendário carregado.",
        )}</tbody>
      </table>
      ${
        calendarRows.length > maxRows
          ? `<div class="note">Mostrando ${maxRows} de ${calendarRows.length} eventos carregados.</div>`
          : ""
      }
    </section>

    <section>
      <h2>Resumo de Gantt</h2>
      <table>
        <thead><tr>${ganttColumns
          .map((column) => `<th>${escapeReportHtml(column.label)}</th>`)
          .join("")}</tr></thead>
        <tbody>${buildReportRowsHtml(
          visibleGanttRows,
          ganttColumns,
          "Nenhuma atividade de Gantt carregada.",
        )}</tbody>
      </table>
      ${
        ganttRows.length > maxRows
          ? `<div class="note">Mostrando ${maxRows} de ${ganttRows.length} atividades carregadas.</div>`
          : ""
      }
    </section>
  </main>
</body>
</html>`;
}

function openExecutiveReportWindow(reportArgs) {
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    toast.error("Permita pop-ups para abrir a exportação executiva.");
    return;
  }

  reportWindow.document.open();
  reportWindow.document.write(buildExecutiveReportHtml(reportArgs));
  reportWindow.document.close();
  reportWindow.focus();
}

function getActivityLabelFromIssue(issue, activityId) {
  const activity = (issue?.atividades || []).find(
    (item) => String(item?.id || "") === String(activityId || ""),
  );
  return String(activity?.name || activityId || "Atividade").trim();
}

function getActivityDateText(issue, activityId) {
  const activity = (issue?.atividades || []).find(
    (item) => String(item?.id || "") === String(activityId || ""),
  );
  return String(activity?.data || "").trim() || "--";
}

function makeHistoryEntry({
  source,
  issueKey,
  activityId,
  activityName,
  previousRange,
  nextRange,
}) {
  return {
    id: makeScheduleChangeId(),
    source,
    issueKey,
    activityId,
    activityName: activityName || activityId || "Atividade",
    previousRange: previousRange || "--",
    nextRange: nextRange || "--",
    status: "pendente",
    timestamp: new Date().toISOString(),
  };
}

function getIssueKey(issue) {
  return String(issue?.key || "")
    .trim()
    .toUpperCase();
}

function mergeIssueByKey(list, issue) {
  const key = getIssueKey(issue);
  if (!key) return list || [];

  let found = false;
  const next = (list || []).map((item) => {
    if (getIssueKey(item) !== key) return item;
    found = true;
    return issue;
  });

  if (!found) next.push(issue);
  return next;
}

function formatReloadProgress(progress) {
  if (!progress?.active) return "";
  if (!progress?.total) return "Buscando tickets...";

  const loaded = Number(progress.loaded || 0);
  const total = Number(progress.total || 0);
  const failed = Number(progress.failed || 0);
  const failureText = failed
    ? ` • ${failed} falha${failed > 1 ? "s" : ""}`
    : "";
  return `${loaded}/${total} carregados${failureText}`;
}

function summarizeProgressiveLoadWarning(failures = [], doneError = null) {
  const parts = [];

  if (failures.length) {
    const keys = failures
      .slice(0, 6)
      .map((failure) => failure.key)
      .filter(Boolean)
      .join(", ");
    const more = failures.length > 6 ? ` e mais ${failures.length - 6}` : "";
    parts.push(
      `${failures.length} ticket${failures.length > 1 ? "s" : ""} não ${
        failures.length > 1 ? "carregaram" : "carregou"
      }${keys ? `: ${keys}${more}` : ""}.`,
    );
  }

  if (doneError) {
    parts.push(
      `Não foi possível atualizar os concluídos dos últimos 30 dias: ${
        doneError?.message || String(doneError)
      }`,
    );
  }

  return parts.join(" ");
}

/* =========================
   //#region COMPONENT
========================= */
function PersonalPortfolioView({
  insights,
  rows,
  doneRows,
  loading,
  jiraUserName,
  onOpenDetails,
  onOpenSchedule,
  onOpenDocumentation,
  onResolveProblem,
}) {
  const portfolio = insights?.portfolio || {};
  const alerts = insights?.criticalAlerts || {};
  const kpis = [
    { label: "Meus tickets", value: portfolio.total || 0, tone: "zinc" },
    { label: "Atrasados", value: portfolio.overdue || 0, tone: "red" },
    { label: "Próximos 7 dias", value: portfolio.dueThisWeek || 0, tone: "amber" },
    { label: "Sem cronograma", value: portfolio.noSchedule || 0, tone: "slate" },
    { label: "Com risco", value: portfolio.atRisk || 0, tone: "red" },
    {
      label: "Sem avanço",
      value: (insights?.filteredItems || []).filter((item) => item.noRecentUpdate)
        .length,
      tone: "amber",
    },
  ];

  const toneClasses = {
    zinc: "border-zinc-200 bg-white text-zinc-900",
    red: "border-red-200 bg-red-50 text-red-800",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    slate: "border-slate-200 bg-slate-50 text-slate-800",
  };

  return (
    <section className="grid gap-4">
      <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="text-base text-zinc-900">
                Minha Carteira
              </CardTitle>
              <CardDescription>
                Recorte pessoal de {jiraUserName || "usuario Jira"} com tickets
                atribuídos no Jira.
              </CardDescription>
            </div>
            <Badge className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
              Filtro por accountId
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              className={cn(
                "rounded-2xl border p-3",
                toneClasses[kpi.tone] || toneClasses.zinc
              )}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-75">
                {kpi.label}
              </div>
              <div className="mt-1 text-2xl font-bold">{kpi.value}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-zinc-900">
            Vencimentos da semana
          </CardTitle>
          <CardDescription>Tickets e atividades com data próxima.</CardDescription>
        </CardHeader>
        <CardContent className="grid max-h-[420px] gap-2 overflow-auto md:grid-cols-2 xl:grid-cols-3">
          {(alerts.dueNext7 || []).length ? (
            alerts.dueNext7.slice(0, 12).map((item) => (
              <button
                key={item.key}
                type="button"
                className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left hover:bg-white"
                onClick={() => onOpenDetails?.(item.key)}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <code className="max-w-[70%] truncate rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700">
                    {item.key}
                  </code>
                  <Badge className="shrink-0 rounded-full bg-zinc-900 text-white">
                    {item.dueInDays === 0 ? "Hoje" : `${item.dueInDays}d`}
                  </Badge>
                </div>
                <div className="mt-1 line-clamp-2 break-words text-sm font-medium text-zinc-900">
                  {item.summary}
                </div>
              </button>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-5 text-sm text-zinc-500 md:col-span-2 xl:col-span-3">
              Nenhum vencimento nos próximos 7 dias.
            </div>
          )}
        </CardContent>
      </Card>

      <POActionsHub
        personalMode
        insights={insights}
        onOpenDetails={onOpenDetails}
        onOpenSchedule={onOpenSchedule}
        onOpenDocumentation={onOpenDocumentation}
        onResolveProblem={onResolveProblem}
      />

      <POPortfolioHub
        personalMode
        insights={insights}
        onOpenDetails={onOpenDetails}
      />

      <AMDashboardTab rows={rows} doneRows={doneRows} loading={loading} />
    </section>
  );
}

function getQueueStatus(issue) {
  const raw = getTicketStatusName(issue) || PERSONAL_QUEUE_OTHER_STATUS;
  const match = STATUS_OPTIONS.find(
    (status) => normalizePlain(status) === normalizePlain(raw),
  );
  return match || PERSONAL_QUEUE_OTHER_STATUS;
}

function getQueueSummary(issue) {
  return issue?.summary || issue?.fields?.summary || "Sem resumo";
}

function getQueuePriority(issue) {
  return (
    issue?.priorityName ||
    issue?.priority ||
    issue?.fields?.priority?.name ||
    "Nao informado"
  );
}

function getQueueDueYmd(issue) {
  return (
    extractYmd(issue?.customfield_11519 || issue?.fields?.customfield_11519) ||
    getReportDueYmd(issue)
  );
}

function getQueueUpdatedLabel(issue) {
  const raw = issue?.updatedRaw || issue?.updated || issue?.fields?.updated;
  if (!raw) return "Sem atualizacao";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "Sem atualizacao";
  const days = diffDays(startOfTodayLocal(), date);
  if (days <= 0) return "Atualizado hoje";
  if (days === 1) return "Atualizado ontem";
  return `${days}d sem atualizacao`;
}

function getQueueHealth(issue) {
  if (isReportIssueOverdue(issue)) {
    return {
      label: "🔥 Atrasado",
      className: "border-red-200 bg-red-50 text-red-700",
    };
  }

  const due = parseIsoYmdLocal(getQueueDueYmd(issue));
  if (due) {
    const days = diffDays(due, startOfTodayLocal());
    if (days >= 0 && days <= 7) {
      return {
        label: days === 0 ? "⏳ Hoje" : `⏳ ${days}d`,
        className: "border-amber-200 bg-amber-50 text-amber-800",
      };
    }
  }

  return {
    label: "✅ Em dia",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
}

function PersonalQueueView({
  rows,
  loading,
  movingKeys,
  onOpenDetails,
  onMoveStatus,
}) {
  const [activeId, setActiveId] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ticketsByKey = useMemo(() => {
    const map = new Map();
    (rows || []).forEach((issue) => {
      const key = getIssueKey(issue);
      if (key) map.set(key, issue);
    });
    return map;
  }, [rows]);

  const grouped = useMemo(() => {
    const base = Object.fromEntries(
      PERSONAL_QUEUE_COLUMNS.map((status) => [status, []]),
    );

    (rows || []).forEach((issue) => {
      const status = getQueueStatus(issue);
      base[status] = [...(base[status] || []), issue];
    });

    Object.keys(base).forEach((status) => {
      base[status] = [...base[status]].sort((a, b) => {
        const aDue = getQueueDueYmd(a) || "9999-12-31";
        const bDue = getQueueDueYmd(b) || "9999-12-31";
        if (aDue !== bDue) return aDue.localeCompare(bDue);
        return getQueueSummary(a).localeCompare(getQueueSummary(b));
      });
    });

    return base;
  }, [rows]);

  const activeTicket = activeId ? ticketsByKey.get(activeId) : null;
  const total = rows?.length || 0;
  const actionable = (rows || []).filter(
    (issue) => getQueueStatus(issue) !== PERSONAL_QUEUE_OTHER_STATUS,
  ).length;
  const dropAnimation = {
    duration: 260,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  };

  function getTargetStatus(over) {
    const status = over?.data?.current?.status;
    if (status) return status;
    const id = String(over?.id || "");
    if (id.startsWith("column:")) return id.slice("column:".length);
    const overTicket = ticketsByKey.get(id);
    return overTicket ? getQueueStatus(overTicket) : "";
  }

  async function handleDragEnd(event) {
    const key = String(event?.active?.id || "")
      .trim()
      .toUpperCase();
    const targetStatus = getTargetStatus(event?.over);
    const issue = key ? ticketsByKey.get(key) : null;
    const sourceStatus = issue ? getQueueStatus(issue) : "";

    setActiveId(null);

    if (
      !key ||
      !issue ||
      !targetStatus ||
      targetStatus === PERSONAL_QUEUE_OTHER_STATUS ||
      sourceStatus === targetStatus
    ) {
      return;
    }

    await onMoveStatus?.(key, targetStatus, sourceStatus);
  }

  if (loading && !total) {
    return (
      <section className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[520px] rounded-3xl" />
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <Card className="overflow-hidden rounded-3xl border-zinc-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-base text-zinc-900">
                Minha Fila
              </CardTitle>
              <CardDescription>
                Kanban pessoal por status. Arraste um ticket para mover no Jira.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                {total} tickets
              </Badge>
              <Badge className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
                {actionable} moviveis
              </Badge>
              <Badge className="rounded-full border border-red-200 bg-red-50 text-red-700">
                {(rows || []).filter((issue) => isReportIssueOverdue(issue)).length} atrasados
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event) => setActiveId(event.active?.id || null)}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto pb-4">
          <div className="grid min-w-[1260px] grid-flow-col auto-cols-[minmax(270px,1fr)] gap-3 lg:min-w-0 lg:auto-cols-[minmax(260px,1fr)]">
            {PERSONAL_QUEUE_COLUMNS.map((status) => (
              <PersonalQueueColumn
                key={status}
                status={status}
                tickets={grouped[status] || []}
                movingKeys={movingKeys}
                onOpenDetails={onOpenDetails}
              />
            ))}
          </div>
        </div>

        <DragOverlay dropAnimation={dropAnimation}>
          <AnimatePresence mode="popLayout">
            {activeTicket ? (
              <PersonalQueueCard
                key={getIssueKey(activeTicket)}
                ticket={activeTicket}
                moving={false}
                overlay
                onOpenDetails={onOpenDetails}
              />
            ) : null}
          </AnimatePresence>
        </DragOverlay>
      </DndContext>
    </section>
  );
}

function PersonalQueueColumn({ status, tickets, movingKeys, onOpenDetails }) {
  const isOther = status === PERSONAL_QUEUE_OTHER_STATUS;
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${status}`,
    data: { type: "column", status },
    disabled: isOther,
  });
  const ids = tickets.map((ticket) => getIssueKey(ticket)).filter(Boolean);

  return (
    <motion.div
      ref={setNodeRef}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: isOver && !isOther ? 1.015 : 1,
      }}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 360, damping: 30 }}
    >
      <Card
        className={cn(
          "flex max-h-[72vh] min-h-[420px] flex-col overflow-hidden rounded-3xl border bg-white shadow-sm transition-all duration-200",
          isOver && !isOther
            ? "border-red-300 bg-red-50/50 shadow-lg ring-2 ring-red-100"
            : "border-zinc-200",
          isOther && "bg-zinc-50/80",
        )}
      >
        <CardHeader className="border-b border-zinc-100 p-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="truncate text-sm text-zinc-900">
              {status}
            </CardTitle>
            <Badge className="shrink-0 rounded-full border border-zinc-200 bg-white text-zinc-700">
              {tickets.length}
            </Badge>
          </div>
          <CardDescription className="line-clamp-1 text-xs">
            {isOther ? "Status fora do fluxo mapeado" : "Solte aqui para mover"}
          </CardDescription>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 overflow-y-auto p-2">
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="grid gap-2">
              <AnimatePresence mode="popLayout" initial={false}>
                {tickets.length ? (
                  tickets.map((ticket) => {
                    const key = getIssueKey(ticket);
                    return (
                      <motion.div
                        key={key}
                        layout
                        initial={{ opacity: 0, y: 10, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.96 }}
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 34,
                        }}
                      >
                        <PersonalQueueCard
                          ticket={ticket}
                          disabled={isOther}
                          moving={movingKeys?.has(key)}
                          onOpenDetails={onOpenDetails}
                        />
                      </motion.div>
                    );
                  })
                ) : (
                  <motion.div
                    key={`empty-${status}`}
                    layout
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{
                      opacity: 1,
                      scale: isOver && !isOther ? 1.02 : 1,
                      borderColor:
                        isOver && !isOther
                          ? "rgb(248 113 113)"
                          : "rgb(228 228 231)",
                      backgroundColor:
                        isOver && !isOther
                          ? "rgb(254 242 242)"
                          : "rgb(250 250 250)",
                    }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 360, damping: 30 }}
                    className="grid min-h-[128px] place-items-center rounded-2xl border border-dashed px-3 text-center text-xs text-zinc-500"
                  >
                    {isOver && !isOther
                      ? "Solte para mover aqui."
                      : "Nenhum ticket aqui."}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </SortableContext>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function PersonalQueueCard({
  ticket,
  moving = false,
  disabled = false,
  overlay = false,
  onOpenDetails,
}) {
  const key = getIssueKey(ticket);
  const status = getQueueStatus(ticket);
  const priority = getQueuePriority(ticket);
  const dueYmd = getQueueDueYmd(ticket);
  const health = getQueueHealth(ticket);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: key,
    data: { type: "ticket", status },
    disabled: disabled || moving || overlay,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cn(
        "touch-none",
        overlay && "w-[280px]",
      )}
    >
      <motion.div
        layout
        initial={overlay ? false : { opacity: 0, y: 8, scale: 0.98 }}
        animate={{
          opacity: isDragging ? 0.35 : 1,
          y: 0,
          scale: overlay ? 1.04 : 1,
        }}
        exit={{ opacity: 0, y: -8, scale: 0.96 }}
        whileHover={overlay || moving ? undefined : { y: -3, scale: 1.01 }}
        whileTap={overlay || moving ? undefined : { scale: 0.985 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className={cn(
          "group rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm transition-colors",
          "hover:border-red-200 hover:shadow-md",
          isDragging && "opacity-40",
          overlay && "border-red-200 shadow-2xl ring-4 ring-red-100",
          moving && "pointer-events-none opacity-70",
        )}
      >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 text-left"
          onClick={() => onOpenDetails?.(key)}
        >
          <motion.code
            layout
            whileHover={{ scale: 1.04 }}
            transition={{ type: "spring", stiffness: 500, damping: 28 }}
            className="inline-block rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-700"
          >
            {key}
          </motion.code>
          <h3 className="mt-2 line-clamp-3 break-words text-sm font-semibold leading-5 text-zinc-950">
            {getQueueSummary(ticket)}
          </h3>
        </button>

        <motion.button
          type="button"
          whileHover={
            disabled || moving
              ? undefined
              : { rotate: -6, scale: 1.08 }
          }
          whileTap={disabled || moving ? undefined : { rotate: 0, scale: 0.94 }}
          transition={{ type: "spring", stiffness: 520, damping: 24 }}
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500",
            "cursor-grab active:cursor-grabbing",
            (disabled || moving) && "cursor-not-allowed opacity-50",
          )}
          title={disabled ? "Status fora do fluxo mapeado" : "Arrastar ticket"}
          {...attributes}
          {...listeners}
        >
          <ArrowUpDown className="h-4 w-4" />
        </motion.button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge className={cn("rounded-full border", health.className)}>
          {health.label}
        </Badge>
        <Badge
          className="rounded-full border bg-white text-zinc-700"
          style={{ borderColor: priorityColor(priority), color: priorityColor(priority) }}
        >
          {priority}
        </Badge>
        {dueYmd ? (
          <Badge className="rounded-full border border-blue-200 bg-blue-50 text-blue-700">
            {fmtDateBr(dueYmd)}
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
        <span className="truncate">{getQueueUpdatedLabel(ticket)}</span>
        <AnimatePresence initial={false}>
          {moving ? (
            <motion.span
              key="moving"
              initial={{ opacity: 0, x: 8, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 8, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="inline-flex items-center gap-1 font-semibold text-red-600"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Movendo...
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
      </motion.div>
    </article>
  );
}

export default function AMPanelTab({
  calendarSettings,
  currentUser,
  personalMode = false,
  onConfigureUser,
}) {
  const effectiveCalendarSettings = useMemo(
    () => normalizeCalendarSettings(calendarSettings),
    [calendarSettings],
  );
  const [subView, setSubView] = useState(personalMode ? "dashboard" : "acoes"); // acoes | portfolio | calendario | gantt | dashboard
  const [personalSubView, setPersonalSubView] = useState("queue");
  const [loading, setLoading] = useState(false);
  const [reloadProgress, setReloadProgress] = useState({
    active: false,
    total: 0,
    completed: 0,
    loaded: 0,
    failed: 0,
  });
  const reloadRunRef = useRef(0);
  const [err, setErr] = useState("");
  const [activePreset, setActivePreset] = useState(personalMode ? "mine" : "all");
  const [ownerFocus, setOwnerFocus] = useState(
    currentUser?.jiraDisplayName || currentUser?.name || ""
  );

  const [rawIssues, setRawIssues] = useState([]);
  const [viewData, setViewData] = useState({
    alertas: [],
    criarCronograma: [],
    calendarioIssues: [],
    events: [],
  });

  // modal cronograma
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorIssue, setEditorIssue] = useState(null);
  const [draft, setDraft] = useState([]);
  const [dueDateDraft, setDueDateDraft] = useState(""); // yyyy-mm-dd

  // modal "Iniciar ticket"
  const [startOpen, setStartOpen] = useState(false);
  const [startIssueKey, setStartIssueKey] = useState("");
  const [startIssue, setStartIssue] = useState(null);
  const [startLoading, setStartLoading] = useState(false);
  const [startErr, setStartErr] = useState("");
  const [selectedStatus, setSelectedStatus] = useState(STATUS_OPTIONS[0]);

  // dashboard tickets
  const [dashTab, setDashTab] = useState("alertas"); // alertas | andamento | todos
  const [searchText, setSearchText] = useState("");

  // filtros tickets
  const [selectedStatuses, setSelectedStatuses] = useState([]);
  const [selectedAssignees, setSelectedAssignees] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [sortBy, setSortBy] = useState("updatedDesc"); // updatedDesc | updatedAsc

  // modal detalhes
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsKey, setDetailsKey] = useState("");

  // modal organizar documentacao
  const [documentationOpen, setDocumentationOpen] = useState(false);
  const [documentationTicket, setDocumentationTicket] = useState(null);

  // modal resolucao de alertas
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [resolutionTicket, setResolutionTicket] = useState(null);
  const [resolutionProblem, setResolutionProblem] = useState(null);
  const [resolutionComment, setResolutionComment] = useState("");
  const [resolutionDueDate, setResolutionDueDate] = useState("");
  const [resolutionSaving, setResolutionSaving] = useState(false);
  const [resolutionErr, setResolutionErr] = useState("");

  // modal criacao de ticket Jira (PO)
  const [createIssueOpen, setCreateIssueOpen] = useState(false);

  // 1) modos de cor: ticket | recurso | atividade
  // 2) filtro por texto (ticket/tarefa/recurso)
  const [colorMode, setColorMode] = useState("ticket");
  const [calendarFilter, setCalendarFilter] = useState("");

  // trava durante persistência de mudança de datas (drag/resize)
  const [persisting, setPersisting] = useState(false);
  const [changeHistory, setChangeHistory] = useState([]);
  const [movingPersonalKeys, setMovingPersonalKeys] = useState(() => new Set());
  const busy = Boolean(loading || persisting);
  const ownerAccountId = String(currentUser?.jiraAccountId || "").trim();
  const effectiveOwnerFocus =
    currentUser?.jiraDisplayName || ownerFocus || currentUser?.name || "";
  const insightOwnerAccountId = personalMode ? ownerAccountId : "";
  const insightOwnerFocus = personalMode ? effectiveOwnerFocus : "";
  const effectiveActivePreset =
    !personalMode && activePreset === "mine" ? "all" : activePreset;

  useEffect(() => {
    if (!personalMode) return;
    setActivePreset("mine");
  }, [personalMode, ownerAccountId]);

  useEffect(() => {
    if (!personalMode && activePreset === "mine") {
      setActivePreset("all");
    }
  }, [activePreset, personalMode]);

  useEffect(() => {
    if (currentUser?.jiraDisplayName) {
      setOwnerFocus(currentUser.jiraDisplayName);
    }
  }, [currentUser?.jiraDisplayName]);

  const addChangeHistory = useCallback((entry) => {
    if (!entry?.id) return;
    setChangeHistory((prev) => [entry, ...(prev || [])].slice(0, 12));
  }, []);

  const updateChangeHistoryStatus = useCallback((ids, status, message = "") => {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    setChangeHistory((prev) =>
      (prev || []).map((entry) =>
        set.has(entry.id)
          ? {
              ...entry,
              status,
              message,
              resolvedAt: new Date().toISOString(),
            }
          : entry,
      ),
    );
  }, []);

  // dashboard tickets
  const [rows, setRows] = useState([]);
  const [doneRows, setDoneRows] = useState([]);

  const applyCronogramaPatchLocal = useCallback((issueKey, atividades) => {
    const ik = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!ik || !Array.isArray(atividades)) return;

    setRawIssues((prev) =>
      (prev || []).map((issue) =>
        String(issue?.key || "")
          .trim()
          .toUpperCase() === ik
          ? { ...issue, atividades }
          : issue,
      ),
    );

    setRows((prev) =>
      (prev || []).map((issue) =>
        String(issue?.key || "")
          .trim()
          .toUpperCase() === ik
          ? { ...issue, atividades }
          : issue,
      ),
    );

    setViewData((prev) => {
      const calendarioIssues = (prev?.calendarioIssues || []).map((issue) =>
        String(issue?.key || "")
          .trim()
          .toUpperCase() === ik
          ? { ...issue, atividades }
          : issue,
      );

      const issueEvents = toCalendarEvents(ik, atividades, new Date());
      const events = [
        ...(prev?.events || []).filter((event) => {
          const eventIssueKey = String(
            event?.extendedProps?.issueKey || event?.issueKey || "",
          )
            .trim()
            .toUpperCase();
          return eventIssueKey !== ik;
        }),
        ...issueEvents,
      ];

      return { ...prev, calendarioIssues, events };
    });
  }, []);

  async function runProgressiveReload() {
    const runId = reloadRunRef.current + 1;
    reloadRunRef.current = runId;
    const isCurrentRun = () => reloadRunRef.current === runId;

    setLoading(true);
    setErr("");
    setReloadProgress({
      active: true,
      total: 0,
      completed: 0,
      loaded: 0,
      failed: 0,
    });

    const donePromise = fetchPoDoneLast30Days().then(
      (data) => ({ data, error: null }),
      (error) => ({ data: null, error }),
    );

    try {
      const result = await fetchPoIssuesDetailedProgressive({
        concurrency: 8,
        onStart: ({ total }) => {
          if (!isCurrentRun()) return;
          setReloadProgress({
            active: true,
            total,
            completed: 0,
            loaded: 0,
            failed: 0,
          });
        },
        onIssue: (issue) => {
          if (!isCurrentRun()) return;

          setRawIssues((prev) => {
            const next = mergeIssueByKey(prev, issue);
            setViewData(buildPoView(next));
            return next;
          });
          setRows((prev) => mergeIssueByKey(prev, issue));
        },
        onProgress: (progress) => {
          if (!isCurrentRun()) return;
          setReloadProgress((prev) => ({
            ...prev,
            ...progress,
            active: true,
          }));
        },
      });

      const done = await donePromise;
      if (!isCurrentRun()) return;

      setRawIssues(result.detailed);
      setViewData(buildPoView(result.detailed));
      setRows(result.detailed);
      if (!done.error) setDoneRows(done.data || []);

      setErr(
        summarizeProgressiveLoadWarning(result.failures || [], done.error),
      );
    } catch (e) {
      console.error(e);
      if (isCurrentRun()) {
        setErr(e?.message || "Falha ao carregar dados do Jira.");
      }
    } finally {
      if (isCurrentRun()) {
        setLoading(false);
        setReloadProgress((prev) => ({ ...prev, active: false }));
      }
    }
  }

  const reload = useCallback(async () => {
    return runProgressiveReload();
  }, []);

  const refreshIssueInPanel = useCallback(async (issueKey) => {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!key) return null;

    const issue = await fetchPoIssueDetail(key);

    setRawIssues((prev) => {
      const next = mergeIssueByKey(prev, issue);
      setViewData(buildPoView(next));
      return next;
    });
    setRows((prev) => mergeIssueByKey(prev, issue));
    setDocumentationTicket((prev) =>
      getIssueKey(prev) === key ? { ...prev, ...issue } : prev,
    );

    return issue;
  }, []);

  const applyTicketStatusLocal = useCallback((issueKey, statusName) => {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    const nextStatus = String(statusName || "").trim();
    if (!key || !nextStatus) return;

    const patchIssue = (issue) => {
      if (
        String(issue?.key || "")
          .trim()
          .toUpperCase() !== key
      ) {
        return issue;
      }

      return {
        ...issue,
        statusName: nextStatus,
        status:
          issue?.status && typeof issue.status === "object"
            ? { ...issue.status, name: nextStatus }
            : nextStatus,
        jira: {
          ...(issue?.jira || {}),
          status: nextStatus,
        },
        fields: {
          ...(issue?.fields || {}),
          status: {
            ...(issue?.fields?.status || {}),
            name: nextStatus,
          },
        },
      };
    };

    setRawIssues((prev) => {
      const next = (prev || []).map(patchIssue);
      setViewData(buildPoView(next));
      return next;
    });
    setRows((prev) => (prev || []).map(patchIssue));
  }, []);

  async function loadData(baseJql) {
    setLoading(true);
    try {
      const [openIssues, doneIssues] = await Promise.all([
        jiraSearchJqlAll({
          jql: baseJql,
          maxResults: 100,
          fields: [
            "summary",
            "status",
            "assignee",
            "labels",
            "attachment",
            "priority",
            "created",
            "updated",
            "duedate",
            "components",
            "issuetype",
            "reporter",
            "customfield_10988",
            "customfield_11519",
            "customfield_11520",
            "customfield_14017",
          ],
        }),

        // ✅ NOVO: Done (últimos 30 dias)
        jiraSearchDoneLastNDays({
          baseJql,
          days: 30,
        }),
      ]);

      setRows(openIssues);
      setDoneRows(doneIssues);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, [reload]);

  const filteredAlertas = useMemo(() => viewData.alertas || [], [viewData]);
  const filteredCriarCronograma = useMemo(
    () => viewData.criarCronograma || [],
    [viewData],
  );
  const poInsights = useMemo(
    () =>
      buildPoInsights({
        rawIssues,
        viewData,
        doneRows,
        ownerFocus: insightOwnerFocus,
        ownerAccountId: insightOwnerAccountId,
        excludeDoneFromOperationalSummary: personalMode,
      }),
    [
      rawIssues,
      viewData,
      doneRows,
      insightOwnerFocus,
      insightOwnerAccountId,
      personalMode,
    ],
  );
  const scopedIssueKeys = useMemo(
    () =>
      getScopedIssueKeysFromPreset({
        insights: poInsights,
        activePreset: effectiveActivePreset,
        ownerFocus: insightOwnerFocus,
        ownerAccountId: insightOwnerAccountId,
      }),
    [
      poInsights,
      effectiveActivePreset,
      insightOwnerFocus,
      insightOwnerAccountId,
    ],
  );
  const scopedViewData = useMemo(
    () => filterPoViewData(viewData, scopedIssueKeys),
    [viewData, scopedIssueKeys],
  );
  const scopedRawIssues = useMemo(
    () =>
      rawIssues.filter((issue) =>
        scopedIssueKeys.has(
          String(issue?.key || "")
            .trim()
            .toUpperCase(),
        ),
      ),
    [rawIssues, scopedIssueKeys],
  );
  const scopedDoneRows = useMemo(
    () => {
      if (personalMode) {
        const accountId = String(ownerAccountId || "").trim();
        const ownerName = String(effectiveOwnerFocus || "").trim().toLowerCase();
        return doneRows.filter((issue) => {
          const issueAccountId = String(issue?.assigneeAccountId || "").trim();
          if (accountId && issueAccountId) return issueAccountId === accountId;
          if (!ownerName) return false;
          const issueOwner = String(
            issue?.assignee || issue?.assigneeDisplayName || "",
          ).toLowerCase();
          return issueOwner.includes(ownerName);
        });
      }

      return doneRows.filter((issue) =>
        scopedIssueKeys.has(
          String(issue?.key || "")
            .trim()
            .toUpperCase(),
        ),
      );
    },
    [doneRows, effectiveOwnerFocus, ownerAccountId, personalMode, scopedIssueKeys],
  );
  const scopedAlertas = useMemo(
    () => scopedViewData.alertas || [],
    [scopedViewData],
  );
  const scopedCriarCronograma = useMemo(
    () => scopedViewData.criarCronograma || [],
    [scopedViewData],
  );
  const ticketMetaMap = useMemo(
    () =>
      new Map(
        (poInsights?.items || []).map((item) => [String(item.key || ""), item]),
      ),
    [poInsights],
  );

  const exportExecutiveReport = useCallback(() => {
    openExecutiveReportWindow({
      viewData: scopedViewData,
      rawIssues: scopedRawIssues,
      doneRows: scopedDoneRows,
      filters: {
        activePreset: effectiveActivePreset,
        ownerFocus: insightOwnerFocus,
        ownerAccountId: insightOwnerAccountId,
        calendarFilter,
        subView,
      },
    });
  }, [
    effectiveActivePreset,
    calendarFilter,
    insightOwnerFocus,
    insightOwnerAccountId,
    scopedDoneRows,
    scopedRawIssues,
    scopedViewData,
    subView,
  ]);

  function openEditor(issue) {
    setEditorIssue(issue);
    setDraft(
      makeDefaultCronogramaDraft().map((atividade) => ({
        ...atividade,
        isCustom: !STANDARD_CRONOGRAMA_IDS.has(atividade.id),
      })),
    );
    setDueDateDraft(
      String(issue?.dueDateRaw || issue?.fields?.duedate || "").slice(0, 10),
    );
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorIssue(null);
    setDraft([]);
    setDueDateDraft("");
  }

  function openDocumentationOrganizer(ticket) {
    if (!ticket?.key) return;
    setDocumentationTicket(ticket);
    setDocumentationOpen(true);
  }

  function closeDocumentationOrganizer() {
    setDocumentationOpen(false);
    setDocumentationTicket(null);
  }

  function closeResolutionDialog() {
    setResolutionOpen(false);
    setResolutionTicket(null);
    setResolutionProblem(null);
    setResolutionComment("");
    setResolutionDueDate("");
    setResolutionErr("");
    setResolutionSaving(false);
  }

  function openResolutionProblem(item, problem) {
    const ticket = item?.raw || problem?.raw || item;
    const key = String(item?.key || problem?.key || ticket?.key || "")
      .trim()
      .toUpperCase();
    if (!key || !problem?.type) return;

    const normalizedTicket = { ...(ticket || {}), key };

    if (problem.type === "noSchedule") {
      openEditor(normalizedTicket);
      return;
    }
    if (problem.type === "noOwner" || problem.type === "notStarted") {
      openStartModal(normalizedTicket);
      return;
    }
    if (problem.type === "documentation") {
      openDocumentationOrganizer(normalizedTicket);
      return;
    }

    setResolutionTicket(normalizedTicket);
    setResolutionProblem(problem);
    setResolutionComment("");
    setResolutionDueDate("");
    setResolutionErr("");
    setResolutionOpen(true);
  }

  async function saveResolutionDialog() {
    const key = String(resolutionTicket?.key || resolutionProblem?.key || "")
      .trim()
      .toUpperCase();
    if (!key || !resolutionProblem?.type) return;

    setResolutionSaving(true);
    setResolutionErr("");

    try {
      if (resolutionProblem.type === "capacityConflict") {
        setSubView("gantt");
        setCalendarFilter(key);
        closeResolutionDialog();
        return;
      }

      if (resolutionProblem.type === "overdue" && resolutionDueDate) {
        await jiraEditIssue(key, {
          fields: {
            duedate: resolutionDueDate,
          },
        });
      }

      const comment = String(resolutionComment || "").trim();
      const fallbackComment = `[RESOLUCAO] ${resolutionProblem.label || "Alerta"} - ${
        resolutionProblem.recommendedAction || "Acao registrada."
      }`;
      await createComment(key, adfFromPlainText(comment || fallbackComment));

      await reload();
      closeResolutionDialog();
    } catch (e) {
      console.error(e);
      setResolutionErr(e?.message || "Falha ao registrar resolucao do alerta.");
    } finally {
      setResolutionSaving(false);
    }
  }

  async function setDocumentationFolderFlag(issueKey, enabled) {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!key) return;

    await jiraEditIssue(key, {
      update: {
        labels: [
          enabled
            ? { add: DOCUMENTATION_FOLDER_LABEL }
            : { remove: DOCUMENTATION_FOLDER_LABEL },
        ],
      },
    });
    return refreshIssueInPanel(key);
  }

  async function updateTicketPriority(issueKey, priorityName) {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!key || !priorityName) return;
    await jiraUpdateIssuePriority(key, priorityName);
    return refreshIssueInPanel(key);
  }

  async function updateTicketStatus(issueKey, statusName) {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!key || !statusName) return;
    await jiraTransitionToStatus(key, statusName);
    return refreshIssueInPanel(key);
  }

  async function movePersonalTicketStatus(issueKey, statusName, previousStatus) {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    const nextStatus = String(statusName || "").trim();
    const prevStatus = String(previousStatus || "").trim();
    if (!key || !nextStatus || nextStatus === prevStatus) return;

    setMovingPersonalKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setErr("");
    applyTicketStatusLocal(key, nextStatus);

    try {
      await jiraTransitionToStatus(key, nextStatus);
      await refreshIssueInPanel(key).catch(() => null);
      toast.success(`${key} movido para ${nextStatus}.`);
    } catch (e) {
      console.error(e);
      applyTicketStatusLocal(key, prevStatus);
      const message =
        e?.message ||
        `Nao foi possivel mover ${key} para ${nextStatus}.`;
      setErr(message);
      toast.error(message);
    } finally {
      setMovingPersonalKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function saveEditor(nextDraft = draft) {
    if (!editorIssue) return;
    setLoading(true);
    setErr("");
    try {
      await saveCronogramaToJira(editorIssue.key, nextDraft, {
        dueDate: dueDateDraft,
      });
      closeEditor();
      await reload();
      setSubView("calendario");
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Falha ao salvar cronograma no Jira.");
    } finally {
      setLoading(false);
    }
  }

  // abrir "Iniciar ticket" (carrega issue completo)
  async function openStartModal(row) {
    const key = String(row?.key || "")
      .trim()
      .toUpperCase();
    if (!key) return;

    setStartOpen(true);
    setStartIssueKey(key);
    setStartIssue(null);
    setStartErr("");
    setSelectedStatus(STATUS_OPTIONS[0]);

    setStartLoading(true);
    try {
      const issue = await getIssue(key, START_FIELDS);
      setStartIssue(issue);

      const current = issue?.fields?.status?.name || "";
      // mantém seleção padrão se não casar
      if (STATUS_OPTIONS.includes(current)) setSelectedStatus(current);
    } catch (e) {
      console.error(e);
      setStartErr(e?.message || "Falha ao carregar detalhes do ticket.");
    } finally {
      setStartLoading(false);
    }
  }

  function closeStartModal() {
    setStartOpen(false);
    setStartIssueKey("");
    setStartIssue(null);
    setStartErr("");
    setStartLoading(false);
    setSelectedStatus(STATUS_OPTIONS[0]);
  }

  async function applyStatusOnly(ctx = {}) {
    if (!startIssueKey) return;
    setStartLoading(true);
    setStartErr("");

    try {
      // (Opcional) aplicar owner também no "Aplicar status"
      if (ctx?.ownerChanged) {
        await jiraEditIssue(startIssueKey, {
          fields: {
            assignee: ctx.ownerAccountId
              ? { accountId: ctx.ownerAccountId }
              : null,
          },
        });
      }

      await jiraTransitionToStatus(startIssueKey, selectedStatus);

      const issue = await getIssue(startIssueKey, START_FIELDS);
      setStartIssue(issue);

      await reload();
    } catch (e) {
      console.error(e);
      setStartErr(e?.message || "Falha ao alterar status do ticket.");
    } finally {
      setStartLoading(false);
    }
  }

  // Iniciar = comentar + transicionar status
  async function startTicket(ctx = {}) {
    if (!startIssueKey) return;
    setStartLoading(true);
    setStartErr("");

    try {
      // 1) se mudou, atualiza assignee
      if (ctx?.ownerChanged) {
        await jiraEditIssue(startIssueKey, {
          fields: {
            assignee: ctx.ownerAccountId
              ? { accountId: ctx.ownerAccountId }
              : null,
          },
        });
      }

      // 2) comenta [INICIADO]
      await createComment(startIssueKey, adfFromPlainText("[INICIADO]"));

      // 3) transiciona status
      await jiraTransitionToStatus(startIssueKey, selectedStatus);

      // 4) recarrega e fecha
      await reload();
      closeStartModal();
    } catch (e) {
      console.error(e);
      setStartErr(e?.message || "Falha ao iniciar o ticket.");
    } finally {
      setStartLoading(false);
    }
  }

  // drag/resize do calendário → atualiza cronograma no Jira (customfield_14017)
  async function persistEventChange(info) {
    // evita reentrância (se já estiver atualizando Jira)
    if (busy) {
      info.revert();
      return;
    }

    const issueKey = info.event.extendedProps?.issueKey;
    const activityId = info.event.extendedProps?.activityId;
    if (!issueKey || !activityId) {
      info.revert();
      return;
    }

    setPersisting(true);

    const prev = viewData.calendarioIssues.map((x) => ({
      key: x.key,
      atividades: x.atividades?.map((a) => ({ ...a })) || [],
    }));
    const prevIssue = prev.find(
      (x) =>
        String(x?.key || "")
          .trim()
          .toUpperCase() ===
        String(issueKey || "")
          .trim()
          .toUpperCase(),
    );

    const nextCalendarioIssues = viewData.calendarioIssues.map((iss) => {
      if (iss.key !== issueKey) return iss;
      const nextAtividades = applyEventChangeToAtividades(
        iss.atividades,
        activityId,
        info.event.start,
        info.event.end,
      );
      return { ...iss, atividades: nextAtividades };
    });
    const nextIssue = nextCalendarioIssues.find(
      (x) =>
        String(x?.key || "")
          .trim()
          .toUpperCase() ===
        String(issueKey || "")
          .trim()
          .toUpperCase(),
    );
    const historyEntry = makeHistoryEntry({
      source: "calendario",
      issueKey,
      activityId,
      activityName: getActivityLabelFromIssue(
        nextIssue || prevIssue,
        activityId,
      ),
      previousRange: getActivityDateText(prevIssue, activityId),
      nextRange: getActivityDateText(nextIssue, activityId),
    });
    addChangeHistory(historyEntry);

    // otimista
    setViewData((v) => ({ ...v, calendarioIssues: nextCalendarioIssues }));

    try {
      const issue = nextCalendarioIssues.find((x) => x.key === issueKey);
      const adf = buildCronogramaADF(issue.atividades);

      await jiraEditIssue(issueKey, {
        fields: { customfield_14017: adf },
      });

      applyCronogramaPatchLocal(issueKey, issue.atividades || []);
      updateChangeHistoryStatus(historyEntry.id, "salvo");
    } catch (e) {
      console.error(e);
      const message = e?.message || "Falha ao persistir no Jira. Revertendo...";
      setErr(message);
      updateChangeHistoryStatus(historyEntry.id, "revertido", message);
      toast.error(
        `Cronograma revertido: ${issueKey} - ${historyEntry.activityName}`,
      );

      info.revert();

      setViewData((v) => {
        const restored = v.calendarioIssues.map((iss) => {
          const snap = prev.find((p) => p.key === iss.key);
          if (!snap) return iss;
          return { ...iss, atividades: snap.atividades };
        });
        return { ...v, calendarioIssues: restored };
      });
    } finally {
      setPersisting(false);
    }
  }

  // =========================
  // GANTT: drag/resize → atualiza cronograma no Jira (customfield_14017)
  // Regras iguais ao calendário:
  // - otimista
  // - persist no Jira
  // - rollback e "return false" em erro (o Gantt desfaz automaticamente)
  // =========================
  const persistGanttDateChange = useCallback(
    async (payload) => {
      const updates = Array.isArray(payload) ? payload : [payload];

      const valid = updates
        .filter((t) => t && t.type === "task")
        .map((t) => {
          const id = String(t?.id || "");
          const parts = id.split("::");
          const fallbackIssueKey = String(parts?.[0] || "")
            .trim()
            .toUpperCase();
          const fallbackActivityId = String(parts?.[1] || "").trim();

          return {
            issueKey: String(t.issueKey || fallbackIssueKey || "")
              .trim()
              .toUpperCase(),
            activityId: String(t.activityId || fallbackActivityId || "").trim(),
            start: t.start instanceof Date ? t.start : new Date(t.start),
            end: t.end instanceof Date ? t.end : new Date(t.end),
            type: "task",
          };
        })

        .filter(
          (t) =>
            t.issueKey &&
            t.activityId &&
            t.start instanceof Date &&
            !Number.isNaN(t.start.getTime()) &&
            t.end instanceof Date &&
            !Number.isNaN(t.end.getTime()),
        );

      if (!valid.length) return false;

      // snapshot p/ rollback
      const prevSnapshot = (viewData.calendarioIssues || []).map((x) => ({
        ...x,
        atividades: (x.atividades || []).map((a) => ({ ...a })),
      }));

      // monta nextCalendarioIssues (em memória)
      const currentIssues = Array.isArray(viewData?.calendarioIssues)
        ? viewData.calendarioIssues
        : [];

      const nextCalendarioIssues = currentIssues.map((iss) => {
        const key = String(iss?.key || "")
          .trim()
          .toUpperCase();
        if (!key) return iss;

        const changes = valid.filter((u) => u.issueKey === key);
        if (!changes.length) return iss;

        let nextAtividades = Array.isArray(iss?.atividades)
          ? iss.atividades
          : [];

        for (const ch of changes) {
          nextAtividades = applyEventChangeToAtividades(
            nextAtividades,
            ch.activityId,
            ch.start,
            addDaysLocal(ch.end, 1),
          );
        }

        return { ...iss, atividades: nextAtividades };
      });
      const historyEntries = valid.map((change) => {
        const prevIssue = prevSnapshot.find(
          (issue) =>
            String(issue?.key || "")
              .trim()
              .toUpperCase() === change.issueKey,
        );
        const nextIssue = nextCalendarioIssues.find(
          (issue) =>
            String(issue?.key || "")
              .trim()
              .toUpperCase() === change.issueKey,
        );

        return makeHistoryEntry({
          source: "gantt",
          issueKey: change.issueKey,
          activityId: change.activityId,
          activityName: getActivityLabelFromIssue(
            nextIssue || prevIssue,
            change.activityId,
          ),
          previousRange: getActivityDateText(prevIssue, change.activityId),
          nextRange: getActivityDateText(nextIssue, change.activityId),
        });
      });
      historyEntries.forEach(addChangeHistory);

      // otimista: atualiza calendárioIssues + events (mantém calendário/Gantt coerentes)
      setViewData((prev) => {
        const nextEvents = (prev?.events || []).map((ev) => {
          const p = ev?.extendedProps || {};
          const issueKey = String(p.issueKey || ev?.issueKey || "")
            .trim()
            .toUpperCase();

          const activityId = String(p.activityId || "").trim();

          const found = valid.find(
            (u) => u.issueKey === issueKey && u.activityId === activityId,
          );

          if (!found) return ev;

          return {
            ...ev,
            start: found.start,
            end: addDaysLocal(found.end, 1) || found.end,
            extendedProps: { ...p },
          };
        });

        return {
          ...prev,
          calendarioIssues: nextCalendarioIssues,
          events: nextEvents,
        };
      });

      try {
        // agrupa por issueKey -> 1 update Jira por ticket
        const byIssue = new Map();
        for (const u of valid) {
          if (!byIssue.has(u.issueKey)) byIssue.set(u.issueKey, []);
          byIssue.get(u.issueKey).push(u);
        }

        for (const issueKey of byIssue.keys()) {
          const issue = nextCalendarioIssues.find(
            (x) =>
              String(x?.key || "")
                .trim()
                .toUpperCase() === issueKey,
          );
          if (!issue) continue;

          const adf = buildCronogramaADF(issue.atividades || []);

          await jiraEditIssue(issueKey, {
            fields: {
              customfield_14017: adf,
            },
          });
        }

        try {
          for (const issueKey of byIssue.keys()) {
            const issue = nextCalendarioIssues.find(
              (x) =>
                String(x?.key || "")
                  .trim()
                  .toUpperCase() === issueKey,
            );
            if (issue)
              applyCronogramaPatchLocal(issueKey, issue.atividades || []);
          }
        } catch (cacheErr) {
          console.warn("Falha ao atualizar cache local do cronograma.", cacheErr);
        }

        updateChangeHistoryStatus(
          historyEntries.map((entry) => entry.id),
          "salvo",
        );
        return true;
      } catch (e) {
        console.error(e);
        const message =
          e?.message || "Falha ao persistir no Jira. Revertendo...";
        setErr(message);
        updateChangeHistoryStatus(
          historyEntries.map((entry) => entry.id),
          "revertido",
          message,
        );

        const affected = Array.from(
          new Set(valid.map((item) => item.issueKey)),
        );
        toast.error(`Cronograma revertido: ${affected.join(", ")}`);

        // rollback local
        setViewData((v) => ({
          ...v,
          calendarioIssues: prevSnapshot,
        }));

        return false;
      }
    },
    [
      addChangeHistory,
      applyCronogramaPatchLocal,
      updateChangeHistoryStatus,
      viewData.calendarioIssues,
      viewData.events,
    ],
  );

  const persistGanttMetaChange = useCallback(
    async (issueKey, activityId, patch) => {
      const ik = String(issueKey || "")
        .trim()
        .toUpperCase();
      const aid = String(activityId || "").trim();
      if (!ik || !aid) return false;

      // normaliza patch
      const nextPatch = {};
      if (patch && "recurso" in patch) {
        nextPatch.recurso = String(patch.recurso || "").trim() || "Sem recurso";
      }
      if (patch && "area" in patch) {
        nextPatch.area = String(patch.area || "").trim() || "—";
      }
      if (patch && "risk" in patch) {
        nextPatch.risk = Boolean(patch.risk);
      }

      if (!Object.keys(nextPatch).length) return false;

      // snapshot p/ rollback
      const prevSnapshot = (viewData.calendarioIssues || []).map((x) => ({
        ...x,
        atividades: (x.atividades || []).map((a) => ({ ...a })),
      }));

      const prevEventsSnapshot = (viewData.events || []).map((e) => ({
        ...e,
        extendedProps: { ...(e?.extendedProps || {}) },
      }));

      // monta nextCalendarioIssues (em memória)
      const currentIssues = Array.isArray(viewData?.calendarioIssues)
        ? viewData.calendarioIssues
        : [];

      const nextCalendarioIssues = currentIssues.map((iss) => {
        const key = String(iss?.key || "")
          .trim()
          .toUpperCase();
        if (key !== ik) return iss;

        const nextAtividades = Array.isArray(iss?.atividades)
          ? iss.atividades.map((a) => {
              if (String(a?.id || "").trim() !== aid) return a;
              return { ...a, ...nextPatch };
            })
          : [];

        return { ...iss, atividades: nextAtividades };
      });

      // otimista: atualiza calendárioIssues (+ opcionalmente events meta)
      setViewData((prev) => {
        const nextEvents = (prev?.events || []).map((ev) => {
          const p = ev?.extendedProps || {};
          const evIssueKey = String(p.issueKey || ev?.issueKey || "")
            .trim()
            .toUpperCase();
          const evActivityId = String(p.activityId || "").trim();

          if (evIssueKey !== ik || evActivityId !== aid) return ev;

          return {
            ...ev,
            extendedProps: {
              ...p,
              ...nextPatch,
            },
          };
        });

        return {
          ...prev,
          calendarioIssues: nextCalendarioIssues,
          events: nextEvents,
        };
      });

      try {
        const issue = nextCalendarioIssues.find(
          (x) =>
            String(x?.key || "")
              .trim()
              .toUpperCase() === ik,
        );
        if (!issue) return false;

        const adf = buildCronogramaADF(issue.atividades || []);

        await jiraEditIssue(ik, {
          fields: {
            customfield_14017: adf,
          },
        });

        applyCronogramaPatchLocal(ik, issue.atividades || []);
        return true;
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Falha ao persistir no Jira. Revertendo...");

        // rollback local
        setViewData((v) => ({
          ...v,
          calendarioIssues: prevSnapshot,
          events: prevEventsSnapshot,
        }));

        return false;
      }
    },
    [applyCronogramaPatchLocal, viewData.calendarioIssues, viewData.events],
  );

  const reloadProgressText = formatReloadProgress(reloadProgress);
  const reloadButtonText =
    loading && reloadProgress.total
      ? `Atualizando ${reloadProgress.loaded}/${reloadProgress.total}`
      : loading
        ? "Buscando tickets..."
        : "Atualizar";

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-zinc-50">
        {/* Header fixo */}
        <header className="sticky top-0 z-40 border-b bg-white/75 backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <div className="mx-auto max-w-7xl px-4 py-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-red-600 to-red-700 text-white shadow-sm">
                  <ListChecks className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
                    {personalMode ? "Minha Carteira" : "Painel"}
                  </h1>
                  {personalMode ? (
                    <p className="text-xs text-zinc-500">
                      {currentUser?.jiraDisplayName ||
                        "Tickets filtrados pelo seu usuario Jira"}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Navegação Tickets / Calendário + Reload */}
              <div className="flex flex-wrap items-center gap-2">
                {!personalMode ? (
                  <>
                <Button
                  type="button"
                  variant="outline"
                  className={topNavButtonClasses(subView === "acoes")}
                  onClick={() => setSubView("acoes")}
                  aria-pressed={subView === "acoes"}
                >
                  <ListChecks className="mr-2 h-4 w-4" />
                  Ações
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className={topNavButtonClasses(subView === "portfolio")}
                  onClick={() => setSubView("portfolio")}
                  aria-pressed={subView === "portfolio"}
                >
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  Portfólio
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className={topNavButtonClasses(subView === "calendario")}
                  onClick={() => setSubView("calendario")}
                  aria-pressed={subView === "calendario"}
                >
                  <CalendarDays className="mr-2 h-4 w-4" />
                  Calendário
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className={topNavButtonClasses(subView === "gantt")}
                  onClick={() => setSubView("gantt")}
                  aria-pressed={subView === "gantt"}
                >
                  <Clock className="mr-2 h-4 w-4" />
                  Gantt
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className={topNavButtonClasses(subView === "dashboard")}
                  onClick={() => setSubView("dashboard")}
                  aria-pressed={subView === "dashboard"}
                >
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  Dashboard
                </Button>
                  </>
                ) : null}

                {!personalMode && subView === "acoes" ? (
                  <Button
                    type="button"
                    onClick={() => setCreateIssueOpen(true)}
                    className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Criar ticket no Jira
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  onClick={exportExecutiveReport}
                  disabled={loading}
                  className="rounded-xl border-zinc-200 bg-white text-zinc-900 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Exportação executiva
                </Button>

                <Button
                  onClick={reload}
                  disabled={loading}
                  className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                >
                  <RefreshCcw
                    className={cn("mr-2 h-4 w-4", loading && "animate-spin")}
                  />
                  {reloadButtonText}
                </Button>

                {loading && reloadProgressText ? (
                  <span className="w-full text-xs font-medium text-zinc-500 md:w-auto">
                    {reloadProgressText}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-4">
          {err && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {err}
            </div>
          )}

          {!personalMode ? (
          <div className="mb-4">
            <POPresetBar
              activePreset={activePreset}
              setActivePreset={setActivePreset}
              presetCounts={poInsights?.presetCounts}
              ownerFocus={ownerFocus}
              setOwnerFocus={setOwnerFocus}
              showMinePreset={false}
            />
          </div>
          ) : null}

          {personalMode && !ownerAccountId ? (
            <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm">
              <CardContent className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-base text-amber-950">
                    Configure seu usuario Jira
                  </CardTitle>
                  <CardDescription className="mt-1 text-amber-900">
                    Minha Carteira usa o accountId do Jira para encontrar seus
                    tickets com precisao.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  className="rounded-xl bg-red-600 text-white hover:bg-red-700"
                  onClick={onConfigureUser}
                >
                  Abrir Configuracoes
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {personalMode && ownerAccountId ? (
            <section className="grid gap-4">
              <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
                <CardContent className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 px-1">
                    <div className="text-sm font-semibold text-zinc-900">
                      Minha Carteira
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      {currentUser?.jiraDisplayName || effectiveOwnerFocus}
                    </div>
                  </div>

                  <div className="inline-flex w-full rounded-2xl bg-zinc-100 p-1 md:w-auto">
                    <button
                      type="button"
                      className={cn(
                        "flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition md:flex-none",
                        personalSubView === "queue"
                          ? "bg-white text-zinc-950 shadow-sm"
                          : "text-zinc-600 hover:text-zinc-950",
                      )}
                      onClick={() => setPersonalSubView("queue")}
                    >
                      Minha Fila
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition md:flex-none",
                        personalSubView === "summary"
                          ? "bg-white text-zinc-950 shadow-sm"
                          : "text-zinc-600 hover:text-zinc-950",
                      )}
                      onClick={() => setPersonalSubView("summary")}
                    >
                      Resumo
                    </button>
                  </div>
                </CardContent>
              </Card>

              {personalSubView === "queue" ? (
                <PersonalQueueView
                  rows={scopedRawIssues}
                  loading={loading}
                  movingKeys={movingPersonalKeys}
                  onOpenDetails={(key) => {
                    setDetailsKey(key);
                    setDetailsOpen(true);
                  }}
                  onMoveStatus={movePersonalTicketStatus}
                />
              ) : (
                <PersonalPortfolioView
                  insights={poInsights}
                  rows={scopedRawIssues}
                  doneRows={scopedDoneRows}
                  loading={loading}
                  jiraUserName={
                    currentUser?.jiraDisplayName || effectiveOwnerFocus
                  }
                  onOpenDetails={(key) => {
                    setDetailsKey(key);
                    setDetailsOpen(true);
                  }}
                  onOpenSchedule={(ticket) => openEditor(ticket?.raw || ticket)}
                  onOpenDocumentation={(ticket) =>
                    openDocumentationOrganizer(ticket?.raw || ticket)
                  }
                  onResolveProblem={openResolutionProblem}
                />
              )}
            </section>
          ) : null}

          {/* =========================
            AÇÕES DO P.O
        ========================= */}
          {!personalMode && subView === "acoes" && (
            <div className="grid gap-4">
              <POActionsHub
                insights={poInsights}
                onOpenDetails={(key) => {
                  setDetailsKey(key);
                  setDetailsOpen(true);
                }}
                onOpenSchedule={(ticket) => openEditor(ticket)}
                onOpenDocumentation={(ticket) =>
                  openDocumentationOrganizer(ticket?.raw || ticket)
                }
                onResolveProblem={openResolutionProblem}
              />

              <TicketDashboardPage
                rows={scopedRawIssues || []}
                alertas={scopedAlertas || []}
                missingSchedule={scopedCriarCronograma || []}
                ticketMetaMap={ticketMetaMap}
                loading={loading}
                dashTab={dashTab}
                setDashTab={setDashTab}
                searchText={searchText}
                setSearchText={setSearchText}
                selectedStatuses={selectedStatuses}
                setSelectedStatuses={setSelectedStatuses}
                selectedAssignees={selectedAssignees}
                setSelectedAssignees={setSelectedAssignees}
                selectedTypes={selectedTypes}
                setSelectedTypes={setSelectedTypes}
                sortBy={sortBy}
                setSortBy={setSortBy}
                onStart={(t) => openStartModal(t)}
                onOpenDetails={(key) => {
                  setDetailsKey(key);
                  setDetailsOpen(true);
                }}
                onOpenSchedule={(t) => openEditor(t)}
                onOpenDocumentation={(t) => openDocumentationOrganizer(t)}
              />
            </div>
          )}

          {!personalMode && subView === "portfolio" && (
            <section className="grid gap-3">
              <POPortfolioHub
                insights={poInsights}
                onOpenDetails={(key) => {
                  setDetailsKey(key);
                  setDetailsOpen(true);
                }}
              />
            </section>
          )}

          {/* =========================
            CALENDÁRIO (3 modos + filtro)
        ========================= */}
          {!personalMode && subView === "calendario" && (
            <AMCalendarTab
              viewData={scopedViewData}
              busy={busy}
              colorMode={colorMode}
              setColorMode={setColorMode}
              calendarFilter={calendarFilter}
              setCalendarFilter={setCalendarFilter}
              onPersistEventChange={persistEventChange}
              changeHistory={changeHistory}
              calendarSettings={effectiveCalendarSettings}
            />
          )}

          {/* =========================
             GANTT (gantt-task-react)
         ========================= */}
          {!personalMode && subView === "gantt" && (
            <section className="grid gap-3">
              <GanttTab
                loading={loading}
                viewData={scopedViewData}
                colorMode={colorMode}
                setColorMode={setColorMode}
                filterText={calendarFilter}
                setFilterText={setCalendarFilter}
                onPersistDateChange={persistGanttDateChange}
                onPersistMetaChange={persistGanttMetaChange}
                changeHistory={changeHistory}
                calendarSettings={effectiveCalendarSettings}
                onOpenDetails={(key) => {
                  setDetailsKey(key);
                  setDetailsOpen(true);
                }}
              />
            </section>
          )}

          {/* =========================
            DASHBOARD (React-Grid-Layout + Recharts)
           ========================= */}
          {!personalMode && subView === "dashboard" && (
            <section className="grid gap-3">
              <AMDashboardTab
                rows={scopedRawIssues}
                doneRows={scopedDoneRows}
                loading={loading}
              />
            </section>
          )}

          {/* Modais */}
          <CreateJiraIssueDialog
            open={createIssueOpen}
            onOpenChange={setCreateIssueOpen}
            onCreated={async (issueKey) => {
              const key = String(issueKey || "")
                .trim()
                .toUpperCase();
              if (!key) return;
              try {
                await refreshIssueInPanel(key);
              } catch {
                await reload();
              }
              setDetailsKey(key);
              setDetailsOpen(true);
            }}
          />

          {editorOpen && (
            <CronogramaEditorModal
              issue={editorIssue}
              draft={draft}
              setDraft={setDraft}
              onClose={closeEditor}
              onSave={saveEditor}
              loading={loading}
              dueDateDraft={dueDateDraft}
              setDueDateDraft={setDueDateDraft}
              calendarSettings={effectiveCalendarSettings}
            />
          )}

          {documentationOpen && (
            <DocumentationOrganizerModal
              ticket={documentationTicket}
              onClose={closeDocumentationOrganizer}
              onExported={async (issueKey) => {
                await setDocumentationFolderFlag(issueKey, true);
                closeDocumentationOrganizer();
              }}
            />
          )}

          {startOpen && (
            <StartTicketModal
              issueKey={startIssueKey}
              issue={startIssue}
              loading={startLoading}
              err={startErr}
              statusOptions={STATUS_OPTIONS}
              selectedStatus={selectedStatus}
              setSelectedStatus={setSelectedStatus}
              onClose={closeStartModal}
              onApplyStatus={applyStatusOnly}
              onStart={startTicket}
            />
          )}

          {resolutionOpen && (
            <ResolutionActionDialog
              ticket={resolutionTicket}
              problem={resolutionProblem}
              comment={resolutionComment}
              setComment={setResolutionComment}
              dueDate={resolutionDueDate}
              setDueDate={setResolutionDueDate}
              saving={resolutionSaving}
              err={resolutionErr}
              onClose={closeResolutionDialog}
              onSave={saveResolutionDialog}
              onOpenDetails={() => {
                const key = String(
                  resolutionTicket?.key || resolutionProblem?.key || "",
                )
                  .trim()
                  .toUpperCase();
                if (!key) return;
                setDetailsKey(key);
                setDetailsOpen(true);
              }}
            />
          )}

          {/* NOVO: Detalhes (Dialog shadcn) */}
          <TicketDetailsDialog
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            issueKey={detailsKey}
            ticketMetaMap={ticketMetaMap}
            statusOptions={STATUS_OPTIONS}
            priorityOptions={PRIORITY_OPTIONS}
            onChangeStatus={updateTicketStatus}
            onChangePriority={updateTicketPriority}
            onDocumentationFlagChange={setDocumentationFolderFlag}
            onOpenDocumentation={(ticket) => openDocumentationOrganizer(ticket)}
            onMarkedStarted={async () => {
              // cria comentário [INICIADO] sem mudar status
              if (!detailsKey) return;
              await createComment(detailsKey, adfFromPlainText("[INICIADO]"));
              await reload();
            }}
          />
        </main>
      </div>
    </TooltipProvider>
  );
}

function ResolutionActionDialog({
  ticket,
  problem,
  comment,
  setComment,
  dueDate,
  setDueDate,
  saving,
  err,
  onClose,
  onSave,
  onOpenDetails,
}) {
  const issueKey = String(ticket?.key || problem?.key || "")
    .trim()
    .toUpperCase();
  const isOverdue = problem?.type === "overdue";
  const isCapacity = problem?.type === "capacityConflict";

  const defaultComment =
    problem?.type === "risk"
      ? "Mitigacao proposta: "
      : problem?.type === "noRecentUpdate"
        ? "Atualizacao de status: "
        : problem?.type === "dueSoon"
          ? "Acompanhamento do vencimento: "
          : problem?.type === "overdue"
            ? "Plano de recuperacao: "
            : "";

  useEffect(() => {
    if (!problem?.type) return;
    setComment?.(defaultComment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem?.type, issueKey]);

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl rounded-2xl sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2">
            <code className="shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-800">
              {issueKey}
            </code>
            <span className="min-w-0 text-base text-zinc-900">
              Resolver alerta: {problem?.label || "Alerta"}
            </span>
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            {ticket?.summary || problem?.summary || "Ticket selecionado"}
          </DialogDescription>
        </DialogHeader>

        {err ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        ) : null}

        <div className="grid gap-3">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Motivo
            </div>
            <div className="mt-1 text-sm text-zinc-800">
              {problem?.reason || "Alerta operacional mapeado."}
            </div>
            <div className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Acao recomendada
            </div>
            <div className="mt-1 text-sm font-medium text-zinc-900">
              {problem?.recommendedAction || "Registrar acao e acompanhar o ticket."}
            </div>
          </div>

          {isOverdue ? (
            <div className="grid gap-2">
              <label className="text-xs font-semibold text-zinc-700">
                Nova data limite
              </label>
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate?.(event.target.value)}
                className="rounded-xl border-zinc-200 bg-white"
              />
            </div>
          ) : null}

          {isCapacity ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              A correcao do conflito de recurso deve ser feita ajustando datas ou
              recurso no Gantt/cronograma. O botao abaixo leva o ticket para a
              visao de Gantt filtrada.
            </div>
          ) : (
            <div className="grid gap-2">
              <label className="text-xs font-semibold text-zinc-700">
                Comentario / plano de acao
              </label>
              <Textarea
                value={comment}
                onChange={(event) => setComment?.(event.target.value)}
                rows={5}
                className="rounded-xl border-zinc-200 bg-white"
                placeholder="Descreva a acao tomada, impedimento ou plano de recuperacao."
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl border-zinc-200 bg-white"
            onClick={onOpenDetails}
          >
            Abrir detalhes
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-zinc-200 bg-white"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="rounded-xl bg-red-600 text-white hover:bg-red-700"
              onClick={onSave}
              disabled={saving || !issueKey}
            >
              {saving
                ? "Salvando..."
                : isCapacity
                  ? "Ir para Gantt"
                  : "Registrar resolucao"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* =========================
   TICKETS DASHBOARD
========================= */
function TicketDashboardPage({
  rows,
  alertas,
  missingSchedule,
  ticketMetaMap,
  loading,
  dashTab,
  setDashTab,
  searchText,
  setSearchText,
  selectedStatuses,
  setSelectedStatuses,
  selectedAssignees,
  setSelectedAssignees,
  selectedTypes,
  setSelectedTypes,
  sortBy,
  setSortBy,
  onStart,
  onOpenDetails,
  onOpenSchedule,
  onOpenDocumentation,
}) {
  // normaliza datasets
  const missingSet = useMemo(() => {
    const s = new Set();
    (missingSchedule || []).forEach((t) => s.add(t.key));
    return s;
  }, [missingSchedule]);

  const allRows = useMemo(() => {
    const merged = [...(rows || [])];
    const byKey = new Map();
    merged.forEach((t) => byKey.set(t.key, t));

    (alertas || []).forEach((t) =>
      byKey.set(t.key, { ...byKey.get(t.key), ...t }),
    );

    (missingSchedule || []).forEach((t) =>
      byKey.set(t.key, { ...byKey.get(t.key), ...t }),
    );

    return Array.from(byKey.values()).map((t) => ({
      ...t,
      statusName: getTicketStatusName(t) || t?.statusName || "—",
    }));
  }, [rows, alertas, missingSchedule]);

  const statusCounts = useMemo(() => {
    const m = new Map();

    for (const t of allRows) {
      const s = getTicketStatusName(t) || "—";
      m.set(s, (m.get(s) || 0) + 1);
    }

    // ✅ garante que "EM PLANEJAMENTO" apareça no topo (se existir)
    const pinned = ["EM PLANEJAMENTO"];
    const pinnedEntries = pinned
      .map((k) => [k, m.get(k) || 0])
      .filter(([, n]) => n > 0);

    const rest = Array.from(m.entries())
      .filter(([k]) => !pinned.includes(k))
      .sort((a, b) => b[1] - a[1]);

    return [...pinnedEntries, ...rest];
  }, [allRows]);

  const allStatuses = useMemo(() => {
    const set = new Set(
      allRows.map((t) => getTicketStatusName(t)).filter(Boolean),
    );

    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, [allRows]);

  const allAssignees = useMemo(() => {
    const set = new Set(
      allRows.map((t) =>
        t?.assignee && t.assignee !== "—" ? t.assignee : "Sem responsável",
      ),
    );
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, [allRows]);

  const filtered = useMemo(() => {
    const q = String(searchText || "")
      .trim()
      .toLowerCase();

    const passText = (t) => {
      if (!q) return true;
      const hay = `${t.key || ""} ${t.summary || ""} ${t.assignee || ""} ${
        t.statusName || ""
      }`.toLowerCase();
      return hay.includes(q);
    };

    const passStatus = (t) => {
      if (!selectedStatuses.length) return true;
      const st = getTicketStatusName(t) || "—";
      return selectedStatuses.includes(st);
    };

    const assigneeNorm = (t) =>
      t?.assignee && t.assignee !== "—" ? t.assignee : "Sem responsável";

    const passAssignee = (t) =>
      !selectedAssignees.length || selectedAssignees.includes(assigneeNorm(t));

    const passType = (t) => {
      if (!selectedTypes.length) return true;
      const typ = String(t?.issueType || t?.type || "").toLowerCase();
      const isSub = /(sub|subtarefa)/i.test(typ);
      const isStory = /(story|história|historia)/i.test(typ);
      return selectedTypes.some((x) =>
        x === "Subtarefa" ? isSub : x === "História" ? isStory : true,
      );
    };

    let out = allRows.filter(
      (t) => passText(t) && passStatus(t) && passAssignee(t) && passType(t),
    );

    out.sort((a, b) => {
      const da = new Date(a?.updatedRaw || a?.updated || 0).getTime();
      const db = new Date(b?.updatedRaw || b?.updated || 0).getTime();
      return sortBy === "updatedAsc" ? da - db : db - da;
    });

    return out;
  }, [
    allRows,
    searchText,
    selectedStatuses,
    selectedAssignees,
    selectedTypes,
    sortBy,
  ]);

  const alertasRows = useMemo(() => alertas || [], [alertas]);
  const levantamentoRows = useMemo(
    () => filtered.filter((t) => isLevantamentoStatus(getTicketStatusName(t))),
    [filtered],
  );

  const andamentoRows = useMemo(() => {
    const alertSet = new Set((alertas || []).map((t) => t.key));

    // ✅ Lista/regex de status que entram em "Em andamento"
    const andamentoRe =
      /(EM PLANEJAMENTO|PLANEJAMENTO|PARA DEV|DESENV|PARA HOMOLOG|HOMOLOG|PARA DEPLOY)/i;

    return filtered.filter((t) => {
      if (alertSet.has(t.key)) return false;

      const status = getTicketStatusName(t);
      const s = String(status || "").toUpperCase();

      // tira concluídos
      if (/(DONE|CONCLU|RESOLV|CLOSED|FECHAD)/i.test(s)) return false;

      // ✅ aqui entra EM PLANEJAMENTO
      return andamentoRe.test(s);
    });
  }, [filtered, alertas]);

  const todosRows = filtered;

  const sectionRows =
    dashTab === "alertas"
      ? alertasRows
      : dashTab === "levantamento"
        ? levantamentoRows
        : dashTab === "andamento"
          ? andamentoRows
          : todosRows;

  return (
    <div className="grid gap-4">
      {/* Subheader: contagem por status + busca + filtros */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-zinc-900">Resumo</div>
            <div className="flex flex-wrap gap-2">
              {statusCounts.slice(0, 8).map(([s, n]) => (
                <Badge
                  key={s}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs",
                    "border-zinc-200 bg-zinc-50 text-zinc-700",
                  )}
                >
                  {s}: {n}
                </Badge>
              ))}
              {statusCounts.length > 8 && (
                <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                  +{statusCounts.length - 8} status
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-[360px]">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Buscar por chave, título, responsável..."
                className="h-10 rounded-xl border-zinc-200 bg-white pl-9 focus-visible:ring-red-500"
              />
            </div>

            <TicketFiltersBar
              allStatuses={allStatuses}
              allAssignees={allAssignees}
              selectedStatuses={selectedStatuses}
              setSelectedStatuses={setSelectedStatuses}
              selectedAssignees={selectedAssignees}
              setSelectedAssignees={setSelectedAssignees}
              selectedTypes={selectedTypes}
              setSelectedTypes={setSelectedTypes}
              sortBy={sortBy}
              setSortBy={setSortBy}
            />
          </div>
        </div>

        <Separator className="my-4" />

        <Tabs value={dashTab} onValueChange={setDashTab}>
          <TabsList className="rounded-xl bg-zinc-100 p-1">
            <TabsTrigger
              value="alertas"
              className="
                rounded-lg text-zinc-700 hover:bg-white/60
                data-[state=active]:bg-green-600 data-[state=active]:text-white data-[state=active]:shadow-sm
      "
            >
              <AlertTriangle className="mr-2 h-4 w-4 text-red-600 data-[state=active]:text-white" />
              Alertas
              <Badge className="ml-2 rounded-full bg-red-600 text-white">
                {alertasRows.length}
              </Badge>
            </TabsTrigger>

            <TabsTrigger
              value="levantamento"
              className="
                rounded-lg text-zinc-700 hover:bg-white/60
                data-[state=active]:bg-green-600 data-[state=active]:text-white data-[state=active]:shadow-sm
      "
            >
              Levantamento
              <Badge className="ml-2 rounded-full bg-zinc-900 text-white data-[state=active]:bg-white data-[state=active]:text-green-700">
                {levantamentoRows.length}
              </Badge>
            </TabsTrigger>

            <TabsTrigger
              value="andamento"
              className="
                rounded-lg text-zinc-700 hover:bg-white/60
                data-[state=active]:bg-green-600 data-[state=active]:text-white data-[state=active]:shadow-sm
      "
            >
              Em andamento
              <Badge className="ml-2 rounded-full bg-zinc-900 text-white data-[state=active]:bg-white data-[state=active]:text-green-700">
                {andamentoRows.length}
              </Badge>
            </TabsTrigger>

            <TabsTrigger
              value="todos"
              className="
                rounded-lg text-zinc-700 hover:bg-white/60
                data-[state=active]:bg-green-600 data-[state=active]:text-white data-[state=active]:shadow-sm
      "
            >
              Todos
              <Badge className="ml-2 rounded-full bg-zinc-900 text-white data-[state=active]:bg-white data-[state=active]:text-green-700">
                {todosRows.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value={dashTab} className="mt-4">
            <TicketSection
              title={
                dashTab === "alertas"
                  ? "Novos (PRE SAVE sem [INICIADO])"
                  : dashTab === "levantamento"
                    ? "Levantamento de requisitos"
                    : dashTab === "andamento"
                      ? "Em andamento"
                      : "Todos os tickets"
              }
              subtitle={
                dashTab === "alertas"
                  ? "Atenção: itens em PRE SAVE ainda não iniciados."
                  : dashTab === "levantamento"
                    ? "Backlog, Refinamento, Artefatos e Para Planejar: organize requisitos, atividades, artefatos e envolvidos."
                    : dashTab === "andamento"
                      ? "Fluxo do PO: Em Planejamento → Para Dev → Desenvolvimento → Homolog → Deploy."
                      : "Visão completa com busca, filtros e ordenação."
              }
              rows={sectionRows}
              ticketMetaMap={ticketMetaMap}
              missingScheduleSet={missingSet}
              loading={loading}
              onStart={onStart}
              onOpenDetails={onOpenDetails}
              onOpenSchedule={onOpenSchedule}
              onOpenDocumentation={onOpenDocumentation}
              emptyText="Nenhum ticket encontrado com os filtros atuais."
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function TicketFiltersBar({
  allStatuses,
  allAssignees,
  selectedStatuses,
  setSelectedStatuses,
  selectedAssignees,
  setSelectedAssignees,
  selectedTypes,
  setSelectedTypes,
  sortBy,
  setSortBy,
}) {
  const toggle = (arr, v, setArr) => {
    setArr((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Status */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="rounded-xl border-zinc-200 bg-white"
          >
            <Filter className="mr-2 h-4 w-4" />
            Status
            {selectedStatuses.length ? (
              <Badge className="ml-2 rounded-full bg-zinc-900 text-white">
                {selectedStatuses.length}
              </Badge>
            ) : null}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-64">
          <DropdownMenuLabel>Status</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {allStatuses.map((s) => (
            <DropdownMenuCheckboxItem
              key={s}
              checked={selectedStatuses.includes(s)}
              onCheckedChange={() =>
                toggle(selectedStatuses, s, setSelectedStatuses)
              }
            >
              {s}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => setSelectedStatuses([])}
          >
            Limpar
          </Button>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Responsável */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="rounded-xl border-zinc-200 bg-white"
          >
            <Filter className="mr-2 h-4 w-4" />
            Responsável
            {selectedAssignees.length ? (
              <Badge className="ml-2 rounded-full bg-zinc-900 text-white">
                {selectedAssignees.length}
              </Badge>
            ) : null}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-72">
          <DropdownMenuLabel>Responsável</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {allAssignees.map((a) => (
            <DropdownMenuCheckboxItem
              key={a}
              checked={selectedAssignees.includes(a)}
              onCheckedChange={() =>
                toggle(selectedAssignees, a, setSelectedAssignees)
              }
            >
              {a}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => setSelectedAssignees([])}
          >
            Limpar
          </Button>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Tipo */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="rounded-xl border-zinc-200 bg-white"
          >
            <Filter className="mr-2 h-4 w-4" />
            Tipo
            {selectedTypes.length ? (
              <Badge className="ml-2 rounded-full bg-zinc-900 text-white">
                {selectedTypes.length}
              </Badge>
            ) : null}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>Tipo</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {["História", "Subtarefa"].map((t) => (
            <DropdownMenuCheckboxItem
              key={t}
              checked={selectedTypes.includes(t)}
              onCheckedChange={() => toggle(selectedTypes, t, setSelectedTypes)}
            >
              {t}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => setSelectedTypes([])}
          >
            Limpar
          </Button>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Ordenação */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="rounded-xl border-zinc-200 bg-white"
          >
            <ArrowUpDown className="mr-2 h-4 w-4" />
            Ordenar
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>Ordenação</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={sortBy === "updatedDesc"}
            onCheckedChange={() => setSortBy("updatedDesc")}
          >
            Updated (mais recente)
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={sortBy === "updatedAsc"}
            onCheckedChange={() => setSortBy("updatedAsc")}
          >
            Updated (mais antigo)
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function TicketSection({
  title,
  subtitle,
  rows,
  ticketMetaMap,
  missingScheduleSet,
  loading,
  onStart,
  onOpenDetails,
  onOpenSchedule,
  onOpenDocumentation,
  emptyText,
}) {
  const safeRows = rows || [];
  const showSkeleton = loading && safeRows.length === 0;
  const overdueCount = useMemo(() => {
    const today0 = startOfTodayLocal();

    return safeRows.filter((t) => {
      // (opcional) não contar concluídos
      const status = String(getTicketStatusName(t) || "").toUpperCase();
      if (/(DONE|CONCLU|RESOLV|CLOSED|FECHAD)/i.test(status)) return false;

      // ✅ mesma regra do card: alt > base
      const dueAltYmd = extractYmd(
        t?.fields?.customfield_11519 || t?.customfield_11519,
      );

      const dueBaseYmd = extractYmd(
        t?.dueDateRaw || t?.fields?.duedate || t?.duedate,
      );

      const dueAltDate = parseIsoYmdLocal(dueAltYmd);
      const dueBaseDate = parseIsoYmdLocal(dueBaseYmd);

      const effectiveDueDate = dueAltDate || dueBaseDate;

      return (
        !!effectiveDueDate && effectiveDueDate.getTime() < today0.getTime()
      );
    }).length;
  }, [safeRows]);
  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          <p className="text-sm text-zinc-600">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Badge: sem cronograma */}
          {onOpenSchedule && missingScheduleSet?.size ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge className="rounded-full border border-amber-200 bg-amber-50 text-amber-800">
                  {missingScheduleSet.size} sem cronograma
                </Badge>
              </TooltipTrigger>
            </Tooltip>
          ) : null}

          {/* Badge: data limite estourada (customfield_11519 > duedate) */}
          {overdueCount ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge className="rounded-full border border-red-200 bg-red-50 text-red-700">
                  {overdueCount} estourados
                </Badge>
              </TooltipTrigger>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {/* Grid de cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {showSkeleton
          ? Array.from({ length: 8 }).map((_, i) => (
              <TicketCardSkeleton key={i} />
            ))
          : safeRows.map((t) => (
              <TicketCard
                key={t.key}
                ticket={t}
                meta={ticketMetaMap?.get?.(t.key)}
                isNew={String(t?.statusName || "").toUpperCase() === "PRE SAVE"}
                missingSchedule={missingScheduleSet?.has(t.key)}
                onStart={() => onStart?.(t)}
                onDetails={() => onOpenDetails?.(t.key)}
                onSchedule={() => onOpenSchedule?.(t)}
                onDocumentation={() => onOpenDocumentation?.(t)}
              />
            ))}
      </div>

      {!loading && safeRows.length === 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          {emptyText}
        </div>
      )}
    </div>
  );
}

/* =========================
   TICKET CARD
========================= */
const TicketCard = memo(function TicketCard({
  ticket,
  meta,
  isNew,
  missingSchedule,
  onStart,
  onDetails,
  onSchedule,
  onDocumentation,
}) {
  const key = ticket?.key || "—";
  const summary = ticket?.summary || "—";
  const status = getTicketStatusName(ticket) || "—";
  const assignee = truncateText(
    ticket?.assignee && ticket.assignee !== "—"
      ? ticket.assignee
      : "Sem responsável",
  );

  // ✅ created vem do retorno da API: fields.created
  const createdRaw =
    ticket?.createdRaw ||
    ticket?.created ||
    ticket?.fields?.created ||
    ticket?.fields?.Created;

  const updatedRaw = ticket?.updatedRaw || ticket?.updated;

  const started = ticketHasIniciadoTag(ticket);
  const canOrganizeDocumentation = Boolean(meta?.canOrganizeDocumentation);

  const created = fmtUpdatedBR(createdRaw);
  const updated = fmtUpdatedBR(updatedRaw);

  // ✅ idade do ticket em dias (ex: 1d)
  function calcAgeDays(isoDate) {
    if (!isoDate) return null;

    const d = isoDate instanceof Date ? isoDate : new Date(isoDate);
    if (Number.isNaN(d.getTime())) return null;

    const now = new Date();

    // zera horas para comparar "por dia"
    const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startCreated = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    const diffMs = startNow.getTime() - startCreated.getTime();
    const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    return `${days}d`;
  }

  const age = calcAgeDays(createdRaw);

  const f = ticket?.fields || {};

  const dueBaseYmd = extractYmd(
    ticket?.dueDateRaw || ticket?.fields?.duedate || ticket?.duedate,
  );

  const dueAltYmd = extractYmd(
    ticket?.fields?.customfield_11519 || ticket?.customfield_11519,
  );

  // ✅ só considera alt se parsear mesmo
  const dueAltDate = parseIsoYmdLocal(dueAltYmd);
  const dueBaseDate = parseIsoYmdLocal(dueBaseYmd);

  const hasDueAlt = Boolean(dueAltDate);

  // ✅ efetiva = alterada se válida, senão original
  const effectiveDueDate = dueAltDate || dueBaseDate;
  const effectiveDueYmd = dueAltDate ? dueAltYmd : dueBaseYmd;

  // comparação com "hoje" (início do dia)
  const today0 = startOfTodayLocal();

  const isDueOverdue =
    !!effectiveDueDate && effectiveDueDate.getTime() < today0.getTime();

  const daysLate = isDueOverdue
    ? Math.max(1, diffDays(today0, effectiveDueDate))
    : 0;
  const actionFlags = [
    !meta?.hasOwner ? "Sem responsável" : null,
    !meta?.hasStarted ? "Sem início" : null,
    meta?.hasRisk ? "Com risco" : null,
    meta?.hasCapacityConflict ? "Conflito de recurso" : null,
    !effectiveDueDate ? "Sem data limite" : null,
  ].filter(Boolean);

  return (
    <motion.div
      layout
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className="h-full"
    >
      <Card className="group flex h-full flex-col overflow-hidden rounded-2xl border-zinc-200 bg-white shadow-sm transition-all hover:shadow-md">
        {/* HEADER: Identificação e Status */}
        <CardHeader className="space-y-3 pb-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-600 border border-zinc-200/50">
                {key}
              </span>

              {isNew && (
                <Badge className="h-5 rounded-full bg-blue-600 text-[10px] font-medium hover:bg-blue-600">
                  Novo
                </Badge>
              )}

              {missingSchedule && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-amber-600 hover:text-amber-700 cursor-help"
                      aria-label="Sem cronograma"
                    >
                      <AlertCircle className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>

                  <TooltipContent
                    side="top"
                    align="center"
                    className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm"
                  >
                    <div className="grid gap-1.5">
                      {/* Linha principal */}
                      <div className="inline-flex items-center gap-2 font-semibold">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        Sem cronograma
                      </div>

                      {/* Mostra data limite original/alterada */}
                      {hasDueAlt ? (
                        <div className="text-[11px] font-medium text-amber-900">
                          Data limite alterada:{" "}
                          <span className="font-semibold">
                            {fmtDateBr(dueAltYmd) || "—"}
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11px] font-medium text-amber-900">
                          Data limite:{" "}
                          <span className="font-semibold">
                            {fmtDateBr(dueBaseYmd) || "—"}
                          </span>
                        </div>
                      )}

                      {/* Se tiver alterada, pode mostrar a original também (opcional) */}
                      {hasDueAlt && dueBaseYmd ? (
                        <div className="text-[10px] text-amber-800/80">
                          Original: {fmtDateBr(dueBaseYmd)}
                        </div>
                      ) : null}

                      {/* Alarme se estourou */}
                      {isDueOverdue ? (
                        <div className="mt-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">
                          <span className="inline-flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {hasDueAlt
                              ? "Data limite alterada estourou"
                              : "Data limite estourou"}
                            {daysLate ? ` • ${daysLate}d` : ""}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            <StatusBadge status={status} />
          </div>

          <div className="space-y-1">
            <CardTitle
              className="text-[15px] font-semibold leading-tight text-zinc-900 line-clamp-2 min-h-[40px]"
              title={summary}
            >
              {summary}
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Clock className="h-3 w-3" />
              Criado em {created}
            </CardDescription>
          </div>
        </CardHeader>

        {/* CONTENT: Responsável e Ações (flex-1 para empurrar o footer) */}
        <CardContent className="flex flex-1 flex-col gap-4">
          <div className="flex items-center gap-2.5 rounded-lg border border-zinc-100 bg-zinc-50/50 p-2">
            <Avatar className="h-8 w-8 border border-white shadow-sm">
              <AvatarFallback className="bg-zinc-200 text-[10px] font-medium text-zinc-600">
                {initials(assignee)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-zinc-800">
                {assignee}
              </p>
              <p className="text-[10px] text-zinc-500">Responsável</p>
            </div>
          </div>

          {actionFlags.length ? (
            <div className="flex flex-wrap gap-1.5">
              {actionFlags.slice(0, 4).map((flag) => (
                <Badge
                  key={`${key}-${flag}`}
                  className="rounded-full border border-zinc-200 bg-white text-[10px] text-zinc-700"
                >
                  {flag}
                </Badge>
              ))}
            </div>
          ) : null}

          {meta?.nextMilestone ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
              <span className="font-semibold text-zinc-900">
                Próximo marco:
              </span>{" "}
              {meta.nextMilestone.label}
            </div>
          ) : null}

          {/* Botões de Ação - Layout Estável */}
          <div className="grid grid-cols-2 gap-2 mt-auto">
            {!started && (
              <Button
                size="sm"
                onClick={onStart}
                className="rounded-lg bg-red-600 font-medium text-white hover:bg-red-700 transition-colors"
              >
                <Play className="mr-1.5 h-3.5 w-3.5 fill-current" />
                Iniciar
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={onDetails}
              className={cn(
                "rounded-lg border-zinc-200 text-zinc-700 hover:bg-zinc-50",
                started && "col-span-2", // ✅ se já iniciou, Detalhes ocupa a linha toda
              )}
            >
              Detalhes
            </Button>

            {missingSchedule && onSchedule && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onSchedule}
                className="col-span-2 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800"
              >
                Criar cronograma
              </Button>
            )}

            {canOrganizeDocumentation && onDocumentation && (
              <Button
                size="sm"
                variant="outline"
                onClick={onDocumentation}
                className="col-span-2 rounded-lg border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
              >
                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                Organizar Documentação
              </Button>
            )}
          </div>
        </CardContent>

        <Separator className="bg-zinc-100" />

        {/* FOOTER: Metadados fixos no rodapé */}
        <CardFooter className="flex items-center justify-between bg-zinc-50/30 py-3 text-[11px]">
          <div className="flex items-center gap-1.5 text-zinc-500">
            <History className="h-3 w-3" />
            <span>Atu. {updated}</span>
          </div>

          {age && (
            <span className="font-bold text-zinc-700 bg-zinc-200/50 px-2 py-0.5 rounded text-[10px]">
              {age}
            </span>
          )}
        </CardFooter>
      </Card>
    </motion.div>
  );
});

function StatusBadge({ status }) {
  const s = String(status || "").toUpperCase();

  let cls = "border border-zinc-200 bg-zinc-50 text-zinc-700";

  if (s === "PRE SAVE") cls = "bg-red-50 text-red-700 border-red-200";
  else if (/(PARA DEV|DEV)/i.test(s))
    cls = "bg-blue-50 text-blue-700 border-blue-200";
  else if (/(DESENV)/i.test(s))
    cls = "bg-violet-50 text-violet-700 border-violet-200";
  else if (/(HOMOLOG)/i.test(s))
    cls = "bg-indigo-50 text-indigo-700 border-indigo-200";
  else if (/(BLOQ|BLOCK)/i.test(s))
    cls = "bg-amber-50 text-amber-800 border-amber-200";
  else if (/(DONE|CONCLU|RESOLV|CLOSED)/i.test(s))
    cls = "bg-emerald-50 text-emerald-700 border-emerald-200";

  return (
    <Badge
      title={status || "—"}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-semibold",
        "max-w-[180px] truncate",
        cls,
      )}
    >
      {status || "—"}
    </Badge>
  );
}

function TicketCardSkeleton() {
  return (
    <Card className="h-full rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-24 rounded-md" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3 w-1/2" />
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-full" />
          <div className="grid gap-2">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-xl" />
          <Skeleton className="h-9 w-28 rounded-xl" />
        </div>
      </CardContent>
    </Card>
  );
}

function makeAttachmentTreeNode(attachment) {
  const id = String(attachment?.id || attachment?.filename || Math.random());
  return {
    id: `attachment-${id}`,
    name: attachment?.filename || "arquivo",
    kind: "file",
    attachment,
  };
}

function buildDocumentationTree(attachments = []) {
  return [
    {
      id: DOCUMENTATION_SOURCE_FOLDER_ID,
      name: "Anexos do ticket",
      kind: "folder",
      system: true,
      children: attachments.map(makeAttachmentTreeNode),
    },
    ...DOCUMENTATION_DEFAULT_FOLDERS.map((name) => ({
      id: `folder-${name}`,
      name,
      kind: "folder",
      children: [],
    })),
  ];
}

function findTreeNode(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    const child = findTreeNode(node.children || [], id);
    if (child) return child;
  }
  return null;
}

function removeTreeNodes(nodes, idSet, removed = []) {
  const next = [];
  for (const node of nodes || []) {
    if (idSet.has(node.id)) {
      removed.push(node);
      continue;
    }
    next.push({
      ...node,
      children: node.children
        ? removeTreeNodes(node.children, idSet, removed)
        : undefined,
    });
  }
  return next;
}

function insertTreeNodes(nodes, parentId, index, items) {
  return (nodes || []).map((node) => {
    if (node.id === parentId) {
      const children = [...(node.children || [])];
      children.splice(Math.max(0, index), 0, ...items);
      return { ...node, children };
    }
    return {
      ...node,
      children: node.children
        ? insertTreeNodes(node.children, parentId, index, items)
        : undefined,
    };
  });
}

function moveDocumentationTreeNodes(nodes, { dragIds, parentId, index }) {
  if (!parentId || !Array.isArray(dragIds) || !dragIds.length) return nodes;
  const dragged = dragIds.map((id) => findTreeNode(nodes, id)).filter(Boolean);
  if (!dragged.length || dragged.some((node) => node.kind === "folder")) {
    return nodes;
  }

  const parent = findTreeNode(nodes, parentId);
  if (!parent || parent.kind !== "folder") return nodes;

  const removed = [];
  const withoutDragged = removeTreeNodes(nodes, new Set(dragIds), removed);
  return insertTreeNodes(withoutDragged, parentId, index, removed);
}

function getExportableDocumentationFolders(nodes) {
  return (nodes || [])
    .filter(
      (node) =>
        node.kind === "folder" && node.id !== DOCUMENTATION_SOURCE_FOLDER_ID,
    )
    .map((folder) => ({
      folder,
      files: (folder.children || []).filter((child) => child.kind === "file"),
    }))
    .filter((entry) => entry.files.length > 0);
}

function uniqueZipFileName(used, rawName) {
  const safe = sanitizeFileName(rawName, "arquivo");
  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }
  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  let index = 2;
  while (used.has(`${base}-${index}${ext}`)) index += 1;
  const next = `${base}-${index}${ext}`;
  used.add(next);
  return next;
}

function DocumentationTreeNode({ node, style, dragHandle }) {
  const isFolder = node.data.kind === "folder";
  return (
    <div
      style={style}
      ref={dragHandle}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 text-sm",
        node.isSelected ? "bg-red-50 text-red-700" : "text-zinc-800",
      )}
      onClick={() => {
        if (isFolder) node.toggle();
      }}
    >
      {isFolder ? (
        <FolderOpen className="h-4 w-4 text-sky-600" />
      ) : (
        <FileText className="h-4 w-4 text-zinc-500" />
      )}
      <span className="truncate">{node.data.name}</span>
      {!isFolder && node.data.attachment?.size ? (
        <span className="ml-auto text-[11px] text-zinc-400">
          {Math.ceil(Number(node.data.attachment.size || 0) / 1024)} KB
        </span>
      ) : null}
    </div>
  );
}

function DocumentationOrganizerModal({ ticket, onClose, onExported }) {
  const ticketKey = String(ticket?.key || "")
    .trim()
    .toUpperCase();
  const summary = ticket?.summary || ticket?.fields?.summary || ticketKey;
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [treeData, setTreeData] = useState(() => buildDocumentationTree([]));
  const [newFolderName, setNewFolderName] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!ticketKey) return;
      setLoading(true);
      setErr("");
      try {
        const data = await listAttachments(ticketKey);
        const list = Array.isArray(data?.attachments) ? data.attachments : [];
        if (!alive) return;
        setAttachments(list);
        setTreeData(buildDocumentationTree(list));
      } catch (e) {
        if (alive) setErr(e?.message || "Falha ao carregar anexos.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [ticketKey]);

  const exportFolders = useMemo(
    () => getExportableDocumentationFolders(treeData),
    [treeData],
  );

  function addFolder() {
    const name = String(newFolderName || "").trim();
    if (!name) return;
    const id = `folder-custom-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    setTreeData((prev) => [
      ...prev,
      {
        id,
        name: sanitizeFileName(name, "Nova pasta"),
        kind: "folder",
        children: [],
      },
    ]);
    setNewFolderName("");
  }

  async function exportZip() {
    if (!ticketKey || !exportFolders.length) return;
    setExporting(true);
    setErr("");
    try {
      const zip = new JSZip();
      const rootName = sanitizeFileName(`${ticketKey} - ${summary}`, ticketKey);
      const root = zip.folder(rootName);

      for (const entry of exportFolders) {
        const folder = root.folder(
          sanitizeFileName(entry.folder.name, "pasta"),
        );
        const usedNames = new Set();
        for (const file of entry.files) {
          const attachment = file.attachment || {};
          const response = await fetch(attachment.downloadUrl);
          if (!response.ok) {
            throw new Error(
              `Falha ao baixar ${attachment.filename || file.name}.`,
            );
          }
          const blob = await response.blob();
          folder.file(
            uniqueZipFileName(usedNames, attachment.filename || file.name),
            blob,
          );
        }
      }

      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `${rootName}.zip`);
      await onExported?.(ticketKey);
      toast.success(
        "Documenta\u00e7\u00e3o exportada e pasta marcada como criada.",
      );
    } catch (e) {
      setErr(e?.message || "Falha ao exportar documenta\u00e7\u00e3o.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl rounded-2xl sm:w-full max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2">
            <code className="shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-800">
              {ticketKey || "Ticket"}
            </code>
            <span className="min-w-0 text-base leading-snug text-zinc-900">
              Organizar Documentação
            </span>
          </DialogTitle>
          <DialogDescription className="line-clamp-2 text-sm text-zinc-600">
            {summary || "Arraste os anexos para as pastas de trabalho do PO."}
          </DialogDescription>
        </DialogHeader>

        {err ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <div className="rounded-2xl border border-zinc-200 bg-white p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-zinc-900">
                  Anexos e pastas
                </div>
                <div className="text-xs text-zinc-500">
                  {attachments.length} anexo(s). Pastas vazias não entram no
                  ZIP.
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="Nova pasta"
                  className="h-9 w-44 rounded-xl"
                  disabled={loading || exporting}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl border-zinc-200 bg-white"
                  onClick={addFolder}
                  disabled={!newFolderName.trim() || loading || exporting}
                >
                  <FolderPlus className="mr-2 h-4 w-4" />
                  Criar
                </Button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
              {loading ? (
                <div className="grid gap-2 p-4">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-4/5" />
                  <Skeleton className="h-8 w-3/5" />
                </div>
              ) : (
                <Tree
                  data={treeData}
                  openByDefault
                  width="100%"
                  height={380}
                  indent={24}
                  rowHeight={34}
                  onMove={(args) =>
                    setTreeData((prev) =>
                      moveDocumentationTreeNodes(prev, args),
                    )
                  }
                >
                  {DocumentationTreeNode}
                </Tree>
              )}
            </div>
          </div>

          <div className="grid content-start gap-3 rounded-2xl border border-zinc-200 bg-white p-3">
            <div className="text-sm font-semibold text-zinc-900">
              Pronto para exportar
            </div>
            <div className="grid gap-2">
              {exportFolders.length ? (
                exportFolders.map((entry) => (
                  <div
                    key={entry.folder.id}
                    className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700"
                  >
                    <div className="font-semibold text-zinc-900">
                      {entry.folder.name}
                    </div>
                    <div>{entry.files.length} arquivo(s)</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                  Arraste pelo menos um anexo para uma pasta.
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl border-zinc-200 bg-white"
            onClick={onClose}
            disabled={exporting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="rounded-xl bg-red-600 text-white hover:bg-red-700"
            onClick={exportZip}
            disabled={loading || exporting || !exportFolders.length}
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {exporting ? "Exportando..." : "Exportar ZIP"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* =========================
   DETAILS DIALOG
========================= */
function TicketDetailsDialog({
  open,
  onOpenChange,
  issueKey,
  ticketMetaMap,
  statusOptions = [],
  priorityOptions = [],
  onChangeStatus,
  onChangePriority,
  onDocumentationFlagChange,
  onOpenDocumentation,
  onMarkedStarted,
}) {
  const [loading, setLoading] = useState(false);
  const [issue, setIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [err, setErr] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [savingFolderFlag, setSavingFolderFlag] = useState(false);

  useEffect(() => {
    if (!open || !issueKey) return;

    let alive = true;
    setLoading(true);
    setErr("");
    setIssue(null);
    setComments([]);

    Promise.allSettled([
      getIssue(
        issueKey,
        "summary,status,assignee,created,updated,project,description,duedate,customfield_11519,customfield_14017,components,customfield_11520,priority,labels,attachment",
      ),
      getComments(issueKey),
    ])
      .then((res) => {
        if (!alive) return;
        const [a, b] = res;

        if (a.status === "fulfilled") {
          const data = a.value;
          const normalized = data?.fields ? data : { fields: data }; // ✅ FIX
          setIssue(normalized);
        } else {
          setErr(a.reason?.message || String(a.reason));
        }

        if (b.status === "fulfilled") {
          const list = b.value?.comments || b.value?.values || b.value || [];
          setComments(Array.isArray(list) ? list : []);
        }
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [open, issueKey]);

  const f = issue?.fields || {};

  useEffect(() => {
    if (!issue?.fields) return;
    setStatusDraft(issue.fields.status?.name || "");
    setPriorityDraft(toPriorityOptionName(issue.fields.priority?.name || ""));
  }, [issueKey, issue]);

  function getFirstDescriptionText(descriptionAdf) {
    try {
      const t = descriptionAdf?.content?.[0]?.content?.[0]?.text;
      return typeof t === "string" ? t.trim() : "";
    } catch {
      return "";
    }
  }

  const descText =
    getFirstDescriptionText(f?.description) || safeText(f?.description) || "—";

  const infoAdicText = safeText(f?.customfield_14017) || "—";

  const hasCronograma = Boolean(
    String(infoAdicText || "")
      .trim()
      .replace(/^—$/, ""),
  );

  const jiraBrowseUrl = useMemo(
    () => getJiraBrowseUrl(issueKey, issue),
    [issueKey, issue],
  );

  const assigneeFull = userName(f?.assignee) || "Sem responsável";
  const meta = ticketMetaMap?.get?.(
    String(issueKey || "")
      .trim()
      .toUpperCase(),
  );
  const folderCreated = hasDocumentationFolderLabel(issue);
  const isBacklog = isBacklogStatus(f?.status?.name);
  const canOrganizeDocumentation =
    isBacklog && ticketHasIniciadoTag(meta || issue) && !folderCreated;
  const attachmentsCount = Array.isArray(f?.attachment)
    ? f.attachment.length
    : Number(meta?.attachmentCount || 0);
  const cronogramaActivities = useMemo(
    () => parseCronogramaADF(f?.customfield_14017),
    [f?.customfield_14017],
  );
  const allocatedResources = useMemo(
    () =>
      Array.from(
        new Set(
          cronogramaActivities
            .map((activity) => String(activity?.recurso || "").trim())
            .filter(Boolean),
        ),
      ),
    [cronogramaActivities],
  );
  const riskActivities = useMemo(
    () =>
      cronogramaActivities.filter(
        (activity) =>
          Boolean(activity?.risk) ||
          /risco/i.test(String(activity?.risco || "").trim()),
      ),
    [cronogramaActivities],
  );
  const directorateLabels = useMemo(
    () => toNamesArray(f?.customfield_11520),
    [f?.customfield_11520],
  );
  const componentLabels = useMemo(
    () =>
      Array.isArray(f?.components)
        ? f.components
            .map((component) => component?.name || component)
            .map((value) => String(value || "").trim())
            .filter(Boolean)
        : [],
    [f?.components],
  );
  const latestComment = comments?.length ? comments[comments.length - 1] : null;
  const latestCommentText =
    safeText(latestComment?.body) || "Sem avanço recente";
  const latestCommentDate = latestComment
    ? fmtUpdatedBR(latestComment?.created || latestComment?.updated)
    : "Sem comentários";
  const dueLabel = meta?.overdueDays
    ? `Atrasado ${meta.overdueDays}d`
    : f?.duedate
      ? fmtDateBr(f?.duedate)
      : "Sem data limite";

  async function applyDetailsStatus() {
    if (!issueKey || !statusDraft || statusDraft === f?.status?.name) return;
    setSavingStatus(true);
    setErr("");
    try {
      await onChangeStatus?.(issueKey, statusDraft);
      setIssue((prev) =>
        prev
          ? {
              ...prev,
              fields: {
                ...(prev.fields || {}),
                status: { ...(prev.fields?.status || {}), name: statusDraft },
              },
            }
          : prev,
      );
    } catch (e) {
      setErr(e?.message || "Falha ao alterar status.");
    } finally {
      setSavingStatus(false);
    }
  }

  async function applyDetailsPriority() {
    if (
      !issueKey ||
      !priorityDraft ||
      normalizePlain(priorityDraft) === normalizePlain(f?.priority?.name)
    ) {
      return;
    }
    setSavingPriority(true);
    setErr("");
    try {
      await onChangePriority?.(issueKey, priorityDraft);
      setIssue((prev) =>
        prev
          ? {
              ...prev,
              fields: {
                ...(prev.fields || {}),
                priority: {
                  ...(prev.fields?.priority || {}),
                  name: priorityDraft,
                },
              },
            }
          : prev,
      );
    } catch (e) {
      setErr(e?.message || "Falha ao alterar prioridade.");
    } finally {
      setSavingPriority(false);
    }
  }

  async function toggleDocumentationFolderFlag() {
    if (!issueKey || !isBacklog) return;
    const next = !folderCreated;
    setSavingFolderFlag(true);
    setErr("");
    try {
      await onDocumentationFlagChange?.(issueKey, next);
      setIssue((prev) => {
        if (!prev) return prev;
        const labels = getIssueLabels(prev);
        const nextLabels = next
          ? Array.from(new Set([...labels, DOCUMENTATION_FOLDER_LABEL]))
          : labels.filter(
              (label) =>
                normalizePlain(label) !==
                normalizePlain(DOCUMENTATION_FOLDER_LABEL),
            );
        return {
          ...prev,
          fields: {
            ...(prev.fields || {}),
            labels: nextLabels,
          },
        };
      });
    } catch (e) {
      setErr(e?.message || "Falha ao atualizar Pasta criada.");
    } finally {
      setSavingFolderFlag(false);
    }
  }
  const progressLabel = meta?.hasStarted
    ? latestCommentText
    : "Sem comentário de início";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl rounded-2xl sm:w-full max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 min-w-0">
            <code className="shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold">
              {issueKey || "—"}
            </code>

            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="min-w-0 text-base leading-snug text-zinc-900"
                  style={CLAMP_2}
                >
                  {f?.summary || "Detalhes do ticket"}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[520px]">
                {f?.summary || "Detalhes do ticket"}
              </TooltipContent>
            </Tooltip>
          </DialogTitle>
          <DialogDescription className="text-sm text-zinc-600">
            Visualização rápida com contexto decisório, cronograma e
            comentários.
          </DialogDescription>
        </DialogHeader>

        {err ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        ) : null}

        <div className="grid gap-3">
          {/* resumo */}
          <div className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            {loading ? (
              <div className="grid gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            ) : (
              <div className="grid gap-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={f?.status?.name || "—"} />
                  <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                    Projeto: {f?.project?.key || f?.project?.name || "—"}
                  </Badge>
                  {directorateLabels.slice(0, 2).map((label) => (
                    <Badge
                      key={`dir-${label}`}
                      className="rounded-full border border-zinc-200 bg-white text-zinc-700"
                    >
                      Diretoria: {label}
                    </Badge>
                  ))}
                  {componentLabels.slice(0, 2).map((label) => (
                    <Badge
                      key={`component-${label}`}
                      className="rounded-full border border-zinc-200 bg-white text-zinc-700"
                    >
                      Componente: {label}
                    </Badge>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 text-zinc-700">
                  <span className="font-medium text-zinc-900">
                    Responsável:
                  </span>{" "}
                  {f?.assignee?.displayName || "Sem responsável"}
                  <span className="mx-2 text-zinc-300">•</span>
                  <span className="font-medium text-zinc-900">
                    Updated:
                  </span>{" "}
                  {fmtUpdatedBR(f?.updated)}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Próximo marco
              </div>
              <div className="mt-2 text-sm font-semibold text-zinc-900">
                {meta?.nextMilestone?.label || "Sem marco planejado"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Prazo
              </div>
              <div className="mt-2 text-sm font-semibold text-zinc-900">
                {dueLabel}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {meta?.dueSoon
                  ? "Vence nos próximos 7 dias"
                  : "Leitura da data limite atual"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Alocação
              </div>
              <div className="mt-2 text-sm font-semibold text-zinc-900">
                {allocatedResources.length
                  ? allocatedResources.slice(0, 2).join(", ")
                  : "Sem recurso definido"}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {meta?.hasCapacityConflict
                  ? "Conflito de agenda detectado"
                  : `${allocatedResources.length || 0} recurso(s) mapeado(s)`}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Último avanço
              </div>
              <div className="mt-2 text-sm font-semibold text-zinc-900">
                {latestCommentDate}
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-zinc-500">
                {progressLabel}
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-3 md:grid-cols-3">
            <div className="grid gap-2">
              <div className="text-sm font-semibold text-zinc-900">
                Status do ticket
              </div>
              <select
                value={statusDraft || f?.status?.name || ""}
                onChange={(event) => setStatusDraft(event.target.value)}
                disabled={loading || savingStatus || !issue}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-xl border-zinc-200 bg-white"
                onClick={applyDetailsStatus}
                disabled={
                  loading ||
                  savingStatus ||
                  !issue ||
                  !statusDraft ||
                  statusDraft === f?.status?.name
                }
              >
                {savingStatus ? "Salvando..." : "Aplicar status"}
              </Button>
            </div>

            <div className="grid gap-2">
              <div className="text-sm font-semibold text-zinc-900">
                Prioridade
              </div>
              <select
                value={priorityDraft || f?.priority?.name || ""}
                onChange={(event) => setPriorityDraft(event.target.value)}
                disabled={loading || savingPriority || !issue}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
                style={{
                  borderColor: priorityColor(
                    priorityDraft || f?.priority?.name,
                  ),
                }}
              >
                <option value="">Selecionar prioridade</option>
                {priorityOptions.map((priority) => (
                  <option key={priority.name} value={priority.name}>
                    {priority.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-xl border-zinc-200 bg-white"
                onClick={applyDetailsPriority}
                disabled={
                  loading ||
                  savingPriority ||
                  !issue ||
                  !priorityDraft ||
                  normalizePlain(priorityDraft) ===
                    normalizePlain(f?.priority?.name)
                }
              >
                {savingPriority ? "Salvando..." : "Aplicar prioridade"}
              </Button>
            </div>

            <div className="grid gap-2">
              <div className="text-sm font-semibold text-zinc-900">
                Documentação
              </div>
              {isBacklog ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={folderCreated}
                  onClick={toggleDocumentationFolderFlag}
                  disabled={loading || savingFolderFlag || !issue}
                  className={cn(
                    "flex h-10 items-center justify-between rounded-xl border px-3 text-sm font-semibold transition",
                    folderCreated
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-zinc-200 bg-zinc-50 text-zinc-700",
                    (loading || savingFolderFlag || !issue) && "opacity-60",
                  )}
                >
                  <span>Pasta criada</span>
                  <span
                    className={cn(
                      "relative h-5 w-9 rounded-full transition",
                      folderCreated ? "bg-emerald-600" : "bg-zinc-300",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white transition",
                        folderCreated ? "left-4" : "left-0.5",
                      )}
                    />
                  </span>
                </button>
              ) : (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                  Disponivel quando o ticket estiver em Backlog.
                </div>
              )}

              {canOrganizeDocumentation ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                  onClick={() => onOpenDocumentation?.(issue)}
                  disabled={loading || !issue}
                >
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Organizar Documentação
                </Button>
              ) : (
                <div className="text-xs text-zinc-500">
                  {attachmentsCount} anexo(s) no Jira.
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="mb-2 text-sm font-semibold text-zinc-900">
                Riscos e bloqueios
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                  {riskActivities.length} atividade(s) com risco
                </Badge>
                {meta?.isBlocked ? (
                  <Badge className="rounded-full border border-amber-200 bg-amber-50 text-amber-800">
                    Bloqueado
                  </Badge>
                ) : null}
                {meta?.isAtRisk ? (
                  <Badge className="rounded-full border border-red-200 bg-red-50 text-red-700">
                    Em risco
                  </Badge>
                ) : null}
                {meta?.hasCapacityConflict ? (
                  <Badge className="rounded-full border border-amber-200 bg-amber-50 text-amber-800">
                    Conflito de recurso
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3 text-xs text-zinc-500">
                {(meta?.actionReasons || []).length
                  ? meta.actionReasons.join(" • ")
                  : "Sem alertas operacionais adicionais."}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="mb-2 text-sm font-semibold text-zinc-900">
                Histórico resumido
              </div>
              <div className="text-sm font-semibold text-zinc-900">
                {latestCommentDate}
              </div>
              <div className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-700">
                {latestCommentText}
              </div>
            </div>
          </div>

          {/* descrição */}
          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="mb-2 text-sm font-semibold text-zinc-900">
              Descrição
            </div>
            {loading ? (
              <div className="grid gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words text-sm text-zinc-800 max-h-56 overflow-auto">
                {descText || "—"}
              </div>
            )}
          </div>

          {/* cronograma */}
          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-zinc-900">
                Informações Adicionais
              </div>

              {!loading && !hasCronograma ? (
                <Badge className="rounded-full border border-amber-200 bg-amber-50 text-amber-800">
                  Sem cronograma
                </Badge>
              ) : null}
            </div>

            {loading ? (
              <div className="grid gap-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-4 w-2/5" />
              </div>
            ) : (
              <div className="grid gap-3">
                {cronogramaActivities.length ? (
                  <div className="grid gap-2">
                    {cronogramaActivities.slice(0, 6).map((activity) => (
                      <div
                        key={`${issueKey}-${activity.id}`}
                        className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-zinc-900">
                            {activity.name}
                          </div>
                          {activity.risk ? (
                            <Badge className="rounded-full border border-red-200 bg-red-50 text-red-700">
                              Risco
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-600">
                          <span>{activity.data || "Sem data"}</span>
                          <span>{activity.recurso || "Sem recurso"}</span>
                          <span>{activity.area || "Sem área"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="whitespace-pre-wrap text-sm text-zinc-800">
                  {hasCronograma ? infoAdicText : "—"}
                </div>
              </div>
            )}
          </div>

          {/* comentários */}
          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="mb-2 text-sm font-semibold text-zinc-900">
              Comentários (últimos {Math.min(12, comments.length)})
            </div>

            {loading ? (
              <div className="grid gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-xl" />
                ))}
              </div>
            ) : comments.length ? (
              <div className="grid gap-2">
                {comments
                  .slice(-12)
                  .reverse()
                  .map((c) => {
                    const bodyText = safeText(c?.body);
                    const started = /\[INICIADO\]/i.test(bodyText);
                    const author =
                      c?.author?.displayName ||
                      c?.updateAuthor?.displayName ||
                      "—";
                    const created = fmtUpdatedBR(c?.created || c?.updated);
                    return (
                      <div
                        key={c?.id || `${author}-${created}`}
                        className={cn(
                          "rounded-xl border p-3 text-sm",
                          started
                            ? "border-red-200 bg-red-50"
                            : "border-zinc-200 bg-white",
                        )}
                      >
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7 border border-zinc-200">
                              <AvatarFallback className="bg-zinc-100 text-[11px] text-zinc-700">
                                {initials(author)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="text-xs font-semibold text-zinc-900">
                              {author}
                            </div>
                            {started ? (
                              <Badge className="rounded-full bg-red-600 text-white">
                                [INICIADO]
                              </Badge>
                            ) : null}
                          </div>
                          <div className="text-xs text-zinc-500">{created}</div>
                        </div>

                        <div className="whitespace-pre-wrap text-sm text-zinc-800">
                          {bodyText || "—"}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="text-sm text-zinc-600">Sem comentários.</div>
            )}
          </div>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-zinc-200 bg-white"
              onClick={async () => {
                await onMarkedStarted?.();
              }}
              disabled={!issueKey}
            >
              Marcar como iniciado
            </Button>

            <Button
              variant="outline"
              className="rounded-xl border-zinc-200 bg-white"
              onClick={() => onOpenChange(false)}
            >
              Fechar
            </Button>
          </div>

          {jiraBrowseUrl ? (
            <Button
              asChild
              className="rounded-xl bg-red-600 text-white hover:bg-red-700"
            >
              <a href={jiraBrowseUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir no Jira
              </a>
            </Button>
          ) : (
            <Button
              className="rounded-xl bg-red-600 text-white hover:bg-red-700"
              disabled
              title="Não foi possível montar a URL do Jira"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Abrir no Jira
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* =========================
   START MODAL (Iniciar Ticket)
========================= */
function StartTicketModal({
  issueKey,
  issue,
  loading,
  err,
  statusOptions,
  selectedStatus,
  setSelectedStatus,
  onClose,
  onApplyStatus,
  onStart,
}) {
  const f = issue?.fields || {};
  const subtasks = Array.isArray(f?.subtasks) ? f.subtasks : [];
  const components = (f?.components || []).map((c) => c?.name).filter(Boolean);
  const diretorias = toNamesArray(f?.customfield_11520);

  const frente =
    f?.customfield_13604?.value ||
    f?.customfield_13604?.name ||
    f?.customfield_13604?.label ||
    (typeof f?.customfield_13604 === "string" ? f.customfield_13604 : "");

  const startDateRaw = f?.customfield_10015;
  const startDate =
    typeof startDateRaw === "string"
      ? fmtDateBr(startDateRaw)
      : startDateRaw?.value
        ? fmtDateBr(startDateRaw.value)
        : "";

  const dueDate = f?.duedate ? fmtDateBr(f.duedate) : "—";
  const dueAltRaw = f?.customfield_11519;
  const dueAlt =
    typeof dueAltRaw === "string"
      ? fmtDateBr(dueAltRaw)
      : dueAltRaw?.value
        ? fmtDateBr(dueAltRaw.value)
        : "";

  const desc = safeText(f?.description);
  const criterios = safeText(f?.customfield_10903);

  // =========================
  // OWNER (ASSIGNEE) - NOVO
  // =========================
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerQuery, setOwnerQuery] = useState("");
  const [ownerOptions, setOwnerOptions] = useState([]);
  const [ownerSelected, setOwnerSelected] = useState(null); // {accountId, displayName, emailAddress, avatarUrl}
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerErr, setOwnerErr] = useState("");

  const [ownerTouched, setOwnerTouched] = useState(false);

  // normaliza usuário do Jira
  function mapJiraUser(u) {
    if (!u) return null;
    const avatarUrl =
      u?.avatarUrls?.["48x48"] ||
      u?.avatarUrls?.["32x32"] ||
      u?.avatarUrls?.["24x24"] ||
      "";
    return {
      accountId: u?.accountId || "",
      displayName: u?.displayName || u?.name || u?.emailAddress || "—",
      emailAddress: u?.emailAddress || "",
      avatarUrl,
      active: u?.active !== false,
    };
  }

  // debounce simples
  function useDebouncedValue(value, delayMs = 250) {
    const [deb, setDeb] = useState(value);
    useEffect(() => {
      const t = setTimeout(() => setDeb(value), delayMs);
      return () => clearTimeout(t);
    }, [value, delayMs]);
    return deb;
  }

  const debouncedOwnerQuery = useDebouncedValue(ownerQuery, 250);

  // inicializa com assignee atual ao abrir ticket
  useEffect(() => {
    // reset ao abrir outro ticket
    setOwnerOpen(false);
    setOwnerQuery("");
    setOwnerOptions([]);
    setOwnerErr("");
    setOwnerSelected(null);
    setOwnerTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey]);

  useEffect(() => {
    // só sincroniza automático se o usuário ainda não mexeu no campo
    if (!issue || ownerTouched) return;

    const a = f?.assignee ? mapJiraUser(f.assignee) : null;
    setOwnerSelected(a?.accountId ? a : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.fields?.assignee?.accountId, issueKey, ownerTouched]);

  // busca usuários (somente quando popover está aberto)
  useEffect(() => {
    let alive = true;

    async function run() {
      if (!ownerOpen) return;

      const q = String(debouncedOwnerQuery || "").trim();
      setOwnerErr("");

      // evita spam e lista gigante
      if (q.length < 2) {
        setOwnerOptions([]);
        setOwnerLoading(false);
        return;
      }

      setOwnerLoading(true);

      try {
        // tenta primeiro atribuíveiss por issueKey (melhor)
        let list = [];
        try {
          list = await jiraSearchAssignableUsers(issueKey, q);
        } catch {
          // fallback (busca geral)
          list = await jiraSearchUsers(q);
        }

        if (!alive) return;

        const normalized = Array.isArray(list)
          ? list.map(mapJiraUser).filter((x) => x?.accountId)
          : [];

        setOwnerOptions(normalized);
      } catch (e) {
        if (!alive) return;
        setOwnerOptions([]);
        setOwnerErr(
          e?.message ||
            "Falha ao buscar usuários. Verifique permissões do Jira (Browse users and groups / Assign issues).",
        );
      } finally {
        if (alive) setOwnerLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [debouncedOwnerQuery, ownerOpen, issueKey]);

  const currentAssigneeAccountId = f?.assignee?.accountId || null;
  const selectedOwnerAccountId = ownerSelected?.accountId || null;
  const ownerChanged = currentAssigneeAccountId !== selectedOwnerAccountId;

  function OwnerTriggerLabel() {
    if (!ownerSelected) {
      return (
        <span className="inline-flex items-center gap-2 text-zinc-700">
          <UserX className="h-4 w-4 text-zinc-500" />
          <span className="truncate">Sem responsável</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-2 min-w-0">
        <Avatar className="h-6 w-6 border border-zinc-200">
          {ownerSelected.avatarUrl ? (
            <AvatarImage src={ownerSelected.avatarUrl} alt="avatar" />
          ) : null}
          <AvatarFallback className="bg-zinc-100 text-[10px] text-zinc-700">
            {initials(ownerSelected.displayName)}
          </AvatarFallback>
        </Avatar>
        <span className="truncate">{ownerSelected.displayName}</span>
      </span>
    );
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-4xl rounded-2xl sm:w-full max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 min-w-0">
            <code className="shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-800">
              {issueKey}
            </code>
            <span className="min-w-0 text-base leading-snug text-zinc-900">
              Iniciar ticket
            </span>
          </DialogTitle>
          <DialogDescription className="text-sm text-zinc-600">
            {loading ? "Carregando detalhes..." : f?.summary || "—"}
          </DialogDescription>
        </DialogHeader>

        {err && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        )}

        {/* Status */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-2 text-sm font-semibold text-zinc-900">
            Alterar status do ticket
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
            <div className="grid gap-2">
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                disabled={loading || !issue}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
              >
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              <div className="text-xs text-zinc-600">
                Status atual:{" "}
                <span className="font-semibold text-zinc-900">
                  {f?.status?.name || "—"}
                </span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() =>
                onApplyStatus?.({
                  ownerAccountId: selectedOwnerAccountId,
                  ownerChanged,
                })
              }
              disabled={loading || !issue}
              className="rounded-xl border-zinc-200 bg-white"
              title={
                ownerChanged
                  ? "Aplicar status (e atualizar proprietário)"
                  : "Aplicar status"
              }
            >
              Aplicar status
            </Button>

            <Button
              type="button"
              onClick={() =>
                onStart?.({
                  ownerAccountId: selectedOwnerAccountId,
                  ownerChanged,
                })
              }
              disabled={loading || !issue}
              className="rounded-xl bg-red-600 text-white hover:bg-red-700"
              title="Atualiza proprietário (se mudou), cria comentário [INICIADO] e altera o status"
            >
              {loading ? "Processando..." : "Iniciar"}
            </Button>
          </div>

          {/* Microcopy do owner changed */}
          {issue && ownerChanged && (
            <div className="mt-2 text-xs text-amber-700">
              Responsável será atualizado ao salvar.
            </div>
          )}
        </div>

        {/* Campos */}
        <div className="grid gap-3 md:grid-cols-2">
          <InfoCard title="Básico">
            <InfoRow label="Projeto" value={f?.project?.name || "—"} />
            <InfoRow label="Prioridade" value={f?.priority?.name || "—"} />

            {/* Responsável (Assignee) - editável */}
            <div className="grid grid-cols-[160px_1fr] gap-3 py-1">
              <div className="text-xs text-zinc-500">Responsável</div>

              <div className="grid gap-1">
                <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={ownerOpen}
                      disabled={loading || !issue}
                      className="h-10 w-full justify-between rounded-xl border-zinc-200 bg-white text-sm text-zinc-900 hover:bg-zinc-50"
                    >
                      <span className="min-w-0 flex-1 truncate text-left">
                        <OwnerTriggerLabel />
                      </span>

                      {ownerLoading ? (
                        <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin text-zinc-500" />
                      ) : (
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-zinc-500" />
                      )}
                    </Button>
                  </PopoverTrigger>

                  <PopoverContent
                    align="start"
                    className="w-[420px] max-w-[calc(100vw-3rem)] rounded-2xl border-zinc-200 p-2"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        value={ownerQuery}
                        onValueChange={setOwnerQuery}
                        placeholder="Buscar responsável no Jira... (mín. 2 letras)"
                      />

                      <CommandList className="max-h-[260px]">
                        <CommandEmpty>
                          {ownerLoading
                            ? "Buscando..."
                            : String(ownerQuery || "").trim().length < 2
                              ? "Digite 2 ou mais caracteres para buscar."
                              : "Nenhum usuário encontrado."}
                        </CommandEmpty>

                        <CommandGroup heading="Opções">
                          {/* Sem responsável */}
                          <CommandItem
                            value="__none__"
                            onSelect={() => {
                              setOwnerSelected(null);
                              setOwnerTouched(true);
                              setOwnerOpen(false);
                            }}
                            className="rounded-xl"
                          >
                            <span className="flex items-center gap-2">
                              <UserX className="h-4 w-4 text-zinc-500" />
                              <span className="text-sm font-medium text-zinc-800">
                                Sem responsável
                              </span>
                            </span>

                            {!ownerSelected ? (
                              <Check className="ml-auto h-4 w-4 text-emerald-600" />
                            ) : null}
                          </CommandItem>

                          {/* Resultados */}
                          {ownerOptions.map((u) => {
                            const selected =
                              ownerSelected?.accountId === u.accountId;

                            return (
                              <CommandItem
                                key={u.accountId}
                                value={u.displayName}
                                onSelect={() => {
                                  setOwnerSelected(u);
                                  setOwnerTouched(true);
                                  setOwnerOpen(false);
                                }}
                                className="rounded-xl"
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  <Avatar className="h-7 w-7 border border-zinc-200">
                                    {u.avatarUrl ? (
                                      <AvatarImage
                                        src={u.avatarUrl}
                                        alt="avatar"
                                      />
                                    ) : null}
                                    <AvatarFallback className="bg-zinc-100 text-[10px] text-zinc-700">
                                      {initials(u.displayName)}
                                    </AvatarFallback>
                                  </Avatar>

                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-zinc-900">
                                      {u.displayName}
                                    </div>
                                    {u.emailAddress ? (
                                      <div className="truncate text-[11px] text-zinc-500">
                                        {u.emailAddress}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>

                                {selected ? (
                                  <Check className="ml-2 h-4 w-4 text-emerald-600" />
                                ) : null}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>

                    {ownerErr ? (
                      <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                        {ownerErr}
                      </div>
                    ) : null}
                  </PopoverContent>
                </Popover>

                <div className="text-[11px] text-zinc-500">
                  Atualiza o <span className="font-medium">Assignee</span> no
                  Jira usando <span className="font-medium">accountId</span>.
                </div>
              </div>
            </div>

            <InfoRow label="Relator" value={userName(f?.creator)} />
            <InfoRow
              label="Nome do Solicitante"
              value={userName(f?.customfield_11993)}
            />
            <InfoRow label="Data limite" value={dueDate} />
            <InfoRow label="Data limite Alterada" value={dueAlt || "—"} />
            <InfoRow label="Start date" value={startDate || "—"} />
            <InfoRow label="Frente" value={frente || "—"} />
          </InfoCard>

          <InfoCard title="Classificação">
            <InfoRow
              label="Diretorias"
              value={diretorias.length ? diretorias.join(", ") : "—"}
            />
            <InfoRow
              label="Componentes"
              value={components.length ? components.join(", ") : "—"}
            />

            <div className="mt-3 text-xs font-semibold text-zinc-900">
              Subtasks
            </div>

            <div className="grid gap-2">
              {!subtasks.length ? (
                <div className="text-sm text-zinc-600">—</div>
              ) : (
                subtasks.slice(0, 20).map((st) => (
                  <div
                    key={st?.key || `${st?.id || ""}`}
                    className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"
                  >
                    <div className="text-xs font-semibold text-zinc-900">
                      {st?.key || "—"}
                    </div>
                    <div className="text-sm text-zinc-800">
                      {st?.fields?.summary || "—"}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {st?.fields?.status?.name || ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </InfoCard>
        </div>

        <InfoCard title="Descrição do Projeto">
          <pre className="whitespace-pre-wrap text-sm text-zinc-800 m-0">
            {desc || "—"}
          </pre>
        </InfoCard>

        <InfoCard title="customfield_10903 (Critérios / Campo)">
          <pre className="whitespace-pre-wrap text-sm text-zinc-800 m-0">
            {criterios || "—"}
          </pre>
        </InfoCard>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            className="rounded-xl border-zinc-200 bg-white"
            onClick={onClose}
            disabled={loading}
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoCard({ title, children }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-zinc-900">{title}</div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 py-1">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-xs font-semibold text-zinc-900">{value || "—"}</div>
    </div>
  );
}

/* =========================
   CRONOGRAMA EDITOR
========================= */
function CronogramaEditorModal({
  issue,
  draft,
  setDraft,
  onClose,
  onSave,
  loading,
  dueDateDraft,
  setDueDateDraft,
  calendarSettings,
}) {
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [daysDraftById, setDaysDraftById] = useState({});

  if (!issue) return null;

  function fmtDateBrFull(d) {
    if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  }

  function parseIsoDateLocal(iso) {
    const s = String(iso || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function parseBrDayMonthToDate(ddmm, year) {
    const m = String(ddmm || "").match(/^(\d{2})\/(\d{2})$/);
    if (!m) return null;
    const day = Number(m[1]);
    const mon = Number(m[2]);
    const d = new Date(year, mon - 1, day, 0, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatDayMonth(date) {
    if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}`;
  }

  function formatActivityRangeFromDays(start, days) {
    const parsedDays = Math.max(1, parseInt(String(days || 1), 10) || 1);
    const workingStart =
      nextWorkingDay(start, calendarSettings, { includeCurrent: true }) ||
      start;
    const end = addBusinessDays(workingStart, parsedDays, calendarSettings);
    if (!workingStart || !end) return "";

    const startText = formatDayMonth(workingStart);
    const endText = formatDayMonth(end);
    return parsedDays <= 1 || startText === endText
      ? startText
      : `${startText} a ${endText}`;
  }

  function deriveIsCustom(activity) {
    return (
      Boolean(activity?.isCustom) || !STANDARD_CRONOGRAMA_IDS.has(activity?.id)
    );
  }

  function getAtividadeImplantacaoEndDate(draftList, refYear) {
    const list = Array.isArray(draftList) ? draftList : [];
    const impl =
      list.find((a) => String(a?.id || "").toLowerCase() === "deploy") ||
      list.find((a) => /implant/i.test(String(a?.name || "")));

    if (!impl) return null;

    const raw = String(impl?.data || "").trim();
    if (!raw) return null;

    const m = raw.match(/(\d{2}\/\d{2})(?:\s*a\s*(\d{2}\/\d{2}))?/i);
    if (!m) return null;

    const startDDMM = m[1];
    const endDDMM = m[2] || m[1];

    const start = parseBrDayMonthToDate(startDDMM, refYear);
    let end = parseBrDayMonthToDate(endDDMM, refYear);

    if (!start || !end) return null;

    if (end.getTime() < start.getTime()) {
      end = new Date(end);
      end.setFullYear(end.getFullYear() + 1);
    }

    return end;
  }

  function parseActivityDateRange(raw, refYear) {
    const match = String(raw || "").match(/(\d{2}\/\d{2})(?:\s*a\s*(\d{2}\/\d{2}))?/i);
    if (!match) return null;

    const start = parseBrDayMonthToDate(match[1], refYear);
    let end = parseBrDayMonthToDate(match[2] || match[1], refYear);
    if (!start || !end) return null;

    if (end.getTime() < start.getTime()) {
      end = new Date(end);
      end.setFullYear(end.getFullYear() + 1);
    }

    return { start, end };
  }

  function getActivityBusinessDays(activity, refYear) {
    const range = parseActivityDateRange(activity?.data, refYear);
    if (!range) return "";
    return String(
      businessDurationDays(range.start, range.end, calendarSettings),
    );
  }

  const dueDateObj = useMemo(
    () => parseIsoDateLocal(dueDateDraft),
    [dueDateDraft],
  );

  const implantEndDate = useMemo(() => {
    const baseYear = dueDateObj?.getFullYear?.() || new Date().getFullYear();
    return getAtividadeImplantacaoEndDate(draft, baseYear);
  }, [draft, dueDateObj]);

  const missingDueDate = !String(dueDateDraft || "").trim();
  const preparedDraft = useMemo(
    () =>
      (draft || []).map((activity) => ({
        ...activity,
        isCustom: deriveIsCustom(activity),
        name: String(activity?.name || "").trim(),
      })),
    [draft],
  );
  const invalidCustomActivity = preparedDraft.find(
    (activity) => activity.isCustom && !activity.name,
  );

  const nonWorkingActivityCount = useMemo(() => {
    const baseYear = dueDateObj?.getFullYear?.() || new Date().getFullYear();
    return preparedDraft.reduce((total, activity) => {
      const range = parseActivityDateRange(activity?.data, baseYear);
      if (!range) return total;
      return containsNonWorkingDays(
        toLocalDate(range.start),
        toLocalDate(range.end),
        calendarSettings,
      )
        ? total + 1
        : total;
    }, 0);
  }, [calendarSettings, dueDateObj, preparedDraft]);

  const dueBeforeImplant =
    !!dueDateObj &&
    !!implantEndDate &&
    dueDateObj.getTime() < implantEndDate.getTime();

  function setCell(idx, key, value) {
    setDraft((prev) => {
      const next = prev.map((x) => ({ ...x }));
      if (!next[idx]) return prev;
      next[idx][key] = value;
      if (key === "name") next[idx].isCustom = deriveIsCustom(next[idx]);
      return next;
    });
  }

  function setActivityDate(idx, value) {
    const currentActivity = draft?.[idx];
    const refYear = dueDateObj?.getFullYear?.() || new Date().getFullYear();
    const selectedRange = parseActivityDateRange(value, refYear);
    const draftDays = Math.max(
      1,
      parseInt(String(daysDraftById[currentActivity?.id] || ""), 10) || 1,
    );
    const isSingleDate =
      selectedRange && !/\s+a\s+/i.test(String(value || ""));
    const shouldApplyPendingDays =
      currentActivity &&
      !String(currentActivity.data || "").trim() &&
      isSingleDate &&
      draftDays > 1;

    setDraft((prev) => {
      const next = prev.map((x) => ({ ...x }));
      const activity = next[idx];
      if (!activity) return prev;

      if (shouldApplyPendingDays) {
        activity.data =
          formatActivityRangeFromDays(selectedRange.start, draftDays) || value;
      } else {
        activity.data = value;
      }

      return next;
    });

    if (shouldApplyPendingDays && currentActivity?.id) {
      setModeById((prev) => ({ ...prev, [currentActivity.id]: "range" }));
    }
  }

  function setActivityBusinessDays(idx, value) {
    const parsedDays = Math.max(1, parseInt(String(value || ""), 10) || 1);
    const currentActivity = draft?.[idx];

    setDaysDraftById((prev) => {
      if (!currentActivity?.id) return prev;
      return { ...prev, [currentActivity.id]: String(parsedDays) };
    });

    setDraft((prev) => {
      const next = prev.map((x) => ({ ...x }));
      const activity = next[idx];
      if (!activity) return prev;

      const refYear = dueDateObj?.getFullYear?.() || new Date().getFullYear();
      const range = parseActivityDateRange(activity.data, refYear);
      if (!range?.start) return next;

      const nextData = formatActivityRangeFromDays(range.start, parsedDays);
      if (nextData) activity.data = nextData;
      return next;
    });

    if (currentActivity?.id && String(currentActivity.data || "").trim()) {
      setModeById((prev) => ({
        ...prev,
        [currentActivity.id]: parsedDays > 1 ? "range" : "single",
      }));
    }
  }

  function moveRow(idx, direction) {
    setDraft((prev) => {
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.map((item) => ({ ...item }));
      const [row] = next.splice(idx, 1);
      next.splice(target, 0, row);
      return next;
    });
  }

  function removeRow(idx, id) {
    setDraft((prev) => prev.filter((_, currentIndex) => currentIndex !== idx));
    setModeById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function addCustomRow() {
    const row = createCustomCronogramaActivity();
    setDraft((prev) => [...prev, row]);
    setModeById((prev) => ({ ...prev, [row.id]: "range" }));
  }

  function inferMode(v) {
    const s = String(v || "");
    if (/\s+a\s+/i.test(s)) return "range";
    if (s.trim()) return "single";
    return "range";
  }

  const [modeById, setModeById] = useState(() => {
    const init = {};
    (draft || []).forEach((a) => {
      init[a.id] = inferMode(a.data);
    });
    return init;
  });

  useEffect(() => {
    setModeById((prev) => {
      const next = {};
      (draft || []).forEach((a) => {
        next[a.id] = prev[a.id] || inferMode(a.data);
      });
      return next;
    });
  }, [draft, issue?.key]);

  useEffect(() => {
    setDaysDraftById((prev) => {
      const next = {};
      const baseYear = dueDateObj?.getFullYear?.() || new Date().getFullYear();
      (draft || []).forEach((activity) => {
        const calculated = getActivityBusinessDays(activity, baseYear);
        next[activity.id] = calculated || prev[activity.id] || "";
      });
      return next;
    });
  }, [calendarSettings, draft, dueDateObj, issue?.key]);

  return (
    <Dialog
      open={true}
      onOpenChange={(o) => {
        if (!o) onClose?.();
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl rounded-2xl sm:w-full max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 min-w-0">
            <code className="shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-800">
              {issue.key}
            </code>

            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="min-w-0 text-base leading-snug text-zinc-900"
                  style={CLAMP_2}
                >
                  Criar cronograma — {issue.summary}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[520px]">
                {issue.summary}
              </TooltipContent>
            </Tooltip>
          </DialogTitle>

          <DialogDescription className="text-sm text-zinc-600">
            Salva em <code className="rounded bg-zinc-100 px-1">DD/MM</code> ou{" "}
            <code className="rounded bg-zinc-100 px-1">DD/MM a DD/MM</code>.
          </DialogDescription>
        </DialogHeader>

        <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Data limite</CardTitle>
          </CardHeader>

          <CardContent className="grid gap-2">
            <div className="grid gap-1">
              <Input
                type="date"
                value={dueDateDraft || ""}
                onChange={(e) => {
                  setDueDateDraft(e.target.value);
                  setSaveAttempted(false);
                }}
                disabled={loading}
                className={cn(
                  "h-10 rounded-xl border-zinc-200 bg-white focus-visible:ring-red-500",
                  saveAttempted && missingDueDate && "border-red-300",
                )}
              />

              {saveAttempted && missingDueDate && (
                <div className="mt-1 rounded-xl border border-red-200 bg-red-50 p-2 text-xs font-semibold text-red-700">
                  A data limite não foi preenchida.
                </div>
              )}

              {!missingDueDate && dueBeforeImplant && (
                <div className="mt-1 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-900">
                  A data limite ({fmtDateBr(dueDateDraft)}) é menor que a
                  Implantação ({fmtDateBrFull(implantEndDate)}).
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-sm">
                    Atividades do cronograma
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Preencha Data, Recurso e Área. Atividades customizadas podem
                    ser renomeadas, reordenadas e excluídas.
                  </CardDescription>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl border-zinc-200 bg-white"
                  onClick={addCustomRow}
                  disabled={loading}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar atividade
                </Button>
              </div>
            </CardHeader>

            <CardContent className="grid gap-3">
              {saveAttempted && invalidCustomActivity && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                  Toda atividade customizada precisa ter um nome antes de
                  salvar.
                </div>
              )}

              {nonWorkingActivityCount > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                  {nonWorkingActivityCount} atividade(s) passam por dias não
                  úteis. O Gantt exibirá a duração contando apenas dias úteis
                  configurados.
                </div>
              )}

              <div className="overflow-x-auto overflow-y-hidden md:overflow-visible rounded-2xl border border-zinc-200">
                <div className="min-w-[1040px] md:min-w-0">
                  <div className="sticky top-0 z-10 hidden md:grid md:grid-cols-[minmax(220px,1.4fr)_minmax(170px,1fr)_80px_minmax(130px,1fr)_minmax(130px,1fr)_110px] gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700">
                    <div>Atividade</div>
                    <div>Data</div>
                    <div>Dias</div>
                    <div>Recurso</div>
                    <div>Área</div>
                    <div>Ações</div>
                  </div>

                  <div className="grid">
                    {preparedDraft.map((a, idx) => {
                      const mode = modeById[a.id] || inferMode(a.data);
                      const isCustom = deriveIsCustom(a);
                      const disableUp = idx === 0 || loading;
                      const disableDown =
                        idx === preparedDraft.length - 1 || loading;

                      return (
                        <div
                          key={a.id}
                          className={cn(
                            "border-t border-zinc-200 px-3 py-2",
                            "md:grid md:grid-cols-[minmax(220px,1.4fr)_minmax(170px,1fr)_80px_minmax(130px,1fr)_minmax(130px,1fr)_110px] md:items-start md:gap-2",
                            "grid gap-3",
                          )}
                        >
                          <div className="min-w-0">
                            <div className="md:hidden text-[11px] font-semibold text-zinc-600">
                              Atividade
                            </div>
                            {isCustom ? (
                              <Input
                                value={a.name || ""}
                                onChange={(e) =>
                                  setCell(idx, "name", e.target.value)
                                }
                                placeholder="Nome da atividade"
                                disabled={loading}
                                className={cn(
                                  "h-10 rounded-xl border-zinc-200 bg-white focus-visible:ring-red-500",
                                  saveAttempted && !a.name && "border-red-300",
                                )}
                              />
                            ) : (
                              <div className="flex h-10 items-center truncate rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-900">
                                {a.name}
                              </div>
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="md:hidden text-[10px] font-bold uppercase text-zinc-400 mb-1">
                              Data
                            </div>
                            <DateValuePicker
                              value={a.data}
                              mode={mode}
                              onModeChange={(m) =>
                                setModeById((prev) => ({ ...prev, [a.id]: m }))
                              }
                              onChange={(val) => setActivityDate(idx, val)}
                              disabled={loading}
                              className="w-full"
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="md:hidden text-[11px] font-semibold text-zinc-600">
                              Dias
                            </div>
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              value={
                                getActivityBusinessDays(
                                  a,
                                  dueDateObj?.getFullYear?.() ||
                                    new Date().getFullYear(),
                                ) ||
                                daysDraftById[a.id] ||
                                ""
                              }
                              onChange={(e) =>
                                setActivityBusinessDays(idx, e.target.value)
                              }
                              placeholder="1"
                              disabled={loading}
                              className="h-10 rounded-xl border-zinc-200 bg-white text-center focus-visible:ring-red-500"
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="md:hidden text-[11px] font-semibold text-zinc-600">
                              Recurso
                            </div>
                            <Input
                              value={a.recurso || ""}
                              onChange={(e) =>
                                setCell(idx, "recurso", e.target.value)
                              }
                              placeholder="ex.: João"
                              disabled={loading}
                              className="h-10 rounded-xl border-zinc-200 bg-white focus-visible:ring-red-500"
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="md:hidden text-[11px] font-semibold text-zinc-600">
                              Área
                            </div>
                            <Input
                              value={a.area || ""}
                              onChange={(e) =>
                                setCell(idx, "area", e.target.value)
                              }
                              placeholder="ex.: TI"
                              disabled={loading}
                              className="h-10 rounded-xl border-zinc-200 bg-white focus-visible:ring-red-500"
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="md:hidden text-[11px] font-semibold text-zinc-600">
                              Ações
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-10 w-10 rounded-xl border-zinc-200"
                                onClick={() => moveRow(idx, -1)}
                                disabled={disableUp}
                                aria-label={`Mover ${a.name || "atividade"} para cima`}
                              >
                                <ChevronUp className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-10 w-10 rounded-xl border-zinc-200"
                                onClick={() => moveRow(idx, 1)}
                                disabled={disableDown}
                                aria-label={`Mover ${a.name || "atividade"} para baixo`}
                              >
                                <ChevronDown className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-10 w-10 rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                onClick={() => removeRow(idx, a.id)}
                                disabled={loading}
                                aria-label={`Excluir ${a.name || "atividade"}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <details className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-50">
              Prévia do ADF gerado
            </summary>
            <div className="px-4 pb-4">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-800">
                  {JSON.stringify(buildCronogramaADF(preparedDraft), null, 2)}
                </pre>
              </div>
            </div>
          </details>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl border-zinc-200 bg-white"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </Button>

          <Button
            type="button"
            className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            onClick={() => {
              setSaveAttempted(true);
              if (!String(dueDateDraft || "").trim()) return;
              if (invalidCustomActivity) return;
              onSave?.(preparedDraft);
            }}
            disabled={loading}
          >
            {loading ? "Salvando..." : "Salvar no Jira"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
