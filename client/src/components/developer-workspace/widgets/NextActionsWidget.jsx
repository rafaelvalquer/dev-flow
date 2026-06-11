import { EmptyWidgetText } from "../components/EmptyWidgetText";
import { buildNextActions } from "../utils/developerRiskRules";

export function NextActionsWidget({
  rows,
  onOpenExecution,
  onStartTicket,
  onShowAll,
}) {
  const actions = buildNextActions(rows, 6);

  if (!actions.length) return <EmptyWidgetText text="Sem próximas ações." />;

  function handleActionClick(action) {
    if (action.type === "startTicket") {
      onStartTicket?.(action);
      return;
    }

    onOpenExecution(action.key, {
      activeTab: action.activeTab || "",
    });
  }

  return (
    <div className="developer-checklist-actions">
      {actions.map((action) => (
        <button
          type="button"
          key={`${action.key}:${action.label}`}
          className="developer-action-item"
          onClick={() => handleActionClick(action)}
          title={action.description || action.label}
        >
          <span className="developer-checkbox" />
          <span>{action.label}</span>
        </button>
      ))}

      <button
        type="button"
        className="developer-widget-link"
        onClick={onShowAll}
      >
        Ver todas as ações
      </button>
    </div>
  );
}
