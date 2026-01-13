// src/components/AMPanelTab.jsx
import { useMemo, useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  RefreshCcw,
  Filter,
  ArrowUpDown,
  ExternalLink,
  Play,
  CalendarDays,
  AlertTriangle,
  ListChecks,
} from "lucide-react";
import { buildCronogramaADF } from "../utils/cronograma";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";

import {
  fetchPoIssuesDetailed,
  buildPoView,
  makeDefaultCronogramaDraft,
  saveCronogramaToJira,
  applyEventChangeToAtividades,
} from "../lib/jiraPoView";

// NOVO: buscar detalhes do ticket + comentar
import { getIssue, getComments, createComment } from "../lib/jira";
import { adfSafeToText } from "../utils/gmudUtils";

/* =========================
   2) HELPERS 
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
  return u?.displayName || u?.name || u?.emailAddress || "—";
}

export default function AMPanelTab() {
  const [subView, setSubView] = useState("alertas"); // alertas | calendario
  const [q, setQ] = useState("");
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

  // ===== NOVO: modal "Iniciar ticket"
  const [startOpen, setStartOpen] = useState(false);
  const [startIssueKey, setStartIssueKey] = useState("");
  const [startIssue, setStartIssue] = useState(null);
  const [startLoading, setStartLoading] = useState(false);
  const [startErr, setStartErr] = useState("");
  const [selectedStatus, setSelectedStatus] = useState(STATUS_OPTIONS[0]);

  // estados do dashboard
  const [dashTab, setDashTab] = useState("alertas"); // alertas | andamento | todos
  const [searchText, setSearchText] = useState("");

  // filtros
  const [selectedStatuses, setSelectedStatuses] = useState([]);
  const [selectedAssignees, setSelectedAssignees] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [sortBy, setSortBy] = useState("updatedDesc"); // updatedDesc | updatedAsc

  // modal detalhes
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsKey, setDetailsKey] = useState("");

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

  const filteredAlertas = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return viewData.alertas;
    return viewData.alertas.filter((t) => {
      return (
        t.key.toLowerCase().includes(qq) ||
        (t.summary || "").toLowerCase().includes(qq) ||
        (t.assignee || "").toLowerCase().includes(qq)
      );
    });
  }, [viewData.alertas, q]);

  const filteredCriarCronograma = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return viewData.criarCronograma;
    return viewData.criarCronograma.filter((t) => {
      return (
        t.key.toLowerCase().includes(qq) ||
        (t.summary || "").toLowerCase().includes(qq) ||
        (t.assignee || "").toLowerCase().includes(qq)
      );
    });
  }, [viewData.criarCronograma, q]);

  const calendarEvents = useMemo(() => viewData.events, [viewData.events]);

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

  // ===== NOVO: abrir modal e carregar issue completo
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

  async function applyStatusOnly() {
    if (!startIssueKey) return;
    setStartLoading(true);
    setStartErr("");
    try {
      await jiraTransitionToStatus(startIssueKey, selectedStatus);
      // recarrega detalhes para refletir status
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

  async function startTicket() {
    if (!startIssueKey) return;
    setStartLoading(true);
    setStartErr("");
    try {
      // 1) cria comentário [INICIADO]
      await createComment(startIssueKey, adfFromPlainText("[INICIADO]"));

      // 2) altera status
      await jiraTransitionToStatus(startIssueKey, selectedStatus);

      // 3) atualiza lista (deve sair de "Alertas")
      await reload();
      closeStartModal();
    } catch (e) {
      console.error(e);
      setStartErr(e?.message || "Falha ao iniciar o ticket.");
    } finally {
      setStartLoading(false);
    }
  }

  // ---- drag/resize do calendário → atualiza ADF e persiste no Jira
  async function persistEventChange(info) {
    const issueKey = info.event.extendedProps?.issueKey;
    const activityId = info.event.extendedProps?.activityId;
    if (!issueKey || !activityId) return;

    // snapshot para rollback manual
    const prev = viewData.calendarioIssues.map((x) => ({
      key: x.key,
      atividades: x.atividades?.map((a) => ({ ...a })) || [],
    }));

    // otimista: ajusta no state
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

    const nextEvents = nextCalendarioIssues.flatMap((i) => {
      // reusa buildPoView? aqui é direto: recomputa pelo cronograma atual
      // para manter simples, mantemos o events pela função buildPoView recarregando depois.
      // mas precisamos refletir imediatamente: montamos ADF e parse → eventos não é necessário,
      // FullCalendar já moveu o evento visualmente.
      return [];
    });

    setViewData((v) => ({
      ...v,
      calendarioIssues: nextCalendarioIssues,
      // não precisa mexer em events; FullCalendar já moveu visualmente o evento
      // e a próxima recarga alinhará tudo
    }));

    try {
      const issue = nextCalendarioIssues.find((x) => x.key === issueKey);
      const adf = buildCronogramaADF(issue.atividades);

      await jiraEditIssue(issueKey, {
        fields: {
          customfield_14017: adf,
        },
      });

      // opcional: recarregar para garantir consistência
      await reload();
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Falha ao persistir no Jira. Revertendo...");

      // reverte UI do calendário
      info.revert();

      // reverte state local
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
        {/* Header fixo SaaS */}
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

              {/* Ações globais (mantém sua navegação Alertas/Calendário) */}
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
          {/* Erro */}
          {err && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {err}
            </div>
          )}

          {/* =========================
            TICKETS (cards)
        ========================= */}
          {subView === "alertas" && (
            <div className="grid gap-4">
              <TicketDashboardPage
                // IMPORTANTE:
                // - "rows": lista base (todos os tickets carregados).
                //   Ajuste para o nome real do seu array principal.
                rows={rawIssues || []}
                // - alertas: você já tem
                alertas={filteredAlertas || []}
                // - cronograma pendente: você já tem
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
                onStart={(t) => openStartModal(t)} // reaproveita seu fluxo atual
                onOpenDetails={(key) => {
                  setDetailsKey(key);
                  setDetailsOpen(true);
                }}
                onOpenSchedule={(t) => openEditor(t)} // botão "Criar cronograma"
              />
            </div>
          )}

          {/* =========================
            CALENDÁRIO (mantém o seu)
        ========================= */}
          {subView === "calendario" && (
            <section className="grid gap-3">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900">
                      Calendário
                    </h2>
                    <p className="text-sm text-zinc-600">
                      Cronograma por atividade (customfield_14017)
                    </p>
                  </div>
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
                    events={calendarEvents}
                    eventDrop={persistEventChange}
                    eventResize={persistEventChange}
                  />
                </div>

                <div className="mt-3 text-xs text-zinc-600">
                  Arraste eventos para mudar data; redimensione para alterar
                  intervalo. As alterações atualizam o{" "}
                  <code className="rounded bg-zinc-100 px-1">
                    customfield_14017
                  </code>{" "}
                  no Jira (otimista + revert em erro).
                </div>
              </div>
            </section>
          )}

          {/* Seus modais existentes */}
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
              await reload?.();
            }}
          />
        </main>
      </div>
    </TooltipProvider>
  );
}
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
    // tenta ser robusto mesmo que "rows" não esteja completo
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
      // se você já tiver issueTypeName no objeto, ajuste aqui
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
    // “Em andamento”: remove PRE SAVE (alertas) e tenta remover Done (se existir)
    const alertSet = new Set((alertas || []).map((t) => t.key));
    return filtered.filter((t) => {
      const s = String(t?.statusName || "").toUpperCase();
      if (alertSet.has(t.key)) return false;
      if (/(DONE|CONCLU|RESOLV|CLOSED)/i.test(s)) return false;
      // inclui fluxo "Para Dev / Desenvolvimento / Para Homolog / Homolog Negócio / Para Deploy"
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
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              <AlertTriangle className="mr-2 h-4 w-4 text-red-600" />
              Alertas
              <Badge className="ml-2 rounded-full bg-red-600 text-white">
                {alertasRows.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="andamento"
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              Em andamento
              <Badge className="ml-2 rounded-full bg-zinc-900 text-white">
                {andamentoRows.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="todos"
              className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              Todos
              <Badge className="ml-2 rounded-full bg-zinc-900 text-white">
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

const TicketCard = memoTicketCard();

function memoTicketCard() {
  // memo sem importar React.memo explicitamente (mantém simples)
  const Memo = (props) => <TicketCardImpl {...props} />;
  return Memo;
}

function TicketCardImpl({
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
  const assignee =
    ticket?.assignee && ticket.assignee !== "—"
      ? ticket.assignee
      : "Sem responsável";
  const updated = fmtUpdatedBR(ticket?.updatedRaw || ticket?.updated);

  return (
    <motion.div
      layout
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className="h-full"
    >
      <Card className="group h-full rounded-2xl border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <code className="shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-800">
                {key}
              </code>

              {isNew ? (
                <Badge className="shrink-0 rounded-full bg-red-600 text-white">
                  Novo
                </Badge>
              ) : null}

              {missingSchedule ? (
                <Badge className="max-w-full rounded-full border border-amber-200 bg-amber-50 text-amber-800">
                  Sem cronograma
                </Badge>
              ) : null}
            </div>

            <div className="shrink-0">
              <StatusBadge status={status} />
            </div>
          </div>

          <CardTitle
            className="text-sm font-semibold leading-snug text-zinc-900"
            style={CLAMP_2}
            title={summary}
          >
            {summary}
          </CardTitle>

          <CardDescription className="text-xs text-zinc-600">
            Atualizado em{" "}
            <span className="font-medium text-zinc-800">{updated}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-3">
          <div className="flex items-center gap-2">
            <Avatar className="h-7 w-7 border border-zinc-200">
              <AvatarFallback className="bg-zinc-100 text-[11px] text-zinc-700">
                {initials(assignee)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-zinc-900">
                {assignee}
              </div>
              <div className="text-[11px] text-zinc-500">Responsável</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={onStart}
              className="rounded-xl bg-red-600 text-white hover:bg-red-700"
            >
              <Play className="mr-2 h-4 w-4" />
              Iniciar
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={onDetails}
              className="rounded-xl border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              Ver detalhes
            </Button>

            {missingSchedule && onSchedule ? (
              <Button
                variant="secondary"
                onClick={onSchedule}
                className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-800"
              >
                Criar cronograma
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function StatusBadge({ status }) {
  const s = String(status || "").toUpperCase();

  // Claro-inspired: red primary; semantic chips
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
        "max-w-[180px] truncate", // impede status muito grande de estourar
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
        "summary,status,assignee,updated,project,description,customfield_14017"
      ),

      getComments(issueKey),
    ])
      .then((res) => {
        if (!alive) return;
        const [a, b] = res;

        if (a.status === "fulfilled") setIssue(a.value);
        else setErr(a.reason?.message || String(a.reason));

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
        </DialogHeader>

        {err ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        ) : null}

        <div className="grid gap-3">
          {/* BLOCO ANTIGO (volta aqui) */}
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

          {/* Descrição */}
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
              <div className="whitespace-pre-wrap text-sm text-zinc-800">
                {descText || "—"}
              </div>
            )}
          </div>

          {/* Informações Adicionais (Cronograma) */}
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
                        key={c?.id || `${author}-${created}-${Math.random()}`}
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

function TicketsTable({ rows, emptyText, extraActions }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <Th>Ticket</Th>
            <Th>Resumo</Th>
            <Th>Status</Th>
            <Th>Responsável</Th>
            <Th>Atualizado</Th>
            {extraActions ? <Th>Ações</Th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.key}>
              <Td style={{ fontWeight: 700 }}>{t.key}</Td>
              <Td>{t.summary}</Td>
              <Td>{t.statusName}</Td>
              <Td>{t.assignee}</Td>
              <Td>{t.updated}</Td>
              {extraActions ? <Td>{extraActions(t)}</Td> : null}
            </tr>
          ))}

          {rows.length === 0 && (
            <tr>
              <Td colSpan={extraActions ? 6 : 5} style={{ opacity: 0.7 }}>
                {emptyText}
              </Td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: "min(980px, 98vw)",
          background: "rgba(20,20,20,0.96)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 14,
          padding: 14,
          display: "grid",
          gap: 12,
          color: "#fff",
        }}
      >
        <div
          style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 900 }}>Iniciar ticket — {issueKey}</div>
            <div style={{ opacity: 0.9, fontSize: 13 }}>
              {loading ? "Carregando detalhes..." : f?.summary || "—"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
            <button type="button" onClick={onClose} disabled={loading}>
              Fechar
            </button>
            <button
              type="button"
              className="primary"
              onClick={onStart}
              disabled={loading || !issue}
              title="Cria comentário [INICIADO] e altera o status"
            >
              {loading ? "Processando..." : "Iniciar"}
            </button>
          </div>
        </div>

        {err && (
          <div
            style={{
              padding: 10,
              border: "1px solid rgba(255,80,80,0.35)",
              background: "rgba(255,80,80,0.10)",
              borderRadius: 10,
              color: "#ffb3b3",
              fontSize: 13,
            }}
          >
            {err}
          </div>
        )}

        {/* Status */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: 10,
            alignItems: "end",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 12,
            padding: 12,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 800 }}>
              Alterar status do ticket
            </div>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              disabled={loading || !issue}
              style={{
                padding: "10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.06)",
                color: "#fff",
                outline: "none",
              }}
            >
              {statusOptions.map((s) => (
                <option key={s} value={s} style={{ color: "#000" }}>
                  {s}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Status atual: <b>{f?.status?.name || "—"}</b>
            </div>
          </div>

          <button
            type="button"
            onClick={onApplyStatus}
            disabled={loading || !issue}
            className="secondary"
          >
            Aplicar status
          </button>

          <button
            type="button"
            onClick={onStart}
            disabled={loading || !issue}
            className="primary"
            title="Cria comentário [INICIADO] e altera o status"
          >
            Iniciar
          </button>
        </div>

        {/* Campos */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <InfoCard title="Básico">
            <InfoRow label="Projeto" value={f?.project?.name || "—"} />
            <InfoRow label="Prioridade" value={f?.priority?.name || "—"} />
            <InfoRow label="Responsável" value={userName(f?.assignee)} />
            <InfoRow label="Relator" value={userName(f?.creator)} />
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
            <div
              style={{
                marginTop: 10,
                opacity: 0.9,
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              Subtasks
            </div>
            <div
              style={{ fontSize: 12, opacity: 0.9, display: "grid", gap: 6 }}
            >
              {!subtasks.length ? (
                <div style={{ opacity: 0.75 }}>—</div>
              ) : (
                subtasks.slice(0, 20).map((st) => (
                  <div
                    key={st?.key || crypto.randomUUID?.() || Math.random()}
                    style={{
                      padding: "8px 10px",
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.05)",
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{st?.key || "—"}</div>
                    <div style={{ opacity: 0.85 }}>
                      {st?.fields?.summary || "—"}
                    </div>
                    <div style={{ opacity: 0.7, fontSize: 11 }}>
                      {st?.fields?.status?.name || ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </InfoCard>
        </div>

        <InfoCard title="Descrição do Projeto">
          <pre
            style={{
              whiteSpace: "pre-wrap",
              margin: 0,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {desc || "—"}
          </pre>
        </InfoCard>

        <InfoCard title="customfield_10903 (Critérios / Campo)">
          <pre
            style={{
              whiteSpace: "pre-wrap",
              margin: 0,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {criterios || "—"}
          </pre>
        </InfoCard>
      </div>
    </div>
  );
}

function InfoCard({ title, children }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 12,
        padding: 12,
        background: "rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          fontWeight: 900,
          fontSize: 13,
          marginBottom: 10,
          opacity: 0.95,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        gap: 10,
        padding: "6px 0",
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.75 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{value || "—"}</div>
    </div>
  );
}

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: "min(980px, 98vw)",
          background: "rgba(20,20,20,0.96)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 14,
          padding: 14,
          display: "grid",
          gap: 12,
        }}
      >
        <div
          style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontWeight: 800 }}>
              Criar cronograma — {issue.key}
            </div>
            <div style={{ opacity: 0.8, fontSize: 13 }}>{issue.summary}</div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>
              Data aceita: <code>DD/MM</code> ou <code>DD/MM a DD/MM</code>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="primary"
              onClick={onSave}
              disabled={loading}
            >
              {loading ? "Salvando..." : "Salvar no Jira"}
            </button>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>Atividade</Th>
                <Th>Data</Th>
                <Th>Recurso</Th>
                <Th>Área</Th>
              </tr>
            </thead>
            <tbody>
              {draft.map((a, idx) => (
                <tr key={a.id}>
                  <Td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                    {a.name}
                  </Td>
                  <Td>
                    <input
                      value={a.data}
                      onChange={(e) => setCell(idx, "data", e.target.value)}
                      placeholder="ex.: 15/01 ou 15/01 a 18/01"
                      style={{ width: "100%" }}
                    />
                  </Td>
                  <Td>
                    <input
                      value={a.recurso}
                      onChange={(e) => setCell(idx, "recurso", e.target.value)}
                      placeholder="ex.: João"
                      style={{ width: "100%" }}
                    />
                  </Td>
                  <Td>
                    <input
                      value={a.area}
                      onChange={(e) => setCell(idx, "area", e.target.value)}
                      placeholder="ex.: TI"
                      style={{ width: "100%" }}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details style={{ opacity: 0.85 }}>
          <summary>Prévia do ADF gerado</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
            {JSON.stringify(buildCronogramaADF(draft), null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 8px",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style, colSpan }) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "10px 8px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  );
}
