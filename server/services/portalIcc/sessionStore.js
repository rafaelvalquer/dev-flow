import { PortalIccClient } from "./portalClient.js";

const portalSessions = new Map();

function sessionKey(req) {
  const userId = String(req.user?._id || req.user?.id || req.session?.userId || "");
  const sessionId = String(req.sessionID || "");
  if (!userId || !sessionId) return "";
  return `${userId}:${sessionId}`;
}

function isExpired(record, ttlMs) {
  if (!record) return true;
  return Date.now() - Number(record.lastTouchedAt || 0) > ttlMs;
}

export function cleanupExpiredPortalIccSessions(env) {
  const ttlMs = Number(env.PORTAL_ICC_SESSION_TTL_MS || 30 * 60 * 1000);
  let removed = 0;

  for (const [key, record] of portalSessions.entries()) {
    if (isExpired(record, ttlMs)) {
      portalSessions.delete(key);
      removed += 1;
    }
  }

  if (removed) {
    console.log("[portal-session] expired sessions removed", {
      removed,
      activeSessions: portalSessions.size,
    });
  }
}

export function getPortalIccClient(req, env) {
  cleanupExpiredPortalIccSessions(env);

  const key = sessionKey(req);
  if (!key) return null;

  const record = portalSessions.get(key);
  if (!record) return null;

  record.lastTouchedAt = Date.now();
  console.log("[portal-session] session found", {
    userId: String(req.user?._id || req.user?.id || ""),
    sessionID: req.sessionID,
    activeSessions: portalSessions.size,
  });

  return record.client;
}

export function createPortalIccClient(req, env) {
  cleanupExpiredPortalIccSessions(env);

  const key = sessionKey(req);
  const client = new PortalIccClient({ env });

  portalSessions.set(key, {
    client,
    createdAt: Date.now(),
    lastTouchedAt: Date.now(),
  });

  console.log("[portal-session] session created", {
    userId: String(req.user?._id || req.user?.id || ""),
    sessionID: req.sessionID,
    activeSessions: portalSessions.size,
  });

  return client;
}

export function removePortalIccSession(req) {
  const key = sessionKey(req);
  if (!key) return;

  portalSessions.delete(key);
  console.log("[portal-session] session removed", {
    userId: String(req.user?._id || req.user?.id || req.session?.userId || ""),
    sessionID: req.sessionID,
    activeSessions: portalSessions.size,
  });
}

export function removePortalIccSessionByUserAndSession(userId, sessionId) {
  const key = `${String(userId || "")}:${String(sessionId || "")}`;
  if (!String(userId || "") || !String(sessionId || "")) return;

  portalSessions.delete(key);
  console.log("[portal-session] session removed by logout", {
    userId: String(userId),
    sessionID: String(sessionId),
    activeSessions: portalSessions.size,
  });
}

export function requirePortalIccClient(env) {
  return function portalIccClientMiddleware(req, res, next) {
    const client = getPortalIccClient(req, env);
    if (!client) {
      return res.status(401).json({
        error: {
          code: "PORTAL_SESSION_EXPIRED",
          message: "Sessão Portal ICC não encontrada. Faça login novamente.",
        },
      });
    }

    req.portalIccClient = client;
    return next();
  };
}
