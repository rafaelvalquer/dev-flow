import { URA_AI_ORGANIZER_SCHEMA } from "./uraAiSchemas.js";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

function clean(value) {
  return String(value ?? "").trim();
}

function short(value, limit = 220) {
  const text = clean(value).replace(/\s+/g, " ");
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

function debugText(value, limit = 2000) {
  return short(
    clean(value)
      .replace(/sk-[A-Za-z0-9_-]+/g, "[OPENAI_API_KEY]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]"),
    limit
  );
}

function actionCode(action) {
  return Array.isArray(action?.parameters) ? action.parameters.join("\n") : clean(action?.parameters);
}

function deterministicDisplayLabel(action) {
  const type = clean(action.type).toUpperCase();
  const text = `${clean(action.caption)}\n${actionCode(action)}`.toLowerCase();
  if (type === "BEGIN") return "Início da URA";
  if (type === "HOURS") return "Validação de horário";
  if (type === "PLAY") return "Mensagem de áudio";
  if (type === "MENU") return /cpf|celular|cartao|protocolo|collect|digita|pede/i.test(text) ? "Menu de coleta" : "Menu principal";
  if (type === "IF") {
    if (/checkmobile|celcancel|celular/.test(text)) return "Celular informado é válido?";
    if (/checkcpf|cpfcancel|cpf/.test(text)) return "CPF informado é válido?";
    if (/ani/.test(text) && /(bloq|block|=)/.test(text)) return "ANI bloqueado?";
    if (/feriado|horario|finaldesemana|indispon|closed|holiday/.test(text)) return "URA indisponível?";
    if (/consulta/.test(text) && /ok/.test(text)) return "Consulta retornou OK?";
    return "Validação da regra?";
  }
  if (type === "SNIPPET") {
    if (/scriptpoint|mapa_dna|cdr/.test(text)) return "Registra CDR / rastreio";
    if (/next_step/.test(text) && /audio/.test(text)) return "Define mensagem e próximo destino";
    if (/next_step/.test(text)) return "Define próximo destino";
    if (/audio/.test(text)) return "Define áudio da navegação";
    return "Processamento da regra";
  }
  if (type === "RUNSCRIPT") return "Executa próximo destino";
  if (["RUNSUB", "REST_API"].includes(type)) return "Consulta API / integração";
  if (type === "REQAGENT") return "Transfere para atendimento";
  if (type === "END") return "Encerrar chamada";
  return short(action.caption || type || `Action ${action.actionId}`, 80);
}

function shouldHideFromMainFlow(action) {
  const type = clean(action.type).toUpperCase();
  const text = `${clean(action.caption)}\n${actionCode(action)}`.toLowerCase();
  const hasFunctionalOutput = /audio|next_step|skill_id|skill_name|transfercode|\.wav/.test(text);
  if (["ONRELEASE", "ONANSWER"].includes(type)) return true;
  if (type === "SNIPPET" && /scriptpoint|mapa_dna|marca_cdr|dados_cdr/.test(text) && !hasFunctionalOutput) return true;
  if (type === "SNIPPET" && /config_menu|set_params/.test(text) && !hasFunctionalOutput) return true;
  return false;
}

function audioCandidates(action) {
  const matches = actionCode(action).match(/[^"'\s\\\/]+\.wav/gi) || [];
  return [...new Set(matches)].slice(0, 8);
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
      businessPurpose: "Organização determinística gerada sem OpenAI.",
      audience: ["Negócio", "Desenvolvimento", "Sustentação"],
      mainDomains: [],
      mainJourneys: menus.slice(0, 8).map((menu) => clean(menu.caption) || `Menu ${menu.actionId}`),
    },
    mainMenuCandidate: {
      actionId: clean(menus[0]?.actionId),
      reason: menus[0] ? "Primeiro MENU encontrado no XML NICE." : "Nenhum MENU encontrado.",
      confidence: menus[0] ? 0.65 : 0,
    },
    preMenuLabels: actions
      .filter((action) => ["BEGIN", "IF", "HOURS", "PLAY", "SNIPPET", "RUNSUB", "REST_API"].includes(clean(action.type).toUpperCase()))
      .slice(0, 40)
      .map((action) => ({
        actionId: clean(action.actionId),
        type: clean(action.type),
        humanLabel: short(action.caption || action.type || `Action ${action.actionId}`, 80),
        humanQuestion: clean(action.type).toUpperCase() === "IF" ? `${short(action.caption || "Condição", 70)}?` : "",
        audioLabel: "",
        group: "pre-menu",
        evidence: [`ActionID ${action.actionId}`],
      })),
    ifLabels: actions
      .filter((action) => clean(action.type).toUpperCase() === "IF")
      .slice(0, 80)
      .map((action) => ({
        actionId: clean(action.actionId),
        rawCondition: short(Array.isArray(action.parameters) ? action.parameters.join(" ") : "", 180),
        humanQuestion: `${short(action.caption || "Condição", 70)}?`,
        trueLabel: "Sim",
        falseLabel: "Não",
        category: "validação",
        evidence: [`ActionID ${action.actionId}`],
      })),
    collectLabels: actions
      .filter((action) => /cpf|celular|cartao|cartão|protocolo|collect|collecnum|digita|pede/i.test(JSON.stringify(action)))
      .slice(0, 60)
      .map((action) => ({
        actionId: clean(action.actionId),
        dataType: /cpf/i.test(JSON.stringify(action)) ? "cpf" : /celular|mobile/i.test(JSON.stringify(action)) ? "celular" : "outro",
        humanLabel: short(action.caption || "Coleta de dados", 80),
        validationActionIds: [],
        timeoutActionIds: [],
        evidence: [`ActionID ${action.actionId}`],
      })),
    displayLabels: actions.slice(0, 260).map((action) => ({
      actionId: clean(action.actionId),
      type: clean(action.type),
      displayLabel: deterministicDisplayLabel(action),
      secondaryLabel: "",
      conditionLabel: clean(action.type).toUpperCase() === "IF" ? short(actionCode(action), 180) : "",
      businessDescription: `${deterministicDisplayLabel(action)} extraído do XML NICE.`,
      audioFile: audioCandidates(action)[0] || "",
      audioPurpose: audioCandidates(action)[0] ? "Áudio executado pela navegação." : "",
      hideFromMainFlow: shouldHideFromMainFlow(action),
      trueLabel: "Sim",
      falseLabel: "Não",
      branchLabels: (Array.isArray(action.branches) ? action.branches : []).slice(0, 8).map((branch) => ({
        raw: clean(branch.name || branch.label || branch.value),
        label: clean(branch.name || branch.label || branch.value),
        meaning: "Saída real extraída do XML.",
      })),
      evidence: [`ActionID ${action.actionId}`, `type ${action.type}`],
    })),
    navigationLabels: [],
    actionAnnotations: actions.slice(0, 260).map((action) => ({
      actionId: clean(action.actionId),
      businessLabel: short(action.caption || action.type || `Action ${action.actionId}`, 80),
      shortLabel: short(action.caption || action.type || `Action ${action.actionId}`, 42),
      description: `${clean(action.type)} extraída do XML NICE.`,
      category: clean(action.type).toLowerCase(),
      group: clean(action.type).toUpperCase() === "MENU" ? "Menus" : "Fluxo técnico",
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
        label: clean(item.value || item.name) ? `Opção ${clean(item.value || item.name)}` : "Opção",
        description: "Opção extraída deterministicamente do CASE.",
        targetActionId: clean(item.target),
        confidence: 0.75,
        evidence: [`MENU ActionID ${menu.actionId}`, `CASE ${clean(item.value || item.name)}`],
      })),
    })),
    menuOptionLabels: [],
    audioLabels: actions
      .filter((action) => /\.wav/i.test(JSON.stringify(action)))
      .slice(0, 80)
      .map((action) => ({
        actionId: clean(action.actionId),
        fileName: short(JSON.stringify(action).match(/[^"\\\/]+\.wav/i)?.[0] || "", 120),
        purpose: short(action.caption || "Áudio da URA", 100),
        evidence: [`ActionID ${action.actionId}`],
      })),
    subflowLabels: [],
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
        "Prompts e Transcrições",
        "CDR e Scriptpoints",
        "Ações NICE",
      ],
    },
    issues: [],
  };
}

