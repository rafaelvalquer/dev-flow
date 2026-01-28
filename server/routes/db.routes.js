// server/routes/db.routes.js
import { Router } from "express";
import mongoose from "mongoose";
import User from "../models/User.js";
import Ticket from "../models/Ticket.js";
import TicketHistory from "../models/TicketHistory.js";

const router = Router();

// Health da conexão
router.get("/health", (_req, res) => {
  // 0 disconnected | 1 connected | 2 connecting | 3 disconnecting
  res.json({ ok: true, mongoState: mongoose.connection.readyState });
});

// USERS
router.post("/users", async (req, res) => {
  try {
    const doc = await User.create(req.body);
    res.json(doc);
  } catch (err) {
    res
      .status(400)
      .json({
        error: "Failed to create user",
        details: String(err?.message || err),
      });
  }
});

router.get("/users", async (req, res) => {
  const { email } = req.query;
  const q = {};
  if (email) q.email = String(email).toLowerCase();
  const docs = await User.find(q).sort({ createdAt: -1 }).limit(200);
  res.json(docs);
});

// TICKETS
router.post("/tickets", async (req, res) => {
  try {
    const doc = await Ticket.create(req.body);
    res.json(doc);
  } catch (err) {
    res
      .status(400)
      .json({
        error: "Failed to create ticket",
        details: String(err?.message || err),
      });
  }
});

router.get("/tickets", async (req, res) => {
  const { status, priority, jiraKey } = req.query;
  const q = {};
  if (status) q.status = String(status);
  if (priority) q.priority = String(priority);
  if (jiraKey) q.jiraKey = String(jiraKey);

  const docs = await Ticket.find(q).sort({ updatedAt: -1 }).limit(500);
  res.json(docs);
});

router.get("/tickets/:id", async (req, res) => {
  const doc = await Ticket.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: "Ticket not found" });
  res.json(doc);
});

router.put("/tickets/:id", async (req, res) => {
  const doc = await Ticket.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  });
  if (!doc) return res.status(404).json({ error: "Ticket not found" });
  res.json(doc);
});

// HISTORY
router.post("/tickets/:id/history", async (req, res) => {
  try {
    const h = await TicketHistory.create({
      ...req.body,
      ticketId: req.params.id,
    });
    res.json(h);
  } catch (err) {
    res
      .status(400)
      .json({
        error: "Failed to create history",
        details: String(err?.message || err),
      });
  }
});

router.get("/tickets/:id/history", async (req, res) => {
  const docs = await TicketHistory.find({ ticketId: req.params.id })
    .sort({ createdAt: -1 })
    .limit(500);
  res.json(docs);
});

export default router;
