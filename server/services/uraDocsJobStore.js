import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const TERMINAL_STATUSES = new Set(["completed", "failed"]);
const MAX_ACTIVITY_ITEMS = 80;
const MAX_ACTIVITY_TEXT = 2000;

function nowIso() {
  return new Date().toISOString();
}

function truncateText(value, max = MAX_ACTIVITY_TEXT) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 20)}... [truncado]`;
}

function sanitizeActivityValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return truncateText(
      value
        .replace(/sk-[A-Za-z0-9_-]+/g, "[OPENAI_API_KEY]")
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
        .replace(/OPENAI_API_KEY\s*[:=]\s*["']?[^"'\s,}]+/gi, "OPENAI_API_KEY=[REDACTED]")
    );
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeActivityValue);
  if (typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (/api[_-]?key|authorization|cookie|token|secret/i.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitizeActivityValue(item);
      }
    }
    return result;
  }
  return value;
}

export function createUraDocsJobStore({ rootDir, ttlHours = 24 } = {}) {
  const jobs = new Map();
  const resolvedRoot = path.resolve(rootDir || "server/storage/ura-docs");

  async function ensureRoot() {
    await fs.mkdir(resolvedRoot, { recursive: true });
  }

  function createJob({ projectName, options }) {
    const jobId = crypto.randomUUID();
    const jobDir = path.join(resolvedRoot, jobId);
    const job = {
      jobId,
      status: "queued",
      step: "queued",
      progress: 0,
      message: "Job criado.",
      projectName,
      options,
      warnings: [],
      errors: [],
      activityLog: [],
      summary: {},
      aiInsights: {},
      files: {},
      jobDir,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString(),
    };
    jobs.set(jobId, job);
    return job;
  }

  function getJob(jobId) {
    return jobs.get(jobId) || null;
  }

  function publicStatus(job) {
    if (!job) return null;
    return {
      jobId: job.jobId,
      status: job.status,
      step: job.step,
      progress: job.progress,
      message: job.message,
      warnings: job.warnings,
      activityLog: job.activityLog || [],
      summary: job.summary || {},
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      expiresAt: job.expiresAt,
    };
  }

  function updateJob(jobId, patch = {}) {
    const job = getJob(jobId);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: nowIso() });
    return job;
  }

  function addWarning(jobId, warning) {
    const job = getJob(jobId);
    if (!job || !warning) return;
    job.warnings.push(String(warning));
    addActivity(jobId, {
      step: job.step,
      title: "Aviso registrado",
      message: warning,
      status: "warning",
      progress: job.progress,
      kind: "warning",
    });
    job.updatedAt = nowIso();
  }

  function addActivity(jobId, event = {}) {
    const job = getJob(jobId);
    if (!job) return null;
    const activity = {
      id: event.id || crypto.randomUUID(),
      timestamp: event.timestamp || nowIso(),
      step: String(event.step || job.step || "processing"),
      title: truncateText(event.title || "Evento", 300),
      message: truncateText(event.message || "", 2000),
      status: event.status || job.status || "processing",
      progress: Number.isFinite(Number(event.progress)) ? Number(event.progress) : Number(job.progress || 0),
      kind: event.kind || "info",
      details: sanitizeActivityValue(event.details || null),
    };
    job.activityLog = [...(job.activityLog || []), activity].slice(-MAX_ACTIVITY_ITEMS);
    job.updatedAt = nowIso();
    return activity;
  }

  async function writeJson(job, relativePath, payload) {
    const filePath = path.join(job.jobDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
    return filePath;
  }

  async function writeBuffer(job, relativePath, buffer) {
    const filePath = path.join(job.jobDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  async function markFailed(jobId, error) {
    const job = getJob(jobId);
    if (!job) return null;
    job.status = "failed";
    job.step = "failed";
    job.progress = job.progress || 0;
    job.message = error?.message || String(error);
    job.errors.push(job.message);
    addActivity(jobId, {
      step: "failed",
      title: "Falha no processamento",
      message: job.message,
      status: "failed",
      progress: job.progress || 0,
      kind: "error",
    });
    job.updatedAt = nowIso();
    return job;
  }

  async function cleanupExpired() {
    const now = Date.now();
    for (const job of jobs.values()) {
      if (
        TERMINAL_STATUSES.has(job.status) &&
        new Date(job.expiresAt).getTime() < now
      ) {
        jobs.delete(job.jobId);
        await fs.rm(job.jobDir, { recursive: true, force: true }).catch(() => null);
      }
    }
  }

  return {
    rootDir: resolvedRoot,
    ensureRoot,
    createJob,
    getJob,
    publicStatus,
    updateJob,
    addWarning,
    addActivity,
    writeJson,
    writeBuffer,
    markFailed,
    cleanupExpired,
  };
}

let singleton = null;

export function getUraDocsJobStore({ env } = {}) {
  if (!singleton) {
    singleton = createUraDocsJobStore({
      rootDir: env?.URA_DOCS_OUTPUT_DIR || "server/storage/ura-docs",
      ttlHours: Number(env?.URA_DOCS_JOB_TTL_HOURS || 24),
    });
  }
  return singleton;
}
