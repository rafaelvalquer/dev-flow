// server/routes/tickets.js
import express from "express";
import Ticket from "../models/Ticket.js";
import { createJiraClient } from "./jira.routes.js";
import { parseCronogramaADF } from "../utils/cronogramaParser.js";

const router = express.Router();
const jira = createJiraClient(process.env);

function normKey(key) {
  return String(key || "")
    .trim()
    .toUpperCase();
}

/**
 * GET /api/tickets?q=
 * Lista tickets (para sidebar da Automação / filtros)
 */
router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const where = {};
    if (q) where.ticketKey = { $regex: q.toUpperCase(), $options: "i" };

    const docs = await Ticket.find(where)
      .sort({ updatedAt: -1 })
      .limit(400)
      .lean();

    res.json({
      tickets: docs.map((d) => ({
        ticketKey: d.ticketKey,
        summary: d.summary || d.jira?.summary || "",
        status: d.status || d.jira?.status || "",
        assignee: d.assignee || d.jira?.assignee || "",
      })),
    });
  } catch (err) {
    console.error("GET /api/tickets error:", err);
    res.status(500).json({ error: "Erro ao listar tickets." });
  }
});

/**
 * GET /api/tickets/:key
 */
router.get("/:key", async (req, res) => {
  const ticketKey = normKey(req.params.key);
  const doc = await Ticket.findOne({ ticketKey }).lean();
  if (!doc) return res.status(404).json({ error: "Ticket não encontrado." });
  res.json(doc);
});

/**
 * PUT /api/tickets/:key  (upsert genérico)
 */
