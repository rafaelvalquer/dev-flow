import express from "express";

import { getBrowser, createIsolatedContext } from "../../puppeteer/browser.js";
import { createSession, getSession, closeSession } from "../../sessions.js";

const TARGET_URL = process.env.NICE_TARGET_URL || "https://cc.claro.com.br/";

const NICE_TIMEOUT_MS = Number(process.env.NICE_TIMEOUT_MS || 60_000);
const NICE_NAV_TIMEOUT_MS = Number(process.env.NICE_NAV_TIMEOUT_MS || 60_000);
const NICE_DEBUG_ON_ERROR = process.env.NICE_DEBUG_ON_ERROR === "1";

function normalizeDigits(text) {
  return String(text || "")
    .replace(/\D+/g, "")
    .trim();
}

function idSelectorSafe(id) {
  // evita '#1' inválido e qualquer problema com css escaping
  return `[id="${String(id).replace(/"/g, '\\"')}"]`;
}

const SELECTORS = {
  // cluster (tente o que você já usou e alguns padrões)
  cluster1: [
    "#contact01 button",
    "#contact01",
    `${idSelectorSafe("contact01")} button`,
    `${idSelectorSafe("contact01")}`,
    `${idSelectorSafe(1)} button`,
    `${idSelectorSafe(1)}`,
  ],
  cluster2: [
    "#contact02 button",
    "#contact02",
    `${idSelectorSafe("contact02")} button`,
    `${idSelectorSafe("contact02")}`,
    `${idSelectorSafe(2)} button`,
    `${idSelectorSafe(2)}`,
  ],

  // login
  user: [
    ".login-username",
    "#username",
    'input[name="username"]',
    idSelectorSafe("username"),
  ],
  pass: [
    ".login-password",
    "#password",
    'input[name="password"]',
    idSelectorSafe("password"),
  ],
  submit: [".login-button", "#signOnButton", 'button[type="submit"]'],

  // duo
  duoTrust: ["#trust-browser-button", "button#trust-browser-button"],
  duoCode: [".verification-code", "[data-testid='verification-code']"],
};

async function sleep(page, ms) {
  // compatível com versões diferentes
  if (page?.waitForTimeout) return page.waitForTimeout(ms);
  return new Promise((r) => setTimeout(r, ms));
}

async function findFirstInPageOrFrames(page, selectors) {
  // procura no documento principal e em iframes
  for (const sel of selectors) {
    const h = await page.$(sel).catch(() => null);
    if (h) return { scope: page, selector: sel, handle: h };
  }

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    for (const sel of selectors) {
      const h = await frame.$(sel).catch(() => null);
      if (h) return { scope: frame, selector: sel, handle: h };
    }
  }

  return null;
}

async function waitForAnySelectorDeep(page, selectors, opts = {}) {
  const timeout = Number(opts.timeout ?? NICE_TIMEOUT_MS);
  const visible = Boolean(opts.visible ?? false);

  const deadline = Date.now() + timeout;
  let lastSeen = null;

  while (Date.now() < deadline) {
    const found = await findFirstInPageOrFrames(page, selectors);
    if (found?.handle) {
      lastSeen = found;

      if (!visible) return found;

      // "visible": boundingBox != null (melhor esforço)
      const box = await found.handle.boundingBox?.().catch(() => null);
      if (box) return found;
    }

    await sleep(page, 300);
  }

  throw new Error(`Timeout waiting for any selector: ${selectors.join(", ")}`);
}

