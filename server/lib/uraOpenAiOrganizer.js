import { URA_AI_ORGANIZER_SCHEMA } from "./uraAiSchemas.js";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

function clean(value) {
  return String(value ?? "").trim();
}

function short(value, limit = 220) {
  const text = clean(value).replace(/\s+/g, " ");
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

function extractOpenAiText(data) {
  return clean(data?.choices?.[0]?.message?.content);
}

function deterministicOrganizer({ rawActions, projectName }) {
  const actions = Array.isArray(rawActions?.actions) ? rawActions.actions : [];
  const menus = actions.filter((action) => clean(action.type).toUpperCase() === "MENU");
  return {
    flowContext: {
      flowName: projectName || rawActions?.project?.name || "URA",
      flowType: "URA NICE",
      businessPurpose: "Organizacao deterministica gerada sem OpenAI.",
      audience: ["Negocio", "Desenvolvimento", "Sustentacao"],
      mainDomains: [],
      mainJourneys: menus.slice(0, 8).map((menu) => clean(menu.caption) || `Menu ${menu.actionId}`),
    },
    actionAnnotations: actions.slice(0, 260).map((action) => ({
      actionId: clean(action.actionId),
      businessLabel: short(action.caption || action.type || `Action ${action.actionId}`, 80),
      shortLabel: short(action.caption || action.type || `Action ${action.actionId}`, 42),
      description: `${clean(action.type)} extraida do XML NICE.`,
      category: clean(action.type).toLowerCase(),
      group: clean(action.type).toUpperCase() === "MENU" ? "Menus" : "Fluxo tecnico",
      riskLevel: "low",
      confidence: 0.7,
      evidence: [`ActionID ${action.actionId}`, `type ${action.type}`],
    })),
    menuLabels: menus.slice(0, 40).map((menu) => ({
      menuActionId: clean(menu.actionId),
      menuName: clean(menu.caption) || "Menu",
      captureVariable: "",
      options: (Array.isArray(menu.cases) ? menu.cases : []).slice(0, 16).map((item) => ({
        digit: clean(item.value || item.name),
        label: clean(item.value || item.name) ? `Opcao ${clean(item.value || item.name)}` : "Opcao",
        description: "Opcao extraida deterministicamente do CASE.",
        targetActionId: clean(item.target),
        confidence: 0.75,
        evidence: [`MENU ActionID ${menu.actionId}`, `CASE ${clean(item.value || item.name)}`],
      })),
    })),
    visualGroups: [],
    routeHints: [],
    drawioRecommendations: {
      mainPageTitle: "Fluxo principal da URA",
      maxMainBlocks: 18,
      suggestedPages: [
        "Fluxo Principal",
        "Jornadas Funcionais",
        "Mapa de Menus",
        "Mapa de Skills",
        "Prompts e Transcricoes",
        "CDR e Scriptpoints",
        "Acoes NICE",
      ],
    },
    issues: [],
  };
}

function buildOrganizerPayload({ rawActions, transcriptions, projectName }) {
  const actions = Array.isArray(rawActions?.actions) ? rawActions.actions : [];
  const edges = Array.isArray(rawActions?.edges) ? rawActions.edges : [];
  const important = actions.filter((action) => {
    const type = clean(action.type).toUpperCase();
    const text = JSON.stringify(action).toLowerCase();
    return (
      ["BEGIN", "MENU", "IF", "CASE", "PLAY", "SNIPPET", "RUNSCRIPT", "RUNSUB", "REST_API", "REQAGENT", "END"].includes(type) ||
      /skill|audio|next_step|scriptpoint|mapa_dna|transfer|url|api/.test(text)
    );
  });
  return {
    projectName: projectName || rawActions?.project?.name || "URA",
    counts: {
      actions: actions.length,
      edges: edges.length,
      transcriptions: Array.isArray(transcriptions?.items) ? transcriptions.items.length : 0,
    },
    actions: important.slice(0, 180).map((action) => ({
      actionId: clean(action.actionId),
      type: clean(action.type),
      caption: short(action.caption, 120),
      parameters: Array.isArray(action.parameters)
        ? action.parameters.slice(0, 12).map((item) => short(item, 160))
        : [],
      defaultNextAction: clean(action.defaultNextAction),
      cases: (Array.isArray(action.cases) ? action.cases : []).slice(0, 20),
      branches: (Array.isArray(action.branches) ? action.branches : []).slice(0, 10),
    })),
    edges: edges.slice(0, 260),
    transcriptions: (Array.isArray(transcriptions?.items) ? transcriptions.items : [])
      .slice(0, 80)
      .map((item) => ({
        fileName: clean(item.fileName),
        text: short(item.rawTranscription || item.text, 280),
        status: clean(item.status),
      })),
  };
}

export async function organizeUraFlowWithAi({
  rawActions,
  transcriptions,
  projectName,
  options,
  env,
}) {
  const enabled = String(env.URA_DOCS_ENABLE_AI ?? "true").toLowerCase() !== "false";
  if (!enabled || !clean(env.OPENAI_API_KEY)) {
    return {
      organizer: deterministicOrganizer({ rawActions, projectName }),
      warnings: enabled ? ["Organizer IA indisponivel: OPENAI_API_KEY nao configurado."] : [],
      cacheHit: false,
      fallback: true,
    };
  }

  const model = env.URA_DOCS_AI_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const timeoutMs = Number(env.URA_DOCS_AI_TIMEOUT_MS || 70000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      model,
      messages: [
        {
          role: "system",
          content: [
            "Voce organiza fluxos NICE para documentacao funcional em PT-BR.",
            "Use a IA para nomes, grupos e contexto, mas NUNCA invente conexoes, ActionID, prompts, skills ou destinos.",
            "Toda evidencia deve apontar para ActionID, CASE, branch, prompt ou transcricao fornecida.",
            "Retorne somente JSON no schema solicitado.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(buildOrganizerPayload({ rawActions, transcriptions, projectName, options })),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ura_ai_organizer",
          schema: URA_AI_ORGANIZER_SCHEMA,
          strict: true,
        },
      },
      temperature: 0.1,
      max_tokens: 12000,
    };
    if (String(model).startsWith("gpt-5")) delete body.temperature;
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI organizer falhou (${response.status}): ${text.slice(0, 800)}`);
    }
    const data = await response.json();
    const text = extractOpenAiText(data);
    const organizer = JSON.parse(text);
    return { organizer, warnings: [], cacheHit: false, fallback: false };
  } catch (error) {
    return {
      organizer: deterministicOrganizer({ rawActions, projectName }),
      warnings: [
        `Organizer IA indisponivel. Geracao continuou com organizador deterministico. Detalhe: ${
          error?.name === "AbortError"
            ? `timeout de ${Math.round(timeoutMs / 1000)}s`
            : error?.message || String(error)
        }`,
      ],
      cacheHit: false,
      fallback: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}
