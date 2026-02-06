import express from "express";

import { getBrowser, createIsolatedContext } from "../../puppeteer/browser.js";
import { createSession, getSession, closeSession } from "../../sessions.js";

const TARGET_URL = process.env.NICE_TARGET_URL || "https://cc.claro.com.br/";

const NICE_TIMEOUT_MS = Number(process.env.NICE_TIMEOUT_MS || 90_000);
const NICE_NAV_TIMEOUT_MS = Number(process.env.NICE_NAV_TIMEOUT_MS || 90_000);
const NICE_STUDIO_TIMEOUT_MS = Number(
  process.env.NICE_STUDIO_TIMEOUT_MS || 150_000,
);
const NICE_DEBUG_ON_ERROR = process.env.NICE_DEBUG_ON_ERROR === "1";

function normalizeDigits(text) {
  return String(text || "")
    .replace(/\D+/g, "")
    .trim();
}

function idSelectorSafe(id) {
  return `[id="${String(id).replace(/"/g, '\\"')}"]`;
}

function normalizeText(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

const SELECTORS = {
  // ===== CLUSTER (voltou) =====
  cluster1: [
    "#contact01 button",
    "#contact01",
    `${idSelectorSafe("contact01")} button`,
    `${idSelectorSafe("contact01")}`,
    `${idSelectorSafe(1)} button`,
    `${idSelectorSafe(1)}`,
    "button[data-testid='contact01']",
  ],
  cluster2: [
    "#contact02 button",
    "#contact02",
    `${idSelectorSafe("contact02")} button`,
    `${idSelectorSafe("contact02")}`,
    `${idSelectorSafe(2)} button`,
    `${idSelectorSafe(2)}`,
    "button[data-testid='contact02']",
  ],

  // ===== LOGIN =====
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

  // ===== DUO =====
  duoTrust: ["#trust-browser-button", "button#trust-browser-button"],
  duoCode: [".verification-code", "[data-testid='verification-code']"],

  // ===== STUDIO (mantém os seus) =====
  appPicker: [
    "div.app-picker-panel[role='button']",
    "div.app-picker-panel",
    "svg.header-option-icon use[href*='#icon-app_picker']",
    "svg.header-option-icon",
  ],
  studioMenuItem: [
    "a#select-cxStudio",
    "a[aria-label='Studio']",
    "a[href*='/studio/#/home/scripts']",
    "a[href*='nice-incontact.com/studio/#/home/scripts']",
  ],
  envSpan: ["span.ng-star-inserted"],
  treeItems: ["[role='treeitem']", "a[role='treeitem']", "li[role='treeitem']"],
};

async function sleep(page, ms) {
  if (page?.waitForTimeout) return page.waitForTimeout(ms);
  return new Promise((r) => setTimeout(r, ms));
}

// ====== DEEP (page + iframes) ======
async function findFirstInPageOrFrames(page, selectors) {
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

      const box = await found.handle.boundingBox?.().catch(() => null);
      if (box) return found;
    }
    await sleep(page, 300);
  }

  throw new Error(
    `Timeout waiting for any selector: ${selectors.join(", ")}${
      lastSeen ? ` (lastSeen=${lastSeen.selector})` : ""
    }`,
  );
}

async function clickFound(found) {
  if (!found?.handle) return false;
  try {
    await found.handle.click({ delay: 10 });
  } catch {
    await found.handle.evaluate((el) => el.click?.());
  }
  return true;
}

async function clickBestEffortDeep(page, selectors, opts = {}) {
  const timeout = Number(opts.timeout ?? NICE_TIMEOUT_MS);
  const found = await waitForAnySelectorDeep(page, selectors, {
    timeout,
  }).catch(() => null);
  if (!found) return false;
  return clickFound(found);
}

