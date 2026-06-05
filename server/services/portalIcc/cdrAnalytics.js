function cleanValue(value) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "null") return "";
  return text;
}

const STATE_NAMES = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapa",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceara",
  DF: "Distrito Federal",
  ES: "Espirito Santo",
  GO: "Goias",
  MA: "Maranhao",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Para",
  PB: "Paraiba",
  PR: "Parana",
  PE: "Pernambuco",
  PI: "Piaui",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondonia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "Sao Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

const DDD_TO_UF = {
  11: "SP",
  12: "SP",
  13: "SP",
  14: "SP",
  15: "SP",
  16: "SP",
  17: "SP",
  18: "SP",
  19: "SP",
  21: "RJ",
  22: "RJ",
  24: "RJ",
  31: "MG",
  32: "MG",
  33: "MG",
  34: "MG",
  35: "MG",
  37: "MG",
  38: "MG",
  27: "ES",
  28: "ES",
  41: "PR",
  42: "PR",
  43: "PR",
  44: "PR",
  45: "PR",
  46: "PR",
  47: "SC",
  48: "SC",
  49: "SC",
  51: "RS",
  53: "RS",
  54: "RS",
  55: "RS",
  61: "DF",
  62: "GO",
  64: "GO",
  67: "MS",
  65: "MT",
  66: "MT",
  71: "BA",
  73: "BA",
  74: "BA",
  75: "BA",
  77: "BA",
  79: "SE",
  81: "PE",
  87: "PE",
  82: "AL",
  83: "PB",
  84: "RN",
  85: "CE",
  88: "CE",
  86: "PI",
  89: "PI",
  92: "AM",
  97: "AM",
  91: "PA",
  93: "PA",
  94: "PA",
  68: "AC",
  69: "RO",
  63: "TO",
  95: "RR",
  96: "AP",
  98: "MA",
  99: "MA",
};

const DNA_MAX_DEPTH = 8;
const DNA_CONTINUATION_NODE = "...";

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

function createStateStats(uf) {
  return {
    uf,
    stateName: STATE_NAMES[uf] || uf,
    count: 0,
    answered: 0,
    abandoned: 0,
    totalDurationSum: 0,
    totalDurationCount: 0,
    uraDurationSum: 0,
    uraDurationCount: 0,
    dddCounts: new Map(),
    hourCounts: new Map(),
  };
}

