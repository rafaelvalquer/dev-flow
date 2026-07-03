import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

function nowIso() {
  return new Date().toISOString();
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
    job.updatedAt = nowIso();
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
