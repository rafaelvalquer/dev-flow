import { Router } from "express";
import mongoose from "mongoose";

import { requireAuth } from "../middlewares/auth.js";
import Ura from "../models/Ura.js";
import UraVersion from "../models/UraVersion.js";

const router = Router();

const URA_STATUSES = new Set(["active", "maintenance", "deprecated"]);
const VERSION_STATUSES = new Set([
  "planned",
  "deployed",
  "rollback",
  "cancelled",
]);

const MAX_EVIDENCES = 80;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function toStringId(value) {
  return value ? String(value) : "";
}

function assertObjectId(value, label = "id") {
  const id = String(value || "").trim();
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw badRequest(`${label} invalido.`);
  }
  return id;
}

function normalizeLineList(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/\r?\n/)
        .map((item) => item.trim());

  return source
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 200);
}

function normalizeJiraSnapshot(value = {}, ticket = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const key = String(value.key || ticket || "").trim().toUpperCase().slice(0, 80);
  if (!key) return {};

  return {
    key,
    summary: String(value.summary || "").trim().slice(0, 500),
    status: String(value.status || "").trim().slice(0, 160),
    assignee: String(value.assignee || "").trim().slice(0, 160),
    priority: String(value.priority || "").trim().slice(0, 80),
    url: String(value.url || "").trim().slice(0, 1000),
    updatedAt: value.updatedAt || null,
    syncedAt: value.syncedAt || new Date().toISOString(),
  };
}

function normalizeEvidence(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = String(value.id || value.attachmentId || value.filename || "").trim().slice(0, 160);
  const filename = String(value.filename || value.name || "evidencia").trim().slice(0, 260);
  if (!filename) return null;

  return {
    id,
    filename,
    size: Number(value.size || 0) || 0,
    mimeType: String(value.mimeType || value.contentType || "").trim().slice(0, 160),
    author: String(value.author || "").trim().slice(0, 160),
    createdAt: value.createdAt || value.created || new Date().toISOString(),
    url: String(value.url || value.content || value.downloadUrl || "").trim().slice(0, 1000),
  };
}

function normalizeEvidences(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeEvidence).filter(Boolean).slice(0, MAX_EVIDENCES);
}

function normalizeUraPayload(body = {}) {
  const name = String(body.name || "").trim().slice(0, 160);
  if (!name) throw badRequest("Nome da URA e obrigatorio.");

  const status = String(body.status || "active").trim();
  return {
    name,
    description: String(body.description || "").trim().slice(0, 2000),
    project: String(body.project || "").trim().slice(0, 160),
    owner: String(body.owner || "").trim().slice(0, 160),
    status: URA_STATUSES.has(status) ? status : "active",
  };
}

function normalizeVersionPayload(body = {}) {
  const version = String(body.version || "").trim().slice(0, 80);
  if (!version) throw badRequest("Versão é obrigatória.");

  const rawDate = String(body.deploymentDate || body.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    throw badRequest("Data de implantacao invalida.");
  }

  const status = String(body.status || "deployed").trim();
  const ticket = String(body.ticket || "").trim().slice(0, 80).toUpperCase();
  return {
    version,
    deploymentDate: new Date(`${rawDate}T00:00:00.000Z`),
    developer: String(body.developer || "").trim().slice(0, 160),
    ticket,
    jiraSnapshot: normalizeJiraSnapshot(body.jiraSnapshot, ticket),
    evidences: normalizeEvidences(body.evidences),
    description: String(body.description || "").trim().slice(0, 4000),
    changes: normalizeLineList(body.changes),
    scripts: normalizeLineList(body.scripts),
    status: VERSION_STATUSES.has(status) ? status : "deployed",
    deploymentStatusUpdatedAt: body.deploymentStatusUpdatedAt
      ? new Date(body.deploymentStatusUpdatedAt)
      : new Date(),
  };
}

function serializeUra(doc) {
  if (!doc) return null;
  return {
    id: toStringId(doc._id || doc.id),
    name: doc.name || "",
    description: doc.description || "",
    project: doc.project || "",
    owner: doc.owner || "",
    status: doc.status || "active",
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    createdBy: toStringId(doc.createdBy),
    updatedBy: toStringId(doc.updatedBy),
  };
}

