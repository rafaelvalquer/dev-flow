import crypto from "node:crypto";
import { Router } from "express";
import User from "../models/User.js";
import { publicUser, requireAuth } from "../middlewares/auth.js";
import { makeJiraHeaders } from "../utils/jiraAuth.js";
import { fetchWithTimeout } from "../utils/http.js";
import { removePortalIccSessionByUserAndSession } from "../services/portalIcc/sessionStore.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HASH_PREFIX = "scrypt";
const VALID_TABS = new Set([
  "gmud",
  "rdm",
  "am",
  "my",
  "versioning",
  "tools",
  "settings",
]);
const VALID_THEMES = new Set(["claro", "grafite", "oceano", "verde"]);
const VALID_DENSITIES = new Set(["comfortable", "compact"]);
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const SHORT_SESSION_MS = 60 * 60 * 1000;
const REMEMBER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PREFERENCES = {
  theme: "claro",
  primaryColor: "#cf0013",
  density: "comfortable",
  defaultTab: "gmud",
  sidebarCollapsed: false,
};

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

function startSession(req, user, { rememberMe = false } = {}) {
  req.session.userId = String(user._id);
  req.session.user = publicUser(user);
  req.session.cookie.maxAge = rememberMe
    ? REMEMBER_SESSION_MS
    : SHORT_SESSION_MS;
}

function assertCurrentPassword(user, currentPassword) {
  if (!verifyPassword(String(currentPassword || ""), user.passwordHash)) {
    const error = new Error("Senha atual invalida.");
    error.status = 401;
    throw error;
  }
}

