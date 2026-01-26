function fmtDueDate(yyyyMmDd) {
  if (!yyyyMmDd) return "";
  const [y, m, d] = String(yyyyMmDd).slice(0, 10).split("-");
  if (!y || !m || !d) return String(yyyyMmDd);
  return `${d}/${m}/${y}`;
}

function excerptLines(text, maxLines = 18, maxChars = 2400) {
  const raw = String(text || "").trim();
  if (!raw) return "—";
  const lines = raw.split(/\r?\n/).slice(0, maxLines);
  let out = lines.join("\n");
  if (out.length > maxChars) out = out.slice(0, maxChars) + "…";
  if (raw.split(/\r?\n/).length > maxLines) out += "\n…";
  return out;
}

function groupVarsByEnv(chaves = []) {
  const map = new Map();
  for (const r of chaves) {
    const env = String(r?.ambiente || "").trim() || "—";
    const name = String(r?.nome || "").trim();
    if (!name) continue;
    if (!map.has(env)) map.set(env, new Set());
    map.get(env).add(name);
  }
  return map;
}

export function buildGmudFinalSummary({
  nomeProjeto,
  numeroGMUD,
  ticketJira,
  dataLimite,
  ticketSideInfo,
  scriptsAlterados,
  chaves,
  attachmentsCount,
  evidenceCountsByStep,
  workflow,
}) {
  const now = new Date().toLocaleString("pt-BR");

  const responsavel = ticketSideInfo?.responsavel || "—";
  const relator = ticketSideInfo?.relator || "—";
  const status = ticketSideInfo?.status || "—";
  const prioridade = ticketSideInfo?.prioridade || "—";

  const dirs = (ticketSideInfo?.diretorias || []).filter(Boolean);
  const comps = (ticketSideInfo?.componentes || []).filter(Boolean);

  const varsByEnv = groupVarsByEnv(chaves);
  const wf = Array.isArray(workflow) ? workflow : [];

  const evidenceLines = [];
  for (const s of wf) {
    const k = s?.key;
    if (!k) continue;
    const count = Number(evidenceCountsByStep?.[k] || 0);
    evidenceLines.push(`- ${s?.title || k}: ${count}`);
  }

  const varsLines = [];
  if (varsByEnv.size === 0) {
    varsLines.push("—");
  } else {
    for (const [env, namesSet] of varsByEnv.entries()) {
      const names = Array.from(namesSet).sort((a, b) => a.localeCompare(b));
      varsLines.push(`- ${env}: ${names.join(", ")}`);
    }
  }

  const body = [
    `${"Projeto:"} ${String(nomeProjeto || "").trim() || "—"}`,
    `${"OS/GMUD:"} ${String(numeroGMUD || "").trim() || "—"}`,
    `${"Ticket:"} ${String(ticketJira || "").trim() || "—"}`,
    `${"Data limite:"} ${dataLimite ? fmtDueDate(dataLimite) : "—"}`,
    "",
    `Responsável: ${responsavel}`,
    `Relator: ${relator}`,
    `Status: ${status}`,
    `Prioridade: ${prioridade}`,
    `Diretorias: ${dirs.length ? dirs.join(", ") : "—"}`,
    `Componentes: ${comps.length ? comps.join(", ") : "—"}`,
    "",
    "Progresso final: 100%",
    "",
    "Scripts alterados (trecho):",
    "```",
    excerptLines(scriptsAlterados),
    "```",
    "",
    "Variáveis (nomes por ambiente):",
    ...varsLines,
    "",
    `Evidências (anexos no Jira): ${Number(attachmentsCount || 0)}`,
    "Evidências por step:",
    ...(evidenceLines.length ? evidenceLines : ["—"]),
    "",
    `Timestamp: ${now}`,
  ].join("\n");

  return body;
}
