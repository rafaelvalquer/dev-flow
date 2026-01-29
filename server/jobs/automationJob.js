// server/jobs/automationJob.js
import os from "os";

import Ticket from "../models/Ticket.js";
import AutomationLock from "../models/AutomationLock.js";

import { createJiraClient } from "../routes/jira.routes.js";
import { parseCronogramaADF } from "../utils/cronogramaParser.js";
import {
  evaluateRules,
  hasExecuted,
  executeRule,
  pushBounded,
} from "../utils/automationEngine.js";

const LOCK_TTL_MS = Number(process.env.AUTOMATION_JOB_LOCK_TTL_MS || 120000);
const MAX_EXEC = Number(process.env.AUTOMATION_MAX_EXECUTIONS || 200);
const MAX_ERRS = Number(process.env.AUTOMATION_MAX_ERRORS || 50);
const CRONO_FIELD = process.env.JIRA_CRONOGRAMA_FIELD_ID || "customfield_14017";

function lockKeyTicket(ticketKey) {
  return `automation:ticket:${ticketKey}`;
}

async function acquireLock(key) {
  const now = new Date();
  const runningUntil = new Date(now.getTime() + LOCK_TTL_MS);
  const lockedBy = `${os.hostname()}:${process.pid}`;

  const doc = await AutomationLock.findOneAndUpdate(
    {
      key,
      $or: [
        { runningUntil: { $lte: now } },
        { runningUntil: null },
        { runningUntil: { $exists: false } },
      ],
    },
    { $set: { key, lockedBy, runningUntil, updatedAt: now } },
    { upsert: true, new: true }
  );

  return doc?.lockedBy === lockedBy;
}

async function releaseLock(key) {
  await AutomationLock.updateOne(
    { key },
    { $set: { runningUntil: new Date(0) } }
  );
}

function extractKanbanSubtasks(ticketDoc) {
  const out = [];
  const cfg = ticketDoc?.kanban?.config || ticketDoc?.data?.kanban?.config;
  const columns = cfg?.columns || {};
  for (const stepKey of Object.keys(columns)) {
    const col = columns[stepKey];
    for (const card of col?.cards || []) {
      for (const st of card?.subtasks || []) {
        out.push({
          id: st.id,
          stepKey,
          cardTitle: card.title || "",
          title: st.title || "",
          jiraKey: st.jiraKey || "",
          jiraStatus: st.jiraStatus || "",
          done: Boolean(st.done),
        });
      }
    }
  }
  return out;
}

async function processTicket(ticketDoc, jira) {
  const ticketKey = ticketDoc.ticketKey;

  const automation = ticketDoc.data?.automation || {};
  const rules = (automation.rules || []).filter(
    (r) => r && r.enabled !== false
  );

  if (!automation.enabled || !rules.length) return;

  const issue = await jira.getIssue(ticketKey, [
    "summary",
    "status",
    CRONO_FIELD,
    "subtasks",
  ]);

  const adf = issue?.fields?.[CRONO_FIELD] || null;
  const cronogramaAtividades = adf ? parseCronogramaADF(adf) : [];
  const kanbanSubtasks = extractKanbanSubtasks(ticketDoc);

  const { nextState, fired } = evaluateRules({
    ticketKey,
    issue,
    kanbanSubtasks,
    cronogramaAtividades,
    automation: { ...automation, rules },
  });

  // salva state sempre (para detectar mudanças na próxima execução)
  ticketDoc.data.automation.state = nextState;
  ticketDoc.data.automation.updatedAt = new Date();

  for (const evt of fired) {
    if (hasExecuted(ticketDoc.data.automation, evt.eventKey)) continue;

    try {
      const actionResults = await executeRule({
        ticketKey,
        rule: evt.rule,
        vars: evt.vars,
        jira, // <- passa client para executar ações no Jira
      });

      ticketDoc.data.automation.executions = pushBounded(
        ticketDoc.data.automation.executions,
        {
          ruleId: evt.rule.id,
          eventKey: evt.eventKey,
          status: "success",
          executedAt: new Date(),
          payload: { vars: evt.vars, actions: actionResults },
          error: "",
        },
        MAX_EXEC
      );
    } catch (e) {
      ticketDoc.data.automation.executions = pushBounded(
        ticketDoc.data.automation.executions,
        {
          ruleId: evt.rule.id,
          eventKey: evt.eventKey,
          status: "error",
          executedAt: new Date(),
          payload: { vars: evt.vars },
          error: e?.message || String(e),
        },
        MAX_EXEC
      );

      ticketDoc.data.automation.errors = pushBounded(
        ticketDoc.data.automation.errors,
        {
          at: new Date(),
          ruleId: evt.rule.id,
          msg: e?.message || String(e),
          stack: e?.stack || "",
        },
        MAX_ERRS
      );
    }
  }

  await ticketDoc.save();
}

async function tick() {
  const jira = createJiraClient(process.env);

  const candidates = await Ticket.find({
    "data.automation.enabled": true,
    "data.automation.rules.0": { $exists: true },
  }).limit(200);

  for (const t of candidates) {
    const key = lockKeyTicket(t.ticketKey);
    const ok = await acquireLock(key);
    if (!ok) continue;

    try {
      await processTicket(t, jira);
    } finally {
      await releaseLock(key);
    }
  }
}

export function startAutomationJob() {
  const interval = Number(process.env.AUTOMATION_JOB_INTERVAL_MS || 60000);

  tick().catch(() => {});
  setInterval(() => tick().catch(() => {}), interval);
}
