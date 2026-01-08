// server/server.js  (ou o caminho onde seu server.js está)
// Copie e cole este arquivo inteiro.
//
// Requisitos:
// - Node 18+ (fetch global)
// - package.json com "type": "module"
// - .env com GEMINI_API_KEY (e opcional GEMINI_MODEL)
// - arquivo: ./lib/rdmCopilotGemini.js (com export registerRdmCopilotRoutes)

import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import multer from "multer";
import { Readable } from "node:stream";
import { registerRdmCopilotRoutes } from "./lib/rdmCopilotGemini.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Upload (memória) - usado pelo Jira e também pelo Co-pilot
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// =====================================================
// Gemini Co-pilot (RDM) - REGISTRA A ROTA AQUI
// =====================================================
// Importante: registrar depois de criar `app` e `upload`.
registerRdmCopilotRoutes(app, upload, process.env);

// =====================================================
// Jira Proxy
// =====================================================
const JIRA_BASE =
  process.env.JIRA_BASE || "https://clarobr-jsw-tecnologia.atlassian.net";
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_TOKEN = process.env.JIRA_API_TOKEN;

if (!JIRA_EMAIL || !JIRA_TOKEN) {
  console.warn("[WARN] Defina JIRA_EMAIL e JIRA_API_TOKEN no .env");
}

function jiraHeaders(extra = {}) {
  const basic = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64");
  return {
    Authorization: `Basic ${basic}`,
    Accept: "application/json",
    ...extra,
  };
}

function sendUpstream(res, r, fallbackType = "application/json") {
  res.status(r.status);
  const ct = r.headers.get("content-type") || fallbackType;
  res.type(ct);
  return r.text().then((t) => res.send(t));
}

// GET issue (fields controláveis)
app.get("/api/jira/issue/:key", async (req, res) => {
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

// POST criar issue/subtarefa
app.post("/api/jira/issue", async (req, res) => {
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

// GET transitions (necessário para o front tentar descobrir a transição pelo nome)
app.get("/api/jira/issue/:key/transitions", async (req, res) => {
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
    return res
      .status(500)
      .json({ error: "Proxy error on GET transitions", details: String(err) });
  }
});

// POST transition
app.post("/api/jira/issue/:key/transitions", async (req, res) => {
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
    return res
      .status(500)
      .json({ error: "Proxy error on POST transitions", details: String(err) });
  }
});

// GET comentários
app.get("/api/jira/issue/:key/comments", async (req, res) => {
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

// POST criar comentário (ADF)
app.post("/api/jira/issue/:key/comment", async (req, res) => {
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

// PUT atualizar comentário (ADF)
app.put("/api/jira/issue/:key/comment/:id", async (req, res) => {
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

// Lista anexos (metadados + URLs do proxy)
app.get("/api/jira/issue/:key/attachments", async (req, res) => {
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
      }/download?inline=1&filename=${encodeURIComponent(a.filename || "file")}`,
      thumbnail: a.thumbnail || null,
    }));
    return res.json({ attachments });
  } catch (err) {
    console.error("GET issue attachments error:", err);
    return res.status(500).json({ error: "Proxy error on list attachments" });
  }
});

// Upload anexos (multipart)
app.post(
  "/api/jira/issue/:key/attachments",
  upload.array("files"),
  async (req, res) => {
    try {
      const { key } = req.params;
      if (!req.files?.length) {
        return res.status(400).json({ error: "Nenhum arquivo enviado" });
      }

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

// Download/inline com redirecionamento seguro
app.get("/api/jira/attachment/:id/download", async (req, res) => {
  const { id } = req.params;
  const { filename: fnQuery, inline } = req.query;

  try {
    // 1) Metadados
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

    // 2) Primeiro fetch com redirect manual
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
      // 3) Segue para S3 (sem Authorization)
      finalResp = await fetch(loc, { headers: { Accept: "*/*" } });
    }

    if (!finalResp.ok || !finalResp.body) {
      return sendUpstream(res, finalResp, "text/plain");
    }

    // 4) Cabeçalhos e stream
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

// =====================================================
// Produção: servir build do Vite
// =====================================================
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));

// catch-all para qualquer rota que NÃO comece com /api
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

// Start
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
});
