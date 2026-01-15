// src/utils/cronograma.js
import { adfCellText } from "../lib/adf";

// atividades padronizadas
export const ATIVIDADES_PADRAO = [
  { id: "devUra", name: "Desenvolvimento de URA" },
  { id: "rdm", name: "Preenchimento RDM" },
  { id: "gmud", name: "Aprovação GMUD" },
  { id: "hml", name: "Homologação" },
  { id: "deploy", name: "Implantação" },
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseBRDateToken(token, now = new Date()) {
  // suporta DD/MM ou DD/MM/YYYY
  const m = token.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : now.getFullYear();

  // heurística simples: se cair “muito no passado”, joga pro próximo ano
  const dt = new Date(y, mo - 1, d);
  const diffDays = Math.floor((dt - now) / (1000 * 60 * 60 * 24));
  if (!m[3] && diffDays < -180) {
    y = y + 1;
    return new Date(y, mo - 1, d);
  }

  return dt;
}

export function parseDateRangeBR(raw, now = new Date()) {
  const v = (raw || "").trim();
  if (!v) return null;

  // "DD/MM a DD/MM" (com ou sem ano)
  const range = v.match(/^(.+?)\s+a\s+(.+?)$/i);
  if (range) {
    const start = parseBRDateToken(range[1], now);
    const end = parseBRDateToken(range[2], now);
    if (!start || !end) return null;
    return { kind: "range", start, end };
  }

  const single = parseBRDateToken(v, now);
  if (!single) return null;
  return { kind: "single", start: single, end: single };
}

export function formatDateRangeBR(start, end) {
  if (!start) return "";
  const s = `${pad2(start.getDate())}/${pad2(start.getMonth() + 1)}`;

  if (!end || +end === +start) return s;

  const e = `${pad2(end.getDate())}/${pad2(end.getMonth() + 1)}`;
  return `${s} a ${e}`;
}

function normalizeHeader(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
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

export function parseCronogramaADF(adf) {
  if (!adf) return null;

  const table = findFirstTable(adf);
  if (!table || !Array.isArray(table.content) || table.content.length === 0)
    return null;

  const rows = table.content; // tableRow[]
  if (!rows.length) return null;

  // header
  const headerCells = rows[0]?.content || [];
  const headers = headerCells.map((c) => normalizeHeader(adfCellText(c)));

  const idxAtividade = headers.findIndex((h) => h.includes("atividade"));
  const idxData = headers.findIndex((h) => h === "data" || h.includes("data"));
  const idxRecurso = headers.findIndex((h) => h.includes("recurso"));
  const idxArea = headers.findIndex((h) => h.includes("area"));

  // fallback esperado: [Atividade, Data, Recurso, Área]
  const ia = idxAtividade >= 0 ? idxAtividade : 0;
  const id = idxData >= 0 ? idxData : 1;
  const ir = idxRecurso >= 0 ? idxRecurso : 2;
  const ii = idxArea >= 0 ? idxArea : 3;

  const list = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]?.content || [];
    const atividade = adfCellText(cells[ia]);
    const data = adfCellText(cells[id]);
    const recurso = adfCellText(cells[ir]);
    const area = adfCellText(cells[ii]);

    if (!atividade && !data && !recurso && !area) continue;

    const def = ATIVIDADES_PADRAO.find((x) => x.name === atividade);
    list.push({
      id: def?.id || atividade || `row_${r}`,
      name: atividade || def?.name || `Atividade ${r}`,
      data,
      recurso,
      area,
    });
  }

  // garante ordem padrao (se existirem)
  const byId = new Map(list.map((a) => [a.id, a]));
  const ordered = [];
  for (const def of ATIVIDADES_PADRAO) {
    if (byId.has(def.id)) ordered.push(byId.get(def.id));
  }
  // extras
  for (const a of list) {
    if (!ATIVIDADES_PADRAO.some((d) => d.id === a.id)) ordered.push(a);
  }

  return ordered;
}

function textCell(text) {
  return {
    type: "paragraph",
    content: text
      ? [{ type: "text", text: String(text) }]
      : [{ type: "text", text: "" }],
  };
}

export function buildCronogramaADF(atividades) {
  // tabela padrão: Atividade | Data | Recurso | Área
  const headerRow = {
    type: "tableRow",
    content: [
      { type: "tableHeader", content: [textCell("Atividade")] },
      { type: "tableHeader", content: [textCell("Data")] },
      { type: "tableHeader", content: [textCell("Recurso")] },
      { type: "tableHeader", content: [textCell("Área")] },
    ],
  };

  const bodyRows = (atividades || []).map((a) => ({
    type: "tableRow",
    content: [
      { type: "tableCell", content: [textCell(a.name)] },
      { type: "tableCell", content: [textCell(a.data || "")] },
      { type: "tableCell", content: [textCell(a.recurso || "")] },
      { type: "tableCell", content: [textCell(a.area || "")] },
    ],
  }));

  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "table",
        attrs: { isNumberColumnEnabled: false, layout: "default" },
        content: [headerRow, ...bodyRows],
      },
    ],
  };
}

export function toCalendarEvents(issueKey, atividades, now = new Date()) {
  const events = [];

  for (const a of atividades || []) {
    const parsed = parseDateRangeBR(a.data, now);
    if (!parsed) continue;

    const start = new Date(
      parsed.start.getFullYear(),
      parsed.start.getMonth(),
      parsed.start.getDate()
    );

    // FullCalendar all-day: end é EXCLUSIVO
    const inclusiveEnd = parsed.end
      ? new Date(
          parsed.end.getFullYear(),
          parsed.end.getMonth(),
          parsed.end.getDate()
        )
      : start;

    const endExclusive = new Date(inclusiveEnd);
    endExclusive.setDate(endExclusive.getDate() + 1);

    events.push({
      id: `${issueKey}::${a.id}`,
      title: `${issueKey} - ${a.name}`,
      start: start.toISOString().slice(0, 10),
      end: endExclusive.toISOString().slice(0, 10),
      allDay: true,
      extendedProps: {
        issueKey,
        activityId: a.id,
        activityName: a.name, // ✅ novo (necessário p/ filtro + legenda)
      },
    });
  }

  return events;
}