function peakHourFromDate(value) {
  const text = cleanValue(value);
  const match = text.match(/(?:^|\D)([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?/);
  if (!match) return "";
  const hour = String(match[1]).padStart(2, "0");
  return `${hour}:00-${hour}:59`;
}

function parseCdrDate(value) {
  const text = cleanValue(value);
  const match = text.match(
    /(\d{2})\/(\d{2})\/(\d{4})\s+([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?/,
  );
  if (!match) return null;

  const [, day, month, year, hour, minute, second = "00"] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );

  if (Number.isNaN(date.getTime())) return null;

  const paddedHour = String(hour).padStart(2, "0");
  return {
    hour: paddedHour,
    label: `${paddedHour}:00-${paddedHour}:59`,
    timestamp: date.getTime(),
  };
}

function createCallFlowBuckets() {
  return Array.from({ length: 24 }, (_item, index) => {
    const hour = String(index).padStart(2, "0");
    return {
      hour,
      label: `${hour}:00-${hour}:59`,
      started: 0,
      finished: 0,
      transferred: 0,
      abandoned: 0,
      durationSum: 0,
      durationCount: 0,
    };
  });
}

function createHourRegionAccumulator() {
  return {
    ddds: new Map(),
    ufs: new Map(),
  };
}

function ensureRegionBucket(map, key, payload = {}) {
  const safeKey = cleanValue(key);
  if (!safeKey) return null;
  if (!map.has(safeKey)) {
    map.set(safeKey, {
      key: safeKey,
      label: safeKey,
      uf: payload.uf || "",
      stateName: payload.stateName || "",
      total: 0,
      hours: new Map(),
    });
  }
  return map.get(safeKey);
}

function addHourRegion(acc, { hour, ddd, uf, isTransferred }) {
  if (!hour || !ddd) return;

  const dddBucket = ensureRegionBucket(acc.ddds, ddd, {
    uf,
    stateName: STATE_NAMES[uf] || "",
  });
  const ufBucket = uf
    ? ensureRegionBucket(acc.ufs, uf, {
        stateName: STATE_NAMES[uf] || uf,
      })
    : null;

  [dddBucket, ufBucket].forEach((bucket) => {
    if (!bucket) return;
    bucket.total += 1;
    const hourBucket = bucket.hours.get(hour) || {
      value: 0,
      transferred: 0,
      abandoned: 0,
    };
    hourBucket.value += 1;
    if (isTransferred) hourBucket.transferred += 1;
    else hourBucket.abandoned += 1;
    bucket.hours.set(hour, hourBucket);
  });
}

function hourRegionHeatmapFromAccumulator(acc) {
  const hours = Array.from({ length: 24 }, (_item, index) => {
    const hour = String(index).padStart(2, "0");
    return { hour, label: `${hour}:00-${hour}:59` };
  });

  const ddds = [...acc.ddds.values()]
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
    .slice(0, 20)
    .map((item) => ({
      key: item.key,
      label: item.label,
      uf: item.uf,
      stateName: item.stateName,
      total: item.total,
    }));

  const ufs = [...acc.ufs.values()]
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
    .map((item) => ({
      key: item.key,
      label: item.key,
      stateName: item.stateName,
      total: item.total,
    }));

  function cellsFor(regions, sourceMap) {
    return regions.flatMap((region) => {
      const bucket = sourceMap.get(region.key);
      return hours.map(({ hour }) => {
        const cell = bucket?.hours.get(hour) || {
          value: 0,
          transferred: 0,
          abandoned: 0,
        };
        return {
          hour,
          region: region.key,
          value: cell.value,
          transferred: cell.transferred,
          abandoned: cell.abandoned,
        };
      });
    });
  }

  return {
    hours,
    ddds,
    ufs,
    cellsByDdd: cellsFor(ddds, acc.ddds),
    cellsByUf: cellsFor(ufs, acc.ufs),
  };
}

function callFlowFromBuckets(buckets) {
  return buckets.map((bucket) => {
    const averageDurationSeconds = bucket.durationCount
      ? bucket.durationSum / bucket.durationCount
      : 0;

    return {
      hour: bucket.hour,
      label: bucket.label,
      started: bucket.started,
      finished: bucket.finished,
      averageDurationSeconds,
      averageDurationFormatted: formatDuration(averageDurationSeconds),
      transferred: bucket.transferred,
      abandoned: bucket.abandoned,
    };
  });
}

function parseDnaSteps(value) {
  return cleanValue(value)
    .split("|")
    .map((step) => cleanValue(step))
    .filter(Boolean);
}

function dnaNodeKey(depth, code) {
  return `${depth}:${code}`;
}

function createDnaJourneyAccumulator() {
  return {
    nodes: new Map(),
    links: new Map(),
    validJourneys: 0,
    truncatedJourneys: 0,
  };
}

function ensureDnaNode(acc, depth, code) {
  const key = dnaNodeKey(depth, code);
  if (!acc.nodes.has(key)) {
    acc.nodes.set(key, {
      key,
      code,
      depth,
      count: 0,
      abandonments: 0,
      descriptions: new Map(),
    });
  }
  return acc.nodes.get(key);
}

function addDnaJourney(acc, dna, scriptPointDesc, isAbandoned) {
  const originalSteps = parseDnaSteps(dna);
  if (!originalSteps.length) return;

  const truncated = originalSteps.length > DNA_MAX_DEPTH;
  const steps = truncated
    ? [...originalSteps.slice(0, DNA_MAX_DEPTH - 1), DNA_CONTINUATION_NODE]
    : originalSteps.slice(0, DNA_MAX_DEPTH);

  acc.validJourneys += 1;
  if (truncated) acc.truncatedJourneys += 1;

  steps.forEach((code, index) => {
    const depth = index + 1;
    const node = ensureDnaNode(acc, depth, code);
    node.count += 1;
    if (isAbandoned && index === steps.length - 1) node.abandonments += 1;

    const desc = cleanValue(scriptPointDesc);
    if (desc && index === steps.length - 1 && code !== DNA_CONTINUATION_NODE) {
      node.descriptions.set(desc, (node.descriptions.get(desc) || 0) + 1);
    }

    if (index === 0) return;
    const source = dnaNodeKey(index, steps[index - 1]);
    const target = dnaNodeKey(depth, code);
    const linkKey = `${source}->${target}`;
    const current = acc.links.get(linkKey) || {
      source,
      target,
      value: 0,
      abandonments: 0,
    };
    current.value += 1;
    if (isAbandoned && index === steps.length - 1) current.abandonments += 1;
    acc.links.set(linkKey, current);
  });
}

function topDescription(descriptions) {
  return [...descriptions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function dnaJourneyFromAccumulator(acc) {
  const rawNodes = [...acc.nodes.values()];
  const sortedNodes = rawNodes.sort(
    (a, b) => b.count - a.count || a.depth - b.depth || a.code.localeCompare(b.code),
  );
  const keepKeys = new Set(sortedNodes.slice(0, 80).map((node) => node.key));
  const nodes = sortedNodes
    .filter((node) => keepKeys.has(node.key))
    .map((node) => {
      const description = topDescription(node.descriptions);
      const label =
        description && node.code !== DNA_CONTINUATION_NODE
          ? `${node.code} - ${description}`
          : node.code;
      return {
        id: node.key,
        name: node.key,
        code: node.code,
        label,
        description,
        depth: node.depth,
        count: node.count,
        abandonments: node.abandonments,
        abandonmentRate: node.count ? node.abandonments / node.count : 0,
      };
    });

  const links = [...acc.links.values()]
    .filter((link) => keepKeys.has(link.source) && keepKeys.has(link.target))
    .sort((a, b) => b.value - a.value)
    .slice(0, 120)
    .map((link) => ({
      source: link.source,
      target: link.target,
      value: link.value,
      abandonments: link.abandonments,
      abandonmentRate: link.value ? link.abandonments / link.value : 0,
    }));

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const topAbandonmentSteps = nodes
    .filter((node) => node.abandonments > 0)
    .sort(
      (a, b) =>
        b.abandonments - a.abandonments ||
        b.abandonmentRate - a.abandonmentRate ||
        b.count - a.count,
    )
    .slice(0, 12)
    .map((node) => ({
      id: node.id,
      code: node.code,
      label: node.label,
      description: node.description,
      depth: node.depth,
      count: node.count,
      abandonments: node.abandonments,
      abandonmentRate: node.abandonmentRate,
    }));

  return {
    nodes,
    links: links.filter((link) => nodeById.has(link.source) && nodeById.has(link.target)),
    topAbandonmentSteps,
    summary: {
      validJourneys: acc.validJourneys,
      truncatedJourneys: acc.truncatedJourneys,
      maxDepth: DNA_MAX_DEPTH,
    },
  };
}

function callsByStateFromMap(map) {
  return [...map.values()]
    .map((state) => {
      const averageTotalSeconds = state.totalDurationCount
        ? state.totalDurationSum / state.totalDurationCount
        : 0;
      const averageUraSeconds = state.uraDurationCount
        ? state.uraDurationSum / state.uraDurationCount
        : 0;
      const peakHour =
        [...state.hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";

      return {
        uf: state.uf,
        stateName: state.stateName,
        count: state.count,
        answered: state.answered,
        abandoned: state.abandoned,
        averageTotalSeconds,
        averageTotalFormatted: formatDuration(averageTotalSeconds),
        averageUraSeconds,
        averageUraFormatted: formatDuration(averageUraSeconds),
        peakHour,
        topDdds: topFromMap(state.dddCounts, 5),
      };
    })
    .sort((a, b) => b.count - a.count || a.uf.localeCompare(b.uf));
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
  const stateCounts = new Map();
  const dnaJourney = createDnaJourneyAccumulator();
  const callFlowBuckets = createCallFlowBuckets();
  const hourRegionHeatmap = createHourRegionAccumulator();

  let totalDurationSum = 0;
  let totalDurationCount = 0;
  let uraDurationSum = 0;
  let uraDurationCount = 0;
  let transferTotal = 0;
  let invalidAniTotal = 0;
  let invalidDateTotal = 0;

  for (const row of rows) {
    const totalDuration = toNumber(row.DURACAO_TOTAL_CHAMADA);
    const uraDuration = toNumber(row.DURACAO_CHAMADA_URA);
    const startDate = parseCdrDate(row.DATA_INICIO_LIGACAO_URA);
    const endDate = parseCdrDate(row.DATA_FIM_LIGACAO_URA);

    if (totalDuration !== null) {
      totalDurationSum += totalDuration;
      totalDurationCount += 1;
    }

    if (uraDuration !== null) {
      uraDurationSum += uraDuration;
      uraDurationCount += 1;
    }

    const skill = cleanValue(row.NOME_SKILL);
    const transferCode = cleanValue(row.TRANSFERCODE);
    const isTransferred = Boolean(transferCode || skill);

    if (startDate) {
      const bucket = callFlowBuckets[Number(startDate.hour)];
      bucket.started += 1;
      if (isTransferred) bucket.transferred += 1;
      else bucket.abandoned += 1;

      let duration = totalDuration;
      if (duration === null && endDate && endDate.timestamp >= startDate.timestamp) {
        duration = (endDate.timestamp - startDate.timestamp) / 1000;
      }
      if (duration !== null) {
        bucket.durationSum += duration;
        bucket.durationCount += 1;
      }
    } else {
      invalidDateTotal += 1;
    }

    if (endDate) {
      callFlowBuckets[Number(endDate.hour)].finished += 1;
    }

    const ani = normalizeAni(row.ANI);
    const phoneType = phoneTypeFromAni(ani);
    increment(phoneTypeCounts, phoneType);
    let ddd = "";
    if (ani.length >= 10) {
      ddd = ani.slice(0, 2);
      increment(dddCounts, ddd);
    } else {
      invalidAniTotal += 1;
    }

    const uf = DDD_TO_UF[ddd];
    if (uf) {
      const state = stateCounts.get(uf) || createStateStats(uf);
      state.count += 1;
      if (isTransferred) state.answered += 1;
      else state.abandoned += 1;
      if (totalDuration !== null) {
        state.totalDurationSum += totalDuration;
        state.totalDurationCount += 1;
      }
      if (uraDuration !== null) {
        state.uraDurationSum += uraDuration;
        state.uraDurationCount += 1;
      }
      increment(state.dddCounts, ddd);
      const peakHour = peakHourFromDate(row.DATA_INICIO_LIGACAO_URA);
      if (peakHour) increment(state.hourCounts, peakHour);
      stateCounts.set(uf, state);
    }

    if (startDate && ddd) {
      addHourRegion(hourRegionHeatmap, {
        hour: startDate.hour,
        ddd,
        uf,
        isTransferred,
      });
    }

    if (skill) increment(skillCounts, skill);
    if (isTransferred) {
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
      addDnaJourney(dnaJourney, dna, desc, !isTransferred);
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
      campo1: options.campo1 || "0",
      valor1: options.valor1 || "",
      campo2: options.campo2 || "0",
      valor2: options.valor2 || "",
      campo3: options.campo3 || "0",
      valor3: options.valor3 || "",
      campo4: options.campo4 || "0",
      valor4: options.valor4 || "",
      campo5: options.campo5 || "0",
      valor5: options.valor5 || "",
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
      invalidDateTotal,
      averageTotalSeconds,
      averageTotalFormatted: formatDuration(averageTotalSeconds),
      averageUraSeconds,
      averageUraFormatted: formatDuration(averageUraSeconds),
    },
    charts: {
      callFlowByHour: callFlowFromBuckets(callFlowBuckets),
      callsByState: callsByStateFromMap(stateCounts),
      hourRegionHeatmap: hourRegionHeatmapFromAccumulator(hourRegionHeatmap),
      callsByDdd: topFromMap(dddCounts, 20),
      phoneTypes: topFromMap(phoneTypeCounts, 5),
      transfersBySkill: [...transferCounts.values()]
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, 15),
      dnaRanking: topDnaFromMap(dnaCounts, 20),
      dnaJourneyFunnel: dnaJourneyFromAccumulator(dnaJourney),
      segments: topFromMap(segmentCounts, 15),
      disconnections: topFromMap(disconnectionCounts, 12),
      skills: topFromMap(skillCounts, 15),
    },
  };
}

export { formatDuration, normalizeAni, parseCsvRows };
