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
let sttLogFile = "";

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

function getSttLogFile() {
  if (sttLogFile) return sttLogFile;

  const logsDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  sttLogFile = path.join(logsDir, "stt-python.log");
  return sttLogFile;
}

function appendSttLog(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(getSttLogFile(), line, "utf8");
  } catch (error) {
    console.warn(`[stt] nao foi possivel gravar log: ${error?.message || error}`);
  }
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

function httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {
          // Keep raw body for diagnostics.
        }

        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          body,
          json,
        });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error(`Timeout ao consultar ${url}`));
    });
    req.on("error", reject);
  });
}

function summarizeSttHealth(health) {
  const checks = health?.checks || {};
  const failed = Object.entries(checks)
    .filter(([, value]) => !value?.ok)
    .map(([key, value]) => {
      const detail = value?.error || value?.path || "sem detalhe";
      return `${key}: ${detail}`;
    });

  return failed.length ? failed.join("\n") : JSON.stringify(health || {}, null, 2);
}

async function waitForSttHealth(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let lastHealth = null;

  while (Date.now() < deadline) {
    try {
      const response = await httpGetJson(url, 30000);
      lastHealth = response.json || response.body;
      if (response.ok && response.json?.ok === true) return response.json;

      lastError = new Error(
        `Health STT ainda indisponivel (${response.statusCode}): ${summarizeSttHealth(response.json)}`
      );
    } catch (error) {
      lastError = error;
    }

    await delay(1000);
  }

  const detail =
    lastHealth && typeof lastHealth === "object"
      ? summarizeSttHealth(lastHealth)
      : lastError?.message || String(lastError || "");
  throw new Error(`Servico Python de audio nao iniciou corretamente.\n${detail}`);
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
    throw new Error(`Servico Python de audio nao encontrado em ${serviceDir}`);
  }

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const pythonExecutable = getSttPythonExecutable(serviceDir);
  const uploadDir = path.join(app.getPath("userData"), "stt-uploads");
  const bundledFfmpeg = path.join(serviceDir, "bin", "ffmpeg.exe");
  const bundledFfprobe = path.join(serviceDir, "bin", "ffprobe.exe");
  const bundledWhisperModel = path.join(serviceDir, "models", "faster-whisper-small");

  fs.mkdirSync(uploadDir, { recursive: true });
  getSttLogFile();

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
        WHISPER_MODEL_PATH: bundledWhisperModel,
        ...(fs.existsSync(bundledFfmpeg) ? { FFMPEG_PATH: bundledFfmpeg } : {}),
        ...(fs.existsSync(bundledFfprobe) ? { FFPROBE_PATH: bundledFfprobe } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );

  sttProcess = child;
  appendSttLog(
    "info",
    `iniciando python=${pythonExecutable} baseUrl=${baseUrl} serviceDir=${serviceDir} model=${bundledWhisperModel}`
  );

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk).trimEnd();
    console.log(`[stt] ${text}`);
    appendSttLog("stdout", text);
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk).trimEnd();
    console.warn(`[stt] ${text}`);
    appendSttLog("stderr", text);
  });
  child.on("error", (error) => {
    console.error("[stt] falha ao iniciar servico Python:", error);
    appendSttLog("error", error?.stack || error?.message || String(error));
  });
  child.on("exit", (code, signal) => {
    console.warn(`[stt] servico encerrado code=${code} signal=${signal || ""}`);
    appendSttLog("exit", `code=${code} signal=${signal || ""}`);
    if (sttProcess === child) sttProcess = null;
  });

  try {
    const health = await waitForSttHealth(`${baseUrl}/health`);
    console.log(`[stt] online em ${baseUrl}`);
    appendSttLog("health", JSON.stringify(health));
  } catch (error) {
    appendSttLog("error", error?.stack || error?.message || String(error));
    await shutdownSttService();
    throw new Error(
      `Falha ao iniciar o servico Python de audio.\n\n${error?.message || String(error)}\n\nLog: ${getSttLogFile()}`
    );
  }

  return baseUrl;
}

async function startBackend() {
  const serverDir = getServerDir();
  const clientDist = getClientDistDir();

  if (!fs.existsSync(path.join(clientDist, "index.html"))) {
    throw new Error(
      `Build do front nao encontrado em ${clientDist}. Rode npm run package:win novamente.`
    );
  }

  if (!fs.existsSync(path.join(serverDir, "app.js"))) {
    throw new Error(
      `Backend empacotado nao encontrado em ${serverDir}. Rode npm run package:win novamente.`
    );
  }

  const port = await getFreePort();
  const envFile = path.join(serverDir, ".env");

  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  process.env.PORT = String(port);
  process.env.DEV_FLOW_ENV_FILE = envFile;
  process.env.REQUEST_TIMEOUT_MS = process.env.REQUEST_TIMEOUT_MS || "60000";
  process.env.HEALTHCHECK_TIMEOUT_MS = process.env.HEALTHCHECK_TIMEOUT_MS || "8000";
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
    throw new Error(`Falha na validacao de ambiente:\n${formatted}`);
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
          label: "Diagnostico Jira",
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
        // Process already closed.
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
