// src/utils/cronograma.js
import { adfCellText } from "../lib/adf";

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
  const m = token.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : now.getFullYear();

  const dt = new Date(y, mo - 1, d);
  const diffDays = Math.floor((dt - now) / (1000 * 60 * 60 * 24));
  if (!m[3] && diffDays < -180) {
    y += 1;
    return new Date(y, mo - 1, d);
  }

  return dt;
}

export function parseDateRangeBR(raw, now = new Date()) {
  const v = (raw || "").trim();
  if (!v) return null;

  const range = v.match(/^(.+?)\s+a\s+(.+?)$/i);
  if (range) {
    const start = parseBRDateToken(range[1], now);
    const end = parseBRDateToken(range[2], now);
    if (!start || !end) return null;

    const hasYearLeft = /\d{4}/.test(range[1]);
    const hasYearRight = /\d{4}/.test(range[2]);

    if (+end < +start && !hasYearLeft && !hasYearRight) {
      const fixedEnd = new Date(end);
      fixedEnd.setFullYear(start.getFullYear() + 1);
      return { kind: "range", start, end: fixedEnd };
    }

    if (hasYearLeft && !hasYearRight) {
      const fixedEnd = new Date(end);
      fixedEnd.setFullYear(start.getFullYear());
      if (+fixedEnd < +start) fixedEnd.setFullYear(start.getFullYear() + 1);
      return { kind: "range", start, end: fixedEnd };
    }

    if (!hasYearLeft && hasYearRight) {
      const fixedStart = new Date(start);
      fixedStart.setFullYear(end.getFullYear());
      return { kind: "range", start: fixedStart, end };
    }

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

function normalizeKey(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIdFromName(name) {
  const v = normalizeKey(name)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return v || "atividade";
}

const ATIVIDADES_MAP = new Map(
  ATIVIDADES_PADRAO.map((a) => [normalizeKey(a.name), a])
);

function toYMDLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseRiscoFlag(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return false;
  if (/(nao|não|false|0|no)/i.test(s)) return false;
  return true;
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
  if (!adf || typeof adf !== "object") return [];

  const table = findFirstTable(adf);
  if (!table) return [];

  const rows = Array.isArray(table?.content) ? table.content : [];
  if (!rows.length) return [];

  const bodyRows = rows.slice(1);
  const list = [];
  const usedIds = new Map();

  for (const row of bodyRows) {
    const cells = Array.isArray(row?.content) ? row.content : [];
    const getCellText = (cell) => {
      try {
        return String(adfCellText(cell) || "").trim();
      } catch {
        return "";
      }
    };

    const atividadeName = getCellText(cells[0]);
    const dateText = getCellText(cells[1]);
    const recursoText = getCellText(cells[2]);
    const areaText = getCellText(cells[3]);
    const riscoText = getCellText(cells[4]);

    const labelRaw = String(atividadeName || "");
    const label = labelRaw.split("(")[0].trim();
    const atividadeKey = String(label || "").trim();
    const atividadeDef = ATIVIDADES_MAP.get(normalizeKey(atividadeKey));
    const baseId = atividadeDef?.id || normalizeIdFromName(atividadeKey);
    const seen = usedIds.get(baseId) || 0;
    const id = seen === 0 ? baseId : `${baseId}_${seen + 1}`;
    usedIds.set(baseId, seen + 1);
    const riskFlag = parseRiscoFlag(riscoText);

    list.push({
      id,
      name: atividadeDef?.name || label || atividadeKey || "—",
      data: String(dateText || "")
        .replace(/\s+/g, " ")
        .trim(),
      recurso: recursoText || "Sem recurso",
      area: areaText || "—",
      risco: riskFlag ? "Risco" : "",
      risk: riskFlag,
    });
  }

  return list;
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
  const headerRow = {
    type: "tableRow",
    content: [
      { type: "tableHeader", content: [textCell("Atividade")] },
      { type: "tableHeader", content: [textCell("Data")] },
      { type: "tableHeader", content: [textCell("Recurso")] },
      { type: "tableHeader", content: [textCell("Área")] },
      { type: "tableHeader", content: [textCell("Risco")] },
    ],
  };

  const bodyRows = (atividades || []).map((a) => {
    const riskFlag = Boolean(a?.risk) || parseRiscoFlag(a?.risco);
    const riscoCell = riskFlag ? "Risco" : "";

    return {
      type: "tableRow",
      content: [
        { type: "tableCell", content: [textCell(a.name)] },
        { type: "tableCell", content: [textCell(a.data || "")] },
        { type: "tableCell", content: [textCell(a.recurso || "")] },
        { type: "tableCell", content: [textCell(a.area || "")] },
        { type: "tableCell", content: [textCell(riscoCell)] },
      ],
    };
  });

  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "table",
        attrs: {
          isNumberColumnEnabled: false,
          layout: "default",
        },
        content: [headerRow, ...bodyRows],
      },
    ],
  };
}

export function toCalendarEvents(issueKey, atividades, now = new Date()) {
  const events = [];

  for (const [index, a] of (atividades || []).entries()) {
    const parsed = parseDateRangeBR(a.data, now);
    if (!parsed) continue;

    const start = new Date(
      parsed.start.getFullYear(),
      parsed.start.getMonth(),
      parsed.start.getDate()
    );

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
      id: `${issueKey}::${a.id || index}`,
      title: `${issueKey} - ${a.name}`,
      start: toYMDLocal(start),
      end: toYMDLocal(endExclusive),
      allDay: true,
      extendedProps: {
        issueKey,
        activityId: a.id || `atividade_${index + 1}`,
        activityName: a.name,
        recurso: a.recurso || "",
        area: a.area || "",
        risco: a.risco || "",
        risk: Boolean(a.risk || a.risco),
      },
    });
  }

  return events;
}
