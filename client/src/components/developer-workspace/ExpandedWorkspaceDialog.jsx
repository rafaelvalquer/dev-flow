import { TriangleAlert } from "lucide-react";
import { groupNextActions } from "./utils/developerRiskRules";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { ExpandedTicketRow } from "./widgets";
import {
  dueLabel,
  dueTone,
  fmtDateBr,
  getDueYmd,
  getIssueKey,
  getPriority,
  getStatus,
  getSummary,
  priorityTone,
  relativeAccessLabel,
} from "./utils/developerTicketUtils";

export function ExpandedWorkspaceDialog({
  open,
  widget,
  rows,
  riskRows,
  actions,
  recentTickets,
  stickyNotes,
  onOpenChange,
  onOpenExecution,
  onStartTicket,
  onOpenDetails,
}) {
  const titles = {
    queue: ["Todos os tickets", "Fila filtrada do Workspace."],
    recent: ["Últimos acessados", "Histórico recente de execução."],
    risk: [
      "Tickets em risco",
      "Itens com vencimento, evidência ou GMUD pendente.",
    ],
    actions: ["Todas as ações", "Próximos passos sugeridos para sua fila."],
    calendar: ["Calendário completo", "Tickets organizados por data limite."],
    notes: ["Todas as notas", "Notas privadas salvas no Dev Flow."],
  };
  const [title, description] = titles[widget] || ["Workspace", ""];

  const groupedActions = groupNextActions(actions || []);
  const detailsActionTypes = new Set([
    "startTicket",
    "setDueDate",
    "missingSchedule",
  ]);

  function handleActionClick(action) {
    if (detailsActionTypes.has(action.type)) {
      if (onOpenDetails) {
        onOpenDetails(action);
        return;
      }

      if (action.type === "startTicket") {
        onStartTicket?.(action);
        return;
      }
    }

    if (action.type === "startTicket") {
      onStartTicket?.(action);
      return;
    }

    onOpenExecution(action.key, {
      activeTab: action.activeTab || "",
    });
  }
  const notesEntries = [...(stickyNotes || [])]
    .filter((note) => String(note?.text || "").trim())
    .sort((a, b) => {
      if (Boolean(a?.pinned) !== Boolean(b?.pinned)) {
        return a?.pinned ? -1 : 1;
      }

      if (Boolean(a?.resolved) !== Boolean(b?.resolved)) {
        return a?.resolved ? 1 : -1;
      }

      return (
        new Date(b?.updatedAt || b?.createdAt || 0) -
        new Date(a?.updatedAt || a?.createdAt || 0)
      );
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
                className={cn(
                  "developer-risk-item",
                  `developer-risk-item--${dueTone(issue)}`,
                )}
                onClick={() => onOpenExecution(getIssueKey(issue))}
              >
                <TriangleAlert className="h-4 w-4" />
                <span>
                  <strong>{getIssueKey(issue)}</strong>
                  <small>
                    {getSummary(issue)} - {dueLabel(issue)}
                  </small>
                </span>
                <Badge
                  className={cn(
                    "developer-badge",
                    `developer-badge--${priorityTone(getPriority(issue))}`,
                  )}
                >
                  {getPriority(issue)}
                </Badge>
              </button>
            ))}
          </div>
        ) : null}

        {widget === "actions" ? (
          <div className="developer-list developer-list--expanded developer-list--grouped-actions">
            {groupedActions.map((group) => (
              <section key={group.id} className="developer-action-group">
                <div className="developer-action-group__header">
                  <strong>{group.title}</strong>
                  <small>{group.actions.length}</small>
                </div>

                <div className="developer-action-group__list">
                  {group.actions.map((action) => (
                    <button
                      type="button"
                      key={`${action.key}:${action.type}`}
                      className="developer-action-item developer-action-item--expanded"
                      onClick={() => handleActionClick(action)}
                      title={action.description || action.label}
                    >
                      <span className="developer-checkbox" />

                      <span className="developer-action-item__content">
                        <strong>
                          {action.label} - {action.key}
                        </strong>
                        <small>
                          {action.description || "Abrir ação do ticket."}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
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
                <span>
                  {getIssueKey(issue)} - {getSummary(issue)}
                </span>
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
                onClick={() =>
                  onOpenExecution(item.ticketKey, { activeTab: item.activeTab })
                }
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
            {notesEntries.map((note) => (
              <article key={note.id}>
                <strong>{note.ticketKey || "Nota livre"}</strong>

                {note.title && note.title !== note.ticketKey ? (
                  <small>{note.title}</small>
                ) : null}

                <p>{note.text}</p>
              </article>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default ExpandedWorkspaceDialog;
