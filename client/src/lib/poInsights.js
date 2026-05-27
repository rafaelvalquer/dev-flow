import { parseDateRangeBR } from "../utils/cronograma";

const DOCUMENTATION_FOLDER_LABEL = "pasta-criada";

function normalizeStr(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extractYmd(v) {
  if (!v) return "";

  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  if (typeof v === "string") {
    const ymd = v.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
  }

  if (typeof v === "object") {
    const candidate =
      v?.value ||
      v?.date ||
      v?.start ||
      v?.end ||
      v?.startDate ||
      v?.endDate ||
      v?.from ||
      v?.to ||
      "";
    return extractYmd(candidate);
  }

  return "";
}

function parseIsoYmdLocal(ymd) {
  const s = String(ymd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function startOfTodayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function diffDays(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function daysBetween(a, b) {
  return Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function toNamesArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        typeof x === "string" ? x : x?.value || x?.name || x?.label || ""
      )
      .map((s) => String(s).trim())
      .filter(Boolean);
  }
  if (typeof v === "string") return [v.trim()].filter(Boolean);
  if (typeof v === "object") {
    const one = v?.value || v?.name || v?.label || "";
    return [String(one).trim()].filter(Boolean);
  }
  return [String(v).trim()].filter(Boolean);
}

function isDoneStatus(statusName) {
  return /(DONE|CONCLU|RESOLV|CLOSED|FECHAD)/i.test(String(statusName || ""));
}

function statusMacro(statusName) {
  const s = normalizeStr(statusName);
  if (!s) return "sem-status";
  if (/pre save|triagem/.test(s)) return "triagem";
  if (/backlog|refinamento|artefatos|para planejar/.test(s))
    return "levantamento";
  if (/planej/.test(s)) return "planejamento";
  if (/para dev|desenvolv|dev/.test(s)) return "execucao";
  if (/homolog/.test(s)) return "homologacao";
  if (/deploy/.test(s)) return "deploy";
  if (/done|conclu|resolv|closed|fechad/.test(s)) return "concluido";
  return "outros";
}

function humanStatusMacro(macro) {
  return (
    {
      triagem: "Triagem",
      levantamento: "Levantamento",
      planejamento: "Planejamento",
      execucao: "Execução",
      homologacao: "Homologação",
      deploy: "Deploy",
      concluido: "Concluído",
      outros: "Outros",
      "sem-status": "Sem status",
    }[macro] || macro
  );
}

function createEmptyCounter() {
  return new Map();
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function toCounterArray(map, limit = 8) {
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
}

function formatShortDate(date) {
  if (!date || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function getWeekLabel(date) {
  if (!date || Number.isNaN(date.getTime())) return "Sem semana";
  const start = new Date(date);
  const day = start.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${formatShortDate(start)}-${formatShortDate(end)}`;
}

function parseActivityWindow(activity) {
  const parsed = parseDateRangeBR(activity?.data || "");
  if (!parsed?.start) return null;
  return {
    start: parsed.start,
    end: parsed.end || parsed.start,
  };
}

function getNextMilestone(activities, today0) {
  const future = (activities || [])
    .map((activity) => {
      const window = parseActivityWindow(activity);
      if (!window) return null;
      return { ...activity, ...window };
    })
    .filter(Boolean)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const upcoming =
    future.find((activity) => activity.end.getTime() >= today0.getTime()) ||
    future[future.length - 1] ||
    null;

  if (!upcoming) return null;
  return {
    id: upcoming.id,
    name: upcoming.name,
    start: upcoming.start,
    end: upcoming.end,
    label:
      upcoming.start.getTime() === upcoming.end.getTime()
        ? `${upcoming.name} • ${formatShortDate(upcoming.start)}`
        : `${upcoming.name} • ${formatShortDate(upcoming.start)} a ${formatShortDate(upcoming.end)}`,
  };
}

function buildConflictMaps(calendarioIssues) {
  const conflictByIssue = new Map();
  const conflictByActivity = new Map();
  const resourceRows = new Map();

  for (const issue of calendarioIssues || []) {
    const issueKey = String(issue?.key || "").trim().toUpperCase();
    const activities = Array.isArray(issue?.atividades) ? issue.atividades : [];

    for (const activity of activities) {
      const resource = String(activity?.recurso || "").trim() || "Sem recurso";
      const activityKey = `${issueKey}::${String(activity?.id || "").trim()}`;
      const window = parseActivityWindow(activity);

      if (!resourceRows.has(resource)) {
        resourceRows.set(resource, {
          resource,
          activities: 0,
          issues: new Set(),
          conflicts: 0,
          weeklyLoad: new Map(),
          missing: resource === "Sem recurso",
        });
      }

      const row = resourceRows.get(resource);
      row.activities += 1;
      row.issues.add(issueKey);

      if (window) {
        increment(row.weeklyLoad, getWeekLabel(window.start));
        if (window.end.getTime() !== window.start.getTime()) {
          increment(row.weeklyLoad, getWeekLabel(window.end));
        }
      }

      if (resource === "Sem recurso" || !window) continue;

      if (!row.windows) row.windows = [];
      row.windows.push({
        issueKey,
        activityKey,
        start: window.start,
        end: window.end,
      });
    }
  }

  for (const row of resourceRows.values()) {
    const windows = Array.isArray(row.windows) ? row.windows : [];
    windows.sort((a, b) => a.start.getTime() - b.start.getTime());

    for (let index = 1; index < windows.length; index += 1) {
      const previous = windows[index - 1];
      const current = windows[index];

      if (current.start.getTime() <= previous.end.getTime()) {
        row.conflicts += 1;
        conflictByActivity.set(previous.activityKey, true);
        conflictByActivity.set(current.activityKey, true);
        increment(conflictByIssue, previous.issueKey);
        increment(conflictByIssue, current.issueKey);
      }
    }

    row.weeklyLoadEntries = toCounterArray(row.weeklyLoad, 6);
    delete row.weeklyLoad;
    delete row.windows;
  }

  return {
    conflictByIssue,
    conflictByActivity,
    resourceRows: Array.from(resourceRows.values())
      .map((row) => ({
        ...row,
        issues: row.issues.size,
      }))
      .sort((a, b) => {
        if (a.missing !== b.missing) return a.missing ? -1 : 1;
        if (a.conflicts !== b.conflicts) return b.conflicts - a.conflicts;
        return b.activities - a.activities;
      }),
  };
}

function getCommentPreview(commentsText) {
  const text = String(commentsText || "").trim();
  if (!text) return "Sem avanço recente";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function getIssueLabels(issue, fields = {}) {
  const labels = Array.isArray(issue?.labels)
    ? issue.labels
    : Array.isArray(fields?.labels)
      ? fields.labels
      : [];
  return labels.map((label) => String(label || "").trim()).filter(Boolean);
}

function hasDocumentationFolderLabel(labels) {
  const wanted = normalizeStr(DOCUMENTATION_FOLDER_LABEL);
  return (labels || []).some((label) => normalizeStr(label) === wanted);
}

function isSameLocalDay(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return false;
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function hasRecentDate(date, today0, days = 1) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const floor = new Date(today0);
  floor.setDate(floor.getDate() - days);
  return date.getTime() >= floor.getTime();
}

function buildDueTodayActivities(items, today0) {
  return items
    .flatMap((item) =>
      (item.activities || []).map((activity) => {
        const window = parseActivityWindow(activity);
        if (!window || !isSameLocalDay(window.end, today0)) return null;
        return {
          key: item.key,
          raw: item.raw,
          summary: item.summary,
          owner: item.owner,
          statusName: item.statusName,
          activityName: activity?.name || "Atividade",
          dueDate: window.end,
          reason: `${activity?.name || "Atividade"} vence hoje`,
          briefingReason: `${activity?.name || "Atividade"} vence hoje.`,
          recommendedAction:
            "Confirmar conclusão ou atualizar a data da atividade no cronograma.",
        };
      })
    )
    .filter(Boolean)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function getPrimaryActionReason(item) {
  if (!item) return "Acompanhar item";
  if (!item.hasSchedule) return "Sem cronograma";
  if (item.overdueDays > 0) return `Atrasado ${item.overdueDays}d`;
  if (!item.hasOwner) return "Sem responsável";
  if (item.hasCapacityConflict) return "Conflito de recurso";
  if (!item.hasStarted) return "Sem início";
  if (item.dueInDays === 0) return "Vence hoje";
  if (item.dueSoon) return "Vence nos próximos 7 dias";
  if (item.noRecentUpdate) return "Sem avanço recente";
  if (item.hasRisk) return "Com risco";
  if (item.canOrganizeDocumentation) return "Documentação pendente";
  return item.actionReasons?.[0] || "Acompanhar item";
}

function getBriefingReason(item, kind = "action") {
  if (!item) return "";

  if (kind === "changed") {
    if (item.resolvedDate) return "Ticket concluído recentemente.";
    if (item.daysSinceUpdate === 0) return "Ticket atualizado hoje.";
    if (item.daysSinceUpdate === 1) return "Ticket atualizado ontem.";
    return "Ticket teve atualização recente.";
  }

  if (kind === "delayed") {
    return item.overdueDays === 1
      ? "Prazo venceu há 1 dia."
      : `Prazo venceu há ${item.overdueDays || 0} dias.`;
  }

  if (kind === "dueToday") {
    if (item.activityName) return `${item.activityName} vence hoje.`;
    return "Data limite do ticket vence hoje.";
  }

  return getPrimaryActionReason(item);
}

function getRecommendedAction(item, kind = "action") {
  if (!item) return "Revisar o ticket e definir o próximo passo.";

  if (kind === "changed") {
    if (item.resolvedDate) return "Registrar no status report e validar se há pendências pós-fechamento.";
    return "Revisar a mudança e confirmar se o próximo marco continua válido.";
  }

  if (kind === "delayed") {
    if (!item.hasOwner) return "Definir responsável e renegociar a data com o time envolvido.";
    if (!item.hasSchedule) return "Criar cronograma com nova data acordada e responsáveis.";
    return "Acionar responsável, registrar impedimento e renegociar o prazo.";
  }

  if (kind === "dueToday") {
    return "Confirmar execução hoje ou atualizar o cronograma antes do fim do dia.";
  }

  if (!item.hasSchedule) return "Criar cronograma com atividades, datas e responsáveis.";
  if (!item.hasOwner) return "Definir responsável pelo ticket antes de avançar.";
  if (item.overdueDays > 0) return "Renegociar prazo e registrar plano de recuperação.";
  if (item.hasCapacityConflict) return "Rebalancear recurso ou ajustar sobreposição de datas.";
  if (!item.hasStarted) return "Validar início e mover o ticket para o fluxo correto.";
  if (item.dueSoon) return "Confirmar se as atividades finais estão em andamento.";
  if (item.noRecentUpdate) return "Cobrar atualização de status ou registrar impedimento.";
  if (item.hasRisk) return "Revisar risco marcado e definir mitigação.";
  if (item.canOrganizeDocumentation) return "Organizar documentação para liberar o próximo passo.";
  return "Revisar o ticket e confirmar o próximo marco.";
}

const RESOLUTION_DEFINITIONS = {
  noSchedule: {
    label: "Sem cronograma",
    reason: "O ticket ainda nao tem cronograma estruturado.",
    recommendedAction: "Criar cronograma com atividades, datas e responsaveis.",
  },
  noOwner: {
    label: "Sem responsável",
    reason: "O ticket não tem responsável definido.",
    recommendedAction: "Definir responsável pelo ticket antes de avançar.",
  },
  overdue: {
    label: "Atrasado",
    reason: "O prazo planejado ja venceu.",
    recommendedAction: "Renegociar prazo e registrar plano de recuperacao.",
  },
  capacityConflict: {
    label: "Conflito de recurso",
    reason: "Ha sobreposicao de agenda para o mesmo recurso.",
    recommendedAction: "Rebalancear recurso ou ajustar sobreposicao de datas.",
  },
  notStarted: {
    label: "Sem inicio",
    reason: "O ticket ainda nao foi marcado como iniciado.",
    recommendedAction: "Validar inicio e mover o ticket para o fluxo correto.",
  },
  dueSoon: {
    label: "Vence em breve",
    reason: "O prazo esta proximo do vencimento.",
    recommendedAction: "Confirmar se as atividades finais estao em andamento.",
  },
  noRecentUpdate: {
    label: "Sem avanço",
    reason: "O ticket esta sem atualizacao recente.",
    recommendedAction: "Cobrar atualizacao de status ou registrar impedimento.",
  },
  risk: {
    label: "Risco",
    reason: "Existe risco marcado no cronograma.",
    recommendedAction: "Revisar risco marcado e definir mitigacao.",
  },
  documentation: {
    label: "Documentacao",
    reason: "A documentacao ainda precisa ser organizada.",
    recommendedAction: "Organizar documentacao para liberar o proximo passo.",
  },
};

function makeResolutionProblem(type, item = {}, overrides = {}) {
  const base = RESOLUTION_DEFINITIONS[type] || {};
  return {
    type,
    label: overrides.label || base.label || type,
    reason: overrides.reason || base.reason || "",
    recommendedAction:
      overrides.recommendedAction || base.recommendedAction || "",
    key: item.key,
    summary: item.summary,
    owner: item.owner,
    raw: item.raw,
  };
}

function buildResolutionProblems(item) {
  if (!item) return [];
  const problems = [];

  if (!item.hasSchedule) problems.push(makeResolutionProblem("noSchedule", item));
  if (!item.hasOwner) problems.push(makeResolutionProblem("noOwner", item));
  if (item.overdueDays > 0) {
    problems.push(
      makeResolutionProblem("overdue", item, {
        label: `Atrasado ${item.overdueDays}d`,
        reason:
          item.overdueDays === 1
            ? "Prazo venceu ha 1 dia."
            : `Prazo venceu ha ${item.overdueDays} dias.`,
      })
    );
  }
  if (item.hasCapacityConflict) {
    problems.push(makeResolutionProblem("capacityConflict", item));
  }
  if (!item.hasStarted) problems.push(makeResolutionProblem("notStarted", item));
  if (item.dueSoon) {
    problems.push(
      makeResolutionProblem("dueSoon", item, {
        label: item.dueInDays === 0 ? "Vence hoje" : `Vence em ${item.dueInDays}d`,
      })
    );
  }
  if (item.noRecentUpdate) {
    problems.push(makeResolutionProblem("noRecentUpdate", item));
  }
  if (item.hasRisk) problems.push(makeResolutionProblem("risk", item));
  if (item.canOrganizeDocumentation) {
    problems.push(makeResolutionProblem("documentation", item));
  }

  return problems;
}

function decorateBriefingItem(item, kind) {
  if (!item) return item;
  const activityProblems = item.activityName
    ? [
        makeResolutionProblem("dueSoon", item, {
          label: "Vence hoje",
          reason: `${item.activityName} vence hoje.`,
          recommendedAction:
            "Confirmar conclusao ou atualizar a data da atividade no cronograma.",
        }),
      ]
    : [];
  return {
    ...item,
    briefingReason: item.briefingReason || getBriefingReason(item, kind),
    recommendedAction: item.recommendedAction || getRecommendedAction(item, kind),
    resolutionProblems:
      item.resolutionProblems ||
      (Array.isArray(item.actionReasons) ? buildResolutionProblems(item) : activityProblems),
  };
}

function matchesOwner(item, ownerAccountId = "", ownerFocus = "") {
  const accountId = String(ownerAccountId || "").trim();
  if (accountId && String(item?.assigneeAccountId || "").trim() === accountId) {
    return true;
  }
  if (accountId && item?.assigneeAccountId) return false;
  return ownerFocus
    ? normalizeStr(item?.owner).includes(normalizeStr(ownerFocus))
    : false;
}

export function buildPoInsights({
  rawIssues,
  viewData,
  doneRows,
  ownerFocus = "",
  ownerAccountId = "",
  excludeDoneFromOperationalSummary = false,
}) {
  const today0 = startOfTodayLocal();
  const calendarioIssues = Array.isArray(viewData?.calendarioIssues)
    ? viewData.calendarioIssues
    : [];
  const scheduleMap = new Map(
    calendarioIssues.map((issue) => [
      String(issue?.key || "").trim().toUpperCase(),
      issue,
    ])
  );
  const { conflictByIssue, resourceRows } = buildConflictMaps(calendarioIssues);

  const items = (rawIssues || []).map((issue) => {
    const fields = issue?.fields || {};
    const key = String(issue?.key || "").trim().toUpperCase();
    const owner =
      issue?.assignee ||
      fields?.assignee?.displayName ||
      fields?.assignee?.name ||
      "Sem responsável";
    const assigneeAccountId =
      issue?.assigneeAccountId || fields?.assignee?.accountId || "";
    const createdDate = new Date(
      issue?.createdRaw || issue?.created || fields?.created || Date.now()
    );
    const updatedDate = new Date(
      issue?.updatedRaw || issue?.updated || fields?.updated || Date.now()
    );
    const dueBaseYmd = extractYmd(issue?.dueDateRaw || fields?.duedate || issue?.duedate);
    const dueAltYmd = extractYmd(issue?.customfield_11519 || fields?.customfield_11519);
    const dueDate = parseIsoYmdLocal(dueAltYmd || dueBaseYmd);
    const dueInDays = dueDate ? diffDays(dueDate, today0) : null;
    const overdueDays =
      dueDate && dueDate.getTime() < today0.getTime()
        ? Math.max(1, diffDays(today0, dueDate))
        : 0;
    const issueSchedule = scheduleMap.get(key);
    const activities = Array.isArray(issueSchedule?.atividades)
      ? issueSchedule.atividades
      : [];
    const hasSchedule = activities.length > 0;
    const hasOwner = normalizeStr(owner) !== "sem responsavel";
    const hasStarted = Boolean(issue?.hasIniciado || issue?.hasStarted);
    const statusName = String(issue?.statusName || fields?.status?.name || "");
    const macro = statusMacro(statusName);
    const labels = getIssueLabels(issue, fields);
    const hasDocumentationFolder = hasDocumentationFolderLabel(labels);
    const attachmentCount = Array.isArray(issue?.attachments)
      ? issue.attachments.length
      : Array.isArray(fields?.attachment)
        ? fields.attachment.length
        : 0;
    const canOrganizeDocumentation = !hasDocumentationFolder;
    const nextMilestone = getNextMilestone(activities, today0);
    const activitiesAtRisk = activities.filter(
      (activity) => Boolean(activity?.risk) || normalizeStr(activity?.risco) === "risco"
    );
    const resources = Array.from(
      new Set(
        activities
          .map((activity) => String(activity?.recurso || "").trim() || "Sem recurso")
          .filter(Boolean)
      )
    );
    const directorates = toNamesArray(fields?.customfield_11520 || issue?.customfield_11520);
    const components = Array.isArray(fields?.components)
      ? fields.components
          .map((component) => component?.name || component)
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      : [];
    const daysSinceUpdate = Number.isNaN(updatedDate.getTime())
      ? null
      : Math.max(0, diffDays(today0, updatedDate));
    const daysSinceCreated = Number.isNaN(createdDate.getTime())
      ? null
      : Math.max(0, diffDays(today0, createdDate));
    const capacityConflict = Boolean(conflictByIssue.get(key));
    const hasRisk = activitiesAtRisk.length > 0;
    const noRecentUpdate = daysSinceUpdate != null && daysSinceUpdate >= 7;
    const dueSoon = dueInDays != null && dueInDays >= 0 && dueInDays <= 7;
    const isBlocked =
      !isDoneStatus(statusName) &&
      hasSchedule &&
      (!hasOwner || capacityConflict || noRecentUpdate);
    const isAtRisk =
      !isDoneStatus(statusName) &&
      (overdueDays > 0 ||
        !hasSchedule ||
        !hasOwner ||
        hasRisk ||
        capacityConflict ||
        dueSoon ||
        noRecentUpdate);

    const actionReasons = [];
    if (!hasSchedule) actionReasons.push("Sem cronograma");
    if (!hasOwner) actionReasons.push("Sem responsável");
    if (!dueDate) actionReasons.push("Sem data limite");
    if (!hasStarted) actionReasons.push("Sem início");
    if (hasRisk) actionReasons.push("Com risco");
    if (capacityConflict) actionReasons.push("Conflito de recurso");
    if (overdueDays > 0) actionReasons.push(`Atrasado ${overdueDays}d`);
    if (noRecentUpdate) actionReasons.push("Sem avanço recente");
    if (dueSoon) actionReasons.push("Vence em 7 dias");

    if (canOrganizeDocumentation) {
      actionReasons.push("Organizar documenta\u00e7\u00e3o");
    }

    const doneRecently = (doneRows || []).some(
      (row) => String(row?.key || "").trim().toUpperCase() === key
    );

    let processLane = "em execução";
    if (doneRecently || isDoneStatus(statusName)) processLane = "concluídos recentes";
    else if (macro === "triagem" && !hasStarted) processLane = "triagem";
    else if (macro === "levantamento") processLane = "levantamento";
    else if (!hasSchedule) processLane = "prontos para planejar";
    else if (isBlocked) processLane = "bloqueados";
    else if (isAtRisk) processLane = "em risco";

    let queueScore = 0;
    if (!hasSchedule) queueScore += 100;
    if (overdueDays > 0) queueScore += 90 + overdueDays;
    if (dueSoon) queueScore += 50;
    if (!hasOwner) queueScore += 70;
    if (capacityConflict) queueScore += 60;
    if (!hasStarted) queueScore += 35;
    if (canOrganizeDocumentation) queueScore += 45;
    if (noRecentUpdate) queueScore += 30;
    if (hasRisk) queueScore += 25;

    const baseItemForProblems = {
      key,
      raw: issue,
      summary: issue?.summary || fields?.summary || "—",
      owner,
      assigneeAccountId,
      assigneeDisplayName:
        issue?.assigneeDisplayName || fields?.assignee?.displayName || owner,
      assigneeEmailAddress:
        issue?.assigneeEmailAddress || fields?.assignee?.emailAddress || "",
      assigneeAvatarUrl:
        issue?.assigneeAvatarUrl ||
        fields?.assignee?.avatarUrls?.["48x48"] ||
        fields?.assignee?.avatarUrls?.["32x32"] ||
        "",
      hasSchedule,
      hasOwner,
      hasStarted,
      hasRisk,
      hasCapacityConflict: capacityConflict,
      overdueDays,
      dueInDays,
      dueSoon,
      noRecentUpdate,
      canOrganizeDocumentation,
    };
    const resolutionProblems = buildResolutionProblems(baseItemForProblems);

    return {
      key,
      raw: issue,
      summary: issue?.summary || fields?.summary || "—",
      owner,
      assigneeAccountId,
      assigneeDisplayName:
        issue?.assigneeDisplayName || fields?.assignee?.displayName || owner,
      assigneeEmailAddress:
        issue?.assigneeEmailAddress || fields?.assignee?.emailAddress || "",
      assigneeAvatarUrl:
        issue?.assigneeAvatarUrl ||
        fields?.assignee?.avatarUrls?.["48x48"] ||
        fields?.assignee?.avatarUrls?.["32x32"] ||
        "",
      statusName,
      statusMacro: macro,
      statusMacroLabel: humanStatusMacro(macro),
      processLane,
      priority: issue?.priorityName || fields?.priority?.name || "Não informado",
      issueType: issue?.issueType || fields?.issuetype?.name || "—",
      hasSchedule,
      hasOwner,
      hasStarted,
      hasDocumentationFolder,
      canOrganizeDocumentation,
      attachmentCount,
      labels,
      hasRisk,
      hasCapacityConflict: capacityConflict,
      isBlocked,
      isAtRisk,
      overdueDays,
      dueInDays,
      dueSoon,
      noRecentUpdate,
      daysSinceUpdate,
      daysSinceCreated,
      createdDate: Number.isNaN(createdDate.getTime()) ? null : createdDate,
      updatedDate: Number.isNaN(updatedDate.getTime()) ? null : updatedDate,
      dueDate,
      nextMilestone,
      directorates,
      components,
      resources,
      activities,
      activitiesAtRisk,
      actionReasons,
      resolutionProblems,
      queueScore,
      commentPreview: getCommentPreview(issue?.commentsText || issue?.lastCommentText),
      recentDone: doneRecently,
    };
  });

  const filteredItems = ownerAccountId || ownerFocus
    ? items.filter((item) => matchesOwner(item, ownerAccountId, ownerFocus))
    : items;

  const filteredDirectorateCounter = createEmptyCounter();
  const filteredComponentCounter = createEmptyCounter();
  const filteredOwnerCounter = createEmptyCounter();
  const filteredStatusCounter = createEmptyCounter();
  const filteredLaneCounter = createEmptyCounter();
  const filteredAgingCounter = createEmptyCounter();

  filteredItems.forEach((item) => {
    (item.directorates || []).forEach((value) =>
      increment(filteredDirectorateCounter, value)
    );
    (item.components || []).forEach((value) =>
      increment(filteredComponentCounter, value)
    );
    increment(filteredOwnerCounter, item.owner);
    increment(filteredStatusCounter, item.statusMacroLabel);
    increment(filteredLaneCounter, item.processLane);

    const agingLabel =
      item.daysSinceCreated == null
        ? "Sem data"
        : item.daysSinceCreated <= 7
        ? "0-7d"
        : item.daysSinceCreated <= 14
        ? "8-14d"
        : item.daysSinceCreated <= 30
        ? "15-30d"
        : item.daysSinceCreated <= 60
        ? "31-60d"
        : "60+d";
    increment(filteredAgingCounter, agingLabel);
  });

  const isOperationalDoneItem = (item) =>
    Boolean(item?.recentDone) ||
    isDoneStatus(item?.statusName) ||
    normalizeStr(item?.processLane) === "concluidos recentes";

  const actionQueue = filteredItems
    .filter((item) =>
      excludeDoneFromOperationalSummary
        ? !isOperationalDoneItem(item)
        : !item.recentDone
    )
    .sort((a, b) => b.queueScore - a.queueScore || a.summary.localeCompare(b.summary));

  const risks = filteredItems
    .filter((item) => item.isAtRisk || item.isBlocked)
    .sort((a, b) => {
      if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
      return (b.actionReasons?.length || 0) - (a.actionReasons?.length || 0);
    });

  const roadmap = filteredItems
    .filter((item) => item.nextMilestone)
    .sort((a, b) => a.nextMilestone.start.getTime() - b.nextMilestone.start.getTime());

  const doneRecent = (doneRows || [])
    .map((row) => {
      const resolved = new Date(
        row?.resolutionDateRaw || row?.resolutionDate || Date.now()
      );
      return {
        key: String(row?.key || "").trim().toUpperCase(),
        summary: row?.summary || "—",
        statusName: row?.statusName || "Concluído",
        owner: row?.assignee || row?.assigneeDisplayName || "",
        assigneeAccountId: row?.assigneeAccountId || "",
        resolvedDate: Number.isNaN(resolved.getTime()) ? null : resolved,
      };
    })
    .filter((item) =>
      ownerAccountId || ownerFocus
        ? matchesOwner(item, ownerAccountId, ownerFocus)
        : true
    )
    .sort((a, b) => {
      const av = a.resolvedDate?.getTime() || 0;
      const bv = b.resolvedDate?.getTime() || 0;
      return bv - av;
    });

  const filteredResourceRows = ownerAccountId || ownerFocus
    ? buildConflictMaps(
        filteredItems.map((item) => ({
          key: item.key,
          atividades: item.activities || [],
        }))
      ).resourceRows
    : resourceRows;

  const operationalItems = excludeDoneFromOperationalSummary
    ? filteredItems.filter((item) => !isOperationalDoneItem(item))
    : filteredItems;

  const dueTodayActivities = buildDueTodayActivities(operationalItems, today0);
  const dueTodayIssues = operationalItems.filter((item) => item.dueInDays === 0);
  const overdueItems = operationalItems
    .filter((item) => item.overdueDays > 0)
    .sort((a, b) => b.overdueDays - a.overdueDays || b.queueScore - a.queueScore);
  const noScheduleItems = operationalItems
    .filter((item) => !item.hasSchedule)
    .sort((a, b) => b.queueScore - a.queueScore || a.summary.localeCompare(b.summary));
  const noOwnerItems = operationalItems
    .filter((item) => !item.hasOwner)
    .sort((a, b) => b.queueScore - a.queueScore || a.summary.localeCompare(b.summary));
  const dueNext7Items = operationalItems
    .filter((item) => item.dueInDays != null && item.dueInDays >= 0 && item.dueInDays <= 7)
    .sort((a, b) => a.dueInDays - b.dueInDays || b.queueScore - a.queueScore);
  const resourceConflictItems = operationalItems
    .filter((item) => item.hasCapacityConflict)
    .sort((a, b) => b.queueScore - a.queueScore || a.summary.localeCompare(b.summary));

  const criticalAlerts = {
    overdue: overdueItems,
    noSchedule: noScheduleItems,
    resourceConflicts: resourceConflictItems,
    dueToday: [...dueTodayIssues, ...dueTodayActivities],
    dueNext7: dueNext7Items,
    noOwner: noOwnerItems,
  };

  const briefingItems = operationalItems;
  const briefingOverdueItems = overdueItems;
  const briefingDueTodayItems = criticalAlerts.dueToday;
  const briefingDoneRecent = excludeDoneFromOperationalSummary ? [] : doneRecent;

  const changedItems = [
    ...briefingItems
      .filter((item) => hasRecentDate(item.updatedDate, today0, 1))
      .sort((a, b) => (b.updatedDate?.getTime() || 0) - (a.updatedDate?.getTime() || 0)),
    ...briefingDoneRecent
      .filter((item) => hasRecentDate(item.resolvedDate, today0, 1))
      .map((item) => ({
        ...item,
        owner: "Concluído",
        statusName: item.statusName || "Concluído",
        reason: "Concluído recentemente",
      })),
  ];

  const dailyBriefing = {
    changed: changedItems.slice(0, 12).map((item) => decorateBriefingItem(item, "changed")),
    delayed: briefingOverdueItems.slice(0, 12).map((item) => decorateBriefingItem(item, "delayed")),
    dueToday: briefingDueTodayItems
      .slice(0, 12)
      .map((item) => decorateBriefingItem(item, "dueToday")),
    recommendedActions: actionQueue
      .slice(0, 12)
      .map((item) => decorateBriefingItem(item, "action")),
  };

  const createdLast30 = filteredItems.filter((item) => (item.daysSinceCreated || 0) <= 30)
    .length;
  const completedLast30 = doneRecent.length;
  const dueThisWeek = filteredItems.filter(
    (item) => item.dueInDays != null && item.dueInDays >= 0 && item.dueInDays <= 7
  ).length;

  const portfolio = {
    total: filteredItems.length,
    atRisk: filteredItems.filter((item) => item.isAtRisk).length,
    blocked: filteredItems.filter((item) => item.isBlocked).length,
    noSchedule: filteredItems.filter((item) => !item.hasSchedule).length,
    noOwner: filteredItems.filter((item) => !item.hasOwner).length,
    overdue: filteredItems.filter((item) => item.overdueDays > 0).length,
    dueThisWeek,
    completedLast30,
    createdLast30,
    throughputDelta: completedLast30 - createdLast30,
    statusMacro: toCounterArray(filteredStatusCounter, 8),
    lanes: toCounterArray(filteredLaneCounter, 8),
    owners: toCounterArray(filteredOwnerCounter, 8),
    directorates: toCounterArray(filteredDirectorateCounter, 8),
    components: toCounterArray(filteredComponentCounter, 8),
    aging: toCounterArray(filteredAgingCounter, 8),
  };

  const presetCounts = {
    all: filteredItems.length,
    mine: ownerAccountId || ownerFocus
      ? items.filter((item) => matchesOwner(item, ownerAccountId, ownerFocus))
          .length
      : 0,
    overdue: filteredItems.filter((item) => item.overdueDays > 0).length,
    noSchedule: filteredItems.filter((item) => !item.hasSchedule).length,
    atRisk: filteredItems.filter((item) => item.isAtRisk).length,
    next7d: filteredItems.filter((item) => item.dueSoon).length,
  };

  return {
    items,
    filteredItems,
    actionQueue,
    risks,
    roadmap,
    doneRecent,
    resourceRows: filteredResourceRows,
    criticalAlerts,
    dailyBriefing,
    portfolio,
    presetCounts,
  };
}

export function getPoPresetLabel(preset) {
  return (
    {
      all: "Todos",
      mine: "Meus projetos",
      overdue: "Atrasados",
      noSchedule: "Sem cronograma",
      atRisk: "Com risco",
      next7d: "Próximos 7 dias",
    }[preset] || preset
  );
}

export function getScopedIssueKeysFromPreset({
  insights,
  activePreset,
  ownerFocus,
  ownerAccountId = "",
}) {
  const items = Array.isArray(insights?.items) ? insights.items : [];

  const scoped = items.filter((item) => {
    if (activePreset === "mine") {
      if (!ownerAccountId && !ownerFocus) return false;
      return matchesOwner(item, ownerAccountId, ownerFocus);
    }
    if (activePreset === "overdue") return item.overdueDays > 0;
    if (activePreset === "noSchedule") return !item.hasSchedule;
    if (activePreset === "atRisk") return item.isAtRisk;
    if (activePreset === "next7d") return item.dueSoon;
    return true;
  });

  return new Set(scoped.map((item) => item.key));
}

export function filterPoViewData(viewData, keySet) {
  if (!keySet || keySet.size === 0) {
    return {
      ...viewData,
      alertas: [],
      criarCronograma: [],
      calendarioIssues: [],
      events: [],
    };
  }

  return {
    ...viewData,
    alertas: (viewData?.alertas || []).filter((item) =>
      keySet.has(String(item?.key || "").trim().toUpperCase())
    ),
    criarCronograma: (viewData?.criarCronograma || []).filter((item) =>
      keySet.has(String(item?.key || "").trim().toUpperCase())
    ),
    calendarioIssues: (viewData?.calendarioIssues || []).filter((item) =>
      keySet.has(String(item?.key || "").trim().toUpperCase())
    ),
    events: (viewData?.events || []).filter((event) =>
      keySet.has(
        String(event?.extendedProps?.issueKey || event?.issueKey || "")
          .trim()
          .toUpperCase()
      )
    ),
  };
}
