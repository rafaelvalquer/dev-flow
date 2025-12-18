const API_BASE = ""; // mesma origem (proxy do Vite em dev)

export async function getIssue(
  key,
  fields = "summary,subtasks,status,project"
) {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(
      key
    )}?fields=${encodeURIComponent(fields)}`
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getComments(key) {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(key)}/comments`
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createComment(key, body) {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(key)}/comment`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateComment(key, id, body) {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(
      key
    )}/comment/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createSubtask(
  projectId,
  parentKey,
  summary,
  subtaskIssueTypeId = "10007"
) {
  const r = await fetch(`${API_BASE}/api/jira/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      fields: {
        project: { id: projectId },
        parent: { key: parentKey },
        issuetype: { id: subtaskIssueTypeId },
        summary,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Checklist automático: " + summary },
              ],
            },
          ],
        },
      },
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function transitionToDone(issueKey, transitionId = "41") {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ transition: { id: transitionId } }),
    }
  );
  if (!r.ok) throw new Error(await r.text());
  return true;
}

export async function uploadAttachments(ticketKey, files) {
  const form = new FormData();
  files.forEach((f) => form.append("files", f, f.name));
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(ticketKey)}/attachments`,
    { method: "POST", body: form }
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function listAttachments(ticketKey) {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(ticketKey)}/attachments`
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json(); // {attachments: [...]}
}

export function buildDownloadLinks(a) {
  const base = `/api/jira/attachment/${encodeURIComponent(a.id)}`;
  return {
    download: `${base}/download?filename=${encodeURIComponent(
      a.filename || "file"
    )}`,
    inline: `${base}/download?inline=1&filename=${encodeURIComponent(
      a.filename || "file"
    )}`,
  };
}
