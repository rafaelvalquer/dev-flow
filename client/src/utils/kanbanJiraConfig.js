// src/utils/kanbanJiraConfig.js

import GMUD_TEMPLATES from "../data/gmudTemplates.v1.json";

export const KANBAN_CONFIG_VERSION = 1;
export const KANBAN_TAG = "[GMUD Kanban Config]";

export function nowIso() {
  return new Date().toISOString();
}

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function assertTemplatesShape(tpl) {
  if (!tpl || typeof tpl !== "object")
    throw new Error("gmudTemplates inválido (objeto).");
  if (tpl.schema !== "gmud.templates")
    throw new Error("gmudTemplates.schema inválido.");
  if (tpl.version !== 1) throw new Error("gmudTemplates.version inválido.");
  if (!Array.isArray(tpl.columns))
    throw new Error("gmudTemplates.columns deve ser array.");
  if (!Array.isArray(tpl.templates))
    throw new Error("gmudTemplates.templates deve ser array.");
}

function normalizeColumns(cols) {
  return (cols || [])
    .map((c) => ({
      key: String(c.key || "").trim(),
      title: String(c.title || "").trim(),
      icon: String(c.icon || "").trim(),
      order: Number.isFinite(c.order) ? c.order : 0,
      defaultTemplateIds: Array.isArray(c.defaultTemplateIds)
        ? c.defaultTemplateIds.map(String)
        : [],
    }))
    .filter((c) => c.key && c.title)
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

function normalizeTemplates(tpls) {
  return (tpls || [])
    .map((t) => ({
      id: String(t.id || "").trim(),
      title: String(t.title || "").trim(),
      columnKey: String(t.columnKey || "").trim(),
      order: Number.isFinite(t.order) ? t.order : 0,
      subtasks: Array.isArray(t.subtasks)
        ? t.subtasks
            .map((st) => ({
              id: String(st.id || "").trim(),
              title: String(st.title || "").trim(),
            }))
            .filter((st) => st.id && st.title)
        : [],
    }))
    .filter((t) => t.id && t.title && t.columnKey)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export const GMUD_TEMPLATES_V1 = (() => {
  assertTemplatesShape(GMUD_TEMPLATES);
  const columns = normalizeColumns(GMUD_TEMPLATES.columns);
  const templates = normalizeTemplates(GMUD_TEMPLATES.templates);
  return { ...GMUD_TEMPLATES, columns, templates };
})();

/**
 * Workflow (steps) do Kanban GMUD (derivado do template)
 */
export const DEFAULT_KANBAN_WORKFLOW = GMUD_TEMPLATES_V1.columns.map((c) => ({
  key: c.key,
  title: c.title,
  icon: c.icon,
  order: c.order,
  defaultTemplateIds: c.defaultTemplateIds,
}));

/**
 * Biblioteca de cards + subtarefas (templates) (derivado do template)
 * Mantém shape que o modal e o buildTicketKanbanConfig já usam.
 */
export const DEFAULT_KANBAN_LIBRARY = (() => {
  const colOrderByKey = Object.fromEntries(
    GMUD_TEMPLATES_V1.columns.map((c) => [c.key, c.order])
  );

  return GMUD_TEMPLATES_V1.templates
    .slice()
    .sort((a, b) => {
      const ao = colOrderByKey[a.columnKey] ?? 0;
      const bo = colOrderByKey[b.columnKey] ?? 0;
      return ao - bo || a.order - b.order || a.id.localeCompare(b.id);
    })
    .map((t) => ({
      id: t.id,
      title: t.title,
      columnKey: t.columnKey,
      subtasks: t.subtasks,
      order: t.order,
    }));
})();

export function getWorkflowIndex(workflow, stepKey) {
  return (workflow || DEFAULT_KANBAN_WORKFLOW).findIndex(
    (s) => s.key === stepKey
  );
}

export function serializeConfig(cfg) {
  // JSON pequeno, mas legível
  return JSON.stringify(cfg, null, 2);
}

/**
 * Monta a config instanciada para o ticket.
 * selectedByStepKey: { [stepKey]: [libraryCardId, ...] } (na ordem desejada)
 */
export function buildTicketKanbanConfig({
  ticketKey,
  workflow = DEFAULT_KANBAN_WORKFLOW,
  selectedByStepKey = {},
}) {
  const wf = workflow && workflow.length ? workflow : DEFAULT_KANBAN_WORKFLOW;

  const libById = Object.fromEntries(
    (DEFAULT_KANBAN_LIBRARY || []).map((c) => [c.id, c])
  );

  const columns = {};

  for (const step of wf) {
    const pickedIds = Array.isArray(selectedByStepKey[step.key])
      ? selectedByStepKey[step.key]
      : [];

    const cards = pickedIds
      .map((id) => libById[id])
      .filter(Boolean)
      .map((tpl) => {
        const cardInstanceId = `${tpl.id}__${uid()}`;
        return {
          id: cardInstanceId,
          templateId: tpl.id,
          title: tpl.title,
          subtasks: (tpl.subtasks || []).map((st) => ({
            id: `${st.id}__${uid()}`,
            templateId: st.id,
            title: st.title,
            jiraKey: null,
            jiraId: null,
          })),
        };
      });

    columns[step.key] = {
      title: step.title,
      cards,
    };
  }

  return {
    version: 1,
    kind: "GMUD_KANBAN",
    ticketKey: String(ticketKey || "")
      .trim()
      .toUpperCase(),
    unlockedStepIdx: 0, // manual: começa liberado só o step 0
    workflow: wf,
    columns,
    updatedAt: Date.now(),
  };
}
