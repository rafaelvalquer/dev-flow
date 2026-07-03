function normalizeActionForAi(action) {
  const parameters = action?.parameters || action?.Parameters || {};
  const parameterText =
    typeof parameters === "string"
      ? parameters
      : JSON.stringify(parameters || {});
  return {
    actionId: String(action?.actionId || action?.ActionID || ""),
    type: String(action?.type || action?.Action || ""),
    caption: String(action?.caption || action?.Caption || ""),
    docType: String(action?.docType || ""),
    parametersPreview: parameterText.slice(0, 1200),
    branches: action?.branches || action?.Branches || [],
    cases: action?.cases || action?.Cases || [],
    defaultNextAction: String(
      action?.defaultNextAction || action?.DefaultNextAction || ""
    ),
    variables: action?.variables || [],
    prompts: action?.prompts || [],
    skills: action?.skills || [],
    outputs: action?.outputs || {},
    snippets: (action?.snippets || []).map((snippet) => String(snippet).slice(0, 1200)),
  };
}

function detectGroup(action) {
  const text = [
    action?.caption,
    action?.type,
    JSON.stringify(action?.parameters || {}),
  ]
    .join(" ")
    .toLowerCase();

  if (text.includes("claro")) return "Claro";
  if (text.includes("bcc")) return "BCC";
  if (text.includes("hitss")) return "HITSS";
  if (text.includes("cdr") || text.includes("onanswer") || text.includes("onrelease"))
    return "CDR/eventos";
  if (text.includes(".wav") || text.includes("audio")) return "prompts";
  if (text.includes("skill")) return "skills";
  return "fluxo principal";
}

export function buildUraAiChunks(normalizedFlow, { maxActionsPerChunk = 80 } = {}) {
  const actions = Array.isArray(normalizedFlow?.actions)
    ? normalizedFlow.actions
    : [];
  const groups = new Map();

  for (const action of actions) {
    const key = detectGroup(action);
    const items = groups.get(key) || [];
    items.push(normalizeActionForAi(action));
    groups.set(key, items);
  }

  const chunks = [];
  for (const [group, items] of groups.entries()) {
    for (let index = 0; index < items.length; index += maxActionsPerChunk) {
      chunks.push({
        id: `${group.replace(/\W+/g, "_").toLowerCase()}_${Math.floor(
          index / maxActionsPerChunk
        ) + 1}`,
        group,
        actions: items.slice(index, index + maxActionsPerChunk),
        prompts: (normalizedFlow?.prompts || []).slice(0, 40).map((prompt) => ({
          fileName: prompt.fileName,
          sourceActionId: prompt.sourceActionId,
          transcription: String(prompt.transcription || "").slice(0, 600),
        })),
        skills: normalizedFlow?.skills || [],
        menus: normalizedFlow?.menus || [],
      });
    }
  }

  if (!chunks.length) {
    chunks.push({
      id: "empty_1",
      group: "fluxo principal",
      actions: [],
      prompts: (normalizedFlow?.prompts || []).slice(0, 40),
      skills: normalizedFlow?.skills || [],
      menus: normalizedFlow?.menus || [],
    });
  }

  return chunks;
}
