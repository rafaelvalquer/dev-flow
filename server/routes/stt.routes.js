// server/routes/stt.routes.js
import { Router } from "express";
import { Readable } from "node:stream";
import { sendUpstream } from "../utils/sendUpstream.js";

export default function sttRoutes({ upload, env }) {
  const router = Router();
  const STT_PY_BASE = env.STT_PY_BASE || "http://127.0.0.1:8000";

  router.post("/transcribe", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ error: "Nenhum arquivo enviado (campo 'file')" });
      }

      const form = new FormData();
      const blob = new Blob([req.file.buffer], {
        type: req.file.mimetype || "application/octet-stream",
      });
      form.append("file", blob, req.file.originalname);

      const r = await fetch(`${STT_PY_BASE}/transcribe`, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      });

      return sendUpstream(res, r);
    } catch (err) {
      console.error("STT proxy error:", err);
      return res
        .status(500)
        .json({ error: "Proxy error on STT transcribe", details: String(err) });
    }
  });

  router.post("/convert", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ error: "Nenhum arquivo enviado (campo 'file')" });
      }

      const form = new FormData();
      const blob = new Blob([req.file.buffer], {
        type: req.file.mimetype || "application/octet-stream",
      });
      form.append("file", blob, req.file.originalname);

      const r = await fetch(`${STT_PY_BASE}/convert`, {
        method: "POST",
        headers: { Accept: "*/*" },
        body: form,
      });

      if (!r.ok) return sendUpstream(res, r, "text/plain");

      res.status(r.status);
      res.setHeader(
        "Content-Type",
        r.headers.get("content-type") || "audio/wav"
      );

      const cd = r.headers.get("content-disposition");
      if (cd) res.setHeader("Content-Disposition", cd);

      const xSummary = r.headers.get("x-audio-summary");
      if (xSummary) res.setHeader("X-Audio-Summary", xSummary);

      const xMatch = r.headers.get("x-audio-matches-target");
      if (xMatch) res.setHeader("X-Audio-Matches-Target", xMatch);

      if (r.body) return Readable.fromWeb(r.body).pipe(res);

      const buf = Buffer.from(await r.arrayBuffer());
      return res.send(buf);
    } catch (err) {
      console.error("STT convert proxy error:", err);
      return res
        .status(500)
        .json({ error: "Proxy error on STT convert", details: String(err) });
    }
  });

  router.post("/tts", async (req, res) => {
    try {
      const { text, voice, rate, volume } = req.body || {};
      if (!String(text || "").trim()) {
        return res.status(400).json({ error: "Campo 'text' é obrigatório" });
      }

      const r = await fetch(`${STT_PY_BASE}/tts`, {
        method: "POST",
        headers: { Accept: "*/*", "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, rate, volume }),
      });

      if (!r.ok) return sendUpstream(res, r, "text/plain");

      res.status(r.status);
      res.setHeader(
        "Content-Type",
        r.headers.get("content-type") || "audio/mpeg"
      );

      const cd = r.headers.get("content-disposition");
      if (cd) res.setHeader("Content-Disposition", cd);

      return Readable.fromWeb(r.body).pipe(res);
    } catch (err) {
      console.error("TTS proxy error:", err);
      return res
        .status(500)
        .json({ error: "Proxy error on TTS", details: String(err) });
    }
  });

  router.post("/tts_ulaw", async (req, res) => {
    try {
      const { text, voice, rate, volume } = req.body || {};
      if (!String(text || "").trim()) {
        return res.status(400).json({ error: "Campo 'text' é obrigatório" });
      }

      const r = await fetch(`${STT_PY_BASE}/tts_ulaw`, {
        method: "POST",
        headers: { Accept: "*/*", "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, rate, volume }),
      });

      if (!r.ok) return sendUpstream(res, r, "text/plain");

      res.status(r.status);
      res.setHeader(
        "Content-Type",
        r.headers.get("content-type") || "audio/wav"
      );

      const cd = r.headers.get("content-disposition");
      if (cd) res.setHeader("Content-Disposition", cd);

      return Readable.fromWeb(r.body).pipe(res);
    } catch (err) {
      console.error("TTS_ULAW proxy error:", err);
      return res
        .status(500)
        .json({ error: "Proxy error on TTS ULAW", details: String(err) });
    }
  });

  router.get("/health", async (req, res) => {
    const timeoutMs = Number(req.query.timeoutMs || 3000);
    const startedAt = Date.now();

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let url = `${STT_PY_BASE}/health`;
      let r = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json, text/plain, */*" },
        signal: controller.signal,
      });

      if (!r.ok && r.status === 404) {
        url = `${STT_PY_BASE}/`;
        r = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json, text/plain, */*" },
          signal: controller.signal,
        });
      }

      const latencyMs = Date.now() - startedAt;

      const ct = (r.headers.get("content-type") || "").toLowerCase();
      let upstreamBody = null;

      if (ct.includes("application/json")) {
        upstreamBody = await r.json().catch(() => null);
      } else {
        upstreamBody = await r
          .text()
          .then((t) => (t ? t.slice(0, 500) : null))
          .catch(() => null);
      }

      return res.status(r.ok ? 200 : 503).json({
        ok: !!r.ok,
        base: STT_PY_BASE,
        urlChecked: url,
        upstreamStatus: r.status,
        latencyMs,
        checkedAt: new Date().toISOString(),
        upstreamBody,
      });
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const isTimeout = err?.name === "AbortError";

      return res.status(503).json({
        ok: false,
        base: STT_PY_BASE,
        urlChecked: `${STT_PY_BASE}/health`,
        upstreamStatus: null,
        latencyMs,
        checkedAt: new Date().toISOString(),
        error: isTimeout
          ? `Timeout after ${timeoutMs}ms`
          : String(err?.message || err),
      });
    } finally {
      clearTimeout(t);
    }
  });

  return router;
}
