// server/index.js
import createApp from "./app.js";
import { env, validateEnv } from "./config/env.js";
import { connectMongo } from "./db/mongo.js";
import { startAutomationJob } from "./jobs/automationJob.js";

async function main() {
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

  // Recomendado: não iniciar jobs dentro do createApp
  const app = createApp({ startJobs: false });

  // start job após conexão com Mongo
  if (String(env.AUTOMATION_JOB_ENABLED || "true").toLowerCase() !== "false") {
    startAutomationJob({
      intervalMs: Number(env.AUTOMATION_JOB_INTERVAL_MS || 60_000),
      env,
    });
  }

  const port = Number(env.PORT || 3001);
  app.listen(port, () => console.log(`[server] listening on:${port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
