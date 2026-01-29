// src/utils/kanbanSync.js
import {
  DEFAULT_KANBAN_LIBRARY,
  KANBAN_TAG,
  nowIso,
  serializeConfig,
} from "./kanbanJiraConfig";
import { DONE_STATUS_NAMES } from "./gmudUtils";
import { adfFromTagAndText, adfToPlainText } from "../lib/adf";

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

/**
 * Workflow (steps) do Kanban GMUD
 * - key: identificador do step (usado como chave em columns)
 * - title: título exibido
 * - icon: classe do FontAwesome (igual você já usa)
 */
export const DEFAULT_KANBAN_WORKFLOW = [
  {
    key: "desenvolvimento",
    title: "Desenvolvimento",
    icon: "fa-solid fa-pen-ruler",
  },
  { key: "homologação", title: "Homologação", icon: "fa-solid fa-list-check" },
  { key: "deploy", title: "Deploy", icon: "fa-solid fa-rocket" },
  {
    key: "posDeploy",
    title: "Pós-Deploy",
    icon: "fa-solid fa-clipboard-check",
  },
];

export function clampSummary(summary, max = 255) {
  const s = String(summary || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/**
 * Biblioteca de cards + subtarefas (templates).
 * O modal deixa você escolher quais cards entram em cada step.
 */
export function buildJiraSubtaskSummary({
  stepTitle,
  cardTitle,
  subtaskTitle,
}) {
  const base = `[GMUD] ${stepTitle} - ${cardTitle} - ${subtaskTitle}`;
  return clampSummary(base, 255);
}

export function getWorkflowIndex(workflow, stepKey) {
  return (workflow || DEFAULT_KANBAN_WORKFLOW).findIndex(
    (s) => s.key === stepKey
  );
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

export function applyJiraStatusesToConfig(cfg, subtasksBySummary) {
  const map = subtasksBySummary || {};
  const next = structuredClone
    ? structuredClone(cfg)
    : JSON.parse(JSON.stringify(cfg));

  for (const stepKey of Object.keys(next.columns || {})) {
    const col = next.columns[stepKey];
    for (const card of col.cards || []) {
      for (const st of card.subtasks || []) {
        const summary = buildKanbanSummary({
          stepTitle: col.title,
          cardTitle: card.title,
          subTitle: st.title,
        });

        const jira = map[normalizeKey(summary)];
        st.jiraStatus = jira?.status || "";
        st.jiraStatusCategory = jira?.statusCategory || "";
        st.done = jira ? isDoneStatus(jira) : false;
      }
    }
  }

  return next;
}

export function syncKanbanConfigWithJira(cfg, subtasksBySummary) {
  if (!cfg) return { nextCfg: cfg, changed: false };

  const map = subtasksBySummary || {};

  // Reverse index para lidar com renomeio no Jira (summary muda, mas jiraKey/jiraId continuam)
  const byKey = {};
  const byId = {};
  for (const k of Object.keys(map)) {
    const v = map[k];
    if (v?.key) byKey[String(v.key).toUpperCase()] = v;
    if (v?.id) byId[String(v.id)] = v;
  }

  const next = structuredClone
    ? structuredClone(cfg)
    : JSON.parse(JSON.stringify(cfg));
  let changed = false;

  for (const stepKey of Object.keys(next.columns || {})) {
    const col = next.columns[stepKey];
    for (const card of col.cards || []) {
      for (const st of card.subtasks || []) {
        const summary = buildKanbanSummary({
          stepTitle: col.title,
          cardTitle: card.title,
          subTitle: st.title,
        });

        let jira = map[normalizeKey(summary)];

        // fallback: se o summary foi renomeado no Jira, tenta casar por jiraKey/jiraId
        if (!jira) {
          const jk = st?.jiraKey ? String(st.jiraKey).toUpperCase() : "";
          if (jk && byKey[jk]) jira = byKey[jk];
          else if (st?.jiraId && byId[String(st.jiraId)])
            jira = byId[String(st.jiraId)];
        }

        if (!jira) continue;

        // vínculo (somente preenche se estiver faltando)
        if (!st.jiraKey && jira.key) {
          st.jiraKey = jira.key;
          changed = true;
        }
        if (!st.jiraId && jira.id) {
          st.jiraId = jira.id;
          changed = true;
        }

        // derivados de status
        const nextStatus = jira.status || "";
        const nextCat = jira.statusCategory || "";
        const nextDone = isDoneStatus(jira);

        if (st.jiraStatus !== nextStatus) {
          st.jiraStatus = nextStatus;
          changed = true;
        }
        if (st.jiraStatusCategory !== nextCat) {
          st.jiraStatusCategory = nextCat;
          changed = true;
        }
        if (st.done !== nextDone) {
          st.done = nextDone;
          changed = true;
        }
      }
    }
  }

  return { nextCfg: next, changed };
}

export function buildKanbanSummary({ stepTitle, cardTitle, subTitle }) {
  // padrão estável (fonte da verdade)
  return `[GMUD] ${stepTitle} - ${cardTitle} - ${subTitle}`.trim();
}

export function computeOverallPct(cfg, subtasksBySummary) {
  if (!cfg) return 0;

  let total = 0;
  let done = 0;

  for (const stepKey of Object.keys(cfg.columns || {})) {
    const col = cfg.columns[stepKey];
    for (const card of col.cards || []) {
      for (const st of card.subtasks || []) {
        total++;
        const summary = buildKanbanSummary({
          stepTitle: col.title,
          cardTitle: card.title,
          subTitle: st.title,
        });
        const jira = (subtasksBySummary || {})[normalizeKey(summary)];
        if (jira && isDoneStatus(jira)) done++;
      }
    }
  }

  if (!total) return 0;
  return Math.round((done / total) * 100);
}

export function computeStepPct(cfg, stepKey, subtasksBySummary) {
  const col = cfg?.columns?.[stepKey];
  if (!col) return { pct: 0, total: 0, done: 0, complete: false };

  let total = 0;
  let done = 0;

  for (const card of col.cards || []) {
    for (const st of card.subtasks || []) {
      total++;
      const summary = buildKanbanSummary({
        stepTitle: col.title,
        cardTitle: card.title,
        subTitle: st.title,
      });
      const jira = (subtasksBySummary || {})[normalizeKey(summary)];
      if (jira && isDoneStatus(jira)) done++;
    }
  }

  const complete = total === 0 ? true : done === total;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);

  return { pct, total, done, complete };
}

export async function ensureSubtasksForStep({
  cfg,
  stepIdx,
  ticketKey,
  projectId,
  subtasksBySummary,
  createSubtask,
  onProgress, // (patch) => void
}) {
  if (!cfg) return { nextCfg: cfg, nextMap: subtasksBySummary, created: [] };

  const workflow = cfg.workflow || [];
  const step = workflow[stepIdx];
  if (!step) return { nextCfg: cfg, nextMap: subtasksBySummary, created: [] };

  const col = cfg.columns?.[step.key];
  if (!col) return { nextCfg: cfg, nextMap: subtasksBySummary, created: [] };

  const nextCfg = structuredClone(cfg);
  const nextMap = { ...(subtasksBySummary || {}) };
  const created = [];

  // lista de "pendências" (st sem mapping e sem subtask no Jira)
  const pending = [];
  for (const card of col.cards || []) {
    for (const st of card.subtasks || []) {
      const summary = buildJiraSubtaskSummary({
        stepTitle: col.title,
        cardTitle: card.title,
        subtaskTitle: st.title,
      });
      const mapKey = normalizeKey(summary);

      if (st.jiraKey || st.jiraId) continue;
      if (nextMap[mapKey]?.key || nextMap[mapKey]?.id) continue;

      pending.push({
        cardTitle: card.title,
        stTitle: st.title,
        summary,
        mapKey,
      });
    }
  }

  if (!pending.length) {
    return { nextCfg, nextMap, created };
  }

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];

    onProgress?.({
      title: `Criando subtarefas - ${col.title}`,
      message: `Criando subtarefas (${i + 1}/${pending.length})...`,
      current: i,
      total: pending.length,
      created: [...created],
    });

    const createdJira = await createSubtask(projectId, ticketKey, p.summary);

    nextMap[p.mapKey] = {
      key: createdJira.key,
      id: createdJira.id,
      status: "",
      statusCategory: "",
    };

    created.push(p.summary);

    // grava mapping no cfg
    const col2 = nextCfg.columns?.[step.key];
    for (const card of col2.cards || []) {
      if (card.title !== p.cardTitle) continue;

      for (const st of card.subtasks || []) {
        if (st.title !== p.stTitle) continue;
        st.jiraKey = createdJira.key;
        st.jiraId = createdJira.id;
        break;
      }
    }

    onProgress?.({
      current: i + 1,
      created: [...created],
    });

    // yield para UI
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 0));
  }

  return { nextCfg, nextMap, created };
}

