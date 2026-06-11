import { EmptyWidgetText } from "../components/EmptyWidgetText";
import {
  buildNextActions,
  groupNextActions,
} from "../utils/developerRiskRules";

const DETAILS_ACTION_TYPES = new Set([
  "startTicket",
  "setDueDate",
  "missingSchedule",
]);

export function NextActionsWidget({
  rows,
  onOpenExecution,
  onStartTicket,
  onOpenDetails,
  onShowAll,
}) {
  const actions = buildNextActions(rows, 6);
  const groupedActions = groupNextActions(actions);

  if (!actions.length) return <EmptyWidgetText text="Sem próximas ações." />;

  function handleActionClick(action) {
    if (DETAILS_ACTION_TYPES.has(action.type)) {
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

    onOpenExecution?.(action.key, {
      activeTab: action.activeTab || "",
    });
  }

  return (
    <div className="developer-checklist-actions developer-checklist-actions--grouped">
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
                className="developer-action-item"
                onClick={() => handleActionClick(action)}
                title={action.description || action.label}
              >
                <span className="developer-checkbox" />

                <span className="developer-action-item__content">
                  <strong>{action.label}</strong>
                  <small>{action.key}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
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