async function setValue(handle, value) {
  await handle.evaluate(
    (el, val) => {
      el.focus?.();
      if ("value" in el) el.value = "";
      if ("value" in el) el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    String(value ?? ""),
  );
}

async function getPageState(page) {
  const url = page.url();

  const hasCluster1 = await findFirstInPageOrFrames(page, SELECTORS.cluster1);
  const hasCluster2 = await findFirstInPageOrFrames(page, SELECTORS.cluster2);
  if (hasCluster1 || hasCluster2) return { stage: "cluster", url };

  const hasLoginUser = await findFirstInPageOrFrames(page, SELECTORS.user);
  const hasLoginPass = await findFirstInPageOrFrames(page, SELECTORS.pass);
  if (hasLoginUser && hasLoginPass) return { stage: "login", url };

  const hasTrust = await findFirstInPageOrFrames(page, SELECTORS.duoTrust);
  if (hasTrust) return { stage: "duo_trust", url };

  const code = await findFirstInPageOrFrames(page, SELECTORS.duoCode);
  if (code) {
    const raw = await code.handle
      .evaluate((el) => el.textContent || "")
      .catch(() => "");
    return { stage: "duo_code", url, duoCode: normalizeDigits(raw) };
  }

  return { stage: "unknown", url };
}

// ===== STUDIO HELPERS (mantém; só troca clicks p/ deep) =====
async function clickSpanByExactText(page, text, timeoutMs) {
  const target = normalizeText(text);
  const deadline = Date.now() + Number(timeoutMs || NICE_STUDIO_TIMEOUT_MS);

  while (Date.now() < deadline) {
    const ok = await page
      .evaluate((t) => {
        const spans = Array.from(
          document.querySelectorAll("span.ng-star-inserted"),
        );
        const hit = spans.find(
          (s) => (s.textContent || "").replace(/\s+/g, " ").trim() === t,
        );
        if (!hit) return false;
        const clickable =
          hit.closest("button,[role='button'],a,[role='tab'],li,div") || hit;
        clickable.click?.();
        return true;
      }, target)
      .catch(() => false);

    if (ok) return true;
    await sleep(page, 300);
  }
  return false;
}

/**
 * ✅ NOVO (Opção A): double-click "real" via mouse.click(clickCount: 2)
 * Mantém todas as funções existentes; apenas adiciona esta helper.
 * Observação: este helper está focado no caso DEV/PRD (span.ng-star-inserted).
 */
async function doubleClickSpanByExactText(page, text, timeoutMs) {
  const target = normalizeText(text);
  const deadline = Date.now() + Number(timeoutMs || NICE_STUDIO_TIMEOUT_MS);

  while (Date.now() < deadline) {
    const clicked = await page
      .evaluate((t) => {
        const spans = Array.from(
          document.querySelectorAll("span.ng-star-inserted"),
        );

        const hit = spans.find(
          (s) => (s.textContent || "").replace(/\s+/g, " ").trim() === t,
        );
        if (!hit) return null;

        const clickable =
          hit.closest("button,[role='button'],a,[role='tab'],li,div") || hit;

        clickable.scrollIntoView?.({ block: "center" });
        const r = clickable.getBoundingClientRect?.();
        if (!r) return null;

        // Retorna o centro do elemento para o Node fazer mouse.click(...)
        return {
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          w: r.width,
          h: r.height,
        };
      }, target)
      .catch(() => null);

    if (
      clicked &&
      typeof clicked.x === "number" &&
      typeof clicked.y === "number"
    ) {
      // Como coordenadas são relativas ao viewport, o mouse.click funciona direto.
      await page.mouse.click(clicked.x, clicked.y, {
        clickCount: 2,
        delay: 50,
      });
      return true;
    }

    await sleep(page, 250);
  }
  return false;
}

async function ensureStudioAndEnv(session, envName) {
  const page = session.page;
  const env = String(envName || "")
    .trim()
    .toUpperCase();

  const st = await getPageState(page);
  if (["cluster", "login", "duo_trust", "duo_code"].includes(st.stage)) {
    return { ok: false, reason: "auth", state: st };
  }

  // abre app picker
  await clickBestEffortDeep(page, SELECTORS.appPicker, {
    timeout: NICE_STUDIO_TIMEOUT_MS,
  });

  // clica Studio (a#select-cxStudio)
  const studioClicked = await clickBestEffortDeep(
    page,
    SELECTORS.studioMenuItem,
    {
      timeout: NICE_STUDIO_TIMEOUT_MS,
    },
  );
  if (!studioClicked) return { ok: false, reason: "studio_menu_not_found" };

  // aguarda URL do studio
  await Promise.race([
    page
      .waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: NICE_STUDIO_TIMEOUT_MS,
      })
      .catch(() => null),
    page
      .waitForFunction(
        () => /\/studio\/#\/home\/scripts/i.test(location.href),
        {
          timeout: NICE_STUDIO_TIMEOUT_MS,
        },
      )
      .catch(() => null),
    sleep(page, 2000),
  ]);

  await clickOkIfPresent(page, 5000);

  // ✅ AJUSTE: selecionar DEV/PRD com double-click (Opção A)
  const envOk = await doubleClickSpanByExactText(
    page,
    env,
    NICE_STUDIO_TIMEOUT_MS,
  );
  if (!envOk) return { ok: false, reason: "env_not_found", env };

  await sleep(page, 1200);
  return { ok: true };
}

