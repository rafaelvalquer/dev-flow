// server/config/env.js
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: process.env.DEV_FLOW_ENV_FILE || path.join(__dirname, "..", ".env"),
});

const rawEnv = process.env;

function normalizeBoolean(value, defaultValue = false) {
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  ...rawEnv,
  NODE_ENV: rawEnv.NODE_ENV || "development",
  PORT: normalizeNumber(rawEnv.PORT, 3001),
  SESSION_SECRET: String(rawEnv.SESSION_SECRET || "dev-secret-change-me"),
  REQUEST_TIMEOUT_MS: normalizeNumber(rawEnv.REQUEST_TIMEOUT_MS, 15000),
  HEALTHCHECK_TIMEOUT_MS: normalizeNumber(rawEnv.HEALTHCHECK_TIMEOUT_MS, 3000),
  AUTOMATION_JOB_ENABLED: normalizeBoolean(
    rawEnv.AUTOMATION_JOB_ENABLED,
    true
  ),
  AUTOMATION_JOB_INTERVAL_MS: normalizeNumber(
    rawEnv.AUTOMATION_JOB_INTERVAL_MS,
    60000
  ),
  PORTAL_ICC_BASE_URL:
    rawEnv.PORTAL_ICC_BASE_URL ||
    rawEnv.PORTAL_BASE_URL ||
    "https://portalicc.claro.com.br",
  PORTAL_ICC_TLS_REJECT_UNAUTHORIZED: normalizeBoolean(
    rawEnv.PORTAL_ICC_TLS_REJECT_UNAUTHORIZED,
    true
  ),
  PORTAL_ICC_TIMEOUT_MS: normalizeNumber(rawEnv.PORTAL_ICC_TIMEOUT_MS, 45000),
  PORTAL_ICC_SESSION_TTL_MS: normalizeNumber(
    rawEnv.PORTAL_ICC_SESSION_TTL_MS,
    30 * 60 * 1000
  ),
  PORTAL_ICC_PROXY: rawEnv.PORTAL_ICC_PROXY || "",
  URA_DOCS_PY_BASE:
    rawEnv.URA_DOCS_PY_BASE ||
    rawEnv.STT_PY_BASE ||
    "http://127.0.0.1:8000",
  URA_DOCS_OUTPUT_DIR: rawEnv.URA_DOCS_OUTPUT_DIR || "./storage/ura-docs",
  URA_DOCS_MAX_UPLOAD_MB: normalizeNumber(rawEnv.URA_DOCS_MAX_UPLOAD_MB, 200),
  URA_DOCS_JOB_TTL_HOURS: normalizeNumber(rawEnv.URA_DOCS_JOB_TTL_HOURS, 24),
  URA_DOCS_ENABLE_AI: normalizeBoolean(rawEnv.URA_DOCS_ENABLE_AI, true),
  URA_DOCS_ENABLE_AI_CACHE: normalizeBoolean(rawEnv.URA_DOCS_ENABLE_AI_CACHE, true),
  URA_DOCS_AI_MAX_ACTIONS_PER_CHUNK: normalizeNumber(
    rawEnv.URA_DOCS_AI_MAX_ACTIONS_PER_CHUNK,
    80
  ),
  URA_DOCS_AI_MODE: rawEnv.URA_DOCS_AI_MODE || "summary",
  URA_DOCS_AI_MODEL: rawEnv.URA_DOCS_AI_MODEL || rawEnv.OPENAI_MODEL || "",
  OPENAI_API_KEY: rawEnv.OPENAI_API_KEY || "",
  OPENAI_MODEL: rawEnv.OPENAI_MODEL || "gpt-4.1-mini",
  URA_DOCS_TIMEOUT_MS: normalizeNumber(rawEnv.URA_DOCS_TIMEOUT_MS, 300000),
  URA_DOCS_STT_TIMEOUT_MS: normalizeNumber(
    rawEnv.URA_DOCS_STT_TIMEOUT_MS,
    300000
  ),
};

export function validateEnv(runtimeEnv = env) {
  const issues = [];

  if (!String(runtimeEnv.MONGO_URI || "").trim()) {
    const hasAtlasParts =
      String(runtimeEnv.MONGO_HOST || "").trim() &&
      String(runtimeEnv.DB_USER || "").trim() &&
      String(runtimeEnv.DB_PASSWORD || "").trim();

    if (!hasAtlasParts) {
      issues.push({
        level: runtimeEnv.NODE_ENV === "production" ? "error" : "warning",
        key: "MONGO_URI",
        message:
          "MongoDB nÃ£o configurado. Defina MONGO_URI ou MONGO_HOST/DB_USER/DB_PASSWORD.",
      });
    }
  }

  if (runtimeEnv.SESSION_SECRET === "dev-secret-change-me") {
    issues.push({
      level: runtimeEnv.NODE_ENV === "production" ? "error" : "warning",
      key: "SESSION_SECRET",
      message:
        "SESSION_SECRET estÃ¡ usando o valor padrÃ£o. Defina um segredo prÃ³prio para evitar sessÃµes previsÃ­veis.",
    });
  }

  if (
    !String(runtimeEnv.JIRA_EMAIL || "").trim() ||
    !String(runtimeEnv.JIRA_API_TOKEN || "").trim()
  ) {
    issues.push({
      level: "warning",
      key: "JIRA_API_TOKEN",
      message:
        "IntegraÃ§Ãµes com Jira podem falhar sem JIRA_EMAIL e JIRA_API_TOKEN configurados.",
    });
  }

  if (!String(runtimeEnv.OPENAI_API_KEY || "").trim()) {
    issues.push({
      level: "warning",
      key: "OPENAI_API_KEY",
      message:
        "Recursos de IA ficarao indisponiveis sem OPENAI_API_KEY configurado.",
    });
  }

  const errors = issues.filter((issue) => issue.level === "error");
  return {
    ok: errors.length === 0,
    issues,
    errors,
    warnings: issues.filter((issue) => issue.level === "warning"),
  };
}