router.put("/:key", async (req, res) => {
  const ticketKey = normKey(req.params.key);
  const { jira: jiraBody, data } = req.body || {};

  const update = { ticketKey };
  if (jiraBody && typeof jiraBody === "object") update.jira = jiraBody;
  if (data && typeof data === "object") update.data = data;

  const doc = await Ticket.findOneAndUpdate(
    { ticketKey },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  res.json({ ticketId: doc._id, ticketKey: doc.ticketKey });
});

/**
 * GET /api/tickets/:key/kanban  (retorna found=false se não existir)
 */
router.get("/:key/kanban", async (req, res) => {
  const ticketKey = normKey(req.params.key);
  const doc = await Ticket.findOne({ ticketKey }).select({ kanban: 1 }).lean();

  if (!doc?.kanban?.config) {
    return res.json({
      found: false,
      ticketId: null,
      config: null,
      updatedAt: null,
    });
  }

  res.json({
    found: true,
    ticketId: doc._id,
    config: doc.kanban.config,
    updatedAt: doc.kanban.updatedAt || null,
  });
});

/**
 * PUT /api/tickets/:key/kanban
 */
router.put("/:key/kanban", async (req, res) => {
  const ticketKey = normKey(req.params.key);
  const { config, jira: jiraBody, data } = req.body || {};

  if (!config || typeof config !== "object") {
    return res
      .status(400)
      .json({ error: "Body inválido: config é obrigatório." });
  }

  const cfg = {
    ...config,
    ticketKey, // força consistência
  };

  const now = new Date();
  const update = {
    ticketKey,
    "kanban.config": cfg,
    "kanban.updatedAt": now,
    "kanban.version": Number(cfg.version || 1),
  };

  if (jiraBody && typeof jiraBody === "object") update.jira = jiraBody;
  if (data && typeof data === "object") update.data = data;

  const doc = await Ticket.findOneAndUpdate(
    { ticketKey },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  res.json({
    ticketId: doc._id,
    ticketKey: doc.ticketKey,
    config: doc.kanban.config,
    updatedAt: doc.kanban.updatedAt,
  });
});

/**
 * =========================
 * TIMESHEET (MongoDB)
 * Base: /api/tickets/:key/timesheet
 * Persistência: ticket.data.timesheet
 * =========================
 */

function defaultTimesheet() {
  return {
    version: 1,
    developers: [],
    estimates: {},
    entries: [],
    updatedAt: null,
  };
}

function normIsoDate(v) {
  const s = String(v || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return s;
}

function clampHours(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(24, Math.max(0, n));
}

function ensureTimesheetInData(doc) {
  doc.data = doc.data && typeof doc.data === "object" ? doc.data : {};
  doc.data.timesheet =
    doc.data.timesheet && typeof doc.data.timesheet === "object"
      ? doc.data.timesheet
      : defaultTimesheet();

  doc.data.timesheet.developers = Array.isArray(doc.data.timesheet.developers)
    ? doc.data.timesheet.developers
    : [];

  doc.data.timesheet.estimates =
    doc.data.timesheet.estimates &&
    typeof doc.data.timesheet.estimates === "object"
      ? doc.data.timesheet.estimates
      : {};

  doc.data.timesheet.entries = Array.isArray(doc.data.timesheet.entries)
    ? doc.data.timesheet.entries
    : [];

  return doc.data.timesheet;
}

router.get("/:key/timesheet", async (req, res) => {
  try {
    const ticketKey = normKey(req.params.key);
    const doc = await Ticket.findOne({ ticketKey });
    if (!doc) return res.status(404).json({ error: "Ticket não encontrado." });

    const ts = ensureTimesheetInData(doc);
    return res.json({ ticketKey, timesheet: ts });
  } catch (err) {
    console.error("GET timesheet error:", err);
    return res.status(500).json({ error: "Erro ao buscar timesheet" });
  }
});

router.put("/:key/timesheet", async (req, res) => {
  try {
    const ticketKey = normKey(req.params.key);
    const { devId, taskKey, date, hours, note } = req.body || {};

    const safeDevId = String(devId || "").trim();
    const safeTaskKey = String(taskKey || "").trim();
    const safeDate = normIsoDate(date);

    if (!safeDevId)
      return res.status(400).json({ error: "devId é obrigatório." });
    if (!safeTaskKey)
      return res.status(400).json({ error: "taskKey é obrigatório." });
    if (!safeDate)
      return res.status(400).json({ error: "date inválido (YYYY-MM-DD)." });

    const safeHours = clampHours(hours);
    const safeNote = String(note || "").trim();

    const doc = await Ticket.findOne({ ticketKey });
    if (!doc) return res.status(404).json({ error: "Ticket não encontrado." });

    const ts = ensureTimesheetInData(doc);
    const now = new Date();

    const matchIdx = ts.entries.findIndex(
      (e) =>
        e?.devId === safeDevId &&
        e?.taskKey === safeTaskKey &&
        e?.date === safeDate
    );

    // hours=0 => remove
    if (!safeHours || safeHours <= 0) {
      if (matchIdx >= 0) ts.entries.splice(matchIdx, 1);
      ts.updatedAt = now;
      doc.set("data.timesheet", ts);
      doc.markModified("data");
      await doc.save();
      return res.json({ ticketKey, timesheet: ts });
    }

    const entry = {
      id:
        matchIdx >= 0
          ? ts.entries[matchIdx].id
          : globalThis.crypto?.randomUUID?.() ||
            `${Date.now()}-${Math.random()}`,
      devId: safeDevId,
      taskKey: safeTaskKey,
      date: safeDate,
      hours: safeHours,
      note: safeNote || undefined,
      updatedAt: now,
    };

    if (matchIdx >= 0)
      ts.entries[matchIdx] = { ...ts.entries[matchIdx], ...entry };
    else ts.entries.push(entry);

    ts.updatedAt = now;

    doc.set("data.timesheet", ts);
    doc.markModified("data");
    await doc.save();

    return res.json({ ticketKey, timesheet: ts });
  } catch (err) {
    console.error("PUT timesheet error:", err);
    return res.status(500).json({ error: "Erro ao salvar apontamento" });
  }
});

router.put("/:key/timesheet/estimate", async (req, res) => {
  try {
    const ticketKey = normKey(req.params.key);
    const { taskKey, hours } = req.body || {};

    const safeTaskKey = String(taskKey || "").trim();
    if (!safeTaskKey)
      return res.status(400).json({ error: "taskKey é obrigatório." });

    const safeHours = Number(hours);
    const normalized = Number.isFinite(safeHours) ? Math.max(0, safeHours) : 0;

    const doc = await Ticket.findOne({ ticketKey });
    if (!doc) return res.status(404).json({ error: "Ticket não encontrado." });

    const ts = ensureTimesheetInData(doc);
    const now = new Date();

    if (!normalized || normalized <= 0) delete ts.estimates[safeTaskKey];
    else ts.estimates[safeTaskKey] = normalized;

    ts.updatedAt = now;
    doc.set("data.timesheet", ts);
    doc.markModified("data");
    await doc.save();

    return res.json({ ticketKey, timesheet: ts });
  } catch (err) {
    console.error("PUT timesheet/estimate error:", err);
    return res.status(500).json({ error: "Erro ao salvar estimate" });
  }
});

router.put("/:key/timesheet/developers", async (req, res) => {
  try {
    const ticketKey = normKey(req.params.key);
    const developers = Array.isArray(req.body?.developers)
      ? req.body.developers
      : [];

    const next = developers
      .map((d) => ({
        id: String(d?.id || "").trim(),
        name: String(d?.name || "").trim(),
      }))
      .filter((d) => d.id && d.name);

    const doc = await Ticket.findOne({ ticketKey });
    if (!doc) return res.status(404).json({ error: "Ticket não encontrado." });

    const ts = ensureTimesheetInData(doc);
    ts.developers = next;
    ts.updatedAt = new Date();

    doc.set("data.timesheet", ts);
    doc.markModified("data");
    await doc.save();

    return res.json({ ticketKey, timesheet: ts });
  } catch (err) {
    console.error("PUT timesheet/developers error:", err);
    return res.status(500).json({ error: "Erro ao salvar desenvolvedores" });
  }
});

/**
 * GET /api/tickets/:ticketKey/automation
 * Retorna config de automação armazenada no ticket (data.automation)
 */
router.get("/:ticketKey/automation", async (req, res) => {
  try {
    const tk = normKey(req.params.ticketKey);
    const doc = await Ticket.findOne({ ticketKey: tk }).lean();
    if (!doc) return res.status(404).json({ error: "Ticket não encontrado." });

    const a = doc.data?.automation || {
      enabled: true,
      version: 1,
      updatedAt: null,
      graph: {},
      rules: [],
      executions: [],
      logs: [],
    };

    res.json(a);
  } catch (err) {
    console.error("GET /api/tickets/:ticketKey/automation error:", err);
    res.status(500).json({ error: "Erro ao carregar automação." });
  }
});

/**
 * PUT /api/tickets/:ticketKey/automation
 * Salva config de automação no ticket (preserva logs/execuções existentes)
 */
router.put("/:ticketKey/automation", async (req, res) => {
  try {
    const tk = normKey(req.params.ticketKey);
    const body = req.body && typeof req.body === "object" ? req.body : {};

    // Se você preferir exigir que exista, troque para Ticket.findOne e 404.
    // Aqui faço upsert para não quebrar caso ainda não exista.
    const doc = await Ticket.findOneAndUpdate(
      { ticketKey: tk },
      { $setOnInsert: { ticketKey: tk } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Garante estrutura
    doc.data = doc.data && typeof doc.data === "object" ? doc.data : {};
    doc.data.automation =
      doc.data.automation && typeof doc.data.automation === "object"
        ? doc.data.automation
        : {};

    const current = doc.data.automation;

    const nextAutomation = {
      ...current, // preserva: state, executions, errors, logs, etc.
      enabled:
        body.enabled === undefined ? current.enabled !== false : !!body.enabled,
      rules: Array.isArray(body.rules) ? body.rules : current.rules || [],
      graph:
        body.graph && typeof body.graph === "object"
          ? body.graph
          : current.graph || {},
      version: Number(
        body.version !== undefined ? body.version : current.version || 1
      ),
      updatedAt: new Date(),
    };

    // Persistência segura (data costuma ser Mixed)
    doc.set("data.automation", nextAutomation);
    doc.markModified("data");

    await doc.save();

    return res.json({ ok: true, automation: doc.data.automation });
  } catch (err) {
    console.error("PUT /api/tickets/:ticketKey/automation error:", err);
    return res.status(500).json({ error: "Erro ao salvar automação." });
  }
});

/**
 * GET /api/tickets/:ticketKey/cronograma
 * Busca ADF no Jira e retorna atividades normalizadas
 */
router.get("/:ticketKey/cronograma", async (req, res) => {
  try {
    const tk = normKey(req.params.ticketKey);
    const fieldId =
      process.env.JIRA_CRONOGRAMA_FIELD_ID?.trim() || "customfield_14017";

    const issue = await jira.getIssue(tk, [
      "summary",
      "status",
      fieldId,
      "subtasks",
    ]);
    const adf = issue?.fields?.[fieldId] || null;
    const atividades = adf ? parseCronogramaADF(adf) : [];

    res.json({ ticketKey: tk, fieldId, atividades });
  } catch (err) {
    console.error("GET /api/tickets/:ticketKey/cronograma error:", err);
    res.status(500).json({ error: "Erro ao carregar cronograma." });
  }
});

/**
 * GET /api/tickets/:ticketKey/transitions
 * Retorna transitions disponíveis no Jira (para UI escolher status alvo)
 */
router.get("/:ticketKey/transitions", async (req, res) => {
  try {
    const tk = normKey(req.params.ticketKey);
    const payload = await jira.getTransitions(tk);
    res.json({ transitions: payload?.transitions || [] });
  } catch (err) {
    console.error("GET /api/tickets/:ticketKey/transitions error:", err);
    res.status(500).json({ error: "Erro ao carregar transitions." });
  }
});

export default router;
