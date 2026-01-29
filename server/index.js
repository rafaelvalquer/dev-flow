// server/index.js
import mongoose from "mongoose";
import createApp from "./app.js";
import { env } from "./config/env.js";
import { startAutomationJob } from "./jobs/automationJob.js";

async function main() {
  if (!env.MONGO_URI) {
    throw new Error("Defina MONGO_URL no .env");
  }

  await mongoose.connect(env.MONGO_URI);

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
  app.listen(port, () => console.log(`[server] listening on :${port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
