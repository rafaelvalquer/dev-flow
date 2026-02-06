import express from "express";
import cors from "cors";

import { niceRouter } from "./targets/nice/routes.js";
import { portalIccRouter } from "./targets/portalicc/routes.js";
import { countSessions, cleanupExpiredSessions } from "./sessions.js";
import { closeBrowser } from "./puppeteer/browser.js";

const PORT = Number(process.env.PORT || 8010);
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

function auth(req, res, next) {
  if (!INTERNAL_TOKEN) return next();
  const t = req.headers["x-internal-token"];
  if (t !== INTERNAL_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  return next();
}
app.use(auth);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "puppeteer-automation",
    sessions: countSessions(),
    now: new Date().toISOString(),
  });
});

// novos alvos
app.use("/portalicc", portalIccRouter);
app.use("/nice", niceRouter);

// compatibilidade com o front antigo (mantém /sessions para NICE)
app.use("/", niceRouter);

// cleanup TTL
const cleanupIntervalMs = Number(process.env.SESSION_CLEANUP_INTERVAL_MS || 60_000);
setInterval(() => {
  cleanupExpiredSessions().catch(() => {});
}, cleanupIntervalMs);

process.on("SIGINT", async () => {
  try {
    await closeBrowser();
  } finally {
    process.exit(0);
  }
});

process.on("SIGTERM", async () => {
  try {
    await closeBrowser();
  } finally {
    process.exit(0);
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`puppeteer automation running on :${PORT}`);
});