function buildOrganizerPayload({ rawActions, preSemanticExtract, transcriptions, projectName }) {
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
  const criticalSnippetIds = new Set(
    important
      .filter((action) => clean(action.type).toUpperCase() === "SNIPPET" && isCriticalSnippet(action))
      .slice(0, 20)
      .map((action) => clean(action.actionId))
  );
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
      parametersPreview: Array.isArray(action.parameters)
        ? action.parameters.slice(0, 12).map((item) => short(item, 200))
        : [],
      importantLines: importantSnippetLines(action).slice(0, 40),
      fullCode: criticalSnippetIds.has(clean(action.actionId)) ? fullActionCode(action, 6000) : "",
      defaultNextAction: clean(action.defaultNextAction),
      cases: (Array.isArray(action.cases) ? action.cases : []).slice(0, 20),
      branches: (Array.isArray(action.branches) ? action.branches : []).slice(0, 10),
      audioCandidates: audioCandidates(action),
    })),
    edges: edges.slice(0, 260),
    preSemanticExtract: preSemanticExtract || {},
    organizerHints: {
      goal: "Organizar a navegação em árvore humanizada para a aba Fluxo Principal.",
      preserveTopology: [
        "Use apenas ActionID, CASE, Branches, DefaultNextAction, NEXT_STEP, skills, prompts e destinos presentes no payload.",
        "Não invente conexões, ActionID, Skill ID, prompts, destinos ou opções DTMF.",
        "Classifique as actions em pré-menu, menu principal, submenu, coleta, validação, áudio/play, API, transferência, encerramento ou evento lateral.",
        "Identifique o significado das opções do menu principal usando transcrição do áudio, nome do áudio, destino técnico, caption de actions posteriores, skillName, NEXT_STEP e contexto do XML.",
        "Nunca retorne labels genéricos como 'Opção 1' se houver evidência de contexto.",
        "Retorne labels curtos e dinâmicos para o draw.io, sem assumir nomes fixos de uma URA específica.",
      ],
      expectedFields: [
        "mainMenuCandidate",
        "preMenuLabels",
        "ifLabels",
        "collectLabels",
        "displayLabels",
        "navigationLabels",
        "menuLabels",
        "menuOptionLabels",
        "audioLabels",
        "subflowLabels",
      ],
    },
    transcriptions: (Array.isArray(transcriptions?.items) ? transcriptions.items : [])
      .slice(0, 80)
      .map((item) => ({
        fileName: clean(item.fileName),
        text: short(item.rawTranscription || item.text, 280),
        status: clean(item.status),
      })),
  };
}

