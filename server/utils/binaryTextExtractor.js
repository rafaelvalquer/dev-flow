import { sanitizeTraceText } from "./sanitize.js";

const ASCII_READABLE = (byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 160;
const KEYWORD_RE = /TraceEventMessage|VCAPI|PRD\\|BEGIN|SNIPPET|REST_API|MakeRestRequest|TRANSFER|WORKFLOWDATA|IVRLOG|RUNSUB|RETURN/i;

function pushString(out, bytes, offset, encoding, minLength) {
  if (bytes.length < minLength) return;
  const text = cleanChunkText(Buffer.from(bytes).toString(encoding));
  if (text.length >= minLength) out.push({ offset, encoding, text, score: KEYWORD_RE.test(text) ? 10 : 1 });
}

export function cleanChunkText(text = "") {
  return sanitizeTraceText(text)
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractAsciiStrings(buffer, minLength = 4) {
  const out = [];
  let bytes = [];
  let start = 0;

  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    if (ASCII_READABLE(byte)) {
      if (!bytes.length) start = i;
      bytes.push(byte);
    } else {
      pushString(out, bytes, start, "latin1", minLength);
      bytes = [];
    }
  }
  pushString(out, bytes, start, "latin1", minLength);
  return out;
}

export function extractUtf16LeStrings(buffer, minLength = 4) {
  const out = [];
  let bytes = [];
  let start = 0;

  for (let i = 0; i < buffer.length - 1; i += 2) {
    const char = buffer[i];
    const zero = buffer[i + 1];
    const readable = zero === 0 && ASCII_READABLE(char);
    if (readable) {
      if (!bytes.length) start = i;
      bytes.push(char, zero);
    } else {
      pushString(out, bytes, start, "utf16le", minLength);
      bytes = [];
    }
  }
  pushString(out, bytes, start, "utf16le", minLength);
  return out;
}

export function extractReadableChunks(buffer) {
  const chunks = [...extractAsciiStrings(buffer), ...extractUtf16LeStrings(buffer)]
    .filter((chunk) => chunk.text.length >= 4)
    .sort((a, b) => a.offset - b.offset || b.score - a.score);

  const merged = [];
  for (const chunk of chunks) {
    const prev = merged[merged.length - 1];
    if (prev && chunk.offset - prev.offset < 48 && prev.encoding === chunk.encoding) {
      const text = cleanChunkText(`${prev.text}\n${chunk.text}`);
      merged[merged.length - 1] = { ...prev, text, score: Math.max(prev.score, chunk.score) };
    } else {
      merged.push(chunk);
    }
  }

  return merged.sort((a, b) => b.score - a.score || a.offset - b.offset);
}