/* =========================
   MongoDB (tickets) storage
========================= */

async function apiJson(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    const msg =
      (data && (data.error || data.message)) || text || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.payload = data;
    throw err;
  }

  return data;
}

export async function getKanbanConfigFromDb(ticketKey) {
  const tk = String(ticketKey || "")
    .trim()
    .toUpperCase();
  if (!tk) return { found: false, config: null, ticketId: null };

  return apiJson(`/api/tickets/${encodeURIComponent(tk)}/kanban`, {
    method: "GET",
  });
}

export async function upsertKanbanConfigDb({ ticketKey, config }) {
  const tk = String(ticketKey || "")
    .trim()
    .toUpperCase();
  if (!tk) throw new Error("ticketKey é obrigatório.");

  return apiJson(`/api/tickets/${encodeURIComponent(tk)}/kanban`, {
    method: "PUT", // ou "POST" dependendo do seu backend
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
}

export function findTaggedComment(payload, tag) {
  const comments = payload?.comments || [];
  for (const c of comments) {
    const plain = adfToPlainText(c.body || {});
    const trimmed = String(plain || "").trim();
    if (trimmed.startsWith(tag)) {
      const textSemTag = trimmed.slice(tag.length).trimStart();
      return { found: true, id: c.id, textSemTag };
    }
  }
  return { found: false, id: null, textSemTag: "" };
}

export function extractKanbanConfigFromCommentsPayload(payload) {
  const f = findTaggedComment(payload, KANBAN_TAG);
  if (!f.found) {
    return { found: false, commentId: null, config: null, error: "" };
  }

  function parseConfigText(textSemTag) {
    const raw = String(textSemTag || "").trim();

    // aceita JSON puro ou bloco ```json
    const unwrapped = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    if (!unwrapped) return { ok: false, error: "Config vazia.", config: null };

    try {
      const cfg = JSON.parse(unwrapped);
      if (!isValidKanbanConfig(cfg)) {
        return { ok: false, error: "Config inválida (schema).", config: null };
      }
      return { ok: true, error: "", config: cfg };
    } catch (e) {
      return {
        ok: false,
        error: "Falha ao parsear JSON do config.",
        config: null,
      };
    }
  }

  const parsed = parseConfigText(f.textSemTag);
  if (!parsed.ok) {
    return { found: true, commentId: f.id, config: null, error: parsed.error };
  }

  return { found: true, commentId: f.id, config: parsed.config, error: "" };
}
export function isDoneStatus(st) {
  const cat = String(st?.statusCategory || "")
    .trim()
    .toLowerCase();
  if (cat === "done") return true;

  const name =
    typeof st === "string" ? st : String(st?.status || st?.name || "").trim();

  const s = name.toLowerCase();
  return DONE_STATUS_NAMES.includes(s);
}

export function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Validação leve (para evitar quebrar UI por config incompleto).
 */
export function isValidKanbanConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return false;
  if (!Array.isArray(cfg.workflow) || !cfg.workflow.length) return false;
  if (!cfg.columns || typeof cfg.columns !== "object") return false;
  if (typeof cfg.unlockedStepIdx !== "number") return false;
  return true;
}
