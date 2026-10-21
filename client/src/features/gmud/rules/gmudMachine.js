export const GMUD_STATES = Object.freeze({
  DRAFT: "draft",
  SYNCED: "synced",
  STEP_ACTIVE: "step_active",
  STEP_READY_TO_ADVANCE: "step_ready_to_advance",
  STEP_ADVANCING: "step_advancing",
  COMPLETED: "completed",
  ERROR: "error",
});

export const GMUD_EVENTS = Object.freeze({
  SYNC_SUCCESS: "SYNC_SUCCESS",
  SAVE_STRUCTURE: "SAVE_STRUCTURE",
  SUBTASK_DONE: "SUBTASK_DONE",
  EVIDENCE_ADDED: "EVIDENCE_ADDED",
  REQUEST_ADVANCE: "REQUEST_ADVANCE",
  ADVANCE_SUCCESS: "ADVANCE_SUCCESS",
  ADVANCE_FAILED: "ADVANCE_FAILED",
  RESET_STEP: "RESET_STEP",
});

export function normalizeStepKey(value) {
  return String(value || "").trim();
}

export function stepRequiresEvidence(step = {}) {
  const key = normalizeStepKey(step.key).toLowerCase();
  const title = normalizeStepKey(step.title || step.name).toLowerCase();
  return (
    /deploy|implant|homolog|valid|pos|p[oó]s/.test(key) ||
    /deploy|implant|homolog|valid|pos|p[oó]s/.test(title)
  );
}

export function getWorkflowStep(workflow = [], index = 0) {
  if (!Array.isArray(workflow) || !workflow.length) return null;
  const safeIndex = Math.max(0, Math.min(index || 0, workflow.length - 1));
  return workflow[safeIndex] || null;
}

export function getStepProgress({ config, stepKey, subtasksBySummary = {} }) {
  const column = config?.columns?.[stepKey];
  const cards = Array.isArray(column?.cards) ? column.cards : [];
  const subtasks = cards.flatMap((card) =>
    (card?.subtasks || []).map((subtask) => ({
      card,
      subtask,
      summary: subtask?.summary || subtask?.title || "",
    })),
  );

  if (!subtasks.length) {
    return { done: 0, total: 0, pct: 100, complete: true };
  }

  const done = subtasks.reduce((count, item) => {
    const localDone = item.subtask?.done === true;
    const linked = Object.values(subtasksBySummary || {}).find((jira) => {
      const jiraKey = String(jira?.key || jira?.jiraKey || "").toUpperCase();
      const subtaskKey = String(
        item.subtask?.jiraKey || item.subtask?.key || "",
      ).toUpperCase();
      return subtaskKey && jiraKey === subtaskKey;
    });
    const jiraDone =
      String(linked?.statusCategory || "").toLowerCase() === "done" ||
      /done|conclu|fechad|resol|closed/i.test(String(linked?.status || ""));
    return count + (localDone || jiraDone ? 1 : 0);
  }, 0);

  return {
    done,
    total: subtasks.length,
    pct: Math.round((done / subtasks.length) * 100),
    complete: done === subtasks.length,
  };
}

export function canAdvanceStep({
  config,
  workflow,
  unlockedStepIdx = 0,
  subtasksBySummary = {},
  evidenceCountsByStep = {},
  jiraCtx = null,
}) {
  const step = getWorkflowStep(workflow || config?.workflow, unlockedStepIdx);
  if (!step) {
    return { ok: false, reason: "missing_step" };
  }

  if (!jiraCtx?.ticketKey && !jiraCtx?.projectId) {
    return { ok: false, reason: "missing_jira_context", step };
  }

  const progress = getStepProgress({
    config,
    stepKey: step.key,
    subtasksBySummary,
  });
  if (!progress.complete) {
    return { ok: false, reason: "pending_subtasks", step, progress };
  }

  const evidenceCount = Number(evidenceCountsByStep?.[step.key] || 0);
  if (stepRequiresEvidence(step) && evidenceCount <= 0) {
    return { ok: false, reason: "missing_evidence", step, progress };
  }

  return { ok: true, reason: "ready", step, progress };
}

export function deriveGmudState(input = {}) {
  const workflow = input.workflow || input.config?.workflow || [];
  const lastIdx = Math.max(0, workflow.length - 1);

  if (input.error) return GMUD_STATES.ERROR;
  if (!input.config) return GMUD_STATES.DRAFT;
  if (!input.jiraCtx) return GMUD_STATES.SYNCED;
  if ((input.unlockedStepIdx || 0) > lastIdx && workflow.length) {
    return GMUD_STATES.COMPLETED;
  }

  const guard = canAdvanceStep(input);
  return guard.ok
    ? GMUD_STATES.STEP_READY_TO_ADVANCE
    : GMUD_STATES.STEP_ACTIVE;
}

export function transition(current, event = {}) {
  const state = current?.value || GMUD_STATES.DRAFT;
  const context = { ...(current?.context || {}), ...(event.context || {}) };

  switch (event.type) {
    case GMUD_EVENTS.SYNC_SUCCESS:
      return { value: deriveGmudState(context), context };
    case GMUD_EVENTS.SAVE_STRUCTURE:
      return { value: deriveGmudState(context), context };
    case GMUD_EVENTS.SUBTASK_DONE:
    case GMUD_EVENTS.EVIDENCE_ADDED:
    case GMUD_EVENTS.RESET_STEP:
      return { value: deriveGmudState(context), context };
    case GMUD_EVENTS.REQUEST_ADVANCE: {
      const guard = canAdvanceStep(context);
      return guard.ok
        ? { value: GMUD_STATES.STEP_ADVANCING, context }
        : { value: state, context: { ...context, lastGuard: guard } };
    }
    case GMUD_EVENTS.ADVANCE_SUCCESS: {
      const nextContext = {
        ...context,
        unlockedStepIdx: (context.unlockedStepIdx || 0) + 1,
      };
      return { value: deriveGmudState(nextContext), context: nextContext };
    }
    case GMUD_EVENTS.ADVANCE_FAILED:
      return {
        value: GMUD_STATES.ERROR,
        context: { ...context, error: event.error || "advance_failed" },
      };
    default:
      return { value: state, context };
  }
}

export const gmudMachine = { transition };
