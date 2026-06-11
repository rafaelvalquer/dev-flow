import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Clock,
  FileText,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  convertDeveloperStickyNoteToJiraComment,
  createDeveloperStickyNote,
  deleteDeveloperStickyNote,
  saveDeveloperWorkspacePreferences,
  updateDeveloperStickyNote,
} from "../../lib/developerWorkspace";
import { MetricCard } from "./components/MetricCard";
import DeveloperWorkspaceFilters from "./DeveloperWorkspaceFilters";
import DeveloperWorkspaceGrid from "./DeveloperWorkspaceGrid";
import DeveloperWorkspaceHeader from "./DeveloperWorkspaceHeader";
import DeveloperTicketDetailsDialog from "./DeveloperTicketDetailsDialog";
import ExpandedWorkspaceDialog from "./ExpandedWorkspaceDialog";
import { useDeveloperWorkspaceActions } from "./hooks/useDeveloperWorkspaceActions";
import { useDeveloperWorkspaceFilters } from "./hooks/useDeveloperWorkspaceFilters";
import { useDeveloperWorkspaceLayout } from "./hooks/useDeveloperWorkspaceLayout";
import { useMeasuredWidth } from "./hooks/useMeasuredWidth";
import { buildNextActions, buildRiskRows } from "./utils/developerRiskRules";
import {
  diffDaysFromToday,
  ensureStickyLayouts,
  findTicketByKey,
  getDueYmd,
  getIssueKey,
  getPriority,
  getStatus,
  getSummary,
  hasEvidence,
  isAwaitingGmud,
  isDone,
  mergeWorkspace,
  norm,
  normalizeTicketKey,
} from "./utils/developerTicketUtils";
import {
  DEFAULT_VISIBLE_WIDGETS,
  EMPTY_WORKSPACE,
} from "./utils/developerWidgetRegistry";

