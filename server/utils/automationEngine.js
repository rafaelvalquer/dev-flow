// server/utils/automationEngine.js
import { applyTemplate, adfFromPlainText } from "./templateVars.js";
import { parseDateRangeBR, toYMDLocal } from "./cronogramaParser.js";

function isDoneStatus(statusCategoryKey, statusName) {
  const k = String(statusCategoryKey || "").toLowerCase();
  if (k === "done") return true;
  const n = String(statusName || "").toLowerCase();
  return /(done|conclu|fechad|resol|closed)/.test(n);
}

function nowIso() {
  return new Date().toISOString();
}

export function pushBounded(arr, item, max) {
  const next = [...(arr || []), item];
  if (next.length <= max) return next;
  return next.slice(next.length - max);
}

function makeEventKey(parts) {
  return parts.map((p) => String(p ?? "")).join("|");
}

function buildVars({
  ticketKey,
  issue,
  prevStatus,
  currentStatus,
  subtask,
  activity,
  dueDate,
  activityStart,
  activityEnd,
}) {
  return {
    ticketKey,
    prevStatus: prevStatus || "",
    currentStatus: currentStatus || "",
    subtaskTitle: subtask?.title || "",
    subtaskKey: subtask?.jiraKey || subtask?.id || "",
    activityName: activity?.name || "",
    activityId: activity?.id || "",
    dueDate: dueDate || "",
    activityStart: activityStart || "",
    activityEnd: activityEnd || "",
    summary: issue?.fields?.summary || "",
  };
}

/**
 * Avalia regras e retorna { nextState, fired[] }
 * fired[]: { rule, eventKey, vars }
 */
