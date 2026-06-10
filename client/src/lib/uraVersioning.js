const JSON_HEADERS = {
  "Content-Type": "application/json",
};

async function readJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        payload?.message ||
        payload?.error ||
        "Não foi possível processar a solicitação.",
    );
  }
  return payload;
}

export async function fetchUras() {
  const response = await fetch("/api/ura-versioning/uras", {
    credentials: "include",
  });
  const payload = await readJsonResponse(response);
  return Array.isArray(payload?.uras) ? payload.uras : [];
}

export async function createUra(data) {
  const response = await fetch("/api/ura-versioning/uras", {
    method: "POST",
    headers: JSON_HEADERS,
    credentials: "include",
    body: JSON.stringify(data || {}),
  });
  const payload = await readJsonResponse(response);
  return payload?.ura;
}

export async function updateUra(id, data) {
  const response = await fetch(`/api/ura-versioning/uras/${id}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    credentials: "include",
    body: JSON.stringify(data || {}),
  });
  const payload = await readJsonResponse(response);
  return payload?.ura;
}

export async function deleteUra(id) {
  const response = await fetch(`/api/ura-versioning/uras/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  const payload = await readJsonResponse(response);
  return payload?.ura;
}

export async function fetchUraVersions(uraId) {
  const response = await fetch(`/api/ura-versioning/uras/${uraId}/versions`, {
    credentials: "include",
  });
  const payload = await readJsonResponse(response);
  return Array.isArray(payload?.versions) ? payload.versions : [];
}

export async function createUraVersion(uraId, data) {
  const response = await fetch(`/api/ura-versioning/uras/${uraId}/versions`, {
    method: "POST",
    headers: JSON_HEADERS,
    credentials: "include",
    body: JSON.stringify(data || {}),
  });
  const payload = await readJsonResponse(response);
  return payload?.version;
}

export async function updateUraVersion(versionId, data) {
  const response = await fetch(`/api/ura-versioning/versions/${versionId}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    credentials: "include",
    body: JSON.stringify(data || {}),
  });
  const payload = await readJsonResponse(response);
  return payload?.version;
}

export async function deleteUraVersion(versionId) {
  const response = await fetch(`/api/ura-versioning/versions/${versionId}`, {
    method: "DELETE",
    credentials: "include",
  });
  const payload = await readJsonResponse(response);
  return payload?.version;
}
