// server/app.js
import express from "express";
import session from "express-session";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { env } from "./config/env.js";
import { createUpload } from "./middlewares/upload.js";

import sttRoutes from "./routes/stt.routes.js";
import jiraRoutes from "./routes/jira.routes.js";
import dbRoutes from "./routes/db.routes.js";
import ticketsRouter from "./routes/tickets.js";
import automationRouter from "./routes/automation.js";
import niceRoutes from "./routes/nice.routes.js";

import { registerRdmCopilotRoutes } from "./lib/rdmCopilotGemini.js";
import { startAutomationJob } from "./jobs/automationJob.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// evita duplicar job em dev/hmr/múltiplos imports
function startAutomationJobOnce() {
  if (globalThis.__automationJobStarted) return;
  globalThis.__automationJobStarted = true;

  // allow opt-out via env
  if (String(env.AUTOMATION_JOB_ENABLED || "true").toLowerCase() === "false")
    return;

  startAutomationJob({
    intervalMs: Number(env.AUTOMATION_JOB_INTERVAL_MS || 60_000),
    env,
  });
}

export default function createApp({ startJobs = true } = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  const upload = createUpload();

  app.set("trust proxy", 1); // ok em dev também

  // RDM Co-pilot (mantém igual)
  registerRdmCopilotRoutes(app, upload, env);

  // APIs (mantém paths /api/* iguais)
  app.use("/api/stt", sttRoutes({ upload, env }));
  app.use("/api/jira", jiraRoutes({ upload, env }));
  app.use("/api/db", dbRoutes);
  app.use("/api/tickets", ticketsRouter);
  app.use("/api/nice", niceRoutes({ env }));

  // NOVO: automação
  app.use("/api/automation", automationRouter);

  app.use(
    session({
      name: "devflow.sid",
      secret: env.SESSION_SECRET || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false, // em produção com HTTPS, coloque true
        maxAge: 60 * 60 * 1000, // 1h
      },
    }),
  );

  // IMPORTANTE: só inicie após Mongo estar conectado (ideal: chamar createApp({startJobs:false}) e start no entrypoint)
  if (startJobs) startAutomationJobOnce();

  // Produção: servir build do Vite
  const clientDist = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(clientDist));

  // catch-all para qualquer rota que NÃO comece com /api
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  return app;
}
