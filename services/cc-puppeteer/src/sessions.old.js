// services/nice-puppeteer/src/sessions.js
import crypto from "node:crypto";

const sessions = new Map();

export function createSession({ browser, page }) {
  const id = crypto.randomUUID();
  sessions.set(id, { id, browser, page, createdAt: Date.now() });
  return id;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export async function cleanupExpiredSessions({ ttlMs = DEFAULT_TTL_MS } = {}) {
  const now = Date.now();
  const toClose = [];

  for (const [id, s] of sessions.entries()) {
    const last = s.lastSeenAt || s.createdAt || now;
    if (now - last > ttlMs) toClose.push(id);
  }

  await Promise.all(toClose.map((id) => closeSession(id)));
  return toClose.length;
}

export async function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return false;

  sessions.delete(id);

  try {
    await s.page?.close().catch(() => {});
  } catch {}
  try {
    await s.browser?.close().catch(() => {});
  } catch {}

  return true;
}

export function countSessions() {
  return sessions.size;
}
