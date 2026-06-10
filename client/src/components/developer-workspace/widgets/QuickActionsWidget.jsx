import {
  ClipboardCopy,
  CloudUpload,
  ExternalLink,
  ListTodo,
  MessageSquare,
  Play,
} from "lucide-react";

import { cn } from "@/lib/utils";

import {
  getProgress,
  getStatus,
  getSummary,
} from "../utils/developerTicketUtils";

const ACTIONS = [
  { id: "jira", label: "Abrir Jira", icon: ExternalLink, tone: "blue", needsContext: true },
  { id: "continue", label: "Continuar execução", icon: Play, tone: "red", needsContext: true },
  { id: "comment", label: "Registrar comentário", icon: MessageSquare, tone: "blue", needsContext: true },
  { id: "evidence", label: "Subir evidência", icon: CloudUpload, tone: "red", needsContext: true },
  { id: "copyTicket", label: "Copiar ticket", icon: ClipboardCopy, tone: "blue", needsContext: true },
  { id: "nextPending", label: "Próxima pendência", icon: ListTodo, tone: "red", needsContext: false },
];

export function QuickActionsWidget({ contextIssue, contextTicketKey, onAction }) {
  const hasContext = Boolean(contextTicketKey);
  const summary = hasContext ? getSummary(contextIssue) : "";
  const status = hasContext ? getStatus(contextIssue) || "Sem status" : "";
  const progress = hasContext ? getProgress(contextIssue) : 0;

  return (
    <div className="developer-quick-actions">
      <div className={cn("developer-quick-context", !hasContext && "is-empty")}>
        <span>Ticket de contexto</span>
        {hasContext ? (
          <>
            <strong>{contextTicketKey}</strong>
            <p title={summary}>{summary}</p>
            <small>{`${status} - ${progress}%`}</small>
          </>
        ) : (
          <>
            <strong>Nenhum ticket selecionado</strong>
            <p>Abra ou selecione um ticket para usar os atalhos diretos.</p>
          </>
        )}
      </div>

      <div className="developer-quick-actions__grid">
        {ACTIONS.map((action) => (
          <QuickAction
            key={action.id}
            icon={action.icon}
            label={action.label}
            tone={action.tone}
            disabled={action.needsContext && !hasContext}
            onClick={() => onAction(action.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function QuickAction({ icon: Icon, label, tone, disabled, onClick }) {
  return (
    <button
      type="button"
      className={cn("developer-quick-action", `developer-quick-action--${tone}`)}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="h-5 w-5" />
      <span>{label}</span>
    </button>
  );
}
