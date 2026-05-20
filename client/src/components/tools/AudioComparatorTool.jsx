import React, { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileAudio,
  FileSearch,
  Loader2,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";

const SAMPLE_SCRIPT = `Pos_AparelhoOuBL_INI | Se voce quer falar sobre a compra de um celular ou modem, digita 1. Pra Multi com banda larga, TV, telefone fixo e celular, 2. Acompanhar pedido ou ativar equipamento? E o 3. Ou, pra falar com um atendente, digita 9.
Pos_AparelhoOuBL_REJ1 | Desculpa, nao entendi. Vou repetir pra voce: quer falar sobre alguma compra de aparelho ou modem? Digita 1.
Pos_AparelhoOuBL_SIL1 | Oi, voce ta ai? Vou repetir: quer falar sobre alguma compra de aparelho ou modem? Digita 1.`;

const STATUS_META = {
  approved: {
    label: "Aprovado",
    className: "border-green-200 bg-green-50 text-green-700",
    rank: 5,
  },
  attention: {
    label: "Atencao",
    className: "border-amber-200 bg-amber-50 text-amber-800",
    rank: 2,
  },
  divergent: {
    label: "Divergente",
    className: "border-red-200 bg-red-50 text-red-700",
    rank: 1,
  },
  missing_script: {
    label: "Sem roteiro",
    className: "border-violet-200 bg-violet-50 text-violet-700",
    rank: 3,
  },
  missing_audio: {
    label: "Sem audio",
    className: "border-blue-200 bg-blue-50 text-blue-700",
    rank: 4,
  },
  pending: {
    label: "Pendente",
    className: "border-zinc-200 bg-zinc-50 text-zinc-700",
    rank: 6,
  },
  processing: {
    label: "Transcrevendo",
    className: "border-zinc-200 bg-zinc-50 text-zinc-700",
    rank: 0,
  },
  error: {
    label: "Erro",
    className: "border-red-200 bg-red-50 text-red-700",
    rank: 0,
  },
};

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function stripExtension(value = "") {
  return String(value || "").replace(/\.[^/.]+$/i, "");
}

function normalizeKey(value = "") {
  return stripExtension(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value = "") {
  return normalizeText(value)
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseScriptLines(value = "") {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      let parts = line.split(/\t+/);
      if (parts.length < 2) parts = line.split(/\s+\|\s+|\|/);
      if (parts.length < 2) parts = line.split(/\s*;\s*/);

      const rawName = String(parts.shift() || "").trim();
      const expectedText = parts.join(parts.length > 1 ? " " : "").trim();
      const key = normalizeKey(rawName);

      if (!rawName || !expectedText || !key) return null;

      return {
        id: `script-${index}-${key}`,
        key,
        name: stripExtension(rawName),
        expectedText,
      };
    })
    .filter(Boolean);
}

function levenshtein(a = "", b = "") {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }

  return prev[b.length];
}

function similarityPercent(expected = "", actual = "") {
  const a = normalizeText(expected);
  const b = normalizeText(actual);
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  return Math.max(0, Math.round((1 - levenshtein(a, b) / max) * 100));
}

function statusFromScore(score) {
  if (score >= 90) return "approved";
  if (score >= 75) return "attention";
  return "divergent";
}

function summarizeDiff(expected = "", actual = "") {
  const expectedTokens = tokenize(expected);
  const actualTokens = tokenize(actual);
  const actualCounts = new Map();
  const expectedCounts = new Map();

  actualTokens.forEach((token) => actualCounts.set(token, (actualCounts.get(token) || 0) + 1));
  expectedTokens.forEach((token) =>
    expectedCounts.set(token, (expectedCounts.get(token) || 0) + 1),
  );

  const missing = [];
  for (const token of expectedTokens) {
    const count = actualCounts.get(token) || 0;
    if (count > 0) actualCounts.set(token, count - 1);
    else if (!missing.includes(token)) missing.push(token);
  }

  const extra = [];
  for (const token of actualTokens) {
    const count = expectedCounts.get(token) || 0;
    if (count > 0) expectedCounts.set(token, count - 1);
    else if (!extra.includes(token)) extra.push(token);
  }

  return {
    missing: missing.slice(0, 10),
    extra: extra.slice(0, 10),
  };
}

