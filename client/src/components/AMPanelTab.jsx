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
import { DataSet } from "vis-data/peer";
import { Timeline } from "vis-timeline/peer";
import { Tree } from "react-arborist";
import JSZip from "jszip";
import { renderAsync } from "docx-preview";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";

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
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Clock,
  Download,
  Eye,
  ExternalLink,
  FileText,
  Filter,
  FolderOpen,
  FolderPlus,
  History,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Play,
  RefreshCcw,
  Search,
  Trash2,
  UserX,
  LayoutDashboard,
  MessageSquareText,
  Paperclip,
} from "lucide-react";

import AMCalendarTab from "./AMCalendarTab";
import AMDashboardTab from "./AMDashboardTab";
import AMActionsView from "./am-panel/AMActionsView";
import AMGanttView from "./am-panel/AMGanttView";
import AMPortfolioView from "./am-panel/AMPortfolioView";
import TicketDetailsDrawer from "./am-panel/TicketDetailsDrawer";
import useAmPanelState from "./am-panel/hooks/useAmPanelState";
import useJiraMutations from "./am-panel/hooks/useJiraMutations";
import useScheduleEditor from "./am-panel/hooks/useScheduleEditor";
import CreateJiraIssueDialog, {
  GenericField,
  SECTION_TITLES,
  formatFieldValue,
  getFieldId,
  getFieldName,
  groupFields,
  isEmptyValue,
  isFieldRequired,
  toFieldList,
} from "./CreateJiraIssueDialog";
import PersonalOperationalTimeline from "./PersonalOperationalTimeline";
import { POActionsHub, POPortfolioHub, POPresetBar } from "./POManagementViews";
import PersonalQueueView from "./am-panel/PersonalQueueView";
import usePoJiraData from "../hooks/usePoJiraData";

import { DateValuePicker } from "@/components/ui/date-range-picker";
import {
  jiraEditIssue,
  jiraGetIssueChangelog,
  jiraGetIssueEditMeta,
  jiraSearchAssignableUsers,
  jiraSearchUsers,
  jiraTransitionToStatus,
} from "../lib/jiraClient";
import {
  ATIVIDADES_PADRAO,
  buildCronogramaADF,
  parseCronogramaADF,
} from "../utils/cronograma";
import {
  addBusinessDays,
  businessDurationDays,
  containsNonWorkingDays,
  nextWorkingDay,
  normalizeCalendarSettings,
  toLocalDate,
} from "../utils/businessCalendar";
import { applyEventChangeToAtividades } from "../lib/jiraPoView";

// NOVO: buscar detalhes do ticket + comentar
import {
  createComment,
  buildDownloadLinks,
  getComments,
  getIssue,
  listAttachments,
} from "../lib/jira";
import { adfSafeToText } from "../utils/gmudUtils";

if (typeof window !== "undefined" && !window.JSZip) {
  window.JSZip = JSZip;
}

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