async function clickTreeItemByText(page, label, timeoutMs) {
  const target = normalizeText(label);
  const deadline = Date.now() + Number(timeoutMs || NICE_STUDIO_TIMEOUT_MS);

  while (Date.now() < deadline) {
    const ok = await page
      .evaluate((t) => {
        const norm = (s) =>
          String(s || "")
            .replace(/\s+/g, " ")
            .trim();

        const items = Array.from(
          document.querySelectorAll("[role='treeitem']"),
        );
        const hit = items.find((n) => norm(n.textContent) === t);
        if (hit) {
          hit.click?.();
          return true;
        }

        const spans = Array.from(
          document.querySelectorAll("span.ng-star-inserted"),
        );
        const hit2 = spans.find((s) => norm(s.textContent) === t);
        if (!hit2) return false;

        const clickable =
          hit2.closest("[role='treeitem'],button,[role='button'],a,li,div") ||
          hit2;
        clickable.click?.();
        return true;
      }, target)
      .catch(() => false);

    if (ok) return true;
    await sleep(page, 300);
  }
  return false;
}

async function clickOkIfPresent(page, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const clicked = await page
      .evaluate(() => {
        const norm = (s) =>
          String(s || "")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();

        // Preferir OK dentro de um dialog/overlay, se existir
        const dialog =
          document.querySelector("[role='dialog']") ||
          document.querySelector(".cdk-overlay-container") ||
          document;

        const buttons = Array.from(dialog.querySelectorAll("button"));
        const hit = buttons.find((b) => {
          const t = norm(b.textContent);
          const visible = !!b.offsetParent;
          const enabled = !b.disabled && !b.getAttribute("aria-disabled");
          return visible && enabled && t === "OK";
        });

        if (!hit) return false;
        hit.click?.();
        return true;
      })
      .catch(() => false);

    if (clicked) return true;
    await sleep(page, 200);
  }
  return false;
}

async function listTreeItemsBestEffort(page) {
  const items = await page
    .evaluate(() => {
      const out = [];
      const seen = new Set();
      const norm = (s) =>
        String(s || "")
          .replace(/\s+/g, " ")
          .trim();

      const nodes = Array.from(document.querySelectorAll("[role='treeitem']"));
      for (const n of nodes) {
        const name = norm(n.textContent);
        if (!name || seen.has(name)) continue;
        seen.add(name);

        const expanded = n.getAttribute("aria-expanded");
        const type =
          expanded === "true" || expanded === "false" ? "folder" : "script";
        out.push({ name, type });
      }
      return out;
    })
    .catch(() => []);

  return Array.isArray(items) ? items : [];
}

// ===== ROUTER =====
export const niceRouter = express.Router();

// POST /nice/sessions  (body: { cluster: 1|2 })
niceRouter.post("/sessions", async (req, res) => {
  let context = null;
  let page = null;

  try {
    const c = String(req.body?.cluster || "").trim(); // "1" | "2"

    const browser = await getBrowser();
    context = await createIsolatedContext(browser);
    page = await context.newPage();

    page.setDefaultTimeout(NICE_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NICE_NAV_TIMEOUT_MS);

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
    await sleep(page, 800);

    // 1) aguarda cluster aparecer (ou login/duo já direto)
    await waitForAnySelectorDeep(
      page,
      [
        ...SELECTORS.cluster1,
        ...SELECTORS.cluster2,
        ...SELECTORS.user,
        ...SELECTORS.pass,
        ...SELECTORS.duoTrust,
        ...SELECTORS.duoCode,
      ],
      { timeout: NICE_TIMEOUT_MS, visible: false },
    );

    // 2) se ainda estiver em cluster, clica conforme solicitado
    const st0 = await getPageState(page);

    if (st0.stage === "cluster") {
      const selList =
        c === "1" || c === "01" || c === "contact01"
          ? SELECTORS.cluster1
          : c === "2" || c === "02" || c === "contact02"
            ? SELECTORS.cluster2
            : null;

      if (!selList) {
        return res
          .status(400)
          .json({ ok: false, error: "cluster deve ser 1 ou 2" });
      }

      const clicked = await clickBestEffortDeep(page, selList, {
        timeout: NICE_TIMEOUT_MS,
      });
      if (!clicked) {
        return res
          .status(500)
          .json({ ok: false, error: `Cluster ${c} não encontrado na tela.` });
      }

      // navegação pode ou não ocorrer (SPA). Faz best-effort.
      await Promise.race([
        page
          .waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: NICE_NAV_TIMEOUT_MS,
          })
          .catch(() => null),
        sleep(page, 1500),
      ]);
    }

    // 3) agora sim: aguarda login/duo (em page OU iframe)
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
      } catch {}
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

