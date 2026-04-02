import { parseDateRangeBR } from "../utils/cronograma";

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

export function buildPoInsights({ rawIssues, viewData, doneRows, ownerFocus = "" }) {
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

  const directorateCounter = createEmptyCounter();
  const componentCounter = createEmptyCounter();
  const ownerCounter = createEmptyCounter();
  const statusCounter = createEmptyCounter();
  const laneCounter = createEmptyCounter();
  const agingCounter = createEmptyCounter();

  const items = (rawIssues || []).map((issue) => {
    const fields = issue?.fields || {};
    const key = String(issue?.key || "").trim().toUpperCase();
    const owner =
      issue?.assignee ||
      fields?.assignee?.displayName ||
      fields?.assignee?.name ||
      "Sem responsável";
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

    const doneRecently = (doneRows || []).some(
      (row) => String(row?.key || "").trim().toUpperCase() === key
    );

    let processLane = "em execução";
    if (doneRecently || isDoneStatus(statusName)) processLane = "concluídos recentes";
    else if (macro === "triagem" && !hasStarted) processLane = "triagem";
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
    if (noRecentUpdate) queueScore += 30;
    if (hasRisk) queueScore += 25;

    directorates.forEach((value) => increment(directorateCounter, value));
    components.forEach((value) => increment(componentCounter, value));
    increment(ownerCounter, owner);
    increment(statusCounter, humanStatusMacro(macro));
    increment(laneCounter, processLane);

    const agingLabel =
      daysSinceCreated == null
        ? "Sem data"
        : daysSinceCreated <= 7
        ? "0-7d"
        : daysSinceCreated <= 14
        ? "8-14d"
        : daysSinceCreated <= 30
        ? "15-30d"
        : daysSinceCreated <= 60
        ? "31-60d"
        : "60+d";
    increment(agingCounter, agingLabel);

    return {
      key,
      raw: issue,
      summary: issue?.summary || fields?.summary || "—",
      owner,
      statusName,
      statusMacro: macro,
      statusMacroLabel: humanStatusMacro(macro),
      processLane,
      priority: issue?.priorityName || fields?.priority?.name || "Não informado",
      issueType: issue?.issueType || fields?.issuetype?.name || "—",
      hasSchedule,
      hasOwner,
      hasStarted,
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
      dueDate,
      nextMilestone,
      directorates,
      components,
      resources,
      activities,
      activitiesAtRisk,
      actionReasons,
      queueScore,
      commentPreview: getCommentPreview(issue?.commentsText || issue?.lastCommentText),
      recentDone: doneRecently,
    };
  });

  const filteredItems = ownerFocus
    ? items.filter((item) => normalizeStr(item.owner).includes(normalizeStr(ownerFocus)))
    : items;

  const actionQueue = filteredItems
    .filter((item) => !item.recentDone)
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
        resolvedDate: Number.isNaN(resolved.getTime()) ? null : resolved,
      };
    })
    .sort((a, b) => {
      const av = a.resolvedDate?.getTime() || 0;
      const bv = b.resolvedDate?.getTime() || 0;
      return bv - av;
    });

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
    statusMacro: toCounterArray(statusCounter, 8),
    lanes: toCounterArray(laneCounter, 8),
    owners: toCounterArray(ownerCounter, 8),
    directorates: toCounterArray(directorateCounter, 8),
    components: toCounterArray(componentCounter, 8),
    aging: toCounterArray(agingCounter, 8),
  };

  const presetCounts = {
    all: filteredItems.length,
    mine: ownerFocus
      ? items.filter((item) => normalizeStr(item.owner).includes(normalizeStr(ownerFocus)))
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
    resourceRows: ownerFocus
      ? resourceRows.filter((row) =>
          filteredItems.some((item) => item.resources.includes(row.resource))
        )
      : resourceRows,
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

export function getScopedIssueKeysFromPreset({ insights, activePreset, ownerFocus }) {
  const items = Array.isArray(insights?.items) ? insights.items : [];

  const scoped = items.filter((item) => {
    if (activePreset === "mine") {
      if (!ownerFocus) return false;
      return normalizeStr(item.owner).includes(normalizeStr(ownerFocus));
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
