// server/config/env.js
import dotenv from "dotenv";

dotenv.config();

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
          "MongoDB não configurado. Defina MONGO_URI ou MONGO_HOST/DB_USER/DB_PASSWORD.",
      });
    }
  }

  if (runtimeEnv.SESSION_SECRET === "dev-secret-change-me") {
    issues.push({
      level: runtimeEnv.NODE_ENV === "production" ? "error" : "warning",
      key: "SESSION_SECRET",
      message:
        "SESSION_SECRET está usando o valor padrão. Defina um segredo próprio para evitar sessões previsíveis.",
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
        "Integrações com Jira podem falhar sem JIRA_EMAIL e JIRA_API_TOKEN configurados.",
    });
  }

  if (!String(runtimeEnv.GEMINI_API_KEY || "").trim()) {
    issues.push({
      level: "warning",
      key: "GEMINI_API_KEY",
      message:
        "O Co-pilot de RDM ficará indisponível sem GEMINI_API_KEY configurado.",
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
