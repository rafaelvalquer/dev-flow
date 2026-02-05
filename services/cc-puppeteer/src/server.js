// services/nice-puppeteer/src/server.js
import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";
import {
  createSession,
  getSession,
  closeSession,
  countSessions,
  cleanupExpiredSessions,
} from "./sessions.js";

const PORT = Number(process.env.PORT || 8010);
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "";
const TARGET_URL = "https://cc.claro.com.br/";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

function auth(req, res, next) {
  if (!INTERNAL_TOKEN) return next();
  const t = req.headers["x-internal-token"];
  if (t !== INTERNAL_TOKEN)
    return res.status(401).json({ error: "Unauthorized" });
  return next();
}
app.use(auth);

// Browser único (melhor p/ multiusuário) + context por sessão
let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true, // mais compatível entre versões
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserPromise;
}

function normalizeDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findInAnyFrame(page, selector, { visible = false } = {}) {
  for (const frame of page.frames()) {
    const el = await frame.$(selector).catch(() => null);
    if (!el) continue;

    if (!visible) return { frame, el, selector };

    const box = await el.boundingBox().catch(() => null);
    if (box) return { frame, el, selector };
  }
  return null;
}

async function waitForAnySelector(
  page,
  selectors,
  { timeout = 60_000, visible = false, pollMs = 250 } = {},
) {
  const end = Date.now() + timeout;

  while (Date.now() < end) {
    for (const sel of selectors) {
      const found = await findInAnyFrame(page, sel, { visible });
      if (found) return found;
    }
    await sleep(pollMs);
  }

  throw new Error(`Waiting for selectors failed: ${selectors.join(", ")}`);
}

async function getPageState(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");

  // IMPORTANTE: variáveis locais (evita "sujeira" entre chamadas)
  let duoCodeRaw = null;
  let duoCode = null;

  const u = await findInAnyFrame(page, "#username").catch(() => null);
  const p = await findInAnyFrame(page, "#password").catch(() => null);
  const hasLogin = !!(u && p);

  const codeElFound = await findInAnyFrame(page, ".verification-code").catch(
    () => null,
  );

  if (codeElFound?.el) {
    duoCodeRaw = await codeElFound.frame
      .evaluate((el) => el.textContent || "", codeElFound.el)
      .catch(() => null);
    duoCode = normalizeDigits(duoCodeRaw);
  }

  // ✅ Se já está na URL do Duo, o stage deve ser "duo" mesmo que o código ainda não apareceu
  const isDuoUrl = /duosecurity\.com\/frame\//i.test(url);

  const stage = duoCode || isDuoUrl ? "duo" : hasLogin ? "login" : "unknown";

  return {
    ok: true,
    stage,
    url,
    title,
    duoCode: duoCode || null,
    duoCodeRaw: duoCodeRaw ? String(duoCodeRaw).trim() : null,
  };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "nice-puppeteer",
    sessions: countSessions(),
    now: new Date().toISOString(),
  });
});

// cleanup TTL
setInterval(
  () => {
    cleanupExpiredSessions().catch(() => {});
  },
  Number(process.env.SESSION_CLEANUP_INTERVAL_MS || 30_000),
);

app.post("/sessions", async (req, res) => {
  const { cluster } = req.body || {};
  const c = Number(cluster);

  if (![1, 2].includes(c)) {
    return res
      .status(400)
      .json({ ok: false, error: "cluster deve ser 1 ou 2" });
  }

  let context = null;

  try {
    const browser = await getBrowser();

    // Compat: versões novas usam createBrowserContext; antigas usam createIncognitoBrowserContext
    if (typeof browser.createBrowserContext === "function") {
      context = await browser.createBrowserContext();
    } else if (typeof browser.createIncognitoBrowserContext === "function") {
      context = await browser.createIncognitoBrowserContext();
    } else {
      throw new Error(
        "BrowserContext API not available in this Puppeteer version",
      );
    }

    const page = await context.newPage();
    page.setDefaultTimeout(25_000);
    page.setDefaultNavigationTimeout(25_000);

    await page.goto(TARGET_URL, { waitUntil: "networkidle2" });

    const selector = c === 1 ? "#contact01 button" : "#contact02 button";
    await page.waitForSelector(selector, { visible: true });

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null),
      page.click(selector),
    ]);

    await waitForAnySelector(
      page,
      [
        "#username",
        "#password",
        ".verification-code",
        "input[type='password']",
      ],
      { timeout: 60_000, visible: true },
    ).catch(() => null);

    const sessionId = createSession({ context, page });
    const st = await getPageState(page);

    return res.status(201).json({
      ok: true,
      sessionId,
      cluster: c,
      url: st.url,
      title: st.title,
      stage: st.stage,
      duoCode: st.duoCode,
      duoCodeRaw: st.duoCodeRaw,
    });
  } catch (err) {
    try {
      await context?.close().catch(() => {});
    } catch {}

    return res.status(500).json({
      ok: false,
      error: "Failed to start session",
      details: String(err?.message || err),
    });
  }
});