async function setValue(handle, value) {
  await handle.evaluate(
    (el, val) => {
      el.focus?.();
      // limpa
      if ("value" in el) el.value = "";
      // seta
      if ("value" in el) el.value = val;

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    String(value ?? ""),
  );
}

async function clickBestEffort(page, selectors) {
  const found = await findFirstInPageOrFrames(page, selectors);
  if (!found) return false;

  try {
    await found.handle.click({ delay: 10 });
  } catch {
    // fallback: click via evaluate
    await found.handle.evaluate((el) => el.click?.());
  }
  return true;
}

async function getPageState(page) {
  const url = page.url();

  const hasLoginUser = await findFirstInPageOrFrames(page, SELECTORS.user);
  const hasLoginPass = await findFirstInPageOrFrames(page, SELECTORS.pass);

  if (hasLoginUser && hasLoginPass) {
    return { stage: "login", url };
  }

  const hasTrust = await findFirstInPageOrFrames(page, SELECTORS.duoTrust);
  if (hasTrust) {
    return { stage: "duo_trust", url };
  }

  const code = await findFirstInPageOrFrames(page, SELECTORS.duoCode);
  if (code) {
    const raw = await code.handle
      .evaluate((el) => el.textContent || "")
      .catch(() => "");
    return { stage: "duo_code", url, duoCode: normalizeDigits(raw) };
  }

  return { stage: "unknown", url };
}

export const niceRouter = express.Router();

// POST /nice/sessions  (body: { cluster?: 1|2|string })
niceRouter.post("/sessions", async (req, res) => {
  let context = null;
  let page = null;

  try {
    const { cluster } = req.body || {};
    const c = String(cluster || "").trim(); // aceita 1/2 ou string

    const browser = await getBrowser();
    context = await createIsolatedContext(browser);
    page = await context.newPage();

    page.setDefaultTimeout(NICE_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NICE_NAV_TIMEOUT_MS);

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
    await sleep(page, 300);

    // tenta selecionar cluster (se informado)
    if (c) {
      const selList =
        c === "1" || c === "01" || c === "contact01"
          ? SELECTORS.cluster1
          : c === "2" || c === "02" || c === "contact02"
            ? SELECTORS.cluster2
            : [idSelectorSafe(c), `#${c}`]; // fallback (id direto), mas evitando quebra

      // tenta clicar em algo que exista
      await clickBestEffort(page, selList);

      // aguarda navegação ou mudança de DOM (best-effort)
      await Promise.race([
        page
          .waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: NICE_NAV_TIMEOUT_MS,
          })
          .catch(() => null),
        sleep(page, 800),
      ]);
    }

    // aguarda aparecer qualquer etapa (login/duo)
    await waitForAnySelectorDeep(
      page,
      [
        ...SELECTORS.user,
        ...SELECTORS.pass,
        ...SELECTORS.duoTrust,
        ...SELECTORS.duoCode,
      ],
      { timeout: NICE_TIMEOUT_MS, visible: false },
    );

    const sessionId = createSession({
      target: "nice",
      context,
      page,
      meta: { cluster: c || null },
    });

    const state = await getPageState(page);
    return res.json({ ok: true, sessionId, ...state });
  } catch (e) {
    // tenta devolver debug útil
    let debug = null;

    if (NICE_DEBUG_ON_ERROR && page) {
      try {
        const [title, url, pngBase64] = await Promise.all([
          page.title().catch(() => null),
          Promise.resolve(page.url()).catch(() => null),
          page
            .screenshot({ type: "png", fullPage: true, encoding: "base64" })
            .catch(() => null),
        ]);
        debug = { title, url, pngBase64 };
      } catch {
        // ignore
      }
    }

    try {
      await context?.close?.().catch(() => {});
    } catch {}

    return res.status(500).json({
      ok: false,
      error: "Failed to start session",
      details: String(e?.message || e),
      ...(debug ? { debug } : {}),
    });
  }
});

// POST /nice/sessions/:id/login  (body: { username, password })
niceRouter.post("/sessions/:id/login", async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    const { username, password } = req.body || {};
    if (!String(username || "").trim() || !String(password || "").trim()) {
      return res
        .status(400)
        .json({ ok: false, error: "username/password required" });
    }

    const { page } = session;

    // garante tela de login (em page ou iframe)
    const u = await waitForAnySelectorDeep(page, SELECTORS.user, {
      timeout: NICE_TIMEOUT_MS,
      visible: false,
    });
    const p = await waitForAnySelectorDeep(page, SELECTORS.pass, {
      timeout: NICE_TIMEOUT_MS,
      visible: false,
    });

    // limpa e preenche (disparando eventos)
    await setValue(u.handle, username);
    await setValue(p.handle, password);

    // clica no botão de login (best-effort)
    const clicked = await clickBestEffort(page, SELECTORS.submit);
    if (!clicked) {
      return res
        .status(500)
        .json({ ok: false, error: "Login button not found" });
    }

    // aguarda navegação ou mudança para duo/login novamente
    await Promise.race([
      page
        .waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: NICE_NAV_TIMEOUT_MS,
        })
        .catch(() => null),
      sleep(page, 800),
    ]);

    await waitForAnySelectorDeep(
      page,
      [
        ...SELECTORS.duoTrust,
        ...SELECTORS.duoCode,
        ...SELECTORS.user, // se voltar ao login (credencial inválida)
      ],
      { timeout: NICE_TIMEOUT_MS, visible: false },
    );

    const state = await getPageState(page);
    return res.json({ ok: true, ...state });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Failed to login",
      details: String(e?.message || e),
    });
  }
});

// GET /nice/sessions/:id/state
niceRouter.get("/sessions/:id/state", async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    const state = await getPageState(session.page);
    return res.json({ ok: true, ...state });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Failed to read state",
      details: String(e?.message || e),
    });
  }
});

// GET /nice/sessions/:id/duo-code
niceRouter.get("/sessions/:id/duo-code", async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    const found = await findFirstInPageOrFrames(
      session.page,
      SELECTORS.duoCode,
    );
    if (!found) {
      return res
        .status(409)
        .json({ ok: false, error: "Duo code not available" });
    }

    const raw = await found.handle
      .evaluate((el) => el.textContent || "")
      .catch(() => "");
    return res.json({ ok: true, duoCode: normalizeDigits(raw) });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Failed to get duo code",
      details: String(e?.message || e),
    });
  }
});

// GET /nice/sessions/:id/screenshot
niceRouter.get("/sessions/:id/screenshot", async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    const pngBase64 = await session.page.screenshot({
      type: "png",
      fullPage: true,
      encoding: "base64",
    });

    return res.json({ ok: true, pngBase64 });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Failed to screenshot",
      details: String(e?.message || e),
    });
  }
});

// DELETE /nice/sessions/:id
niceRouter.delete("/sessions/:id", async (req, res) => {
  try {
    const ok = await closeSession(req.params.id);
    if (!ok) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Failed to close session",
      details: String(e?.message || e),
    });
  }
});
