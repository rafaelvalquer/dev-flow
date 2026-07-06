import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import {
  analyzeUraContext,
  buildUraAiFailureWarning,
} from "../lib/uraOpenAiAnalyzer.js";
import { organizeUraBeforeDrawio } from "../lib/uraOpenAiOrganizer.js";
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

function activityMessage(value, limit = 2000) {
  const text = String(value || "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 20)}... [truncado]`;
}

function addJobActivity(store, jobId, event) {
  if (!store?.addActivity) return;
  store.addActivity(jobId, {
    step: event.step,
    title: event.title,
    message: activityMessage(event.message, 2000),
    status: event.status || "processing",
    progress: event.progress,
    kind: event.kind || "info",
    details: event.details || null,
  });
}

function addDebugActivities(store, jobId, step, events = [], progress) {
  for (const event of events || []) {
    addJobActivity(store, jobId, {
      step,
      title: event.title,
      message: event.message,
      status: event.status || "processing",
      progress,
      kind: event.kind || "debug",
      details: event.details || null,
    });
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function buildRawActions(normalizedFlow) {
  const actions = Array.isArray(normalizedFlow?.actions) ? normalizedFlow.actions : [];
  return {
    project: {
      ...(normalizedFlow?.project || {}),
      source: "NICE Studio XML",
    },
    actions: actions.map((action) => ({
      actionId: String(action?.actionId || "").trim(),
      type: String(action?.type || "").trim(),
      caption: String(action?.caption || "").trim(),
      parameters: Array.isArray(action?.parameters) ? action.parameters : [],
      defaultNextAction: String(action?.defaultNextAction || "").trim(),
      branches: Array.isArray(action?.branches) ? action.branches : [],
      cases: Array.isArray(action?.cases) ? action.cases : [],
      x: action?.x ?? null,
      y: action?.y ?? null,
      raw: action?.raw || {},
    })),
    edges: Array.isArray(normalizedFlow?.edges) ? normalizedFlow.edges : [],
  };
}

function buildPreSemanticExtract(normalizedFlow) {
  const actions = Array.isArray(normalizedFlow?.actions) ? normalizedFlow.actions : [];
  const pickOutput = (action) => ({
    nextStep: action?.nextStep || "",
    transferCode: action?.transferCode || "",
    audio: action?.audio || "",
    scriptpoint: action?.scriptpoint || "",
    mapaDna: action?.mapaDna || "",
    skills: Array.isArray(action?.skills) ? action.skills : [],
  });
  return {
    project: normalizedFlow?.project || {},
    menus: actions
      .filter((action) => String(action?.type || "").toUpperCase() === "MENU")
      .map((action) => ({
        actionId: String(action?.actionId || ""),
        caption: action?.caption || "",
        cases: Array.isArray(action?.cases) ? action.cases : [],
        branches: Array.isArray(action?.branches) ? action.branches : [],
        prompts: (normalizedFlow?.prompts || []).filter(
          (prompt) => String(prompt?.sourceActionId || "") === String(action?.actionId || "")
        ),
      })),
    ifs: actions
      .filter((action) => String(action?.type || "").toUpperCase() === "IF")
      .map((action) => ({
        actionId: String(action?.actionId || ""),
        caption: action?.caption || "",
        branches: Array.isArray(action?.branches) ? action.branches : [],
        defaultNextAction: action?.defaultNextAction || "",
      })),
    snippets: actions
      .filter((action) => String(action?.type || "").toUpperCase() === "SNIPPET")
      .slice(0, 120)
      .map((action) => ({
        actionId: String(action?.actionId || ""),
        caption: action?.caption || "",
        output: pickOutput(action),
      })),
    prompts: Array.isArray(normalizedFlow?.prompts) ? normalizedFlow.prompts : [],
    skills: Array.isArray(normalizedFlow?.skills) ? normalizedFlow.skills : [],
    integrations: actions
      .filter((action) =>
        ["RUNSCRIPT", "RUNSUB", "REST_API", "REQAGENT", "ONANSWER", "ONRELEASE"].includes(
          String(action?.type || "").toUpperCase()
        )
      )
      .map((action) => ({
        actionId: String(action?.actionId || ""),
        type: action?.type || "",
        caption: action?.caption || "",
        output: pickOutput(action),
      })),
    edges: Array.isArray(normalizedFlow?.edges) ? normalizedFlow.edges : [],
  };
}

function buildPromptsDetected(normalizedFlow) {
  return {
    items: (Array.isArray(normalizedFlow?.prompts) ? normalizedFlow.prompts : []).map(
      (prompt) => ({
        fileName: prompt?.fileName || "",
        fullPath: prompt?.fullPath || "",
        sourceActionId: prompt?.sourceActionId || "",
        transcription: prompt?.transcription || "",
      })
    ),
  };
}

function buildAudioMatching(normalizedFlow, transcriptions) {
  const prompts = Array.isArray(normalizedFlow?.prompts) ? normalizedFlow.prompts : [];
  const items = Array.isArray(transcriptions?.items) ? transcriptions.items : [];
  const promptNames = new Set(
    prompts.map((prompt) => String(prompt?.fileName || "").toLowerCase()).filter(Boolean)
  );
  const audioNames = new Set(
    items.map((item) => String(item?.fileName || "").toLowerCase()).filter(Boolean)
  );
  const matched = prompts.map((prompt) => {
    const name = String(prompt?.fileName || "").toLowerCase();
    const audio = items.find((item) => String(item?.fileName || "").toLowerCase() === name);
    return {
      fileName: prompt?.fileName || "",
      sourceActionId: prompt?.sourceActionId || "",
      status: audio
        ? audio.status === "transcribed"
          ? "matched_transcribed"
          : "matched_failed"
        : "missing_audio",
      transcription: audio?.rawTranscription || prompt?.transcription || "",
    };
  });
  const unused = items
    .filter((item) => !promptNames.has(String(item?.fileName || "").toLowerCase()))
    .map((item) => ({
      fileName: item?.fileName || "",
      sourceActionId: "",
      status: "unused_audio",
      transcription: item?.rawTranscription || "",
    }));
  return {
    items: [...matched, ...unused],
    summary: {
      prompts: prompts.length,
      audioFiles: items.length,
      matched: matched.filter((item) => item.status.startsWith("matched")).length,
      missingAudio: matched.filter((item) => item.status === "missing_audio").length,
      unusedAudio: unused.length,
      uniquePromptFiles: promptNames.size,
      uniqueAudioFiles: audioNames.size,
    },
  };
}

function isSafeZipPath(name) {
  const normalized = String(name || "").replace(/\\/g, "/");
  return (
    normalized &&
    !normalized.startsWith("/") &&
    !normalized.includes("../") &&
    !/^[A-Za-z]:/.test(normalized)
  );
}

function readUInt16(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function extractWavFilesFromZip(buffer) {
  const files = [];
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (readUInt32(buffer, offset) === eocdSignature) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP de áudio inválido: diretório central não encontrado.");
  const totalEntries = readUInt16(buffer, eocd + 10);
  let cursor = readUInt32(buffer, eocd + 16);
  for (let index = 0; index < totalEntries; index += 1) {
    if (readUInt32(buffer, cursor) !== 0x02014b50) break;
    const method = readUInt16(buffer, cursor + 10);
    const compressedSize = readUInt32(buffer, cursor + 20);
    const fileNameLength = readUInt16(buffer, cursor + 28);
    const extraLength = readUInt16(buffer, cursor + 30);
    const commentLength = readUInt16(buffer, cursor + 32);
    const localHeaderOffset = readUInt32(buffer, cursor + 42);
    const fileName = buffer
      .subarray(cursor + 46, cursor + 46 + fileNameLength)
      .toString("utf8");
    cursor += 46 + fileNameLength + extraLength + commentLength;
    if (!/\.wav$/i.test(fileName) || !isSafeZipPath(fileName)) continue;
    if (readUInt32(buffer, localHeaderOffset) !== 0x04034b50) continue;
    const localNameLength = readUInt16(buffer, localHeaderOffset + 26);
    const localExtraLength = readUInt16(buffer, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      continue;
    }
    files.push({
      originalname: path.basename(fileName),
      buffer: data,
      mimetype: "audio/wav",
      size: data.length,
      fromZip: true,
      zipPath: fileName,
    });
  }
  return files;
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
    return readJsonResponse(response, "Falha no microserviço URA Docs.");
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `Timeout ao chamar o microserviço URA Docs em ${baseUrl}${endpoint}. Verifique se o serviço Python está ativo.`
      );
    }
    throw new Error(
      `Serviço Python STT/URA Docs offline ou inacessível em ${baseUrl}. Inicie o serviço em services/stt-python. Detalhe: ${
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
    return readJsonResponse(response, "Falha no microserviço URA Docs.");
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `Timeout ao chamar o microserviço URA Docs em ${baseUrl}${endpoint}. Verifique se o serviço Python está ativo.`
      );
    }
    throw new Error(
      `Serviço Python STT/URA Docs offline ou inacessível em ${baseUrl}. Inicie o serviço em services/stt-python. Detalhe: ${
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
      "Parser NICE não retornou actions reais. O job foi interrompido antes de transcrever áudios ou chamar IA; verifique se o XML exportado contém ActionID, Action, Caption e conexões reconhecíveis."
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
      "Parser NICE não gerou fluxo navegável. Reinicie o serviço Python ou valide o XML enviado."
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
      semanticRoutes: packageResult?.summary?.semanticRoutes || 0,
      drawioPages: packageResult?.summary?.drawioPages || 0,
      promptsDetected: packageResult?.summary?.promptsDetected || 0,
      promptsTranscribed: packageResult?.summary?.promptsTranscribed || 0,
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
    addJobActivity(store, jobId, {
      step: "saving_uploads",
      progress: 5,
      title: "Recebendo arquivos",
      message: "Salvando XML NICE e áudios enviados no storage temporário do job.",
      kind: "file",
    });

    const niceFile = files.nice_file?.[0];
    if (!niceFile) throw new Error("Arquivo NICE não enviado.");

    await store.writeBuffer(
      job,
      path.join("uploads", safeFileName(niceFile.originalname)),
      niceFile.buffer
    );

    let audioFiles = files.audio_files || [];
    for (const audio of audioFiles) {
      await store.writeBuffer(
        job,
        path.join("uploads", "audio", safeFileName(audio.originalname)),
        audio.buffer
      );
    }
    addJobActivity(store, jobId, {
      step: "saving_uploads",
      progress: 10,
      title: "Uploads salvos",
      message: `${niceFile.originalname} salvo. ${audioFiles.length} áudio(s) disponível(is) para matching/transcrição.`,
      kind: "file",
      details: {
        niceFile: niceFile.originalname,
        audioFiles: audioFiles.length,
        audioZip: files.audio_zip?.[0]?.originalname || "",
      },
    });
    if (files.audio_zip?.[0]) {
      await store.writeBuffer(
        job,
        path.join("uploads", safeFileName(files.audio_zip[0].originalname)),
        files.audio_zip[0].buffer
      );
      try {
        const zipAudios = extractWavFilesFromZip(files.audio_zip[0].buffer);
        for (const audio of zipAudios) {
          await store.writeBuffer(
            job,
            path.join("uploads", "audio", safeFileName(audio.originalname)),
            audio.buffer
          );
        }
        audioFiles = [...audioFiles, ...zipAudios];
        store.addWarning(jobId, `audio_zip extraído: ${zipAudios.length} WAV(s) adicionados para matching/transcrição.`);
      } catch (error) {
        store.addWarning(jobId, `Falha ao extrair audio_zip. A geração continuou com WAVs enviados fora do ZIP. Detalhe: ${error?.message || String(error)}`);
      }
    }

    store.updateJob(jobId, {
      step: "parse",
      progress: 18,
      message: "Executando parser determinístico NICE...",
    });
    addJobActivity(store, jobId, {
      step: "parse",
      progress: 18,
      title: "Parser NICE iniciado",
      message: "Enviando XML para o serviço Python extrair actions, conexões, menus, prompts e skills.",
      kind: "parser",
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
    addJobActivity(store, jobId, {
      step: "parse",
      progress: 28,
      title: "Parser NICE concluído",
      message: `Fluxo extraído com ${normalizedFlow?.actions?.length || 0} actions e ${normalizedFlow?.edges?.length || 0} conexões.`,
      kind: "parser",
      details: {
        actions: normalizedFlow?.actions?.length || 0,
        edges: normalizedFlow?.edges?.length || 0,
        menus: normalizedFlow?.menus?.length || 0,
        prompts: normalizedFlow?.prompts?.length || 0,
      },
    });

    store.updateJob(jobId, {
      step: "transcription",
      progress: 35,
      message: "Transcrevendo áudios enviados...",
    });
    addJobActivity(store, jobId, {
      step: "transcription",
      progress: 35,
      title: "Transcrição local iniciada",
      message: audioFiles.length
        ? `Processando ${audioFiles.length} áudio(s) no Python local.`
        : "Nenhum áudio enviado; usando apenas nomes de prompts do XML.",
      kind: "audio",
    });

    const transcriptionItems = [];
    for (const [index, file] of audioFiles.entries()) {
      const audioProgress =
        35 + Math.round(((index + 1) / Math.max(audioFiles.length, 1)) * 18);
      store.updateJob(jobId, {
        step: "transcription",
        progress: Math.min(audioProgress, 53),
        message: `Transcrevendo áudio localmente ${index + 1} de ${
          audioFiles.length
        }: ${file.originalname}`,
      });
      const item = await transcribeAudioFile({ file, pyBase, timeoutMs: sttTimeoutMs });
      transcriptionItems.push(item);
      addJobActivity(store, jobId, {
        step: "transcription",
        progress: Math.min(audioProgress, 53),
        title: item.status === "failed" ? "Falha na transcrição" : "Áudio transcrito",
        message: `${file.originalname}: ${item.status || "processado"}`,
        kind: item.status === "failed" ? "warning" : "audio",
        details: {
          fileName: file.originalname,
          status: item.status,
          error: item.error || "",
        },
      });
      if (item.status === "failed") {
        store.addWarning(jobId, `Falha ao transcrever ${file.originalname}: ${item.error}`);
      }
    }
    const transcriptions = { items: transcriptionItems };
    normalizedFlow = matchPromptsWithAudio(normalizedFlow, transcriptions);
    const rawActions = buildRawActions(normalizedFlow);
    const preSemanticExtract = buildPreSemanticExtract(normalizedFlow);
    const promptsDetected = buildPromptsDetected(normalizedFlow);
    const audioMatching = buildAudioMatching(normalizedFlow, transcriptions);

    await store.writeJson(job, "01_raw_actions.json", rawActions);
    await store.writeJson(job, "02_pre_semantic_extract.json", preSemanticExtract);
    await store.writeJson(job, "normalized_flow.json", normalizedFlow);
    await store.writeJson(job, "prompts_detected.json", promptsDetected);
    await store.writeJson(job, "audio_matching.json", audioMatching);
    await store.writeJson(job, "transcricoes.json", transcriptions);

    store.updateJob(jobId, {
      step: "ai_organizer",
      progress: 55,
      message: "Organizando semanticamente o fluxo antes do draw.io...",
    });
    addJobActivity(store, jobId, {
      step: "ai_organizer",
      progress: 55,
      title: "Organização semântica iniciada",
      message: "Preparando uma leitura funcional do XML antes de montar o draw.io.",
      kind: "ai",
    });

    const organizerResult = await organizeUraBeforeDrawio({
      rawActions,
      preSemanticExtract,
      transcriptions,
      projectName: projectName || normalizedFlow?.project?.name || "URA",
      options,
      env,
    });
    addDebugActivities(store, jobId, "ai_organizer", organizerResult.debugEvents, 56);
    for (const warning of organizerResult.warnings || []) store.addWarning(jobId, warning);
    await store.writeJson(job, "03_ai_organizer.json", organizerResult.organizer);
    addJobActivity(store, jobId, {
      step: "ai_organizer",
      progress: 57,
      title: organizerResult.fallback ? "Organizador determinístico aplicado" : "Organização semântica concluída",
      message: organizerResult.fallback
        ? "A IA não foi usada ou falhou; a organização continuou pelo fallback determinístico."
        : "A IA retornou labels/contextos para melhorar a leitura do fluxo.",
      kind: organizerResult.fallback ? "fallback" : "ai",
      details: {
        cacheHit: organizerResult.cacheHit,
        fallback: organizerResult.fallback,
      },
    });

    store.updateJob(jobId, {
      step: "ai_enrichment",
      progress: 58,
      message: "Analisando contexto funcional da URA com OpenAI...",
    });
    addJobActivity(store, jobId, {
      step: "ai_enrichment",
      progress: 58,
      title: "Análise IA iniciada",
      message: "Solicitando resumo funcional, regras, testes e runbook quando a IA estiver habilitada.",
      kind: "ai",
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
      debugEvents: [
        {
          kind: "ai_error",
          title: "Erro inesperado no backend",
          message: error?.message || String(error),
          details: { stage: "erro_inesperado_backend" },
        },
      ],
    }));

    addDebugActivities(store, jobId, "ai_enrichment", aiResult.debugEvents, 64);
    for (const warning of aiResult.warnings || []) store.addWarning(jobId, warning);
    const aiEnrichment =
      aiResult.analysis ||
      emptyUraAiEnrichment({
        reason: "Falha no enriquecimento por IA.",
      });
    aiEnrichment.organizer = organizerResult.organizer;

    await store.writeJson(job, "ai_enrichment.json", aiEnrichment);
    addJobActivity(store, jobId, {
      step: "ai_enrichment",
      progress: 72,
      title: aiResult.cacheHit ? "Análise IA recuperada do cache" : "Análise funcional consolidada",
      message: aiResult.analysis
        ? "Resumo funcional, regras, testes e runbook preparados para o pacote."
        : "A geração continuou com resumo determinístico.",
      kind: aiResult.cacheHit ? "cache" : "ai",
      details: {
        cacheHit: aiResult.cacheHit,
        warnings: aiResult.warnings?.length || 0,
      },
    });

    store.updateJob(jobId, {
      step: "package",
      progress: 78,
      message: "Gerando draw.io, documentação e matrizes...",
    });
    addJobActivity(store, jobId, {
      step: "package",
      progress: 78,
      title: "Geração do pacote iniciada",
      message: "Enviando fluxo normalizado, transcrições e enriquecimento para gerar draw.io, HTML, Markdown e matrizes.",
      kind: "package",
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
    addJobActivity(store, jobId, {
      step: "package",
      progress: 88,
      title: "Pacote recebido do Python",
      message: "Arquivos gerados em memória; salvando artefatos finais no storage do job.",
      kind: "package",
      details: {
        files: Object.keys(packageResult?.files || {}),
      },
    });

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
      rawActions: path.join(job.jobDir, "01_raw_actions.json"),
      preSemanticExtract: path.join(job.jobDir, "02_pre_semantic_extract.json"),
      aiOrganizer: path.join(job.jobDir, "03_ai_organizer.json"),
      humanRoutes: path.join(job.jobDir, "04_human_routes.json"),
      drawioPlan: path.join(job.jobDir, "05_drawio_plan.json"),
    };

    const summary = summarizeFlow(normalizedFlow, packageResult, aiEnrichment);
    store.updateJob(jobId, {
      status: "completed",
      step: "completed",
      progress: 100,
      message: "Documentação da URA gerada com sucesso.",
      summary,
      aiInsights: aiEnrichment,
      files: filesMap,
    });
    addJobActivity(store, jobId, {
      step: "completed",
      progress: 100,
      title: "Documentação concluída",
      message: "Draw.io, documentação e matrizes foram gerados com sucesso.",
      status: "completed",
      kind: "success",
      details: summary,
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
