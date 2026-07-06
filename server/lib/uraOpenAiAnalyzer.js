import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildUraAiChunks } from "./uraAiChunker.js";
import {
  URA_AI_ENRICHMENT_SCHEMA,
  emptyUraAiEnrichment,
} from "./uraAiSchemas.js";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

export function requireOpenAiKey(OPENAI_API_KEY) {
  if (!String(OPENAI_API_KEY || "").trim()) {
    throw new Error(
      "OPENAI_API_KEY não configurado. A documentação será gerada sem enriquecimento por IA."
    );
  }
}

function extractOpenAiText(data) {
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

function debugText(value, limit = 2000) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[OPENAI_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  return text.length <= limit ? text : `${text.slice(0, limit - 20)}... [truncado]`;
}

function toOpenAiJsonSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map((item) => toOpenAiJsonSchema(item));
  const converted = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "type" && typeof value === "string") {
      converted[key] = value.toLowerCase();
    } else if (key === "properties") {
      converted[key] = Object.fromEntries(
        Object.entries(value || {}).map(([name, child]) => [
          name,
          toOpenAiJsonSchema(child),
        ])
      );
    } else if (key === "items") {
      converted[key] = toOpenAiJsonSchema(value);
    } else {
      converted[key] = toOpenAiJsonSchema(value);
    }
  }
  return converted;
}

