import { TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { EmptyWidgetText } from "../components/EmptyWidgetText";
import { buildRiskRows } from "../utils/developerRiskRules";
import { dueLabel, dueTone, getIssueKey, getPriority, priorityTone } from "../utils/developerTicketUtils";

export function RiskWidget({ rows, onOpenExecution, onShowAll }) {
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
            {priorityTone(getPriority(issue)) === "danger" ? "Crítico" : getPriority(issue)}
          </Badge>
        </button>
      ))}
      <button type="button" className="developer-widget-link" onClick={onShowAll}>
        Ver todos em risco
      </button>
    </div>
  );
}