// POST /nice/sessions/:id/login
niceRouter.post("/sessions/:id/login", async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session)
      return res.status(404).json({ ok: false, error: "Session not found" });

    const { username, password } = req.body || {};
    if (!String(username || "").trim() || !String(password || "").trim()) {
      return res
        .status(400)
        .json({ ok: false, error: "username/password required" });
    }

    const { page } = session;

    const u = await waitForAnySelectorDeep(page, SELECTORS.user, {
      timeout: NICE_TIMEOUT_MS,
    });
    const p = await waitForAnySelectorDeep(page, SELECTORS.pass, {
      timeout: NICE_TIMEOUT_MS,
    });

    await setValue(u.handle, username);
    await setValue(p.handle, password);

    const clicked = await clickBestEffortDeep(page, SELECTORS.submit, {
      timeout: NICE_TIMEOUT_MS,
    });
    if (!clicked)
      return res
        .status(500)
        .json({ ok: false, error: "Login button not found" });

    await Promise.race([
      page
        .waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: NICE_NAV_TIMEOUT_MS,
        })
        .catch(() => null),
      sleep(page, 1500),
    ]);

    await waitForAnySelectorDeep(
      page,
      [...SELECTORS.duoTrust, ...SELECTORS.duoCode, ...SELECTORS.user],
      { timeout: NICE_TIMEOUT_MS },
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
    if (!session)
      return res.status(404).json({ ok: false, error: "Session not found" });

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
    if (!session)
      return res.status(404).json({ ok: false, error: "Session not found" });

    const found = await findFirstInPageOrFrames(
      session.page,
      SELECTORS.duoCode,
    );
    if (!found)
      return res
        .status(409)
        .json({ ok: false, error: "Duo code not available" });

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

// GET /nice/sessions/:id/studio/tree?env=DEV|PRD&path=a/b/c
niceRouter.get("/sessions/:id/studio/tree", async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session)
      return res.status(404).json({ ok: false, error: "Session not found" });

    const envName = String(req.query.env || "")
      .trim()
      .toUpperCase();
    const path = String(req.query.path || "").trim();

    if (!["DEV", "PRD"].includes(envName)) {
      return res
        .status(400)
        .json({ ok: false, error: "env deve ser DEV ou PRD" });
    }

    const ensured = await ensureStudioAndEnv(session, envName);
    if (!ensured.ok) {
      if (ensured.reason === "auth") {
        return res.status(409).json({
          ok: false,
          error: "Authentication required (login/duo ainda pendente)",
          stage: ensured.state?.stage,
          url: ensured.state?.url,
        });
      }
      return res.status(500).json({
        ok: false,
        error: "Failed to open Studio/env",
        details: JSON.stringify(ensured),
      });
    }

    const parts = path
      ? path
          .split("/")
          .map((p) => p.trim())
          .filter(Boolean)
      : [];

    for (const part of parts) {
      const clicked = await clickTreeItemByText(
        session.page,
        part,
        NICE_STUDIO_TIMEOUT_MS,
      );
      if (!clicked) {
        return res.status(404).json({
          ok: false,
          error: `Path segment not found: ${part}`,
          env: envName,
          path,
        });
      }
      await sleep(session.page, 1200);
    }

    const items = await listTreeItemsBestEffort(session.page);

    return res.json({
      ok: true,
      env: envName,
      path: parts.join("/"),
      breadcrumb: ["Scripts", envName, ...parts],
      items,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Failed to read studio tree",
      details: String(e?.message || e),
    });
  }
});

// DELETE /nice/sessions/:id
niceRouter.delete("/sessions/:id", async (req, res) => {
  try {
    const ok = await closeSession(req.params.id);
    if (!ok)
      return res.status(404).json({ ok: false, error: "Session not found" });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Failed to close session",
      details: String(e?.message || e),
    });
  }
});
