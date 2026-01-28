// server/index.js
import { env } from "./config/env.js";
import { connectMongo } from "./db/mongo.js";
import createApp from "./app.js";

const app = createApp();

const PORT = Number(env.PORT) || 3000;

await connectMongo(env);

app.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
});
