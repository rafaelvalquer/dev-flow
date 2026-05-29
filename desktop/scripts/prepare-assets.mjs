import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..");
const outputDir = path.join(desktopDir, "app");

const clientDistSource = path.join(repoRoot, "client", "dist");
const serverSource = path.join(repoRoot, "server");
const sttServiceSource = path.join(repoRoot, "services", "stt-python");
const clientDistTarget = path.join(outputDir, "client", "dist");
const serverTarget = path.join(outputDir, "server");
const sttServiceTarget = path.join(outputDir, "services", "stt-python");
const pythonRuntimeTarget = path.join(sttServiceTarget, "runtime", "python");
const whisperModelTarget = path.join(
  sttServiceTarget,
  "models",
  "faster-whisper-small",
);
const whisperCacheSnapshotsDir = path.join(
  os.homedir(),
  ".cache",
  "huggingface",
  "hub",
  "models--Systran--faster-whisper-small",
  "snapshots",
);

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shouldCopyServerEntry(sourcePath) {
  const relative = path.relative(serverSource, sourcePath).replace(/\\/g, "/");

  if (!relative) return true;
  if (relative === ".git" || relative.startsWith(".git/")) return false;
  if (relative === "node_modules/.cache" || relative.startsWith("node_modules/.cache/")) {
    return false;
  }
  if (relative === "dist" || relative.startsWith("dist/")) return false;
  if (relative === "build" || relative.startsWith("build/")) return false;
  if (relative.endsWith(".zip")) return false;
  if (relative.endsWith(".log")) return false;

  return true;
}

function shouldCopySttServiceEntry(sourcePath) {
  const relative = path
    .relative(sttServiceSource, sourcePath)
    .replace(/\\/g, "/");

  if (!relative) return true;
  const parts = relative.split("/");
  if (relative === ".git" || relative.startsWith(".git/")) return false;
  if (relative === "uploads" || relative.startsWith("uploads/")) return false;
  if (parts.includes("__pycache__")) return false;
  if (relative === ".pytest_cache" || relative.startsWith(".pytest_cache/")) {
    return false;
  }
  if (relative.endsWith(".pyc")) return false;
  if (relative.endsWith(".pyo")) return false;
  if (relative.endsWith(".log")) return false;

  return true;
}

function shouldCopyPythonRuntimeEntry(sourcePath, sourceRoot) {
  const relative = path.relative(sourceRoot, sourcePath).replace(/\\/g, "/");

  if (!relative) return true;
  const parts = relative.split("/");
  if (parts.includes("__pycache__")) return false;
  if (relative === "Doc" || relative.startsWith("Doc/")) return false;
  if (relative === "Scripts" || relative.startsWith("Scripts/")) return false;
  if (relative === "Lib/site-packages" || relative.startsWith("Lib/site-packages/")) {
    return false;
  }
  if (relative.endsWith(".pyc")) return false;
  if (relative.endsWith(".pyo")) return false;
  if (relative.endsWith(".log")) return false;

  return true;
}

