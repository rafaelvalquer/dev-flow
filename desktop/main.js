const SYSTEM_CA_NODE_OPTION = "--use-system-ca";
const INSECURE_TLS_REJECT_UNAUTHORIZED = "0";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = INSECURE_TLS_REJECT_UNAUTHORIZED;

function appendNodeOption(option) {
  const current = String(process.env.NODE_OPTIONS || "").trim();
  const parts = current ? current.split(/\s+/) : [];
  if (!parts.includes(option)) parts.push(option);
  process.env.NODE_OPTIONS = parts.join(" ");
}

appendNodeOption(SYSTEM_CA_NODE_OPTION);

const { app, BrowserWindow, dialog, Menu, session, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT_SESSION_SECRET = "dev-secret-change-me";

let mainWindow = null;
let httpServer = null;
let backendBaseUrl = "";

app.commandLine.appendSwitch("proxy-auto-detect");
app.commandLine.appendSwitch("proxy-bypass-list", "<local>;localhost;127.0.0.1");

function getPreparedAppRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }

  return path.join(app.getAppPath(), "app");
}

function getServerDir() {
  return path.join(getPreparedAppRoot(), "server");
}

function getClientDistDir() {
  return path.join(getPreparedAppRoot(), "client", "dist");
}

function toImportUrl(filePath) {
  return pathToFileURL(filePath).href;
}

function ensureSessionSecret() {
  const current = String(process.env.SESSION_SECRET || "").trim();
  if (current && current !== DEFAULT_SESSION_SECRET) return;

  process.env.SESSION_SECRET = `dev-flow-desktop-${crypto
    .randomBytes(32)
    .toString("hex")}`;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function startBackend() {
  const serverDir = getServerDir();
  const clientDist = getClientDistDir();

  if (!fs.existsSync(path.join(clientDist, "index.html"))) {
    throw new Error(
      `Build do front não encontrado em ${clientDist}. Rode npm run package:win novamente.`
    );
  }

  if (!fs.existsSync(path.join(serverDir, "app.js"))) {
    throw new Error(
      `Backend empacotado não encontrado em ${serverDir}. Rode npm run package:win novamente.`
    );
  }

  const port = await getFreePort();
  const envFile = path.join(serverDir, ".env");

  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  process.env.PORT = String(port);
  process.env.DEV_FLOW_ENV_FILE = envFile;
  process.env.REQUEST_TIMEOUT_MS = process.env.REQUEST_TIMEOUT_MS || "60000";
  process.env.HEALTHCHECK_TIMEOUT_MS =
    process.env.HEALTHCHECK_TIMEOUT_MS || "8000";
  ensureSessionSecret();

  const [{ default: createApp }, { env, validateEnv }, { connectMongo }, jobs] =
    await Promise.all([
      import(toImportUrl(path.join(serverDir, "app.js"))),
      import(toImportUrl(path.join(serverDir, "config", "env.js"))),
      import(toImportUrl(path.join(serverDir, "db", "mongo.js"))),
      import(toImportUrl(path.join(serverDir, "jobs", "automationJob.js"))),
    ]);

  const validation = validateEnv(env);
  validation.warnings.forEach((issue) => {
    console.warn(`[env:${issue.level}] ${issue.key} - ${issue.message}`);
  });

  if (!validation.ok) {
    const formatted = validation.errors
      .map((issue) => `${issue.key}: ${issue.message}`)
      .join("\n");
    throw new Error(`Falha na validação de ambiente:\n${formatted}`);
  }

  await connectMongo(env);

  const expressApp = createApp({ startJobs: false, clientDist });

  if (String(env.AUTOMATION_JOB_ENABLED || "true").toLowerCase() !== "false") {
    jobs.startAutomationJob({
      intervalMs: Number(env.AUTOMATION_JOB_INTERVAL_MS || 60000),
      env,
    });
  }

  httpServer = await new Promise((resolve, reject) => {
    const server = expressApp.listen(port, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });

  backendBaseUrl = `http://127.0.0.1:${port}`;
  return port;
}

function installAppMenu() {
  const template = [
    {
      label: "Dev Flow",
      submenu: [
        {
          label: "Diagnóstico Jira",
          click: () => {
            if (!backendBaseUrl) return;
            shell.openExternal(`${backendBaseUrl}/health/jira`);
          },
        },
        { type: "separator" },
        { role: "reload", label: "Recarregar" },
        { role: "quit", label: "Sair" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    title: "Dev Flow",
    show: false,
    backgroundColor: "#f8f5f6",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

async function shutdownBackend() {
  if (!httpServer) return;

  await new Promise((resolve) => {
    httpServer.close(() => resolve());
  });
  httpServer = null;
}

app.whenReady().then(async () => {
  try {
    await session.defaultSession.setProxy({ mode: "auto_detect" });
    const port = await startBackend();
    installAppMenu();
    createWindow(port);
  } catch (error) {
    console.error(error);
    dialog.showErrorBox(
      "Falha ao iniciar o Dev Flow",
      error?.message || String(error)
    );
    app.quit();
  }
});

app.on("before-quit", () => {
  shutdownBackend().catch((error) => console.error(error));
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", async () => {
  if (mainWindow) return;
  try {
    if (!httpServer) {
      const port = await startBackend();
      createWindow(port);
      return;
    }

    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    createWindow(port);
  } catch (error) {
    console.error(error);
    dialog.showErrorBox(
      "Falha ao reabrir o Dev Flow",
      error?.message || String(error)
    );
  }
});
