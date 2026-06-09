import { Router } from "express";
import dns from "node:dns/promises";
import net from "node:net";
import mongoose from "mongoose";
import { asyncRoute, fetchWithTimeout, readResponseBody } from "../utils/http.js";
import { getAutomationJobStatus } from "../jobs/automationJob.js";
import { makeJiraHeaders } from "../utils/jiraAuth.js";
import { getPortalIccClient } from "../services/portalIcc/sessionStore.js";

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

function sanitizeProxyValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return raw.replace(/\/\/([^:@\s]+):([^@\s]+)@/, "//***:***@");
  }
}

function serializeFetchError(error) {
  const cause = error?.cause || error?.errors?.[0] || null;
  return {
    name: error?.name || null,
    message: error?.message || String(error),
    code: error?.code || cause?.code || null,
    causeName: cause?.name || null,
    causeCode: cause?.code || null,
    causeMessage: cause?.message || String(cause || ""),
  };
}

async function checkTcpConnection(host, port, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({
        name: "tcp",
        host,
        port,
        latencyMs: Date.now() - startedAt,
        ...result,
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done({ ok: true }));
    socket.once("timeout", () =>
      done({ ok: false, error: `Timeout after ${timeoutMs}ms` })
    );
    socket.once("error", (error) =>
      done({ ok: false, error: serializeFetchError(error) })
    );
  });
}

async function checkJiraRequest({ name, url, timeoutMs, headers, body }) {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(url, {
      method: body ? "POST" : "GET",
      headers: body
        ? { "Content-Type": "application/json", ...headers }
        : headers,
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs,
    });
    const responseBody = await readResponseBody(response).catch(() => null);

    return {
      name,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      body: summarizeJiraDiagnosticBody(name, responseBody),
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: serializeFetchError(error),
    };
  }
}

function summarizeJiraDiagnosticBody(name, body) {
  if (!body || typeof body !== "object") return body;

  if (name === "serverInfo") {
    return {
      baseUrl: body.baseUrl || null,
      displayUrl: body.displayUrl || null,
      deploymentType: body.deploymentType || null,
      version: body.version || null,
    };
  }

  if (name === "searchJql") {
    return {
      issueCount: Array.isArray(body.issues) ? body.issues.length : null,
      hasNextPageToken: Boolean(body.nextPageToken),
      errorMessages: body.errorMessages || null,
      errors: body.errors || null,
    };
  }

  return body;
}

async function buildJiraDiagnostics(env) {
  const timeoutMs = Number(env.HEALTHCHECK_TIMEOUT_MS || 8000);
  const jiraBase = String(
    env.JIRA_BASE ||
      env.JIRA_BASE_URL ||
      "https://clarobr-jsw-tecnologia.atlassian.net"
  ).replace(/\/$/, "");
  const jiraUrl = new URL(jiraBase);
  const jiraConfigured = Boolean(
    String(env.JIRA_EMAIL || "").trim() &&
      String(env.JIRA_API_TOKEN || "").trim()
  );

  const dnsStartedAt = Date.now();
  let dnsCheck;
  try {
    const addresses = await dns.lookup(jiraUrl.hostname, { all: true });
    dnsCheck = {
      name: "dns",
      ok: true,
      hostname: jiraUrl.hostname,
      latencyMs: Date.now() - dnsStartedAt,
      addresses: addresses.map((item) => item.address),
    };
  } catch (error) {
    dnsCheck = {
      name: "dns",
      ok: false,
      hostname: jiraUrl.hostname,
      latencyMs: Date.now() - dnsStartedAt,
      error: serializeFetchError(error),
    };
  }

  const tcpCheck = await checkTcpConnection(
    jiraUrl.hostname,
    Number(jiraUrl.port || 443),
    timeoutMs
  );

  const headers = jiraConfigured
    ? makeJiraHeaders({
        email: env.JIRA_EMAIL,
        token: env.JIRA_API_TOKEN,
      })
    : { Accept: "application/json" };

  const [serverInfoCheck, searchJqlCheck] = await Promise.all([
    checkJiraRequest({
      name: "serverInfo",
      url: `${jiraBase}/rest/api/3/serverInfo`,
      timeoutMs,
      headers,
    }),
    jiraConfigured
      ? checkJiraRequest({
          name: "searchJql",
          url: `${jiraBase}/rest/api/3/search/jql`,
          timeoutMs,
          headers,
          body: {
            jql: "project = ICON ORDER BY updated DESC",
            maxResults: 1,
            fields: ["key", "summary", "status"],
          },
        })
      : Promise.resolve({
          name: "searchJql",
          ok: false,
          skipped: true,
          error: "JIRA_EMAIL ou JIRA_API_TOKEN nao configurados.",
        }),
  ]);

  const checks = [dnsCheck, tcpCheck, serverInfoCheck, searchJqlCheck];

  return {
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    jira: {
      base: jiraBase,
      host: jiraUrl.hostname,
      configured: jiraConfigured,
    },
    runtime: {
      node: process.versions.node,
      electron: process.versions.electron || null,
      nodeOptions: process.env.NODE_OPTIONS || "",
      nodeTlsRejectUnauthorized:
        process.env.NODE_TLS_REJECT_UNAUTHORIZED || "",
      tlsWarning:
        process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
          ? "Validacao TLS desativada neste processo para compatibilidade com certificado corporativo."
          : "",
      proxy: {
        HTTP_PROXY: sanitizeProxyValue(process.env.HTTP_PROXY),
        HTTPS_PROXY: sanitizeProxyValue(process.env.HTTPS_PROXY),
        NO_PROXY: process.env.NO_PROXY || "",
      },
    },
    checks,
  };
}

