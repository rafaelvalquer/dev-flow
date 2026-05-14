import { extractReadableChunks } from "../utils/binaryTextExtractor.js";
import { compactText, sanitizeSensitive, sanitizeTraceText, uniq } from "../utils/sanitize.js";

const EVENT_MARKERS = [
  "TraceEventMessage",
  "PRD\\",
  "BEGIN",
  "SNIPPET",
  "IF",
  "PLAY",
  "MENU",
  "RUNSUB",
  "RUNSCRIPT",
  "RETURN",
  "REST_API",
  "MakeRestRequest",
  "TRANSFER",
  "IVRLOG",
  "WORKFLOWDATA",
  "GETVALUE",
  "WAIT",
  "CASE",
  "HOURS",
  "COUNTAGENTS",
];
const ACTIONS = ["BEGIN", "SNIPPET", "IF", "PLAY", "MENU", "RUNSUB", "RUNSCRIPT", "RETURN", "REST_API", "TRANSFER", "IVRLOG", "WORKFLOWDATA", "GETVALUE", "WAIT", "CASE", "HOURS", "COUNTAGENTS"];
const SUCCESS_HTTP = new Set(["200", "201", "204"]);

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return sanitizeSensitive(match[1]).trim();
  }
  return null;
}

function numberMatch(text, patterns) {
  const value = firstMatch(text, patterns);
  if (value == null) return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseTime(text) {
  const iso = firstMatch(text, [
    /\b(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,7})?Z?)\b/i,
    /\b(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}(?:[.,]\d{1,7})?)\b/i,
    /\b(\d{2}:\d{2}:\d{2}(?:[.,]\d{1,7})?)\b/i,
  ]);
  if (!iso) return { time: null, timestampMs: null };
  const normalized = iso.replace(",", ".");
  const ts = Date.parse(normalized);
  return { time: normalized, timestampMs: Number.isFinite(ts) ? ts : null };
}

function detectAction(text) {
  if (/MakeRestRequest/i.test(text)) return "REST_API";
  return ACTIONS.find((action) => new RegExp(`\\b${action}\\b`, "i").test(text)) || null;
}

function detectTags(event) {
  return uniq([
    event.action,
    event.apiName ? "api" : null,
    event.isError ? "error" : null,
    event.transcript ? "transcription" : null,
    event.transferCode || event.action === "TRANSFER" ? "transfer" : null,
    event.scriptName ? "script" : null,
  ]).map((tag) => String(tag).toLowerCase());
}

