// server/routes/jira.routes.js
import { Router } from "express";
import { Readable } from "node:stream";
import { sendUpstream } from "../utils/sendUpstream.js";
import { makeJiraHeaders } from "../utils/jiraAuth.js";

/* =========================================================
   JIRA CLIENT (SERVER-SIDE) — use em Jobs/Services internos
   ========================================================= */
export function createJiraClient(env = process.env) {
  const JIRA_BASE =
    env.JIRA_BASE || "https://clarobr-jsw-tecnologia.atlassian.net";
  const JIRA_EMAIL = env.JIRA_EMAIL;
  const JIRA_TOKEN = env.JIRA_API_TOKEN;

  if (!JIRA_EMAIL || !JIRA_TOKEN) {
    console.warn("[WARN] Defina JIRA_EMAIL e JIRA_API_TOKEN no .env");
  }

  const jiraHeaders = (extra = {}) =>
    makeJiraHeaders({ email: JIRA_EMAIL, token: JIRA_TOKEN }, extra);

  async function jiraFetch(
    path,
    { method = "GET", headers = {}, body, raw = false } = {}
  ) {
    const url = `${JIRA_BASE}${path}`;
    const r = await fetch(url, {
      method,
      headers: jiraHeaders({
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      }),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (raw) return r;

    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (!r.ok) {
      const msg =
        json?.errorMessages?.[0] ||
        json?.errors?.[Object.keys(json?.errors || {})?.[0]] ||
        json?.message ||
        `Jira error ${r.status}`;
      const e = new Error(msg);
      e.status = r.status;
      e.payload = json;
      throw e;
    }

    return json;
  }

  // --------- helpers ADF (comentário) ----------
  function adfFromPlainText(text) {
    return {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: String(text || "") }],
        },
      ],
    };
  }

  async function assignIssue(issueKey, accountId) {
    // Jira Cloud REST v3: PUT /rest/api/3/issue/{issueIdOrKey}/assignee
    // accountId null => unassigned; "-1" => default assignee
    await jiraFetch(`/rest/api/3/issue/${issueKey}/assignee`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: accountId ?? null }),
    });
    return { ok: true };
  }

  // --------- endpoints principais ----------
  function getIssue(key, fields = "summary,subtasks,status,project") {
    const f = Array.isArray(fields) ? fields.join(",") : String(fields || "");
    return jiraFetch(
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${encodeURIComponent(
        f
      )}`
    );
  }

  function searchJql(body) {
    return jiraFetch(`/rest/api/3/search/jql`, { method: "POST", body });
  }

  function createIssue(body) {
    return jiraFetch(`/rest/api/3/issue`, { method: "POST", body });
  }

  function updateIssue(key, body) {
    return jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
      method: "PUT",
      body,
    });
  }

  function getTransitions(key, queryObj = null) {
    const qs = queryObj ? `?${new URLSearchParams(queryObj).toString()}` : "";
    return jiraFetch(
      `/rest/api/3/issue/${encodeURIComponent(key)}/transitions${qs}`
    );
  }

  // equivalente ao jiraClient.transitionIssue do seu jiraTransitions.js antigo
  async function transitionIssue(issueKey, transitionId) {
    await postTransition(issueKey, {
      transition: { id: String(transitionId) },
    });
    return { transitionId: String(transitionId) };
  }

  function postTransition(key, body) {
    return jiraFetch(
      `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
      {
        method: "POST",
        body,
      }
    );
  }

  async function transitionToStatusName(issueKey, statusName) {
    const payload = await getTransitions(issueKey);
    const list = payload?.transitions || [];

    const norm = (s) =>
      String(s || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    const target = norm(statusName);
    const found = list.find((t) => norm(t?.to?.name) === target);

    if (!found?.id) {
      throw new Error(`Transition não encontrada para status "${statusName}".`);
    }

    await postTransition(issueKey, { transition: { id: String(found.id) } });
    return { transitionId: found.id, to: found.to?.name || statusName };
  }

  function getComments(key) {
    return jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`);
  }

  function addCommentADF(key, adfBody) {
    return jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      method: "POST",
      body: { body: adfBody },
    });
  }

  function addCommentText(key, text) {
    return addCommentADF(key, adfFromPlainText(text));
  }

  function updateComment(key, commentId, body) {
    return jiraFetch(
      `/rest/api/3/issue/${encodeURIComponent(
        key
      )}/comment/${encodeURIComponent(commentId)}`,
      { method: "PUT", body }
    );
  }

  // attachments (meta + download raw)
  function getAttachmentMeta(id) {
    return jiraFetch(`/rest/api/3/attachment/${encodeURIComponent(id)}`);
  }

  async function downloadAttachment(id) {
    const meta = await getAttachmentMeta(id);
    const jiraContentUrl = meta?.content;
    if (!jiraContentUrl) throw new Error("Attachment meta sem content URL.");

    // Jira pode responder redirect; siga se necessário
    const first = await fetch(jiraContentUrl, {
      headers: jiraHeaders({ Accept: "*/*" }),
      redirect: "manual",
    });

    if ([301, 302, 303, 307, 308].includes(first.status)) {
      const loc = first.headers.get("location");
      if (!loc) throw new Error("Redirect sem Location no download do Jira.");
      const final = await fetch(loc, { headers: { Accept: "*/*" } });
      if (!final.ok)
        throw new Error(`Falha ao baixar attachment (${final.status}).`);
      return { meta, response: final };
    }

    if (!first.ok)
      throw new Error(`Falha ao baixar attachment (${first.status}).`);
    return { meta, response: first };
  }

  return {
    JIRA_BASE,
    getIssue,
    searchJql,
    createIssue,
    updateIssue,
    getTransitions,
    postTransition,
    transitionIssue,
    transitionToStatusName,
    getComments,
    addCommentADF,
    addCommentText,
    updateComment,
    getAttachmentMeta,
    downloadAttachment,
    adfFromPlainText,
    jiraFetch,
    assignIssue,
  };
}

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/* =========================================================
   ROUTES (PROXY) — usado pelo Frontend via /api/jira/*
   ========================================================= */
export default function jiraRoutes({ upload, env }) {
  const router = Router();

  const JIRA_BASE =
    env.JIRA_BASE || "https://clarobr-jsw-tecnologia.atlassian.net";
  const JIRA_EMAIL = env.JIRA_EMAIL;
  const JIRA_TOKEN = env.JIRA_API_TOKEN;

  if (!JIRA_EMAIL || !JIRA_TOKEN) {
    console.warn("[WARN] Defina JIRA_EMAIL e JIRA_API_TOKEN no .env");
  }

  const jiraHeaders = (extra = {}) =>
    makeJiraHeaders({ email: JIRA_EMAIL, token: JIRA_TOKEN }, extra);

  // GET issue
  router.get("/issue/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const fields = req.query.fields || "summary,subtasks,status,project";
      const url = `${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(
        key
      )}?fields=${encodeURIComponent(fields)}`;
      const r = await fetch(url, { headers: jiraHeaders() });
      return sendUpstream(res, r);
    } catch (err) {
      console.error("GET issue error:", err);
      return res
        .status(500)
        .json({ error: "Proxy error on GET issue", details: String(err) });
    }
  });

  // Busca geral de usuários
  router.get("/users/search", async (req, res) => {
    try {
      const query = String(req.query.query || "").trim();
      const maxResults = Number(req.query.maxResults || 20);

      const url = `${JIRA_BASE}/rest/api/3/user/search?query=${encodeURIComponent(
        query
      )}&maxResults=${encodeURIComponent(maxResults)}`;

      const r = await fetch(url, { headers: jiraHeaders() });
      return sendUpstream(res, r);
    } catch (err) {
      console.error("GET users/search error:", err);
      return res.status(500).json({
        error: "Proxy error on GET users/search",
        details: String(err),
      });
    }
  });

  // Usuários atribuíveis
  router.get("/users/assignable", async (req, res) => {
    try {
      const issueKey = String(req.query.issueKey || "").trim();
      const query = String(req.query.query || "").trim();
      const maxResults = Number(req.query.maxResults || 20);

      if (!issueKey)
        return res.status(400).json({ error: "issueKey é obrigatório" });

      const url =
        `${JIRA_BASE}/rest/api/3/user/assignable/search?` +
        `issueKey=${encodeURIComponent(issueKey)}` +
        `&query=${encodeURIComponent(query)}` +
        `&maxResults=${encodeURIComponent(maxResults)}`;

      const r = await fetch(url, { headers: jiraHeaders() });
      return sendUpstream(res, r);
    } catch (err) {
      console.error("GET users/assignable error:", err);
      return res.status(500).json({
        error: "Proxy error on GET users/assignable",
        details: String(err),
      });
    }
  });

  // Criar issue/subtarefa
  router.post("/issue", async (req, res) => {
    try {
      const url = `${JIRA_BASE}/rest/api/3/issue`;
      const r = await fetch(url, {
        method: "POST",
        headers: jiraHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(req.body),
      });
      return sendUpstream(res, r);
    } catch (err) {
      console.error("POST issue error:", err);
      return res
        .status(500)
        .json({ error: "Proxy error on POST issue", details: String(err) });
    }
  });

  // Transitions (GET)
  router.get("/issue/:key/transitions", async (req, res) => {
    try {
      const { key } = req.params;
      const qs = new URLSearchParams(req.query).toString();
      const url = `${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(
        key
      )}/transitions${qs ? `?${qs}` : ""}`;
      const r = await fetch(url, { headers: jiraHeaders() });
      return sendUpstream(res, r);
    } catch (err) {
      console.error("GET transitions error:", err);
      return res.status(500).json({
        error: "Proxy error on GET transitions",
        details: String(err),
      });
    }
  });

  // Transitions (POST)
  router.post("/issue/:key/transitions", async (req, res) => {
    try {
      const { key } = req.params;
      const url = `${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(
        key
      )}/transitions`;
      const r = await fetch(url, {
        method: "POST",
        headers: jiraHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(req.body),
      });
      return sendUpstream(res, r);
    } catch (err) {
      console.error("POST transitions error:", err);
      return res.status(500).json({
        error: "Proxy error on POST transitions",
        details: String(err),
      });
    }
  });

  // Comentários (GET)
  router.get("/issue/:key/comments", async (req, res) => {
    try {
      const { key } = req.params;
      const url = `${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(
        key
      )}/comment`;
      const r = await fetch(url, { headers: jiraHeaders() });
      return sendUpstream(res, r);
    } catch (err) {
      console.error("GET comments error:", err);
      return res
        .status(500)
        .json({ error: "Proxy error on GET comments", details: String(err) });
    }
  });

  // Comentário (POST)
  router.post("/issue/:key/comment", async (req, res) => {
    try {
      const { key } = req.params;
      const url = `${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(
        key
      )}/comment`;
      const r = await fetch(url, {
        method: "POST",
        headers: jiraHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(req.body),
      });
      return sendUpstream(res, r);
    } catch (err) {
      console.error("POST comment error:", err);
      return res
        .status(500)
        .json({ error: "Proxy error on POST comment", details: String(err) });
    }
  });

  // Comentário (PUT)
  router.put("/issue/:key/comment/:id", async (req, res) => {
    try {
      const { key, id } = req.params;
      const url = `${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(
        key
      )}/comment/${encodeURIComponent(id)}`;
      const r = await fetch(url, {
        method: "PUT",
        headers: jiraHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(req.body),
      });
      return sendUpstream(res, r);
    } catch (err) {
      console.error("PUT comment error:", err);
      return res
        .status(500)
        .json({ error: "Proxy error on PUT comment", details: String(err) });
    }
  });

  // Lista anexos
  router.get("/issue/:key/attachments", async (req, res) => {
    try {
      const { key } = req.params;
      const url = `${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(
        key
      )}?fields=${encodeURIComponent("attachment")}`;
      const r = await fetch(url, { headers: jiraHeaders() });
      if (!r.ok) return sendUpstream(res, r);

      const issue = await r.json();
      const attachments = (issue.fields?.attachment || []).map((a) => ({
        id: a.id,
        filename: a.filename,
        size: a.size,
        mimeType: a.mimeType,
        created: a.created,
        author: a.author?.displayName || "",
        downloadUrl: `/api/jira/attachment/${
          a.id
        }/download?filename=${encodeURIComponent(a.filename || "file")}`,
        inlineUrl: `/api/jira/attachment/${
          a.id
        }/download?inline=1&filename=${encodeURIComponent(
          a.filename || "file"
        )}`,
        thumbnail: a.thumbnail || null,
      }));

      return res.json({ attachments });
    } catch (err) {
      console.error("GET issue attachments error:", err);
      return res.status(500).json({ error: "Proxy error on list attachments" });
    }
  });

  // Upload anexos (multipart)
  router.post(
    "/issue/:key/attachments",
    upload.array("files"),
    async (req, res) => {
      try {
        const { key } = req.params;
        if (!req.files?.length)
          return res.status(400).json({ error: "Nenhum arquivo enviado" });

        const form = new FormData();
        for (const f of req.files) {
          const blob = new Blob([f.buffer], {
            type: f.mimetype || "application/octet-stream",
          });
          form.append("file", blob, f.originalname);
        }

        const url = `${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(
          key
        )}/attachments`;
        const r = await fetch(url, {
          method: "POST",
          headers: jiraHeaders({ "X-Atlassian-Token": "no-check" }),
          body: form,
        });
        return sendUpstream(res, r);
      } catch (err) {
        console.error("POST attachments error:", err);
        return res
          .status(500)
          .json({ error: "Proxy error on upload attachments" });
      }
    }
  );

  // Download/inline
  router.get("/attachment/:id/download", async (req, res) => {
    const { id } = req.params;
    const { filename: fnQuery, inline } = req.query;

    try {
      const metaUrl = `${JIRA_BASE}/rest/api/3/attachment/${encodeURIComponent(
        id
      )}`;
      const metaResp = await fetch(metaUrl, {
        headers: jiraHeaders({ Accept: "application/json" }),
      });
      if (!metaResp.ok) return sendUpstream(res, metaResp, "text/plain");
      const meta = await metaResp.json();

      const jiraContentUrl = meta.content;
      const filename = fnQuery || meta.filename || "file";
      const fallbackMime = meta.mimeType || "application/octet-stream";
      const sizeHdr =
        meta.size && Number.isFinite(meta.size) ? String(meta.size) : null;

      const first = await fetch(jiraContentUrl, {
        headers: jiraHeaders({ Accept: "*/*" }),
        redirect: "manual",
      });

      let finalResp = first;
      if ([301, 302, 303, 307, 308].includes(first.status)) {
        const loc = first.headers.get("location");
        if (!loc) {
          const t = await first.text();
          return res
            .status(502)
            .type("text/plain")
            .send("Redirect sem Location do Jira.\n" + t.slice(0, 300));
        }
        finalResp = await fetch(loc, { headers: { Accept: "*/*" } });
      }

      if (!finalResp.ok || !finalResp.body)
        return sendUpstream(res, finalResp, "text/plain");

      res.setHeader(
        "Content-Disposition",
        `${
          inline ? "inline" : "attachment"
        }; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(
          filename
        )}`
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Type",
        finalResp.headers.get("content-type") || fallbackMime
      );
      if (sizeHdr) res.setHeader("Content-Length", sizeHdr);

      return Readable.fromWeb(finalResp.body).pipe(res);
    } catch (err) {
      console.error("DOWNLOAD attachment error:", err);
      return res
        .status(500)
        .type("text/plain")
        .send("Proxy error on attachment download");
    }
  });

  // Busca paginada por JQL
  router.post("/search/jql", async (req, res) => {
    try {
      const url = `${JIRA_BASE}/rest/api/3/search/jql`;
      const r = await fetch(url, {
        method: "POST",
        headers: jiraHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(req.body),
      });
      return sendUpstream(res, r);
    } catch (err) {
      console.error("POST search/jql error:", err);
      return res.status(500).json({
        error: "Proxy error on POST search/jql",
        details: String(err),
      });
    }
  });

  // Atualizar issue
  router.put("/issue/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const url = `${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(key)}`;
      const r = await fetch(url, {
        method: "PUT",
        headers: jiraHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(req.body),
      });
      return sendUpstream(res, r);
    } catch (err) {
      console.error("PUT issue error:", err);
      return res
        .status(500)
        .json({ error: "Proxy error on PUT issue", details: String(err) });
    }
  });

  return router;
}
