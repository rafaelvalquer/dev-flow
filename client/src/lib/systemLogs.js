async function readLogsResponse(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        payload?.message ||
        payload?.error ||
        `HTTP ${response.status}`,
    );
  }

  return payload;
}

export async function fetchSystemLogs({ lines = 200 } = {}) {
  const params = new URLSearchParams({
    lines: String(lines),
  });

  const response = await fetch(`/health/logs?${params.toString()}`, {
    credentials: "include",
  });

  return readLogsResponse(response);
}
