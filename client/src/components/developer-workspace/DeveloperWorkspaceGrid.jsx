import { Responsive } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Grid2X2,
  ListChecks,
  NotebookPen,
  Sparkles,
  TimerReset,
  TriangleAlert,
} from "lucide-react";

import { StickyNoteCard } from "./components/StickyNoteCard";
import { WidgetCard } from "./components/WidgetCard";
import {
  CalendarWidget,
  DailyWidget,
  NextActionsWidget,
  NotesWidget,
  QueueWidget,
  QuickActionsWidget,
  RecentWidget,
  RiskWidget,
  StatusQueueWidget,
} from "./widgets";
import { stickyGridKey } from "./utils/developerTicketUtils";

export default function DeveloperWorkspaceGrid({
  containerRef,
  mounted,
  width,
  layouts,
  handleLayoutChange,
  handleBreakpointChange,
  saveBreakpointLayout,
  visibleWidgetSet,
  filteredRows,
  loading,
  onOpenExecution,
  openExpandedWidget,
  sortedRows,
  workspace,
  noteTickets,
  noteTicketKey,
  setNoteTicketKey,
  notesDraft,
  setNotesDraft,
  saveNote,
  saving,
  handleQuickAction,
  focusedStickyId,
  onUpdateStickyNote,
  onToggleStickyPinned,
  onToggleStickyResolved,
  onConvertStickyToJiraComment,
  deleteStickyNote,
  stickyRefs,
}) {
  const stickyNotes = [...(workspace.stickyNotes || [])].sort((a, b) => {
    if (Boolean(a?.pinned) !== Boolean(b?.pinned)) return a?.pinned ? -1 : 1;
    if (Boolean(a?.resolved) !== Boolean(b?.resolved)) return a?.resolved ? 1 : -1;
    return new Date(b?.updatedAt || b?.createdAt || 0) - new Date(a?.updatedAt || a?.createdAt || 0);
  });

  return (
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

          {visibleWidgetSet.has("statusQueue") ? (
            <div key="statusQueue">
              <WidgetCard title="Fila por status" icon={BarChart3}>
                <StatusQueueWidget rows={sortedRows} />
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
              <WidgetCard title="Próximas ações" icon={Sparkles}>
                <NextActionsWidget
                  rows={sortedRows}
                  onOpenExecution={onOpenExecution}
                  onShowAll={() => openExpandedWidget("actions")}
                />
              </WidgetCard>
            </div>
          ) : null}

          {visibleWidgetSet.has("daily") ? (
            <div key="daily">
              <WidgetCard title="Daily de hoje" icon={ClipboardList}>
                <DailyWidget
                  rows={sortedRows}
                  onOpenExecution={onOpenExecution}
                />
              </WidgetCard>
            </div>
          ) : null}

          {visibleWidgetSet.has("calendar") ? (
            <div key="calendar">
              <WidgetCard title="Calendário da semana" icon={CalendarDays}>
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
              <WidgetCard title="Atalhos rápidos" icon={Grid2X2}>
                <QuickActionsWidget onAction={handleQuickAction} />
              </WidgetCard>
            </div>
          ) : null}

          {stickyNotes.map((note) => (
            <div key={stickyGridKey(note.id)} className="developer-sticky-grid-item">
              <StickyNoteCard
                note={note}
                focused={focusedStickyId === note.id}
                saving={saving}
                onUpdate={onUpdateStickyNote}
                onTogglePinned={() => onToggleStickyPinned(note)}
                onToggleResolved={() => onToggleStickyResolved(note)}
                onConvertToJiraComment={() => onConvertStickyToJiraComment(note)}
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
  );
}
