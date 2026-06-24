const API_BASE = "/api/tools/cdr";

export const DEFAULT_CDR_FIELDS = [
  { value: "0", label: "Nenhum" },
  { value: "call_id", label: "CALLID" },
  { value: "msisdn", label: "MSISDN" },
  { value: "ani", label: "ANI" },
  { value: "dnis", label: "DNIS" },
  { value: "codigo_aplicacao", label: "CODIGO APLICACAO" },
  { value: "versao_aplicacao", label: "VERSAO APLICACAO" },
  { value: "data_inicio_ligacao_ura", label: "DATA INICIO LIGACAO URA" },
  { value: "data_fim_ligacao_ura", label: "DATA FIM LIGACAO URA" },
  { value: "disconnection_type_desc", label: "DISCONNECTION TYPE DESC" },
  { value: "duracao_total_chamada", label: "DURACAO TOTAL CHAMADA" },
  { value: "duracao_chamada_ura", label: "DURACAO CHAMADA URA" },
  { value: "access_code_entrada", label: "ACCESS CODE ENTRADA" },
  { value: "digit_code", label: "DIGIT CODE" },
  { value: "mpl_grupo", label: "MPL GRUPO" },
  { value: "grupo_funcional", label: "GRUPO FUNCIONAL" },
  { value: "script_point_desc", label: "SCRIPT POINT DESC" },
  { value: "id_skill", label: "ID SKILL" },
  { value: "cti", label: "CTI" },
  { value: "nome_skill", label: "NOME SKILL" },
  { value: "transfercode", label: "TRANSFERCODE" },
  { value: "dna", label: "DNA" },
  { value: "segmento", label: "SEGMENTO" },
  { value: "cog_dh_inicio_segmento", label: "COG DH INICIO SEGMENTO" },
  { value: "cog_tempo_segmento", label: "COG TEMPO SEGMENTO" },
  { value: "cog_jornada", label: "COG JORNADA" },
  { value: "cog_entrou", label: "COG ENTROU" },
  { value: "cog_interagiu", label: "COG INTERAGIU" },
  { value: "cog_qtd_interacoes", label: "COG QTD INTERACOES" },
  { value: "cog_entendido", label: "COG ENTENDIDO" },
  { value: "cog_texto_fala_cliente", label: "COG TEXTO FALA CLIENTE" },
  { value: "info_adicional", label: "INFO ADICIONAL" },
  { value: "cog_tempo_stt", label: "COG TEMPO STT" },
  { value: "cog_tempo_ia", label: "COG TEMPO IA" },
  { value: "cog_script_point_ia", label: "COG SCRIPTPOINT IA" },
  { value: "cog_tempo_fala_cliente", label: "COG TEMPO FALA CLIENTE" },
  { value: "cog_tempo_topo", label: "COG TEMPO TOPO" },
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

export async function searchPortalTasks(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    params.set(key, value ?? "");
  });

  return request(`/tasks/search?${params.toString()}`);
}

export async function analyzeCdr(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    params.set(key, value ?? "");
  });

  return request(`/analytics?${params.toString()}`);
}

export async function compareCdrAnalytics(payload = {}) {
  return request("/analytics/compare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
