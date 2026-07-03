import mammoth from "mammoth";

const MAX_TEXT_CHARS_PER_FILE = 80_000;
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

function requireOpenAiKey(OPENAI_API_KEY) {
  if (!String(OPENAI_API_KEY || "").trim()) {
    throw new Error(
      "OPENAI_API_KEY nao definido no .env. Defina OPENAI_API_KEY para usar o Co-pilot."
    );
  }
}

async function docxToText(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return (value || "").trim();
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

function isImage(file) {
  return String(file.mimetype || "").toLowerCase().startsWith("image/");
}

async function fileToOpenAiContent(file) {
  if (isDocx(file)) {
    const text = await docxToText(file.buffer);
    return {
      type: "text",
      text: `ARQUIVO: ${file.originalname}\n\n${text.slice(0, MAX_TEXT_CHARS_PER_FILE)}`,
    };
  }

  if (isTextLike(file)) {
    return {
      type: "text",
      text: `ARQUIVO: ${file.originalname}\n\n${file.buffer
        .toString("utf8")
        .slice(0, MAX_TEXT_CHARS_PER_FILE)}`,
    };
  }

  if (isImage(file)) {
    return {
      type: "image_url",
      image_url: {
        url: `data:${file.mimetype || "image/png"};base64,${file.buffer.toString(
          "base64"
        )}`,
      },
    };
  }

  throw new Error(
    `Tipo de arquivo nao suportado pelo Co-pilot OpenAI: ${file.originalname} (${file.mimetype}). Envie DOCX, TXT, MD ou imagem.`
  );
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeCopilotJson(obj) {
  const root =
    obj?.answers && typeof obj.answers === "object" ? obj.answers : obj;
  const pick = (key) =>
    typeof root?.[key] === "string" ? root[key].trim() : "";
  return {
    objetivoDescricao: pick("objetivoDescricao"),
    oQue: pick("oQue"),
    porQue: pick("porQue"),
    paraQue: pick("paraQue"),
    beneficio: pick("beneficio"),
  };
}

async function openAiGenerateRdmJson({
  OPENAI_API_KEY,
  OPENAI_MODEL,
  content = [],
  title = "",
}) {
  requireOpenAiKey(OPENAI_API_KEY);

  const schema = {
    type: "object",
    properties: {
      objetivoDescricao: { type: "string" },
      oQue: { type: "string" },
      porQue: { type: "string" },
      paraQue: { type: "string" },
      beneficio: { type: "string" },
    },
    required: ["objetivoDescricao", "oQue", "porQue", "paraQue", "beneficio"],
    additionalProperties: false,
  };

  const prompt = [
    "Voce e um engenheiro responsavel por redigir uma RDM (Requisicao de Mudanca).",
    "Responda em PT-BR, tecnicamente, com clareza e objetividade.",
    "Preencha os campos com base nos anexos.",
    title ? `Titulo da RDM (contexto): ${title}` : "",
    "Retorne apenas JSON valido.",
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    model: OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          ...content,
          {
            type: "text",
            text: "Retorne APENAS um JSON com as chaves: objetivoDescricao, oQue, porQue, paraQue, beneficio.",
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "rdm_copilot",
        schema,
        strict: false,
      },
    },
    temperature: 0.2,
  };

  if (String(body.model).startsWith("gpt-5")) delete body.temperature;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `OpenAI chat.completions falhou (${response.status}): ${text.slice(0, 800)}`
    );
  }

  const data = await response.json();
  const text = String(data?.choices?.[0]?.message?.content || "").trim();
  const parsed = tryParseJson(text);
  if (!parsed) {
    throw new Error(
      "OpenAI retornou conteudo, mas nao foi possivel interpretar como JSON. Conteudo (parcial): " +
        text.slice(0, 500)
    );
  }

  return { answers: normalizeCopilotJson(parsed), rawText: text };
}

export function registerRdmCopilotRoutes(app, upload, env) {
  app.post("/api/openai/rdm-copilot", upload.array("files"), async (req, res) => {
    try {
      requireOpenAiKey(env.OPENAI_API_KEY);

      const title = String(req.body?.title || "");
      if (!req.files?.length) {
        return res.status(400).json({ error: "Nenhum arquivo enviado." });
      }

      const content = [];
      for (const file of req.files) {
        content.push(await fileToOpenAiContent(file));
      }

      const out = await openAiGenerateRdmJson({
        OPENAI_API_KEY: env.OPENAI_API_KEY,
        OPENAI_MODEL: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
        content,
        title,
      });

      return res.json(out);
    } catch (err) {
      console.error("RDM copilot OpenAI error:", err);
      return res.status(500).json({
        error: "Falha ao executar Co-pilot do RDM",
        details: err?.message ? String(err.message) : String(err),
      });
    }
  });
}