async function buildPortalIccDiagnostics(req, env) {
  const startedAt = Date.now();
  const base = String(env.PORTAL_ICC_BASE_URL || "").trim();
  const configured = Boolean(base);

  if (!configured) {
    return {
      ok: false,
      configured: false,
      authenticated: false,
      base: null,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      message: "Portal ICC nao configurado.",
    };
  }

  try {
    const client = getPortalIccClient(req, env);
    if (!client) {
      return {
        ok: false,
        configured: true,
        authenticated: false,
        base,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
        message: "Sessao Portal ICC nao autenticada.",
      };
    }

    const session = await client.getSafeSessionSummary();
    return {
      ok: true,
      configured: true,
      authenticated: true,
      base,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      session,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      authenticated: false,
      base,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      error: serializeFetchError(error),
    };
  }
}

function summarizeLatency(checks = []) {
  const latencies = checks
    .map((check) => Number(check?.latencyMs))
    .filter((value) => Number.isFinite(value));
  if (!latencies.length) return null;
  return Math.round(
    latencies.reduce((total, value) => total + value, 0) / latencies.length
  );
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
    "/system",
    asyncRoute(async (req, res) => {
      const timeoutMs = Number(env.HEALTHCHECK_TIMEOUT_MS || 3000);
      const checkedAt = new Date().toISOString();
      const mongoState = mongoose.connection.readyState;

      const [stt, jiraDiagnostics, portalIcc] = await Promise.all([
        checkJsonDependency(
          "stt",
          `${env.STT_PY_BASE || "http://127.0.0.1:8000"}/health`,
          timeoutMs
        ),
        buildJiraDiagnostics(env).catch((error) => ({
          ok: false,
          checkedAt: new Date().toISOString(),
          error: serializeFetchError(error),
          checks: [],
        })),
        buildPortalIccDiagnostics(req, env),
      ]);

      const jiraChecks = Array.isArray(jiraDiagnostics.checks)
        ? jiraDiagnostics.checks
        : [];
      const jiraConfigured = Boolean(jiraDiagnostics?.jira?.configured);
      const geminiConfigured = Boolean(String(env.GEMINI_API_KEY || "").trim());
      const services = {
        api: {
          ok: true,
          service: "dev-flow-server",
          uptimeSec: Math.round(process.uptime()),
          checkedAt,
        },
        mongo: {
          ok: mongoState === 1,
          state: mongoState,
          label: mongoStateLabel(mongoState),
          checkedAt,
        },
        jira: {
          ok: Boolean(jiraDiagnostics.ok),
          configured: jiraConfigured,
          latencyMs: summarizeLatency(jiraChecks),
          base: jiraDiagnostics?.jira?.base || null,
          host: jiraDiagnostics?.jira?.host || null,
          checkedAt: jiraDiagnostics.checkedAt || checkedAt,
          checks: jiraChecks,
          error: jiraDiagnostics.error || null,
        },
        stt: {
          ok: Boolean(stt?.ok),
          configured: true,
          latencyMs: stt?.latencyMs ?? null,
          base: stt?.url || env.STT_PY_BASE || "http://127.0.0.1:8000",
          status: stt?.status ?? null,
          checkedAt,
          error: stt?.error || null,
        },
        portalIcc,
        automation: {
          ok: true,
          ...getAutomationJobStatus(),
          checkedAt,
        },
        gemini: {
          ok: geminiConfigured,
          configured: geminiConfigured,
          model: env.GEMINI_MODEL || "gemini-2.5-flash",
          checkedAt,
        },
      };
      const ok = services.api.ok && services.mongo.ok;
      const degraded = Object.values(services).some((service) => !service?.ok);

      return res.json({
        ok,
        status: ok && !degraded ? "online" : ok ? "degraded" : "offline",
        checkedAt,
        version: {
          installed: process.env.DEV_FLOW_APP_VERSION || null,
          server: process.env.npm_package_version || null,
          node: process.versions.node,
          electron: process.versions.electron || null,
          environment: env.NODE_ENV || process.env.NODE_ENV || "development",
        },
        services,
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
      };

      const ok = Object.values(dependencies).every((dependency) => dependency?.ok);

      return res.status(ok ? 200 : 503).json({
        ok,
        checkedAt: new Date().toISOString(),
        dependencies,
      });
    })
  );

  router.get(
    "/jira",
    asyncRoute(async (_req, res) => {
      const timeoutMs = Number(env.HEALTHCHECK_TIMEOUT_MS || 8000);
      const jiraBase = String(
        env.JIRA_BASE ||
          env.JIRA_BASE_URL ||
          "https://clarobr-jsw-tecnologia.atlassian.net"
      ).replace(/\/$/, "");
      const jiraUrl = new URL(jiraBase);
      const jiraConfigured = Boolean(
        String(env.JIRA_EMAIL || "").trim() &&
          String(env.JIRA_API_TOKEN || "").trim()
      );

      const dnsStartedAt = Date.now();
      let dnsCheck;
      try {
        const addresses = await dns.lookup(jiraUrl.hostname, { all: true });
        dnsCheck = {
          name: "dns",
          ok: true,
          hostname: jiraUrl.hostname,
          latencyMs: Date.now() - dnsStartedAt,
          addresses: addresses.map((item) => item.address),
        };
      } catch (error) {
        dnsCheck = {
          name: "dns",
          ok: false,
          hostname: jiraUrl.hostname,
          latencyMs: Date.now() - dnsStartedAt,
          error: serializeFetchError(error),
        };
      }

      const tcpCheck = await checkTcpConnection(
        jiraUrl.hostname,
        Number(jiraUrl.port || 443),
        timeoutMs
      );

      const headers = jiraConfigured
        ? makeJiraHeaders({
            email: env.JIRA_EMAIL,
            token: env.JIRA_API_TOKEN,
          })
        : { Accept: "application/json" };

      const [serverInfoCheck, searchJqlCheck] = await Promise.all([
        checkJiraRequest({
          name: "serverInfo",
          url: `${jiraBase}/rest/api/3/serverInfo`,
          timeoutMs,
          headers,
        }),
        jiraConfigured
          ? checkJiraRequest({
              name: "searchJql",
              url: `${jiraBase}/rest/api/3/search/jql`,
              timeoutMs,
              headers,
              body: {
                jql: "project = ICON ORDER BY updated DESC",
                maxResults: 1,
                fields: ["key", "summary", "status"],
              },
            })
          : Promise.resolve({
              name: "searchJql",
              ok: false,
              skipped: true,
              error: "JIRA_EMAIL ou JIRA_API_TOKEN não configurados.",
            }),
      ]);

      const checks = [dnsCheck, tcpCheck, serverInfoCheck, searchJqlCheck];
      const ok = checks.every((check) => check.ok);

      return res.status(ok ? 200 : 503).json({
        ok,
        checkedAt: new Date().toISOString(),
        jira: {
          base: jiraBase,
          host: jiraUrl.hostname,
          configured: jiraConfigured,
        },
        runtime: {
          node: process.versions.node,
          electron: process.versions.electron || null,
          nodeOptions: process.env.NODE_OPTIONS || "",
          nodeTlsRejectUnauthorized:
            process.env.NODE_TLS_REJECT_UNAUTHORIZED || "",
          tlsWarning:
            process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
              ? "Validação TLS desativada neste processo para compatibilidade com certificado corporativo."
              : "",
          proxy: {
            HTTP_PROXY: sanitizeProxyValue(process.env.HTTP_PROXY),
            HTTPS_PROXY: sanitizeProxyValue(process.env.HTTPS_PROXY),
            NO_PROXY: process.env.NO_PROXY || "",
          },
        },
        checks,
      });
    })
  );

  return router;
}
