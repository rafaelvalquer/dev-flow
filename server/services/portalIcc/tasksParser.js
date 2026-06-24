import * as cheerio from "cheerio";
import { ensureAuthenticatedHtml } from "./cdrParser.js";

function normalizeText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTaskSearchText(value = "") {
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

function taskIdFromHref(href = "") {
  const match = String(href).match(/\/portalicc\/etapas-list\/tarefa\/(\d+)/i);
  return match ? match[1] : "";
}

function taskIdFromFormHref(href = "") {
  const match = String(href).match(/\/portalicc\/tarefas-form\/(\d+)/i);
  return match ? match[1] : "";
}

function parsePagination(html, { page = 1, rowCount = 0 } = {}) {
  const $ = cheerio.load(html);
  const summaryText = normalizeText(
    $("span")
      .toArray()
      .map((item) => $(item).text())
      .find((text) => /Exibindo/i.test(text) && /total/i.test(text)) || "",
  );
  const summaryMatch = summaryText.match(
    /Exibindo\s+(\d+)\s+a\s+(\d+)\s+do\s+total\s+de\s+(\d+)\s*-\s*P[aá]gina\s+(\d+)\s+de\s+(\d+)/i,
  );

  const currentPage = summaryMatch ? parseInteger(summaryMatch[4]) : Math.max(1, Number(page) || 1);
  const totalPages = summaryMatch ? parseInteger(summaryMatch[5]) : currentPage;
  const totalItems = summaryMatch ? parseInteger(summaryMatch[3]) : rowCount;
  const from = summaryMatch ? parseInteger(summaryMatch[1]) : rowCount ? 1 : 0;
  const to = summaryMatch ? parseInteger(summaryMatch[2]) : rowCount;

  return {
    currentPage,
    totalPages,
    totalItems,
    from,
    to,
    hasNextPage: totalPages ? currentPage < totalPages : rowCount > 0,
  };
}

function parseTaskStatus($, cell) {
  const text = normalizeText($(cell).text());
  if (text) return text;

  const iconClass = String($(cell).find("i").attr("class") || "");
  if (iconClass.includes("text-success")) return "Ativo";
  if (iconClass.includes("text-danger")) return "Inativo";
  if (iconClass.includes("text-warning")) return "Homologacao";
  return "";
}

export function parseTaskListPage(html, options = {}) {
  ensureAuthenticatedHtml(html);

  const $ = cheerio.load(html);
  const empty = normalizeTaskSearchText($("tbody").text()).includes(
    "nenhum registro encontrado",
  );
  const rows = [];

  $("table tbody tr").each((_, tr) => {
    const cells = $(tr).find("td").toArray();
    if (cells.length < 6) return;
    if ($(cells[0]).attr("colspan")) return;

    const detailHref =
      $(tr).find("a[href*='/portalicc/etapas-list/tarefa/']").first().attr("href") ||
      "";
    const editHref =
      $(tr).find("a[href*='/portalicc/tarefas-form/']").first().attr("href") || "";
    const id = normalizeText($(cells[0]).text()) || taskIdFromHref(detailHref) || taskIdFromFormHref(editHref);

    if (!id || !/^\d+$/.test(id)) return;

    rows.push({
      id,
      tarefa: normalizeText($(cells[1]).text()),
      screator: normalizeText($(cells[2]).text()),
      ultimaExecucao: normalizeText($(cells[3]).text()),
      proximaExecucao: normalizeText($(cells[4]).text()),
      descricao: normalizeText($(cells[5]).text()),
      status: parseTaskStatus($, cells[6]),
      detailHref,
      editHref,
    });
  });

  const pagination = parsePagination(html, {
    page: options.page,
    rowCount: rows.length,
  });

  return {
    rows,
    empty: empty || rows.length === 0,
    pagination,
  };
}

function selectedValue($, element) {
  if (!element) return "";

  const tag = String(element.tagName || "").toLowerCase();
  if (tag === "select") {
    const selected = $(element).find("option[selected], option:selected").first();
    if (selected.length) return normalizeText(selected.text() || selected.attr("value"));
    return normalizeText($(element).find("option").first().text());
  }

  if (tag === "textarea") return normalizeText($(element).text());
  return normalizeText($(element).attr("value"));
}

function fieldValue($, selectors = []) {
  for (const selector of selectors) {
    const element = $(selector).first();
    if (element.length) return selectedValue($, element[0]);
  }
  return "";
}

export function parseTaskStepForm(html, taskFallback = {}) {
  ensureAuthenticatedHtml(html);

  const $ = cheerio.load(html);
  const taskId = fieldValue($, ["input#id", "input[name='id']", "input#tarefaId"]) || taskFallback.id || "";
  if (!taskId) {
    const error = new Error("Nao foi possivel localizar o detalhe da tarefa no Portal ICC.");
    error.code = "PORTAL_TASK_STEP_NOT_FOUND";
    error.status = 404;
    throw error;
  }

  return {
    id: taskId,
    tarefa: fieldValue($, ["input#tarefa", "input[name='tarefa']"]) || taskFallback.tarefa || "",
    status: fieldValue($, ["input#status[disabled]", "input#status[readonly]"]) || taskFallback.status || "",
    screator: taskFallback.screator || "",
    ultimaExecucao: taskFallback.ultimaExecucao || "",
    proximaExecucao: taskFallback.proximaExecucao || "",
    descricao: taskFallback.descricao || "",
    servidor: fieldValue($, ["input#param1SFTP", "input[name='param1']"]),
    usuario: fieldValue($, ["input#param2", "input[name='param2']"]),
    arquivo: fieldValue($, ["input#param4", "input[name='param4']"]),
    local: fieldValue($, ["input#param5", "input[name='param5']"]),
    remoto: fieldValue($, ["input#param6", "input[name='param6']"]),
    acao: fieldValue($, ["select#param7", "select[name='param7']"]),
    etapaIndependente: fieldValue($, ["select#param10", "select[name='param10']"]),
    descricaoEtapa: fieldValue($, ["input#descricao", "input[name='descricao']"]),
    ordemExecucao: fieldValue($, ["input#ordemExecucao", "input[name='ordemExecucao']"]),
    ultimaAtualizacao: fieldValue($, ["input#dtUpd", "input[name='dtUpd']"]),
    atualizadoPor: fieldValue($, ["input#userUpd", "input[name='userUpd']"]),
  };
}

export function taskMatchesSearch(task, filters = {}) {
  const arquivo = normalizeTaskSearchText(filters.arquivo);
  const local = normalizeTaskSearchText(filters.local);
  const remoto = normalizeTaskSearchText(filters.remoto);
  const taskArquivo = normalizeTaskSearchText(task?.arquivo);
  const taskLocal = normalizeTaskSearchText(task?.local);
  const taskRemoto = normalizeTaskSearchText(task?.remoto);

  if (arquivo && !taskArquivo.includes(arquivo)) return false;
  if (local && !taskLocal.includes(local)) return false;
  if (remoto && !taskRemoto.includes(remoto)) return false;
  return Boolean(arquivo || local || remoto);
}