app.post("/sessions/:id/login", async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body || {};

  const s = getSession(id);
  if (!s)
    return res.status(404).json({ ok: false, error: "Session not found" });

  if (!String(username || "").trim() || !String(password || "").trim()) {
    return res
      .status(400)
      .json({ ok: false, error: "username/password required" });
  }

  try {
    const page = s.page;

    // Seletores com fallback (SSO varia bastante)
    const USERNAME = [
      "#username",
      "input[name='username']",
      "input[type='email']",
    ];
    const PASSWORD = [
      "#password",
      "input[name='password']",
      "input[type='password']",
    ];
    const SUBMIT = [
      "#signOnButton",
      "button[type='submit']",
      "input[type='submit']",
    ];

    const u = await waitForAnySelector(page, USERNAME, {
      timeout: 60_000,
      visible: true,
    });
    const p = await waitForAnySelector(page, PASSWORD, {
      timeout: 60_000,
      visible: true,
    });

    await u.frame.click(u.selector, { clickCount: 3 }).catch(() => {});
    await u.frame
      .evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.value = "";
      }, u.selector)
      .catch(() => {});
    await u.frame.type(u.selector, username, { delay: 15 });

    await p.frame.click(p.selector, { clickCount: 3 }).catch(() => {});
    await p.frame
      .evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.value = "";
      }, p.selector)
      .catch(() => {});
    await p.frame.type(p.selector, password, { delay: 15 });
    const btn = await waitForAnySelector(page, SUBMIT, {
      timeout: 20_000,
      visible: true,
    });

    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 60_000 })
        .catch(() => null),
      btn.frame.click(btn.selector),
    ]);

    // ✅ espera a tela do Duo aparecer (mesmo que sem o código ainda)
    await waitForAnySelector(
      page,
      [".verification-code", "#header-text", "#auth-view-wrapper"],
      { timeout: 60_000, visible: false },
    ).catch(() => null);

    const st = await getPageState(page);

    return res.json({
      ok: true,
      ...st,
      message:
        st.stage === "duo"
          ? st.duoCode
            ? "Duo code disponível."
            : "Duo carregado. Aguardando gerar o código…"
          : "Login enviado.",
    });
  } catch (err) {
    const st = await getPageState(s.page).catch(() => null);
    return res.status(500).json({
      ok: false,
      error: "Login failed",
      details: String(err?.message || err),
      ...(st ? { url: st.url, title: st.title, stage: st.stage } : {}),
    });
  }
});

app.get("/sessions/:id/state", async (req, res) => {
  const { id } = req.params;
  const s = getSession(id);
  if (!s)
    return res.status(404).json({ ok: false, error: "Session not found" });

  try {
    const st = await getPageState(s.page);
    return res.json(st);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "State failed",
      details: String(err?.message || err),
    });
  }
});

app.get("/sessions/:id/duo-code", async (req, res) => {
  const { id } = req.params;
  const s = getSession(id);
  if (!s)
    return res.status(404).json({ ok: false, error: "Session not found" });

  try {
    const st = await getPageState(s.page);
    return res.json({
      ok: true,
      stage: st.stage,
      url: st.url,
      duoCode: st.duoCode,
      duoCodeRaw: st.duoCodeRaw,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Duo-code failed",
      details: String(err?.message || err),
    });
  }
});

app.get("/sessions/:id/screenshot", async (req, res) => {
  const { id } = req.params;
  const s = getSession(id);
  if (!s)
    return res.status(404).json({ ok: false, error: "Session not found" });

  try {
    const buf = await s.page.screenshot({ type: "png", fullPage: true });
    res.setHeader("Content-Type", "image/png");
    return res.send(buf);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Screenshot failed",
      details: String(err?.message || err),
    });
  }
});

app.delete("/sessions/:id", async (req, res) => {
  const { id } = req.params;
  const ok = await closeSession(id);
  return res.json({ ok });
});

app.listen(PORT, () => {
  console.log(`[nice-puppeteer] listening on http://127.0.0.1:${PORT}`);
});
