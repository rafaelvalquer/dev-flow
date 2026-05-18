import crypto from "node:crypto";
import { Router } from "express";
import User from "../models/User.js";
import { publicUser } from "../middlewares/auth.js";
import { makeJiraHeaders } from "../utils/jiraAuth.js";
import { fetchWithTimeout } from "../utils/http.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HASH_PREFIX = "scrypt";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${HASH_PREFIX}:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [prefix, salt, hash] = String(storedHash || "").split(":");
  if (prefix !== HASH_PREFIX || !salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return (
    actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  );
}

function validateCredentials({ email, password }) {
  if (!EMAIL_RE.test(email)) {
    return "Informe um e-mail corporativo valido.";
  }

  if (String(password || "").length < 8) {
    return "A senha deve ter pelo menos 8 caracteres.";
  }

  return null;
}

async function validateJiraToken({ env, email, token }) {
  const JIRA_BASE =
    env.JIRA_BASE || "https://clarobr-jsw-tecnologia.atlassian.net";
  const response = await fetchWithTimeout(`${JIRA_BASE}/rest/api/3/myself`, {
    headers: makeJiraHeaders({ email, token }),
    timeoutMs: env.REQUEST_TIMEOUT_MS,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(
      payload?.errorMessages?.[0] ||
        payload?.message ||
        "Token Jira invalido ou sem permissao."
    );
    error.status = response.status;
    throw error;
  }

  return payload || {};
}

function startSession(req, user) {
  req.session.userId = String(user._id);
}

export default function authRoutes({ env }) {
  const router = Router();

  router.get("/me", (req, res) => {
    res.json({ ok: true, user: publicUser(req.user) });
  });

  router.post("/register", async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || "");
      const jiraApiToken = String(req.body?.jiraApiToken || req.body?.token || "").trim();
      const validationError = validateCredentials({ email, password });

      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      if (!jiraApiToken) {
        return res.status(400).json({ error: "Informe o token do Jira." });
      }

      const existing = await User.findOne({ email }).lean();
      if (existing) {
        return res.status(409).json({ error: "Este e-mail ja esta cadastrado." });
      }

      let jiraUser;
      try {
        jiraUser = await validateJiraToken({ env, email, token: jiraApiToken });
      } catch (err) {
        return res.status(err.status === 401 || err.status === 403 ? err.status : 400).json({
          error: err.message || "Nao foi possivel validar o token do Jira.",
        });
      }

      const user = await User.create({
        name: jiraUser.displayName || "",
        email,
        passwordHash: hashPassword(password),
        jiraApiToken,
        jiraAccountId: jiraUser.accountId || "",
        lastLoginAt: new Date(),
      });

      startSession(req, user);
      res.status(201).json({ ok: true, user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || "");

      const user = await User.findOne({ email });
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: "E-mail ou senha invalidos." });
      }

      user.lastLoginAt = new Date();
      await user.save();

      startSession(req, user);
      res.json({ ok: true, user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie("devflow.sid");
      return res.json({ ok: true });
    });
  });

  return router;
}
