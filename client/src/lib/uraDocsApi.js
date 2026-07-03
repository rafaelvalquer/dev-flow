async function readJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        payload?.message ||
        payload?.error ||
        "Nao foi possivel processar a solicitacao."
    );
  }
  return payload;
}

export async function fetchUraDocsHealth() {
  const response = await fetch("/api/ura-docs/health", {
    credentials: "include",
    cache: "no-store",
  });
  return readJsonResponse(response);
}

export async function createUraDocsJob({ niceFile, audioFiles, audioZip, projectName, options }) {
  const form = new FormData();
  form.append("nice_file", niceFile);
  for (const file of audioFiles || []) {
    form.append("audio_files", file);
  }
  if (audioZip) form.append("audio_zip", audioZip);
  form.append("project_name", projectName || "");
  form.append("options", JSON.stringify(options || {}));

  const response = await fetch("/api/ura-docs/jobs", {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return readJsonResponse(response);
}

export async function fetchUraDocsJob(jobId) {
  const response = await fetch(`/api/ura-docs/jobs/${jobId}`, {
    credentials: "include",
    cache: "no-store",
  });
  return readJsonResponse(response);
}

export async function fetchUraDocsResult(jobId) {
  const response = await fetch(`/api/ura-docs/jobs/${jobId}/result`, {
    credentials: "include",
    cache: "no-store",
  });
  return readJsonResponse(response);
}

export function uraDocsDownloadUrl(jobId, kind) {
  return `/api/ura-docs/jobs/${jobId}/download/${kind}`;
}
