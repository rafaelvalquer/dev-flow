export function uid(prefix = "id") {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return `${prefix}:${crypto.randomUUID()}`;
  return `${prefix}:${Math.random()
    .toString(16)
    .slice(2)}:${Date.now().toString(16)}`;
}

export function isEntityNode(id) {
  return /^ticket:|^subtask:|^activity:/.test(String(id || ""));
}
export function isTriggerNode(id) {
  return /^trigger:/.test(String(id || ""));
}
export function isActionNode(id) {
  return /^action:/.test(String(id || ""));
}

export function normalizeTicketKey(v) {
  return String(v || "")
    .trim()
    .toUpperCase();
}

export function flattenKanbanSubtasks(kanbanPayload) {
  const cfg =
    kanbanPayload?.config ||
    kanbanPayload?.kanban?.config ||
    kanbanPayload?.data?.kanban?.config;
  const columns = cfg?.columns || {};
  const out = [];

  for (const stepKey of Object.keys(columns)) {
    const col = columns[stepKey];
    for (const card of col?.cards || []) {
      for (const st of card?.subtasks || []) {
        out.push({
          id: st.id,
          stepKey,
          cardTitle: card.title || "",
          title: st.title || "",
          jiraKey: st.jiraKey || "",
          jiraStatus: st.jiraStatus || "",
          done: Boolean(st.done),
        });
      }
    }
  }

  return out;
}

export function buildEntityNodes({
  ticket,
  subtasks,
  activities,
  showSubtasks = true,
  showActivities = true,
}) {
  const nodes = [];
  const ticketKey = normalizeTicketKey(ticket?.ticketKey || ticket?.key);

  nodes.push({
    id: `ticket:${ticketKey}`,
    type: "ticketNode",
    position: { x: 0, y: 0 },
    data: {
      ticketKey,
      summary: ticket?.summary || ticket?.jira?.summary || "",
      status: ticket?.status || ticket?.jira?.status || "",
      assignee: ticket?.assignee || ticket?.jira?.assignee || "",
    },
    draggable: false,
  });

  if (showSubtasks) {
    (subtasks || []).forEach((st, i) => {
      const id = `subtask:${st.jiraKey || st.id}`;
      nodes.push({
        id,
        type: "subtaskNode",
        position: { x: -520, y: 110 + i * 86 },
        data: { ...st, nodeId: id },
      });
    });
  }

  if (showActivities) {
    (activities || []).forEach((a, i) => {
      const id = `activity:${a.id}`;
      nodes.push({
        id,
        type: "activityNode",
        position: { x: 520, y: 110 + i * 86 },
        data: { ...a, nodeId: id },
      });
    });
  }

  return nodes;
}

export function mergeGraph({ savedGraph, entityNodes }) {
  const savedNodes = Array.isArray(savedGraph?.nodes) ? savedGraph.nodes : [];
  const savedEdges = Array.isArray(savedGraph?.edges) ? savedGraph.edges : [];
  const viewport = savedGraph?.viewport || { x: 0, y: 0, zoom: 0.9 };

  const byId = new Map(savedNodes.map((n) => [n.id, n]));

  // atualiza/insere entityNodes preservando posição do que existir salvo
  const mergedNodes = entityNodes.map((en) => {
    const sn = byId.get(en.id);
    if (!sn) return en;
    return {
      ...sn,
      type: en.type,
      data: en.data,
      draggable: en.draggable ?? sn.draggable,
    };
  });

  // mantém nodes de automação do savedGraph
  for (const sn of savedNodes) {
    if (isEntityNode(sn.id)) continue;
    mergedNodes.push(sn);
  }

  return { nodes: mergedNodes, edges: savedEdges, viewport };
}

export function buildRulesFromFlow(nodes, edges) {
  const nodeById = new Map((nodes || []).map((n) => [n.id, n]));
  const out = [];

  const triggerNodes = (nodes || []).filter((n) => isTriggerNode(n.id));
  for (const tn of triggerNodes) {
    const ruleId = tn.data?.ruleId || tn.id.replace(/^trigger:/, "");
    const name = String(tn.data?.name || "Regra").trim() || "Regra";
    const enabled = tn.data?.enabled !== false;

    const trigger = {
      type: tn.data?.trigger?.type || "ticket.status.changed",
      params: tn.data?.trigger?.params || {},
    };

    const conditions = tn.data?.conditions || {};

    // ações conectadas: trigger -> action
    const actionEdges = (edges || []).filter(
      (e) => e.source === tn.id && isActionNode(e.target)
    );
    // ordena por y (posição) para manter uma ordem estável
    const sorted = actionEdges
      .map((e) => nodeById.get(e.target))
      .filter(Boolean)
      .sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));

    const actions = sorted.map((an) => ({
      type: an.data?.action?.type || "jira.comment",
      params: an.data?.action?.params || {},
    }));

    out.push({
      id: ruleId,
      name,
      enabled,
      trigger,
      conditions,
      actions,
    });
  }

  return out;
}

export function isGateNode(id) {
  return /^gate:/.test(String(id || ""));
}

export function validateFlow(nodes, edges) {
  const errors = [];
  const triggerNodes = (nodes || []).filter((n) => isTriggerNode(n.id));

  if (!triggerNodes.length) {
    errors.push("Adicione ao menos 1 regra (template) para salvar.");
    return errors;
  }

  for (const tn of triggerNodes) {
    const trigType = tn.data?.trigger?.type;

    if (trigType === "subtask.allCompleted") {
      const keys = tn.data?.trigger?.params?.subtaskKeys;
      const ok = Array.isArray(keys) && keys.filter(Boolean).length > 0;
      if (!ok) {
        errors.push(
          `Regra "${
            tn.data?.name || tn.id
          }" precisa de ao menos 1 subtarefa conectada ao Centralizador (AND).`
        );
      }
    }
  }

  return errors;
}
