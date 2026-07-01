const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const VALID_STATUSES = new Set(["OPEN", "CLOSED"]);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeStatus(value) {
  return normalizeText(value).toUpperCase();
}

function parseDateBR(value) {
  const raw = normalizeText(value);
  const match = DATE_RE.exec(raw);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { raw, day, month, year, timestamp: date.getTime() };
}

function timeToMinutes(value) {
  const raw = normalizeText(value);
  const match = TIME_RE.exec(raw);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function compareRules(a, b) {
  const dateA = parseDateBR(a.date)?.timestamp || 0;
  const dateB = parseDateBR(b.date)?.timestamp || 0;
  if (dateA !== dateB) return dateA - dateB;

  const startA = timeToMinutes(a.startTime);
  const startB = timeToMinutes(b.startTime);
  const safeStartA = startA == null ? -1 : startA;
  const safeStartB = startB == null ? -1 : startB;
  if (safeStartA !== safeStartB) return safeStartA - safeStartB;

  const endA = timeToMinutes(a.endTime);
  const endB = timeToMinutes(b.endTime);
  const safeEndA = endA == null ? -1 : endA;
  const safeEndB = endB == null ? -1 : endB;
  if (safeEndA !== safeEndB) return safeEndA - safeEndB;

  return normalizeStatus(a.status).localeCompare(normalizeStatus(b.status));
}

function normalizeRule(rule = {}) {
  return {
    date: normalizeText(rule.date),
    status: normalizeStatus(rule.status),
    startTime: normalizeText(rule.startTime),
    endTime: normalizeText(rule.endTime),
    targetUras: uniqueUras(rule.targetUras),
  };
}

function uniqueUras(selectedUras = []) {
  return [...new Set((Array.isArray(selectedUras) ? selectedUras : []).map(normalizeText).filter(Boolean))];
}

function sqlString(value) {
  return normalizeText(value).replace(/'/g, "''");
}

export function validateBusinessHoursConfig({ selectedUras = [], rules = [] } = {}) {
  const errors = [];
  const uras = uniqueUras(selectedUras);
  const normalizedRules = (Array.isArray(rules) ? rules : []).map(normalizeRule);

  if (!uras.length) {
    errors.push("Selecione pelo menos uma URA.");
  }

  if (!normalizedRules.length) {
    errors.push("Adicione pelo menos uma regra.");
  }

  normalizedRules.forEach((rule, index) => {
    const label = `Regra ${index + 1}`;
    const parsedDate = parseDateBR(rule.date);
    const startMinutes = rule.startTime ? timeToMinutes(rule.startTime) : null;
    const endMinutes = rule.endTime ? timeToMinutes(rule.endTime) : null;
    const ruleUras = rule.targetUras.length
      ? uras.filter((ura) => rule.targetUras.includes(ura))
      : uras;

    if (!rule.date) {
      errors.push(`${label}: data obrigatoria.`);
    } else if (!parsedDate) {
      errors.push(`${label}: data deve estar em DD/MM/YYYY.`);
    }

    if (!rule.status) {
      errors.push(`${label}: status obrigatorio.`);
    } else if (!VALID_STATUSES.has(rule.status)) {
      errors.push(`${label}: status deve ser OPEN ou CLOSED.`);
    }

    if (rule.startTime && startMinutes == null) {
      errors.push(`${label}: hora inicial deve estar em HH:MM.`);
    }

    if (rule.endTime && endMinutes == null) {
      errors.push(`${label}: hora final deve estar em HH:MM.`);
    }

    if (rule.status === "OPEN" && (!rule.startTime || !rule.endTime)) {
      errors.push(`${label}: OPEN exige hora inicial e hora final.`);
    }

    if (
      rule.status === "CLOSED" &&
      ((rule.startTime && !rule.endTime) || (!rule.startTime && rule.endTime))
    ) {
      errors.push(`${label}: CLOSED deve ter hora inicial e final, ou nenhum horario.`);
    }

    if (
      startMinutes != null &&
      endMinutes != null &&
      endMinutes < startMinutes
    ) {
      errors.push(`${label}: hora final nao pode ser menor que hora inicial.`);
    }

    if (rule.targetUras.length && uras.length && !ruleUras.length) {
      errors.push(`${label}: selecione ao menos uma URA valida para o escopo.`);
    }
  });

  const seen = new Set();
  for (const rule of normalizedRules) {
    const ruleUras = rule.targetUras.length
      ? uras.filter((ura) => rule.targetUras.includes(ura))
      : uras;
    for (const ura of ruleUras) {
      const key = [
        ura,
        rule.date,
        rule.startTime,
        rule.endTime,
        rule.status,
      ].join("|");
      if (seen.has(key)) {
        errors.push(
          `Regra duplicada para ${ura} em ${rule.date || "data nao informada"}.`,
        );
        return { valid: false, errors, selectedUras: uras, rules: normalizedRules };
      }
      seen.add(key);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    selectedUras: uras,
    rules: normalizedRules,
  };
}

export function generateBusinessHoursInserts({ selectedUras = [], rules = [] } = {}) {
  const validation = validateBusinessHoursConfig({ selectedUras, rules });
  if (!validation.valid) {
    const error = new Error(validation.errors.join("\n"));
    error.errors = validation.errors;
    throw error;
  }

  const orderedRules = [...validation.rules].sort(compareRules);

  return validation.selectedUras
    .map((ura) => {
      const safeUra = sqlString(ura);
      const lines = orderedRules
        .filter((rule) => !rule.targetUras.length || rule.targetUras.includes(ura))
        .map((rule) => {
          const startTime = sqlString(rule.startTime);
          const endTime = sqlString(rule.endTime);
          return `insert into tb_bussinesshours values('${safeUra}','','${rule.date}','${startTime}','${endTime}','${rule.status}');`;
        });

      if (!lines.length) return "";

      return [`--${ura}`, ...lines].join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

export const businessHoursInsertTestInternals = {
  parseDateBR,
  timeToMinutes,
  compareRules,
  normalizeRule,
  uniqueUras,
};
