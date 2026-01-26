import { adfSafeToText } from "../utils/gmudUtils";

const EVIDENCE_TAG_RE = /\[GMUD\s*Evid[eê]ncia\s*-\s*([^\]]+)\]/i;

export function evidenceTag(stepKey) {
  return `[GMUD Evidência - ${String(stepKey || "").trim()}]`;
}

export function parseEvidenceStepKeyFromText(text) {
  const m = EVIDENCE_TAG_RE.exec(String(text || ""));
  return m?.[1] ? String(m[1]).trim() : "";
}

export function parseEvidenceFilesFromText(textSemTag) {
  const lines = String(textSemTag || "").split(/\r?\n/);
  const files = [];

  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("-")) continue;

    // "- arquivo.ext • 23/01/2026 12:00 • https://..."
    const rest = t.replace(/^-+\s*/, "");
    const parts = rest
      .split("•")
      .map((p) => p.trim())
      .filter(Boolean);

    const filename = parts[0] || rest;
    const when = parts[1] || "";
    const url = parts[2] || "";

    files.push({ filename, when, url });
  }
  return files;
}

export function mergeEvidenceFiles(existing = [], incoming = []) {
  const out = [...existing];
  const seen = new Set(out.map((f) => `${f.filename}|${f.url || ""}`));

  for (const f of incoming) {
    const key = `${f.filename}|${f.url || ""}`;
    if (seen.has(key)) continue;

    // fallback: se não tiver url, dedupa pelo nome
    if (!f.url && out.some((x) => x.filename === f.filename)) continue;

    seen.add(key);
    out.push(f);
  }
  return out;
}

export function buildEvidenceCommentText({
  stepTitle,
  files,
  updatedAt,
  author,
}) {
  const lines = [];

  if (stepTitle) lines.push(`Step: ${stepTitle}`);
  lines.push("Arquivos:");

  for (const f of files || []) {
    const bits = [f.filename];
    if (f.when) bits.push(f.when);
    if (f.url) bits.push(f.url);
    lines.push(`- ${bits.join(" • ")}`);
  }

  if (author) lines.push(`Enviado por: ${author}`);
  if (updatedAt) lines.push(`Atualizado em: ${updatedAt}`);

  return lines.join("\n");
}

export function extractEvidenceByStepFromCommentsPayload(payload) {
  const arr =
    payload?.comments ||
    payload?.comments?.comments ||
    payload?.values ||
    payload?.comment?.comments ||
    [];

  const list = Array.isArray(arr) ? arr : [];
  const out = {};

  for (const c of list) {
    const fullText = String(adfSafeToText(c?.body) || "").trim();
    if (!fullText) continue;

    const stepKey = parseEvidenceStepKeyFromText(fullText);
    if (!stepKey) continue;

    const semTag = fullText.replace(EVIDENCE_TAG_RE, "").trim();

    out[stepKey] = {
      commentId: c?.id || null,
      rawText: fullText,
      textSemTag: semTag,
      files: parseEvidenceFilesFromText(semTag),
    };
  }

  return out;
}

export function summarizeEvidenceCounts(evidenceByStep) {
  const out = {};
  for (const [k, v] of Object.entries(evidenceByStep || {})) {
    out[k] = (v?.files || []).length;
  }
  return out;
}
