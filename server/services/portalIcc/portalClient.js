import axios from "axios";
import * as cheerio from "cheerio";
import http from "node:http";
import https from "node:https";
import { CookieJar } from "tough-cookie";
import { parseCdrResponse, ensureAuthenticatedHtml } from "./cdrParser.js";
import { parseCustomReportHtml } from "./customReportParser.js";
import {
  normalizeTaskSearchText,
  parseTaskListPage,
  parseTaskStepForm,
  taskMatchesSearch,
} from "./tasksParser.js";

const BROWSER_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";

const BASE_HEADERS = {
  Accept: BROWSER_ACCEPT,
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
};

export const ALLOWED_BUSINESS_HOURS_DATABASES = new Set([
  "P00HU1",
  "P00HU2",
  "P00HU3",
  "P00HU3_URACLOUD",
  "P00HU3_URACEC",
  "P01CT2",
  "CSPORA",
  "MSPORA",
  "AWS_ROTEAMENTO",
]);

const DEFAULT_BUSINESS_HOURS_DATABASE = "AWS_ROTEAMENTO";
const BR_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeBusinessHoursDate(value) {
  const date = normalizeText(value);
  const match = BR_DATE_RE.exec(date);
  if (!match) return "";

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return "";
  }

  return date;
}

function sqlString(value) {
  return normalizeText(value).replace(/'/g, "''");
}

export function sanitizeCustomReportSql(value = "") {
  return String(value || "").trim().replace(/;+[\s;]*$/g, "").trim();
}

function normalizeUraKey(value) {
  return normalizeText(value).toUpperCase();
}

function uniqueBusinessHoursUras(uras = []) {
  const seen = new Set();
  const result = [];

  for (const value of Array.isArray(uras) ? uras : []) {
    const ura = normalizeText(value);
    const key = normalizeUraKey(ura);
    if (!ura || seen.has(key)) continue;
    seen.add(key);
    result.push(ura);
  }

  return result;
}

function pickColumn(row = {}, columnName) {
  const wanted = normalizeUraKey(columnName);
  const match = Object.keys(row).find((key) => normalizeUraKey(key) === wanted);
  return match ? normalizeText(row[match]) : "";
}

export function normalizeBusinessHoursRequest({
  database = DEFAULT_BUSINESS_HOURS_DATABASE,
  date,
  uras,
} = {}) {
  const safeDatabase = normalizeText(database || DEFAULT_BUSINESS_HOURS_DATABASE);
  if (!ALLOWED_BUSINESS_HOURS_DATABASES.has(safeDatabase)) {
    const error = new Error("Banco nao permitido para verificacao.");
    error.status = 400;
    error.code = "BUSINESS_HOURS_INVALID_DATABASE";
    throw error;
  }

  const safeDate = normalizeBusinessHoursDate(date);
  if (!safeDate) {
    const error = new Error("Data deve estar no formato DD/MM/YYYY.");
    error.status = 400;
    error.code = "BUSINESS_HOURS_INVALID_DATE";
    throw error;
  }

  const safeUras = uniqueBusinessHoursUras(uras);
  if (!safeUras.length) {
    const error = new Error("Selecione pelo menos uma URA para verificar.");
    error.status = 400;
    error.code = "BUSINESS_HOURS_EMPTY_URAS";
    throw error;
  }

  return {
    database: safeDatabase,
    date: safeDate,
    uras: safeUras,
  };
}

export function buildBusinessHoursVerificationSql({ date, uras } = {}) {
  const safeDate = normalizeBusinessHoursDate(date);
  const safeUras = uniqueBusinessHoursUras(uras);

  if (!safeDate || !safeUras.length) {
    const error = new Error("Data e URAs validas sao obrigatorias.");
    error.status = 400;
    throw error;
  }

  const uraList = safeUras
    .map((ura) => `'${sqlString(normalizeUraKey(ura))}'`)
    .join(",\n      ");

  return sanitizeCustomReportSql(`SELECT
    NOME,
    DIA_SEMANA,
    DATA,
    ABERTURA,
    FECHAMENTO,
    STATUS
FROM TB_BUSSINESSHOURS
WHERE TRIM(DATA) = '${sqlString(safeDate)}'
  AND UPPER(TRIM(NOME)) IN (
      ${uraList}
  )
ORDER BY
    NOME,
    ABERTURA,
    FECHAMENTO,
    STATUS`);
}

export function normalizeBusinessHoursReportRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      nome: pickColumn(row, "NOME"),
      diaSemana: pickColumn(row, "DIA_SEMANA"),
      data: pickColumn(row, "DATA"),
      abertura: pickColumn(row, "ABERTURA"),
      fechamento: pickColumn(row, "FECHAMENTO"),
      status: pickColumn(row, "STATUS"),
    }))
    .filter((row) => row.nome || row.data || row.abertura || row.fechamento || row.status);
}

