// src/lib/jiraPoView.js
import {
  jiraSearchJqlAll,
  jiraGetIssue,
  jiraGetComments,
  jiraEditIssue,
  mapLimit,
} from "./jiraClient";
import { containsTagInComments } from "../lib/adf";
import {
  ATIVIDADES_PADRAO,
  parseCronogramaADF,
  buildCronogramaADF,
  toCalendarEvents,
  formatDateRangeBR,
} from "../utils/cronograma";

export const PO_JQL_BODY = {
  jql: 'project = ICON AND status IN ("PRE SAVE", "Para Dev", "Desenvolvimento", "Para Homolog.", "Homolog. Negócio", "Para Deploy") AND updated >= -365d ORDER BY updated DESC',
  maxResults: 100,
  fields: [
    "key",
    "summary",
    "status",
    "issuetype",
    "updated",
    "assignee",
    "parent",
  ],
};

// campos necessários no detalhe
const ISSUE_FIELDS =
  "summary,status,issuetype,created,updated,assignee,parent,customfield_14017";

export async function fetchPoIssuesDetailed({ concurrency = 8 } = {}) {
  const baseIssues = await jiraSearchJqlAll(PO_JQL_BODY);

  const keys = baseIssues.map((i) => i.key);

  const detailed = await mapLimit(keys, concurrency, async (key) => {
    const issue = await jiraGetIssue(key, ISSUE_FIELDS);
    const comments = await jiraGetComments(key);

    const statusName = issue?.fields?.status?.name || "";
    const hasIniciado = containsTagInComments(comments, "[INICIADO]");
    const cronogramaAdf = issue?.fields?.customfield_14017 || null;

    return {
      key,
      summary: issue?.fields?.summary || "",
      statusName,
      createdRaw: issue?.fields?.created || "",
      updated: issue?.fields?.updated || "",
      assignee: issue?.fields?.assignee?.displayName || "",
      issueType: issue?.fields?.issuetype?.name || "",
      parentKey: issue?.fields?.parent?.key || "",
      hasIniciado,
      cronogramaAdf,
    };
  });

  return detailed;
}

export function buildPoView(detailedIssues) {
  const alertas = [];
  const criarCronograma = [];
  const calendarioIssues = [];

  for (const it of detailedIssues) {
    if (it.statusName === "PRE SAVE") {
      if (!it.hasIniciado) alertas.push(it);
      continue;
    }

    const inProgressStatuses = new Set([
      "Para Dev",
      "Desenvolvimento",
      "Para Homolog.",
      "Homolog. Negócio",
      "Para Deploy",
    ]);

    if (!inProgressStatuses.has(it.statusName)) continue;

    if (!it.cronogramaAdf) {
      criarCronograma.push(it);
      continue;
    }

    const atividades = parseCronogramaADF(it.cronogramaAdf);
    if (!atividades || atividades.length === 0) {
      // campo existe mas vazio/sem tabela válida
      criarCronograma.push(it);
      continue;
    }

    calendarioIssues.push({ ...it, atividades });
  }

  // eventos do calendário
  const now = new Date();
  const events = calendarioIssues.flatMap((i) =>
    toCalendarEvents(i.key, i.atividades, now)
  );

  return { alertas, criarCronograma, calendarioIssues, events };
}

export function makeDefaultCronogramaDraft() {
  return ATIVIDADES_PADRAO.map((a) => ({
    id: a.id,
    name: a.name,
    data: "",
    recurso: "",
    area: "",
  }));
}

export async function saveCronogramaToJira(issueKey, atividades) {
  const adf = buildCronogramaADF(atividades);
  await jiraEditIssue(issueKey, {
    fields: {
      customfield_14017: adf,
    },
  });
  return adf;
}

export function applyEventChangeToAtividades(
  atividades,
  activityId,
  eventStart,
  eventEndExclusive
) {
  const next = atividades.map((a) => ({ ...a }));

  const idx = next.findIndex((a) => a.id === activityId);
  if (idx < 0) return next;

  const start = new Date(eventStart);
  const endExclusive = eventEndExclusive ? new Date(eventEndExclusive) : null;

  // all-day: end é exclusivo → inclusive = endExclusive - 1 dia
  let inclusiveEnd = start;
  if (endExclusive) {
    inclusiveEnd = new Date(endExclusive);
    inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  }

  next[idx].data = formatDateRangeBR(start, inclusiveEnd);
  return next;
}