async function copyFileIfChanged(source, target) {
  const sourceStat = await fs.stat(source);
  try {
    const targetStat = await fs.stat(target);
    const sameSize = sourceStat.size === targetStat.size;
    const targetIsFresh = targetStat.mtimeMs >= sourceStat.mtimeMs;
    if (sameSize && targetIsFresh) return;
  } catch {
    // Destino ainda não existe.
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function copyDir(source, target, options = {}) {
  if (options.filter && !options.filter(source)) return;

  const entries = await fs.readdir(source, { withFileTypes: true });
  await fs.mkdir(target, { recursive: true });

  for (const entry of entries) {
    const sourceEntry = path.join(source, entry.name);
    const targetEntry = path.join(target, entry.name);

    if (options.filter && !options.filter(sourceEntry)) continue;

    if (entry.isDirectory()) {
      await copyDir(sourceEntry, targetEntry, options);
      continue;
    }

    if (entry.isFile()) {
      await copyFileIfChanged(sourceEntry, targetEntry);
    }
  }
}

async function readEnvValue(filePath, key) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const line = text
      .split(/\r?\n/)
      .find((entry) => entry.trim().startsWith(`${key}=`));
    if (!line) return "";
    return line
      .slice(line.indexOf("=") + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}

async function readPyvenvConfigValue(key) {
  const configPath = path.join(sttServiceSource, ".venv", "pyvenv.cfg");
  try {
    const text = await fs.readFile(configPath, "utf8");
    const line = text
      .split(/\r?\n/)
      .find((entry) => entry.trim().startsWith(`${key} `));
    if (!line || !line.includes("=")) return "";
    return line
      .slice(line.indexOf("=") + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}

async function resolvePythonRuntimeSource() {
  const explicit = String(process.env.DEV_FLOW_PYTHON_RUNTIME_DIR || "").trim();
  if (explicit) {
    if (await exists(path.join(explicit, "python.exe"))) return explicit;
    throw new Error(
      `DEV_FLOW_PYTHON_RUNTIME_DIR definido, mas python.exe nao existe em: ${explicit}`,
    );
  }

  const venvHome = await readPyvenvConfigValue("home");
  if (venvHome && (await exists(path.join(venvHome, "python.exe")))) {
    return venvHome;
  }

  throw new Error(
    [
      "Runtime Python nao encontrado para empacotar.",
      "Instale o Python usado pela venv ou defina DEV_FLOW_PYTHON_RUNTIME_DIR apontando para uma pasta com python.exe.",
      `pyvenv.cfg home atual: ${venvHome || "(vazio)"}`,
    ].join("\n"),
  );
}

async function copyPythonRuntime() {
  const runtimeSource = await resolvePythonRuntimeSource();
  await removeDirIfPossible(pythonRuntimeTarget);
  await copyDir(runtimeSource, pythonRuntimeTarget, {
    filter: (sourcePath) => shouldCopyPythonRuntimeEntry(sourcePath, runtimeSource),
  });
  console.log(`[desktop] runtime Python copiado de ${runtimeSource}`);
}

async function copySttFfmpegBinaries() {
  const envFile = path.join(sttServiceSource, ".env");
  const ffmpegSource =
    process.env.DEV_FLOW_FFMPEG_PATH ||
    (await readEnvValue(envFile, "FFMPEG_PATH"));
  const ffprobeSource =
    process.env.DEV_FLOW_FFPROBE_PATH ||
    (await readEnvValue(envFile, "FFPROBE_PATH"));

  if (!(await exists(ffmpegSource)) || !(await exists(ffprobeSource))) {
    console.warn(
      "[desktop] ffmpeg/ffprobe nÃ£o encontrados; o serviÃ§o STT vai depender do ffmpeg instalado na mÃ¡quina."
    );
    return;
  }

  const binTarget = path.join(sttServiceTarget, "bin");
  await fs.mkdir(binTarget, { recursive: true });
  await copyFileIfChanged(ffmpegSource, path.join(binTarget, "ffmpeg.exe"));
  await copyFileIfChanged(ffprobeSource, path.join(binTarget, "ffprobe.exe"));
}

async function newestDirectory(source) {
  if (!(await exists(source))) return "";

  const entries = await fs.readdir(source, { withFileTypes: true });
  const dirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(source, entry.name);
    const stat = await fs.stat(fullPath);
    dirs.push({ fullPath, mtimeMs: stat.mtimeMs });
  }

  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs[0]?.fullPath || "";
}

async function resolveWhisperModelSource() {
  const explicit = String(process.env.DEV_FLOW_WHISPER_MODEL_DIR || "").trim();
  if (explicit) {
    if (await exists(explicit)) return explicit;
    throw new Error(
      `DEV_FLOW_WHISPER_MODEL_DIR definido, mas o caminho nao existe: ${explicit}`,
    );
  }

  const cachedSnapshot = await newestDirectory(whisperCacheSnapshotsDir);
  if (cachedSnapshot) return cachedSnapshot;

  throw new Error(
    [
      "Modelo Systran/faster-whisper-small nao encontrado para empacotar.",
      `Defina DEV_FLOW_WHISPER_MODEL_DIR apontando para um snapshot local ou baixe o modelo no cache: ${whisperCacheSnapshotsDir}`,
    ].join("\n"),
  );
}

async function copyWhisperModel() {
  const modelSource = await resolveWhisperModelSource();
  await removeDirIfPossible(whisperModelTarget);
  await copyDir(modelSource, whisperModelTarget);
  console.log(`[desktop] modelo Whisper copiado de ${modelSource}`);
}

async function removeDirIfPossible(target) {
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `[desktop] nÃ£o foi possÃ­vel limpar ${target}; sobrescrevendo arquivos existentes. ${error?.message || error}`
    );
  }
}

async function main() {
  if (!(await exists(path.join(clientDistSource, "index.html")))) {
    throw new Error(
      `client/dist não encontrado. Rode "npm --prefix client run build" antes do empacotamento.`
    );
  }

  if (!(await exists(path.join(serverSource, "app.js")))) {
    throw new Error(`server/app.js não encontrado em ${serverSource}.`);
  }

  if (!(await exists(path.join(serverSource, ".env")))) {
    throw new Error(
      `server/.env não encontrado. O plano atual embute esse arquivo no instalador.`
    );
  }

  if (!(await exists(path.join(serverSource, "node_modules")))) {
    throw new Error(
      `server/node_modules não encontrado. Rode "npm --prefix server install" antes de gerar o instalador.`
    );
  }

  if (!(await exists(path.join(sttServiceSource, "app.py")))) {
    throw new Error(`ServiÃ§o STT Python nÃ£o encontrado em ${sttServiceSource}.`);
  }

  if (
    !(await exists(path.join(sttServiceSource, ".venv", "Scripts", "python.exe")))
  ) {
    throw new Error(
      `Python do serviÃ§o STT nÃ£o encontrado. Rode a instalaÃ§Ã£o da venv em ${sttServiceSource}.`
    );
  }

  await fs.mkdir(outputDir, { recursive: true });

  await copyDir(clientDistSource, clientDistTarget);
  await copyDir(serverSource, serverTarget, { filter: shouldCopyServerEntry });
  await removeDirIfPossible(sttServiceTarget);
  await copyDir(sttServiceSource, sttServiceTarget, {
    filter: shouldCopySttServiceEntry,
  });
  await copyPythonRuntime();
  await copySttFfmpegBinaries();
  await copyWhisperModel();

  console.log(`[desktop] assets preparados em ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