export function buildBusinessHoursCoverage({ selectedUras = [], rows = [] } = {}) {
  const normalizedRows = normalizeBusinessHoursReportRows(rows);
  const rowsByUra = new Map();

  normalizedRows.forEach((row) => {
    const key = normalizeUraKey(row.nome);
    if (!key) return;
    const current = rowsByUra.get(key) || [];
    current.push(row);
    rowsByUra.set(key, current);
  });

  const coverage = uniqueBusinessHoursUras(selectedUras).map((ura) => {
    const matches = rowsByUra.get(normalizeUraKey(ura)) || [];
    const status =
      matches.length === 0
        ? "missing"
        : matches.length === 1
          ? "configured"
          : "multiple_rules";

    return {
      ura,
      configured: matches.length > 0,
      status,
      rows: matches,
    };
  });

  return {
    rows: normalizedRows,
    coverage,
    summary: {
      selected: coverage.length,
      configured: coverage.filter((item) => item.configured).length,
      missing: coverage.filter((item) => !item.configured).length,
      rows: normalizedRows.length,
    },
  };
}

function normalizeBaseUrl(env) {
  return String(
    env.PORTAL_ICC_BASE_URL ||
      env.PORTAL_BASE_URL ||
      "https://portalicc.claro.com.br",
  ).replace(/\/+$/, "");
}

