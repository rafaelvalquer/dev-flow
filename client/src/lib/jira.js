// src/lib/jira.js
const API_BASE = ""; // mesma origem (proxy do Vite em dev)

// Permite configurar via .env (Vite)
// Ex.: VITE_JIRA_TRANSITION_BACKLOG_ID=11
//      VITE_JIRA_TRANSITION_DONE_ID=41
const ENV =
  typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};

const DONE_FALLBACK_ID = String(ENV.VITE_JIRA_TRANSITION_DONE_ID || "41");
const BACKLOG_FALLBACK_ID = String(ENV.VITE_JIRA_TRANSITION_BACKLOG_ID || "11");
const HOMOLOG_FALLBACK_ID = String(
  ENV.VITE_JIRA_TRANSITION_HOMOLOGACAO_ID || ""
);
const PARA_DEPLOY_FALLBACK_ID = String(
  ENV.VITE_JIRA_TRANSITION_PARA_DEPLOY_ID || ""
);
const CONCLUIDO_FALLBACK_ID = String(
  ENV.VITE_JIRA_TRANSITION_CONCLUIDO_ID || ""
);

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // remove acentos
}

function includesAny(hay, needles) {
  const h = norm(hay);
  return needles.some((n) => h.includes(norm(n)));
}

function summarizeTransitions(payload) {
  const list = payload?.transitions || [];
  return list
    .map((t) => `${t?.name || "?"} -> ${t?.to?.name || "?"}`)
    .join(" | ");
}

function fallbackIdForParentTargetStatus(targetStatusName) {
  const s = norm(targetStatusName);

  if (/(homolog)/.test(s)) return HOMOLOG_FALLBACK_ID || null;
  if (/(para\s*deploy|paradeploy|deploy)/.test(s))
    return PARA_DEPLOY_FALLBACK_ID || null;
  if (/(conclu|done|closed|resolv|finaliz|complete)/.test(s))
    return CONCLUIDO_FALLBACK_ID || null;

  return null;
}

/**
 * Transiciona issue para um status pelo NOME (to.name === targetStatusName)
 * - Tenta GET /transitions (se existir no proxy)
 * - Se não existir, usa fallbackId do .env (ex.: VITE_JIRA_TRANSITION_HOMOLOGACAO_ID)
 */
export async function transitionToStatusName(
  issueKey,
  targetStatusName,
  fallbackId
) {
  const key = String(issueKey || "")
    .trim()
    .toUpperCase();
  const target = String(targetStatusName || "").trim();

  if (!key) throw new Error("Issue key inválida.");
  if (!target) throw new Error("Status alvo inválido.");

  let payload = null;

  // 1) tenta descobrir a transição pelo GET /transitions
  payload = await getTransitions(key).catch(() => null);

  if (payload?.transitions?.length) {
    const wanted = norm(target);

    const chosen = payload.transitions.find(
      (t) => norm(t?.to?.name) === wanted
    );

    if (chosen?.id) {
      await transitionIssue(key, chosen.id);
      return {
        transitionId: chosen.id,
        status: chosen?.to?.name || "",
        statusCategory: chosen?.to?.statusCategory?.key || "",
      };
    }

    // Se não achou, mas temos payload: tenta fallback se tiver
    const fb = String(
      fallbackId || fallbackIdForParentTargetStatus(target) || ""
    ).trim();
    if (fb) {
      await transitionIssue(key, fb);
      return {
        transitionId: fb,
        status: target,
        statusCategory: "",
      };
    }

    throw new Error(
      `Não encontrei transição para "${target}". Disponíveis: ${
        summarizeTransitions(payload) || "—"
      }`
    );
  }

  // 2) proxy não tem GET /transitions => precisa fallbackId
  const fb = String(
    fallbackId || fallbackIdForParentTargetStatus(target) || ""
  ).trim();
  if (!fb) {
    throw new Error(
      `Seu proxy não suporta GET /transitions e não há fallbackId configurado para "${target}". ` +
        `Configure no .env: VITE_JIRA_TRANSITION_HOMOLOGACAO_ID / VITE_JIRA_TRANSITION_PARA_DEPLOY_ID / VITE_JIRA_TRANSITION_CONCLUIDO_ID`
    );
  }

  await transitionIssue(key, fb);
  return {
    transitionId: fb,
    status: target,
    statusCategory: "",
  };
}

/* ===================== Issues ===================== */

export async function getIssue(
  key,
  fields = "summary,subtasks,status,project"
) {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(
      key
    )}?fields=${encodeURIComponent(fields)}`
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ===================== Comments ===================== */

export async function getComments(key) {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(key)}/comments`
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createComment(key, body) {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(key)}/comment`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateComment(key, id, body) {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(
      key
    )}/comment/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ===================== Subtasks ===================== */

export async function createSubtask(
  projectId,
  parentKey,
  summary,
  subtaskIssueTypeId = "10007"
) {
  const r = await fetch(`${API_BASE}/api/jira/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      fields: {
        project: { id: projectId },
        parent: { key: parentKey },
        issuetype: { id: subtaskIssueTypeId },
        summary,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Checklist automático: " + summary },
              ],
            },
          ],
        },
      },
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ===================== Transitions ===================== */

