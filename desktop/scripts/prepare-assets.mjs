import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..");
const outputDir = path.join(desktopDir, "app");

const clientDistSource = path.join(repoRoot, "client", "dist");
const serverSource = path.join(repoRoot, "server");
const clientDistTarget = path.join(outputDir, "client", "dist");
const serverTarget = path.join(outputDir, "server");

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

  await fs.mkdir(outputDir, { recursive: true });

  await copyDir(clientDistSource, clientDistTarget);
  await copyDir(serverSource, serverTarget, { filter: shouldCopyServerEntry });

  console.log(`[desktop] assets preparados em ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
