// server/db/mongo.js
import mongoose from "mongoose";

function buildMongoUri(env) {
  // 1) Preferência: URI completa
  const explicit = String(env.MONGO_URI || "").trim();
  if (explicit) return explicit;

  // 2) Montar via partes (Atlas)
  const host = String(env.MONGO_HOST || "").trim();
  const dbName = String(env.MONGO_DB || "devflow_dev").trim();
  const user = String(env.DB_USER || "").trim();
  const pass = String(env.DB_PASSWORD || "").trim();
  const params = String(
    env.MONGO_PARAMS || "retryWrites=true&w=majority"
  ).trim();

  if (host && dbName && user && pass) {
    const u = encodeURIComponent(user);
    const p = encodeURIComponent(pass);
    return `mongodb+srv://${u}:${p}@${host}/${dbName}?${params}`;
  }

  // 3) Fallback local (se existir Mongo local rodando)
  if (dbName) return `mongodb://127.0.0.1:27017/${dbName}`;

  return null;
}

function safeUriForLog(uri) {
  // mascara senha no log
  return uri.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");
}

export async function connectMongo(env) {
  const uri = buildMongoUri(env);

  if (!uri) {
    console.warn(
      "[WARN] MongoDB não configurado. Defina MONGO_URI (recomendado) ou MONGO_HOST/DB_USER/DB_PASSWORD/MONGO_DB."
    );
    return;
  }

  console.log("[MongoDB] Connecting:", safeUriForLog(uri));

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
  });

  console.log("[MongoDB] Conectado");
}