export default function DeveloperWorkspace({
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
  onStartTicket,
  onWorkspaceSaved,
}) {
  const { width, containerRef, mounted } = useMeasuredWidth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState("all");
  const [pendencyFilter, setPendencyFilter] = useState("all");
  const [notesDraft, setNotesDraft] = useState({});
  const [noteTicketKey, setNoteTicketKey] = useState("");
  const [expandedWidget, setExpandedWidget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [focusedStickyId, setFocusedStickyId] = useState("");
  const [detailsAction, setDetailsAction] = useState(null);
  const stickyRefs = useRef({});
  const preferences = workspace.preferences || EMPTY_WORKSPACE.preferences;
  const {
    layouts,
    layoutsRef,
    persistLayouts,
    handleLayoutChange,
    handleBreakpointChange,
    saveBreakpointLayout,
  } = useDeveloperWorkspaceLayout({
    workspace,
    preferences,
    onWorkspaceSaved,
  });

  useEffect(() => {
    setNotesDraft((prev) => ({ ...workspace.notesByTicket, ...prev }));
  }, [workspace.notesByTicket]);

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

  const visibleWidgets = preferences.visibleWidgets?.length
    ? preferences.visibleWidgets
    : DEFAULT_VISIBLE_WIDGETS;
  const visibleWidgetSet = useMemo(
    () => new Set(visibleWidgets),
    [visibleWidgets],
  );

  const { filteredRows, sortedRows, stats } = useDeveloperWorkspaceFilters({
    rows,
    preferences,
    search,
    statusFilter,
    priorityFilter,
    dueFilter,
    pendencyFilter,
  });

  const riskRows = useMemo(() => buildRiskRows(sortedRows, 999), [sortedRows]);
  const nextActions = useMemo(
    () => buildNextActions(sortedRows, 999),
    [sortedRows],
  );

  const noteTickets = useMemo(() => {
    const keys = [
      noteTicketKey === "__free__" ? "" : noteTicketKey,
      ...filteredRows.map(getIssueKey),
      ...(workspace.stickyNotes || []).map((note) => note.ticketKey),
      ...Object.keys(workspace.notesByTicket || {}),
    ]
      .map(normalizeTicketKey)
      .filter(Boolean);
    return Array.from(new Set(keys)).slice(0, 12);
  }, [
    filteredRows,
    noteTicketKey,
    workspace.notesByTicket,
    workspace.stickyNotes,
  ]);

  const contextTicketKey = useMemo(
    () =>
      normalizeTicketKey(
        noteTicketKey ||
          workspace.recentTickets?.[0]?.ticketKey ||
          getIssueKey(filteredRows?.[0]),
      ),
    [filteredRows, noteTicketKey, workspace.recentTickets],
  );
  const contextIssue = useMemo(() => {
    const issue =
      findTicketByKey(sortedRows, contextTicketKey) ||
      findTicketByKey(allRows, contextTicketKey);
    if (issue) return issue;
    const recent = (workspace.recentTickets || []).find(
      (item) => normalizeTicketKey(item.ticketKey) === contextTicketKey,
    );
    return recent
      ? {
          key: recent.ticketKey,
          summary: recent.summary,
          status: recent.status,
          priority: recent.priority,
          progress: recent.progress,
        }
      : null;
  }, [allRows, contextTicketKey, sortedRows, workspace.recentTickets]);

  const detailsIssue = useMemo(() => {
    const key = normalizeTicketKey(detailsAction?.key);
    if (!key) return null;

    return (
      detailsAction?.issue ||
      findTicketByKey(sortedRows, key) ||
      findTicketByKey(allRows, key) ||
      null
    );
  }, [allRows, detailsAction, sortedRows]);

  const handleQuickAction = useDeveloperWorkspaceActions({
    contextTicketKey,
    contextIssue,
    sortedRows,
    riskRows,
    onOpenExecution,
  });

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
      toast.error("Não foi possível salvar o workspace.", {
        description: err?.message || String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  function getNoteTitle(ticketKey) {
    const issue = findTicketByKey(
      [...(sortedRows || []), ...(allRows || [])],
      ticketKey,
    );
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

  async function saveNote(options = {}) {
    const key = normalizeTicketKey(options.ticketKey ?? noteTicketKey);
    const draftKey = options.draftKey || key || "__free__";
    const rawNote = notesDraft[draftKey];
    const text =
      rawNote && typeof rawNote === "object"
        ? rawNote.text || ""
        : rawNote || "";
    if (!String(text || "").trim()) {
      toast.warning("Escreva uma nota antes de criar o post-it.");
      return;
    }
    setSaving(true);
    try {
      const title =
        String(options.title || "").trim() ||
        (key ? getNoteTitle(key) : "Nota livre");
      const saved = await createDeveloperStickyNote({
        ticketKey: key || "",
        title,
        text,
        color: options.color || "yellow",
      });
      const nextWorkspace = mergeWorkspace(saved);
      const created = nextWorkspace.stickyNotes?.[0];
      const nextLayouts = ensureStickyLayouts(
        layoutsRef.current,
        nextWorkspace.stickyNotes,
      );

      setNotesDraft((prev) => ({
        ...prev,
        [draftKey]: "",
      }));
      options.onCreated?.();
      onWorkspaceSaved?.({
        ...nextWorkspace,
        layout: nextLayouts,
      });
      await persistLayouts(nextLayouts, { toastOnError: false, delay: 0 });
      if (created?.id) setFocusedStickyId(created.id);
      toast.success("Post-it criado no workspace.");
    } catch (err) {
      toast.error("Não foi possível criar o post-it.", {
        description: err?.message || String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  async function updateStickyNote(noteId, patch = {}) {
    const id = String(noteId || "").trim();
    if (!id) return;
    setSaving(true);
    try {
      const saved = await updateDeveloperStickyNote(id, patch);
      onWorkspaceSaved?.(mergeWorkspace(saved));
      toast.success("Post-it atualizado.");
    } catch (err) {
      toast.error("Não foi possível atualizar o post-it.", {
        description: err?.message || String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  function toggleStickyPinned(note) {
    updateStickyNote(note?.id, { pinned: !note?.pinned });
  }

  function toggleStickyResolved(note) {
    updateStickyNote(note?.id, { resolved: !note?.resolved });
  }

  async function convertStickyToJiraComment(note) {
    if (!normalizeTicketKey(note?.ticketKey)) {
      toast.warning("Vincule um ticket antes de comentar no Jira.");
      return;
    }
    setSaving(true);
    try {
      const saved = await convertDeveloperStickyNoteToJiraComment(note.id);
      onWorkspaceSaved?.(mergeWorkspace(saved));
      toast.success("Comentário criado no Jira.");
    } catch (err) {
      toast.error("Não foi possível comentar no Jira.", {
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
      const nextLayouts = ensureStickyLayouts(
        layoutsRef.current,
        nextWorkspace.stickyNotes,
      );
      onWorkspaceSaved?.({
        ...nextWorkspace,
        layout: nextLayouts,
      });
      await persistLayouts(nextLayouts, { toastOnError: false, delay: 0 });
      toast.success("Post-it removido.");
    } catch (err) {
      toast.error("Não foi possível remover o post-it.", {
        description: err?.message || String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  function openExpandedWidget(widgetId) {
    const hasNotes = Object.values(workspace.notesByTicket || {}).some(
      (value) => {
        const text = typeof value === "string" ? value : value?.text || "";
        return String(text || "").trim();
      },
    );
    const emptyChecks = {
      queue: filteredRows.length === 0,
      recent: !workspace.recentTickets?.length,
      risk: riskRows.length === 0,
      actions: nextActions.length === 0,
      notes: !hasNotes,
    };

    if (emptyChecks[widgetId]) {
      toast.info("Não há itens para exibir neste momento.");
      return;
    }

    setExpandedWidget(widgetId);
  }

  if (!currentUser?.jiraAccountId) {
    return (
      <section className="developer-center developer-workspace">
        <Card className="developer-empty-config">
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Configure seu usuário Jira</CardTitle>
              <CardDescription className="mt-1">
                O Workspace usa seu accountId Jira para montar a fila pessoal da
                Central do Desenvolvedor.
              </CardDescription>
            </div>
            <Button
              className="rounded-xl bg-red-600 text-white hover:bg-red-700"
              onClick={onConfigureUser}
            >
              <Settings2 className="mr-2 h-4 w-4" />
              Abrir Configurações
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

  function openDetailsAction(action) {
    setDetailsAction(action || null);
  }

  function closeDetailsAction() {
    setDetailsAction(null);
  }

  function openExecutionFromDetails(ticketKey, opts = {}) {
    closeDetailsAction();
    onOpenExecution?.(ticketKey, opts);
  }

  async function handleScheduleSaved(ticketKey) {
    if (typeof onRefreshIssue === "function") {
      await onRefreshIssue(ticketKey).catch(() => null);
      return;
    }

    await onReload?.();
  }

  function handleStartTicketAction(action) {
    const key = normalizeTicketKey(action?.key || action?.issue?.key);
    if (!key) return;

    onStartTicket?.({
      id: `${key}:${Date.now()}`,
      ticketKey: key,
      issue: action?.issue || findTicketByKey(allRows, key) || null,
      source: "developer-next-actions",
    });
  }
  return (
    <section
      className={cn(
        "developer-center developer-workspace",
        preferences.density === "compact" && "developer-workspace--compact",
      )}
    >
      <DeveloperWorkspaceHeader
        currentUser={currentUser}
        search={search}
        setSearch={setSearch}
        visibleWidgetSet={visibleWidgetSet}
        toggleWidget={toggleWidget}
        preferences={preferences}
        saveWorkspace={saveWorkspace}
        layouts={layouts}
        saving={saving}
        onReload={onReload}
        loading={loading}
        reloadProgress={reloadProgress}
      />

      <div className="developer-stats">
        <MetricCard
          icon={CalendarDays}
          label="tickets ativos"
          value={stats.active}
          helper={stats.activeHelper}
          tone="danger"
        />
        <MetricCard
          icon={Clock}
          label="vencendo"
          value={stats.dueSoon}
          helper="Vencem hoje ou amanhã"
          tone="warning"
        />
        <MetricCard
          icon={TriangleAlert}
          label="sem evidência"
          value={stats.noEvidence}
          helper="Aguardando envio"
          tone="alert"
        />
        <MetricCard
          icon={FileText}
          label="aguardando GMUD"
          value={stats.waitingGmud}
          helper="Pendência identificada"
          tone="info"
        />
      </div>

      <DeveloperWorkspaceFilters
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        priorityFilter={priorityFilter}
        setPriorityFilter={setPriorityFilter}
        dueFilter={dueFilter}
        setDueFilter={setDueFilter}
        pendencyFilter={pendencyFilter}
        setPendencyFilter={setPendencyFilter}
      />

      {error ? <div className="developer-error">{error}</div> : null}

      <DeveloperWorkspaceGrid
        containerRef={containerRef}
        mounted={mounted}
        width={width}
        layouts={layouts}
        handleLayoutChange={handleLayoutChange}
        handleBreakpointChange={handleBreakpointChange}
        saveBreakpointLayout={saveBreakpointLayout}
        visibleWidgetSet={visibleWidgetSet}
        filteredRows={filteredRows}
        loading={loading}
        onOpenExecution={onOpenExecution}
        openExpandedWidget={openExpandedWidget}
        sortedRows={sortedRows}
        workspace={workspace}
        noteTickets={noteTickets}
        noteTicketKey={noteTicketKey}
        setNoteTicketKey={setNoteTicketKey}
        notesDraft={notesDraft}
        setNotesDraft={setNotesDraft}
        saveNote={saveNote}
        saving={saving}
        handleQuickAction={handleQuickAction}
        onStartTicket={handleStartTicketAction}
        onOpenDetails={openDetailsAction}
        contextTicketKey={contextTicketKey}
        contextIssue={contextIssue}
        focusedStickyId={focusedStickyId}
        onUpdateStickyNote={updateStickyNote}
        onToggleStickyPinned={toggleStickyPinned}
        onToggleStickyResolved={toggleStickyResolved}
        onConvertStickyToJiraComment={convertStickyToJiraComment}
        deleteStickyNote={deleteStickyNote}
        stickyRefs={stickyRefs}
      />

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
        onStartTicket={handleStartTicketAction}
        onOpenDetails={openDetailsAction}
      />

      <DeveloperTicketDetailsDialog
        open={Boolean(detailsAction)}
        action={detailsAction}
        issue={detailsIssue}
        onClose={closeDetailsAction}
        onOpenExecution={openExecutionFromDetails}
        onScheduleSaved={handleScheduleSaved}
      />
    </section>
  );
}