// Observação: seu backend aparentemente NÃO possui GET /transitions.
// Então aqui a gente tenta, mas se vier 404/“Cannot GET”, retorna null e segue com fallbackId.
export async function getTransitions(issueKey) {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(issueKey)}/transitions`,
    { headers: { Accept: "application/json" } }
  );

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    // rota inexistente no proxy (caso atual)
    if (r.status === 404 || /Cannot\s+GET/i.test(text)) return null;
    throw new Error(text || `HTTP ${r.status}`);
  }

  return r.json(); // { transitions: [...] }
}

export async function transitionIssue(issueKey, transitionId) {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ transition: { id: String(transitionId) } }),
    }
  );
  if (!r.ok) throw new Error(await r.text());
  return true;
}

function pickTransition(payload, desiredNames = [], mode = "generic") {
  const list = payload?.transitions || [];
  if (!list.length) return null;

  const desired = desiredNames.map((s) => norm(s)).filter(Boolean);

  const byStatusCategory = (key) =>
    list.find((t) => norm(t?.to?.statusCategory?.key) === norm(key));

  const exactMatch = () =>
    list.find(
      (t) =>
        desired.includes(norm(t?.name)) || desired.includes(norm(t?.to?.name))
    );

  const containsMatch = () =>
    list.find(
      (t) => includesAny(t?.name, desired) || includesAny(t?.to?.name, desired)
    );

  if (mode === "done") {
    return (
      byStatusCategory("done") ||
      exactMatch() ||
      containsMatch() ||
      list.find((t) =>
        /(done|conclu|feito|resolv|closed|finaliz|complete)/i.test(
          `${t?.name || ""} ${t?.to?.name || ""}`
        )
      ) ||
      null
    );
  }

  if (mode === "backlog") {
    return (
      byStatusCategory("new") ||
      exactMatch() ||
      containsMatch() ||
      list.find((t) =>
        /(reopen|reopened|reabrir|reabert|backlog|to do|a fazer|open|aberto)/i.test(
          `${t?.name || ""} ${t?.to?.name || ""}`
        )
      ) ||
      // fallback menos agressivo: algo que NÃO vá para DONE
      list.find((t) => norm(t?.to?.statusCategory?.key) !== "done") ||
      null
    );
  }

  return exactMatch() || containsMatch() || null;
}

function deriveStatusCategory(chosen, mode) {
  const k = chosen?.to?.statusCategory?.key;
  if (k) return k;
  if (mode === "done") return "done";
  if (mode === "backlog") return "new";
  return "";
}

export async function transitionToNamed(
  issueKey,
  desiredNames,
  fallbackId,
  mode = "generic"
) {
  let payload = null;

  // 1) Tenta descobrir pelo GET /transitions (se existir no proxy)
  payload = await getTransitions(issueKey).catch(() => null);

  if (payload) {
    const chosen = pickTransition(payload, desiredNames, mode);
    if (chosen?.id) {
      await transitionIssue(issueKey, chosen.id);
      return {
        transitionId: chosen.id,
        status: chosen?.to?.name || chosen?.name || "",
        statusCategory: deriveStatusCategory(chosen, mode),
      };
    }
  }

  // 2) Fallback obrigatório (no seu caso, porque GET /transitions não existe)
  if (!fallbackId) {
    const available = payload ? summarizeTransitions(payload) : "";
    throw new Error(
      `Seu proxy não suporta GET /transitions e não foi informado fallbackId para: ${desiredNames.join(
        ", "
      )}${available ? `. Disponíveis: ${available}` : ""}`
    );
  }

  await transitionIssue(issueKey, fallbackId);

  return {
    transitionId: String(fallbackId),
    status: "",
    statusCategory: mode === "done" ? "done" : mode === "backlog" ? "new" : "",
  };
}

export async function transitionToDone(
  issueKey,
  fallbackId = DONE_FALLBACK_ID
) {
  return transitionToNamed(
    issueKey,
    [
      "Done",
      "Concluído",
      "Concluída",
      "Feito",
      "Feita",
      "Resolvido",
      "Resolved",
      "Closed",
      "Finalizado",
      "Finalizada",
      "Completed",
      "Complete",
    ],
    fallbackId,
    "done"
  );
}

export async function transitionToBacklog(
  issueKey,
  fallbackId = BACKLOG_FALLBACK_ID
) {
  return transitionToNamed(
    issueKey,
    [
      "Backlog",
      "To Do",
      "Todo",
      "A Fazer",
      "Open",
      "Aberto",
      "Em aberto",
      "Reopen",
      "Reopened",
      "Reabrir",
      "Reaberto",
      "Reaberta",
    ],
    fallbackId,
    "backlog"
  );
}

/* ===================== Attachments ===================== */

export async function uploadAttachments(ticketKey, files) {
  const form = new FormData();
  files.forEach((f) => form.append("files", f, f.name));
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(ticketKey)}/attachments`,
    { method: "POST", body: form }
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function listAttachments(ticketKey) {
  const r = await fetch(
    `${API_BASE}/api/jira/issue/${encodeURIComponent(ticketKey)}/attachments`
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json(); // {attachments: [...]}
}

export function buildDownloadLinks(a) {
  const base = `/api/jira/attachment/${encodeURIComponent(a.id)}`;
  return {
    download: `${base}/download?filename=${encodeURIComponent(
      a.filename || "file"
    )}`,
    inline: `${base}/download?inline=1&filename=${encodeURIComponent(
      a.filename || "file"
    )}`,
  };
}
