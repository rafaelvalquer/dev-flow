import { Router } from "express";
import crypto from "node:crypto";
import { parseTrcBuffer } from "../services/trcParser.js";
import { analyzeEvents } from "../services/trcAnalyzer.js";
import { eventsToCsv } from "../services/csvExporter.js";

const TTL_MS = 2 * 60 * 60 * 1000;
const store = new Map();

function cleanupStore() {
  const now = Date.now();
  for (const [id, item] of store.entries()) {
    if (now - item.createdAt > TTL_MS) store.delete(id);
  }
}

function getAnalysis(req, res) {
  cleanupStore();
  const item = store.get(req.params.analysisId);
  if (!item) {
    res.status(404).json({ ok: false, error: "Análise não encontrada ou expirada." });
    return null;
  }
  return item;
}

function pageEvents(events, query) {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(500, Math.max(10, Number(query.pageSize || 100)));
  const start = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    total: events.length,
    items: events.slice(start, start + pageSize),
  };
}

function matchesSearch(event, q, type) {
  const value = q.toLowerCase();
  const haystacks = {
    contactId: [event.contactId],
    msisdn: [event.msisdn],
    script: [event.scriptName],
    api: [event.apiName, event.url],
    error: [event.isError ? event.fullText : ""],
    action: [event.action],
    transcript: [event.transcript, event.intent],
    transfer: [event.transferCode, event.action === "TRANSFER" ? event.fullText : ""],
    all: [event.contactId, event.msisdn, event.scriptName, event.action, event.apiName, event.httpStatusCode, event.transcript, event.transferCode, event.fullText],
  };
  return (haystacks[type] || haystacks.all).some((item) => String(item || "").toLowerCase().includes(value));
}

function makeResponse(item, includeEvents = false) {
  return {
    ok: true,
    analysisId: item.analysisId,
    createdAt: item.createdAt,
    files: item.files,
    parser: item.parser,
    analysis: item.analysis,
    ...(includeEvents ? { events: item.events } : {}),
  };
}

export function analyzeTrcFiles(files = [], log = console.log) {
  const parsedFiles = files.map((file) => {
    const parsed = parseTrcBuffer(file.buffer, file.originalname);
    return {
      file: {
        name: file.originalname,
        sizeBytes: file.size ?? file.buffer?.length ?? 0,
      },
      parsed,
    };
  });
  const events = parsedFiles.flatMap(({ parsed, file }, fileIndex) =>
    parsed.events.map((event) => ({
      ...event,
      fileName: file.name,
      fileIndex,
      index: event.index + parsedFiles.slice(0, fileIndex).reduce((acc, item) => acc + item.parsed.events.length, 0),
    }))
  ).map((event, index) => ({ ...event, index: index + 1 }));
  const analysis = analyzeEvents(events);
  const analysisId = crypto.randomUUID();
  const item = {
    analysisId,
    createdAt: Date.now(),
    files: parsedFiles.map((item) => item.file),
    parser: {
      detectedFormats: [...new Set(parsedFiles.map((item) => item.parsed.detectedFormat))],
      metadata: parsedFiles.map((item) => item.parsed.metadata),
      warnings: parsedFiles.flatMap((item) => item.parsed.warnings),
    },
    events,
    analysis,
  };
  store.set(analysisId, item);
  log?.("info", "trc.upload.analyzed", {
    analysisId,
    files: item.files.length,
    events: events.length,
    warnings: item.parser.warnings.length,
  });
  return item;
}

