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
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT_SESSION_SECRET = "dev-secret-change-me";

let mainWindow = null;
let httpServer = null;
let backendBaseUrl = "";
let sttProcess = null;
let sttBaseUrl = "";

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

function getServicesDir() {
  return path.join(getPreparedAppRoot(), "services");
}

function getSttServiceDir() {
  return path.join(getServicesDir(), "stt-python");
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkHttpOk(url, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });

    req.on("timeout", () => {
      req.destroy(new Error(`Timeout ao consultar ${url}`));
    });
    req.on("error", reject);
  });
}

async function waitForHttpOk(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      if (await checkHttpOk(url)) return true;
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }

  throw lastError || new Error(`ServiÃ§o nÃ£o respondeu em ${url}`);
}

function getSttPythonExecutable(serviceDir) {
  const bundledPython = path.join(serviceDir, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(bundledPython)) return bundledPython;

  const envPython = String(process.env.DEV_FLOW_PYTHON || "").trim();
  return envPython || "python";
}

async function startSttService() {
  if (String(process.env.DEV_FLOW_STT_ENABLED || "true").toLowerCase() === "false") {
    return "";
  }

  if (sttProcess && sttBaseUrl) return sttBaseUrl;

  const serviceDir = getSttServiceDir();
  const appFile = path.join(serviceDir, "app.py");

  if (!fs.existsSync(appFile)) {
    console.warn(`[stt] serviÃ§o Python nÃ£o encontrado em ${serviceDir}`);
    return "";
  }

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const pythonExecutable = getSttPythonExecutable(serviceDir);
  const uploadDir = path.join(app.getPath("userData"), "stt-uploads");
  const bundledFfmpeg = path.join(serviceDir, "bin", "ffmpeg.exe");
  const bundledFfprobe = path.join(serviceDir, "bin", "ffprobe.exe");

  fs.mkdirSync(uploadDir, { recursive: true });

  sttBaseUrl = baseUrl;
  process.env.STT_PY_BASE = baseUrl;

  const child = spawn(
    pythonExecutable,
    ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: serviceDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        STT_UPLOAD_DIR: uploadDir,
        ...(fs.existsSync(bundledFfmpeg) ? { FFMPEG_PATH: bundledFfmpeg } : {}),
        ...(fs.existsSync(bundledFfprobe)
          ? { FFPROBE_PATH: bundledFfprobe }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );

  sttProcess = child;

  child.stdout?.on("data", (chunk) => {
    console.log(`[stt] ${String(chunk).trimEnd()}`);
  });
  child.stderr?.on("data", (chunk) => {
    console.warn(`[stt] ${String(chunk).trimEnd()}`);
  });
  child.on("error", (error) => {
    console.error("[stt] falha ao iniciar serviÃ§o Python:", error);
  });
  child.on("exit", (code, signal) => {
    console.warn(`[stt] serviÃ§o encerrado code=${code} signal=${signal || ""}`);
    if (sttProcess === child) sttProcess = null;
  });

  waitForHttpOk(`${baseUrl}/health`)
    .then(() => console.log(`[stt] online em ${baseUrl}`))
    .catch((error) => {
      console.warn(
        `[stt] serviÃ§o iniciado, mas health-check ainda nÃ£o respondeu: ${
          error?.message || String(error)
        }`
      );
    });

  return baseUrl;
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
  if (sttBaseUrl) process.env.STT_PY_BASE = sttBaseUrl;
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
        {
          label: "Diagnostico STT",
          click: () => {
            if (!backendBaseUrl) return;
            shell.openExternal(`${backendBaseUrl}/api/stt/health`);
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

async function shutdownSttService() {
  if (!sttProcess) return;

  const child = sttProcess;
  sttProcess = null;

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    child.once("exit", finish);
    child.kill();

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Processo jÃ¡ encerrou.
      }
      finish();
    }, 3000);
    timer.unref?.();
  });
}

app.whenReady().then(async () => {
  try {
    await session.defaultSession.setProxy({ mode: "auto_detect" });
    await startSttService();
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
  shutdownSttService().catch((error) => console.error(error));
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", async () => {
  if (mainWindow) return;
  try {
    if (!httpServer) {
      await startSttService();
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
