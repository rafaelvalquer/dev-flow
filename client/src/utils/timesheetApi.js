// src/utils/timesheetApi.js

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export function getTimesheet(ticketKey) {
  return fetchJson(`/api/tickets/${encodeURIComponent(ticketKey)}/timesheet`);
}

export function upsertTimesheetEntry(ticketKey, payload) {
  return fetchJson(`/api/tickets/${encodeURIComponent(ticketKey)}/timesheet`, {
    method: "PUT",
    body: JSON.stringify(payload || {}),
  });
}

export function setTimesheetEstimate(ticketKey, payload) {
  return fetchJson(
    `/api/tickets/${encodeURIComponent(ticketKey)}/timesheet/estimate`,
    {
      method: "PUT",
      body: JSON.stringify(payload || {}),
    }
  );
}

export function setTimesheetDevelopers(ticketKey, payload) {
  return fetchJson(
    `/api/tickets/${encodeURIComponent(ticketKey)}/timesheet/developers`,
    {
      method: "PUT",
      body: JSON.stringify(payload || {}),
    }
  );
}