export default function trcRoutes({ traceUpload, upload } = {}) {
  const router = Router();
  const uploader = traceUpload || upload;

  function uploadMany(req, res, next) {
    uploader.array("files", 10)(req, res, (err) => {
      if (!err) return next();
      if (err?.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ ok: false, error: "Arquivo TRC muito grande. O limite atual é 50MB.", code: "TRACE_FILE_TOO_LARGE" });
      }
      return next(err);
    });
  }

  function uploadOne(req, res, next) {
    uploader.single("file")(req, res, (err) => {
      if (!err) return next();
      if (err?.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ ok: false, error: "Arquivo TRC muito grande. O limite atual Ã© 50MB.", code: "TRACE_FILE_TOO_LARGE" });
      }
      return next(err);
    });
  }

  router.post("/upload", uploadMany, (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: "Envie um ou mais arquivos no campo 'files'." });
    const invalid = files.find((file) => !String(file.originalname || "").toLowerCase().endsWith(".trc"));
    if (invalid) return res.status(400).json({ ok: false, error: "Todos os arquivos devem ter extensão .TRC." });
    const item = analyzeTrcFiles(files, req.log);
    return res.json({
      ok: true,
      analysisId: item.analysisId,
      summary: item.analysis.summary,
      files: item.files,
      warnings: item.parser.warnings,
      reportText: item.analysis.reportText,
    });
  });

  router.post("/analyze", uploadOne, (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: "Envie um arquivo no campo 'file'." });
    if (!String(file.originalname || "").toLowerCase().endsWith(".trc")) {
      return res.status(400).json({ ok: false, error: "Envie um arquivo .TRC." });
    }
    const item = analyzeTrcFiles([file], req.log);
    return res.json({
      ok: true,
      analysisId: item.analysisId,
      file: item.files[0],
      summary: item.analysis.summary,
      timeline: item.analysis.timeline,
      apis: item.analysis.apiCalls,
      findings: item.analysis.errors,
      variables: [],
      flow: item.analysis.scriptTree,
      rawPreview: item.events.slice(0, 20).map((event) => event.fullText).join("\n\n"),
      reportText: item.analysis.reportText,
    });
  });

  router.get("/:analysisId", (req, res) => {
    const item = getAnalysis(req, res);
    if (!item) return;
    return res.json(makeResponse(item, true));
  });
  router.get("/:analysisId/events", (req, res) => {
    const item = getAnalysis(req, res);
    if (!item) return;
    return res.json({ ok: true, ...pageEvents(item.events, req.query) });
  });
  router.get("/:analysisId/timeline", (req, res) => {
    const item = getAnalysis(req, res);
    if (!item) return;
    return res.json({ ok: true, timeline: item.analysis.timeline });
  });
  router.get("/:analysisId/script-tree", (req, res) => {
    const item = getAnalysis(req, res);
    if (!item) return;
    return res.json({ ok: true, scriptTree: item.analysis.scriptTree });
  });
  router.get("/:analysisId/api-calls", (req, res) => {
    const item = getAnalysis(req, res);
    if (!item) return;
    return res.json({ ok: true, apiCalls: item.analysis.apiCalls });
  });
  router.get("/:analysisId/errors", (req, res) => {
    const item = getAnalysis(req, res);
    if (!item) return;
    return res.json({ ok: true, errors: item.analysis.errors });
  });
  router.get("/:analysisId/transcriptions", (req, res) => {
    const item = getAnalysis(req, res);
    if (!item) return;
    return res.json({ ok: true, transcriptions: item.analysis.transcriptions });
  });
  router.get("/:analysisId/transfers", (req, res) => {
    const item = getAnalysis(req, res);
    if (!item) return;
    return res.json({ ok: true, transfers: item.analysis.transfers });
  });
  router.get("/:analysisId/search", (req, res) => {
    const item = getAnalysis(req, res);
    if (!item) return;
    const q = String(req.query.q || "").trim();
    const type = String(req.query.type || "all");
    const results = q ? item.events.filter((event) => matchesSearch(event, q, type)).slice(0, 500) : [];
    return res.json({ ok: true, q, type, results });
  });
  router.get("/:analysisId/export.csv", (req, res) => {
    const item = getAnalysis(req, res);
    if (!item) return;
    res.setHeader("Content-Type", "text/csv;charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="trc-${item.analysisId}.csv"`);
    return res.send(eventsToCsv(item.events));
  });
  router.get("/:analysisId/export.json", (req, res) => {
    const item = getAnalysis(req, res);
    if (!item) return;
    res.setHeader("Content-Type", "application/json;charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="trc-${item.analysisId}.json"`);
    return res.send(JSON.stringify(makeResponse(item, true), null, 2));
  });

  return router;
}
