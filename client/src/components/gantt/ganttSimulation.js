function safeDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cloneDate(value) {
  const date = safeDate(value);
  return date ? new Date(date.getTime()) : null;
}

function normalizeTaskId(taskOrId) {
  return String(
    typeof taskOrId === "object" ? taskOrId?.id || "" : taskOrId || ""
  ).trim();
}

function isTaskRow(task) {
  return task?.type === "task" && !task?.isWindowBoundary;
}

export function makeSimulationKey(issueKey, activityId) {
  const key = String(issueKey || "")
    .trim()
    .toUpperCase();
  const activity = String(activityId || "").trim();
  return key && activity ? `${key}::${activity}` : "";
}

export function buildSimulationBaseline(tasks) {
  const baseline = new Map();

  for (const task of tasks || []) {
    if (!isTaskRow(task)) continue;
    const id = normalizeTaskId(task);
    if (!id) continue;

    baseline.set(id, {
      id,
      issueKey: String(task.issueKey || "").trim().toUpperCase(),
      activityId: String(task.activityId || "").trim(),
      name: String(task.name || ""),
      start: cloneDate(task.start),
      end: cloneDate(task.end),
      recurso: task.recurso,
      area: task.area,
      risk: Boolean(task.risk),
    });
  }

  return baseline;
}

export function applySimulationDrafts(tasks, drafts) {
  const draftMap = drafts instanceof Map ? drafts : new Map();
  const applied = (tasks || []).map((task) => {
    if (!task) return task;
    const draft = draftMap.get(normalizeTaskId(task));
    if (!draft) return task;

    return {
      ...task,
      ...(draft.meta || {}),
      start: cloneDate(draft.start) || task.start,
      end: cloneDate(draft.end) || task.end,
      isSimulationChanged: true,
    };
  });

  const childRangesByIssue = new Map();
  for (const task of applied) {
    if (!isTaskRow(task)) continue;
    const issueKey = String(task.issueKey || "").trim().toUpperCase();
    const start = safeDate(task.start);
    const end = safeDate(task.end);
    if (!issueKey || !start || !end) continue;
    const current = childRangesByIssue.get(issueKey);
    childRangesByIssue.set(issueKey, {
      start: !current || start < current.start ? start : current.start,
      end: !current || end > current.end ? end : current.end,
    });
  }

  return applied.map((task) => {
    if (!task || task.type !== "project") return task;
    const issueKey = String(task.issueKey || "").trim().toUpperCase();
    const range = childRangesByIssue.get(issueKey);
    if (!range) return task;
    return {
      ...task,
      start: cloneDate(range.start),
      end: cloneDate(range.end),
    };
  });
}

export function upsertDateDrafts(currentDrafts, updates) {
  const next = new Map(currentDrafts || []);

  for (const update of updates || []) {
    if (!isTaskRow(update)) continue;
    const id = normalizeTaskId(update);
    if (!id) continue;
    const current = next.get(id) || {};
    next.set(id, {
      ...current,
      id,
      issueKey: String(update.issueKey || "").trim().toUpperCase(),
      activityId: String(update.activityId || "").trim(),
      start: cloneDate(update.start),
      end: cloneDate(update.end),
    });
  }

  return next;
}

export function upsertMetaDraft(currentDrafts, task, patch) {
  if (!isTaskRow(task)) return new Map(currentDrafts || []);
  const id = normalizeTaskId(task);
  if (!id) return new Map(currentDrafts || []);

  const next = new Map(currentDrafts || []);
  const current = next.get(id) || {};
  next.set(id, {
    ...current,
    id,
    issueKey: String(task.issueKey || "").trim().toUpperCase(),
    activityId: String(task.activityId || "").trim(),
    start: cloneDate(current.start) || cloneDate(task.start),
    end: cloneDate(current.end) || cloneDate(task.end),
    meta: {
      ...(current.meta || {}),
      ...(patch || {}),
    },
  });

  return next;
}

export function hasSimulationChanges(drafts) {
  return drafts instanceof Map && drafts.size > 0;
}

export function getSimulationChanges(drafts, baseline) {
  const draftMap = drafts instanceof Map ? drafts : new Map();
  const baselineMap = baseline instanceof Map ? baseline : new Map();

  return Array.from(draftMap.values())
    .map((draft) => {
      const original = baselineMap.get(normalizeTaskId(draft));
      return {
        ...draft,
        original,
      };
    })
    .filter((change) => change.issueKey && change.activityId);
}

export function detectResourceConflicts(tasks) {
  const byResource = new Map();

  for (const task of tasks || []) {
    if (!isTaskRow(task)) continue;
    const resource = String(task.recurso || "Sem recurso").trim() || "Sem recurso";
    if (!byResource.has(resource)) byResource.set(resource, []);
    byResource.get(resource).push(task);
  }

  const ids = new Set();
  const details = [];

  for (const [resource, list] of byResource.entries()) {
    const sorted = [...list].sort(
      (a, b) => safeDate(a.start)?.getTime() - safeDate(b.start)?.getTime()
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const current = sorted[i];
      const prevEnd = safeDate(prev.end);
      const currentStart = safeDate(current.start);
      if (!prevEnd || !currentStart) continue;
      if (currentStart <= prevEnd) {
        ids.add(prev.id);
        ids.add(current.id);
        details.push({ resource, previous: prev, current });
      }
    }
  }

  return { ids, details };
}

export function detectDependencyViolations(tasks, getNextAllowedStart) {
  const taskMap = new Map(
    (tasks || []).filter(isTaskRow).map((task) => [normalizeTaskId(task), task])
  );
  const ids = new Set();
  const details = [];

  for (const task of taskMap.values()) {
    const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
    for (const depId of dependencies) {
      const predecessor = taskMap.get(normalizeTaskId(depId));
      if (!predecessor) continue;
      const allowedStart =
        typeof getNextAllowedStart === "function"
          ? getNextAllowedStart(predecessor.end)
          : safeDate(predecessor.end);
      const currentStart = safeDate(task.start);
      if (!allowedStart || !currentStart) continue;
      if (currentStart < allowedStart) {
        ids.add(task.id);
        ids.add(predecessor.id);
        details.push({ predecessor, task, allowedStart });
      }
    }
  }

  return { ids, details };
}

export function buildStructuredFilterOptions(tasks) {
  const resources = new Set();
  const areas = new Set();

  for (const task of tasks || []) {
    if (!isTaskRow(task)) continue;
    const resource = String(task.recurso || "").trim();
    const area = String(task.area || "").trim();
    if (resource) resources.add(resource);
    if (area && area !== "—") areas.add(area);
  }

  const sort = (values) =>
    Array.from(values).sort((a, b) => String(a).localeCompare(String(b)));

  return {
    resources: sort(resources),
    areas: sort(areas),
  };
}
