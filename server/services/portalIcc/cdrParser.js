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

function parseInteger(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  const number = Number(digits);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function uniqueSortedPages(pages) {
  return [...new Set(pages.filter((page) => page > 0))].sort((a, b) => a - b);
}

function pageFromHref(href = "") {
  const match = String(href).match(/\/cdr-list\/page\/(\d+)/i);
  return match ? parseInteger(match[1]) : 0;
}

function createFallbackPagination({ page = 1, rowCount = 0 } = {}) {
  const currentPage = Math.max(1, Number(page) || 1);
  return {
    currentPage,
    totalPages: currentPage,
    totalItems: rowCount,
    from: rowCount ? 1 : 0,
    to: rowCount,
    pages: [currentPage],
    firstPage: currentPage > 1 ? 1 : null,
    previousPage: currentPage > 1 ? currentPage - 1 : null,
    nextPage: null,
    lastPage: null,
  };
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

function parseCdrPagination(html, { page = 1, rowCount = 0 } = {}) {
  const $ = cheerio.load(html);
  const nav =
    $("nav")
      .toArray()
      .find((item) => {
        const ariaLabel = normalizeSearchText($(item).attr("aria-label") || "");
        const text = normalizeSearchText($(item).text());
        const hasCdrPageLink = $(item).find("a[href*='/cdr-list/page/']").length > 0;
        return (
          hasCdrPageLink ||
          ariaLabel.includes("paginacao") ||
          (hasCdrPageLink && text.includes("pagina"))
        );
      }) || null;

  if (!nav) return createFallbackPagination({ page, rowCount });

  const summaryCandidates = $(nav)
    .find("span,div,p")
    .toArray()
    .map((item) => normalizeSearchText($(item).text()))
    .filter(
      (text) =>
        text.includes("exibindo") &&
        text.includes("total") &&
        text.includes("pagina"),
    )
    .sort((a, b) => a.length - b.length);
  const summaryText = summaryCandidates[0] || normalizeSearchText($(nav).text());
  const summaryMatch = summaryText.match(
    /exibindo\s+(\d+)\s+a\s+(\d+)\s+do\s+total\s+de\s+(\d+)\s*-\s*pagina\s+(\d+)\s+de\s+(\d+)/i,
  );

  const currentPage = summaryMatch
    ? parseInteger(summaryMatch[4])
    : Math.max(1, Number(page) || 1);
  const totalPages = summaryMatch ? parseInteger(summaryMatch[5]) : currentPage;
  const totalItems = summaryMatch ? parseInteger(summaryMatch[3]) : rowCount;
  const from = summaryMatch ? parseInteger(summaryMatch[1]) : rowCount ? 1 : 0;
  const to = summaryMatch ? parseInteger(summaryMatch[2]) : rowCount;
  const pages = uniqueSortedPages(
    $(nav)
      .find("a[href*='/cdr-list/page/']")
      .toArray()
      .map((link) => {
        const textPage = parseInteger($(link).text());
        return textPage || pageFromHref($(link).attr("href"));
      }),
  ).filter((item) => !totalPages || item <= totalPages);

  return {
    currentPage,
    totalPages,
    totalItems,
    from,
    to,
    pages: pages.length ? pages : [currentPage],
    firstPage: currentPage > 1 ? 1 : null,
    previousPage: currentPage > 1 ? currentPage - 1 : null,
    nextPage: totalPages && currentPage < totalPages ? currentPage + 1 : null,
    lastPage: totalPages && currentPage < totalPages ? totalPages : null,
  };
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

export function parseCdrResponse(html, options = {}) {
  if (looksLikeRealLoginOrBlocked(html)) {
    throw createPortalSessionExpiredError();
  }

  const tableResult = parseHtmlTables(html);
  if (tableResult) {
    const pagination = parseCdrPagination(html, {
      page: options.page,
      rowCount: tableResult.rows.length,
    });
    return {
      ...tableResult,
      total: pagination.totalItems || tableResult.rows.length,
      pagination,
      source: "html-table",
    };
  }

  const textResult = parseDelimitedText(html);
  if (textResult) {
    const pagination = createFallbackPagination({
      page: options.page,
      rowCount: textResult.rows.length,
    });
    return {
      ...textResult,
      total: pagination.totalItems || textResult.rows.length,
      pagination,
      source: "delimited-text",
    };
  }

  const pagination = parseCdrPagination(html, {
    page: options.page,
    rowCount: 0,
  });

  return {
    columns: CDR_COLUMNS,
    rows: [],
    total: pagination.totalItems || 0,
    pagination,
    source: "not-detected",
    message: "Nao foi possivel localizar uma tabela de CDR no HTML retornado.",
  };
}
