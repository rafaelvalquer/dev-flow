// src/utils/gmudUtils.js
import { adfToPlainText } from "../lib/adf";

/* ---------- Constantes ---------- */
export const CHECKBOX_IDS = [
  "dev1",
  "dev2",
  "dev3",
  "dev4",
  "dev5",
  "dev6",
  "qa1",
  "qa2",
  "qa3",
  "qa4",
  "qa5",
  "homo1",
  "homo2",
  "impl1",
  "impl2",
  "impl3",
  "pos1",
  "pos2",
];

export const LABELS = {
  dev1: "Manual de boas práticas aplicado",
  dev2: "Testes de API (sucesso e erro)",
  dev3: "Testes de fluxo completos",
  dev4: "CDR Validado",
  dev5: "Documentação criada",
  dev6: "Documento GMUD preenchido",
  qa1: "Documentação recebida",
  qa2: "Casos de teste elaborados",
  qa3: "Testes executados e evidenciados",
  qa4: "Relatório enviado ao Desenvolvedor e GP",
  qa5: "Indicadores atualizados",
  homo1: "Testes acompanhados pelo solicitante",
  homo2: "'De acordo' para GMUD obtido do solicitante",
  impl1: "Implantação acompanhada com suporte",
  impl2: "OS e GMUD registradas no painel",
  impl3: "Validação implantação concluída",
  pos1: "Certificação do solicitante",
  pos2: "Indicadores acompanhados",
};

export const PHASES = [
  {
    key: "dev",
    title: "Desenvolvimento",
    icon: "fas fa-code",
    ids: ["dev1", "dev2", "dev3", "dev4", "dev5", "dev6"],
  },
  {
    key: "qa",
    title: "QA",
    icon: "fas fa-vial",
    ids: ["qa1", "qa2", "qa3", "qa4", "qa5"],
  },
  {
    key: "homo",
    title: "Homologação",
    icon: "fas fa-users",
    ids: ["homo1", "homo2"],
  },
  {
    key: "impl",
    title: "Implantação",
    icon: "fas fa-rocket",
    ids: ["impl1", "impl2", "impl3"],
  },
  {
    key: "pos",
    title: "Pós-Implantação",
    icon: "fas fa-chart-line",
    ids: ["pos1", "pos2"],
  },
];

export const SCRIPTS_TAG = "[Scripts alterados]";
export const VARS_TAG = "[Variáveis de ambiente]";

export const STORAGE_KEY = "checklist_gmud_vite";
export const CONFIG_KEY = "checklist_gmud_config";
export const TAB_KEY = "checklist_gmud_activeTab";
export const RDM_KEY = "checklist_gmud_rdm";

/* ---------- Utils (puras) ---------- */
export function buildEmptyCheckboxes() {
  return Object.fromEntries(CHECKBOX_IDS.map((id) => [id, false]));
}

export function normalizeVarsText(str) {
  const lines = String(str || "")
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/\s*\|\s*/g, " | ")
        .replace(/\s*=\s*/g, " = ")
        .trimEnd()
    );

  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n").trim();
}

export function adfSafeToText(adf) {
  try {
    const t = adfToPlainText(adf || {});
    if (t && t.trim()) return t.trim();
  } catch {}

  // Fallbacks comuns do ADF do Jira
  try {
    return String(
      adf?.content?.[0]?.content?.text ??
        adf?.content?.[0]?.content?.[0]?.text ??
        ""
    ).trim();
  } catch {
    return "";
  }
}

export function parseSummaryToFields(summary) {
  if (typeof summary !== "string") return null;

  const SEP = /\s*[-–—]+\s*/;
  const m = summary.match(/^\s*(OS\d+)\s*[-–—]*\s*(.+)$/i);
  if (!m) return null;

  const os = m[1];
  let rest = m[2].trim();
  let projectTag = "";

  const proj = rest.match(/^\[([^\]]+)\]\s*[-–—]*\s*(.*)$/);
  if (proj) {
    projectTag = `[${proj[1].trim()}]`;
    rest = (proj[2] || "").trim();
  }

  let firstChunk = (rest.split(SEP)[0] || "").split("(")[0].trim();
  if (!firstChunk) firstChunk = rest.split("(")[0].trim();

  const checklist =
    projectTag && firstChunk
      ? `${projectTag} - ${firstChunk}`
      : projectTag || firstChunk || "";

  return { os, checklist };
}