function portalPathUrl(baseUrl, path) {
  return `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

function parseProxyConfig(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "false" || raw === "0") return false;

  try {
    const url = new URL(raw);
    return {
      protocol: url.protocol.replace(":", ""),
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      auth: url.username
        ? {
            username: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password || ""),
          }
        : undefined,
    };
  } catch {
    return false;
  }
}

function shouldRejectUnauthorized(env) {
  const value = env.PORTAL_ICC_TLS_REJECT_UNAUTHORIZED;
  if (value === false) return false;
  return String(value ?? "true").toLowerCase() !== "false";
}

function resolveRequestUrl(config, fallbackBaseUrl) {
  return new URL(config?.url || "", config?.baseURL || fallbackBaseUrl).toString();
}

async function storeResponseCookies(jar, response, fallbackBaseUrl) {
  const setCookie = response?.headers?.["set-cookie"];
  if (!setCookie) return;

  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  const requestUrl = resolveRequestUrl(response.config, fallbackBaseUrl);
  await Promise.all(cookies.map((cookie) => jar.setCookie(cookie, requestUrl)));
}

function createCookieAwareAxios({ baseURL, jar, rejectUnauthorized, timeout, proxy, headers }) {
  const client = axios.create({
    baseURL,
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({
      keepAlive: true,
      rejectUnauthorized,
    }),
    withCredentials: true,
    timeout,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
    proxy,
    headers,
  });

  client.interceptors.request.use(async (config) => {
    const requestUrl = resolveRequestUrl(config, baseURL);
    const cookieHeader = await jar.getCookieString(requestUrl);

    if (cookieHeader) {
      config.headers = config.headers || {};
      config.headers.Cookie = cookieHeader;
    }

    return config;
  });

  client.interceptors.response.use(
    async (response) => {
      await storeResponseCookies(jar, response, baseURL);
      return response;
    },
    async (error) => {
      if (error?.response) {
        await storeResponseCookies(jar, error.response, baseURL);
      }
      throw error;
    },
  );

  return client;
}

function logPortalError(scope, step, error) {
  console.error(`[${scope}] ${step} failed`, {
    message: error?.message,
    code: error?.code,
    status: error?.response?.status,
    location: error?.response?.headers?.location,
    address: error?.address || error?.cause?.address,
    port: error?.port || error?.cause?.port,
  });
}

function extractCsrf(html) {
  const $ = cheerio.load(html);
  const csrfInput = $("input[name='_csrf']").first();
  const csrfMeta = $("meta[name='_csrf']").first();

  if (csrfInput.length) return csrfInput.attr("value") || "";
  if (csrfMeta.length) return csrfMeta.attr("content") || "";
  return "";
}

function summarizeHtml(html) {
  const $ = cheerio.load(html);
  return {
    title: $("title").first().text().trim(),
    hasLogoutLink: $("a[href*='/portalicc/logout']").length > 0,
    hasAccountLink: $("a[href*='/portalicc/account']").length > 0,
    hasUserInfo: $(".user-info").length > 0,
    hasPasswordInput:
      $("input[type='password'], input[name='password']").length > 0,
    hasUsernameInput:
      $("input[name='username'], input[name='j_username']").length > 0,
  };
}

function hasAuthenticatedSignals(html) {
  const summary = summarizeHtml(html);
  return (
    summary.hasLogoutLink ||
    summary.hasAccountLink ||
    summary.hasUserInfo ||
    /Portal\s+Infra-CallCenter/i.test(summary.title || "")
  );
}

function absolutizeLocation(baseUrl, location) {
  if (!location) return null;
  if (/^https?:\/\//i.test(location)) return location;
  return `${baseUrl}${location.startsWith("/") ? "" : "/"}${location}`;
}

function normalizePortalLocation(baseUrl, location) {
  const absolute = absolutizeLocation(baseUrl, location);
  if (!absolute) return null;

  const base = new URL(baseUrl);
  const redirected = new URL(absolute);

  if (redirected.origin === base.origin && redirected.pathname === "/index") {
    redirected.pathname = "/portalicc/index";
  }

  return redirected.toString();
}

export class PortalIccClient {
  constructor({ env }) {
    this.env = env;
    this.baseUrl = normalizeBaseUrl(env);
    this.jar = new CookieJar();
    this.username = "";
    this.loggedAt = null;
    this.rejectUnauthorized = shouldRejectUnauthorized(env);

    if (!this.rejectUnauthorized) {
      console.warn(
        "[portal-login] TLS certificate verification is disabled for Portal ICC requests",
      );
    }

    this.client = createCookieAwareAxios({
      baseURL: this.baseUrl,
      timeout: Number(env.PORTAL_ICC_TIMEOUT_MS || 45_000),
      jar: this.jar,
      rejectUnauthorized: this.rejectUnauthorized,
      proxy: parseProxyConfig(env.PORTAL_ICC_PROXY),
      headers: BASE_HEADERS,
    });
  }

  portalUrl(path) {
    return portalPathUrl(this.baseUrl, path);
  }

  async getCookies() {
    return this.jar.getCookies(this.baseUrl);
  }

  async getSafeSessionSummary() {
    const cookies = await this.getCookies();
    const cookieNames = cookies.map((cookie) => cookie.key);

    return {
      username: this.username,
      loggedAt: this.loggedAt,
      hasJSessionId: cookieNames.includes("JSESSIONID"),
      cookieNames,
    };
  }

  async loadLoginPage() {
    const path = "/portalicc/login?logout=true";
    const startedAt = Date.now();

    console.log("[portal-login] GET login page", {
      url: this.portalUrl(path),
    });

    try {
      const response = await this.client.get(path, {
        headers: {
          ...BASE_HEADERS,
          "Cache-Control": "max-age=0",
        },
      });

      const html = String(response.data || "");
      const csrf = extractCsrf(html);

      console.log("[portal-login] GET login page response", {
        url: this.portalUrl(path),
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        htmlLength: html.length,
        hasCsrf: Boolean(csrf),
      });

      return { html, csrf, status: response.status };
    } catch (error) {
      logPortalError("portal-login", "GET login page", error);
      throw error;
    }
  }

  async login({ username, password }) {
    const safeUsername = String(username || "").trim();
    const portalPassword = String(password || "");

    if (!safeUsername || !portalPassword) {
      const error = new Error("Informe usuario e senha do Portal ICC.");
      error.status = 400;
      throw error;
    }

    console.log("[portal-login] login started", {
      username: safeUsername,
      portalBaseUrl: this.baseUrl,
    });

    const loginPage = await this.loadLoginPage();
    if (!loginPage.csrf) {
      const error = new Error(
        "Não foi possível localizar o token _csrf na página de login.",
      );
      error.status = 502;
      throw error;
    }

    const body = new URLSearchParams();
    body.set("_csrf", loginPage.csrf);
    body.set("username", safeUsername);
    body.set("password", portalPassword);

    const loginStartedAt = Date.now();
    console.log("[portal-login] POST login", {
      url: this.portalUrl("/portalicc/login"),
      origin: this.baseUrl,
      referer: this.portalUrl("/portalicc/login?logout=true"),
      hasCsrf: Boolean(loginPage.csrf),
      username: safeUsername,
    });

    let loginResponse;
    try {
      loginResponse = await this.client.post("/portalicc/login", body, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Origin: this.baseUrl,
          Referer: this.portalUrl("/portalicc/login?logout=true"),
        },
      });
    } catch (error) {
      logPortalError("portal-login", "POST login", error);
      throw error;
    }

    const redirectedTo = normalizePortalLocation(
      this.baseUrl,
      loginResponse.headers.location || "",
    );

    console.log("[portal-login] POST login response", {
      url: this.portalUrl("/portalicc/login"),
      status: loginResponse.status,
      elapsedMs: Date.now() - loginStartedAt,
      redirect: redirectedTo,
    });

    if (redirectedTo && redirectedTo.includes("/portalicc/login")) {
      const error = new Error(
        "Login recusado pelo Portal ICC. Verifique usuario e senha.",
      );
      error.status = 401;
      throw error;
    }

    const indexUrl = redirectedTo || this.portalUrl("/portalicc/index");
    const indexStartedAt = Date.now();
    console.log("[portal-login] GET index", { url: indexUrl });

    let indexResponse;
    try {
      indexResponse = await this.client.get(indexUrl, {
        headers: {
          ...BASE_HEADERS,
          Referer: this.portalUrl("/portalicc/login?logout=true"),
          "Upgrade-Insecure-Requests": "1",
        },
      });
    } catch (error) {
      logPortalError("portal-login", "GET index", error);
      throw error;
    }

    const html = String(indexResponse.data || "");
    const summary = summarizeHtml(html);

    console.log("[portal-login] GET index response", {
      status: indexResponse.status,
      elapsedMs: Date.now() - indexStartedAt,
      htmlLength: html.length,
      ...summary,
    });

    ensureAuthenticatedHtml(html);
    if (!hasAuthenticatedSignals(html)) {
      const error = new Error("Autenticacao Portal ICC nao confirmada.");
      error.status = 401;
      throw error;
    }

    this.username = safeUsername;
    this.loggedAt = new Date().toISOString();

    console.log("[portal-login] login confirmed", {
      username: this.username,
      loggedAt: this.loggedAt,
    });

    return this.getSafeSessionSummary();
  }

  async assertIndexSession() {
    const response = await this.client.get("/portalicc/index", {
      headers: {
        ...BASE_HEADERS,
        Referer: this.portalUrl("/portalicc/login"),
        "Upgrade-Insecure-Requests": "1",
      },
    });

    const html = String(response.data || "");
    ensureAuthenticatedHtml(html);
    if (!hasAuthenticatedSignals(html)) {
      const error = new Error("Sessão Portal ICC não confirmada.");
      error.code = "PORTAL_SESSION_EXPIRED";
      error.status = 401;
      throw error;
    }

    return html;
  }

  async loadCustomReportPage() {
    const path = "/portalicc/relatorios-customizados";
    const startedAt = Date.now();

    console.log("[portal-custom-report] GET page", {
      url: this.portalUrl(path),
    });

    let response;
    try {
      response = await this.client.get(path, {
        headers: {
          ...BASE_HEADERS,
          Referer: this.portalUrl("/portalicc/index"),
          "Upgrade-Insecure-Requests": "1",
        },
      });
    } catch (error) {
      logPortalError("portal-custom-report", "GET page", error);
      if (Number(error?.response?.status) === 417) {
        const sessionError = new Error(
          "Sessao Portal ICC expirada. Faca login novamente.",
        );
        sessionError.code = "PORTAL_SESSION_EXPIRED";
        sessionError.status = 401;
        throw sessionError;
      }
      throw error;
    }

    const location = normalizePortalLocation(
      this.baseUrl,
      response.headers.location || "",
    );
    if (response.status >= 300 && response.status < 400) {
      if (String(location || "").includes("/portalicc/login")) {
        const error = new Error("Sessao Portal ICC expirada.");
        error.code = "PORTAL_SESSION_EXPIRED";
        error.status = 401;
        throw error;
      }
    }

    const html = String(response.data || "");
    ensureAuthenticatedHtml(html);
    const csrf = extractCsrf(html);

    console.log("[portal-custom-report] GET page response", {
      status: response.status,
      location,
      elapsedMs: Date.now() - startedAt,
      htmlLength: html.length,
      hasCsrf: Boolean(csrf),
    });

    if (!csrf) {
      const error = new Error(
        "Nao foi possivel localizar o token _csrf no relatorio customizado.",
      );
      error.status = 502;
      error.code = "PORTAL_CUSTOM_REPORT_CSRF_NOT_FOUND";
      throw error;
    }

    return { html, csrf };
  }

  async executeCustomReport({ database, sql } = {}) {
    const safeDatabase = normalizeText(database);
    const safeSql = sanitizeCustomReportSql(sql);

    if (!safeDatabase || !safeSql) {
      const error = new Error("Banco e SQL sao obrigatorios.");
      error.status = 400;
      throw error;
    }

    const page = await this.loadCustomReportPage();
    const body = new URLSearchParams();
    body.set("_csrf", page.csrf);
    body.set("database", safeDatabase);
    body.set("sql", safeSql);

    const startedAt = Date.now();
    let response;
    try {
      response = await this.client.post(
        "/portalicc/relatorios-customizados",
        body,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: BROWSER_ACCEPT,
            Origin: this.baseUrl,
            Referer: this.portalUrl("/portalicc/relatorios-customizados"),
          },
        },
      );
    } catch (error) {
      logPortalError("portal-custom-report", "POST report", error);
      if (Number(error?.response?.status) === 417) {
        const sessionError = new Error(
          "Sessao Portal ICC expirada. Faca login novamente.",
        );
        sessionError.code = "PORTAL_SESSION_EXPIRED";
        sessionError.status = 401;
        throw sessionError;
      }
      throw error;
    }

    const location = normalizePortalLocation(
      this.baseUrl,
      response.headers.location || "",
    );
    if (response.status >= 300 && response.status < 400) {
      if (String(location || "").includes("/portalicc/login")) {
        const error = new Error("Sessao Portal ICC expirada.");
        error.code = "PORTAL_SESSION_EXPIRED";
        error.status = 401;
        throw error;
      }
    }

    let html = String(response.data || "");
    let finalStatus = response.status;
    let finalLocation = location;

    if (response.status >= 300 && response.status < 400 && location) {
      const followStartedAt = Date.now();
      let followResponse;
      try {
        followResponse = await this.client.get(location, {
          headers: {
            ...BASE_HEADERS,
            Referer: this.portalUrl("/portalicc/relatorios-customizados"),
            "Upgrade-Insecure-Requests": "1",
          },
        });
      } catch (error) {
        logPortalError("portal-custom-report", "GET redirected report", error);
        throw error;
      }

      finalStatus = followResponse.status;
      finalLocation = normalizePortalLocation(
        this.baseUrl,
        followResponse.headers.location || "",
      );
      html = String(followResponse.data || "");

      console.log("[portal-custom-report] GET redirected report response", {
        status: finalStatus,
        location: finalLocation,
        elapsedMs: Date.now() - followStartedAt,
        htmlLength: html.length,
      });
    }

    const parsed = parseCustomReportHtml(html);

    console.log("[portal-custom-report] POST report response", {
      status: response.status,
      finalStatus,
      location,
      finalLocation,
      elapsedMs: Date.now() - startedAt,
      htmlLength: html.length,
      rows: parsed.rows.length,
      total: parsed.total,
    });

    return parsed;
  }

  async verifyBusinessHours(input = {}) {
    const request = normalizeBusinessHoursRequest(input);
    const sql = buildBusinessHoursVerificationSql(request);
    const report = await this.executeCustomReport({
      database: request.database,
      sql,
    });
    const coverage = buildBusinessHoursCoverage({
      selectedUras: request.uras,
      rows: report.rows,
    });

    return {
      database: request.database,
      date: request.date,
      selectedUras: request.uras,
      summary: coverage.summary,
      coverage: coverage.coverage,
      raw: {
        columns: report.columns,
        rows: report.rows,
        total: report.total,
      },
    };
  }

  async searchCdr(filters = {}) {
    const page = Math.max(1, Number(filters.page || 1) || 1);
    const params = {
      sortField: filters.sortField || "dataInicioLigacaoUra",
      sortOrder: filters.sortOrder || "desc",
      dataInicial: filters.dataInicial || "",
      dataFinal: filters.dataFinal || "",
      campo1: filters.campo1 || "0",
      valor1: filters.valor1 || "",
      campo2: filters.campo2 || "0",
      valor2: filters.valor2 || "",
      campo3: filters.campo3 || "0",
      valor3: filters.valor3 || "",
      campo4: filters.campo4 || "0",
      valor4: filters.valor4 || "",
      campo5: filters.campo5 || "0",
      valor5: filters.valor5 || "",
    };

    if (!params.dataInicial || !params.dataFinal) {
      const error = new Error("dataInicial e dataFinal sao obrigatorias.");
      error.status = 400;
      throw error;
    }

    const path = `/portalicc/cdr-list/page/${page}`;
    const startedAt = Date.now();
    const cookies = await this.getCookies();

    console.log("[portal-cdr] GET search request", {
      url: this.portalUrl(path),
      params,
      cookieNames: cookies.map((cookie) => cookie.key),
      hasJSessionId: cookies.some((cookie) => cookie.key === "JSESSIONID"),
    });

    let response;
    try {
      response = await this.client.get(path, {
        params,
        headers: {
          ...BASE_HEADERS,
          Referer: this.portalUrl("/portalicc/index"),
          "Upgrade-Insecure-Requests": "1",
        },
      });
    } catch (error) {
      logPortalError("portal-cdr", "GET search", error);
      if (Number(error?.response?.status) === 417) {
        const sessionError = new Error(
          "Sessão Portal ICC expirada. Faça login novamente.",
        );
        sessionError.code = "PORTAL_SESSION_EXPIRED";
        sessionError.status = 401;
        sessionError.details = {
          upstreamStatus: 417,
          location: error?.response?.headers?.location || "",
        };
        throw sessionError;
      }
      throw error;
    }

    const location = normalizePortalLocation(
      this.baseUrl,
      response.headers.location || "",
    );
    const html = String(response.data || "");

    console.log("[portal-cdr] response", {
      status: response.status,
      location,
      elapsedMs: Date.now() - startedAt,
      htmlLength: html.length,
      ...summarizeHtml(html),
    });

    if (response.status >= 300 && response.status < 400) {
      if (String(location || "").includes("/portalicc/login")) {
        const error = new Error("Sessão Portal ICC expirada.");
        error.code = "PORTAL_SESSION_EXPIRED";
        error.status = 401;
        throw error;
      }
    }

    const parsed = parseCdrResponse(html, { page });
    return {
      ...parsed,
      filters: params,
      page,
      rawHtmlLength: html.length,
    };
  }

  async exportCdrCsv(filters = {}) {
    const params = {
      dataInicial: filters.dataInicial || "",
      dataFinal: filters.dataFinal || "",
      campo1: filters.campo1 || (filters.segmento ? "segmento" : "0"),
      valor1: filters.valor1 || filters.segmento || "",
      campo2: filters.campo2 || "0",
      valor2: filters.valor2 || "",
      campo3: filters.campo3 || "0",
      valor3: filters.valor3 || "",
      campo4: filters.campo4 || "0",
      valor4: filters.valor4 || "",
      campo5: filters.campo5 || "0",
      valor5: filters.valor5 || "",
    };

    if (!params.dataInicial || !params.dataFinal) {
      const error = new Error("dataInicial e dataFinal sao obrigatorias.");
      error.status = 400;
      throw error;
    }

    const path = "/portalicc/cdr-list/export";
    const startedAt = Date.now();
    const cookies = await this.getCookies();

    console.log("[portal-cdr] GET export request", {
      url: this.portalUrl(path),
      params,
      cookieNames: cookies.map((cookie) => cookie.key),
      hasJSessionId: cookies.some((cookie) => cookie.key === "JSESSIONID"),
    });

    let response;
    try {
      response = await this.client.get(path, {
        params,
        responseType: "arraybuffer",
        headers: {
          ...BASE_HEADERS,
          Accept: "text/csv,application/csv,text/plain,*/*",
          Referer: this.portalUrl("/portalicc/index"),
          "Upgrade-Insecure-Requests": "1",
        },
      });
    } catch (error) {
      logPortalError("portal-cdr", "GET export", error);
      if (Number(error?.response?.status) === 417) {
        const sessionError = new Error(
          "Sessão Portal ICC expirada. Faça login novamente.",
        );
        sessionError.code = "PORTAL_SESSION_EXPIRED";
        sessionError.status = 401;
        sessionError.details = {
          upstreamStatus: 417,
          location: error?.response?.headers?.location || "",
        };
        throw sessionError;
      }
      throw error;
    }

    const location = normalizePortalLocation(
      this.baseUrl,
      response.headers.location || "",
    );

    if (response.status >= 300 && response.status < 400) {
      if (String(location || "").includes("/portalicc/login")) {
        const error = new Error("Sessão Portal ICC expirada.");
        error.code = "PORTAL_SESSION_EXPIRED";
        error.status = 401;
        throw error;
      }
    }

    const buffer = Buffer.from(response.data || "");
    const text = buffer.toString("utf8");

    console.log("[portal-cdr] export response", {
      status: response.status,
      location,
      elapsedMs: Date.now() - startedAt,
      bytes: buffer.length,
      contentType: response.headers["content-type"] || "",
    });

    ensureAuthenticatedHtml(text);
    return {
      csvText: text,
      bytes: buffer.length,
      contentType: response.headers["content-type"] || "",
      filename: response.headers["content-disposition"] || "",
      filters: params,
    };
  }

  async listTaskPage(page = 1) {
    const currentPage = Math.max(1, Number(page || 1) || 1);
    const path = `/portalicc/tarefas-list/page/${currentPage}`;
    const params = {
      sortField: "tarefaId",
      sortOrder: "desc",
    };
    const startedAt = Date.now();

    console.log("[portal-tasks] GET list request", {
      url: this.portalUrl(path),
      params,
      page: currentPage,
    });

    let response;
    try {
      response = await this.client.get(path, {
        params,
        headers: {
          ...BASE_HEADERS,
          Referer: this.portalUrl("/portalicc/index"),
          "Upgrade-Insecure-Requests": "1",
        },
      });
    } catch (error) {
      logPortalError("portal-tasks", "GET list", error);
      if (Number(error?.response?.status) === 417) {
        const sessionError = new Error(
          "Sessão Portal ICC expirada. Faça login novamente.",
        );
        sessionError.code = "PORTAL_SESSION_EXPIRED";
        sessionError.status = 401;
        throw sessionError;
      }
      throw error;
    }

    const location = normalizePortalLocation(
      this.baseUrl,
      response.headers.location || "",
    );
    if (response.status >= 300 && response.status < 400) {
      if (String(location || "").includes("/portalicc/login")) {
        const error = new Error("Sessão Portal ICC expirada.");
        error.code = "PORTAL_SESSION_EXPIRED";
        error.status = 401;
        throw error;
      }
    }

    const html = String(response.data || "");
    const parsed = parseTaskListPage(html, { page: currentPage });

    console.log("[portal-tasks] list response", {
      status: response.status,
      location,
      elapsedMs: Date.now() - startedAt,
      htmlLength: html.length,
      page: currentPage,
      rows: parsed.rows.length,
      totalPages: parsed.pagination.totalPages,
      totalItems: parsed.pagination.totalItems,
      empty: parsed.empty,
    });

    return {
      ...parsed,
      page: currentPage,
      rawHtmlLength: html.length,
    };
  }

  async getTaskStepForm(task) {
    const taskId = typeof task === "object" ? task.id : task;
    const safeTaskId = String(taskId || "").replace(/[^\d]/g, "");
    if (!safeTaskId) {
      const error = new Error("ID da tarefa é obrigatório.");
      error.status = 400;
      throw error;
    }

    const path = `/portalicc/etapas-form/tarefa/${safeTaskId}/1`;
    const startedAt = Date.now();

    console.log("[portal-tasks] GET step request", {
      url: this.portalUrl(path),
      taskId: safeTaskId,
    });

    let response;
    try {
      response = await this.client.get(path, {
        headers: {
          ...BASE_HEADERS,
          Referer: this.portalUrl(`/portalicc/etapas-list/tarefa/${safeTaskId}`),
          "Upgrade-Insecure-Requests": "1",
        },
      });
    } catch (error) {
      logPortalError("portal-tasks", "GET step", error);
      if (Number(error?.response?.status) === 417) {
        const sessionError = new Error(
          "Sessão Portal ICC expirada. Faça login novamente.",
        );
        sessionError.code = "PORTAL_SESSION_EXPIRED";
        sessionError.status = 401;
        throw sessionError;
      }
      throw error;
    }

    const location = normalizePortalLocation(
      this.baseUrl,
      response.headers.location || "",
    );
    if (response.status >= 300 && response.status < 400) {
      if (String(location || "").includes("/portalicc/login")) {
        const error = new Error("Sessão Portal ICC expirada.");
        error.code = "PORTAL_SESSION_EXPIRED";
        error.status = 401;
        throw error;
      }
    }

    const html = String(response.data || "");
    const parsed = parseTaskStepForm(html, {
      ...(typeof task === "object" ? task : {}),
      id: safeTaskId,
    });

    console.log("[portal-tasks] step response", {
      status: response.status,
      location,
      elapsedMs: Date.now() - startedAt,
      htmlLength: html.length,
      taskId: safeTaskId,
      hasArquivo: Boolean(parsed.arquivo),
      hasRemoto: Boolean(parsed.remoto),
    });

    return parsed;
  }

  async searchTasksByFileRemote(filters = {}) {
    const arquivo = String(filters.arquivo || "").trim();
    const local = String(filters.local || "").trim();
    const remoto = String(filters.remoto || "").trim();

    if (!arquivo && !local && !remoto) {
      const error = new Error("Informe Arquivo, Local e/ou Remoto para pesquisar.");
      error.status = 400;
      throw error;
    }

    const pages = [];
    const tasks = [];
    let page = 1;
    let keepReading = true;

    while (keepReading) {
      const pageResult = await this.listTaskPage(page);
      pages.push({
        page,
        rows: pageResult.rows.length,
        empty: pageResult.empty,
        pagination: pageResult.pagination,
      });

      tasks.push(...pageResult.rows);

      keepReading = !pageResult.empty && pageResult.pagination.hasNextPage;
      page += 1;
    }

    const uniqueTasks = [...new Map(tasks.map((task) => [task.id, task])).values()];
    const matched = [];
    const failures = [];
    let analyzed = 0;
    const concurrency = Math.max(1, Math.min(10, Number(filters.concurrency || 5) || 5));
    let cursor = 0;

    async function worker() {
      while (cursor < uniqueTasks.length) {
        const currentIndex = cursor;
        cursor += 1;
        const task = uniqueTasks[currentIndex];
        let detail;
        try {
          detail = await this.getTaskStepForm(task);
          analyzed += 1;
        } catch (error) {
          if (error?.code === "PORTAL_SESSION_EXPIRED") throw error;
          failures.push({
            id: task.id,
            tarefa: task.tarefa,
            code: error?.code || "PORTAL_TASK_DETAIL_ERROR",
            message: error?.message || "Falha ao analisar detalhe da tarefa.",
          });
          console.warn("[portal-tasks] step skipped", {
            taskId: task.id,
            code: error?.code,
            message: error?.message,
          });
          continue;
        }

        if (taskMatchesSearch(detail, { arquivo, local, remoto })) {
          matched.push(detail);
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, uniqueTasks.length) }, () =>
        worker.call(this),
      ),
    );

    matched.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));

    return {
      filters: {
        arquivo,
        local,
        remoto,
        normalizedArquivo: normalizeTaskSearchText(arquivo),
        normalizedLocal: normalizeTaskSearchText(local),
        normalizedRemoto: normalizeTaskSearchText(remoto),
      },
      summary: {
        pagesRead: pages.length,
        tasksFound: uniqueTasks.length,
        detailsAnalyzed: analyzed,
        detailsFailed: failures.length,
        matches: matched.length,
      },
      pages,
      failures,
      rows: matched,
    };
  }
}
