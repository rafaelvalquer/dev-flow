// server/app.js
import express from "express";
import session from "express-session";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { env } from "./config/env.js";
import { createUpload } from "./middlewares/upload.js";
import { requestContext } from "./middlewares/requestContext.js";
import { attachUser } from "./middlewares/auth.js";

import authRoutes from "./routes/auth.routes.js";
import sttRoutes from "./routes/stt.routes.js";
import jiraRoutes from "./routes/jira.routes.js";
import dbRoutes from "./routes/db.routes.js";
import ticketsRouter from "./routes/tickets.js";
import developerWorkspaceRoutes from "./routes/developer-workspace.routes.js";
import automationRouter from "./routes/automation.js";
import healthRoutes from "./routes/health.routes.js";
import settingsRouter from "./routes/settings.routes.js";
import uraVersioningRouter from "./routes/ura-versioning.routes.js";
import toolsCdrRoutes from "./routes/tools-cdr.routes.js";
import uraDocsRoutes from "./routes/ura-docs.routes.js";

import { registerRdmCopilotRoutes } from "./lib/rdmCopilotOpenAi.js";
import { startAutomationJob } from "./jobs/automationJob.js";
import { AppError, createErrorPayload } from "./utils/http.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function startAutomationJobOnce() {
  if (globalThis.__automationJobStarted) return;
  globalThis.__automationJobStarted = true;

  if (String(env.AUTOMATION_JOB_ENABLED || "true").toLowerCase() === "false")
    return;

  startAutomationJob({
    intervalMs: Number(env.AUTOMATION_JOB_INTERVAL_MS || 60_000),
    env,
  });
}

export default function createApp({ startJobs = true, clientDist } = {}) {
  const app = express();

  app.use(requestContext);
  app.use(cors({ credentials: true, origin: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(
    session({
      name: "devflow.sid",
      secret: env.SESSION_SECRET || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 60 * 60 * 1000,
      },
    })
  );
  app.use(attachUser);

  const upload = createUpload({
    fileSizeMb: Number(env.URA_DOCS_MAX_UPLOAD_MB || 200),
  });

  app.set("trust proxy", 1);

  registerRdmCopilotRoutes(app, upload, env);

  app.use("/health", healthRoutes({ env }));
  app.use("/api/auth", authRoutes({ env }));
  app.use("/api/stt", sttRoutes({ upload, env }));
  app.use("/api/jira", jiraRoutes({ upload, env }));
  app.use("/api/db", dbRoutes);
  app.use("/api/tickets", ticketsRouter);
  app.use("/api/developer-workspace", developerWorkspaceRoutes);
  app.use("/api/settings", settingsRouter);
  app.use("/api/automation", automationRouter);
  app.use("/api/ura-versioning", uraVersioningRouter);
  app.use("/api/tools/cdr", toolsCdrRoutes({ env }));
  app.use("/api/ura-docs", uraDocsRoutes({ upload, env }));

  if (startJobs) startAutomationJobOnce();

  const resolvedClientDist =
    clientDist || path.join(__dirname, "..", "client", "dist");
  app.use(express.static(resolvedClientDist));

  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(resolvedClientDist, "index.html"));
  });

  app.use((req, res) => {
    res.status(404).json(
      createErrorPayload(
        new AppError({
          status: 404,
          code: "NOT_FOUND",
          message: "Route not found",
          details: { path: req.originalUrl, method: req.method },
        }),
        req.id
      )
    );
  });

  app.use((err, req, res, _next) => {
    const status = Number(err?.status || 500);
    req.log?.(status >= 500 ? "error" : "warn", "request.error", {
      status,
      code: err?.code || "INTERNAL_ERROR",
      error: err?.message || String(err),
    });

    return res.status(status).json(createErrorPayload(err, req.id));
  });

  return app;
}
