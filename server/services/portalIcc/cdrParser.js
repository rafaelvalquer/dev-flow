import * as cheerio from "cheerio";
import { CDR_COLUMNS } from "./cdrColumns.js";

function normalizeText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSearchText(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function looksLikeRealLoginOrBlocked(html = "") {
  const $ = cheerio.load(html);
  const hasPasswordInput =
    $("input[type='password'], input[name='password']").length > 0;
  const hasUsernameInput =
    $("input[name='username'], input[name='j_username']").length > 0;
  const hasAuthenticatedSignal =
    $("a[href*='/portalicc/logout'], a[href*='/portalicc/account'], .user-info")
      .length > 0;
  const hasLoginForm = $("form")
    .toArray()
    .some((form) => {
      const action = String($(form).attr("action") || "").toLowerCase();
      return (
        action.includes("login") &&
        $(form).find("input[type='password'], input[name='password']").length >
          0
      );
    });

  if (hasLoginForm || (hasPasswordInput && hasUsernameInput)) return true;
  if (hasAuthenticatedSignal) return false;

  const text = normalizeSearchText($.text());
  return (
    text.includes("voce precisa efetuar login") ||
    text.includes("sessao invalida") ||
    (text.includes("sessao expirada") && text.includes("login")) ||
    (text.includes("acesso restrito") && text.includes("login"))
  );
}

function mapRowsToObjects(columns, rows) {
  return rows
    .filter((row) => row.some((cell) => normalizeText(cell) !== ""))
    .map((row) => {
      const obj = {};
      columns.forEach((column, index) => {
        obj[column] = row[index] ?? "";
      });
      return obj;
    });
}

function extractTableRows($, table) {
  return $(table)
    .find("tr")
    .toArray()
    .map((tr) =>
      $(tr)
        .find("th,td")
        .toArray()
        .map((cell) => normalizeText($(cell).text())),
    )
    .filter((row) => row.length > 0);
}

function scoreHeader(row) {
  const known = new Set(CDR_COLUMNS.map(normalizeKey));
  return row.reduce(
    (score, cell) => score + (known.has(normalizeKey(cell)) ? 1 : 0),
    0,
  );
}

function parseHtmlTables(html) {
  const $ = cheerio.load(html);
  $("script,style,noscript").remove();

  const tables = $("table").toArray();
  let best = null;

  for (const table of tables) {
    const rows = extractTableRows($, table);
    if (!rows.length) continue;

    const headerIndex = rows.findIndex((row) => scoreHeader(row) >= 2);

    if (headerIndex >= 0) {
      const columns = rows[headerIndex].map(
        (item, index) => item || CDR_COLUMNS[index] || `Coluna ${index + 1}`,
      );
      const dataRows = rows.slice(headerIndex + 1);
      const score = scoreHeader(columns) + dataRows.length;

      if (!best || score > best.score) {
        best = { columns, rows: dataRows, score };
      }
      continue;
    }

    const largestRow = rows.reduce(
      (acc, row) => (row.length > acc.length ? row : acc),
      [],
    );

    if (largestRow.length >= 8) {
      const columns = CDR_COLUMNS.slice(0, largestRow.length);
      const score = rows.length;
      if (!best || score > best.score) {
        best = { columns, rows, score };
      }
    }
  }

  if (!best) return null;
  return {
    columns: best.columns,
    rows: mapRowsToObjects(best.columns, best.rows),
  };
}

function parseDelimitedText(html) {
  const text = cheerio.load(html).text();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const tabLines = lines.filter((line) => line.includes("\t"));
  if (tabLines.length < 2) return null;

  const parsed = tabLines.map((line) => line.split("\t").map(normalizeText));
  const headerIndex = parsed.findIndex((row) => scoreHeader(row) >= 2);

  if (headerIndex >= 0) {
    const columns = parsed[headerIndex].map(
      (item, index) => item || CDR_COLUMNS[index] || `Coluna ${index + 1}`,
    );
    const rows = parsed.slice(headerIndex + 1);
    return { columns, rows: mapRowsToObjects(columns, rows) };
  }

  const maxLength = Math.max(...parsed.map((row) => row.length));
  if (maxLength < 8) return null;

  const columns = CDR_COLUMNS.slice(0, maxLength);
  return { columns, rows: mapRowsToObjects(columns, parsed) };
}

export function createPortalSessionExpiredError(
  message = "Sessao invalida ou expirada no Portal ICC.",
) {
  const error = new Error(message);
  error.code = "PORTAL_SESSION_EXPIRED";
  error.status = 401;
  return error;
}

export function ensureAuthenticatedHtml(html) {
  if (looksLikeRealLoginOrBlocked(html)) {
    throw createPortalSessionExpiredError(
      "Login nao autenticado ou sessao expirada.",
    );
  }
}

export function parseCdrResponse(html) {
  if (looksLikeRealLoginOrBlocked(html)) {
    throw createPortalSessionExpiredError();
  }

  const tableResult = parseHtmlTables(html);
  if (tableResult) {
    return {
      ...tableResult,
      total: tableResult.rows.length,
      source: "html-table",
    };
  }

  const textResult = parseDelimitedText(html);
  if (textResult) {
    return {
      ...textResult,
      total: textResult.rows.length,
      source: "delimited-text",
    };
  }

  return {
    columns: CDR_COLUMNS,
    rows: [],
    total: 0,
    source: "not-detected",
    message: "Nao foi possivel localizar uma tabela de CDR no HTML retornado.",
  };
}
