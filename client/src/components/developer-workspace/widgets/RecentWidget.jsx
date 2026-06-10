import { EmptyWidgetText } from "../components/EmptyWidgetText";
import { relativeAccessLabel } from "../utils/developerTicketUtils";

export function RecentWidget({ recentTickets, onOpenExecution, onShowAll }) {
  const items = (recentTickets || []).slice(0, 6);
  if (!items.length) {
    return <EmptyWidgetText text="Abra um ticket para criar seu histórico." />;
  }

  return (
    <div className="developer-list">
      {items.map((item) => (
        <button
          type="button"
          key={item.ticketKey}
          className="developer-recent-item"
          onClick={() => onOpenExecution(item.ticketKey, { activeTab: item.activeTab })}
        >
          <span>
            <strong>{item.ticketKey}</strong>
            <small>{item.summary || "Sem resumo"}</small>
          </span>
          <em>{relativeAccessLabel(item.accessedAt)}</em>
        </button>
      ))}
      <button type="button" className="developer-widget-link" onClick={onShowAll}>
        Ver todos os acessados
      </button>
    </div>
  );
}