function tryParseJson(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const stripped = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  for (const candidate of [raw, stripped, extractBalancedJson(stripped)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next candidate.
    }
  }
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function extractBalancedJson(text) {
  const start = String(text || "").indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") inString = true;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return "";
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeAnalysis(value) {
  const base = emptyUraAiEnrichment();
  const root = value && typeof value === "object" ? value : {};
  return {
    ...base,
    ...root,
    context: { ...base.context, ...(root.context || {}) },
    businessRules: normalizeArray(root.businessRules),
    technicalRules: normalizeArray(root.technicalRules),
    menuInterpretation: normalizeArray(root.menuInterpretation),
    promptAnalysis: normalizeArray(root.promptAnalysis),
    drawioAnnotations: normalizeArray(root.drawioAnnotations),
    issues: normalizeArray(root.issues),
    testCases: normalizeArray(root.testCases),
    runbook: normalizeArray(root.runbook),
  };
}

function truncateText(value, limit = 700) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function classifyAiError(error) {
  const message = String(error?.message || error || "").trim();
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(message)) {
    return {
      category: "quota",
      title: "Quota/limite da OpenAI excedido",
      suggestion:
        "Aguarde a janela de quota, reduza o modo para summary ou configure uma chave/projeto com mais limite.",
    };
  }
  if (/Timeout|aborted|AbortError/i.test(message)) {
    return {
      category: "timeout",
      title: "Timeout ao chamar OpenAI",
      suggestion:
        "Aumente URA_DOCS_AI_TIMEOUT_MS ou mantenha URA_DOCS_AI_MODE=summary para payload menor.",
    };
  }
  if (/JSON|interpretavel|parse/i.test(message)) {
    return {
      category: "invalid_json",
      title: "OpenAI retornou resposta fora do JSON esperado",
      suggestion:
        "Tente novamente; se persistir, use modo summary ou revise o modelo configurado.",
    };
  }
  if (/OPENAI_API_KEY|API key|key/i.test(message)) {
    return {
      category: "configuration",
      title: "Chave OpenAI ausente ou inválida",
      suggestion: "Configure OPENAI_API_KEY ou desabilite IA para remover esta etapa.",
    };
  }
  return {
    category: "unknown",
    title: "Falha não classificada no enriquecimento por IA",
    suggestion: "Verifique conectividade, modelo configurado e logs do backend.",
  };
}

function buildAiWarning({
  stage,
  error,
  normalizedFlow,
  transcriptions,
  projectName,
  env,
  options,
  extra = {},
}) {
  const digest = deterministicDigest(normalizedFlow, transcriptions, projectName);
  const classified = classifyAiError(error);
  const model = env?.URA_DOCS_AI_MODEL || env?.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const mode = env?.URA_DOCS_AI_MODE || options?.aiMode || "summary";
  const includeAi = options?.includeAiAnalysis !== false;
  const rawMessage = truncateText(error?.message || error || "Sem detalhe técnico retornado.", 900);
  return [
    `IA indisponível (${classified.title}).`,
    `Etapa: ${stage}. Modo: ${mode}. Modelo: ${model}. includeAiAnalysis=${includeAi}.`,
    `Fluxo preservado: draw.io/matrizes foram gerados pelo parser NICE com ${digest.counts.actions} actions, ${digest.counts.edges} edges, ${digest.counts.menus} menus e ${digest.counts.prompts} prompts.`,
    `Transcrições: ${digest.transcriptionStatus.total} arquivo(s), ${digest.transcriptionStatus.failed} falha(s).`,
    extra.chunkId ? `Chunk: ${extra.chunkId}.` : "",
    `Detalhe técnico: ${rawMessage}`,
    `Ação sugerida: ${classified.suggestion}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildUraAiFailureWarning(args) {
  return buildAiWarning(args);
}

function companyFromText(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("claro")) return "Claro";
  if (text.includes("hitss")) return "HITSS";
  if (text.includes("bcc") || text.includes("brasil center")) return "BCC";
  return "";
}

function deterministicDigest(normalizedFlow, transcriptions, projectName) {
  const actions = Array.isArray(normalizedFlow?.actions) ? normalizedFlow.actions : [];
  const menus = actions.filter((action) => String(action?.type || "").toUpperCase() === "MENU");
  const prompts = Array.isArray(normalizedFlow?.prompts) ? normalizedFlow.prompts : [];
  const skills = Array.isArray(normalizedFlow?.skills) ? normalizedFlow.skills : [];
  const companies = [
    ...new Set(
      actions
        .map((action) =>
          companyFromText(
            [
              action?.caption,
              action?.audio,
              action?.nextStep,
              JSON.stringify(action?.parameters || {}),
            ].join(" ")
          )
        )
        .filter(Boolean)
    ),
  ];
  return {
    projectName,
    counts: {
      actions: actions.length,
      edges: normalizedFlow?.edges?.length || 0,
      menus: menus.length,
      prompts: prompts.length,
      skills: skills.length,
    },
    companies,
    menus: menus.slice(0, 25).map((menu) => ({
      actionId: String(menu.actionId || ""),
      caption: String(menu.caption || ""),
      options: (menu.cases || []).slice(0, 8).map((item) => ({
        digit: String(item.value || item.name || ""),
        target: String(item.target || ""),
      })),
    })),
    prompts: prompts.slice(0, 50).map((prompt) => ({
      fileName: prompt.fileName,
      sourceActionId: prompt.sourceActionId,
      transcription: truncateText(prompt.transcription || prompt.rawTranscription, 450),
    })),
    skills: skills.slice(0, 40).map((skill) => ({
      id: skill.id,
      name: skill.name,
      sourceActionId: skill.sourceActionId,
    })),
    keyActions: actions
      .filter((action) =>
        [
          "BEGIN",
          "MENU",
          "IF",
          "CASE",
          "SNIPPET",
          "RUNSCRIPT",
          "RUNSUB",
          "REST_API",
          "REQAGENT",
          "PLAY",
          "LOOP",
          "END",
        ].includes(String(action?.type || "").toUpperCase())
      )
      .slice(0, 90)
      .map((action) => ({
        actionId: String(action.actionId || ""),
        type: String(action.type || ""),
        caption: String(action.caption || ""),
        prompts: (action.prompts || []).slice(0, 4),
        skills: (action.skills || []).slice(0, 4),
        nextStep: action.nextStep || "",
        transferCode: action.transferCode || "",
        audio: action.audio || "",
        cases: (action.cases || []).slice(0, 8).map((item) => ({
          value: String(item.value || item.name || ""),
          target: String(item.target || ""),
        })),
        outputs: action.outputs || {},
      })),
    transcriptionStatus: {
      total: transcriptions?.items?.length || 0,
      failed: (transcriptions?.items || []).filter((item) => item.status === "failed")
        .length,
    },
  };
}

function buildDeterministicAnalysis({
  normalizedFlow,
  transcriptions,
  projectName,
  reason = "",
}) {
  const base = emptyUraAiEnrichment({ reason });
  const digest = deterministicDigest(normalizedFlow, transcriptions, projectName);
  const actions = Array.isArray(normalizedFlow?.actions) ? normalizedFlow.actions : [];
  const menus = actions.filter((action) => String(action?.type || "").toUpperCase() === "MENU");
  const prompts = Array.isArray(normalizedFlow?.prompts) ? normalizedFlow.prompts : [];
  const companies = digest.companies;

  return {
    ...base,
    context: {
      ...base.context,
      uraName: projectName || normalizedFlow?.project?.name || "URA",
      businessPurpose: "Atendimento telefonico automatizado baseado em fluxo NICE.",
      audience: ["Usuarios da URA"],
      mainCompanies: companies,
      mainDomains: menus.length ? ["Menus", "Roteamento", "Transferencias"] : [],
      flowType: "NICE Studio",
      language: "pt-BR",
    },
    functionalOverview:
      `Fluxo NICE parseado deterministicamente com ${digest.counts.actions} actions, ` +
      `${digest.counts.edges} conexoes, ${digest.counts.menus} menus e ` +
      `${digest.counts.prompts} prompts. O draw.io e as matrizes foram gerados sem depender da IA.`,
    executiveSummary:
      `Documentacao gerada a partir do XML NICE de ${projectName || "URA"}. ` +
      `Foram identificados ${digest.counts.menus} menus, ${digest.counts.prompts} prompts ` +
      `e ${digest.counts.skills} skills/transferencias.`,
    developerSummary:
      "Conexoes, menus, prompts e transferencias vieram do parser deterministico. A IA, quando disponivel, apenas complementa contexto textual.",
    businessSummary:
      companies.length
        ? `Fluxo com rotas relacionadas a ${companies.join(", ")}.`
        : "Fluxo documentado a partir das actions e conexoes NICE extraidas.",
    menuInterpretation: menus.slice(0, 30).map((menu, index) => ({
      company:
        companyFromText(
          [menu.caption, menu.audio, menu.nextStep, JSON.stringify(menu.parameters || {})].join(" ")
        ) || "Nao identificado",
      level: index + 1,
      menuName: String(menu.caption || `Menu ${menu.actionId || index + 1}`),
      actionId: String(menu.actionId || ""),
      options: (menu.cases || []).slice(0, 10).map((item) => ({
        digit: String(item.value || item.name || ""),
        label: String(item.name || item.value || "Opcao"),
        target: String(item.target || ""),
        confidence: 1,
        evidence: [`MENU ActionID ${menu.actionId}`],
      })),
    })),
    promptAnalysis: prompts.slice(0, 60).map((prompt) => ({
      fileName: String(prompt.fileName || ""),
      cleanTranscript: truncateText(prompt.transcription || prompt.rawTranscription, 700),
      intent: prompt.transcription ? "Prompt transcrito para verbalizacao da URA." : "Prompt sem transcricao disponivel.",
      menuOptions: [],
      issues: [],
    })),
    testCases: menus.slice(0, 20).map((menu, index) => ({
      id: `TC${String(index + 1).padStart(3, "0")}`,
      title: `Validar menu ${menu.caption || menu.actionId}`,
      steps: [
        `Acessar o fluxo ate a ActionID ${menu.actionId}.`,
        "Selecionar cada opcao configurada no menu.",
      ],
      expectedResult: "Cada opcao deve encaminhar para o target definido no XML NICE.",
      type: "funcional",
      priority: index < 5 ? "alta" : "media",
      evidence: [`MENU ActionID ${menu.actionId}`],
    })),
    runbook: [
      {
        problem: "Fluxo nao segue a opcao escolhida pelo usuario.",
        whereToCheck: "Verificar Cases/Branches do menu no normalized_flow.json e no draw.io.",
        technicalCheck: "Comparar ActionID de origem, label da edge e target NICE.",
        businessImpact: "Cliente pode ser direcionado para atendimento incorreto ou encerramento indevido.",
      },
      {
        problem: "Audio sem frase exibida no fluxograma.",
        whereToCheck: "Verificar se o arquivo de audio foi enviado e transcrito com sucesso.",
        technicalCheck: "Conferir prompts[].sourceActionId e prompts[].transcription.",
        businessImpact: "Documentacao fica menos clara para validacao de negocio.",
      },
    ],
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? "");
}

function firstText(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (String(value || "").trim()) return String(value).trim().toLowerCase();
  }
  return "";
}

function dedupeArray(items, keys) {
  const seen = new Set();
  const result = [];
  for (const item of normalizeArray(items)) {
    if (!item || typeof item !== "object") continue;
    const key =
      firstText(item, keys) ||
      stableHash(stableStringify(item));
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function dedupeMergedAnalysis(analysis) {
  return {
    ...analysis,
    businessRules: dedupeArray(analysis.businessRules, [
      "id",
      "title",
      "description",
      "evidence",
    ]),
    technicalRules: dedupeArray(analysis.technicalRules, [
      "id",
      "title",
      "description",
      "evidence",
    ]),
    menuInterpretation: dedupeArray(analysis.menuInterpretation, [
      "actionId",
      "menuId",
      "caption",
      "description",
    ]),
    promptAnalysis: dedupeArray(analysis.promptAnalysis, [
      "fileName",
      "prompt",
      "intent",
      "actionId",
    ]),
    drawioAnnotations: dedupeArray(analysis.drawioAnnotations, [
      "actionId",
      "title",
      "description",
    ]),
    issues: dedupeArray(analysis.issues, [
      "id",
      "title",
      "description",
      "category",
    ]),
    testCases: dedupeArray(analysis.testCases, [
      "id",
      "title",
      "expectedResult",
    ]),
    runbook: dedupeArray(analysis.runbook, [
      "id",
      "problem",
      "whereToCheck",
      "technicalCheck",
    ]),
  };
}

export async function openAiGenerateJson({
  OPENAI_API_KEY,
  OPENAI_MODEL,
  schema,
  prompt,
  payload,
  temperature = 0.2,
  timeoutMs = 60000,
  retries = 1,
  debugStage = "ai_enrichment",
  debugEvents = null,
}) {
  requireOpenAiKey(OPENAI_API_KEY);

  const model = OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const jsonSchema = toOpenAiJsonSchema(schema);
  const buildBody = (attempt) => ({
    model,
    messages: [
      {
        role: "system",
        content:
          attempt > 0
            ? `${prompt}\n\nRetorne somente JSON valido, sem markdown, sem texto fora do objeto JSON.`
            : prompt,
      },
      {
        role: "user",
        content:
          "Entrada JSON deterministica. Preserve ActionID e evidencias. Nao invente conexoes, skills ou prompts.\n" +
          JSON.stringify(payload || {}),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ura_ai_enrichment",
        schema: jsonSchema,
        strict: false,
      },
    },
    temperature,
    max_tokens: 8192,
  });

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = buildBody(attempt);
      if (String(model).startsWith("gpt-5")) delete body.temperature;
      if (Array.isArray(debugEvents)) {
        debugEvents.push({
          kind: "ai_prompt",
          title: attempt > 0 ? "Prompt reenviado ao OpenAI" : "Prompt enviado ao OpenAI",
          message: "Solicitando enriquecimento funcional em JSON.",
          details: {
            stage: debugStage,
            model,
            attempt: attempt + 1,
            promptChars: JSON.stringify(body.messages).length,
            promptPreview: debugText(prompt),
            payloadPreview: debugText(JSON.stringify(payload || {})),
          },
        });
      }
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 429 && attempt < retries) {
          const retryAfter = Number(response.headers.get("retry-after") || 0);
          const waitMs = Math.min(Math.max(retryAfter * 1000, 5000), 45000);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        throw new Error(
          `OpenAI chat.completions falhou (${response.status}): ${text.slice(
            0,
            800
          )}`
        );
      }

      const data = await response.json();
      const text = extractOpenAiText(data);
      const parsed = tryParseJson(text);
      if (!parsed) {
        throw new Error(
          `OpenAI retornou conteudo nao interpretavel como JSON: ${text.slice(
            0,
            500
          )}`
        );
      }
      if (Array.isArray(debugEvents)) {
        debugEvents.push({
          kind: "ai_response",
          title: "Resposta recebida do OpenAI",
          message: "OpenAI retornou JSON interpretavel.",
          details: {
            stage: debugStage,
            model,
            attempt: attempt + 1,
            responseChars: text.length,
            responsePreview: debugText(text),
          },
        });
      }
      return parsed;
    } catch (error) {
      lastError =
        error?.name === "AbortError"
          ? new Error(`Timeout de ${Math.round(timeoutMs / 1000)}s ao chamar OpenAI.`)
          : error;
      if (Array.isArray(debugEvents)) {
        debugEvents.push({
          kind: "ai_error",
          title: "Falha na chamada OpenAI",
          message: lastError?.message || String(lastError),
          details: {
            stage: debugStage,
            model,
            attempt: attempt + 1,
          },
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

export async function analyzeUraChunk({ chunk, context, env }) {
  const { debugEvents, ...safeContext } = context || {};
  const prompt = [
    "Voce e um especialista em URA NICE Studio.",
    "Analise somente o chunk fornecido e gere enriquecimento funcional em PT-BR.",
    "Use evidencias com ActionID, prompt, skill ou variavel sempre que possivel.",
    "A estrutura real do fluxo ja veio do parser; nao altere conexoes reais.",
    "Retorne apenas JSON aderente ao schema.",
  ].join("\n");

  return openAiGenerateJson({
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENAI_MODEL: env.URA_DOCS_AI_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    schema: URA_AI_ENRICHMENT_SCHEMA,
    prompt,
    payload: { chunk, context: safeContext },
    temperature: 0.15,
    timeoutMs: Number(env.URA_DOCS_AI_TIMEOUT_MS || 60000),
    retries: Number(env.URA_DOCS_AI_RETRIES || 1),
    debugStage: `analise_chunk_${chunk?.id || "sem_id"}`,
    debugEvents,
  });
}

export function mergeAiAnalysis({ chunkAnalyses = [], globalAnalysis = null }) {
  const merged = normalizeAnalysis(globalAnalysis);
  for (const raw of chunkAnalyses) {
    const analysis = normalizeAnalysis(raw);
    merged.businessRules.push(...analysis.businessRules);
    merged.technicalRules.push(...analysis.technicalRules);
    merged.menuInterpretation.push(...analysis.menuInterpretation);
    merged.promptAnalysis.push(...analysis.promptAnalysis);
    merged.drawioAnnotations.push(...analysis.drawioAnnotations);
    merged.issues.push(...analysis.issues);
    merged.testCases.push(...analysis.testCases);
    merged.runbook.push(...analysis.runbook);
    for (const [key, value] of Object.entries(analysis.context || {})) {
      if (!merged.context[key] && value) merged.context[key] = value;
    }
    for (const key of [
      "functionalOverview",
      "executiveSummary",
      "developerSummary",
      "businessSummary",
    ]) {
      if (!merged[key] && analysis[key]) merged[key] = analysis[key];
    }
  }
  return dedupeMergedAnalysis(merged);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readCache(cacheFile) {
  try {
    return JSON.parse(await fs.readFile(cacheFile, "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(cacheFile, payload) {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(payload, null, 2), "utf8");
}

export async function analyzeUraContext({
  normalizedFlow,
  transcriptions,
  projectName,
  options = {},
  env,
}) {
  const aiEnabled =
    String(env.URA_DOCS_ENABLE_AI ?? "true").toLowerCase() !== "false" &&
    options.includeAiAnalysis !== false;

  if (!aiEnabled) {
    return {
      analysis: buildDeterministicAnalysis({
        normalizedFlow,
        transcriptions,
        projectName,
        reason: "Enriquecimento por IA desabilitado.",
      }),
      warnings: [
        [
          "IA nao executada por configuracao.",
          `Etapa: pre_validacao. Modo: ${env.URA_DOCS_AI_MODE || options.aiMode || "summary"}. includeAiAnalysis=${options.includeAiAnalysis !== false}. URA_DOCS_ENABLE_AI=${env.URA_DOCS_ENABLE_AI}.`,
          "Fluxo preservado: draw.io/matrizes foram gerados pelo parser NICE deterministico.",
          "Acao sugerida: habilite URA_DOCS_ENABLE_AI=true e mantenha includeAiAnalysis ativo se quiser enriquecimento textual.",
        ].join("\n"),
      ],
      cacheHit: false,
      debugEvents: [
        {
          kind: "fallback",
          title: "Analise IA desabilitada",
          message: "Usando resumo deterministico.",
          details: {
            stage: "pre_validacao",
            mode: env.URA_DOCS_AI_MODE || options.aiMode || "summary",
            includeAiAnalysis: options.includeAiAnalysis !== false,
          },
        },
      ],
    };
  }

  if (!String(env.OPENAI_API_KEY || "").trim()) {
    return {
      analysis: buildDeterministicAnalysis({
        normalizedFlow,
        transcriptions,
        projectName,
        reason: "OPENAI_API_KEY nao configurado.",
      }),
      warnings: [
        buildAiWarning({
          stage: "pre_validacao",
          error: "OPENAI_API_KEY nao configurado.",
          normalizedFlow,
          transcriptions,
          projectName,
          env,
          options,
        }),
      ],
      cacheHit: false,
      debugEvents: [
        {
          kind: "fallback",
          title: "OpenAI nao configurada",
          message: "OPENAI_API_KEY nao configurado. Usando resumo deterministico.",
          details: { stage: "pre_validacao" },
        },
      ],
    };
  }

  const cacheEnabled =
    String(env.URA_DOCS_ENABLE_AI_CACHE ?? "true").toLowerCase() !== "false";
  const cacheRoot =
    env.URA_DOCS_AI_CACHE_DIR ||
    path.join(
      path.resolve(env.URA_DOCS_OUTPUT_DIR || "server/storage/ura-docs"),
      "cache",
      "ai"
    );
  const hash = stableHash({ normalizedFlow, transcriptions, options });
  const cacheFile = path.join(cacheRoot, `${hash}.json`);

  if (cacheEnabled) {
    const cached = await readCache(cacheFile);
    if (cached) {
      return {
        analysis: cached,
        warnings: [],
        cacheHit: true,
        debugEvents: [
          {
            kind: "cache",
            title: "Analise IA recuperada do cache",
            message: "Resultado de enriquecimento reutilizado.",
            details: { stage: "cache", cacheFile: path.basename(cacheFile) },
          },
        ],
      };
    }
  }

  const aiMode = String(env.URA_DOCS_AI_MODE || options.aiMode || "summary").toLowerCase();
  const fallbackAnalysis = buildDeterministicAnalysis({
    normalizedFlow,
    transcriptions,
    projectName,
  });
  const maxActionsPerChunk = Number(env.URA_DOCS_AI_MAX_ACTIONS_PER_CHUNK || 80);
  const chunks =
    aiMode === "full" ? buildUraAiChunks(normalizedFlow, { maxActionsPerChunk }).slice(0, Number(env.URA_DOCS_AI_MAX_CHUNKS || 4)) : [];
  const context = {
    projectName,
    options,
    transcriptions,
    project: normalizedFlow?.project || {},
    debugEvents: [],
  };
  const chunkAnalyses = [];
  const warnings = [];

  for (const chunk of chunks) {
    try {
      chunkAnalyses.push(await analyzeUraChunk({ chunk, context, env }));
    } catch (error) {
      warnings.push(
        buildAiWarning({
          stage: "analise_chunk",
          error,
          normalizedFlow,
          transcriptions,
          projectName,
          env,
          options,
          extra: { chunkId: chunk.id },
        })
      );
    }
  }

  const globalPrompt = [
    "Consolide as analises parciais de uma URA NICE.",
    "Gere resumo executivo, visao funcional, regras, inconsistencias, testes, runbook e contexto para um draw.io humanizado.",
    "Interprete menus, snippets SWITCH/CASE, NEXT_STEP, SKILL_ID/SKILL_NAME, RUNSCRIPT, RUNSUB, REST_API, prompts e saidas.",
    "Preencha drawioAnnotations para actions importantes com title curto de negocio, subtitle, description, badge, group e riskLevel.",
    "Preencha menuInterpretation com nome humano dos menus e labels claros para cada opcao DTMF.",
    "A primeira pagina do draw.io deve ficar compreensivel para negocio: jornadas, opcoes, regras, transferencias e encerramentos.",
    "Nao invente conexoes, skills, prompts ou ActionID. Toda inferencia textual deve ter evidencia nos campos disponiveis.",
    "Retorne apenas JSON aderente ao schema.",
  ].join("\n");

  let globalAnalysis = null;
  try {
    globalAnalysis = await openAiGenerateJson({
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      OPENAI_MODEL: env.URA_DOCS_AI_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      schema: URA_AI_ENRICHMENT_SCHEMA,
      prompt: globalPrompt,
      payload: {
        projectName,
        project: normalizedFlow?.project,
        counts: {
          actions: normalizedFlow?.actions?.length || 0,
          prompts: normalizedFlow?.prompts?.length || 0,
          skills: normalizedFlow?.skills?.length || 0,
        },
        deterministicDigest: deterministicDigest(normalizedFlow, transcriptions, projectName),
        chunkAnalyses: chunkAnalyses.map((analysis) => ({
          context: analysis.context,
          functionalOverview: analysis.functionalOverview,
          businessRules: (analysis.businessRules || []).slice(0, 20),
          technicalRules: (analysis.technicalRules || []).slice(0, 20),
          issues: (analysis.issues || []).slice(0, 20),
        })),
      },
      temperature: 0.2,
      timeoutMs: Number(env.URA_DOCS_AI_TIMEOUT_MS || 60000),
      retries: Number(env.URA_DOCS_AI_RETRIES || 1),
      debugStage: "consolidacao_global",
      debugEvents: context.debugEvents,
    });
  } catch (error) {
    warnings.push(
      buildAiWarning({
        stage: "consolidacao_global",
        error,
        normalizedFlow,
        transcriptions,
        projectName,
        env,
        options,
      })
    );
  }

  const analysis = mergeAiAnalysis({
    normalizedFlow,
    chunkAnalyses: [fallbackAnalysis, ...chunkAnalyses],
    globalAnalysis,
  });
  if (!globalAnalysis && !chunkAnalyses.length && !warnings.length) {
    warnings.push(
      buildAiWarning({
        stage: "sem_resultado",
        error: "OpenAI nao retornou enriquecimento adicional.",
        normalizedFlow,
        transcriptions,
        projectName,
        env,
        options,
      })
    );
  }
  if (cacheEnabled) await writeCache(cacheFile, analysis);
  return { analysis, warnings: [...new Set(warnings)], cacheHit: false, debugEvents: context.debugEvents };
}
