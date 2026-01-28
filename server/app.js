// server/app.js
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { env } from "./config/env.js";
import { createUpload } from "./middlewares/upload.js";

import sttRoutes from "./routes/stt.routes.js";
import jiraRoutes from "./routes/jira.routes.js";
import dbRoutes from "./routes/db.routes.js";
import ticketsRouter from "./routes/tickets.js";

import { registerRdmCopilotRoutes } from "./lib/rdmCopilotGemini.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  const upload = createUpload();

  // RDM Co-pilot (mantém igual)
  registerRdmCopilotRoutes(app, upload, env);

  // APIs (mantém paths /api/* iguais)
  app.use("/api/stt", sttRoutes({ upload, env }));
  app.use("/api/jira", jiraRoutes({ upload, env }));
  app.use("/api/db", dbRoutes);
  app.use("/api/tickets", ticketsRouter);

  // Produção: servir build do Vite
  const clientDist = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(clientDist));

  // catch-all para qualquer rota que NÃO comece com /api
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  return app;
}
