export class AppError extends Error {
  constructor({
    message,
    status = 500,
    code = "INTERNAL_ERROR",
    details = null,
    expose = true,
  }) {
    super(message || "Unexpected error");
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose;
  }
}

export function createRequestLogger(req) {
  return function log(level, message, extra = {}) {
    const payload = {
      level,
      message,
      requestId: req.id,
      method: req.method,
      path: req.originalUrl || req.url,
      ...extra,
    };

    const line = JSON.stringify(payload);
    if (level === "error") return console.error(line);
    if (level === "warn") return console.warn(line);
    return console.log(line);
  };
}

export function createErrorPayload(err, requestId) {
  const status = Number(err?.status || 500);
  const code = String(err?.code || "INTERNAL_ERROR");
  const message =
    err?.expose === false && status >= 500
      ? "Internal server error"
      : String(err?.message || "Internal server error");

  return {
    error: {
      code,
      message,
      details: err?.details ?? null,
      requestId,
    },
  };
}

export function sendError(res, err) {
  return res
    .status(Number(err?.status || 500))
    .json(createErrorPayload(err, res.locals.requestId || null));
}

export function asyncRoute(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text.slice(0, 1000);
}

export async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 15000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new AppError({
        status: 504,
        code: "UPSTREAM_TIMEOUT",
        message: `Upstream timeout after ${timeoutMs}ms`,
        details: { url, timeoutMs },
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
