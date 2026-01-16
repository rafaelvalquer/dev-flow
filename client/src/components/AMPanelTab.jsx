// src/components/AMPanelTab.jsx
import { memo, useEffect, useMemo, useState } from "react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { motion } from "framer-motion";

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
  ChevronsUpDown,
  Clock,
  ExternalLink,
  Filter,
  History,
  ListChecks,
  Loader2,
  Play,
  RefreshCcw,
  Search,
  UserX,
} from "lucide-react";

import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";

import { DateValuePicker } from "@/components/ui/date-range-picker";
import {
  jiraEditIssue,
  jiraSearchAssignableUsers,
  jiraSearchUsers,
  jiraTransitionToStatus,
} from "../lib/jiraClient";
import { buildCronogramaADF } from "../utils/cronograma";

import {
  applyEventChangeToAtividades,
  buildPoView,
  fetchPoIssuesDetailed,
  makeDefaultCronogramaDraft,
  saveCronogramaToJira,
} from "../lib/jiraPoView";

// NOVO: buscar detalhes do ticket + comentar
import { createComment, getComments, getIssue } from "../lib/jira";
import { adfSafeToText } from "../utils/gmudUtils";

/* =========================
   HELPERS
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
    ""
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
  "Art. Externos",
  "Para Planejar",
  "EM PLANEJAMENTO",
  "Para Dev",
  "Desenvolvimento",
  "Para Homolog.",
  "Homolog. Negócio",
  "Para Deploy",
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

/* =========================
   COMPONENT
========================= */
export default function AMPanelTab() {
  const [subView, setSubView] = useState("alertas"); // alertas | calendario
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

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

  // 1) modos de cor: ticket | recurso | atividade
  // 2) filtro por texto (ticket/tarefa/recurso)
  const [colorMode, setColorMode] = useState("ticket");
  const [calendarFilter, setCalendarFilter] = useState("");

  // ===== NOVO: Cores estáveis para FullCalendar
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

  // ✅ CORES FIXAS por atividade (modo "Por Atividade")
  const ATIVIDADE_COLOR_BY_ID = {
    devUra: "#2563EB", // azul
    rdm: "#7C3AED", // roxo
    gmud: "#F59E0B", // amarelo/amber
    hml: "#4F46E5", // indigo
    deploy: "#16A34A", // verde
  };

  const ATIVIDADE_LABEL_BY_ID = {
    devUra: "Desenvolvimento de URA",
    rdm: "Preenchimento RDM",
    gmud: "Aprovação GMUD",
    hml: "Homologação",
    deploy: "Implantação",
  };

  function normalizeStr(v) {
    return String(v || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function groupAtividadeName(rawName) {
    const original = String(rawName || "").trim();
    if (!original) return "sem atividade";

    // 1) remove conteúdo entre parênteses "(...)"
    let s = original.replace(/\([^)]*\)/g, " ");

    // 2) corta sufixos após "-" ou ":"  (ex: "AAA - BBB" -> "AAA")
    s = s.replace(/\s*[-:]\s*.*$/g, " ");

    // 3) normaliza espaços
    s = s.replace(/\s+/g, " ").trim();

    // 4) normalização final: sem acento + lowercase + trim
    const key = normalizeStr(s || original)
      .replace(/\s+/g, " ")
      .trim();

    return key || "sem atividade";
  }

  function hashStringToIndex(str, mod) {
    const s = String(str || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0; // unsigned
    }
    return mod ? h % mod : 0;
  }

  function pickColor(key) {
    const k = String(key || "—");
    const idx = hashStringToIndex(k, CALENDAR_PALETTE.length);
    return CALENDAR_PALETTE[idx];
  }

  // contraste simples: branco em cores escuras, preto em claras
  function pickTextColor(hex) {
    const c = String(hex || "").replace("#", "");
    if (c.length !== 6) return "#fff";
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    // luminância
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum > 0.62 ? "#111827" : "#ffffff"; // zinc-900 / branco
  }

  async function reload() {
    setLoading(true);
    setErr("");
    try {
      const detailed = await fetchPoIssuesDetailed({ concurrency: 8 });
      setRawIssues(detailed);
      setViewData(buildPoView(detailed));
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Falha ao carregar dados do Jira.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const filteredAlertas = useMemo(() => viewData.alertas || [], [viewData]);
  const filteredCriarCronograma = useMemo(
    () => viewData.criarCronograma || [],
    [viewData]
  );

  const calendarEvents = useMemo(() => {
    const evs = Array.isArray(viewData?.events) ? viewData.events : [];
    const issues = Array.isArray(viewData?.calendarioIssues)
      ? viewData.calendarioIssues
      : [];

    // Index rápido: issueKey::activityId -> recurso
    const recursoIndex = new Map();

    for (const iss of issues) {
      const issueKey = iss?.key;
      const atividades = Array.isArray(iss?.atividades) ? iss.atividades : [];

      for (const atv of atividades) {
        const activityId = atv?.id;
        const activityNameKey = groupAtividadeName(atv?.name);

        if (issueKey && activityId) {
          recursoIndex.set(`${issueKey}::${activityId}`, atv?.recurso);
        }

        if (issueKey && activityNameKey) {
          recursoIndex.set(
            `${issueKey}::name::${activityNameKey}`,
            atv?.recurso
          );
        }
      }
    }

    // Garante que todo evento terá extendedProps.recurso (cor + filtro)
    return evs.map((ev) => {
      const p = ev?.extendedProps || {};
      const issueKey = p.issueKey || ev?.issueKey; // não altera issueKey existente
      const activityId = p.activityId; // não altera activityId existente

      const recursoFromAtividade = recursoIndex.get(
        `${issueKey}::${activityId}`
      );
      const recurso =
        String(recursoFromAtividade || "").trim() || "Sem recurso";

      return {
        ...ev,
        extendedProps: {
          ...p,
          issueKey, // ✅ garante aqui
          activityId, // ✅ garante aqui
          recurso, // ✅ recurso vindo do cronograma
        },
      };
    });
  }, [viewData.events, viewData.calendarioIssues]);

  // ===== PRINCIPAL ALTERAÇÃO (CALENDÁRIO):
  // chave da cor por modo
  function getColorKeyByMode(ev, mode) {
    const p = ev?.extendedProps || {};

    if (mode === "ticket") {
      return p.issueKey || ev?.issueKey || "—";
    }

    if (mode === "recurso") {
      // ✅ AJUSTE 1: agora extendedProps.recurso sempre vem do cronograma
      return p.recurso || "Sem recurso";
    }

    if (mode === "atividade") {
      if (p.activityId) return String(p.activityId);

      const fullName = p.activityName || p.atividade || ev?.title || "";
      return groupAtividadeName(fullName);
    }

    return "—";
  }

  // mapa estável (legend + consistência)
  const colorMaps = useMemo(() => {
    const maps = {
      ticket: new Map(),
      recurso: new Map(),
      atividade: new Map(),
    };

    for (const ev of calendarEvents) {
      for (const mode of ["ticket", "recurso", "atividade"]) {
        const k = String(getColorKeyByMode(ev, mode) || "—");
        if (!maps[mode].has(k)) {
          const fixed = mode === "atividade" ? ATIVIDADE_COLOR_BY_ID[k] : null;

          maps[mode].set(k, fixed || pickColor(k));
        }
      }
    }
    return maps;
  }, [calendarEvents]);

  // ===== NOVO: aplica cor nos eventos sem remover extendedProps importantes
  const coloredEvents = useMemo(() => {
    const map = colorMaps[colorMode] || new Map();

    return calendarEvents.map((ev) => {
      const colorKey = String(getColorKeyByMode(ev, colorMode) || "—");
      const color = map.get(colorKey) || pickColor(colorKey);

      return {
        ...ev,
        backgroundColor: color,
        borderColor: color,
        textColor: pickTextColor(color),
      };
    });
  }, [calendarEvents, colorMode, colorMaps]);

  // filtro: ticket / atividade / recurso
  const filteredEvents = useMemo(() => {
    const q = normalizeStr(calendarFilter);
    if (!q) return coloredEvents;

    return coloredEvents.filter((ev) => {
      const p = ev?.extendedProps || {};
      const hay = normalizeStr(
        [p.issueKey, p.activityName, p.recurso, ev?.title]
          .filter(Boolean)
          .join(" ")
      );
      return hay.includes(q);
    });
  }, [coloredEvents, calendarFilter]);

  // legenda
  const calendarLegend = useMemo(() => {
    const m = colorMaps[colorMode] || new Map();
    const entries = Array.from(m.entries()).sort((a, b) =>
      String(a[0]).localeCompare(String(b[0]))
    );
    const top = entries.slice(0, 8);
    const rest = entries.length - top.length;
    return { top, rest };
  }, [colorMaps, colorMode]);

  function openEditor(issue) {
    setEditorIssue(issue);
    setDraft(makeDefaultCronogramaDraft());
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorIssue(null);
    setDraft([]);
  }

  async function saveEditor() {
    if (!editorIssue) return;
    setLoading(true);
    setErr("");
    try {
      await saveCronogramaToJira(editorIssue.key, draft);
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
    const issueKey = info.event.extendedProps?.issueKey;
    const activityId = info.event.extendedProps?.activityId;
    if (!issueKey || !activityId) return;

    const prev = viewData.calendarioIssues.map((x) => ({
      key: x.key,
      atividades: x.atividades?.map((a) => ({ ...a })) || [],
    }));

    const nextCalendarioIssues = viewData.calendarioIssues.map((iss) => {
      if (iss.key !== issueKey) return iss;
      const nextAtividades = applyEventChangeToAtividades(
        iss.atividades,
        activityId,
        info.event.start,
        info.event.end
      );
      return { ...iss, atividades: nextAtividades };
    });

    setViewData((v) => ({ ...v, calendarioIssues: nextCalendarioIssues }));

    try {
      const issue = nextCalendarioIssues.find((x) => x.key === issueKey);
      const adf = buildCronogramaADF(issue.atividades);

      await jiraEditIssue(issueKey, {
        fields: {
          customfield_14017: adf,
        },
      });

      await reload();
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Falha ao persistir no Jira. Revertendo...");

      info.revert();

      setViewData((v) => {
        const restored = v.calendarioIssues.map((iss) => {
          const snap = prev.find((p) => p.key === iss.key);
          if (!snap) return iss;
          return { ...iss, atividades: snap.atividades };
        });
        return { ...v, calendarioIssues: restored };
      });
    }
  }

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
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
                      Painel de Tickets
                    </h1>
                    <Badge className="border border-red-200 bg-red-50 text-red-700">
                      Jira
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Navegação Tickets / Calendário + Reload */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className={topNavButtonClasses(subView === "alertas")}
                  onClick={() => setSubView("alertas")}
                  aria-pressed={subView === "alertas"}
                >
                  <ListChecks className="mr-2 h-4 w-4" />
                  Tickets
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
                  onClick={reload}
                  disabled={loading}
                  className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                >
                  <RefreshCcw
                    className={cn("mr-2 h-4 w-4", loading && "animate-spin")}
                  />
                  {loading ? "Atualizando..." : "Atualizar"}
                </Button>
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

          {/* =========================
            TICKETS (Dashboard)
        ========================= */}
          {subView === "alertas" && (
            <div className="grid gap-4">
              <TicketDashboardPage
                rows={rawIssues || []}
                alertas={filteredAlertas || []}
                missingSchedule={filteredCriarCronograma || []}
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
              />
            </div>
          )}

          {/* =========================
            CALENDÁRIO (3 modos + filtro)
        ========================= */}
          {subView === "calendario" && (
            <section className="grid gap-3">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900">
                      Calendário
                    </h2>
                    <p className="text-xs text-zinc-500">
                      Arraste para mudar data e redimensione para alterar
                      intervalo.
                    </p>
                  </div>

                  <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
                    {/* ===== PRINCIPAL ALTERAÇÃO: filtro de eventos */}
                    <div className="relative w-full md:w-[360px]">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                      <Input
                        value={calendarFilter}
                        onChange={(e) => setCalendarFilter(e.target.value)}
                        placeholder="Buscar por ticket, atividade ou recurso..."
                        className="h-10 rounded-xl border-zinc-200 bg-white pl-9 focus-visible:ring-red-500"
                      />
                    </div>

                    {/* ===== PRINCIPAL ALTERAÇÃO: 3 visões de cor */}
                    <div className="inline-flex w-full md:w-auto items-center rounded-xl border border-zinc-200 bg-zinc-50 p-1">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setColorMode("ticket")}
                        className={cn(
                          "h-9 rounded-lg px-3 text-xs font-semibold",
                          colorMode === "ticket"
                            ? "bg-red-600 text-white hover:bg-red-700"
                            : "text-zinc-700 hover:bg-white/70"
                        )}
                      >
                        Por Ticket
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setColorMode("recurso")}
                        className={cn(
                          "h-9 rounded-lg px-3 text-xs font-semibold",
                          colorMode === "recurso"
                            ? "bg-red-600 text-white hover:bg-red-700"
                            : "text-zinc-700 hover:bg-white/70"
                        )}
                      >
                        Por Recurso
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setColorMode("atividade")}
                        className={cn(
                          "h-9 rounded-lg px-3 text-xs font-semibold",
                          colorMode === "atividade"
                            ? "bg-red-600 text-white hover:bg-red-700"
                            : "text-zinc-700 hover:bg-white/70"
                        )}
                      >
                        Por Atividade
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Legenda curta */}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {calendarLegend.top.map(([label, color]) => {
                    const pretty =
                      colorMode === "atividade"
                        ? ATIVIDADE_LABEL_BY_ID[label] || label
                        : label;

                    return (
                      <Tooltip key={label}>
                        <TooltipTrigger asChild>
                          <Badge
                            className="cursor-default rounded-full border border-zinc-200 bg-white text-zinc-700"
                            title={pretty}
                          >
                            <span
                              className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            <span className="max-w-[160px] truncate">
                              {pretty}
                            </span>
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[380px]">
                          {pretty}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}

                  {calendarLegend.rest > 0 && (
                    <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                      +{calendarLegend.rest}
                    </Badge>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <FullCalendar
                    plugins={[dayGridPlugin, interactionPlugin]}
                    initialView="dayGridMonth"
                    height="auto"
                    editable
                    selectable={false}
                    eventStartEditable
                    eventDurationEditable
                    events={filteredEvents}
                    eventDrop={persistEventChange}
                    eventResize={persistEventChange}
                  />
                </div>

                <div className="mt-3 text-xs text-zinc-600">
                  Alterações atualizam o{" "}
                  <code className="rounded bg-zinc-100 px-1">
                    customfield_14017
                  </code>{" "}
                  no Jira (otimista + revert em erro).
                </div>
              </div>
            </section>
          )}

          {/* Modais */}
          {editorOpen && (
            <CronogramaEditorModal
              issue={editorIssue}
              draft={draft}
              setDraft={setDraft}
              onClose={closeEditor}
              onSave={saveEditor}
              loading={loading}
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

          {/* NOVO: Detalhes (Dialog shadcn) */}
          <TicketDetailsDialog
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            issueKey={detailsKey}
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

/* =========================
   TICKETS DASHBOARD
========================= */
function TicketDashboardPage({
  rows,
  alertas,
  missingSchedule,
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
      byKey.set(t.key, { ...byKey.get(t.key), ...t })
    );
    (missingSchedule || []).forEach((t) =>
      byKey.set(t.key, { ...byKey.get(t.key), ...t })
    );
    return Array.from(byKey.values());
  }, [rows, alertas, missingSchedule]);

  const statusCounts = useMemo(() => {
    const m = new Map();
    for (const t of allRows) {
      const s = t?.statusName || "—";
      m.set(s, (m.get(s) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [allRows]);

  const allStatuses = useMemo(() => {
    const set = new Set(allRows.map((t) => t?.statusName).filter(Boolean));
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, [allRows]);

  const allAssignees = useMemo(() => {
    const set = new Set(
      allRows.map((t) =>
        t?.assignee && t.assignee !== "—" ? t.assignee : "Sem responsável"
      )
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

    const passStatus = (t) =>
      !selectedStatuses.length || selectedStatuses.includes(t.statusName);

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
        x === "Subtarefa" ? isSub : x === "História" ? isStory : true
      );
    };

    let out = allRows.filter(
      (t) => passText(t) && passStatus(t) && passAssignee(t) && passType(t)
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

  const andamentoRows = useMemo(() => {
    const alertSet = new Set((alertas || []).map((t) => t.key));
    return filtered.filter((t) => {
      const s = String(t?.statusName || "").toUpperCase();
      if (alertSet.has(t.key)) return false;
      if (/(DONE|CONCLU|RESOLV|CLOSED)/i.test(s)) return false;
      return true;
    });
  }, [filtered, alertas]);

  const todosRows = filtered;

  const sectionRows =
    dashTab === "alertas"
      ? alertasRows
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
                    "border-zinc-200 bg-zinc-50 text-zinc-700"
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
                  : dashTab === "andamento"
                  ? "Em andamento"
                  : "Todos os tickets"
              }
              subtitle={
                dashTab === "alertas"
                  ? "Atenção: itens em PRE SAVE ainda não iniciados."
                  : dashTab === "andamento"
                  ? "Fluxo do PO: Para Dev → Desenvolvimento → Homolog → Deploy."
                  : "Visão completa com busca, filtros e ordenação."
              }
              rows={sectionRows}
              missingScheduleSet={missingSet}
              loading={loading}
              onStart={onStart}
              onOpenDetails={onOpenDetails}
              onOpenSchedule={onOpenSchedule}
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
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
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
  missingScheduleSet,
  loading,
  onStart,
  onOpenDetails,
  onOpenSchedule,
  emptyText,
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          <p className="text-sm text-zinc-600">{subtitle}</p>
        </div>

        {/* Ação contextual: mostrar “pendentes de cronograma” */}
        {onOpenSchedule && missingScheduleSet?.size ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className="rounded-full border border-amber-200 bg-amber-50 text-amber-800">
                {missingScheduleSet.size} sem cronograma
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              Tickets em andamento com customfield_14017 vazio
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {/* Grid de cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <TicketCardSkeleton key={i} />
            ))
          : rows.map((t) => (
              <TicketCard
                key={t.key}
                ticket={t}
                isNew={String(t?.statusName || "").toUpperCase() === "PRE SAVE"}
                missingSchedule={missingScheduleSet?.has(t.key)}
                onStart={() => onStart?.(t)}
                onDetails={() => onOpenDetails?.(t.key)}
                onSchedule={() => onOpenSchedule?.(t)}
              />
            ))}
      </div>

      {!loading && rows.length === 0 && (
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
  isNew,
  missingSchedule,
  onStart,
  onDetails,
  onSchedule,
}) {
  const key = ticket?.key || "—";
  const summary = ticket?.summary || "—";
  const status = ticket?.statusName || "—";
  const assignee = truncateText(
    ticket?.assignee && ticket.assignee !== "—"
      ? ticket.assignee
      : "Sem responsável"
  );

  // ✅ created vem do retorno da API: fields.created
  const createdRaw =
    ticket?.createdRaw ||
    ticket?.created ||
    ticket?.fields?.created ||
    ticket?.fields?.Created;

  const updatedRaw = ticket?.updatedRaw || ticket?.updated;

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
                    className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 shadow-sm"
                  >
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      Sem cronograma
                    </span>
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

          {/* Botões de Ação - Layout Estável */}
          <div className="grid grid-cols-2 gap-2 mt-auto">
            <Button
              size="sm"
              onClick={onStart}
              className="rounded-lg bg-red-600 font-medium text-white hover:bg-red-700 transition-colors"
            >
              <Play className="mr-1.5 h-3.5 w-3.5 fill-current" />
              Iniciar
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={onDetails}
              className="rounded-lg border-zinc-200 text-zinc-700 hover:bg-zinc-50"
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
        cls
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

/* =========================
   DETAILS DIALOG
========================= */
function TicketDetailsDialog({
  open,
  onOpenChange,
  issueKey,
  onMarkedStarted,
}) {
  const [loading, setLoading] = useState(false);
  const [issue, setIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [err, setErr] = useState("");

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
        "summary,status,assignee,created,updated,project,description,customfield_14017"
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
      .replace(/^—$/, "")
  );

  const jiraBrowseUrl = useMemo(
    () => getJiraBrowseUrl(issueKey, issue),
    [issueKey, issue]
  );

  const assigneeFull = userName(f?.assignee) || "Sem responsável";

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
            Visualização rápida (descrição, cronograma e comentários).
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
              <div className="whitespace-pre-wrap text-sm text-zinc-800">
                {hasCronograma ? infoAdicText : "—"}
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
                            : "border-zinc-200 bg-white"
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
  console.log(issue);

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
    const a = f?.assignee ? mapJiraUser(f.assignee) : null;
    setOwnerSelected(a?.accountId ? a : null);
    setOwnerQuery("");
    setOwnerOptions([]);
    setOwnerErr("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey]);

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
            "Falha ao buscar usuários. Verifique permissões do Jira (Browse users and groups / Assign issues)."
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
          <span className="truncate">Sem proprietário</span>
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
              Proprietário será atualizado ao salvar.
            </div>
          )}
        </div>

        {/* Campos */}
        <div className="grid gap-3 md:grid-cols-2">
          <InfoCard title="Básico">
            <InfoRow label="Projeto" value={f?.project?.name || "—"} />
            <InfoRow label="Prioridade" value={f?.priority?.name || "—"} />

            {/* Responsável atual (Jira) */}
            <InfoRow
              label="Responsável (atual)"
              value={userName(f?.assignee)}
            />

            {/* NOVO: Proprietário (Assignee) */}
            <div className="grid grid-cols-[160px_1fr] gap-3 py-1">
              <div className="text-xs text-zinc-500">Proprietário</div>

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
                        placeholder="Buscar usuário no Jira... (mín. 2 letras)"
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
                          {/* Sem proprietário */}
                          <CommandItem
                            value="__none__"
                            onSelect={() => {
                              setOwnerSelected(null);
                              setOwnerOpen(false);
                            }}
                            className="rounded-xl"
                          >
                            <span className="flex items-center gap-2">
                              <UserX className="h-4 w-4 text-zinc-500" />
                              <span className="text-sm font-medium text-zinc-800">
                                Sem proprietário
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
}) {
  if (!issue) return null;

  function setCell(idx, key, value) {
    setDraft((prev) => {
      const next = prev.map((x) => ({ ...x }));
      next[idx][key] = value;
      return next;
    });
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
    // quando trocar de issue, recalcula modos iniciais a partir do draft atual
    const next = {};
    (draft || []).forEach((a) => {
      next[a.id] = inferMode(a.data);
    });
    setModeById(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.key]);

  return (
    <Dialog
      open={true}
      onOpenChange={(o) => {
        if (!o) onClose?.();
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-4xl rounded-2xl sm:w-full max-h-[85vh] overflow-y-auto">
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

        <div className="grid gap-4">
          {/* Seção: Atividades */}
          <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                Atividades do cronograma
              </CardTitle>
              <CardDescription className="text-xs">
                Preencha Data, Recurso e Área.
              </CardDescription>
            </CardHeader>

            <CardContent className="grid gap-3">
              <div className="overflow-x-auto overflow-y-hidden md:overflow-visible rounded-2xl border border-zinc-200">
                <div className="min-w-0">
                  <div
                    className="sticky top-0 z-10 hidden md:grid
  md:grid-cols-[minmax(220px,1.4fr)_minmax(180px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)]
  gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700"
                  >
                    <div>Atividade</div>
                    <div>Data</div>
                    <div>Recurso</div>
                    <div>Área</div>
                  </div>

                  {/* Rows */}
                  <div className="grid">
                    {draft.map((a, idx) => {
                      const mode = modeById[a.id] || inferMode(a.data);

                      return (
                        <div
                          key={a.id}
                          className={cn(
                            "border-t border-zinc-200 px-3 py-2",
                            "md:grid md:grid-cols-[minmax(220px,1.4fr)_minmax(180px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)] md:items-start md:gap-2",
                            "grid gap-3"
                          )}
                        >
                          {/* Atividade */}
                          <div className="min-w-0">
                            <div className="md:hidden text-[11px] font-semibold text-zinc-600">
                              Atividade
                            </div>
                            <div className="truncate text-sm font-semibold text-zinc-900">
                              {a.name}
                            </div>
                          </div>

                          {/* Data */}
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
                              onChange={(val) => setCell(idx, "data", val)}
                              disabled={loading}
                              className="w-full"
                            />
                          </div>

                          {/* Recurso */}
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

                          {/* Área */}
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
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Prévia ADF (colapsável) */}
          <details className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-50">
              Prévia do ADF gerado
            </summary>
            <div className="px-4 pb-4">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-800">
                  {JSON.stringify(buildCronogramaADF(draft), null, 2)}
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
            onClick={onSave}
            disabled={loading}
          >
            {loading ? "Salvando..." : "Salvar no Jira"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
