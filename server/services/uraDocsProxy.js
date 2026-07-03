import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import {
  analyzeUraContext,
  buildUraAiFailureWarning,
} from "../lib/uraOpenAiAnalyzer.js";
import { emptyUraAiEnrichment } from "../lib/uraAiSchemas.js";

function safeFileName(name) {
  return String(name || "arquivo")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 160);
}

function parseOptions(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function readJsonResponse(response, fallbackMessage) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(
      typeof payload === "object"
        ? payload?.detail || payload?.error || fallbackMessage
        : payload || fallbackMessage
    );
  }

  return payload;
}

async function postFileToPython({ baseUrl, endpoint, file, timeoutMs }) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([file.buffer], {
      type: file.mimetype || "application/octet-stream",
    }),
    file.originalname
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
      signal: controller.signal,
    });
    return readJsonResponse(response, "Falha no microservico URA Docs.");
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `Timeout ao chamar o microservico URA Docs em ${baseUrl}${endpoint}. Verifique se o servico Python esta ativo.`
      );
    }
    throw new Error(
      `Servico Python STT/URA Docs offline ou inacessivel em ${baseUrl}. Inicie o servico em services/stt-python. Detalhe: ${
        error?.message || String(error)
      }`
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function postJsonToPython({ baseUrl, endpoint, payload, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return readJsonResponse(response, "Falha no microservico URA Docs.");
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `Timeout ao chamar o microservico URA Docs em ${baseUrl}${endpoint}. Verifique se o servico Python esta ativo.`
      );
    }
    throw new Error(
      `Servico Python STT/URA Docs offline ou inacessivel em ${baseUrl}. Inicie o servico em services/stt-python. Detalhe: ${
        error?.message || String(error)
      }`
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function transcribeAudioFile({ file, pyBase, timeoutMs }) {
  try {
    const payload = await postFileToPython({
      baseUrl: pyBase,
      endpoint: "/transcribe",
      file,
      timeoutMs,
    });
    return {
      fileName: file.originalname,
      hash: sha256(file.buffer),
      rawTranscription:
        payload?.text ||
        payload?.transcription ||
        payload?.rawTranscription ||
        payload?.result ||
        "",
      status: "transcribed",
      confidence: payload?.confidence ?? null,
      provider: "python-local",
      model: "faster-whisper-local",
      language: payload?.language || null,
      duration: payload?.duration ?? null,
      audio: payload?.audio || null,
    };
  } catch (error) {
    return {
      fileName: file.originalname,
      hash: sha256(file.buffer),
      rawTranscription: "",
      status: "failed",
      confidence: null,
      provider: "python-local",
      model: "faster-whisper-local",
      error: error?.message || String(error),
    };
  }
}

function matchPromptsWithAudio(normalizedFlow, transcriptions) {
  const items = Array.isArray(transcriptions?.items) ? transcriptions.items : [];
  const byName = new Map(
    items.map((item) => [String(item.fileName || "").toLowerCase(), item])
  );

  const prompts = (normalizedFlow?.prompts || []).map((prompt) => {
    const match = byName.get(String(prompt.fileName || "").toLowerCase());
    return {
      ...prompt,
      matchedAudio: !!match,
      transcription: match?.rawTranscription || prompt.transcription || "",
    };
  });

  return { ...normalizedFlow, prompts };
}

function validateNormalizedFlow(normalizedFlow) {
  const actions = Array.isArray(normalizedFlow?.actions)
    ? normalizedFlow.actions
    : [];
  const hasStructuredData =
    actions.some(
      (action) =>
        action &&
        (String(action.type || "").trim() ||
          String(action.caption || "").trim() ||
          Object.keys(action.parameters || {}).length ||
          (Array.isArray(action.branches) && action.branches.length) ||
          (Array.isArray(action.cases) && action.cases.length) ||
          String(action.defaultNextAction || "").trim())
    ) ||
    (Array.isArray(normalizedFlow?.edges) && normalizedFlow.edges.length) ||
    (Array.isArray(normalizedFlow?.prompts) && normalizedFlow.prompts.length) ||
    (Array.isArray(normalizedFlow?.skills) && normalizedFlow.skills.length) ||
    (Array.isArray(normalizedFlow?.menus) && normalizedFlow.menus.length);

  if (!actions.length || !hasStructuredData) {
    throw new Error(
      "Parser NICE nao retornou actions reais. O job foi interrompido antes de transcrever audios ou chamar IA; verifique se o XML exportado contem ActionID, Action, Caption e conexoes reconheciveis."
    );
  }
}

function hasActionStructSource(normalizedFlow) {
  return (normalizedFlow?.actions || []).some(
    (action) => action?.raw?._tag === "ActionStruct" || action?.raw?._niceTyped
  );
}

function validateNavigablePackage(normalizedFlow) {
  const actions = Array.isArray(normalizedFlow?.actions)
    ? normalizedFlow.actions
    : [];
  const edges = Array.isArray(normalizedFlow?.edges) ? normalizedFlow.edges : [];
  if (hasActionStructSource(normalizedFlow) && (actions.length <= 1 || edges.length === 0)) {
    throw new Error(
      "Parser NICE nao gerou fluxo navegavel. Reinicie o servico Python ou valide o XML enviado."
    );
  }
}

function summarizeFlow(normalizedFlow, packageResult, aiAnalysis) {
  return {
    project: normalizedFlow?.project || {},
    counts: {
      actions: normalizedFlow?.actions?.length || 0,
      edges: normalizedFlow?.edges?.length || 0,
      menus: normalizedFlow?.menus?.length || 0,
      skills: normalizedFlow?.skills?.length || 0,
      prompts: normalizedFlow?.prompts?.length || 0,
      issues: aiAnalysis?.issues?.length || 0,
      testCases: aiAnalysis?.testCases?.length || 0,
      runbookItems: aiAnalysis?.runbook?.length || 0,
    },
    generatedAt: new Date().toISOString(),
    package: packageResult?.summary || {},
  };
}

export async function runUraDocsJob({ jobId, files, fields, store, env }) {
  const job = store.getJob(jobId);
  const pyBase = env.URA_DOCS_PY_BASE || env.STT_PY_BASE || "http://127.0.0.1:8000";
  const timeoutMs = Number(env.URA_DOCS_TIMEOUT_MS || 300000);
  const sttTimeoutMs = Number(env.URA_DOCS_STT_TIMEOUT_MS || timeoutMs);
  const options = parseOptions(fields.options);
  const projectName = String(fields.project_name || fields.projectName || "").trim();

  await store.ensureRoot();
  await fs.mkdir(job.jobDir, { recursive: true });

  try {
    store.updateJob(jobId, {
      status: "processing",
      step: "saving_uploads",
      progress: 5,
      message: "Salvando arquivos enviados...",
    });

    const niceFile = files.nice_file?.[0];
    if (!niceFile) throw new Error("Arquivo NICE nao enviado.");

    await store.writeBuffer(
      job,
      path.join("uploads", safeFileName(niceFile.originalname)),
      niceFile.buffer
    );

    const audioFiles = files.audio_files || [];
    for (const audio of audioFiles) {
      await store.writeBuffer(
        job,
        path.join("uploads", "audio", safeFileName(audio.originalname)),
        audio.buffer
      );
    }
    if (files.audio_zip?.[0]) {
      await store.writeBuffer(
        job,
        path.join("uploads", safeFileName(files.audio_zip[0].originalname)),
        files.audio_zip[0].buffer
      );
      store.addWarning(jobId, "audio_zip recebido e armazenado; extracao automatica sera tratada pelo microservico em evolucao futura.");
    }

    store.updateJob(jobId, {
      step: "parse",
      progress: 18,
      message: "Executando parser deterministico NICE...",
    });

    const parsed = await postFileToPython({
      baseUrl: pyBase,
      endpoint: "/parse",
      file: niceFile,
      timeoutMs,
    });
    let normalizedFlow = parsed?.normalized_flow || parsed;
    if (projectName) {
      normalizedFlow.project = {
        ...(normalizedFlow.project || {}),
        name: projectName,
      };
    }
    validateNormalizedFlow(normalizedFlow);

    store.updateJob(jobId, {
      step: "transcription",
      progress: 35,
      message: "Transcrevendo audios enviados...",
    });

    const transcriptionItems = [];
    for (const [index, file] of audioFiles.entries()) {
      const audioProgress =
        35 + Math.round(((index + 1) / Math.max(audioFiles.length, 1)) * 18);
      store.updateJob(jobId, {
        step: "transcription",
        progress: Math.min(audioProgress, 53),
        message: `Transcrevendo audio localmente ${index + 1} de ${
          audioFiles.length
        }: ${file.originalname}`,
      });
      const item = await transcribeAudioFile({ file, pyBase, timeoutMs: sttTimeoutMs });
      transcriptionItems.push(item);
      if (item.status === "failed") {
        store.addWarning(jobId, `Falha ao transcrever ${file.originalname}: ${item.error}`);
      }
    }
    const transcriptions = { items: transcriptionItems };
    normalizedFlow = matchPromptsWithAudio(normalizedFlow, transcriptions);

    await store.writeJson(job, "normalized_flow.json", normalizedFlow);
    await store.writeJson(job, "transcricoes.json", transcriptions);

    store.updateJob(jobId, {
      step: "ai_enrichment",
      progress: 58,
      message: "Analisando contexto funcional da URA com OpenAI...",
    });

    const aiResult = await analyzeUraContext({
      normalizedFlow,
      transcriptions,
      projectName: projectName || normalizedFlow?.project?.name || "URA",
      options,
      env,
    }).catch((error) => ({
      analysis: null,
      warnings: [
        buildUraAiFailureWarning({
          stage: "erro_inesperado_backend",
          error,
          normalizedFlow,
          transcriptions,
          projectName: projectName || normalizedFlow?.project?.name || "URA",
          env,
          options,
        }),
      ],
      cacheHit: false,
    }));

    for (const warning of aiResult.warnings || []) store.addWarning(jobId, warning);
    const aiEnrichment =
      aiResult.analysis ||
      emptyUraAiEnrichment({
        reason: "Falha no enriquecimento por IA.",
      });

    await store.writeJson(job, "ai_enrichment.json", aiEnrichment);

    store.updateJob(jobId, {
      step: "package",
      progress: 78,
      message: "Gerando draw.io, documentacao e matrizes...",
    });

    const packageResult = await postJsonToPython({
      baseUrl: pyBase,
      endpoint: "/generate-package",
      payload: {
        normalized_flow: normalizedFlow,
        transcriptions,
        ai_enrichment: aiEnrichment,
        options,
      },
      timeoutMs,
    });
    validateNavigablePackage(normalizedFlow);

    const generatedFiles = packageResult?.files || {};
    for (const [key, value] of Object.entries(generatedFiles)) {
      if (!value?.contentBase64) continue;
      await store.writeBuffer(
        job,
        value.fileName || key,
        Buffer.from(value.contentBase64, "base64")
      );
    }

    const filesMap = {
      drawio: path.join(job.jobDir, "fluxo_ura.drawio"),
      html: path.join(job.jobDir, "documentacao_ura.html"),
      md: path.join(job.jobDir, "documentacao_ura.md"),
      zip: path.join(job.jobDir, "documentacao_ura.zip"),
      normalizedFlow: path.join(job.jobDir, "normalized_flow.json"),
      transcriptions: path.join(job.jobDir, "transcricoes.json"),
      aiEnrichment: path.join(job.jobDir, "ai_enrichment.json"),
    };

    const summary = summarizeFlow(normalizedFlow, packageResult, aiEnrichment);
    store.updateJob(jobId, {
      status: "completed",
      step: "completed",
      progress: 100,
      message: "Documentacao da URA gerada com sucesso.",
      summary,
      aiInsights: aiEnrichment,
      files: filesMap,
    });
  } catch (error) {
    await store.markFailed(jobId, error);
  }
}

export async function pipeDownload({ res, filePath, fileName, contentType }) {
  await fs.access(filePath);
  res.setHeader("Content-Type", contentType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return Readable.from(await fs.readFile(filePath)).pipe(res);
}
