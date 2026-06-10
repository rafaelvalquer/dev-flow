import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addWeeks, endOfWeek, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";

import { cn } from "@/lib/utils";

import {
  extractYmd,
  getDueYmd,
  getIssueKey,
  getStatus,
  norm,
} from "../utils/developerTicketUtils";

export function CalendarWidget({ rows, onOpenExecution, onShowAll }) {
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());

  const weekStart = startOfWeek(weekAnchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekAnchor, { weekStartsOn: 1 });
  const weekLabel = `${format(weekStart, "dd/MM")} - ${format(weekEnd, "dd/MM/yyyy")}`;
  const groups = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).map(
    (day) => {
      const ymd = extractYmd(day);

      return {
        ymd,
        label: format(day, "EEE dd/MM", { locale: ptBR }),
        rows: rows.filter((issue) => getDueYmd(issue) === ymd).slice(0, 4),
      };
    },
  );

  const handlePreviousWeek = () => {
    setWeekAnchor((current) => addWeeks(current, -1));
  };

  const handleCurrentWeek = () => {
    setWeekAnchor(new Date());
  };

  const handleNextWeek = () => {
    setWeekAnchor((current) => addWeeks(current, 1));
  };

  const getEventStatusLabel = (issue) => {
    const status = norm(getStatus(issue));

    if (status.includes("homolog")) return "HML";
    if (status.includes("deploy")) return "Deploy";
    return "Dev";
  };

  return (
    <div className="developer-calendar-board">
      <div className="developer-calendar-board__top">
        <span>{weekLabel}</span>
        <div className="developer-calendar-board__controls">
          <button
            type="button"
            aria-label="Semana anterior"
            title="Semana anterior"
            onClick={handlePreviousWeek}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={handleCurrentWeek}>
            Hoje
          </button>
          <button
            type="button"
            aria-label="Próxima semana"
            title="Próxima semana"
            onClick={handleNextWeek}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="developer-calendar-grid">
        <div className="developer-calendar-hours">
          {["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"].map((hour) => (
            <span key={hour}>{hour}</span>
          ))}
        </div>
        {groups.map((group) => (
          <div key={group.ymd} className="developer-calendar-day">
            <strong>{group.label}</strong>
            <div className="developer-calendar-day__slots">
              {group.rows.length ? (
                group.rows.map((issue, index) => (
                  <button
                    type="button"
                    key={getIssueKey(issue)}
                    className={cn("developer-calendar-event", `tone-${index % 4}`)}
                    onClick={() => onOpenExecution(getIssueKey(issue))}
                  >
                    <span>{getEventStatusLabel(issue)}</span>
                    {getIssueKey(issue)}
                  </button>
                ))
              ) : (
                <span className="developer-calendar-empty" />
              )}
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="developer-widget-link" onClick={onShowAll}>
        Ver calendário completo
      </button>
    </div>
  );
}
