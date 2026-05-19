async function readAuthResponse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      body?.error?.message || body?.error || body?.message || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body;
}

export async function fetchCurrentUser() {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  const body = await readAuthResponse(res);
  return body.user || null;
}

export async function loginUser({ email, password, rememberMe = false }) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, rememberMe }),
  });
  const body = await readAuthResponse(res);
  return body.user;
}

export async function registerUser({ email, password, jiraApiToken }) {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, jiraApiToken }),
  });
  const body = await readAuthResponse(res);
  return body.user;
}

export async function logoutUser() {
  const res = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  await readAuthResponse(res);
}

export async function updatePassword({ currentPassword, newPassword }) {
  const res = await fetch("/api/auth/password", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const body = await readAuthResponse(res);
  return body.user;
}

export async function updateJiraToken({ currentPassword, jiraApiToken }) {
  const res = await fetch("/api/auth/jira-token", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, jiraApiToken }),
  });
  const body = await readAuthResponse(res);
  return body.user;
}

export async function updateProfile({ name }) {
  const res = await fetch("/api/auth/profile", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = await readAuthResponse(res);
  return body.user;
}

export async function updateJiraUser(jiraUser = {}) {
  const res = await fetch("/api/auth/jira-user", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: jiraUser.accountId || "",
      displayName: jiraUser.displayName || "",
      emailAddress: jiraUser.emailAddress || "",
      avatarUrl: jiraUser.avatarUrl || "",
    }),
  });
  const body = await readAuthResponse(res);
  return body.user;
}

export async function testJiraStatus() {
  const res = await fetch("/api/auth/jira-status", {
    credentials: "include",
  });
  return await readAuthResponse(res);
}

export async function updatePreferences(preferences) {
  const res = await fetch("/api/auth/preferences", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferences }),
  });
  const body = await readAuthResponse(res);
  return body.user;
}
