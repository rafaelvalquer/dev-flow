import { EmptyWidgetText } from "../components/EmptyWidgetText";
import { buildNextActions } from "../utils/developerRiskRules";

export function NextActionsWidget({ rows, onOpenExecution, onShowAll }) {
  const actions = buildNextActions(rows, 6);

  if (!actions.length) return <EmptyWidgetText text="Sem próximas ações." />;

  return (
    <div className="developer-checklist-actions">
      {actions.map((action) => (
        <button
          type="button"
          key={`${action.key}:${action.label}`}
          className="developer-action-item"
          onClick={() => onOpenExecution(action.key)}
        >
          <span className="developer-checkbox" />
          <span>{action.label}</span>
        </button>
      ))}
      <button type="button" className="developer-widget-link" onClick={onShowAll}>
        Ver todas as ações
      </button>
    </div>
  );
}