function detectErrorScore(text, httpStatusCode, result) {
  const value = String(text || "");
  if (httpStatusCode && !SUCCESS_HTTP.has(String(httpStatusCode))) return 4;
  if (/\b(timeout|NullPointerException|exception|failed|falha|rejection|max rejection)\b/i.test(value)) return 4;
  if (/\b__ERR\s*[:=]\s*(?!["']?\s*(?:["']|$|;|,|\|))[^;\n\r|]+/i.test(value)) return 4;
  if (/\b(result|retorno|status)\s*[:=]\s*["']?(erro|error|failed|falha)/i.test(value) || /\bHTTPSTATUSCODE\s*[:=]\s*(4\d\d|5\d\d)\b/i.test(value)) return 3;
  if (/\berrorArgList\b/i.test(value) || /\b(erro|error|timeout)\b/i.test(value)) return 2;
  if (/\berro\b/i.test(value) || /coment[aá]rio/i.test(value)) return 1;
  if (result && /\b(erro|error|failed|falha)\b/i.test(result)) return 3;
  return 0;
}

function splitIntoCandidateEvents(chunks) {
  const ordered = [...chunks].sort((a, b) => a.offset - b.offset);
  const candidates = [];
  const markerRegex = new RegExp(`(?=${EVENT_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");

  for (const chunk of ordered) {
    const text = chunk.text;
    if (!text) continue;
    const positions = [...text.matchAll(markerRegex)].map((m) => m.index).filter((v) => Number.isFinite(v));
    if (positions.length <= 1) {
      candidates.push({ offset: chunk.offset, text });
      continue;
    }
    for (let i = 0; i < positions.length; i += 1) {
      const start = positions[i];
      const end = positions[i + 1] ?? text.length;
      const part = text.slice(start, end).trim();
      if (part.length >= 4) candidates.push({ offset: chunk.offset + start, text: part });
    }
  }

  const seen = new Set();
  return candidates
    .sort((a, b) => a.offset - b.offset)
    .filter((item) => {
      const key = item.text.slice(0, 500);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeEvent(candidate, index) {
  const fullText = sanitizeTraceText(candidate.text);
  const scriptName = firstMatch(fullText, [
    /\b((?:PRD|DEV|HML|QA)\\[A-Za-z0-9_./\\-]+)\b/i,
    /\bscriptName\s*[:=]\s*["']?([^"'\n\r|;,{}]+)/i,
    /\bscript\s*[:=]\s*["']?([^"'\n\r|;,{}]+)/i,
  ]);
  const action = detectAction(fullText);
  const httpStatusCode = firstMatch(fullText, [
    /\bHTTPSTATUSCODE\s*[:=]\s*["']?(\d{3})/i,
    /\bHttpStatusCode["'}\s:=]+(\d{3})/i,
    /\bstatus(?:Code)?\s*[:=]\s*["']?(\d{3})/i,
  ]);
  const result = firstMatch(fullText, [/\bresult\s*[:=]\s*["']?([^"'\n\r|;,{}]+)/i, /\bresultSet\s*[:=]\s*["']?([^"'\n\r|;,{}]+)/i]);
  const { time, timestampMs } = parseTime(fullText);
  const transcript = firstMatch(fullText, [
    /\bTexto\s*:\s*([^\n\r|]+)/i,
    /\btranscript\s*[:=]\s*["']?([^"'\n\r|{}]+)/i,
  ]);
  const confidence = numberMatch(fullText, [
    /\bConfian[çc]a\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i,
    /\bTRANSCRIPTIONCONFIDENCE\s*[:=]\s*([0-9]+(?:[.,][0-9]+)?)/i,
    /\bconfidence\s*[:=]\s*([0-9]+(?:[.,][0-9]+)?)/i,
  ]);
  const apiName = firstMatch(fullText, [
    /\b(API_[A-Za-z0-9_]+)/,
    /\bapiName\s*[:=]\s*["']?([^"'\n\r|;,{}]+)/i,
    /\bMakeRestRequest\s*\(?\s*["']?([^"'\n\r|;,{} )]+)/i,
  ]) || (action === "REST_API" ? "MakeRestRequest" : null);
  const url = firstMatch(fullText, [/\b(https?:\/\/[^\s"'<>|{}]+)/i, /\burl\s*[:=]\s*["']?([^"'\s|{}]+)/i]);
  const event = {
    index,
    time,
    timestampMs,
    messageId: firstMatch(fullText, [/\bmessageId\s*[:=]\s*["']?([^"'\s|;,{}]+)/i]),
    contactId: firstMatch(fullText, [/\bcontactId\s*[:=]\s*["']?([^"'\s|;,{}]+)/i, /\b([A-Z]{3}\d[A-Z0-9]{8,})\b/]),
    msisdn: firstMatch(fullText, [/\bMSISDN\s*[:=]?\s*(\+?55?\d{10,13}|\d{10,11})\b/i, /\bANI\s*[:=]?\s*(\+?55?\d{10,13}|\d{10,11})\b/i]),
    busNo: firstMatch(fullText, [/\bbusNo\s*[:=]\s*["']?([^"'\s|;,{}]+)/i]),
    iisHost: firstMatch(fullText, [/\biisHost\s*[:=]\s*["']?([^"'\s|;,{}]+)/i, /\b(IIS[A-Z0-9-]{2,})\b/i]),
    vcHost: firstMatch(fullText, [/\bvcHost\s*[:=]\s*["']?([^"'\s|;,{}]+)/i, /\b(VC[A-Z0-9-]{2,})\b/i]),
    scriptName,
    action,
    actionId: firstMatch(fullText, [/\bactionId\s*[:=]\s*["']?([^"'\s|;,{}]+)/i]),
    result,
    apiName,
    httpMethod: firstMatch(fullText, [/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i]),
    url,
    timeoutMs: numberMatch(fullText, [/\btimeout(?:Ms)?\s*[:=]\s*(\d{3,7})/i, /\btimeout\s+(\d{3,7})\b/i]),
    httpStatusCode,
    latencyMs: numberMatch(fullText, [/\blatency(?:Ms)?\s*[:=]\s*(\d{1,7})/i, /\bduration(?:Ms)?\s*[:=]\s*(\d{1,7})/i]),
    transcript,
    transcriptionConfidence: confidence,
    intent: firstMatch(fullText, [/\binten[cç][aã]o\s*[:=]\s*([^;\n\r|]+)/i, /\bintent\s*[:=]\s*([^;\n\r|]+)/i, /\bcategoria\s*[:=]\s*([^;\n\r|]+)/i]),
    transferCode: firstMatch(fullText, [/\bCDR_TRANSFERCODE\s*[:=]\s*["']?([^"'\s|;,{}]+)/i, /\bTRANSFERCODE\s*[:=]\s*["']?([^"'\s|;,{}]+)/i]),
    errorType: null,
    rawParamsPreview: compactText(firstMatch(fullText, [/\brawParams\s*[:=]\s*([\s\S]{1,800})/i]) || fullText, 420),
    varsPreview: compactText(firstMatch(fullText, [/\bvars\s*[:=]\s*([\s\S]{1,800})/i, /\bWORKFLOWDATA\b([\s\S]{1,800})/i]) || "", 420),
    fullText,
    offset: candidate.offset,
  };
  event.errorScore = detectErrorScore(fullText, event.httpStatusCode, event.result);
  event.isError = event.errorScore >= 3;
  event.errorType = event.isError ? firstMatch(fullText, [/\b(NullPointerException|Exception|timeout|failed|falha|erro|error|rejection)\b/i]) || "Erro provável" : null;
  event.tags = detectTags(event);
  return event;
}

export function parseTrcBuffer(buffer, fileName = "trace.trc") {
  const warnings = [];
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);
  const chunks = extractReadableChunks(buffer);
  const allText = chunks.map((chunk) => chunk.text).join("\n");
  const hasTraceEventMessage = /TraceEventMessage/i.test(allText);
  const hasVcapi = /VCAPI/i.test(allText);
  const candidates = splitIntoCandidateEvents(chunks).filter((item) => EVENT_MARKERS.some((marker) => item.text.toUpperCase().includes(marker.toUpperCase().replace("\\", "\\"))));

  if (!chunks.length) warnings.push("Nenhuma string legível foi extraída do binário.");
  if (!candidates.length && chunks.length) warnings.push("Nenhum marcador recorrente foi encontrado; usando chunks legíveis como eventos aproximados.");

  const source = candidates.length ? candidates : chunks.map((chunk) => ({ offset: chunk.offset, text: chunk.text }));
  const events = source.slice(0, 5000).map((candidate, index) => normalizeEvent(candidate, index + 1));

  return {
    fileName,
    detectedFormat: hasTraceEventMessage || hasVcapi ? "dotnet-binaryformatter-vcapi" : "unknown-binary-readable-strings",
    events,
    metadata: {
      sizeBytes: buffer.length,
      hasTraceEventMessage,
      hasVcapi,
      readableChunks: chunks.length,
      parserMode: "javascript-heuristic",
    },
    warnings,
  };
}
