// server/lib/rdmCopilotGemini.js
import mammoth from "mammoth";

const MAX_TEXT_CHARS_PER_FILE = 80_000;

async function docxToText(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return (value || "").trim();
}

function requireGeminiKey(GEMINI_API_KEY) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY não definido no .env. Defina GEMINI_API_KEY para usar o Co-pilot."
    );
  }
}

function isDocx(file) {
  const name = (file.originalname || "").toLowerCase();
  const mt = (file.mimetype || "").toLowerCase();
  return (
    name.endsWith(".docx") ||
    mt ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function isTextLike(file) {
  const name = (file.originalname || "").toLowerCase();
  const mt = (file.mimetype || "").toLowerCase();
  return (
    mt.startsWith("text/") || name.endsWith(".md") || name.endsWith(".txt")
  );
}

function isPdfOrImage(file) {
  const mt = (file.mimetype || "").toLowerCase();
  return mt === "application/pdf" || mt.startsWith("image/");
}

// Files API resumable upload (start -> upload,finalize)
async function geminiUploadResumable({
  GEMINI_API_KEY,
  buffer,
  mimeType,
  displayName,
}) {
  requireGeminiKey(GEMINI_API_KEY);

  const numBytes = buffer?.length || 0;
  if (!numBytes) throw new Error("Arquivo vazio.");

  // 1) start -> pega x-goog-upload-url
  const startResp = await fetch(
    "https://generativelanguage.googleapis.com/upload/v1beta/files",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": GEMINI_API_KEY,
        "Content-Type": "application/json",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(numBytes),
        "X-Goog-Upload-Header-Content-Type":
          mimeType || "application/octet-stream",
      },
      body: JSON.stringify({
        file: { display_name: displayName || "RDM_FILE" },
      }),
    }
  );

  if (!startResp.ok) {
    const t = await startResp.text();
    throw new Error(
      `Falha ao iniciar upload Gemini (${startResp.status}): ${t.slice(0, 500)}`
    );
  }

  const uploadUrl = startResp.headers.get("x-goog-upload-url");
  if (!uploadUrl)
    throw new Error(
      "Gemini não retornou x-goog-upload-url no start do upload."
    );

  // 2) upload + finalize
  const upResp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(numBytes),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Type": mimeType || "application/octet-stream",
    },
    body: buffer,
  });

  if (!upResp.ok) {
    const t = await upResp.text();
    throw new Error(
      `Falha no upload Gemini (${upResp.status}): ${t.slice(0, 500)}`
    );
  }

  const fileInfo = await upResp.json();
  const fileUri = fileInfo?.file?.uri;
  const fileMime = fileInfo?.file?.mime_type || mimeType;

  if (!fileUri) throw new Error("Upload Gemini OK, mas file.uri não retornou.");

  return { fileUri, mimeType: fileMime };
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((p) => p?.text || "")
    .join("\n")
    .trim();
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function normalizeCopilotJson(obj) {
  const root =
    obj?.answers && typeof obj.answers === "object" ? obj.answers : obj;
  const pick = (k) => (typeof root?.[k] === "string" ? root[k].trim() : "");
  return {
    objetivoDescricao: pick("objetivoDescricao"),
    oQue: pick("oQue"),
    porQue: pick("porQue"),
    paraQue: pick("paraQue"),
    beneficio: pick("beneficio"),
  };
}

async function fileToGeminiPart({ GEMINI_API_KEY, file }) {
  // DOCX -> texto (não faz upload)
  if (isDocx(file)) {
    const text = await docxToText(file.buffer);
    const clipped = text.slice(0, MAX_TEXT_CHARS_PER_FILE);
    return { text: `ARQUIVO: ${file.originalname}\n\n${clipped}` };
  }

  // TXT/MD -> texto
  if (isTextLike(file)) {
    const txt = file.buffer.toString("utf8");
    const clipped = txt.slice(0, MAX_TEXT_CHARS_PER_FILE);
    return { text: `ARQUIVO: ${file.originalname}\n\n${clipped}` };
  }

  // PDF/Imagem -> upload + file_data
  if (isPdfOrImage(file)) {
    const info = await geminiUploadResumable({
      GEMINI_API_KEY,
      buffer: file.buffer,
      mimeType: file.mimetype || "application/octet-stream",
      displayName: file.originalname || "RDM_FILE",
    });
    return { file_data: { file_uri: info.fileUri, mime_type: info.mimeType } };
  }

  throw new Error(
    `Tipo de arquivo não suportado: ${file.originalname} (${file.mimetype})`
  );
}

async function geminiGenerateRdmJson({
  GEMINI_API_KEY,
  GEMINI_MODEL,
  parts = [],
  title = "",
}) {
  requireGeminiKey(GEMINI_API_KEY);

  const schema = {
    type: "OBJECT",
    properties: {
      objetivoDescricao: { type: "STRING" },
      oQue: { type: "STRING" },
      porQue: { type: "STRING" },
      paraQue: { type: "STRING" },
      beneficio: { type: "STRING" },
    },
    required: ["objetivoDescricao", "oQue", "porQue", "paraQue", "beneficio"],
  };

  const prompt = [
    "Você é um engenheiro responsável por redigir uma RDM (Requisição de Mudança).",
    "Responda em PT-BR, tecnicamente, com clareza e objetividade.",
    "Preencha os campos com base nos anexos.",
    title ? `Título da RDM (contexto): ${title}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          ...parts,
          {
            text: "Retorne APENAS um JSON com as chaves: objetivoDescricao, oQue, porQue, paraQue, beneficio.",
          },
        ],
      },
    ],
    generation_config: {
      response_mime_type: "application/json",
      response_schema: schema,
      temperature: 0.2,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": GEMINI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(
      `Gemini generateContent falhou (${r.status}): ${t.slice(0, 800)}`
    );
  }

  const data = await r.json();
  const text = extractGeminiText(data);
  const parsed = tryParseJson(text);

  if (!parsed) {
    throw new Error(
      "Gemini retornou conteúdo, mas não foi possível interpretar como JSON. Conteúdo (parcial): " +
        text.slice(0, 500)
    );
  }

  return { answers: normalizeCopilotJson(parsed), rawText: text };
}

export function registerRdmCopilotRoutes(app, upload, env) {
  const GEMINI_API_KEY = env.GEMINI_API_KEY;
  const GEMINI_MODEL = env.GEMINI_MODEL || "gemini-2.5-flash";

  app.post(
    "/api/gemini/rdm-copilot",
    upload.array("files"),
    async (req, res) => {
      try {
        requireGeminiKey(GEMINI_API_KEY);

        const title = String(req.body?.title || "");
        if (!req.files?.length) {
          return res.status(400).json({ error: "Nenhum arquivo enviado." });
        }

        // monta parts mistos: (text) para docx/txt e (file_data) para pdf/imagens
        const parts = [];
        for (const f of req.files) {
          parts.push(await fileToGeminiPart({ GEMINI_API_KEY, file: f }));
        }

        const out = await geminiGenerateRdmJson({
          GEMINI_API_KEY,
          GEMINI_MODEL,
          parts,
          title,
        });

        return res.json(out);
      } catch (err) {
        console.error("RDM copilot error:", err);
        return res.status(500).json({
          error: "Falha ao executar Co-pilot do RDM",
          details: err?.message ? String(err.message) : String(err),
        });
      }
    }
  );
}
