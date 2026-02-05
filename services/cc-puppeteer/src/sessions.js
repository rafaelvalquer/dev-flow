// services/nice-puppeteer/src/sessions.js
import crypto from "node:crypto";

const sessions = new Map();

/**
 * TTL por sessão (sem atividade). Ajuste se quiser.
 * Ex.: 10 min (600_000)
 */
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 10 * 60 * 1000);

export function createSession({ context, page }) {
  const id = crypto.randomUUID();
  const now = Date.now();

  sessions.set(id, {
    id,
    context,
    page,
    createdAt: now,
    lastAccessAt: now,
  });

  return id;
}

export function getSession(id) {
  const s = sessions.get(id);
  if (!s) return null;
  s.lastAccessAt = Date.now();
  return s;
}

export async function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return false;

  sessions.delete(id);

  try {
    await s.page?.close().catch(() => {});
  } catch {}

  try {
    await s.context?.close().catch(() => {});
  } catch {}

  return true;
}

export function countSessions() {
  return sessions.size;
}

export async function cleanupExpiredSessions() {
  const now = Date.now();
  const idsToClose = [];

  for (const [id, s] of sessions.entries()) {
    const age = now - (s.lastAccessAt || s.createdAt || now);
    if (age > SESSION_TTL_MS) idsToClose.push(id);
  }

  await Promise.all(idsToClose.map((id) => closeSession(id)));
}
