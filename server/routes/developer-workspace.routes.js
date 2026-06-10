import { Router } from "express";
import mongoose from "mongoose";
import DeveloperWorkspace from "../models/DeveloperWorkspace.js";
import { requireAuth } from "../middlewares/auth.js";
import { createJiraClient } from "./jira.routes.js";

const router = Router();
const MAX_RECENT_TICKETS = 12;
const VALID_WIDGETS = new Set([
  "queue",
  "statusQueue",
  "daily",
  "nextActions",
  "risk",
  "calendar",
  "recent",
  "notes",
  "productivity",
]);
const VALID_DENSITIES = new Set(["compact", "comfortable"]);
const VALID_SORTS = new Set([
  "dueDate",
  "priority",
  "updated",
  "status",
]);
const VALID_START_MODES = new Set(["workspace", "lastTicket"]);
const MAX_STICKY_NOTES = 80;

function normKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getUserObjectId(req) {
  const id = String(req.user?._id || req.user?.id || "").trim();
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

function normalizePreferences(raw = {}) {
  const visibleWidgets = Array.isArray(raw.visibleWidgets)
    ? raw.visibleWidgets.filter((item) => VALID_WIDGETS.has(item))
    : undefined;
  const density = String(raw.density || "").trim();
  const sortBy = String(raw.sortBy || "").trim();
  const startMode = String(raw.startMode || "").trim();

  return {
    ...(visibleWidgets ? { visibleWidgets } : {}),
    ...(VALID_DENSITIES.has(density) ? { density } : {}),
    ...(VALID_SORTS.has(sortBy) ? { sortBy } : {}),
    ...(VALID_START_MODES.has(startMode) ? { startMode } : {}),
    ...(raw.autoSyncOnOpen !== undefined
      ? { autoSyncOnOpen: Boolean(raw.autoSyncOnOpen) }
      : {}),
  };
}

function publicWorkspace(doc) {
  const raw = doc?.toObject ? doc.toObject() : doc || {};
  const notesMap = raw.notesByTicket || {};
  const notesByTicket =
    notesMap instanceof Map
      ? Object.fromEntries(notesMap.entries())
      : Object.fromEntries(
          Object.entries(notesMap).map(([key, value]) => [normKey(key), value])
        );

  return {
    preferences: raw.preferences || {},
    layout: raw.layout || {},
    recentTickets: Array.isArray(raw.recentTickets) ? raw.recentTickets : [],
    stickyNotes: Array.isArray(raw.stickyNotes) ? raw.stickyNotes : [],
    notesByTicket,
    updatedAt: raw.updatedAt || null,
  };
}

function normalizeStickyNotePayload(raw = {}) {
  return {
    ticketKey: normKey(raw.ticketKey),
    title: String(raw.title || "").trim().slice(0, 180),
    text: String(raw.text || "").trim().slice(0, 12000),
    color: String(raw.color || "yellow").trim().slice(0, 32) || "yellow",
    pinned: Boolean(raw.pinned),
    resolved: Boolean(raw.resolved),
  };
}

async function getOrCreateWorkspace(req) {
  const userId = getUserObjectId(req);
  if (!userId) {
    const error = new Error("Usuario invalido para workspace.");
    error.status = 400;
    throw error;
  }

  return DeveloperWorkspace.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const doc = await getOrCreateWorkspace(req);
    res.json({ ok: true, workspace: publicWorkspace(doc) });
  } catch (err) {
    next(err);
  }
});

router.put("/preferences", async (req, res, next) => {
  try {
    const doc = await getOrCreateWorkspace(req);
    const preferences = normalizePreferences(req.body?.preferences || req.body);
    const layout = req.body?.layout && typeof req.body.layout === "object"
      ? req.body.layout
      : undefined;

    if (Object.keys(preferences).length) {
      doc.preferences = {
        ...(doc.preferences?.toObject?.() || doc.preferences || {}),
        ...preferences,
      };
    }
    if (layout) doc.layout = layout;

    await doc.save();
    res.json({ ok: true, workspace: publicWorkspace(doc) });
  } catch (err) {
    next(err);
  }
});

