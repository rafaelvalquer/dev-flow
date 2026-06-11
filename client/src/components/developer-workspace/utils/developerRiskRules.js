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
    .map((issue) => {
      const key = getIssueKey(issue);

      if (isAwaitingGmud(issue)) {
        return {
          key,
          type: "startTicket",
          label: "Iniciar ticket",
          description: "Ticket ainda sem início operacional.",
          issue,
        };
      }

      if (!hasEvidence(issue)) {
        return {
          key,
          type: "uploadEvidence",
          label: "Subir evidência",
          description: "Ticket ainda não possui anexos/evidências.",
          issue,
          activeTab: "evidencias",
        };
      }

      if (!getDueYmd(issue)) {
        return {
          key,
          type: "setDueDate",
          label: "Definir data limite",
          description: "Ticket ainda não possui data limite.",
          issue,
        };
      }

      return {
        key,
        type: "updateExecution",
        label: "Atualizar execução",
        description: "Continuar o acompanhamento operacional do ticket.",
        issue,
      };
    })
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