function serializeVersion(doc) {
  if (!doc) return null;
  return {
    id: toStringId(doc._id || doc.id),
    uraId: toStringId(doc.uraId),
    version: doc.version || "",
    deploymentDate: doc.deploymentDate
      ? String(doc.deploymentDate.toISOString()).slice(0, 10)
      : "",
    developer: doc.developer || "",
    ticket: doc.ticket || "",
    jiraSnapshot: doc.jiraSnapshot || {},
    evidences: Array.isArray(doc.evidences) ? doc.evidences : [],
    description: doc.description || "",
    changes: Array.isArray(doc.changes) ? doc.changes : [],
    scripts: Array.isArray(doc.scripts) ? doc.scripts : [],
    status: doc.status || "deployed",
    deploymentStatusUpdatedAt: doc.deploymentStatusUpdatedAt || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    createdBy: toStringId(doc.createdBy),
    updatedBy: toStringId(doc.updatedBy),
  };
}

async function assertUraExists(uraId) {
  const ura = await Ura.findById(uraId);
  if (!ura) throw notFound("URA nao encontrada.");
  return ura;
}

router.use(requireAuth);

router.get("/uras", async (_req, res, next) => {
  try {
    const uras = await Ura.find({}).sort({ name: 1 }).lean();
    res.json({ ok: true, uras: uras.map(serializeUra) });
  } catch (err) {
    next(err);
  }
});

router.post("/uras", async (req, res, next) => {
  try {
    const payload = normalizeUraPayload(req.body);
    const userId = req.user?._id;
    const doc = await Ura.create({
      ...payload,
      createdBy: userId,
      updatedBy: userId,
    });
    res.status(201).json({ ok: true, ura: serializeUra(doc) });
  } catch (err) {
    next(err);
  }
});

router.put("/uras/:id", async (req, res, next) => {
  try {
    const id = assertObjectId(req.params.id, "URA");
    const payload = normalizeUraPayload(req.body);
    const doc = await Ura.findByIdAndUpdate(
      id,
      { $set: { ...payload, updatedBy: req.user?._id } },
      { new: true, runValidators: true },
    );
    if (!doc) throw notFound("URA nao encontrada.");
    res.json({ ok: true, ura: serializeUra(doc) });
  } catch (err) {
    next(err);
  }
});

router.delete("/uras/:id", async (req, res, next) => {
  try {
    const id = assertObjectId(req.params.id, "URA");
    const doc = await Ura.findByIdAndDelete(id);
    if (!doc) throw notFound("URA nao encontrada.");
    await UraVersion.deleteMany({ uraId: id });
    res.json({ ok: true, ura: serializeUra(doc) });
  } catch (err) {
    next(err);
  }
});

router.get("/uras/:id/versions", async (req, res, next) => {
  try {
    const id = assertObjectId(req.params.id, "URA");
    await assertUraExists(id);
    const versions = await UraVersion.find({ uraId: id })
      .sort({ deploymentDate: -1, createdAt: -1 })
      .lean();
    res.json({ ok: true, versions: versions.map(serializeVersion) });
  } catch (err) {
    next(err);
  }
});

router.post("/uras/:id/versions", async (req, res, next) => {
  try {
    const uraId = assertObjectId(req.params.id, "URA");
    await assertUraExists(uraId);
    const payload = normalizeVersionPayload(req.body);
    const doc = await UraVersion.create({
      ...payload,
      uraId,
      createdBy: req.user?._id,
      updatedBy: req.user?._id,
    });
    res.status(201).json({ ok: true, version: serializeVersion(doc) });
  } catch (err) {
    if (err?.code === 11000) {
      err.status = 409;
      err.message = "Esta versao ja existe para a URA selecionada.";
    }
    next(err);
  }
});

router.put("/versions/:versionId", async (req, res, next) => {
  try {
    const versionId = assertObjectId(req.params.versionId, "Versionamento");
    const payload = normalizeVersionPayload(req.body);
    const nextUraId = req.body?.uraId
      ? assertObjectId(req.body.uraId, "URA")
      : "";
    if (nextUraId) await assertUraExists(nextUraId);

    const doc = await UraVersion.findByIdAndUpdate(
      versionId,
      {
        $set: {
          ...payload,
          ...(nextUraId ? { uraId: nextUraId } : {}),
          updatedBy: req.user?._id,
        },
      },
      { new: true, runValidators: true },
    );
    if (!doc) throw notFound("Versionamento nao encontrado.");
    res.json({ ok: true, version: serializeVersion(doc) });
  } catch (err) {
    if (err?.code === 11000) {
      err.status = 409;
      err.message = "Esta versao ja existe para a URA selecionada.";
    }
    next(err);
  }
});

router.delete("/versions/:versionId", async (req, res, next) => {
  try {
    const versionId = assertObjectId(req.params.versionId, "Versionamento");
    const doc = await UraVersion.findByIdAndDelete(versionId);
    if (!doc) throw notFound("Versionamento nao encontrado.");
    res.json({ ok: true, version: serializeVersion(doc) });
  } catch (err) {
    next(err);
  }
});

export default router;
