import { Router } from "express";
import mongoose from "mongoose";
import { asyncRoute, fetchWithTimeout, readResponseBody } from "../utils/http.js";
import { getAutomationJobStatus } from "../jobs/automationJob.js";

function mongoStateLabel(state) {
  return (
    {
      0: "disconnected",
      1: "connected",
      2: "connecting",
      3: "disconnecting",
    }[state] || "unknown"
  );
}

async function checkJsonDependency(name, url, timeoutMs, headers = {}) {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers,
      timeoutMs,
    });
    const body = await readResponseBody(response).catch(() => null);

    return {
      name,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      url,
      body,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      url,
      error: String(error?.message || error),
    };
  }
}

export default function healthRoutes({ env }) {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (_req, res) => {
      const mongoState = mongoose.connection.readyState;

      return res.json({
        ok: true,
        service: "dev-flow-server",
        now: new Date().toISOString(),
        uptimeSec: Math.round(process.uptime()),
        mongo: {
          state: mongoState,
          label: mongoStateLabel(mongoState),
          ok: mongoState === 1,
        },
        automation: getAutomationJobStatus(),
      });
    })
  );

  router.get(
    "/dependencies",
    asyncRoute(async (_req, res) => {
      const timeoutMs = Number(env.HEALTHCHECK_TIMEOUT_MS || 3000);
      const checks = await Promise.all([
        checkJsonDependency(
          "stt",
          `${env.STT_PY_BASE || "http://127.0.0.1:8000"}/health`,
          timeoutMs
        ),
        checkJsonDependency(
          "nice",
          `${env.NICE_PUP_BASE || "http://127.0.0.1:8010"}/health`,
          timeoutMs,
          env.NICE_PUP_TOKEN ? { "x-internal-token": env.NICE_PUP_TOKEN } : {}
        ),
      ]);

      const mongoState = mongoose.connection.readyState;
      const jiraConfigured = Boolean(
        String(env.JIRA_BASE || "").trim() &&
          String(env.JIRA_EMAIL || "").trim() &&
          String(env.JIRA_API_TOKEN || "").trim()
      );
      const geminiConfigured = Boolean(String(env.GEMINI_API_KEY || "").trim());

      const dependencies = {
        api: { ok: true },
        mongo: {
          ok: mongoState === 1,
          state: mongoState,
          label: mongoStateLabel(mongoState),
        },
        jira: {
          ok: jiraConfigured,
          configured: jiraConfigured,
          base: env.JIRA_BASE || null,
        },
        gemini: {
          ok: geminiConfigured,
          configured: geminiConfigured,
          model: env.GEMINI_MODEL || "gemini-2.5-flash",
        },
        stt: checks.find((item) => item.name === "stt"),
        nice: checks.find((item) => item.name === "nice"),
      };

      const ok = Object.values(dependencies).every((dependency) => dependency?.ok);

      return res.status(ok ? 200 : 503).json({
        ok,
        checkedAt: new Date().toISOString(),
        dependencies,
      });
    })
  );

  return router;
}
