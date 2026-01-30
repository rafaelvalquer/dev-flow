// src/services/automationApi.js

function normKey(ticketKey) {
  return String(ticketKey || "")
    .trim()
    .toUpperCase();
}

async function fetchJson(url, options = {}) {
  const r = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
    cache: "no-store",
    ...options,
  });

  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    const msg =
      data?.error || data?.message || `Falha na requisição (${r.status})`;
    throw new Error(msg);
  }

  return data;
}

export async function getAutomation(ticketKey) {
  const tk = normKey(ticketKey);
  return fetchJson(`/api/tickets/${encodeURIComponent(tk)}/automation`);
}

export async function saveAutomation(ticketKey, payload) {
  const tk = normKey(ticketKey);
  return fetchJson(`/api/tickets/${encodeURIComponent(tk)}/automation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Dry-run (compatível com os 2 formatos mais comuns):
 *  1) POST /api/automation/dry-run/:ticketKey  { rules: [...] }
 *  2) POST /api/automation/dry-run            { ticketKey, rules }
 */
export async function dryRunAutomation(ticketKey, rules) {
  const tk = normKey(ticketKey);

  // tenta formato 1
  try {
    return await fetchJson(
      `/api/automation/dry-run/${encodeURIComponent(tk)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: rules || [] }),
      }
    );
  } catch (e) {
    // fallback formato 2
    return fetchJson(`/api/automation/dry-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketKey: tk, rules: rules || [] }),
    });
  }
}

/** Busca usuários atribuíveis (assignee) para o ticket */
export async function searchAssignableUsers(ticketKey, q, limit = 20) {
  const tk = normKey(ticketKey);
  const qs = new URLSearchParams();
  if (tk) qs.set("issueKey", tk);
  if (q) qs.set("q", q);
  if (limit) qs.set("limit", String(limit));
  return fetchJson(`/api/jira/users/assignable?${qs.toString()}`);
}
