import * as cheerio from "cheerio";
import { ensureAuthenticatedHtml } from "./cdrParser.js";

function normalizeText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseInteger(value = "") {
  const match = String(value).match(/(\d[\d.]*)/);
  if (!match) return 0;
  const number = Number(match[1].replace(/\./g, ""));
  return Number.isFinite(number) ? number : 0;
}

function findResultTable($) {
  const tables = $("table").toArray();
  return (
    tables.find((table) => {
      const headers = $(table).find("thead th, tr th").toArray();
      return headers.some((header) => normalizeText($(header).text()));
    }) || null
  );
}

function extractColumns($, table) {
  const headerCells = $(table).find("thead tr").first().find("th").toArray();
  const cells = headerCells.length
    ? headerCells
    : $(table).find("tr").first().find("th").toArray();

  return cells
    .map((cell) => normalizeText($(cell).text()))
    .filter(Boolean);
}

function extractRows($, table, columns) {
  const bodyRows = $(table).find("tbody tr").toArray();
  const rows = bodyRows.length
    ? bodyRows
    : $(table)
        .find("tr")
        .toArray()
        .filter((row) => $(row).find("td").length > 0);

  return rows
    .map((row) => {
      const cells = $(row)
        .find("td")
        .toArray()
        .map((cell) => normalizeText($(cell).text()));
      const item = {};
      columns.forEach((column, index) => {
        item[column] = cells[index] ?? "";
      });
      return item;
    })
    .filter((row) => Object.values(row).some((value) => normalizeText(value)));
}

export function parseCustomReportHtml(html) {
  const safeHtml = String(html || "");
  ensureAuthenticatedHtml(safeHtml);

  const $ = cheerio.load(safeHtml);
  $("script,style,noscript").remove();

  const table = findResultTable($);
  if (!table) {
    return {
      columns: [],
      rows: [],
      total: 0,
      source: "portal-custom-report",
    };
  }

  const columns = extractColumns($, table);
  if (!columns.length) {
    return {
      columns: [],
      rows: [],
      total: 0,
      source: "portal-custom-report",
    };
  }

  const rows = extractRows($, table, columns);
  const captionText = normalizeText($(table).find("caption").first().text());
  const captionTotal = captionText ? parseInteger(captionText) : 0;

  return {
    columns,
    rows,
    total: captionTotal || rows.length,
    source: "portal-custom-report",
  };
}
