async function readDiagnosticResponse(response) {
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

export async function fetchSystemDiagnostics() {
  const response = await fetch("/health/system", {
    credentials: "include",
  });
  return readDiagnosticResponse(response);
}
