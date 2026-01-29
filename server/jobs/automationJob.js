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
const MAX_TICKETS = Number(process.env.AUTOMATION_JOB_MAX_TICKETS || 200);
const MAX_EXEC = Number(process.env.AUTOMATION_MAX_EXECUTIONS || 200);
const MAX_ERRS = Number(process.env.AUTOMATION_MAX_ERRORS || 50);
const CRONO_FIELD = process.env.JIRA_CRONOGRAMA_FIELD_ID || "customfield_14017";

function lockKeyTicket(ticketKey) {
  return `automation:ticket:${ticketKey}`;
}

function ensureAutomationShape(ticketDoc) {
  // Ticket.data é "Object/Mixed": garanta estrutura antes de ler/escrever.
  if (!ticketDoc.data || typeof ticketDoc.data !== "object")
    ticketDoc.data = {};
  if (
    !ticketDoc.data.automation ||
    typeof ticketDoc.data.automation !== "object"
  )
    ticketDoc.data.automation = {};

  const a = ticketDoc.data.automation;

  if (typeof a.enabled !== "boolean") a.enabled = true;
  if (!Array.isArray(a.rules)) a.rules = [];
  if (!a.graph || typeof a.graph !== "object") a.graph = {};
  if (!a.state || typeof a.state !== "object") a.state = {};
  if (!Array.isArray(a.executions)) a.executions = [];
  if (!Array.isArray(a.errors)) a.errors = [];
  if (!a.updatedAt) a.updatedAt = new Date();

  return a;
}

async function acquireLock(key) {
  const now = new Date();
  const runningUntil = new Date(now.getTime() + LOCK_TTL_MS);
  const lockedBy = `${os.hostname()}:${process.pid}`;

  try {
    const doc = await AutomationLock.findOneAndUpdate(
      {
        key,
        $or: [
          { runningUntil: { $lte: now } },
          { runningUntil: null },
          { runningUntil: { $exists: false } },
        ],
      },
      {
        $setOnInsert: { key },
        $set: { lockedBy, runningUntil, updatedAt: now },
      },
      { upsert: true, new: true }
    );

    return doc?.lockedBy === lockedBy;
  } catch (e) {
    // corrida no upsert (unique key) => considera que não pegou lock
    if (e?.code === 11000) return false;
    throw e;
  }
}

async function releaseLock(key) {
  await AutomationLock.updateOne(
    { key },
    { $set: { runningUntil: new Date(0), updatedAt: new Date() } }
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

  const automation = ensureAutomationShape(ticketDoc);
  const rules = (automation.rules || []).filter(
    (r) => r && r.enabled !== false
  );

  if (!automation.enabled || !rules.length) return;

  let dirty = false;

  // 1) Busca estado atual no Jira
  let issue;
  try {
    issue = await jira.getIssue(ticketKey, [
      "summary",
      "status",
      CRONO_FIELD,
      "subtasks",
    ]);
  } catch (e) {
    // registra erro e sai (sem quebrar o job)
    automation.errors = pushBounded(
      automation.errors,
      {
        at: new Date(),
        ruleId: "",
        msg: `Falha ao buscar issue no Jira (${ticketKey}): ${e?.message || e}`,
        stack: e?.stack || "",
      },
      MAX_ERRS
    );
    automation.updatedAt = new Date();
    ticketDoc.markModified("data");
    await ticketDoc.save();
    return;
  }

  const adf = issue?.fields?.[CRONO_FIELD] || null;
  const cronogramaAtividades = adf ? parseCronogramaADF(adf) : [];
  const kanbanSubtasks = extractKanbanSubtasks(ticketDoc);

  // 2) Avalia regras
  const { nextState, fired } = evaluateRules({
    ticketKey,
    issue,
    kanbanSubtasks,
    cronogramaAtividades,
    automation: { ...automation, rules },
  });

  // sempre salva state (evita re-disparo indevido no próximo tick)
  automation.state = nextState || {};
  automation.updatedAt = new Date();
  dirty = true;

  // 3) Executa eventos disparados
  for (const evt of fired || []) {
    const eventKey = evt?.eventKey;
    const rule = evt?.rule;

    if (!rule || !eventKey) continue;
    if (hasExecuted(automation, eventKey)) continue;

    try {
      const actionResults = await executeRule({
        ticketKey,
        rule,
        vars: evt.vars || {},
        jira,
      });

      automation.executions = pushBounded(
        automation.executions,
        {
          ruleId: rule.id || rule.ruleId || "",
          eventKey,
          status: "success",
          executedAt: new Date(),
          payload: { vars: evt.vars || {}, actions: actionResults || [] },
          error: "",
        },
        MAX_EXEC
      );

      dirty = true;
    } catch (e) {
      automation.executions = pushBounded(
        automation.executions,
        {
          ruleId: rule.id || rule.ruleId || "",
          eventKey,
          status: "error",
          executedAt: new Date(),
          payload: { vars: evt.vars || {} },
          error: e?.message || String(e),
        },
        MAX_EXEC
      );

      automation.errors = pushBounded(
        automation.errors,
        {
          at: new Date(),
          ruleId: rule.id || rule.ruleId || "",
          msg: e?.message || String(e),
          stack: e?.stack || "",
        },
        MAX_ERRS
      );

      dirty = true;
    }
  }

  if (dirty) {
    // IMPORTANTE: data é Object/Mixed => precisa marcar modificado
    ticketDoc.markModified("data");
    await ticketDoc.save();
  }
}

let running = false;

async function tick() {
  if (running) return; // evita reentrância se o tick anterior atrasar
  running = true;

  const jira = createJiraClient(process.env);

  try {
    const candidates = await Ticket.find({
      "data.automation.enabled": true,
      "data.automation.rules.0": { $exists: true },
    }).limit(MAX_TICKETS);

    for (const t of candidates) {
      const key = lockKeyTicket(t.ticketKey);
      let ok = false;

      try {
        ok = await acquireLock(key);
      } catch {
        ok = false;
      }

      if (!ok) continue;

      try {
        await processTicket(t, jira);
      } finally {
        await releaseLock(key);
      }
    }
  } finally {
    running = false;
  }
}

export function startAutomationJob() {
  const interval = Number(process.env.AUTOMATION_JOB_INTERVAL_MS || 60000);

  tick().catch(() => {});
  setInterval(() => tick().catch(() => {}), interval);
}