function safeRevokeObjectUrl(url) {
  try {
    if (url) URL.revokeObjectURL(url);
  } catch {}
}

function escapeCsv(value = "") {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadTextFile(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function buildEvidence(row) {
  const score = typeof row.score === "number" ? `${row.score}%` : "-";
  return [
    `### ${row.name}`,
    `Status: ${STATUS_META[row.status]?.label || row.status}`,
    `Aderencia: ${score}`,
    "",
    "**Texto esperado**",
    row.expectedText || "-",
    "",
    "**Transcricao**",
    row.transcript || "-",
  ].join("\n");
}

function statusBadge(status) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  return <Badge className={cn("border", meta.className)}>{meta.label}</Badge>;
}

export default function AudioComparatorTool({ serviceOnline = true }) {
  const fileInputRef = useRef(null);
  const filesRef = useRef([]);
  const [scriptText, setScriptText] = useState("");
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(
    () => () => {
      filesRef.current.forEach((item) => safeRevokeObjectUrl(item.url));
    },
    [],
  );

  const scriptRows = useMemo(() => parseScriptLines(scriptText), [scriptText]);

  const filesByKey = useMemo(() => {
    const map = new Map();
    files.forEach((item) => {
      if (!map.has(item.key)) map.set(item.key, item);
    });
    return map;
  }, [files]);

  const rows = useMemo(() => {
    const scripted = scriptRows.map((script) => {
      const fileItem = filesByKey.get(script.key) || null;
      const result = results[script.key] || {};
      const score =
        typeof result.score === "number"
          ? result.score
          : result.transcript
            ? similarityPercent(script.expectedText, result.transcript)
            : null;
      const status = !fileItem
        ? "missing_audio"
        : result.status === "processing"
          ? "processing"
          : result.status === "error"
            ? "error"
            : result.transcript
              ? statusFromScore(score)
              : "pending";

      return {
        id: script.id,
        key: script.key,
        name: fileItem?.name || script.name,
        file: fileItem?.file || null,
        fileUrl: fileItem?.url || "",
        expectedText: script.expectedText,
        transcript: result.transcript || "",
        score,
        status,
        error: result.error || "",
        diff: summarizeDiff(script.expectedText, result.transcript || ""),
      };
    });

    const scriptedKeys = new Set(scriptRows.map((item) => item.key));
    const orphans = files
      .filter((item) => !scriptedKeys.has(item.key))
      .map((item) => ({
        id: `file-${item.id}`,
        key: item.key,
        name: item.name,
        file: item.file,
        fileUrl: item.url,
        expectedText: "",
        transcript: "",
        score: null,
        status: "missing_script",
        error: "",
        diff: { missing: [], extra: [] },
      }));

    return [...scripted, ...orphans].sort((a, b) => {
      const ar = STATUS_META[a.status]?.rank ?? 9;
      const br = STATUS_META[b.status]?.rank ?? 9;
      return ar - br || a.name.localeCompare(b.name);
    });
  }, [files, filesByKey, results, scriptRows]);

  const totals = useMemo(() => {
    const count = (status) => rows.filter((row) => row.status === status).length;
    return {
      total: rows.length,
      approved: count("approved"),
      attention: count("attention"),
      divergent: count("divergent"),
      missingScript: count("missing_script"),
      missingAudio: count("missing_audio"),
      pending: count("pending"),
    };
  }, [rows]);

  const markdownEvidence = useMemo(() => rows.map(buildEvidence).join("\n\n---\n\n"), [rows]);

  function onPickFiles(event) {
    const picked = Array.from(event?.target?.files || []);
    if (!picked.length) return;

    const next = picked.map((file) => ({
      id: uid(),
      key: normalizeKey(file.name),
      name: file.name,
      file,
      url: URL.createObjectURL(file),
    }));

    setFiles((prev) => [...next, ...prev]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function clearAll() {
    files.forEach((item) => safeRevokeObjectUrl(item.url));
    setFiles([]);
    setResults({});
    setRunning(false);
  }

  async function transcribeRow(row) {
    if (!row?.file || !row.expectedText) return;
    setResults((prev) => ({
      ...prev,
      [row.key]: { status: "processing", transcript: "", score: null, error: "" },
    }));

    try {
      const form = new FormData();
      form.append("file", row.file);

      const response = await fetch("/api/stt/transcribe", {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const data = await response.json();
          message = data?.error || data?.detail || data?.message || message;
        } catch {}
        throw new Error(message);
      }

      const data = await response.json();
      const transcript = String(data?.text || "").trim();
      const score = similarityPercent(row.expectedText, transcript);

      setResults((prev) => ({
        ...prev,
        [row.key]: {
          status: "done",
          transcript,
          score,
          error: "",
          audio: data?.audio || null,
        },
      }));
    } catch (error) {
      setResults((prev) => ({
        ...prev,
        [row.key]: {
          status: "error",
          transcript: "",
          score: null,
          error: String(error?.message || error),
        },
      }));
    }
  }

  async function compareAll() {
    const comparable = rows.filter(
      (row) => row.file && row.expectedText && row.status !== "processing",
    );
    if (!comparable.length || running || !serviceOnline) return;

    setRunning(true);
    for (const row of comparable) {
      // eslint-disable-next-line no-await-in-loop
      await transcribeRow(row);
    }
    setRunning(false);
  }

  function copyEvidence(row) {
    navigator.clipboard?.writeText(buildEvidence(row)).catch(() => {});
  }

  function copyMarkdown() {
    navigator.clipboard?.writeText(markdownEvidence).catch(() => {});
  }

  function exportCsv() {
    const header = ["arquivo", "status", "aderencia", "esperado", "transcrito"];
    const lines = rows.map((row) =>
      [
        row.name,
        STATUS_META[row.status]?.label || row.status,
        typeof row.score === "number" ? `${row.score}%` : "",
        row.expectedText,
        row.transcript,
      ]
        .map(escapeCsv)
        .join(";"),
    );

    downloadTextFile(
      `comparacao_audio_ura_${new Date().toISOString().slice(0, 10)}.csv`,
      ["\ufeff" + header.join(";"), ...lines].join("\n"),
      "text/csv;charset=utf-8",
    );
  }

  const canCompare = rows.some((row) => row.file && row.expectedText);

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <FileSearch className="h-4 w-4 text-red-600" />
              Comparador de Audio URA
            </div>
            <div className="mt-1 max-w-3xl text-xs text-zinc-600">
              Cole o roteiro aprovado, envie os audios e compare a transcricao
              automaticamente pelo nome do arquivo.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
              {totals.total} itens
            </Badge>
            <Badge className="border border-green-200 bg-green-50 text-green-700">
              {totals.approved} aprovados
            </Badge>
            <Badge className="border border-amber-200 bg-amber-50 text-amber-800">
              {totals.attention} atencao
            </Badge>
            <Badge className="border border-red-200 bg-red-50 text-red-700">
              {totals.divergent} divergentes
            </Badge>
          </div>
        </div>

        {!serviceOnline ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Servico STT offline. Suba o servico Python para transcrever e comparar
            os audios.
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900">
                Roteiro aprovado
              </div>
              <div className="mt-1 text-xs text-zinc-600">
                Use uma linha por audio: <b>nome_do_audio | texto esperado</b>.
                Colagem de planilha com tab tambem funciona.
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setScriptText(SAMPLE_SCRIPT)}
            >
              Exemplo
            </Button>
          </div>

          <textarea
            value={scriptText}
            onChange={(event) => setScriptText(event.target.value)}
            placeholder="Pos_AparelhoOuBL_INI | Se voce quer falar sobre a compra..."
            className="mt-3 min-h-[220px] w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-900 outline-none focus:ring-2 focus:ring-red-500"
          />

          <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
            <span>{scriptRows.length} linhas validas</span>
            <span>{totals.missingAudio} sem audio</span>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-semibold text-zinc-900">
            Arquivos de audio
          </div>
          <div className="mt-1 text-xs text-zinc-600">
            Envie os arquivos WAV, MP3, OGG ou M4A. O pareamento ignora extensao,
            acentos e pontuacao no nome.
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.ogg,.m4a"
            multiple
            className="hidden"
            onChange={onPickFiles}
          />

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-800"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Adicionar audios
            </Button>

            <Button
              type="button"
              className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              onClick={compareAll}
              disabled={!canCompare || running || !serviceOnline}
            >
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileSearch className="mr-2 h-4 w-4" />
              )}
              Comparar todos
            </Button>

            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={clearAll}
              disabled={!files.length || running}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Limpar audios
            </Button>
          </div>

          <div className="mt-4 grid gap-2">
            {!files.length ? (
              <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-5 text-center text-sm text-zinc-600">
                Nenhum audio selecionado.
              </div>
            ) : (
              files.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="flex min-w-0 items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
                >
                  <FileAudio className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="truncate font-medium text-zinc-800">
                    {item.name}
                  </span>
                </div>
              ))
            )}
            {files.length > 8 ? (
              <div className="text-xs text-zinc-500">
                +{files.length - 8} audio(s) adicionais
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-900">
              Resultado da comparacao
            </div>
            <div className="mt-1 text-xs text-zinc-600">
              Excecoes aparecem primeiro para reduzir a escuta manual.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={exportCsv}
              disabled={!rows.length}
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={copyMarkdown}
              disabled={!rows.length}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar Markdown
            </Button>
          </div>
        </div>

        {!rows.length ? (
          <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center text-sm text-zinc-600">
            Cole o roteiro e adicione os audios para montar a matriz de validacao.
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            {rows.map((row) => {
              const hasDiff =
                row.status === "attention" || row.status === "divergent";

              return (
                <div
                  key={row.id}
                  className={cn(
                    "rounded-2xl border p-4",
                    row.status === "approved" && "border-green-200 bg-green-50/40",
                    row.status === "attention" && "border-amber-200 bg-amber-50/40",
                    row.status === "divergent" && "border-red-200 bg-red-50/40",
                    !["approved", "attention", "divergent"].includes(row.status) &&
                      "border-zinc-200 bg-white",
                  )}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-zinc-900">
                          {row.name}
                        </div>
                        {statusBadge(row.status)}
                        {typeof row.score === "number" ? (
                          <Badge className="border border-zinc-200 bg-white text-zinc-700">
                            {row.score}% aderencia
                          </Badge>
                        ) : null}
                      </div>

                      {row.error ? (
                        <div className="mt-2 flex items-start gap-2 text-xs text-red-700">
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{row.error}</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {row.fileUrl ? (
                        <audio src={row.fileUrl} controls className="h-9 max-w-[260px]" />
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl"
                        onClick={() => copyEvidence(row)}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Evidencia
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-semibold text-zinc-600">
                        Texto esperado
                      </div>
                      <div className="min-h-[92px] rounded-xl border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-800">
                        {row.expectedText || "Sem roteiro vinculado a este arquivo."}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-semibold text-zinc-600">
                        Transcricao
                      </div>
                      <div className="min-h-[92px] rounded-xl border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-800">
                        {row.status === "processing" ? (
                          <span className="inline-flex items-center gap-2 text-zinc-600">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Transcrevendo audio...
                          </span>
                        ) : row.transcript ? (
                          row.transcript
                        ) : row.status === "missing_audio" ? (
                          "Sem arquivo de audio correspondente."
                        ) : row.status === "missing_script" ? (
                          "Arquivo sem texto esperado no roteiro."
                        ) : (
                          "Aguardando comparacao."
                        )}
                      </div>
                    </div>
                  </div>

                  {hasDiff ? (
                    <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-700">
                      <div className="mb-2 flex items-center gap-2 font-semibold text-zinc-900">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        Principais diferencas
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <div>
                          <div className="mb-1 font-semibold">Faltando na fala</div>
                          <div className="flex flex-wrap gap-1.5">
                            {row.diff.missing.length ? (
                              row.diff.missing.map((token) => (
                                <span
                                  key={`missing-${token}`}
                                  className="rounded-full bg-red-50 px-2 py-1 text-red-700"
                                >
                                  {token}
                                </span>
                              ))
                            ) : (
                              <span className="text-zinc-500">Nenhum termo evidente.</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 font-semibold">Extra na fala</div>
                          <div className="flex flex-wrap gap-1.5">
                            {row.diff.extra.length ? (
                              row.diff.extra.map((token) => (
                                <span
                                  key={`extra-${token}`}
                                  className="rounded-full bg-amber-50 px-2 py-1 text-amber-800"
                                >
                                  {token}
                                </span>
                              ))
                            ) : (
                              <span className="text-zinc-500">Nenhum termo evidente.</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : row.status === "approved" ? (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-xs font-semibold text-green-700">
                      <CheckCircle2 className="h-4 w-4" />
                      Conteudo transcrito compativel com o roteiro aprovado.
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
