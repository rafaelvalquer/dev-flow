import {
  AlertTriangle,
  CheckCircle2,
  Flame,
  RefreshCw,
} from "lucide-react";

import { EmptyWidgetText } from "../components/EmptyWidgetText";
import {
  getAssigneeAccountId,
  getDueYmd,
  getUpdatedDate,
  isDone,
  parseYmdLocal,
  todayLocal,
} from "../utils/developerTicketUtils";

const WEEKLY_DONE_GOAL = 5;

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function ymdLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfWeekMonday(date) {
  const start = startOfLocalDay(date);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  return start;
}

function getResolvedDate(issue) {
  const raw =
    issue?.resolutionDateRaw ||
    issue?.resolutiondate ||
    issue?.resolved ||
    issue?.fields?.resolutiondate;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function countActiveDayStreak(rows, today) {
  const activeDays = new Set(
    (rows || [])
      .map(getUpdatedDate)
      .filter(Boolean)
      .map((date) => ymdLocal(date)),
  );

  let cursor = startOfLocalDay(today);
  if (!activeDays.has(ymdLocal(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (activeDays.has(ymdLocal(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function plural(count, singular, pluralLabel) {
  return count === 1 ? singular : pluralLabel;
}

function RhythmMetric({ icon: Icon, label, value, helper, tone }) {
  return (
    <div className={`developer-rhythm-metric developer-rhythm-metric--${tone}`}>
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  );
}

export function RhythmWidget({ rows, doneRows, currentUser }) {
  const today = todayLocal();
  const todayYmd = ymdLocal(today);
  const weekStart = startOfWeekMonday(today);
  const accountId = String(currentUser?.jiraAccountId || "").trim();

  const completedThisWeek = (doneRows || []).filter((issue) => {
    if (accountId && String(getAssigneeAccountId(issue)).trim() !== accountId) {
      return false;
    }
    const resolved = getResolvedDate(issue);
    return resolved && resolved >= weekStart && resolved <= new Date();
  }).length;

  const overdue = (rows || []).filter((issue) => {
    if (isDone(issue)) return false;
    const due = parseYmdLocal(getDueYmd(issue));
    return due && due < today;
  }).length;

  const updatedToday = (rows || []).filter((issue) => {
    const updated = getUpdatedDate(issue);
    return updated && ymdLocal(updated) === todayYmd;
  }).length;

  const streak = countActiveDayStreak(rows, today);
  const progress = Math.min(
    100,
    Math.round((completedThisWeek / WEEKLY_DONE_GOAL) * 100),
  );
  const hasRhythmData = Boolean(rows?.length || completedThisWeek > 0);

  let insight = "Comece atualizando sua fila para criar cadencia esta semana.";
  if (streak >= 3) {
    insight = `Boa cadencia: sua fila foi atualizada nos ultimos ${streak} dias.`;
  } else if (updatedToday > 0) {
    insight = `Fila ativa hoje: ${updatedToday} ${plural(
      updatedToday,
      "ticket atualizado",
      "tickets atualizados",
    )}.`;
  } else if (overdue > 0) {
    insight = `Atencao: ha ${overdue} ${plural(
      overdue,
      "ticket atrasado",
      "tickets atrasados",
    )} na sua fila.`;
  }

  if (!hasRhythmData) {
    return <EmptyWidgetText text="Sem dados de ritmo para exibir ainda." />;
  }

  return (
    <div className="developer-rhythm">
      <div className="developer-rhythm__metrics">
        <RhythmMetric
          icon={CheckCircle2}
          label="Concluidos"
          value={completedThisWeek}
          helper="na semana"
          tone="success"
        />
        <RhythmMetric
          icon={AlertTriangle}
          label="Atrasados"
          value={overdue}
          helper="na fila"
          tone={overdue > 0 ? "danger" : "neutral"}
        />
        <RhythmMetric
          icon={RefreshCw}
          label="Atualizados"
          value={updatedToday}
          helper="hoje"
          tone="info"
        />
        <RhythmMetric
          icon={Flame}
          label="Streak"
          value={streak}
          helper={plural(streak, "dia ativo", "dias ativos")}
          tone="warning"
        />
      </div>

      <div className="developer-rhythm__progress" aria-label="Progresso semanal">
        <div>
          <span>Meta semanal</span>
          <strong>{`${completedThisWeek}/${WEEKLY_DONE_GOAL} concluidos`}</strong>
        </div>
        <div className="developer-rhythm__track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <p className="developer-rhythm__insight">{insight}</p>
    </div>
  );
}
