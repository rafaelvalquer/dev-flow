// src/lib/jiraClient.js

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isJsonResponse(res) {
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json");
}

async function readBody(res) {
  if (isJsonResponse(res)) return await res.json();
  return await res.text();
}

function toErrorPayload(status, body) {
  const msg =
    typeof body === "string"
      ? body
      : body?.errorMessages?.join(" | ") || body?.error || JSON.stringify(body);
  const e = new Error(msg || `HTTP ${status}`);
  e.status = status;
  e.body = body;
  return e;
}

async function requestJson(url, options = {}, { retries = 4 } = {}) {
  let attempt = 0;

  while (true) {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...(options.headers || {}) },
      ...options,
    });

    // Auth/perm
    if (res.status === 401 || res.status === 403) {
      const body = await readBody(res);
      throw toErrorPayload(res.status, body);
    }

    // Rate limit
    if (res.status === 429 && attempt < retries) {
      const ra = res.headers.get("Retry-After");
      const waitSec = ra ? Number(ra) : 0;
      const backoffMs = Math.max(1000, waitSec * 1000) * (1 + attempt * 0.5);
      await sleep(backoffMs);
      attempt++;
      continue;
    }

    if (!res.ok) {
      const body = await readBody(res);
      throw toErrorPayload(res.status, body);
    }

    return await readBody(res);
  }
}

// ---- API do seu proxy ----
export async function jiraSearchJqlPage(body) {
  return requestJson("/api/jira/search/jql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function jiraSearchJqlAll(baseBody) {
  const all = [];
  let nextPageToken = undefined;

  while (true) {
    const pageBody = { ...baseBody };
    if (nextPageToken) pageBody.nextPageToken = nextPageToken;

    const resp = await jiraSearchJqlPage(pageBody);

    const issues = resp.issues || [];
    all.push(...issues);

    nextPageToken = resp.nextPageToken;
    if (!nextPageToken) break;
  }

  return all;
}

export async function jiraGetIssue(key, fieldsCsv) {
  const qs = new URLSearchParams();
  if (fieldsCsv) qs.set("fields", fieldsCsv);
  const url = `/api/jira/issue/${encodeURIComponent(key)}${
    qs.toString() ? `?${qs.toString()}` : ""
  }`;
  return requestJson(url, { method: "GET" });
}

export async function jiraGetComments(key) {
  const url = `/api/jira/issue/${encodeURIComponent(key)}/comments`;
  return requestJson(url, { method: "GET" });
}

export async function jiraEditIssue(key, payload) {
  const url = `/api/jira/issue/${encodeURIComponent(key)}`;
  return requestJson(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ===== Transições de status (Workflow) =====

export async function jiraGetIssueTransitions(key) {
  const url = `/api/jira/issue/${encodeURIComponent(key)}/transitions`;
  return requestJson(url, { method: "GET" });
}

export async function jiraDoIssueTransition(key, transitionId) {
  const url = `/api/jira/issue/${encodeURIComponent(key)}/transitions`;
  return requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transition: { id: String(transitionId) } }),
  });
}

export async function jiraTransitionToStatus(key, statusName) {
  const data = await jiraGetIssueTransitions(key);
  const transitions = Array.isArray(data?.transitions) ? data.transitions : [];

  const wanted = String(statusName || "")
    .trim()
    .toLowerCase();

  const match = transitions.find((t) => {
    const toName = String(t?.to?.name || "")
      .trim()
      .toLowerCase();
    return toName === wanted;
  });

  if (!match) {
    const available = transitions
      .map((t) => t?.to?.name)
      .filter(Boolean)
      .join(", ");

    throw new Error(
      `Transição para "${statusName}" não encontrada. Disponíveis: ${
        available || "—"
      }`
    );
  }

  await jiraDoIssueTransition(key, match.id);
  return match;
}

// util: concorrência limitada
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;

  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return out;
}
