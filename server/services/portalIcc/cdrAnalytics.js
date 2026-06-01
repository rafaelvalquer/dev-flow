function cleanValue(value) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "null") return "";
  return text;
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toUpperCase();
}

function parseCsvRows(text, delimiter = ";") {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  const source = String(text || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((item) => String(item || "").trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell || row.length) {
    row.push(cell);
    if (row.some((item) => String(item || "").trim())) rows.push(row);
  }

  return rows;
}

function rowsToObjects(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0].map(normalizeHeader);
  const objects = rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = cleanValue(row[index]);
    });
    return item;
  });

  return { headers, rows: objects };
}

function toNumber(value) {
  const text = cleanValue(value).replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function normalizeAni(value) {
  let digits = cleanValue(value).replace(/\D/g, "");
  if (digits.startsWith("0055")) digits = digits.slice(4);
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  return digits;
}

function increment(map, key, amount = 1) {
  const safeKey = cleanValue(key) || "NAO INFORMADO";
  map.set(safeKey, (map.get(safeKey) || 0) + amount);
}

function topFromMap(map, limit = 15) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function topDnaFromMap(map, limit = 15) {
  return [...map.entries()]
    .map(([dna, payload]) => {
      const topDescription =
        [...payload.descriptions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
        "";
      return {
        dna,
        label: dna,
        count: payload.count,
        scriptPointDesc: topDescription,
      };
    })
    .sort((a, b) => b.count - a.count || a.dna.localeCompare(b.dna))
    .slice(0, limit);
}

function phoneTypeFromAni(ani) {
  if (ani.length === 11) return "Movel";
  if (ani.length === 10) return "Fixo";
  return "Indefinido";
}

export function analyzeCdrCsv(csvText, options = {}) {
  const { headers, rows } = rowsToObjects(csvText);
  const dddCounts = new Map();
  const phoneTypeCounts = new Map();
  const transferCounts = new Map();
  const dnaCounts = new Map();
  const segmentCounts = new Map();
  const disconnectionCounts = new Map();
  const skillCounts = new Map();

  let totalDurationSum = 0;
  let totalDurationCount = 0;
  let uraDurationSum = 0;
  let uraDurationCount = 0;
  let transferTotal = 0;
  let invalidAniTotal = 0;

  for (const row of rows) {
    const totalDuration = toNumber(row.DURACAO_TOTAL_CHAMADA);
    const uraDuration = toNumber(row.DURACAO_CHAMADA_URA);

    if (totalDuration !== null) {
      totalDurationSum += totalDuration;
      totalDurationCount += 1;
    }

    if (uraDuration !== null) {
      uraDurationSum += uraDuration;
      uraDurationCount += 1;
    }

    const ani = normalizeAni(row.ANI);
    const phoneType = phoneTypeFromAni(ani);
    increment(phoneTypeCounts, phoneType);
    if (ani.length >= 10) {
      increment(dddCounts, ani.slice(0, 2));
    } else {
      invalidAniTotal += 1;
    }

    const skill = cleanValue(row.NOME_SKILL);
    const transferCode = cleanValue(row.TRANSFERCODE);
    if (skill) increment(skillCounts, skill);
    if (transferCode || skill) {
      transferTotal += 1;
      const label = `${skill || "SEM SKILL"} | ${transferCode || "SEM TRANSFER CODE"}`;
      transferCounts.set(label, {
        key: label,
        label,
        nomeSkill: skill || "SEM SKILL",
        transfercode: transferCode || "SEM TRANSFER CODE",
        count: (transferCounts.get(label)?.count || 0) + 1,
      });
    }

    const dna = cleanValue(row.DNA);
    if (dna) {
      const current = dnaCounts.get(dna) || { count: 0, descriptions: new Map() };
      current.count += 1;
      const desc = cleanValue(row.SCRIPT_POINT_DESC);
      if (desc) current.descriptions.set(desc, (current.descriptions.get(desc) || 0) + 1);
      dnaCounts.set(dna, current);
    }

    increment(segmentCounts, row.SEGMENTO);
    increment(disconnectionCounts, row.DISCONNECTION_TYPE_DESC);
  }

  const totalCalls = rows.length;
  const averageTotalSeconds = totalDurationCount ? totalDurationSum / totalDurationCount : 0;
  const averageUraSeconds = uraDurationCount ? uraDurationSum / uraDurationCount : 0;

  return {
    filters: {
      dataInicial: options.dataInicial || "",
      dataFinal: options.dataFinal || "",
      segmento: options.segmento || "",
    },
    csv: {
      headers,
      rows: totalCalls,
      bytes: Buffer.byteLength(String(csvText || ""), "utf8"),
    },
    summary: {
      totalCalls,
      analyzedCalls: totalCalls,
      transferTotal,
      transferRate: totalCalls ? transferTotal / totalCalls : 0,
      invalidAniTotal,
      averageTotalSeconds,
      averageTotalFormatted: formatDuration(averageTotalSeconds),
      averageUraSeconds,
      averageUraFormatted: formatDuration(averageUraSeconds),
    },
    charts: {
      callsByDdd: topFromMap(dddCounts, 20),
      phoneTypes: topFromMap(phoneTypeCounts, 5),
      transfersBySkill: [...transferCounts.values()]
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, 15),
      dnaRanking: topDnaFromMap(dnaCounts, 20),
      segments: topFromMap(segmentCounts, 15),
      disconnections: topFromMap(disconnectionCounts, 12),
      skills: topFromMap(skillCounts, 15),
    },
  };
}

export { formatDuration, normalizeAni, parseCsvRows };
