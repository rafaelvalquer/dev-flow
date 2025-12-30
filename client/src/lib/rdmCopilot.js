// client/src/lib/rdmCopilot.js
export async function rdmCopilot({ files, title = "" }) {
  const form = new FormData();
  for (const f of files || []) form.append("files", f, f.name);
  form.append("title", title);

  const r = await fetch("/api/gemini/rdm-copilot", {
    method: "POST",
    body: form,
  });

  if (!r.ok) {
    let msg = "Erro ao chamar Co-pilot.";
    try {
      const data = await r.json();
      msg = data?.details || data?.error || msg;
    } catch {
      msg = (await r.text()) || msg;
    }
    throw new Error(msg);
  }

  return await r.json();
}