function normalizePreferences(rawPreferences = {}) {
  const rawTheme = String(
    rawPreferences.theme || DEFAULT_PREFERENCES.theme
  ).trim();
  const theme = rawTheme === "light" ? "claro" : rawTheme;
  const defaultTab = String(
    rawPreferences.defaultTab || DEFAULT_PREFERENCES.defaultTab
  ).trim();
  const primaryColor = String(
    rawPreferences.primaryColor || DEFAULT_PREFERENCES.primaryColor
  ).trim();
  const density = String(
    rawPreferences.density || DEFAULT_PREFERENCES.density
  ).trim();

  return {
    theme: VALID_THEMES.has(theme) ? theme : DEFAULT_PREFERENCES.theme,
    primaryColor: HEX_COLOR_RE.test(primaryColor)
      ? primaryColor.toLowerCase()
      : DEFAULT_PREFERENCES.primaryColor,
    density: VALID_DENSITIES.has(density)
      ? density
      : DEFAULT_PREFERENCES.density,
    defaultTab: VALID_TABS.has(defaultTab)
      ? defaultTab
      : DEFAULT_PREFERENCES.defaultTab,
    sidebarCollapsed: Boolean(rawPreferences.sidebarCollapsed),
  };
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
          error: err.message || "Não foi possível validar o token do Jira.",
        });
      }

      const user = await User.create({
        name: jiraUser.displayName || "",
        email,
        passwordHash: hashPassword(password),
        jiraApiToken,
        jiraAccountId: jiraUser.accountId || "",
        jiraDisplayName: jiraUser.displayName || "",
        jiraEmailAddress: jiraUser.emailAddress || "",
        jiraUserUpdatedAt: new Date(),
        jiraTokenUpdatedAt: new Date(),
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
      const rememberMe = Boolean(req.body?.rememberMe);

      const user = await User.findOne({ email });
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: "E-mail ou senha invalidos." });
      }

      user.lastLoginAt = new Date();
      await user.save();

      startSession(req, user, { rememberMe });
      res.json({ ok: true, user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  router.put("/profile", requireAuth, async (req, res, next) => {
    try {
      const name = String(req.body?.name || "").trim().slice(0, 120);
      req.user.name = name;
      await req.user.save();

      res.json({ ok: true, user: publicUser(req.user) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/jira-status", requireAuth, async (req, res) => {
    if (!req.user.jiraApiToken) {
      return res.status(400).json({
        ok: false,
        error: "Token Jira nao cadastrado para este usuario.",
      });
    }

    try {
      const jiraUser = await validateJiraToken({
        env,
        email: req.user.email,
        token: req.user.jiraApiToken,
      });

      return res.json({
        ok: true,
        jiraUser: {
          accountId: jiraUser.accountId || "",
          displayName: jiraUser.displayName || "",
          emailAddress: jiraUser.emailAddress || "",
          active: jiraUser.active !== false,
        },
      });
    } catch (err) {
      return res
        .status(err.status === 401 || err.status === 403 ? err.status : 400)
        .json({
          ok: false,
          error: err.message || "Não foi possível validar o token do Jira.",
        });
    }
  });

  router.put("/preferences", requireAuth, async (req, res, next) => {
    try {
      req.user.preferences = normalizePreferences(req.body?.preferences || req.body);
      await req.user.save();

      res.json({ ok: true, user: publicUser(req.user) });
    } catch (err) {
      next(err);
    }
  });

  router.put("/password", requireAuth, async (req, res, next) => {
    try {
      const currentPassword = String(req.body?.currentPassword || "");
      const newPassword = String(req.body?.newPassword || "");

      assertCurrentPassword(req.user, currentPassword);

      if (newPassword.length < 8) {
        return res
          .status(400)
          .json({ error: "A nova senha deve ter pelo menos 8 caracteres." });
      }

      req.user.passwordHash = hashPassword(newPassword);
      await req.user.save();

      res.json({ ok: true, user: publicUser(req.user) });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ error: err.message });
      }
      next(err);
    }
  });

  router.put("/jira-token", requireAuth, async (req, res, next) => {
    try {
      const currentPassword = String(req.body?.currentPassword || "");
      const jiraApiToken = String(
        req.body?.jiraApiToken || req.body?.token || ""
      ).trim();

      assertCurrentPassword(req.user, currentPassword);

      if (!jiraApiToken) {
        return res.status(400).json({ error: "Informe o novo token do Jira." });
      }

      let jiraUser;
      try {
        jiraUser = await validateJiraToken({
          env,
          email: req.user.email,
          token: jiraApiToken,
        });
      } catch (err) {
        return res
          .status(err.status === 401 || err.status === 403 ? err.status : 400)
          .json({
            error: err.message || "Não foi possível validar o token do Jira.",
          });
      }

      req.user.jiraApiToken = jiraApiToken;
      req.user.jiraAccountId = jiraUser.accountId || req.user.jiraAccountId;
      req.user.jiraDisplayName = jiraUser.displayName || req.user.jiraDisplayName;
      req.user.jiraEmailAddress =
        jiraUser.emailAddress || req.user.jiraEmailAddress;
      req.user.name = jiraUser.displayName || req.user.name;
      req.user.jiraTokenUpdatedAt = new Date();
      req.user.jiraUserUpdatedAt = new Date();
      await req.user.save();

      res.json({ ok: true, user: publicUser(req.user) });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ error: err.message });
      }
      next(err);
    }
  });

  router.put("/jira-user", requireAuth, async (req, res, next) => {
    try {
      const accountId = String(req.body?.accountId || "").trim();
      const displayName = String(req.body?.displayName || "").trim().slice(0, 160);
      const emailAddress = String(req.body?.emailAddress || "").trim().slice(0, 180);
      const avatarUrl = String(req.body?.avatarUrl || "").trim().slice(0, 500);

      if (!accountId) {
        req.user.jiraAccountId = "";
        req.user.jiraDisplayName = "";
        req.user.jiraEmailAddress = "";
        req.user.jiraAvatarUrl = "";
        req.user.jiraUserUpdatedAt = new Date();
        await req.user.save();
        return res.json({ ok: true, user: publicUser(req.user) });
      }

      req.user.jiraAccountId = accountId;
      req.user.jiraDisplayName = displayName;
      req.user.jiraEmailAddress = emailAddress;
      req.user.jiraAvatarUrl = avatarUrl;
      req.user.jiraUserUpdatedAt = new Date();
      await req.user.save();

      return res.json({ ok: true, user: publicUser(req.user) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", (req, res, next) => {
    removePortalIccSessionByUserAndSession(req.session?.userId, req.sessionID);

    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie("devflow.sid");
      return res.json({ ok: true });
    });
  });

  return router;
}