function fullActionCode(action, limit = 6000) {
  const params = Array.isArray(action?.parameters) ? action.parameters : [];
  return short(params.map((item) => clean(item)).filter(Boolean).join("\n"), limit);
}

function importantSnippetLines(action) {
  const params = Array.isArray(action?.parameters) ? action.parameters : [];
  const pattern = /\b(SWITCH|CASE|ASSIGN|NEXT_STEP|AUDIO|SKILL_ID|SKILL_NAME|RUNSUB|REST_API|REQAGENT|RET\s*=|IF|TRANSFERCODE|MRES|OP_ESCOLHIDA)\b/i;
  return params
    .map((item) => clean(item))
    .filter((line) => pattern.test(line))
    .map((line) => short(line, 260));
}

function isCriticalSnippet(action) {
  const text = fullActionCode(action, 20000);
  return /\b(SWITCH|CASE|NEXT_STEP|SKILL_ID|SKILL_NAME|TRANSFERCODE|MRES|OP_ESCOLHIDA)\b/i.test(text);
}

export async function organizeUraFlowWithAi({
  rawActions,
  preSemanticExtract,
  transcriptions,
  projectName,
  options,
  env,
}) {
  const enabled = String(env.URA_DOCS_ENABLE_AI ?? "true").toLowerCase() !== "false";
  if (!enabled || !clean(env.OPENAI_API_KEY)) {
    return {
      organizer: deterministicOrganizer({ rawActions, projectName }),
      warnings: [
        "IA não utilizada: usando fallback determinístico. Verifique OPENAI_API_KEY e URA_DOCS_ENABLE_AI.",
      ],
      cacheHit: false,
      fallback: true,
      debugEvents: [
        {
          kind: "fallback",
          title: "Organizador IA não executado",
          message: "Usando organização determinística antes do draw.io.",
          details: {
            enabled,
            hasOpenAiKey: Boolean(clean(env.OPENAI_API_KEY)),
          },
        },
      ],
    };
  }

  const model = env.URA_DOCS_AI_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const timeoutMs = Number(env.URA_DOCS_AI_TIMEOUT_MS || 70000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const debugEvents = [];
  try {
    const payload = buildOrganizerPayload({ rawActions, preSemanticExtract, transcriptions, projectName, options });
    const body = {
      model,
      messages: [
        {
          role: "system",
          content: [
            "Você organiza scripts NICE Studio em uma árvore de navegação de URA, clara e objetiva em PT-BR.",
            "A topologia vem dos dados determinísticos; use a IA apenas para humanizar nomes, condições, descrições, áudios e contexto.",
            "Preserve ActionID, CASE, Branches, DefaultNextAction, NEXT_STEP, prompts, skills e destinos reais do payload.",
            "NUNCA invente conexões, ActionID, prompts, skills, destinos ou opções DTMF.",
            "Identifique pré-menu, menu principal, submenus, coletas de dados, validações, áudios/PLAY, APIs, transferências, encerramentos, timeout/inválido e eventos laterais.",
            "Sua saída será usada diretamente em um fluxograma de negócio.",
            "Não use nomes técnicos como If, Play, Snippet, Begin, Case, Menu ou RunScript como label principal.",
            "Para IF, gere uma pergunta de negócio clara e preencha conditionLabel.",
            "Para PLAY/MENU, identifique o áudio executado e a intenção da mensagem.",
            "Para SNIPPET, explique o que ele faz em linguagem funcional.",
            "Para RUNSCRIPT/NEXT_STEP, informe o destino funcional quando existir.",
            "Identifique o significado das opções do menu principal usando transcrição do áudio, nome do áudio, destino técnico, caption de menus posteriores, skillName, NEXT_STEP e contexto do XML.",
            "Exemplos apenas ilustrativos, não chumbados: target com nome de empresa vira label da empresa; target com cancelamento vira Cancelamento; target com segunda via vira Segunda via; target com renegociação vira Renegociação.",
            "Nunca retorne labels genéricos como Opção 1, Opção 2 ou Opção 3 quando houver evidência de contexto no payload.",
            "menuOptionLabels e menuLabels.options devem conter labels curtos e humanos para o draw.io.",
            "ActionID deve ser usado apenas como evidência, nunca como displayLabel.",
            "Gere labels curtos para draw.io.",
            "Não use frases longas quando a condição técnica for clara.",
            "Para IF simples, retorne apenas a condição ou uma pergunta curta.",
            "Exemplos: ANI=+5512992379575 -> ANI=+5512992379575; CheckCPF(CpfCancel) -> CPF válido?; CheckMobile(CelCancel) -> Celular válido?; HOURS profile 68 -> Horário 68; PLAY com semexpediente.wav -> Áudio fechado/feriado; MENU de CPF -> Digitar CPF.",
            "Não inclua ActionID, Ref., Condição: ou Destino: ActionID no displayLabel.",
            "Use hideFromMainFlow=true para ScriptPoint/CDR puro ou configurações técnicas sem áudio, NEXT_STEP, skill ou transferência.",
            "Toda evidência deve apontar para ActionID, CASE, branch, prompt ou transcrição fornecida.",
            "Retorne somente JSON no schema solicitado.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(payload),
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
    debugEvents.push({
      kind: "ai_prompt",
      title: "Prompt enviado ao OpenAI",
      message: "Organização semântica do XML antes da geração do draw.io.",
      details: {
        stage: "ai_organizer",
        model,
        mode: "organizer",
        promptChars: JSON.stringify(body.messages).length,
        payloadPreview: debugText(JSON.stringify({
          counts: payload.counts,
          actions: (payload.actions || []).slice(0, 8),
          organizerHints: payload.organizerHints,
        })),
      },
    });
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
    debugEvents.push({
      kind: "ai_response",
      title: "Resposta recebida do OpenAI",
      message: "Organizador semântico retornou JSON válido.",
      details: {
        stage: "ai_organizer",
        model,
        responseChars: text.length,
        responsePreview: debugText(text),
      },
    });
    return { organizer, warnings: [], cacheHit: false, fallback: false, debugEvents };
  } catch (error) {
    debugEvents.push({
      kind: "fallback",
      title: "Organizer IA indisponível",
      message: error?.name === "AbortError" ? `Timeout de ${Math.round(timeoutMs / 1000)}s.` : error?.message || String(error),
      details: { stage: "ai_organizer", model },
    });
    return {
      organizer: deterministicOrganizer({ rawActions, projectName }),
      warnings: [
        `Organizer IA indisponível. Geração continuou com organizador determinístico. Detalhe: ${
          error?.name === "AbortError"
            ? `timeout de ${Math.round(timeoutMs / 1000)}s`
            : error?.message || String(error)
        }`,
      ],
      cacheHit: false,
      fallback: true,
      debugEvents,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const organizeUraBeforeDrawio = organizeUraFlowWithAi;