const TICKET_DETAILS_FIELDS = [
  "summary",
  "status",
  "assignee",
  "created",
  "updated",
  "project",
  "description",
  "duedate",
  "customfield_11519",
  "customfield_14017",
  "components",
  "customfield_11520",
  "priority",
  "labels",
  "attachment",
  "issuetype",
  "parent",
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
  "Concluído",
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

function getIssueTypeInfo(ticket) {
  const raw = ticket?.fields?.issuetype || ticket?.issuetype || {};
  const name =
    ticket?.issueType ||
    ticket?.issueTypeName ||
    raw?.name ||
    ticket?.type ||
    "";
  const iconUrl =
    ticket?.issueTypeIconUrl || ticket?.issueTypeIcon || raw?.iconUrl || "";
  const id = ticket?.issueTypeId || raw?.id || "";
  const description = ticket?.issueTypeDescription || raw?.description || "";
  return { id, name, iconUrl, description };
}

function IssueTypeIcon({ ticket, className = "" }) {
  const [failed, setFailed] = useState(false);
  const info = getIssueTypeInfo(ticket);
  const label = info.name ? `Tipo do ticket: ${info.name}` : "Tipo do ticket";
  const fallback =
    String(info.name || "?")
      .trim()
      .charAt(0)
      .toUpperCase() || "?";

  if (info.iconUrl && !failed) {
    return (
      <img
        src={info.iconUrl}
        alt=""
        title={label}
        aria-label={label}
        className={cn("h-4 w-4 shrink-0 object-contain", className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-zinc-200 bg-white text-[9px] font-bold uppercase text-zinc-600",
        className,
      )}
    >
      {fallback}
    </span>
  );
}

function normalizePlain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function jiraErrorActionFor(type) {
  if (type === "transition") {
    return "Abra o ticket no Jira e verifique as transições disponíveis.";
  }
  if (type === "priority") {
    return "Confira se a prioridade está habilitada no projeto Jira.";
  }
  if (type === "edit" || type === "dueDate") {
    return "Revise os campos obrigatórios e as permissões de edição no Jira.";
  }
  if (type === "comment") {
    return "Confirme permissão para comentar no ticket e tente novamente.";
  }
  if (type === "schedule") {
    return "Valide se o campo de cronograma está editável no Jira.";
  }
  return "Tente novamente ou valide o ticket diretamente no Jira.";
}

function formatJiraActionableError(error, context = {}) {
  const status = Number(
    error?.status ||
      error?.statusCode ||
      error?.response?.status ||
      error?.body?.status ||
      0,
  );
  const body = error?.body || {};
  const errorMessages = Array.isArray(body?.errorMessages)
    ? body.errorMessages
    : [];
  const fieldErrors =
    body?.errors && typeof body.errors === "object"
      ? Object.values(body.errors)
      : [];
  const raw = [
    error?.message,
    body?.message,
    body?.error,
    ...errorMessages,
    ...fieldErrors,
    context?.fallback,
  ]
    .filter(Boolean)
    .join(" ");
  const normalized = normalizePlain(raw);
  const action = jiraErrorActionFor(context.type);
  const ticketSuffix = context.issueKey ? ` Ticket: ${context.issueKey}.` : "";

  if (
    status === 401 ||
    status === 403 ||
    /\b(unauthorized|forbidden|token|credencial|credential|permiss|permission|auth)\b/.test(
      normalized,
    )
  ) {
    return `Token Jira expirado ou sem permissão. Revise o token em Configurações e confirme acesso ao ticket.${ticketSuffix}`;
  }

  if (
    status === 429 ||
    /rate limit|too many requests|limite/.test(normalized)
  ) {
    return "Jira limitou as requisições. Aguarde alguns segundos e tente novamente.";
  }

  if (
    context.type === "transition" ||
    /transition|transicao|transição|workflow|no transitions|indisponivel|indisponível/.test(
      normalized,
    )
  ) {
    return `Transição indisponível para este status. ${action}${ticketSuffix}`;
  }

  if (
    context.type === "priority" ||
    /priority|prioridade|priorities|not found/.test(normalized)
  ) {
    return `Prioridade não existe ou não está disponível no Jira. ${action}${ticketSuffix}`;
  }

  if (
    context.type === "edit" ||
    /editmeta|required|obrigatorio|obrigatório|field|campo|customfield|cannot be set|cannot set/.test(
      normalized,
    )
  ) {
    return `Campo obrigatório ausente ou bloqueado no Jira. ${action}${ticketSuffix}`;
  }

  if (
    /timeout|network|failed to fetch|fetch failed|conexao|conexão|econn|abort/.test(
      normalized,
    )
  ) {
    return "Falha de conexão com Jira. Verifique a rede/VPN e tente novamente.";
  }

  return `${context.fallback || "Não foi possível concluir a ação no Jira."} ${action}${ticketSuffix}`;
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

function getAttachmentExtension(attachment) {
  const name = String(attachment?.filename || attachment?.name || "")
    .trim()
    .toLowerCase();
  const match = name.match(/\.([a-z0-9]+)$/i);
  return match?.[1] || "";
}

function isPreviewableAttachment(attachment) {
  return Boolean(getAttachmentPreviewKind(attachment));
}

function getAttachmentPreviewKind(attachment) {
  const ext = getAttachmentExtension(attachment);
  const mime = String(attachment?.mimeType || attachment?.contentType || "")
    .trim()
    .toLowerCase();

  if (ext === "pdf" || mime.includes("pdf")) return "pdf";
  if (ext === "docx" || mime.includes("wordprocessingml.document")) {
    return "docx";
  }
  if (
    ext === "doc" ||
    ext === "ppt" ||
    ext === "pptx" ||
    mime.includes("msword") ||
    mime.includes("powerpoint") ||
    mime.includes("presentation")
  ) {
    return "unsupported";
  }

  return "";
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
    {
      label: "Próximos 7 dias",
      value: portfolio.dueThisWeek || 0,
      tone: "amber",
    },
    {
      label: "Sem cronograma",
      value: portfolio.noSchedule || 0,
      tone: "slate",
    },
    { label: "Com risco", value: portfolio.atRisk || 0, tone: "red" },
    {
      label: "Sem avanço",
      value: (insights?.filteredItems || []).filter(
        (item) => item.noRecentUpdate,
      ).length,
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
                toneClasses[kpi.tone] || toneClasses.zinc,
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
          <CardDescription>
            Tickets e atividades com data próxima.
          </CardDescription>
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

export default function AMPanelTab({
  calendarSettings,
  currentUser,
  poData,
  personalMode = false,
  onConfigureUser,
  startTicketRequest = null,
  ticketDetailsRequest = null,
}) {
  const effectiveCalendarSettings = useMemo(
    () => normalizeCalendarSettings(calendarSettings),
    [calendarSettings],
  );
  const localPoData = usePoJiraData();
  const effectivePoData = poData || localPoData;
  const {
    loading,
    setLoading,
    reloadProgress,
    err,
    setErr,
    rawIssues,
    rows,
    doneRows,
    viewData,
    setViewData,
    reload,
    ensureLoaded,
    refreshIssue,
    applyCronogramaPatchLocal,
    applyTicketStatusLocal,
    applyTicketDueDateLocal,
  } = effectivePoData;
  const {
    subView,
    setSubView,
    personalSubView,
    setPersonalSubView,
    activePreset,
    setActivePreset,
    ownerFocus,
    setOwnerFocus,
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
    detailsOpen,
    setDetailsOpen,
    detailsKey,
    setDetailsKey,
    documentationOpen,
    setDocumentationOpen,
    documentationTicket,
    setDocumentationTicket,
    resolutionOpen,
    setResolutionOpen,
    resolutionTicket,
    setResolutionTicket,
    resolutionProblem,
    setResolutionProblem,
    resolutionComment,
    setResolutionComment,
    resolutionDueDate,
    setResolutionDueDate,
    resolutionSaving,
    setResolutionSaving,
    resolutionErr,
    setResolutionErr,
    createIssueOpen,
    setCreateIssueOpen,
    colorMode,
    setColorMode,
    calendarFilter,
    setCalendarFilter,
    movingPersonalKeys,
    setMovingPersonalKeys,
    ownerAccountId,
    effectiveOwnerFocus,
    insightOwnerAccountId,
    insightOwnerFocus,
    effectiveActivePreset,
    poInsights,
    scopedViewData,
    scopedRawIssues,
    scopedDoneRows,
    scopedAlertas,
    scopedCriarCronograma,
    ticketMetaMap,
  } = useAmPanelState({
    personalMode,
    currentUser,
    rawIssues,
    doneRows,
    viewData,
  });

  // modal "Iniciar ticket"
  const [startOpen, setStartOpen] = useState(false);
  const [startIssueKey, setStartIssueKey] = useState("");
  const [startIssue, setStartIssue] = useState(null);
  const [startLoading, setStartLoading] = useState(false);
  const [startErr, setStartErr] = useState("");
  const [selectedStatus, setSelectedStatus] = useState(STATUS_OPTIONS[0]);
  const lastExternalStartRequestRef = useRef("");
  const lastExternalDetailsRequestRef = useRef("");

  // trava durante persistência de mudança de datas (drag/resize)
  const [persisting, setPersisting] = useState(false);
  const [changeHistory, setChangeHistory] = useState([]);
  const busy = Boolean(loading || persisting);
  const {
    refreshIssueInPanel,
    refreshTicketAfterMutation,
    setDocumentationFolderFlag,
    updateTicketPriority,
    updateTicketStatus,
    updateTicketDueDate,
    movePersonalTicketStatus,
  } = useJiraMutations({
    refreshIssue,
    setDocumentationTicket,
    applyTicketDueDateLocal,
    applyTicketStatusLocal,
    setMovingPersonalKeys,
    setErr,
    formatJiraActionableError,
  });
  const {
    editorOpen,
    editorIssue,
    draft,
    setDraft,
    dueDateDraft,
    setDueDateDraft,
    openEditor,
    closeEditor,
    saveEditor,
  } = useScheduleEditor({
    setLoading,
    setErr,
    refreshTicketAfterMutation,
    setSubView,
    formatJiraActionableError,
  });
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

  useEffect(() => {
    ensureLoaded().catch(() => null);
  }, [ensureLoaded]);

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

      await refreshTicketAfterMutation(key);
      closeResolutionDialog();
    } catch (e) {
      console.error(e);
      setResolutionErr(
        formatJiraActionableError(e, {
          type: "comment",
          issueKey: resolutionTicket?.key,
          fallback: "Falha ao registrar resolução do alerta.",
        }),
      );
    } finally {
      setResolutionSaving(false);
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

  useEffect(() => {
    const requestId = String(
      startTicketRequest?.id || startTicketRequest?.ticketKey || "",
    ).trim();

    if (!requestId || lastExternalStartRequestRef.current === requestId) {
      return;
    }

    const ticketKey = String(
      startTicketRequest?.ticketKey || startTicketRequest?.issue?.key || "",
    )
      .trim()
      .toUpperCase();

    if (!ticketKey) return;

    lastExternalStartRequestRef.current = requestId;

    setSubView("acoes");
    setDashTab("andamento");

    openStartModal({
      ...(startTicketRequest?.issue || {}),
      key: ticketKey,
    });
  }, [startTicketRequest]);

  useEffect(() => {
    const requestId = String(
      ticketDetailsRequest?.id || ticketDetailsRequest?.ticketKey || "",
    ).trim();

    if (!requestId || lastExternalDetailsRequestRef.current === requestId) {
      return;
    }

    const ticketKey = String(
      ticketDetailsRequest?.ticketKey || ticketDetailsRequest?.issue?.key || "",
    )
      .trim()
      .toUpperCase();

    if (!ticketKey) return;

    lastExternalDetailsRequestRef.current = requestId;

    setSubView("acoes");
    setDashTab("andamento");
    setDetailsKey(ticketKey);
    setDetailsOpen(true);
  }, [
    ticketDetailsRequest,
    setDashTab,
    setDetailsKey,
    setDetailsOpen,
    setSubView,
  ]);

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
      applyTicketStatusLocal(startIssueKey, selectedStatus);

      const issue = await getIssue(startIssueKey, START_FIELDS);
      setStartIssue(issue);
      await refreshIssueInPanel(startIssueKey).catch(() => null);
    } catch (e) {
      console.error(e);
      setStartErr(
        formatJiraActionableError(e, {
          type: "transition",
          issueKey: startIssueKey,
          fallback: "Falha ao alterar status do ticket.",
        }),
      );
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
      applyTicketStatusLocal(startIssueKey, selectedStatus);

      // 4) atualiza apenas o ticket aberto e segue para os detalhes
      const startedKey = startIssueKey;
      await refreshIssueInPanel(startedKey).catch(() => null);
      closeStartModal();
      setDetailsKey(startedKey);
      setDetailsOpen(true);
    } catch (e) {
      console.error(e);
      setStartErr(
        formatJiraActionableError(e, {
          type: "comment",
          issueKey: startIssueKey,
          fallback: "Falha ao iniciar o ticket.",
        }),
      );
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
      const message = formatJiraActionableError(e, {
        type: "schedule",
        issueKey,
        fallback: "Falha ao persistir no Jira. Revertendo...",
      });
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
          console.warn(
            "Falha ao atualizar cache local do cronograma.",
            cacheErr,
          );
        }

        updateChangeHistoryStatus(
          historyEntries.map((entry) => entry.id),
          "salvo",
        );
        return true;
      } catch (e) {
        console.error(e);
        const affected = Array.from(
          new Set(valid.map((item) => item.issueKey)),
        );
        const message = formatJiraActionableError(e, {
          type: "schedule",
          issueKey: affected.join(", "),
          fallback: "Falha ao persistir no Jira. Revertendo...",
        });
        setErr(message);
        updateChangeHistoryStatus(
          historyEntries.map((entry) => entry.id),
          "revertido",
          message,
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
        setErr(
          formatJiraActionableError(e, {
            type: "schedule",
            issueKey: ik,
            fallback: "Falha ao persistir no Jira. Revertendo...",
          }),
        );

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
                    <button
                      type="button"
                      className={cn(
                        "flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition md:flex-none",
                        personalSubView === "timeline"
                          ? "bg-white text-zinc-950 shadow-sm"
                          : "text-zinc-600 hover:text-zinc-950",
                      )}
                      onClick={() => setPersonalSubView("timeline")}
                    >
                      Timeline Operacional
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
              ) : personalSubView === "summary" ? (
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
              ) : (
                <PersonalOperationalTimeline
                  rows={scopedRawIssues}
                  loadingTickets={loading}
                  onOpenDetails={(key) => {
                    setDetailsKey(key);
                    setDetailsOpen(true);
                  }}
                />
              )}
            </section>
          ) : null}

          {/* =========================
            AÇÕES DO P.O
        ========================= */}
          {!personalMode && subView === "acoes" && (
            <AMActionsView
              insights={poInsights}
              TicketDashboardComponent={TicketDashboardPage}
              rows={scopedRawIssues}
              alertas={scopedAlertas}
              missingSchedule={scopedCriarCronograma}
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
              onOpenSchedule={(ticket) => openEditor(ticket)}
              onOpenDocumentation={(ticket) =>
                openDocumentationOrganizer(ticket?.raw || ticket)
              }
              onResolveProblem={openResolutionProblem}
              movingKeys={movingPersonalKeys}
              onMoveStatus={movePersonalTicketStatus}
            />
          )}

          {!personalMode && subView === "portfolio" && (
            <AMPortfolioView
              insights={poInsights}
              onOpenDetails={(key) => {
                setDetailsKey(key);
                setDetailsOpen(true);
              }}
            />
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
            <AMGanttView
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
                onOpenDetails={(key) => {
                  setDetailsKey(key);
                  setDetailsOpen(true);
                }}
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

          <TicketDetailsDrawer
            DetailsComponent={TicketDetailsDialog}
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            issueKey={detailsKey}
            ticketMetaMap={ticketMetaMap}
            statusOptions={STATUS_OPTIONS}
            priorityOptions={PRIORITY_OPTIONS}
            onChangeStatus={updateTicketStatus}
            onChangePriority={updateTicketPriority}
            onChangeDueDate={updateTicketDueDate}
            onDocumentationFlagChange={setDocumentationFolderFlag}
            onOpenDocumentation={(ticket) => openDocumentationOrganizer(ticket)}
            onOpenSchedule={(ticket) => openEditor(ticket)}
            onTicketUpdated={refreshTicketAfterMutation}
            onMarkedStarted={async () => {
              // cria comentário [INICIADO] sem mudar status
              if (!detailsKey) return;
              await createComment(detailsKey, adfFromPlainText("[INICIADO]"));
              return refreshTicketAfterMutation(detailsKey);
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
              {problem?.recommendedAction ||
                "Registrar acao e acompanhar o ticket."}
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
              A correcao do conflito de recurso deve ser feita ajustando datas
              ou recurso no Gantt/cronograma. O botao abaixo leva o ticket para
              a visao de Gantt filtrada.
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
  movingKeys,
  onMoveStatus,
}) {
  const [viewMode, setViewMode] = useState("list");

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
            <div className="inline-flex w-full rounded-2xl bg-zinc-100 p-1 sm:w-auto">
              <button
                type="button"
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition sm:flex-none",
                  viewMode === "list"
                    ? "bg-white text-zinc-950 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-950",
                )}
                onClick={() => setViewMode("list")}
                aria-pressed={viewMode === "list"}
              >
                <ListChecks className="h-4 w-4" />
                Lista
              </button>
              <button
                type="button"
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition sm:flex-none",
                  viewMode === "kanban"
                    ? "bg-white text-zinc-950 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-950",
                )}
                onClick={() => setViewMode("kanban")}
                aria-pressed={viewMode === "kanban"}
              >
                <LayoutDashboard className="h-4 w-4" />
                Kanban
              </button>
            </div>

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

        {viewMode === "list" ? (
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
        ) : (
          <PersonalQueueView
            rows={filtered}
            loading={loading}
            movingKeys={movingKeys}
            onOpenDetails={onOpenDetails}
            onMoveStatus={onMoveStatus}
            title="Kanban global"
            description="Todos os tickets do recorte atual agrupados por status. Arraste um ticket para mover no Jira."
          />
        )}
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
  const PAGE_SIZE_OPTIONS = [12, 24, 48, 96];
  const safeRows = rows || [];
  const showSkeleton = loading && safeRows.length === 0;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
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

  const pageCount = Math.max(1, Math.ceil(safeRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = safeRows.length ? (currentPage - 1) * pageSize : 0;
  const pageEnd = Math.min(pageStart + pageSize, safeRows.length);
  const visibleRows = safeRows.slice(pageStart, pageEnd);

  useEffect(() => {
    setPage(1);
  }, [safeRows, pageSize, title]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          <p className="text-sm text-zinc-600">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
            <span className="font-medium text-zinc-900">Por página</span>
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-900 outline-none focus:ring-2 focus:ring-red-500"
              aria-label="Tickets por página"
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span className="text-zinc-500">recomendado: 12</span>
          </div>

          {loading && safeRows.length ? (
            <Badge className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700">
              <Loader2 className="h-3 w-3 animate-spin" />
              Atualizando lista
            </Badge>
          ) : null}

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

      {!showSkeleton && safeRows.length ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs font-medium text-zinc-600">
            Mostrando {pageStart + 1}-{pageEnd} de {safeRows.length} ticket(s)
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-xl border-zinc-200 bg-white px-3 text-xs"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              Anterior
            </Button>
            <span className="min-w-16 text-center text-xs font-semibold text-zinc-700">
              {currentPage}/{pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-xl border-zinc-200 bg-white px-3 text-xs"
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              disabled={currentPage >= pageCount}
            >
              Próxima
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      {/* Grid de cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {showSkeleton
          ? Array.from({ length: 8 }).map((_, i) => (
              <TicketCardSkeleton key={i} />
            ))
          : visibleRows.map((t) => (
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
              <IssueTypeIcon ticket={ticket} />
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
const HISTORY_EVENT_TYPES = {
  all: { label: "Todos" },
  status: { label: "Status" },
  comments: { label: "Comentários" },
  attachments: { label: "Anexos" },
  dates: { label: "Prazos" },
  fields: { label: "Campos" },
};

const HISTORY_EVENT_META = {
  comment: {
    label: "Comentário",
    filter: "comments",
    icon: MessageSquareText,
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  status_changed: {
    label: "Status",
    filter: "status",
    icon: ArrowUpDown,
    className: "border-red-200 bg-red-50 text-red-700",
  },
  priority_changed: {
    label: "Prioridade",
    filter: "fields",
    icon: AlertTriangle,
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  due_date_changed: {
    label: "Prazo",
    filter: "dates",
    icon: CalendarDays,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  assignee_changed: {
    label: "Responsável",
    filter: "fields",
    icon: UserX,
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
  attachment_changed: {
    label: "Anexo",
    filter: "attachments",
    icon: Paperclip,
    className: "border-slate-200 bg-slate-50 text-slate-700",
  },
  field_changed: {
    label: "Campo",
    filter: "fields",
    icon: Pencil,
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  other: {
    label: "Outros",
    filter: "fields",
    icon: History,
    className: "border-zinc-200 bg-zinc-50 text-zinc-700",
  },
};

function parseHistoryDate(value) {
  if (!value) return null;
  const normalized = String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatHistoryDateTime(value) {
  const date = value instanceof Date ? value : parseHistoryDate(value);
  if (!date) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatHistoryTime(value) {
  const date = value instanceof Date ? value : parseHistoryDate(value);
  if (!date) return "--:--";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function historyDayKey(value) {
  const date = value instanceof Date ? value : parseHistoryDate(value);
  if (!date) return "sem-data";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function historyDayLabel(ymd) {
  if (ymd === "sem-data") return "Sem data";
  const today = historyDayKey(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = historyDayKey(yesterdayDate);
  if (ymd === today) return "Hoje";
  if (ymd === yesterday) return "Ontem";
  const [year, month, day] = String(ymd || "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : ymd || "--";
}

function jiraActorName(actor) {
  return actor?.displayName || actor?.name || actor?.emailAddress || "Jira";
}

function classifyHistoryField(item = {}) {
  const field = normalizePlain(item.field || item.fieldId || "");
  if (field === "status") return "status_changed";
  if (field === "priority" || field === "prioridade") return "priority_changed";
  if (
    field === "assignee" ||
    field === "responsavel" ||
    field === "responsavel jira"
  ) {
    return "assignee_changed";
  }
  if (
    field.includes("duedate") ||
    field.includes("due date") ||
    field.includes("prazo") ||
    field.includes("data limite")
  ) {
    return "due_date_changed";
  }
  if (field === "attachment" || field === "anexo") return "attachment_changed";
  return field ? "field_changed" : "other";
}

function normalizeHistoryComment(comment = {}, issueKey = "") {
  const createdAt = parseHistoryDate(comment.created || comment.updated);
  if (!createdAt) return null;
  const bodyText = safeText(comment.body);
  const author = jiraActorName(comment.author || comment.updateAuthor);
  return {
    id: `${issueKey}-comment-${comment.id || createdAt.getTime()}`,
    type: "comment",
    createdAt,
    actor: author,
    title: "Comentário adicionado",
    field: "comment",
    from: "",
    to: "",
    bodyText,
    searchText: `${author} comentário ${bodyText}`,
  };
}

function normalizeHistoryChange(
  history = {},
  item = {},
  issueKey = "",
  index = 0,
) {
  const createdAt = parseHistoryDate(history.created);
  if (!createdAt) return null;
  const type = classifyHistoryField(item);
  const field = item.field || item.fieldId || "Campo";
  const author = jiraActorName(history.author);
  const from = item.fromString || item.from || "";
  const to = item.toString || item.to || "";
  const meta = HISTORY_EVENT_META[type] || HISTORY_EVENT_META.other;
  return {
    id: `${issueKey}-change-${history.id || createdAt.getTime()}-${index}`,
    type,
    createdAt,
    actor: author,
    title: `${meta.label} alterado`,
    field,
    from,
    to,
    bodyText: "",
    searchText: `${author} ${meta.label} ${field} ${from} ${to}`,
  };
}

function normalizeHistoryAttachment(attachment = {}, issueKey = "") {
  const createdAt = parseHistoryDate(attachment.created);
  if (!createdAt) return null;
  const filename = attachment.filename || attachment.name || "arquivo";
  const author = jiraActorName(attachment.author);
  return {
    id: `${issueKey}-attachment-${attachment.id || filename}`,
    type: "attachment_changed",
    createdAt,
    actor: author,
    title: "Anexo incluído",
    field: "attachment",
    from: "",
    to: filename,
    bodyText: `${filename}${attachment.size ? ` • ${Math.ceil(Number(attachment.size || 0) / 1024)} KB` : ""}`,
    searchText: `${author} anexo ${filename}`,
  };
}

function groupHistoryEventsByDay(events = []) {
  const groups = new Map();
  events.forEach((event) => {
    const key = historyDayKey(event.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  return Array.from(groups.entries()).map(([key, items]) => ({
    key,
    label: historyDayLabel(key),
    items,
  }));
}

function escapeHistoryHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateHistoryText(value, max = 90) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function historyGraphGroupId(type) {
  if (type === "status_changed") return "status";
  if (type === "comment") return "comments";
  return "activities";
}

function historyStatusTone(value) {
  const normalized = normalizePlain(value);
  if (
    /done|concluido|concluida|encerrado|encerrada|closed|resolved|finalizado/.test(
      normalized,
    )
  ) {
    return "green";
  }
  if (
    /progress|desenvolvimento|refinamento|review|em andamento|iniciado|artefato|homolog/.test(
      normalized,
    )
  ) {
    return "yellow";
  }
  if (/to do|todo|backlog|novo|pre save|presave|aberto|open/.test(normalized)) {
    return "blue";
  }
  return "gray";
}

function historyGraphTooltip(event) {
  const meta = HISTORY_EVENT_META[event.type] || HISTORY_EVENT_META.other;
  const lines = [
    meta.label,
    `Autor: ${event.actor || "Jira"}`,
    `Data: ${formatHistoryDateTime(event.createdAt)}`,
  ];
  if (event.from || event.to) {
    lines.push(`De: ${event.from || "-"}`);
    lines.push(`Para: ${event.to || "-"}`);
  }
  if (event.bodyText) lines.push(truncateHistoryText(event.bodyText, 140));
  return escapeHistoryHtml(lines.join("\n"));
}

function historyGraphItemContent(event) {
  if (event.type === "comment") {
    return `
      <div class="ticket-history-graph-item ticket-history-graph-comment">
        <strong>${escapeHistoryHtml(event.actor || "Jira")}</strong>
        <span>${escapeHistoryHtml(truncateHistoryText(event.bodyText || "Comentário sem texto.", 120))}</span>
      </div>
    `;
  }

  if (event.type === "status_changed") {
    const tone = historyStatusTone(event.to || event.from);
    return `
      <div class="ticket-history-graph-item ticket-history-graph-status ticket-history-graph-status-${tone}">
        <strong>${escapeHistoryHtml(event.to || event.from || "Status")}</strong>
        <span>${escapeHistoryHtml(event.from ? `${event.from} -> ${event.to || "-"}` : "Mudança de status")}</span>
      </div>
    `;
  }

  const meta = HISTORY_EVENT_META[event.type] || HISTORY_EVENT_META.other;
  const detail =
    event.type === "attachment_changed"
      ? event.to || event.bodyText
      : event.to || event.bodyText || event.from || "";
  return `
    <div class="ticket-history-graph-item ticket-history-graph-activity">
      <strong>${escapeHistoryHtml(meta.label)}</strong>
      <span>${escapeHistoryHtml(truncateHistoryText(`${event.field || ""}${detail ? `: ${detail}` : ""}`, 120))}</span>
    </div>
  `;
}

function TicketHistoryGraphTimeline({ events = [], loading }) {
  const containerRef = useRef(null);
  const timelineRef = useRef(null);

  const graphGroups = useMemo(
    () => [
      {
        id: "status",
        content:
          '<div class="ticket-history-graph-group ticket-history-graph-group-status"><strong>Status</strong></div>',
      },
      {
        id: "comments",
        content:
          '<div class="ticket-history-graph-group ticket-history-graph-group-comments"><strong>Comentários</strong></div>',
      },
      {
        id: "activities",
        content:
          '<div class="ticket-history-graph-group ticket-history-graph-group-activities"><strong>Atividades</strong></div>',
      },
    ],
    [],
  );

  const graphItems = useMemo(
    () =>
      events.map((event) => ({
        id: event.id,
        group: historyGraphGroupId(event.type),
        start: event.createdAt,
        content: historyGraphItemContent(event),
        title: historyGraphTooltip(event),
        className: cn(
          "ticket-history-graph-vis-item",
          `ticket-history-graph-vis-${historyGraphGroupId(event.type)}`,
          event.type === "status_changed"
            ? `ticket-history-graph-vis-status-${historyStatusTone(event.to || event.from)}`
            : "",
        ),
      })),
    [events],
  );

  useEffect(() => {
    if (!containerRef.current || loading) return undefined;

    const groupSet = new DataSet(graphGroups);
    const itemSet = new DataSet(graphItems);
    const timeline = new Timeline(containerRef.current, itemSet, groupSet, {
      align: "center",
      clickToUse: false,
      editable: false,
      groupHeightMode: "auto",
      height: "390px",
      margin: { axis: 16, item: { horizontal: 10, vertical: 12 } },
      maxHeight: "480px",
      minHeight: "320px",
      moveable: true,
      multiselect: false,
      orientation: "top",
      selectable: true,
      showCurrentTime: true,
      stack: true,
      tooltip: { followMouse: true, overflowMethod: "cap" },
      verticalScroll: true,
      zoomable: true,
    });

    timelineRef.current = timeline;
    if (graphItems.length) {
      timeline.fit({ animation: false });
    }

    return () => {
      timeline.destroy();
      timelineRef.current = null;
    };
  }, [graphGroups, graphItems, loading]);

  if (loading) {
    return (
      <div className="grid gap-3">
        <div className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando histórico...
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-3">
        <div className="text-sm font-semibold text-zinc-900">
          Timeline gráfica
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-xl border-zinc-200 bg-white px-3 text-xs"
            onClick={() =>
              timelineRef.current?.fit?.({
                animation: { duration: 220, easingFunction: "easeInOutQuad" },
              })
            }
            disabled={!events.length}
          >
            Ajustar visão
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-xl border-zinc-200 bg-white px-3 text-xs"
            onClick={() =>
              timelineRef.current?.moveTo?.(new Date(), {
                animation: { duration: 220, easingFunction: "easeInOutQuad" },
              })
            }
          >
            Hoje
          </Button>
        </div>
      </div>

      {events.length ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div
            ref={containerRef}
            className="ticket-history-graph min-h-[320px] overflow-hidden rounded-xl border border-zinc-100 bg-white"
          />
          <style>{`
            .ticket-history-graph .vis-labelset .vis-label {
              border-color: #e4e4e7;
            }
            .ticket-history-graph .vis-time-axis .vis-text {
              color: #71717a;
              font-size: 11px;
            }
            .ticket-history-graph .vis-panel.vis-center,
            .ticket-history-graph .vis-panel.vis-left,
            .ticket-history-graph .vis-panel.vis-right,
            .ticket-history-graph .vis-panel.vis-top,
            .ticket-history-graph .vis-panel.vis-bottom {
              border-color: #e4e4e7;
            }
            .ticket-history-graph-group {
              align-items: center;
              border-radius: 999px;
              display: inline-flex;
              gap: 8px;
              max-width: 150px;
              padding: 6px 10px;
            }
            .ticket-history-graph-group span {
              align-items: center;
              border-radius: 999px;
              display: inline-flex;
              font-size: 11px;
              font-weight: 800;
              height: 22px;
              justify-content: center;
              width: 22px;
            }
            .ticket-history-graph-group strong {
              color: #18181b;
              font-size: 12px;
              white-space: nowrap;
            }
            .ticket-history-graph-group-status {
              background: #eff6ff;
            }
            .ticket-history-graph-group-status span {
              background: #dbeafe;
              color: #1d4ed8;
            }
            .ticket-history-graph-group-comments {
              background: #f5f3ff;
            }
            .ticket-history-graph-group-comments span {
              background: #ede9fe;
              color: #6d28d9;
            }
            .ticket-history-graph-group-activities {
              background: #fafaf9;
            }
            .ticket-history-graph-group-activities span {
              background: #fef3c7;
              color: #92400e;
            }
            .ticket-history-graph .vis-item.ticket-history-graph-vis-item {
              border-radius: 12px;
              border-width: 1px;
              box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
              overflow: hidden;
            }
            .ticket-history-graph .vis-item .vis-item-content {
              padding: 0;
            }
            .ticket-history-graph-item {
              display: grid;
              gap: 2px;
              line-height: 1.2;
              max-width: 260px;
              min-width: 150px;
              padding: 8px 10px;
            }
            .ticket-history-graph-item strong {
              color: #18181b;
              font-size: 12px;
            }
            .ticket-history-graph-item span {
              color: #3f3f46;
              font-size: 11px;
              white-space: normal;
            }
            .ticket-history-graph .vis-item.ticket-history-graph-vis-comments {
              background: #eff6ff;
              border-color: #bfdbfe;
            }
            .ticket-history-graph .vis-item.ticket-history-graph-vis-activities {
              background: #fafafa;
              border-color: #d4d4d8;
            }
            .ticket-history-graph .vis-item.ticket-history-graph-vis-status-blue {
              background: #dbeafe;
              border-color: #60a5fa;
            }
            .ticket-history-graph .vis-item.ticket-history-graph-vis-status-yellow {
              background: #fef3c7;
              border-color: #f59e0b;
            }
            .ticket-history-graph .vis-item.ticket-history-graph-vis-status-green {
              background: #dcfce7;
              border-color: #22c55e;
            }
            .ticket-history-graph .vis-item.ticket-history-graph-vis-status-gray {
              background: #f4f4f5;
              border-color: #a1a1aa;
            }
            .ticket-history-graph .vis-item.vis-selected {
              box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.25), 0 12px 26px rgba(15, 23, 42, 0.12);
            }
          `}</style>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center">
          <History className="mx-auto h-8 w-8 text-zinc-300" />
          <div className="mt-3 text-sm font-semibold text-zinc-900">
            Nenhum evento para exibir no gráfico.
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Ajuste os filtros ou consulte um ticket com movimentações no Jira.
          </p>
        </div>
      )}
    </section>
  );
}

function TicketOperationalHistory({ active, issueKey, issue }) {
  const [loading, setLoading] = useState(false);
  const [loadedKey, setLoadedKey] = useState("");
  const [events, setEvents] = useState([]);
  const [failures, setFailures] = useState([]);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState({});
  const [historyView, setHistoryView] = useState("list");

  useEffect(() => {
    if (!active || !issueKey || loadedKey === issueKey) return;
    let alive = true;
    setLoading(true);
    setFailures([]);

    Promise.allSettled([
      getComments(issueKey),
      jiraGetIssueChangelog(issueKey, { maxResults: 100 }),
    ])
      .then((results) => {
        if (!alive) return;
        const nextEvents = [];
        const nextFailures = [];
        const [commentsResult, changelogResult] = results;

        if (commentsResult.status === "fulfilled") {
          const list =
            commentsResult.value?.comments ||
            commentsResult.value?.values ||
            commentsResult.value ||
            [];
          if (Array.isArray(list)) {
            list.forEach((comment) => {
              const event = normalizeHistoryComment(comment, issueKey);
              if (event) nextEvents.push(event);
            });
          }
        } else {
          nextFailures.push("comentários");
        }

        if (changelogResult.status === "fulfilled") {
          const histories =
            changelogResult.value?.values ||
            changelogResult.value?.histories ||
            [];
          if (Array.isArray(histories)) {
            histories.forEach((history) => {
              (history?.items || []).forEach((item, index) => {
                const event = normalizeHistoryChange(
                  history,
                  item,
                  issueKey,
                  index,
                );
                if (event) nextEvents.push(event);
              });
            });
          }
        } else {
          nextFailures.push("changelog");
        }

        const attachments = Array.isArray(issue?.fields?.attachment)
          ? issue.fields.attachment
          : [];
        attachments.forEach((attachment) => {
          const event = normalizeHistoryAttachment(attachment, issueKey);
          if (event) nextEvents.push(event);
        });

        nextEvents.sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
        setEvents(nextEvents);
        setFailures(nextFailures);
        setLoadedKey(issueKey);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [active, issueKey, loadedKey, issue]);

  useEffect(() => {
    if (!active) return;
    setFilter("all");
    setQuery("");
    setExpanded({});
    setHistoryView("list");
  }, [active, issueKey]);

  const filteredEvents = useMemo(() => {
    const normalizedQuery = normalizePlain(query);
    return events.filter((event) => {
      const meta = HISTORY_EVENT_META[event.type] || HISTORY_EVENT_META.other;
      if (filter !== "all" && meta.filter !== filter) return false;
      if (!normalizedQuery) return true;
      return normalizePlain(
        `${event.title} ${event.actor} ${event.field} ${event.from} ${event.to} ${event.bodyText} ${event.searchText}`,
      ).includes(normalizedQuery);
    });
  }, [events, filter, query]);

  const groupedEvents = useMemo(
    () => groupHistoryEventsByDay(filteredEvents),
    [filteredEvents],
  );
  const latestEvent = events[0] || null;

  return (
    <section className="grid gap-3">
      <div className="rounded-xl border border-zinc-200 bg-white p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                {events.length} evento(s)
              </Badge>
              {latestEvent ? (
                <Badge className="rounded-full border border-sky-200 bg-sky-50 text-sky-700">
                  Última movimentação:{" "}
                  {formatHistoryDateTime(latestEvent.createdAt)}
                </Badge>
              ) : null}
            </div>
            {failures.length ? (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Leitura parcial: não foi possível carregar{" "}
                {failures.join(" e ")}.
              </div>
            ) : null}
          </div>

          <div className="relative min-w-0 lg:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar no histórico..."
              className="h-10 rounded-xl border-zinc-200 bg-white pl-9"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(HISTORY_EVENT_TYPES).map(([key, item]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                filter === key
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-3 inline-flex w-full rounded-2xl bg-zinc-100 p-1 sm:w-auto">
          <button
            type="button"
            className={cn(
              "flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition sm:flex-none",
              historyView === "list"
                ? "bg-white text-zinc-950 shadow-sm"
                : "text-zinc-600 hover:text-zinc-950",
            )}
            onClick={() => setHistoryView("list")}
          >
            Lista
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition sm:flex-none",
              historyView === "graph"
                ? "bg-white text-zinc-950 shadow-sm"
                : "text-zinc-600 hover:text-zinc-950",
            )}
            onClick={() => setHistoryView("graph")}
          >
            Gráfico
          </button>
        </div>
      </div>

      {historyView === "graph" ? (
        <TicketHistoryGraphTimeline events={filteredEvents} loading={loading} />
      ) : loading ? (
        <div className="grid gap-3">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando histórico...
          </div>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : groupedEvents.length ? (
        <div className="grid gap-5">
          {groupedEvents.map((group) => (
            <section key={group.key} className="grid gap-2">
              <div className="sticky top-0 z-10 w-fit rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide text-zinc-500 shadow-sm">
                {group.label}
              </div>
              <div className="relative ml-4 grid gap-3 border-l border-zinc-200 pl-5">
                {group.items.map((event) => {
                  const meta =
                    HISTORY_EVENT_META[event.type] || HISTORY_EVENT_META.other;
                  const Icon = meta.icon || History;
                  const isExpanded = Boolean(expanded[event.id]);
                  const commentLong = String(event.bodyText || "").length > 220;
                  const visibleBody =
                    commentLong && !isExpanded
                      ? `${String(event.bodyText || "").slice(0, 220)}...`
                      : event.bodyText;

                  return (
                    <article
                      key={event.id}
                      className="relative rounded-xl border border-zinc-200 bg-white p-3 shadow-sm"
                    >
                      <span className="absolute -left-[34px] top-4 grid h-7 w-7 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-sm">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              className={cn(
                                "rounded-full border",
                                meta.className,
                              )}
                            >
                              {meta.label}
                            </Badge>
                            <span className="text-xs font-medium text-zinc-500">
                              {formatHistoryTime(event.createdAt)}
                            </span>
                          </div>
                          <h3 className="mt-2 text-sm font-semibold text-zinc-950">
                            {event.title}
                          </h3>
                          <div className="mt-1 text-xs text-zinc-500">
                            Por: {event.actor || "Jira"}
                          </div>
                        </div>
                      </div>

                      {event.type === "comment" ? (
                        <div className="mt-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3 text-sm text-zinc-700">
                          <div className="whitespace-pre-wrap break-words">
                            {visibleBody || "Comentário sem texto."}
                          </div>
                          {commentLong ? (
                            <button
                              type="button"
                              className="mt-2 text-xs font-semibold text-red-700 hover:text-red-800"
                              onClick={() =>
                                setExpanded((current) => ({
                                  ...current,
                                  [event.id]: !current[event.id],
                                }))
                              }
                            >
                              {isExpanded ? "Ver menos" : "Ver mais"}
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                          <div className="min-w-0 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                              De
                            </div>
                            <div className="mt-1 break-words font-medium text-zinc-800">
                              {event.from || "—"}
                            </div>
                          </div>
                          <ArrowUpDown className="hidden h-4 w-4 text-zinc-400 sm:block" />
                          <div className="min-w-0 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                              Para
                            </div>
                            <div className="mt-1 break-words font-medium text-zinc-900">
                              {event.to || event.bodyText || "—"}
                            </div>
                          </div>
                        </div>
                      )}

                      {event.field && event.type !== "comment" ? (
                        <div className="mt-2 text-xs text-zinc-500">
                          Campo: {event.field}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center">
          <History className="mx-auto h-8 w-8 text-zinc-300" />
          <div className="mt-3 text-sm font-semibold text-zinc-900">
            Nenhum evento encontrado.
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Ajuste os filtros ou atualize o ticket no Jira para criar histórico.
          </p>
        </div>
      )}
    </section>
  );
}

function TicketDetailsDialog({
  open,
  onOpenChange,
  issueKey,
  ticketMetaMap,
  statusOptions = [],
  priorityOptions = [],
  onChangeStatus,
  onChangePriority,
  onChangeDueDate,
  onDocumentationFlagChange,
  onOpenDocumentation,
  onOpenSchedule,
  onTicketUpdated,
  onMarkedStarted,
}) {
  const [loading, setLoading] = useState(false);
  const [issue, setIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [err, setErr] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState("");
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [savingDueDate, setSavingDueDate] = useState(false);
  const [dueDateSaveState, setDueDateSaveState] = useState("");
  const [savingFolderFlag, setSavingFolderFlag] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [savingStarted, setSavingStarted] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [detailsView, setDetailsView] = useState("summary");

  useEffect(() => {
    if (!open || !issueKey) return;

    let alive = true;
    setLoading(true);
    setErr("");
    setIssue(null);
    setComments([]);
    setPreviewAttachment(null);
    setDetailsView("summary");

    Promise.allSettled([
      getIssue(issueKey, TICKET_DETAILS_FIELDS),
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
    setDueDateDraft(String(issue.fields.duedate || "").slice(0, 10));
  }, [issueKey, issue]);

  useEffect(() => {
    setDueDateSaveState("");
  }, [issueKey]);

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
  const canOrganizeDocumentation = !folderCreated;
  const hasAttachmentField = Array.isArray(f?.attachment);
  const attachments = hasAttachmentField ? f.attachment : [];
  const attachmentsCount = hasAttachmentField
    ? attachments.length
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
  const currentDueYmd = String(f?.duedate || "").slice(0, 10);
  const dueLabel = meta?.overdueDays
    ? `Atrasado ${meta.overdueDays}d`
    : currentDueYmd
      ? fmtDateBr(currentDueYmd)
      : "Sem data limite";

  async function applyDetailsStatus() {
    if (!issueKey || !statusDraft || statusDraft === f?.status?.name) return;
    setSavingStatus(true);
    setErr("");
    try {
      const freshIssue = await onChangeStatus?.(issueKey, statusDraft);
      if (freshIssue) {
        setIssue(freshIssue?.fields ? freshIssue : { fields: freshIssue });
      } else {
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
      }
    } catch (e) {
      setErr(
        formatJiraActionableError(e, {
          type: "transition",
          issueKey,
          fallback: "Falha ao alterar status.",
        }),
      );
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
      const freshIssue = await onChangePriority?.(issueKey, priorityDraft);
      if (freshIssue) {
        setIssue(freshIssue?.fields ? freshIssue : { fields: freshIssue });
      } else {
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
      }
    } catch (e) {
      setErr(
        formatJiraActionableError(e, {
          type: "priority",
          issueKey,
          fallback: "Falha ao alterar prioridade.",
        }),
      );
    } finally {
      setSavingPriority(false);
    }
  }

  async function applyDetailsDueDate(nextValue) {
    const nextDueDate = String(nextValue || "").slice(0, 10);
    if (!issueKey || nextDueDate === currentDueYmd) return;

    const previousDueDate = currentDueYmd;
    setSavingDueDate(true);
    setDueDateSaveState("saving");
    setErr("");
    setDueDateDraft(nextDueDate);
    setIssue((prev) =>
      prev
        ? {
            ...prev,
            fields: {
              ...(prev.fields || {}),
              duedate: nextDueDate || null,
            },
          }
        : prev,
    );

    try {
      const freshIssue = await onChangeDueDate?.(issueKey, nextDueDate);
      if (freshIssue) {
        setIssue(freshIssue?.fields ? freshIssue : { fields: freshIssue });
      }
      setDueDateSaveState("saved");
    } catch (e) {
      setDueDateDraft(previousDueDate);
      setIssue((prev) =>
        prev
          ? {
              ...prev,
              fields: {
                ...(prev.fields || {}),
                duedate: previousDueDate || null,
              },
            }
          : prev,
      );
      setDueDateSaveState("error");
      setErr(
        formatJiraActionableError(e, {
          type: "dueDate",
          issueKey,
          fallback: "Falha ao alterar prazo.",
        }),
      );
    } finally {
      setSavingDueDate(false);
    }
  }

  function handleDueDateChange(event) {
    const nextValue = event.target.value;
    setDueDateDraft(nextValue);
    if (!nextValue || /^\d{4}-\d{2}-\d{2}$/.test(nextValue)) {
      applyDetailsDueDate(nextValue);
    }
  }

  async function toggleDocumentationFolderFlag() {
    if (!issueKey) return;
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

  async function markDetailsAsStarted() {
    if (!issueKey) return;
    setSavingStarted(true);
    setErr("");
    try {
      const freshIssue = await onMarkedStarted?.();
      if (freshIssue) {
        setIssue(freshIssue?.fields ? freshIssue : { fields: freshIssue });
      }
      const refreshedComments = await getComments(issueKey).catch(() => null);
      const list =
        refreshedComments?.comments ||
        refreshedComments?.values ||
        refreshedComments ||
        [];
      if (Array.isArray(list)) setComments(list);
    } catch (e) {
      setErr(
        formatJiraActionableError(e, {
          type: "comment",
          issueKey,
          fallback: "Falha ao marcar ticket como iniciado.",
        }),
      );
    } finally {
      setSavingStarted(false);
    }
  }

  const progressLabel = meta?.hasStarted
    ? latestCommentText
    : "Sem comentário de início";
  const isTicketStarted = Boolean(
    meta?.hasStarted ||
    ticketHasIniciadoTag(issue) ||
    comments.some((comment) => /\[INICIADO\]/i.test(safeText(comment?.body))),
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl rounded-2xl sm:w-full max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-start gap-2 min-w-0">
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <IssueTypeIcon ticket={issue} />
                <code className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold">
                  {issueKey || "—"}
                </code>
              </span>

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

          <div className="inline-flex w-full rounded-2xl bg-zinc-100 p-1 sm:w-auto">
            <button
              type="button"
              className={cn(
                "flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition sm:flex-none",
                detailsView === "summary"
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-600 hover:text-zinc-950",
              )}
              onClick={() => setDetailsView("summary")}
            >
              Resumo
            </button>
            <button
              type="button"
              className={cn(
                "flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition sm:flex-none",
                detailsView === "history"
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-600 hover:text-zinc-950",
              )}
              onClick={() => setDetailsView("history")}
            >
              Histórico
            </button>
          </div>

          {detailsView === "summary" ? (
            <div className="grid gap-3">
              {/* resumo */}
              <div className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                {loading ? (
                  <div className="grid gap-2">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Carregando detalhes...
                    </div>
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
                  <label className="mt-2 grid gap-1">
                    <span className="sr-only">Data limite</span>
                    <Input
                      type="date"
                      value={dueDateDraft}
                      onChange={handleDueDateChange}
                      disabled={loading || savingDueDate || !issue}
                      className="h-9 rounded-xl border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900"
                    />
                  </label>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                    {savingDueDate ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Salvando no Jira...
                      </>
                    ) : dueDateSaveState === "saved" ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        Prazo salvo no Jira.
                      </>
                    ) : dueDateSaveState === "error" ? (
                      <>
                        <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                        Falha ao salvar prazo.
                      </>
                    ) : meta?.dueSoon ? (
                      "Vence nos próximos 7 dias"
                    ) : (
                      dueLabel
                    )}
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

              <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-3 sm:grid-cols-2">
                <div className="grid min-w-0 gap-2 rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                  <div className="text-sm font-semibold text-zinc-900">
                    Status do ticket
                  </div>
                  <select
                    value={statusDraft || f?.status?.name || ""}
                    onChange={(event) => setStatusDraft(event.target.value)}
                    disabled={loading || savingStatus || !issue}
                    className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
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
                    className="h-9 w-full rounded-xl border-zinc-200 bg-white"
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

                <div className="grid min-w-0 gap-2 rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                  <div className="text-sm font-semibold text-zinc-900">
                    Prioridade
                  </div>
                  <select
                    value={priorityDraft || f?.priority?.name || ""}
                    onChange={(event) => setPriorityDraft(event.target.value)}
                    disabled={loading || savingPriority || !issue}
                    className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
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
                    className="h-9 w-full rounded-xl border-zinc-200 bg-white"
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

                <div className="grid min-w-0 gap-2 rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                  <div className="text-sm font-semibold text-zinc-900">
                    Documentação
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={folderCreated}
                    onClick={toggleDocumentationFolderFlag}
                    disabled={loading || savingFolderFlag || !issue}
                    className={cn(
                      "flex h-10 w-full items-center justify-between rounded-xl border px-3 text-sm font-semibold transition",
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

                  {canOrganizeDocumentation ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 w-full rounded-xl border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
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

                <div className="grid min-w-0 gap-2 rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                  <div className="text-sm font-semibold text-zinc-900">
                    Cronograma
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-full rounded-xl border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                    onClick={() => onOpenSchedule?.(issue)}
                    disabled={loading || !issue}
                  >
                    <CalendarDays className="mr-2 h-4 w-4" />
                    Criar cronograma
                  </Button>
                  <div className="text-xs text-zinc-500">
                    {cronogramaActivities.length
                      ? `${cronogramaActivities.length} atividade(s) cadastrada(s).`
                      : "Abrir editor de cronograma."}
                  </div>
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
                  <div className="min-h-32 max-h-[70vh] resize-y overflow-y-auto rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-800">
                    <div className="whitespace-pre-wrap break-words">
                      {descText || "—"}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-zinc-900">
                    Anexos
                  </div>
                  <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                    {attachmentsCount} arquivo(s)
                  </Badge>
                </div>

                {loading ? (
                  <div className="grid gap-2">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Carregando anexos...
                    </div>
                    <Skeleton className="h-12 w-full rounded-xl" />
                    <Skeleton className="h-12 w-full rounded-xl" />
                  </div>
                ) : attachments.length ? (
                  <div className="grid gap-2">
                    {attachments.map((attachment) => {
                      const links = buildDownloadLinks(attachment);
                      const previewable = isPreviewableAttachment(attachment);
                      const filename = attachment?.filename || "arquivo";
                      const sizeKb = Number(attachment?.size || 0) / 1024;
                      return (
                        <div
                          key={attachment?.id || filename}
                          className="flex min-w-0 items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
                        >
                          <FileText className="h-4 w-4 shrink-0 text-zinc-500" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-zinc-900">
                              {filename}
                            </div>
                            <div className="text-xs text-zinc-500">
                              {sizeKb
                                ? `${sizeKb.toFixed(1)} KB`
                                : "Tamanho nao informado"}
                            </div>
                          </div>

                          {previewable ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewAttachment(attachment)
                                  }
                                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                                  aria-label={`Preview de ${filename}`}
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Visualizar arquivo
                              </TooltipContent>
                            </Tooltip>
                          ) : null}

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href={links.download}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
                                aria-label={`Baixar ${filename}`}
                              >
                                <Download className="h-4 w-4" />
                              </a>
                            </TooltipTrigger>
                            <TooltipContent>Baixar arquivo</TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-center text-sm text-zinc-500">
                    Nenhum anexo encontrado.
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
                              <div className="text-xs text-zinc-500">
                                {created}
                              </div>
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
          ) : (
            <TicketOperationalHistory
              active={detailsView === "history"}
              issueKey={issueKey}
              issue={issue}
            />
          )}

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="rounded-xl border-zinc-200 bg-white"
                onClick={() => setEditOpen(true)}
                disabled={!issueKey || loading || !issue}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Editar ticket
              </Button>

              {!isTicketStarted ? (
                <Button
                  variant="outline"
                  className="rounded-xl border-zinc-200 bg-white"
                  onClick={markDetailsAsStarted}
                  disabled={!issueKey || savingStarted}
                >
                  {savingStarted ? "Salvando..." : "Marcar como iniciado"}
                </Button>
              ) : null}

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
                <a
                  href={jiraBrowseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
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
      <EditJiraIssueDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        issueKey={issueKey}
        onSaved={async (savedIssueKey) => {
          const freshIssue = await onTicketUpdated?.(savedIssueKey || issueKey);
          if (freshIssue) {
            const normalized = freshIssue?.fields
              ? freshIssue
              : { fields: freshIssue };
            setIssue(normalized);
          }
          return freshIssue;
        }}
      />
      <AttachmentPreviewModal
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </>
  );
}

function editOptionId(option) {
  return String(
    option?.id ||
      option?.accountId ||
      option?.key ||
      option?.value ||
      option?.name ||
      "",
  );
}

function valueToEditFormValue(field, value) {
  if (value == null) return "";
  const schema = field?.schema || {};

  if (Array.isArray(value)) {
    return value
      .map((item) =>
        valueToEditFormValue(
          { ...field, schema: { ...schema, type: "item" } },
          item,
        ),
      )
      .filter(Boolean);
  }

  if (schema.type === "date") return String(value || "").slice(0, 10);
  if (schema.type === "datetime") {
    const raw = String(value || "");
    if (!raw) return "";
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    }
    return raw.slice(0, 16);
  }
  if (schema.type === "user") return value?.accountId || "";
  if (schema.type === "array") {
    return Array.isArray(value) ? value.map(editOptionId).filter(Boolean) : [];
  }
  if (typeof value === "object") {
    const parentId = editOptionId(value);
    const childId = editOptionId(value?.child);
    if (parentId && childId) return `${parentId}::${childId}`;
    return parentId || value?.displayName || value?.name || value?.value || "";
  }
  return String(value);
}

function clearValueForField(field) {
  const schema = field?.schema || {};
  if (schema.type === "array") return [];
  return null;
}

function areEditValuesEqual(a, b) {
  return JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
}

function summarizeEditValue(field, value) {
  if (isEmptyValue(value)) return "—";
  if (Array.isArray(value)) {
    return value.map((item) => summarizeEditValue(field, item)).join(", ");
  }

  const raw = String(value || "");
  const schema = field?.schema || {};
  const allowedValues = Array.isArray(field?.allowedValues)
    ? field.allowedValues
    : [];

  if (raw.includes("::")) {
    return raw
      .split("::")
      .map((part) => summarizeEditValue(field, part))
      .join(" / ");
  }

  const option = allowedValues.find((item) => editOptionId(item) === raw);
  const label =
    option?.displayName || option?.name || option?.value || option?.key || raw;

  const normalized =
    schema.type === "date"
      ? fmtDateBr(raw)
      : schema.type === "datetime"
        ? raw.replace("T", " ")
        : String(label || raw);

  return normalized.length > 140
    ? `${normalized.slice(0, 140)}...`
    : normalized;
}

function EditJiraIssueDialog({ open, onOpenChange, issueKey, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [fieldsMeta, setFieldsMeta] = useState(null);
  const [issue, setIssue] = useState(null);
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [parentKey, setParentKey] = useState("");
  const [fieldValues, setFieldValues] = useState({});
  const [initialValues, setInitialValues] = useState({});

  const fields = useMemo(() => toFieldList(fieldsMeta), [fieldsMeta]);
  const fieldById = useMemo(
    () => new Map(fields.map((field) => [getFieldId(field), field])),
    [fields],
  );
  const summaryField = fieldById.get("summary");
  const descriptionField = fieldById.get("description");
  const parentField = fieldById.get("parent");
  const editableExtraFields = useMemo(
    () =>
      fields.filter((field) => {
        const id = getFieldId(field);
        return ![
          "summary",
          "description",
          "parent",
          "project",
          "issuetype",
          "status",
          "attachment",
        ].includes(id);
      }),
    [fields],
  );
  const grouped = useMemo(
    () => groupFields(editableExtraFields),
    [editableExtraFields],
  );
  const modalBusy = loading || saving;
  const projectKey = issue?.fields?.project?.key || "";
  const parentJql = projectKey
    ? `project = ${projectKey} ORDER BY updated DESC`
    : "";

  const requiredErrors = useMemo(() => {
    const errors = {};
    if (
      summaryField &&
      isFieldRequired(summaryField) &&
      !String(summary || "").trim()
    ) {
      errors.summary = "Resumo e obrigatorio.";
    }
    if (
      descriptionField &&
      isFieldRequired(descriptionField) &&
      !String(description || "").trim()
    ) {
      errors.description = "Descricao e obrigatoria.";
    }
    if (
      parentField &&
      isFieldRequired(parentField) &&
      !String(parentKey || "").trim()
    ) {
      errors.parent = "Ticket pai e obrigatorio.";
    }
    editableExtraFields.forEach((field) => {
      const id = getFieldId(field);
      if (!id || !isFieldRequired(field)) return;
      if (isEmptyValue(fieldValues[id])) {
        errors[id] = `${getFieldName(field)} e obrigatorio.`;
      }
    });
    return errors;
  }, [
    description,
    descriptionField,
    editableExtraFields,
    fieldValues,
    parentField,
    parentKey,
    summary,
    summaryField,
  ]);

  const visibleFieldErrors = useMemo(
    () => ({ ...requiredErrors, ...fieldErrors }),
    [fieldErrors, requiredErrors],
  );

  const pendingChanges = useMemo(() => {
    const changes = [];
    if (summaryField && !areEditValuesEqual(summary, initialValues.summary)) {
      changes.push({
        id: "summary",
        label: getFieldName(summaryField),
        before: summarizeEditValue(summaryField, initialValues.summary),
        after: summarizeEditValue(summaryField, summary),
      });
    }
    if (
      descriptionField &&
      !areEditValuesEqual(description, initialValues.description)
    ) {
      changes.push({
        id: "description",
        label: getFieldName(descriptionField),
        before: summarizeEditValue(descriptionField, initialValues.description),
        after: summarizeEditValue(descriptionField, description),
      });
    }
    if (parentField && !areEditValuesEqual(parentKey, initialValues.parent)) {
      changes.push({
        id: "parent",
        label: getFieldName(parentField),
        before: summarizeEditValue(parentField, initialValues.parent),
        after: summarizeEditValue(parentField, parentKey),
      });
    }
    editableExtraFields.forEach((field) => {
      const id = getFieldId(field);
      if (!id) return;
      const nextValue = fieldValues[id];
      const previousValue = initialValues.fields?.[id];
      if (areEditValuesEqual(nextValue, previousValue)) return;
      changes.push({
        id,
        label: getFieldName(field),
        before: summarizeEditValue(field, previousValue),
        after: summarizeEditValue(field, nextValue),
      });
    });
    return changes;
  }, [
    description,
    descriptionField,
    editableExtraFields,
    fieldValues,
    initialValues,
    parentField,
    parentKey,
    summary,
    summaryField,
  ]);

  const hasRequiredErrors = Object.keys(requiredErrors).length > 0;

  useEffect(() => {
    if (!open || !issueKey) return;

    let alive = true;
    async function load() {
      const key = String(issueKey || "")
        .trim()
        .toUpperCase();
      setLoading(true);
      setErr("");
      setFieldErrors({});
      setFieldsMeta(null);
      setIssue(null);
      setSummary("");
      setDescription("");
      setParentKey("");
      setFieldValues({});
      setInitialValues({});

      try {
        const meta = await jiraGetIssueEditMeta(key);
        if (!alive) return;
        const metaFields = toFieldList(meta);
        const fieldIds = metaFields.map(getFieldId).filter(Boolean);
        const detailFields = Array.from(
          new Set([...fieldIds, ...TICKET_DETAILS_FIELDS.split(",")]),
        ).join(",");
        const data = await getIssue(key, detailFields);
        if (!alive) return;

        const normalized = data?.fields ? data : { fields: data };
        const f = normalized.fields || {};
        const nextSummary = String(f.summary || "");
        const nextDescription = safeText(f.description);
        const nextParentKey = String(f.parent?.key || "");
        const nextFieldValues = {};

        metaFields.forEach((field) => {
          const id = getFieldId(field);
          if (
            !id ||
            [
              "summary",
              "description",
              "parent",
              "project",
              "issuetype",
              "status",
              "attachment",
            ].includes(id)
          ) {
            return;
          }
          const value = valueToEditFormValue(field, f[id]);
          if (!isEmptyValue(value)) nextFieldValues[id] = value;
        });

        const nextInitialValues = {
          summary: nextSummary,
          description: nextDescription,
          parent: nextParentKey,
          fields: nextFieldValues,
        };

        setFieldsMeta(meta);
        setIssue(normalized);
        setSummary(nextSummary);
        setDescription(nextDescription);
        setParentKey(nextParentKey);
        setFieldValues(nextFieldValues);
        setInitialValues(nextInitialValues);
      } catch (error) {
        if (alive) {
          setErr(
            formatJiraActionableError(error, {
              type: "edit",
              issueKey: key,
              fallback: "Falha ao carregar campos editáveis do Jira.",
            }),
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [open, issueKey]);

  function clearEditFieldError(fieldId) {
    setFieldErrors((prev) => {
      if (!prev?.[fieldId]) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }

  function setFieldValue(fieldId, value) {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
    clearEditFieldError(fieldId);
  }

  function validateEditForm() {
    setFieldErrors(requiredErrors);
    return Object.keys(requiredErrors).length === 0;
  }

  function buildEditPayload() {
    const payloadFields = {};

    if (summaryField && !areEditValuesEqual(summary, initialValues.summary)) {
      payloadFields.summary = String(summary || "").trim();
    }
    if (
      descriptionField &&
      !areEditValuesEqual(description, initialValues.description)
    ) {
      payloadFields.description = isEmptyValue(description)
        ? null
        : adfFromPlainText(description);
    }
    if (parentField && !areEditValuesEqual(parentKey, initialValues.parent)) {
      payloadFields.parent = isEmptyValue(parentKey)
        ? null
        : formatFieldValue(parentField, parentKey);
    }

    editableExtraFields.forEach((field) => {
      const id = getFieldId(field);
      if (!id) return;
      const nextValue = fieldValues[id];
      const previousValue = initialValues.fields?.[id];
      if (areEditValuesEqual(nextValue, previousValue)) return;
      payloadFields[id] = isEmptyValue(nextValue)
        ? clearValueForField(field)
        : formatFieldValue(field, nextValue);
    });

    return { fields: payloadFields };
  }

  async function submitEdit() {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!key || !validateEditForm()) return;

    const payload = buildEditPayload();
    if (!pendingChanges.length || !Object.keys(payload.fields || {}).length) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    setErr("");
    setFieldErrors({});
    try {
      await jiraEditIssue(key, payload);
      toast.success(`${key} atualizado no Jira.`);
      await onSaved?.(key);
      onOpenChange(false);
    } catch (error) {
      const body = error?.body || {};
      if (body?.errors && typeof body.errors === "object") {
        setFieldErrors(body.errors);
      }
      setErr(
        formatJiraActionableError(error, {
          type: "edit",
          issueKey: key,
          fallback: "Falha ao salvar ticket no Jira.",
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl rounded-2xl sm:w-full max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <code className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold">
              {issueKey || "-"}
            </code>
            Editar ticket
          </DialogTitle>
          <DialogDescription>
            Campos editaveis carregados do Jira para este ticket.
          </DialogDescription>
        </DialogHeader>

        {err ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className="grid gap-3">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-44 rounded-2xl" />
          </div>
        ) : (
          <div className="grid gap-4">
            <section className="sticky top-0 z-10 rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-sm backdrop-blur">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900">
                    Alterações pendentes
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Somente os campos alterados abaixo serão enviados ao Jira.
                  </p>
                </div>
                <Badge
                  className={cn(
                    "w-fit rounded-full border",
                    pendingChanges.length
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700",
                  )}
                >
                  {pendingChanges.length
                    ? `${pendingChanges.length} campo(s) alterado(s)`
                    : "Sem alterações"}
                </Badge>
              </div>

              {hasRequiredErrors ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  Preencha os campos obrigatórios marcados antes de salvar.
                </div>
              ) : null}

              {pendingChanges.length ? (
                <div className="mt-3 grid max-h-44 gap-2 overflow-y-auto pr-1">
                  {pendingChanges.map((change) => (
                    <div
                      key={change.id}
                      className="grid gap-1 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs"
                    >
                      <div className="font-semibold text-zinc-900">
                        {change.label}
                      </div>
                      <div className="grid gap-1 text-zinc-600 sm:grid-cols-2">
                        <span>
                          Atual:{" "}
                          <span className="font-medium text-zinc-800">
                            {change.before}
                          </span>
                        </span>
                        <span>
                          Novo:{" "}
                          <span className="font-medium text-zinc-900">
                            {change.after}
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                  Edite algum campo para habilitar o salvamento.
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="mb-3 flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-zinc-900">
                  Campos principais
                </h3>
                <p className="text-xs text-zinc-500">
                  Resumo, descricao e relacionamento principal do ticket.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {summaryField ? (
                  <label className="grid gap-1.5 md:col-span-2">
                    <span className="text-xs font-semibold text-zinc-700">
                      {getFieldName(summaryField)}
                      {isFieldRequired(summaryField) ? (
                        <span className="ml-1 text-red-600">*</span>
                      ) : null}
                    </span>
                    <Input
                      value={summary}
                      onChange={(event) => {
                        setSummary(event.target.value);
                        clearEditFieldError("summary");
                      }}
                      disabled={modalBusy}
                      className="rounded-xl border-zinc-200 bg-white"
                    />
                    {visibleFieldErrors.summary ? (
                      <span className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                        {visibleFieldErrors.summary}
                      </span>
                    ) : null}
                  </label>
                ) : null}

                {descriptionField ? (
                  <label className="grid gap-1.5 md:col-span-2">
                    <span className="text-xs font-semibold text-zinc-700">
                      {getFieldName(descriptionField)}
                      {isFieldRequired(descriptionField) ? (
                        <span className="ml-1 text-red-600">*</span>
                      ) : null}
                    </span>
                    <Textarea
                      value={description}
                      onChange={(event) => {
                        setDescription(event.target.value);
                        clearEditFieldError("description");
                      }}
                      disabled={modalBusy}
                      rows={6}
                      className="rounded-xl border-zinc-200 bg-white"
                    />
                    {visibleFieldErrors.description ? (
                      <span className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                        {visibleFieldErrors.description}
                      </span>
                    ) : null}
                  </label>
                ) : null}

                {parentField ? (
                  <GenericField
                    field={parentField}
                    value={parentKey}
                    onChange={(value) => {
                      setParentKey(value);
                      clearEditFieldError("parent");
                    }}
                    disabled={modalBusy}
                    fieldErrors={visibleFieldErrors}
                    projectKey={projectKey}
                    parentJql={parentJql}
                  />
                ) : null}
              </div>
            </section>

            {Object.entries(grouped).map(([section, items]) =>
              items.length ? (
                <section
                  key={section}
                  className="rounded-2xl border border-zinc-200 bg-white p-4"
                >
                  <div className="mb-3 flex flex-col gap-1">
                    <h3 className="text-sm font-semibold text-zinc-900">
                      {SECTION_TITLES[section] || "Campos do Jira"}
                    </h3>
                    <p className="text-xs text-zinc-500">
                      Campos editaveis retornados pelo Jira para este ticket.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {items.map((field) => {
                      const id = getFieldId(field);
                      return (
                        <GenericField
                          key={id}
                          field={field}
                          value={fieldValues[id]}
                          onChange={(value) => setFieldValue(id, value)}
                          disabled={modalBusy}
                          fieldErrors={visibleFieldErrors}
                          projectKey={projectKey}
                          parentJql={parentJql}
                        />
                      );
                    })}
                  </div>
                </section>
              ) : null,
            )}

            {!fields.length ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                Nenhum campo editavel retornado pelo Jira para este ticket.
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl border-zinc-200 bg-white"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="rounded-xl bg-red-600 text-white hover:bg-red-700"
            onClick={submitEdit}
            disabled={
              modalBusy || !issue || !pendingChanges.length || hasRequiredErrors
            }
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? "Salvando..." : "Salvar alteracoes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttachmentPreviewModal({ attachment, onClose }) {
  const bodyRef = useRef(null);
  const styleRef = useRef(null);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");

  const open = Boolean(attachment);
  const filename = attachment?.filename || "arquivo";
  const links = attachment ? buildDownloadLinks(attachment) : null;
  const previewKind = attachment ? getAttachmentPreviewKind(attachment) : "";

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setErr("");
    setStatus("");

    if (bodyRef.current) bodyRef.current.innerHTML = "";
    if (styleRef.current) styleRef.current.innerHTML = "";

    if (previewKind !== "docx" || !links?.inline) return;

    async function renderDocxPreview() {
      setStatus("Carregando preview...");
      try {
        const response = await fetch(links.inline);
        if (!response.ok) {
          throw new Error(`Falha ao carregar arquivo (${response.status}).`);
        }

        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;

        setStatus("Renderizando DOCX...");
        await renderAsync(arrayBuffer, bodyRef.current, styleRef.current, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
        });

        if (!cancelled) setStatus("");
      } catch (e) {
        if (cancelled) return;
        setStatus("");
        setErr(e?.message || "Não foi possível renderizar o preview.");
      }
    }

    renderDocxPreview();

    return () => {
      cancelled = true;
    };
  }, [links?.inline, open, previewKind]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent className="flex h-[min(86vh,900px)] w-[calc(100vw-2rem)] max-w-6xl flex-col overflow-hidden rounded-2xl p-0 sm:w-full">
        <DialogHeader className="border-b border-zinc-200 bg-zinc-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base text-zinc-900">
                Preview do anexo
              </DialogTitle>
              <DialogDescription className="truncate text-sm text-zinc-600">
                {filename}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {links?.download ? (
                <Button
                  asChild
                  variant="outline"
                  className="rounded-xl border-zinc-200 bg-white"
                >
                  <a href={links.download} target="_blank" rel="noreferrer">
                    <Download className="mr-2 h-4 w-4" />
                    Baixar
                  </a>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-zinc-200 bg-white"
                onClick={onClose}
              >
                Fechar
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto bg-zinc-100">
          {previewKind === "pdf" && links?.inline ? (
            <iframe
              title={`Preview de ${filename}`}
              src={links.inline}
              className="h-full min-h-[68vh] w-full border-0 bg-white"
            />
          ) : previewKind === "docx" ? (
            <div className="min-h-full">
              {(status || err) && (
                <div
                  className={cn(
                    "border-b px-4 py-3 text-sm",
                    err
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-zinc-200 bg-white text-zinc-700",
                  )}
                >
                  {err || status}
                </div>
              )}
              <div ref={styleRef} />
              <div ref={bodyRef} className="p-4" />
            </div>
          ) : (
            <div className="flex min-h-[58vh] items-center justify-center p-6">
              <div className="max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
                <FileText className="mx-auto h-8 w-8 text-zinc-500" />
                <div className="mt-3 text-sm font-semibold text-zinc-900">
                  Preview local ainda nao disponivel para este formato.
                </div>
                <div className="mt-2 text-sm text-zinc-600">
                  Arquivos PPT, PPTX e DOC antigo exigem conversao antes da
                  visualizacao local. Use o botao Baixar se precisar abrir no
                  aplicativo nativo.
                </div>
              </div>
            </div>
          )}
        </div>

        <style>{`
          .docx-wrapper { background: #f1f5f9; padding: 16px; }
          .docx { background: transparent; }
        `}</style>
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
  const [confirmMissingDueDateOpen, setConfirmMissingDueDateOpen] =
    useState(false);

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
    const match = String(raw || "").match(
      /(\d{2}\/\d{2})(?:\s*a\s*(\d{2}\/\d{2}))?/i,
    );
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
    const isSingleDate = selectedRange && !/\s+a\s+/i.test(String(value || ""));
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

  function submitCronograma({ allowMissingDueDate = false } = {}) {
    setSaveAttempted(true);
    if (invalidCustomActivity) return;
    if (missingDueDate && !allowMissingDueDate) {
      setConfirmMissingDueDateOpen(true);
      return;
    }
    setConfirmMissingDueDateOpen(false);
    onSave?.(preparedDraft);
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
    <>
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
              Salva em <code className="rounded bg-zinc-100 px-1">DD/MM</code>{" "}
              ou <code className="rounded bg-zinc-100 px-1">DD/MM a DD/MM</code>
              .
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
                  )}
                />

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
                      Preencha Data, Recurso e Área. Atividades customizadas
                      podem ser renomeadas, reordenadas e excluídas.
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
                                    saveAttempted &&
                                      !a.name &&
                                      "border-red-300",
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
                                  setModeById((prev) => ({
                                    ...prev,
                                    [a.id]: m,
                                  }))
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
              onClick={() => submitCronograma()}
              disabled={loading}
            >
              {loading ? "Salvando..." : "Salvar no Jira"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmMissingDueDateOpen}
        onOpenChange={setConfirmMissingDueDateOpen}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle>Data limite não preenchida</DialogTitle>
            <DialogDescription>
              O cronograma será salvo sem data limite no Jira. Você deseja
              continuar?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-zinc-200 bg-white"
              onClick={() => setConfirmMissingDueDateOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              onClick={() => submitCronograma({ allowMissingDueDate: true })}
              disabled={loading}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
