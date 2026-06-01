import axios from "axios";
import * as cheerio from "cheerio";
import http from "node:http";
import https from "node:https";
import { CookieJar } from "tough-cookie";
import { parseCdrResponse, ensureAuthenticatedHtml } from "./cdrParser.js";

const BROWSER_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";

const BASE_HEADERS = {
  Accept: BROWSER_ACCEPT,
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
};

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
        "Nao foi possivel localizar o token _csrf na pagina de login.",
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
      const error = new Error("Sessao Portal ICC nao confirmada.");
      error.code = "PORTAL_SESSION_EXPIRED";
      error.status = 401;
      throw error;
    }

    return html;
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
          "Sessao Portal ICC expirada. Faca login novamente.",
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
        const error = new Error("Sessao Portal ICC expirada.");
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
      campo1: "segmento",
      valor1: filters.segmento || filters.valor1 || "",
    };

    if (!params.dataInicial || !params.dataFinal) {
      const error = new Error("dataInicial e dataFinal sao obrigatorias.");
      error.status = 400;
      throw error;
    }

    if (!params.valor1) {
      const error = new Error("segmento e obrigatorio.");
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
          "Sessao Portal ICC expirada. Faca login novamente.",
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
        const error = new Error("Sessao Portal ICC expirada.");
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
}
