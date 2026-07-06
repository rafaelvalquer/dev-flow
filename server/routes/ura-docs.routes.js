import { Router } from "express";
import { asyncRoute, AppError } from "../utils/http.js";
import { getUraDocsJobStore } from "../services/uraDocsJobStore.js";
import { runUraDocsJob, pipeDownload } from "../services/uraDocsProxy.js";

function parseOptions(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

async function checkHttpHealth(url, timeoutMs) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      error:
        error?.name === "AbortError"
          ? `Timeout after ${timeoutMs}ms`
          : String(error?.message || error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default function uraDocsRoutes({ upload, env }) {
  const router = Router();
  const store = getUraDocsJobStore({ env });

  router.get(
    "/health",
    asyncRoute(async (_req, res) => {
      const timeoutMs = Number(env.HEALTHCHECK_TIMEOUT_MS || 3000);
      const pyBase =
        env.URA_DOCS_PY_BASE || env.STT_PY_BASE || "http://127.0.0.1:8000";
      const sttBase = env.STT_PY_BASE || "http://127.0.0.1:8000";
      const [python, stt] = await Promise.all([
        checkHttpHealth(`${pyBase}/ura-docs/health`, timeoutMs),
        checkHttpHealth(`${sttBase}/health`, timeoutMs),
      ]);

      return res.json({
        ok: true,
        node: { ok: true },
        python: { ...python, base: pyBase },
        stt: { ...stt, base: sttBase },
        openai: {
          configured: !!String(env.OPENAI_API_KEY || "").trim(),
          enabled:
            String(env.URA_DOCS_ENABLE_AI ?? "true").toLowerCase() !== "false",
          model:
            env.URA_DOCS_AI_MODEL ||
            env.OPENAI_MODEL ||
            "gpt-4.1-mini",
        },
        transcription: {
          provider: "python-local",
          model: "faster-whisper-local",
        },
      });
    })
  );

  router.post(
    "/jobs",
    upload.fields([
      { name: "nice_file", maxCount: 1 },
      { name: "audio_files", maxCount: 200 },
      { name: "audio_zip", maxCount: 1 },
    ]),
    asyncRoute(async (req, res) => {
      const niceFile = req.files?.nice_file?.[0];
      if (!niceFile) {
        throw new AppError({
          status: 400,
          code: "URA_DOCS_NICE_FILE_REQUIRED",
          message: "Envie um arquivo NICE no campo nice_file.",
        });
      }

      const options = parseOptions(req.body?.options);
      const projectName = String(
        req.body?.project_name || req.body?.projectName || ""
      ).trim();
      const job = store.createJob({ projectName, options });

      setImmediate(() => {
        runUraDocsJob({
          jobId: job.jobId,
          files: req.files || {},
          fields: req.body || {},
          store,
          env,
        }).catch((error) => store.markFailed(job.jobId, error));
      });

      return res.status(202).json(store.publicStatus(job));
    })
  );

  router.get(
    "/jobs/:jobId",
    asyncRoute(async (req, res) => {
      const job = store.getJob(req.params.jobId);
      if (!job) {
        throw new AppError({
          status: 404,
          code: "URA_DOCS_JOB_NOT_FOUND",
          message: "Job não encontrado.",
        });
      }
      return res.json(store.publicStatus(job));
    })
  );

  router.get(
    "/jobs/:jobId/result",
    asyncRoute(async (req, res) => {
      const job = store.getJob(req.params.jobId);
      if (!job) {
        throw new AppError({
          status: 404,
          code: "URA_DOCS_JOB_NOT_FOUND",
          message: "Job não encontrado.",
        });
      }
      if (job.status !== "completed") {
        throw new AppError({
          status: 409,
          code: "URA_DOCS_JOB_NOT_READY",
          message: "Resultado ainda não disponível.",
          details: store.publicStatus(job),
        });
      }
      return res.json({
        summary: job.summary || {},
        warnings: job.warnings || [],
        aiInsights: job.aiInsights || {},
        files: {
          drawio: `/api/ura-docs/jobs/${job.jobId}/download/drawio`,
          html: `/api/ura-docs/jobs/${job.jobId}/download/html`,
          md: `/api/ura-docs/jobs/${job.jobId}/download/md`,
          zip: `/api/ura-docs/jobs/${job.jobId}/download/zip`,
        },
      });
    })
  );

  const downloads = {
    drawio: {
      field: "drawio",
      fileName: "fluxo_ura.drawio",
      contentType: "application/vnd.jgraph.mxfile",
    },
    html: {
      field: "html",
      fileName: "documentacao_ura.html",
      contentType: "text/html; charset=utf-8",
    },
    md: {
      field: "md",
      fileName: "documentacao_ura.md",
      contentType: "text/markdown; charset=utf-8",
    },
    zip: {
      field: "zip",
      fileName: "documentacao_ura.zip",
      contentType: "application/zip",
    },
  };

  router.get(
    "/jobs/:jobId/download/:kind",
    asyncRoute(async (req, res) => {
      const job = store.getJob(req.params.jobId);
      const download = downloads[req.params.kind];
      if (!job || !download) {
        throw new AppError({
          status: 404,
          code: "URA_DOCS_DOWNLOAD_NOT_FOUND",
          message: "Download não encontrado.",
        });
      }
      const filePath = job.files?.[download.field];
      if (!filePath) {
        throw new AppError({
          status: 404,
          code: "URA_DOCS_FILE_NOT_READY",
          message: "Arquivo ainda não disponível.",
        });
      }
      return pipeDownload({
        res,
        filePath,
        fileName: download.fileName,
        contentType: download.contentType,
      });
    })
  );

  return router;
}
