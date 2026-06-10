async function readWorkspaceResponse(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const message =
      body?.error?.message || body?.error || body?.message || `HTTP ${res.status}`;
    throw new Error(message);
  }

  return body;
}

export async function fetchDeveloperWorkspace() {
  const res = await fetch("/api/developer-workspace", {
    credentials: "include",
  });
  const body = await readWorkspaceResponse(res);
  return body.workspace || {};
}

export async function saveDeveloperWorkspacePreferences(payload = {}) {
  const res = await fetch("/api/developer-workspace/preferences", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readWorkspaceResponse(res);
  return body.workspace || {};
}

export async function registerDeveloperRecentTicket(ticketKey, payload = {}) {
  const key = String(ticketKey || "").trim().toUpperCase();
  if (!key) return null;

  const res = await fetch(
    `/api/developer-workspace/recent/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const body = await readWorkspaceResponse(res);
  return body.workspace || {};
}

export async function fetchDeveloperTicketNote(ticketKey) {
  const key = String(ticketKey || "").trim().toUpperCase();
  if (!key) return { text: "", updatedAt: null };

  const res = await fetch(
    `/api/developer-workspace/notes/${encodeURIComponent(key)}`,
    { credentials: "include" },
  );
  const body = await readWorkspaceResponse(res);
  return body.note || { text: "", updatedAt: null };
}

export async function saveDeveloperTicketNote(ticketKey, text) {
  const key = String(ticketKey || "").trim().toUpperCase();
  if (!key) return null;

  const res = await fetch(
    `/api/developer-workspace/notes/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
  const body = await readWorkspaceResponse(res);
  return body.workspace || {};
}

export async function createDeveloperStickyNote(payload = {}) {
  const res = await fetch("/api/developer-workspace/sticky-notes", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readWorkspaceResponse(res);
  return body.workspace || {};
}

export async function updateDeveloperStickyNote(noteId, payload = {}) {
  const id = String(noteId || "").trim();
  if (!id) return null;

  const res = await fetch(
    `/api/developer-workspace/sticky-notes/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const body = await readWorkspaceResponse(res);
  return body.workspace || {};
}

export async function convertDeveloperStickyNoteToJiraComment(noteId) {
  const id = String(noteId || "").trim();
  if (!id) return null;

  const res = await fetch(
    `/api/developer-workspace/sticky-notes/${encodeURIComponent(id)}/jira-comment`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  const body = await readWorkspaceResponse(res);
  return body.workspace || {};
}

export async function deleteDeveloperStickyNote(noteId) {
  const id = String(noteId || "").trim();
  if (!id) return null;

  const res = await fetch(
    `/api/developer-workspace/sticky-notes/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  const body = await readWorkspaceResponse(res);
  return body.workspace || {};
}
