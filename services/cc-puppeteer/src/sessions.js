const sessions = new Map();

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 15 * 60 * 1000);

function randomId(len = 16) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function createSession({ target, context, page, meta }) {
  const id = randomId();
  sessions.set(id, {
    id,
    target: target || "unknown",
    context: context || null,
    page,
    meta: meta || {},
    createdAt: Date.now(),
  });
  return id;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export async function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return false;
  sessions.delete(id);

  // Fecha page/context; NÃO fecha o browser global.
  try {
    if (s.page && !s.page.isClosed()) {
      await s.page.close({ runBeforeUnload: true });
    }
  } catch {}

  try {
    if (s.context) await s.context.close();
  } catch {}

  return true;
}

export function countSessions() {
  return sessions.size;
}

export async function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      await closeSession(id);
    }
  }
}
