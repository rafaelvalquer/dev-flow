import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { EmptyWidgetText } from "../components/EmptyWidgetText";
import {
  dueLabel,
  dueTone,
  fmtDateBr,
  getDueYmd,
  getIssueKey,
  getPriority,
  getProgress,
  getStatus,
  getSummary,
  priorityTone,
} from "../utils/developerTicketUtils";

export function QueueWidget({ rows, loading, onOpenExecution, onShowAll }) {
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

export function TicketRow({ issue, onOpenExecution, compact = false }) {
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
          title={`Abrir execução de ${key}`}
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

export function ExpandedTicketRow({ issue, onOpenExecution }) {
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
        Abrir execução
      </Button>
    </article>
  );
}