export function evaluateRules({
  ticketKey,
  issue,
  kanbanSubtasks,
  cronogramaAtividades,
  automation,
}) {
  const rules = (automation?.rules || []).filter(
    (r) => r && r.enabled !== false
  );
  const state = automation?.state || {};
  const fired = [];

  const currentStatus = issue?.fields?.status?.name || "";
  const prevTicketStatus = state.lastTicketStatus || "";
  const statusChanged =
    prevTicketStatus && currentStatus && prevTicketStatus !== currentStatus;

  const subtasksState = state.subtasksByKey || {}; // {key: {statusName, statusCategoryKey}}
  const nextSubtasksState = { ...subtasksState };

  // map subtasks por jiraKey
  const stByKey = new Map(
    (kanbanSubtasks || [])
      .map((s) => {
        const key = String(s.jiraKey || s.id || "").trim();
        if (!key) return null;
        return [key, s];
      })
      .filter(Boolean)
  );

  // map status dos subtasks pela issue (subtasks do Jira)
  const jiraSubtasks = issue?.fields?.subtasks || [];
  const jiraStatusByKey = new Map(
    jiraSubtasks
      .map((st) => {
        const key = st?.key;
        const statusName = st?.fields?.status?.name || "";
        const statusCat = st?.fields?.status?.statusCategory?.key || "";
        return key ? [key, { statusName, statusCategoryKey: statusCat }] : null;
      })
      .filter(Boolean)
  );

  // atualiza state subtasks
  for (const [key, s] of stByKey.entries()) {
    const jira = jiraStatusByKey.get(key);
    const statusName = jira?.statusName || s.jiraStatus || "";
    const statusCategoryKey = jira?.statusCategoryKey || "";
    nextSubtasksState[key] = { statusName, statusCategoryKey };
  }

  const now = new Date();

  for (const rule of rules) {
    const t = rule.trigger?.type;
    const p = rule.trigger?.params || {};

    // --- triggers de ticket status ---
    if (t === "ticket.status.changed") {
      if (!statusChanged) continue;
      const eventKey = makeEventKey([
        rule.id,
        "ticket.status.changed",
        prevTicketStatus,
        currentStatus,
      ]);
      const vars = buildVars({
        ticketKey,
        issue,
        prevStatus: prevTicketStatus,
        currentStatus,
      });
      fired.push({ rule, eventKey, vars });
      continue;
    }

    if (t === "ticket.status.equals") {
      const want = String(p.status || "").trim();
      if (!want) continue;
      if (String(currentStatus).trim() !== want) continue;

      const eventKey = makeEventKey([
        rule.id,
        "ticket.status.equals",
        want,
        toYMDLocal(now),
      ]);
      const vars = buildVars({ ticketKey, issue, currentStatus });
      fired.push({ rule, eventKey, vars });
      continue;
    }

    if (t === "ticket.status.notEquals") {
      const want = String(p.status || "").trim();
      if (!want) continue;
      if (String(currentStatus).trim() === want) continue;

      const eventKey = makeEventKey([
        rule.id,
        "ticket.status.notEquals",
        want,
        toYMDLocal(now),
      ]);
      const vars = buildVars({ ticketKey, issue, currentStatus });
      fired.push({ rule, eventKey, vars });
      continue;
    }

    // --- triggers de subtarefa ---
    if (t === "subtask.completed") {
      const subtaskKey = String(p.subtaskKey || "").trim();
      if (!subtaskKey) continue;

      const st = stByKey.get(subtaskKey) || {
        jiraKey: subtaskKey,
        title: subtaskKey,
      };
      const prev = subtasksState[subtaskKey] || {};
      const cur = nextSubtasksState[subtaskKey] || {};

      const prevDone = isDoneStatus(prev.statusCategoryKey, prev.statusName);
      const curDone = isDoneStatus(cur.statusCategoryKey, cur.statusName);

      if (!prevDone && curDone) {
        const eventKey = makeEventKey([
          rule.id,
          "subtask.completed",
          subtaskKey,
          prev.statusName,
          cur.statusName,
        ]);
        const vars = buildVars({
          ticketKey,
          issue,
          currentStatus,
          subtask: st,
        });
        fired.push({ rule, eventKey, vars });
      }
      continue;
    }

    if (t === "subtask.overdue") {
      const subtaskKey = String(p.subtaskKey || "").trim();
      const dueDate = String(p.dueDate || "").trim();
      if (!subtaskKey || !dueDate) continue;

      const st = stByKey.get(subtaskKey) || {
        jiraKey: subtaskKey,
        title: subtaskKey,
      };
      const cur = nextSubtasksState[subtaskKey] || {};
      const curDone = isDoneStatus(cur.statusCategoryKey, cur.statusName);

      const due = new Date(`${dueDate}T00:00:00`);
      if (Number.isNaN(due.getTime())) continue;
      if (now <= due) continue;
      if (curDone) continue;

      const eventKey = makeEventKey([
        rule.id,
        "subtask.overdue",
        subtaskKey,
        dueDate,
      ]);
      const vars = buildVars({
        ticketKey,
        issue,
        currentStatus,
        subtask: st,
        dueDate,
      });
      fired.push({ rule, eventKey, vars });
      continue;
    }

    // --- triggers de cronograma ---
    if (t === "activity.start" || t === "activity.overdue") {
      const activityId = String(p.activityId || "").trim();
      if (!activityId) continue;

      const a = (cronogramaAtividades || []).find(
        (x) => String(x.id) === activityId
      );
      if (!a?.data) continue;

      const parsed = parseDateRangeBR(a.data, now);
      if (!parsed) continue;

      const startYMD = toYMDLocal(parsed.start);
      const endYMD = toYMDLocal(parsed.end);

      if (t === "activity.start") {
        if (now < parsed.start) continue;
        const eventKey = makeEventKey([
          rule.id,
          "activity.start",
          activityId,
          startYMD,
        ]);
        const vars = buildVars({
          ticketKey,
          issue,
          currentStatus,
          activity: a,
          activityStart: startYMD,
          activityEnd: endYMD,
        });
        fired.push({ rule, eventKey, vars });
        continue;
      }

      if (t === "activity.overdue") {
        if (now <= parsed.end) continue;
        const eventKey = makeEventKey([
          rule.id,
          "activity.overdue",
          activityId,
          endYMD,
        ]);
        const vars = buildVars({
          ticketKey,
          issue,
          currentStatus,
          activity: a,
          activityStart: startYMD,
          activityEnd: endYMD,
        });
        fired.push({ rule, eventKey, vars });
        continue;
      }
    }
  }

  const nextState = {
    ...state,
    lastTicketStatus: currentStatus || state.lastTicketStatus || "",
    subtasksByKey: nextSubtasksState,
    lastCheckedAt: nowIso(),
  };

  return { nextState, fired };
}

export function hasExecuted(automation, eventKey) {
  const ex = automation?.executions || [];
  return ex.some((e) => e && e.eventKey === eventKey && e.status === "success");
}

/**
 * Execução (para Job)
 * Injete o client do Jira: { addCommentADF, transitionToStatusName }
 */
export async function executeRule({ ticketKey, rule, vars, jira }) {
  const results = [];

  for (const action of rule.actions || []) {
    if (!action?.type) continue;

    if (action.type === "jira.comment") {
      const raw = String(action.params?.text || "").trim();
      const text = applyTemplate(raw, vars);
      await jira.addCommentADF(ticketKey, adfFromPlainText(text));
      results.push({ type: action.type, ok: true });
      continue;
    }

    if (action.type === "jira.transition") {
      const toStatus = String(action.params?.toStatus || "").trim();
      if (!toStatus) throw new Error("Ação transition sem toStatus.");
      const r = await jira.transitionToStatusName(ticketKey, toStatus);
      results.push({ type: action.type, ok: true, to: r.to });
      continue;
    }

    results.push({
      type: action.type,
      ok: false,
      error: "Tipo não suportado.",
    });
  }

  return results;
}
