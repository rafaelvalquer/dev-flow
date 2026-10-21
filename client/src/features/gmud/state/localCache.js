const GMUD_CACHE_PREFIX = "GMUD_JIRA_CACHE_V1:";

export function getGmudCacheKey(ticket) {
  return `${GMUD_CACHE_PREFIX}${String(ticket || "").trim().toUpperCase()}`;
}

function getDefaultStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readGmudCache(ticket, storage = getDefaultStorage()) {
  try {
    const raw = storage?.getItem(getGmudCacheKey(ticket));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeGmudCache(ticket, value, storage = getDefaultStorage()) {
  try {
    storage?.setItem(getGmudCacheKey(ticket), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
