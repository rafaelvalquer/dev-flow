const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g;
const AUTH_HEADER = /\b(authorization\s*[:=]\s*)(bearer\s+)?[A-Za-z0-9._~+/=-]{12,}/gi;
const TOKEN_ASSIGNMENT = /\b(token|access_token|refresh_token|id_token|api[_-]?key|secret)\b\s*[:=]\s*["']?([^"'\s,;|{}]{8,})/gi;

export function normalizeSpaces(text = "", { keepLines = true } = {}) {
  let value = String(text ?? "")
    .replace(/\u0000+/g, " ")
    .replace(CONTROL_CHARS, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  if (keepLines) {
    value = value
      .split("\n")
      .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
      .filter((line, index, arr) => line || arr[index - 1])
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  } else {
    value = value.replace(/\s+/g, " ").trim();
  }

  return value.trim();
}

export function maskPhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return value;
  const withoutCountry = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (withoutCountry.length < 10) return value;
  return `${withoutCountry.slice(0, 2)}*****${withoutCountry.slice(-3)}`;
}

export function maskCpf(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 11) return value;
  return `${digits.slice(0, 3)}******${digits.slice(-2)}`;
}

export function sanitizeSensitive(text = "") {
  return String(text ?? "")
    .replace(AUTH_HEADER, "$1$2***")
    .replace(TOKEN_ASSIGNMENT, "$1=***")
    .replace(/\b(CPF|cpf)\s*[:=]?\s*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/g, (_m, label, cpf) => `${label}=${maskCpf(cpf)}`)
    .replace(/\b(MSISDN|ANI|telefone|phone|msisdn|ani)\s*[:=]?\s*(\+?55)?(\d{10,11})\b/g, (_m, label, country = "", phone) => `${label}=${maskPhone(`${country}${phone}`)}`)
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, (cpf) => maskCpf(cpf))
    .replace(/\b(?:\+?55)?\d{10,11}\b/g, (phone) => maskPhone(phone));
}

export function sanitizeTraceText(text = "", options = {}) {
  return sanitizeSensitive(normalizeSpaces(text, options));
}

export function compactText(text = "", max = 260) {
  const value = sanitizeTraceText(text, { keepLines: false });
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}...`;
}

export function uniq(values = []) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim() !== ""))];
}
