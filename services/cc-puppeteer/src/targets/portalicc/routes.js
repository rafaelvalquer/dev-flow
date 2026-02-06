import express from "express";

import { getBrowser, createIsolatedContext } from "../../puppeteer/browser.js";
import { waitForAnySelector } from "../../puppeteer/utils.js";
import {
  createSession,
  getSession,
  closeSession,
} from "../../sessions.js";

const TARGET_URL = process.env.PORTALICC_TARGET_URL ||
  "https://portalicc.claro.com.br/portalicc/login";

async function getPortalIccState(page) {
  const hasUser = await page.$("#username");
  const hasPass = await page.$("#password");
  const hasBtn = await page.$("button.login-form-btn");

  if (hasUser && hasPass && hasBtn) {
    return { stage: "login", url: page.url() };
  }

  // se saiu da rota /login e o formulário sumiu, consideramos autenticado
  const url = page.url();
  if (!url.includes("/login") && !(hasUser || hasPass || hasBtn)) {
    return { stage: "authenticated", url };
  }

  return { stage: "unknown", url };
}

export const portalIccRouter = express.Router();

// POST /portalicc/sessions
portalIccRouter.post("/sessions", async (_req, res) => {
  try {
    const browser = await getBrowser();
    const context = await createIsolatedContext(browser);
    const page = await context.newPage();

    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(45_000);

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

    await waitForAnySelector(
      page,
      ["#username", "#password", "button.login-form-btn"],
      { timeout: 60_000, visible: true }
    );

    const sessionId = createSession({
      target: "portalicc",
      context,
      page,
    });

    const state = await getPortalIccState(page);
    return res.json({ ok: true, sessionId, ...state });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: "Failed to start session", details: String(e?.message || e) });
  }
});

// POST /portalicc/sessions/:id/login  (body: { username, password })
portalIccRouter.post("/sessions/:id/login", async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: "Session not found" });

    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "username/password required" });
    }

    const { page } = session;

    await page.waitForSelector("#username", { visible: true, timeout: 60_000 });

    // limpa campos
    await page.evaluate(() => {
      const u = document.querySelector("#username");
      const p = document.querySelector("#password");
      if (u) u.value = "";
      if (p) p.value = "";
    });

    await page.type("#username", username, { delay: 10 });
    await page.type("#password", password, { delay: 10 });

    const beforeUrl = page.url();

    // Alguns logins navegam, outros fazem XHR. Aguardamos 1 de 3 sinais.
    await Promise.all([
      page.click("button.login-form-btn"),
      Promise.race([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60_000 }).catch(() => null),
        page.waitForFunction(
          (u) => window.location.href !== u,
          { timeout: 60_000 },
          beforeUrl
        ).catch(() => null),
        page.waitForSelector("#username", { hidden: true, timeout: 60_000 }).catch(() => null),
      ]),
    ]);

    const state = await getPortalIccState(page);
    return res.json({ ok: true, ...state });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: "Failed to login", details: String(e?.message || e) });
  }
});

// GET /portalicc/sessions/:id/state
portalIccRouter.get("/sessions/:id/state", async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: "Session not found" });

    const state = await getPortalIccState(session.page);
    return res.json({ ok: true, ...state });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: "Failed to read state", details: String(e?.message || e) });
  }
});

// GET /portalicc/sessions/:id/screenshot
portalIccRouter.get("/sessions/:id/screenshot", async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: "Session not found" });

    const pngBase64 = await session.page.screenshot({
      type: "png",
      fullPage: true,
      encoding: "base64",
    });

    return res.json({ ok: true, pngBase64 });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: "Failed to screenshot", details: String(e?.message || e) });
  }
});

// DELETE /portalicc/sessions/:id
portalIccRouter.delete("/sessions/:id", async (req, res) => {
  try {
    const ok = await closeSession(req.params.id);
    if (!ok) return res.status(404).json({ ok: false, error: "Session not found" });
    return res.json({ ok: true });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: "Failed to close session", details: String(e?.message || e) });
  }
});
