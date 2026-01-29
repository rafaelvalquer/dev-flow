// server/utils/cronogramaParser.js

// Mantém IDs padronizados iguais ao front (seu cronograma.js)
export const ATIVIDADES_PADRAO = [
  { id: "devUra", name: "Desenvolvimento de URA" },
  { id: "rdm", name: "Preenchimento RDM" },
  { id: "gmud", name: "Aprovação GMUD" },
  { id: "hml", name: "Homologação" },
  { id: "deploy", name: "Implantação" },
];

function normalizeKey(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIdFromName(name) {
  const v = normalizeKey(name)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return v || "—";
}

const ATIVIDADES_MAP = new Map(
  ATIVIDADES_PADRAO.map((a) => [normalizeKey(a.name), a])
);

function parseRiscoFlag(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return false;
  if (/(nao|não|false|0|no)/i.test(s)) return false;
  return true;
}

function adfText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;

  if (Array.isArray(node)) return node.map(adfText).join("");

  if (node.type === "text") return String(node.text || "");

  const content = node.content;
  if (Array.isArray(content)) return content.map(adfText).join("");

  return "";
}

function findFirstTable(adf) {
  function walk(node) {
    if (!node) return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const t = walk(n);
        if (t) return t;
      }
      return null;
    }
    if (node.type === "table") return node;
    if (node.content) return walk(node.content);
    return null;
  }
  return walk(adf);
}

// adicione/garanta exports no server/utils/cronogramaParser.js

export function toYMDLocal(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateRangeBR(text, base = new Date()) {
  const s = String(text || "").trim();
  if (!s) return null;

  // captura 1 ou 2 datas no formato dd/mm(/aaaa)?
  const matches = [...s.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)].map(
    (m) => ({
      d: Number(m[1]),
      mo: Number(m[2]),
      yRaw: m[3] ? Number(m[3]) : null,
    })
  );

  if (!matches.length) return null;

  const normalizeYear = (y) => {
    if (!y) return base.getFullYear();
    if (y < 100) return 2000 + y; // 26 -> 2026
    return y;
  };

  const a = matches[0];
  const b = matches[1] || matches[0];

  const y1 = normalizeYear(a.yRaw);
  const y2 = normalizeYear(b.yRaw ?? a.yRaw);

  const start = new Date(y1, a.mo - 1, a.d, 0, 0, 0, 0);
  const end = new Date(y2, b.mo - 1, b.d, 23, 59, 59, 999);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  // se vier invertido, normaliza
  if (end < start) return { start: end, end: start };

  return { start, end };
}

export function parseCronogramaADF(adf) {
  if (!adf || typeof adf !== "object") return [];

  const table = findFirstTable(adf);
  if (!table) return [];

  const rows = Array.isArray(table?.content) ? table.content : [];
  if (!rows.length) return [];

  const bodyRows = rows.slice(1);
  const list = [];

  for (const row of bodyRows) {
    const cells = Array.isArray(row?.content) ? row.content : [];

    const getCellText = (cell) => adfText(cell).replace(/\s+/g, " ").trim();

    const atividadeName = getCellText(cells[0]);
    const dateText = getCellText(cells[1]);
    const recursoText = getCellText(cells[2]);
    const areaText = getCellText(cells[3]);
    const riscoText = getCellText(cells[4]);

    const labelRaw = String(atividadeName || "");
    const label = labelRaw.split("(")[0].trim();
    const atividadeDef = ATIVIDADES_MAP.get(normalizeKey(label));
    const riskFlag = parseRiscoFlag(riscoText);

    list.push({
      id: atividadeDef?.id || normalizeIdFromName(label),
      name: atividadeDef?.name || label || "—",
      data: String(dateText || "")
        .replace(/\s+/g, " ")
        .trim(),
      recurso: recursoText || "Sem recurso",
      area: areaText || "—",
      risco: riskFlag ? "Risco" : "",
      risk: riskFlag,
    });
  }

  // garante todas atividades padrão
  const byId = new Map(list.map((a) => [a.id, a]));
  for (const def of ATIVIDADES_PADRAO) {
    if (!def?.id) continue;
    if (byId.has(def.id)) continue;

    const empty = {
      id: def.id,
      name: def.name,
      data: "",
      recurso: "Sem recurso",
      area: "—",
      risco: "",
      risk: false,
    };

    list.push(empty);
    byId.set(empty.id, empty);
  }

  return list;
}