export function computePending(rows, baselineSet) {
  const next = rows.map((r) => {
    const canon = normalizeVarsText(`${r.ambiente} | ${r.nome} = ${r.valor}`);
    const isEmpty = !canon;
    return { ...r, pendente: !isEmpty && !baselineSet.has(canon) };
  });

  const any = next.some((r) => r.pendente);
  return { next, any };
}

export function getChecklistItems() {
  return CHECKBOX_IDS.map((id) => ({ id, summary: LABELS[id] || id }));
}

export function findTaggedComment(payload, tag) {
  const comments = payload?.comments || [];
  for (const c of comments) {
    const plain = adfToPlainText(c.body || {});
    if (plain.trim().startsWith(tag)) {
      const textSemTag = plain.trim().slice(tag.length).trimStart();
      return { found: true, id: c.id, textSemTag };
    }
  }
  return { found: false, id: null, textSemTag: "" };
}

export function renderChavesFromText(text) {
  const lines = normalizeVarsText(text).split("\n").filter(Boolean);

  return lines.map((line) => {
    const m = line.match(/^([^|]+)\s\|\s([^=]+)\s=\s(.+)$/);
    if (m) {
      return {
        id: crypto.randomUUID(),
        ambiente: m[1].trim(),
        nome: m[2].trim(),
        valor: m[3].trim(),
        pendente: false,
      };
    }

    return {
      id: crypto.randomUUID(),
      ambiente: "",
      nome: line.trim(),
      valor: "",
      pendente: false,
    };
  });
}

export function buildVarsText(chaves) {
  const lines = (chaves || [])
    .map((r) =>
      `${r.ambiente || ""} | ${r.nome || ""} = ${r.valor || ""}`.trim()
    )
    .filter(
      (l) =>
        l !== " |  = " && l !== "|  =" && l.replace(/[|=]/g, "").trim() !== ""
    );

  return normalizeVarsText(lines.join("\n"));
}

export function calcGeralPct(checkboxes) {
  const total = CHECKBOX_IDS.length;
  const done = CHECKBOX_IDS.reduce(
    (a, id) => a + (checkboxes?.[id] ? 1 : 0),
    0
  );
  return Math.round((done / total) * 100) || 0;
}

export function calcPhasePct(ids, checkboxes) {
  const total = ids.length || 1;
  const done = ids.reduce((a, id) => a + (checkboxes?.[id] ? 1 : 0), 0);
  return Math.round((done / total) * 100) || 0;
}

export const DONE_STATUS_NAMES = [
  "concluído",
  "concluido",
  "done",
  "resolved",
  "closed",
  "finalizado",
  "finalizada",
];

// Aceita:
// - string (nome do status)
// - objeto { status, statusCategory }
// - objeto Jira salvo no subtasksBySummary
export function isDoneSubtask(st) {
  const cat = String(st?.statusCategory || "")
    .trim()
    .toLowerCase();
  if (cat === "done") return true;

  const name =
    typeof st === "string" ? st : String(st?.status || st?.name || "").trim();

  const s = name.toLowerCase();
  return DONE_STATUS_NAMES.includes(s);
}

export const PHASE_INDEX_BY_ID = PHASES.reduce((acc, p, idx) => {
  (p.ids || []).forEach((id) => (acc[id] = idx));
  return acc;
}, {});

export function getChecklistItemsForPhase(phaseIdxOrKey) {
  const phase =
    typeof phaseIdxOrKey === "number"
      ? PHASES[phaseIdxOrKey]
      : PHASES.find((p) => p.key === phaseIdxOrKey);

  if (!phase) return [];

  return (phase.ids || []).map((id) => ({
    id,
    summary: (LABELS[id] || id).trim(),
  }));
}

// Retorna o índice da fase "atual" (primeira fase NÃO concluída).
// Se todas concluídas => PHASES.length
export function computeUnlockedPhaseIdx(subtasksBySummary) {
  for (let i = 0; i < PHASES.length; i++) {
    const phase = PHASES[i];
    const allDone = (phase.ids || []).every((id) => {
      const summary = (LABELS[id] || id).trim().toLowerCase();
      const st = subtasksBySummary?.[summary];
      return st && isDoneSubtask(st);
    });

    if (!allDone) return i;
  }
  return PHASES.length;
}