router.put("/recent/:ticketKey", async (req, res, next) => {
  try {
    const ticketKey = normKey(req.params.ticketKey);
    if (!ticketKey) return res.status(400).json({ error: "Ticket invalido." });

    const doc = await getOrCreateWorkspace(req);
    const previous = Array.isArray(doc.recentTickets) ? doc.recentTickets : [];
    const nextItem = {
      ticketKey,
      summary: String(req.body?.summary || "").trim().slice(0, 240),
      status: String(req.body?.status || "").trim().slice(0, 80),
      priority: String(req.body?.priority || "").trim().slice(0, 80),
      activeTab: String(req.body?.activeTab || "").trim().slice(0, 40),
      progress: Math.max(0, Math.min(100, Number(req.body?.progress || 0))),
      accessedAt: new Date(),
    };

    doc.recentTickets = [
      nextItem,
      ...previous.filter((item) => normKey(item?.ticketKey) !== ticketKey),
    ].slice(0, MAX_RECENT_TICKETS);

    await doc.save();
    res.json({ ok: true, workspace: publicWorkspace(doc) });
  } catch (err) {
    next(err);
  }
});

router.get("/notes/:ticketKey", async (req, res, next) => {
  try {
    const ticketKey = normKey(req.params.ticketKey);
    if (!ticketKey) return res.status(400).json({ error: "Ticket invalido." });

    const doc = await getOrCreateWorkspace(req);
    const note = doc.notesByTicket?.get?.(ticketKey) || null;
    res.json({
      ok: true,
      ticketKey,
      note: {
        text: note?.text || "",
        updatedAt: note?.updatedAt || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.put("/notes/:ticketKey", async (req, res, next) => {
  try {
    const ticketKey = normKey(req.params.ticketKey);
    if (!ticketKey) return res.status(400).json({ error: "Ticket invalido." });

    const doc = await getOrCreateWorkspace(req);
    const text = String(req.body?.text || "").slice(0, 12000);
    if (!doc.notesByTicket) doc.notesByTicket = new Map();
    doc.notesByTicket.set(ticketKey, { text, updatedAt: new Date() });
    doc.markModified("notesByTicket");

    await doc.save();
    res.json({ ok: true, workspace: publicWorkspace(doc) });
  } catch (err) {
    next(err);
  }
});

router.post("/sticky-notes", async (req, res, next) => {
  try {
    const doc = await getOrCreateWorkspace(req);
    const payload = normalizeStickyNotePayload(req.body || {});
    if (!payload.text) {
      return res.status(400).json({ error: "Nota vazia." });
    }

    const now = new Date();
    const note = {
      id: new mongoose.Types.ObjectId().toString(),
      ticketKey: payload.ticketKey || "",
      title: payload.title || payload.ticketKey || "Nota livre",
      text: payload.text,
      color: payload.color,
      pinned: payload.pinned,
      resolved: payload.resolved,
      resolvedAt: payload.resolved ? now : null,
      jiraCommentedAt: null,
      jiraCommentId: "",
      createdAt: now,
      updatedAt: now,
    };

    const previous = Array.isArray(doc.stickyNotes) ? doc.stickyNotes : [];
    doc.stickyNotes = [note, ...previous].slice(0, MAX_STICKY_NOTES);

    if (payload.ticketKey) {
      if (!doc.notesByTicket) doc.notesByTicket = new Map();
      doc.notesByTicket.set(payload.ticketKey, { text: payload.text, updatedAt: now });
      doc.markModified("notesByTicket");
    }

    await doc.save();
    res.json({ ok: true, note, workspace: publicWorkspace(doc) });
  } catch (err) {
    next(err);
  }
});

router.put("/sticky-notes/:noteId", async (req, res, next) => {
  try {
    const noteId = String(req.params.noteId || "").trim();
    if (!noteId) return res.status(400).json({ error: "Nota invalida." });

    const doc = await getOrCreateWorkspace(req);
    const notes = Array.isArray(doc.stickyNotes) ? doc.stickyNotes : [];
    const note = notes.find((item) => String(item?.id || "") === noteId);
    if (!note) return res.status(404).json({ error: "Nota nao encontrada." });

    const body = req.body || {};
    if (Object.prototype.hasOwnProperty.call(body, "ticketKey")) {
      const ticketKey = normKey(body.ticketKey);
      note.ticketKey = ticketKey || "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "title")) {
      note.title =
        String(body.title || "").trim().slice(0, 180) ||
        note.ticketKey ||
        "Nota livre";
    }
    if (Object.prototype.hasOwnProperty.call(body, "text")) {
      note.text = String(body.text || "").trim().slice(0, 12000);
    }
    if (Object.prototype.hasOwnProperty.call(body, "color")) {
      note.color = String(body.color || "yellow").trim().slice(0, 32) || "yellow";
    }
    if (Object.prototype.hasOwnProperty.call(body, "pinned")) {
      note.pinned = Boolean(body.pinned);
    }
    if (Object.prototype.hasOwnProperty.call(body, "resolved")) {
      const resolved = Boolean(body.resolved);
      note.resolved = resolved;
      note.resolvedAt = resolved ? new Date() : null;
    }
    note.updatedAt = new Date();

    doc.markModified("stickyNotes");
    await doc.save();
    res.json({ ok: true, note, workspace: publicWorkspace(doc) });
  } catch (err) {
    next(err);
  }
});

router.post("/sticky-notes/:noteId/jira-comment", async (req, res, next) => {
  try {
    const noteId = String(req.params.noteId || "").trim();
    if (!noteId) return res.status(400).json({ error: "Nota invalida." });

    const doc = await getOrCreateWorkspace(req);
    const notes = Array.isArray(doc.stickyNotes) ? doc.stickyNotes : [];
    const note = notes.find((item) => String(item?.id || "") === noteId);
    if (!note) return res.status(404).json({ error: "Nota nao encontrada." });
    const ticketKey = normKey(note.ticketKey);
    if (!ticketKey) {
      return res.status(400).json({ error: "Nota sem ticket Jira vinculado." });
    }
    const text = String(note.text || "").trim();
    if (!text) return res.status(400).json({ error: "Nota vazia." });

    const title = String(note.title || "").trim();
    const commentText = [
      title ? `Nota pessoal - ${title}` : "Nota pessoal",
      "",
      text,
    ].join("\n");
    const jira = createJiraClient();
    const comment = await jira.addCommentText(ticketKey, commentText);
    note.jiraCommentedAt = new Date();
    note.jiraCommentId = String(comment?.id || "");
    note.updatedAt = new Date();

    doc.markModified("stickyNotes");
    await doc.save();
    res.json({ ok: true, comment, workspace: publicWorkspace(doc) });
  } catch (err) {
    next(err);
  }
});

router.delete("/sticky-notes/:noteId", async (req, res, next) => {
  try {
    const noteId = String(req.params.noteId || "").trim();
    if (!noteId) return res.status(400).json({ error: "Nota invalida." });

    const doc = await getOrCreateWorkspace(req);
    const previous = Array.isArray(doc.stickyNotes) ? doc.stickyNotes : [];
    const nextNotes = previous.filter((item) => String(item?.id || "") !== noteId);
    if (nextNotes.length === previous.length) {
      return res.status(404).json({ error: "Nota nao encontrada." });
    }

    doc.stickyNotes = nextNotes;
    await doc.save();
    res.json({ ok: true, workspace: publicWorkspace(doc) });
  } catch (err) {
    next(err);
  }
});

export default router;
