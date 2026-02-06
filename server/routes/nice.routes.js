// server/routes/nice.routes.js
import { Router } from "express";
import { Readable } from "node:stream";
import { sendUpstream } from "../utils/sendUpstream.js";

export default function niceRoutes({ env }) {
  const router = Router();

  const NICE_PUP_BASE = env.NICE_PUP_BASE || "http://127.0.0.1:8010";
  const NICE_PUP_TOKEN = env.NICE_PUP_TOKEN || "";

  function headersJson() {
    const h = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (NICE_PUP_TOKEN) h["x-internal-token"] = NICE_PUP_TOKEN;
    return h;
  }

  function headersAny(accept = "*/*") {
    const h = { Accept: accept };
    if (NICE_PUP_TOKEN) h["x-internal-token"] = NICE_PUP_TOKEN;
    return h;
  }

  // =========================
  // HELPERS (NOVO)
  // =========================
  function normalizeEnv(v) {
    const e = String(v || "")
      .trim()
      .toUpperCase();
    if (e !== "DEV" && e !== "PRD") return null;
    return e;
  }

  function sanitizePath(p) {
    // path opcional: "a/b/c"
    let s = String(p || "").trim();

    // normaliza e evita traversal
    s = s.replace(/^\/+/, "").replace(/\/+$/, ""); // remove "/" nas pontas
    if (!s) return "";

    // bloqueia ".." e caracteres de controle
    if (s.includes("..")) return null;
    if (/[\u0000-\u001F]/.test(s)) return null;

    return s;
  }

  // health do serviço puppeteer
  router.get("/health", async (_req, res) => {
    try {
      const r = await fetch(`${NICE_PUP_BASE}/health`, {
        method: "GET",
        headers: headersAny("application/json"),
      });
      return sendUpstream(res, r);
    } catch (err) {
      return res.status(503).json({
        ok: false,
        error: "NICE service unavailable",
        details: String(err?.message || err),
      });
    }
  });

  // start: front -> back -> puppeteer POST /sessions
  router.post("/session/start", async (req, res) => {
    try {
      const { cluster } = req.body || {};
      const c = Number(cluster);
      if (![1, 2].includes(c)) {
        return res
          .status(400)
          .json({ ok: false, error: "cluster deve ser 1 ou 2" });
      }

      const r = await fetch(`${NICE_PUP_BASE}/sessions`, {
        method: "POST",
        headers: headersJson(),
        body: JSON.stringify({ cluster: c }),
      });

      return sendUpstream(res, r);
    } catch (err) {
      console.error("NICE proxy /session/start error:", err);
      return res.status(500).json({
        ok: false,
        error: "Proxy error on NICE /sessions",
        details: String(err?.message || err),
      });
    }
  });

  // login (sem :id na URL do front). O sessionId vai no body.
  router.post("/session/login", async (req, res) => {
    try {
      const { sessionId, username, password } = req.body || {};

      if (!String(sessionId || "").trim()) {
        return res
          .status(400)
          .json({ ok: false, error: "sessionId é obrigatório" });
      }
      if (!String(username || "").trim() || !String(password || "").trim()) {
        return res.status(400).json({
          ok: false,
          error: "Campos 'username' e 'password' são obrigatórios",
        });
      }

      const r = await fetch(
        `${NICE_PUP_BASE}/sessions/${encodeURIComponent(sessionId)}/login`,
        {
          method: "POST",
          headers: headersJson(),
          body: JSON.stringify({ username, password }),
        },
      );

      return sendUpstream(res, r);
    } catch (err) {
      console.error("NICE proxy /session/login error:", err);
      return res.status(500).json({
        ok: false,
        error: "Proxy error on NICE /sessions/:id/login",
        details: String(err?.message || err),
      });
    }
  });

  // state (poll)
  router.get("/session/state", async (req, res) => {
    try {
      const sessionId = String(req.query.sessionId || "").trim();
      if (!sessionId) {
        return res
          .status(400)
          .json({ ok: false, error: "sessionId é obrigatório" });
      }

      const r = await fetch(
        `${NICE_PUP_BASE}/sessions/${encodeURIComponent(sessionId)}/state`,
        { method: "GET", headers: headersAny("application/json") },
      );

      return sendUpstream(res, r);
    } catch (err) {
      console.error("NICE proxy /session/state error:", err);
      return res.status(500).json({
        ok: false,
        error: "Proxy error on NICE /sessions/:id/state",
        details: String(err?.message || err),
      });
    }
  });

  // duo-code (opcional; state já traz)
  router.get("/session/duo-code", async (req, res) => {
    try {
      const sessionId = String(req.query.sessionId || "").trim();
      if (!sessionId) {
        return res
          .status(400)
          .json({ ok: false, error: "sessionId é obrigatório" });
      }

      const r = await fetch(
        `${NICE_PUP_BASE}/sessions/${encodeURIComponent(sessionId)}/duo-code`,
        { method: "GET", headers: headersAny("application/json") },
      );

      return sendUpstream(res, r);
    } catch (err) {
      console.error("NICE proxy /session/duo-code error:", err);
      return res.status(500).json({
        ok: false,
        error: "Proxy error on NICE /sessions/:id/duo-code",
        details: String(err?.message || err),
      });
    }
  });

  // screenshot (debug)
  router.get("/session/screenshot", async (req, res) => {
    try {
      const sessionId = String(req.query.sessionId || "").trim();
      if (!sessionId) {
        return res
          .status(400)
          .json({ ok: false, error: "sessionId é obrigatório" });
      }

      const r = await fetch(
        `${NICE_PUP_BASE}/sessions/${encodeURIComponent(sessionId)}/screenshot`,
        { method: "GET", headers: headersAny("image/png") },
      );

      if (!r.ok) return sendUpstream(res, r, "text/plain");

      res.status(r.status);
      res.setHeader(
        "Content-Type",
        r.headers.get("content-type") || "image/png",
      );

      if (r.body) return Readable.fromWeb(r.body).pipe(res);

      const buf = Buffer.from(await r.arrayBuffer());
      return res.send(buf);
    } catch (err) {
      console.error("NICE proxy /session/screenshot error:", err);
      return res.status(500).json({
        ok: false,
        error: "Proxy error on NICE /sessions/:id/screenshot",
        details: String(err?.message || err),
      });
    }
  });

  // GET /studio/tree  (front -> back -> puppeteer)
  // /api/nice/studio/tree?sessionId=<id>&env=DEV|PRD&path=a/b/c
  router.get("/studio/tree", async (req, res) => {
    try {
      const sessionId = String(req.query.sessionId || "").trim();
      const envName = String(req.query.env || "")
        .trim()
        .toUpperCase();
      const path = String(req.query.path || "").trim();

      if (!sessionId) {
        return res
          .status(400)
          .json({ ok: false, error: "sessionId é obrigatório" });
      }
      if (!["DEV", "PRD"].includes(envName)) {
        return res
          .status(400)
          .json({ ok: false, error: "env deve ser DEV ou PRD" });
      }

      const qs = new URLSearchParams({ env: envName });
      if (path) qs.set("path", path);

      const r = await fetch(
        `${NICE_PUP_BASE}/sessions/${encodeURIComponent(sessionId)}/studio/tree?${qs.toString()}`,
        { method: "GET", headers: headersAny("application/json") },
      );

      return sendUpstream(res, r);
    } catch (err) {
      console.error("NICE proxy /studio/tree error:", err);
      return res.status(500).json({
        ok: false,
        error: "Proxy error on NICE studio tree",
        details: String(err?.message || err),
      });
    }
  });

  // stop
  router.post("/session/stop", async (req, res) => {
    try {
      const { sessionId } = req.body || {};
      if (!String(sessionId || "").trim()) {
        return res
          .status(400)
          .json({ ok: false, error: "sessionId é obrigatório" });
      }

      const r = await fetch(
        `${NICE_PUP_BASE}/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "DELETE",
          headers: headersAny("application/json"),
        },
      );

      return sendUpstream(res, r);
    } catch (err) {
      console.error("NICE proxy /session/stop error:", err);
      return res.status(500).json({
        ok: false,
        error: "Proxy error on NICE /sessions/:id DELETE",
        details: String(err?.message || err),
      });
    }
  });

  return router;
}
