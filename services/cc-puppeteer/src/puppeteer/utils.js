export async function waitForAnySelector(pageOrFrame, selectors, opts = {}) {
  const timeout = opts.timeout ?? 30_000;
  const visible = opts.visible ?? true;

  const started = Date.now();
  let lastErr = null;

  while (Date.now() - started < timeout) {
    for (const sel of selectors) {
      try {
        const el = await pageOrFrame.$(sel);
        if (!el) continue;
        if (!visible) return sel;
        const box = await el.boundingBox();
        if (box) return sel;
      } catch (e) {
        lastErr = e;
      }
    }
    await sleep(250);
  }

  const msg = `Timeout waiting for any selector: ${selectors.join(", ")}`;
  const err = new Error(msg);
  if (lastErr) err.cause = lastErr;
  throw err;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function safeText(pageOrFrame, selector) {
  try {
    const el = await pageOrFrame.$(selector);
    if (!el) return "";
    const txt = await pageOrFrame.evaluate((e) => e.innerText || e.textContent || "", el);
    return (txt || "").trim();
  } catch {
    return "";
  }
}

export async function typeLikeHuman(page, selector, value) {
  await page.waitForSelector(selector, { visible: true, timeout: 60_000 });
  await page.focus(selector);
  // limpa
  await page.$eval(selector, (el) => {
    el.value = "";
  });
  await page.type(selector, value, { delay: 20 });
}
