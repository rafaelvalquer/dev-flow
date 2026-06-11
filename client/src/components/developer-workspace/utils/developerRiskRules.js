import { parseCronogramaADF } from "../../../utils/cronograma";
import {
  diffDaysFromToday,
  dueLabel,
  getDueYmd,
  getIssueKey,
  getProgress,
  getStatus,
  getSummary,
  hasEvidence,
  isAwaitingGmud,
  isDone,
} from "./developerTicketUtils";

export const NEXT_ACTION_GROUPS = [
  { id: "urgent", title: "Urgente" },
  { id: "documentation", title: "Documentação" },
  { id: "execution", title: "Execução" },
];

function getIssueScheduleAdf(issue) {
  return (
    issue?.cronogramaAdf ||
    issue?.customfield_14017 ||
    issue?.fields?.customfield_14017 ||
    null
  );
}

function hasScheduleData(issue) {
  const parsed = parseCronogramaADF(getIssueScheduleAdf(issue));

  if (!parsed.length) return false;

  return parsed.some((activity) => {
    const values = [
      activity?.data,
      activity?.recurso,
      activity?.area,
      activity?.risco,
    ];

    return values.some((value) => {
      const text = String(value || "").trim();

      if (!text) return false;
      if (text === "—") return false;
      if (/^sem recurso$/i.test(text)) return false;

      return true;
    });
  });
}

export function groupNextActions(actions = []) {
  const groups = NEXT_ACTION_GROUPS.map((group) => ({
    ...group,
    actions: actions.filter((action) => action.category === group.id),
  })).filter((group) => group.actions.length > 0);

  const groupedIds = new Set(NEXT_ACTION_GROUPS.map((group) => group.id));
  const others = actions.filter((action) => !groupedIds.has(action.category));

  if (others.length) {
    groups.push({
      id: "others",
      title: "Outras ações",
      actions: others,
    });
  }

  return groups;
}

export function buildRiskRows(rows, limit = 6) {
  return (rows || [])
    .filter((issue) => {
      const days = diffDaysFromToday(getDueYmd(issue));
      return (
        days === null ||
        days <= 2 ||
        !hasEvidence(issue) ||
        isAwaitingGmud(issue)
      );
    })
    .slice(0, limit);
}

export function buildNextActions(rows, limit = 6) {
  return (rows || [])
    .flatMap((issue) => {
      const key = getIssueKey(issue);
      const actions = [];

      if (!key) return actions;

      if (isAwaitingGmud(issue)) {
        actions.push({
          key,
          type: "startTicket",
          category: "execution",
          label: "Iniciar ticket",
          description: "Ticket ainda sem início operacional.",
          issue,
          openDetails: true,
        });

        return actions;
      }

      if (!hasEvidence(issue)) {
        actions.push({
          key,
          type: "uploadEvidence",
          category: "urgent",
          label: "Subir evidência",
          description: "Ticket ainda não possui anexos/evidências.",
          issue,
          activeTab: "evidencias",
        });
      }

      if (!getDueYmd(issue)) {
        actions.push({
          key,
          type: "setDueDate",
          category: "urgent",
          label: "Definir data limite",
          description: "Ticket ainda não possui data limite.",
          issue,
          openDetails: true,
        });
      }

      if (!hasScheduleData(issue)) {
        actions.push({
          key,
          type: "missingSchedule",
          category: "documentation",
          label: "Criar cronograma",
          description: "Ticket ainda está sem cronograma de implantação.",
          issue,
          openDetails: true,
        });
      }

      return actions;
    })
    .filter(Boolean)
    .slice(0, limit);
}

function formatActionText(action) {
  return `${action.label} do ${action.key}`.trim();
}

export function buildDailySummary(rows, riskRows, actions) {
  const activeRows = (rows || []).filter((issue) => !isDone(issue));
  const pendingActions = actions || buildNextActions(rows, 4);
  const riskItems = riskRows || buildRiskRows(rows, 4);
  const active = activeRows.slice(0, 3).map((issue) => {
    const key = getIssueKey(issue);
    const status = getStatus(issue) || "Sem status";
    const progress = getProgress(issue);
    return {
      key,
      status,
      progress,
      issue,
      text: `${key} — ${status} — ${progress}%`,
    };
  });
  const pending = pendingActions.slice(0, 4).map((action) => ({
    ...action,
    text: formatActionText(action),
  }));
  const risks = riskItems.slice(0, 4).map((issue) => {
    const key = getIssueKey(issue);
    const label = dueLabel(issue).toLowerCase();
    return {
      key,
      issue,
      text: `${key} ${label}`,
    };
  });

  const dueSoon = activeRows.filter((issue) => {
    const days = diffDaysFromToday(getDueYmd(issue));
    return days !== null && days >= 0 && days <= 2;
  });

  const lines = [
    "Status daily - Central do Desenvolvedor",
    `Tickets ativos: ${activeRows.length}`,
    `Vencendo: ${dueSoon.length}`,
    `Em risco: ${risks.length}`,
    "",
    "Estou atuando em:",
    ...(active.length
      ? active.map((item) => `- ${item.text}`)
      : ["- Sem itens ativos."]),
    "",
    "Pendências:",
    ...(pending.length
      ? pending.map((item) => `- ${item.text}`)
      : ["- Sem pendências imediatas."]),
    "",
    "Riscos:",
    ...(risks.length
      ? risks.map((item) => `- ${item.text}: ${getSummary(item.issue)}`)
      : ["- Sem riscos imediatos."]),
  ];

  return {
    active,
    pending,
    risks,
    text: lines.join("\n").trim(),
  };
}

export function buildDailyStatus(rows, riskRows, actions) {
  return buildDailySummary(rows, riskRows, actions).text;
}
