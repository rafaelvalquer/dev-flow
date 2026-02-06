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

// Browser único (mais leve para multiusuário)
let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserPromise;
}

function normalizeDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

async function getPageState(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");

  const hasLogin =
    (await page.$("#username").catch(() => null)) &&
    (await page.$("#password").catch(() => null));

  const codeEl = await page.$(".verification-code").catch(() => null);
  let duoCodeRaw = null;
  let duoCode = null;

  if (codeEl) {
    duoCodeRaw = await page
      .$eval(".verification-code", (el) => el.textContent || "")
      .catch(() => null);
    duoCode = normalizeDigits(duoCodeRaw);
  }

  const stage = duoCode ? "duo" : hasLogin ? "login" : "unknown"; // aqui você pode refinar depois (dashboard etc)

  return {
    ok: true,
    stage,
    url,
    title,
    duoCode: duoCode || null,
    duoCodeRaw: duoCodeRaw ? String(duoCodeRaw).trim() : null,
  };
}

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "nice-puppeteer",
    sessions: countSessions(),
    now: new Date().toISOString(),
  });
});

// cleanup de sessões antigas (TTL)
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
    context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();

    page.setDefaultTimeout(25_000);
    page.setDefaultNavigationTimeout(25_000);

    await page.goto(TARGET_URL, { waitUntil: "networkidle2" });

    // Seletores do HTML inicial
    const selector = c === 1 ? "#contact01 button" : "#contact02 button";

    await page.waitForSelector(selector, { visible: true });

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null),
      page.click(selector),
    ]);

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

    // Aguarda inputs do Ping
    await page.waitForSelector("#username", { visible: true });
    await page.waitForSelector("#password", { visible: true });

    // Preenche
    await page.click("#username", { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type("#username", username, { delay: 15 });

    await page.click("#password", { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type("#password", password, { delay: 15 });

    // Clica no botão de login
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null),
      page.click("#signOnButton"),
    ]);

    // Depois do login, pode aparecer o código do Duo
    const st = await getPageState(page);

    return res.json({
      ok: true,
      ...st,
      message: st.stage === "duo" ? "Duo code disponível." : "Login enviado.",
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Login failed",
      details: String(err?.message || err),
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
