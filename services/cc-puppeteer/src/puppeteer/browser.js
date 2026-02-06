import puppeteer from "puppeteer";

let browserPromise = null;

export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      //headless: process.env.HEADLESS === "false" ? false : "new",
      headless: 0, //Abrir navegador para Debug
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }
  return browserPromise;
}

/**
 * Cria um contexto isolado.
 * Compatível com versões onde createIncognitoBrowserContext foi removido/deprecado.
 */
export async function createIsolatedContext(browser) {
  if (typeof browser.createBrowserContext === "function") {
    return await browser.createBrowserContext();
  }
  if (typeof browser.createIncognitoBrowserContext === "function") {
    return await browser.createIncognitoBrowserContext();
  }
  // fallback: não isola (último recurso)
  return browser.defaultBrowserContext();
}

export async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch {
    // ignore
  } finally {
    browserPromise = null;
  }
}
