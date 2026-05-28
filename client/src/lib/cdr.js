const API_BASE = "/api/tools/cdr";

export const DEFAULT_CDR_FIELDS = [
  { value: "0", label: "Nenhum" },
  { value: "ani", label: "ANI" },
  { value: "msisdn", label: "MSISDN" },
  { value: "dnis", label: "DNIS" },
  { value: "callId", label: "CallID" },
  { value: "codigoAplicacao", label: "Codigo Aplicacao" },
  { value: "versaoAplicacao", label: "Versao Aplicacao" },
  { value: "disconnectionTypeDesc", label: "Disconnection Type" },
  { value: "nomeSkill", label: "Nome Skill" },
  { value: "idSkill", label: "Id Skill" },
  { value: "digitCode", label: "Digit Code" },
];

export class CdrApiError extends Error {
  constructor(message, { status = 0, code = "CDR_API_ERROR", details = null } = {}) {
    super(message || "Falha na Consulta CDR.");
    this.name = "CdrApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");

  if (!response.ok) {
    const error = body?.error || body || {};
    throw new CdrApiError(
      error?.message || body?.message || `Erro HTTP ${response.status}`,
      {
        status: response.status,
        code: error?.code || body?.code || "CDR_API_ERROR",
        details: error?.details || null,
      },
    );
  }

  return body;
}

export async function getCdrAuthStatus() {
  return request("/auth/status");
}

export async function loginCdrPortal({ username, password }) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function logoutCdrPortal() {
  return request("/auth/logout", {
    method: "POST",
  });
}

export async function getCdrFields() {
  return request("/fields");
}

export async function searchCdr(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    params.set(key, value ?? "");
  });

  return request(`/search?${params.toString()}`);
}
