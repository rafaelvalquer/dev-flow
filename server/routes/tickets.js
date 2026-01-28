// server/routes/tickets.js
import express from "express";
import Ticket from "../models/Ticket.js";

const router = express.Router();

function normKey(key) {
  return String(key || "")
    .trim()
    .toUpperCase();
}

// GET /api/tickets/:key
router.get("/:key", async (req, res) => {
  const ticketKey = normKey(req.params.key);
  const doc = await Ticket.findOne({ ticketKey }).lean();
  if (!doc) return res.status(404).json({ error: "Ticket não encontrado." });
  res.json(doc);
});

// PUT /api/tickets/:key  (upsert genérico)
router.put("/:key", async (req, res) => {
  const ticketKey = normKey(req.params.key);
  const { jira, data } = req.body || {};

  const update = { ticketKey };
  if (jira && typeof jira === "object") update.jira = jira;
  if (data && typeof data === "object") update.data = data;

  const doc = await Ticket.findOneAndUpdate(
    { ticketKey },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  res.json({ ticketId: doc._id, ticketKey: doc.ticketKey });
});

// GET /api/tickets/:key/kanban  (retorna found=false se não existir)
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

// PUT /api/tickets/:key/kanban
router.put("/:key/kanban", async (req, res) => {
  const ticketKey = normKey(req.params.key);
  const { config, jira, data } = req.body || {};

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

  if (jira && typeof jira === "object") update.jira = jira;
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

export default router;
