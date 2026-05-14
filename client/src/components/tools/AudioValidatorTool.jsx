import React, { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileAudio,
  Loader2,
  RefreshCcw,
  Trash2,
  Upload,
  Wand2,
  XCircle,
} from "lucide-react";

const TARGET_LABEL = "WAV U-law 8k mono";

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function fmtSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n.toFixed(n >= 10 ? 1 : 2)}s`;
}

function fmtDb(value) {
  return typeof value === "number" ? `${value.toFixed(1)} dB` : "-";
}

function baseName(name = "audio") {
  return String(name).replace(/\.[^/.]+$/i, "");
}

function buildConvertedFilename(originalName) {
  return `${baseName(originalName || "audio")}.wav`;
}

function ensureUniqueFilename(name, used) {
  let final = name || "audio.wav";
  let i = 1;
  while (used.has(final)) {
    const extMatch = final.match(/(\.[^/.]+)$/);
    const ext = extMatch ? extMatch[1] : "";
    const stem = ext ? final.slice(0, -ext.length) : final;
    final = `${stem} (${i})${ext}`;
    i += 1;
  }
  used.add(final);
  return final;
}

function safeRevokeObjectUrl(url) {
  try {
    if (url) URL.revokeObjectURL(url);
  } catch {}
}

async function postFile(url, file) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(url, { method: "POST", body: form });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      message = data?.error || data?.detail || message;
    } catch {
      try {
        message = (await response.text()) || message;
      } catch {}
    }
    throw new Error(message);
  }
  return response;
}

function statusBadge(item) {
  const hasIssues = (item.analysis?.issues || []).length > 0;
  if (item.status === "error" || item.convertStatus === "error") {
    return <Badge className="border border-red-200 bg-red-50 text-red-700">Erro</Badge>;
  }
  if (item.convertStatus === "converted") {
    return (
      <Badge className="border border-blue-200 bg-blue-50 text-blue-700">
        Convertido
      </Badge>
    );
  }
  if (item.status === "done" && item.analysis?.matches_target && !hasIssues) {
    return (
      <Badge className="border border-green-200 bg-green-50 text-green-700">
        OK NICE
      </Badge>
    );
  }
  if (item.status === "done") {
    return (
      <Badge className="border border-amber-200 bg-amber-50 text-amber-800">
        Corrigir
      </Badge>
    );
  }
  if (item.status === "analyzing" || item.convertStatus === "converting") {
    return (
      <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
        Processando
      </Badge>
    );
  }
  return <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">Na fila</Badge>;
}

export default function AudioValidatorTool({ serviceOnline = true }) {
  const fileInputRef = useRef(null);
  const [items, setItems] = useState([]);
  const itemsRef = useRef(items);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => safeRevokeObjectUrl(item.convertedUrl));
    };
  }, []);

  const totals = useMemo(() => {
    const total = items.length;
    const done = items.filter((item) => item.status === "done").length;
    const ok = items.filter((item) => item.analysis?.matches_target).length;
    const fix = items.filter(
      (item) => item.status === "done" && !item.analysis?.matches_target
    ).length;
    const converted = items.filter((item) => item.convertStatus === "converted").length;
    return { total, done, ok, fix, converted };
  }, [items]);

  const convertCandidates = useMemo(
    () =>
      items.filter(
        (item) =>
          item.status === "done" &&
          !item.analysis?.matches_target &&
          item.convertStatus !== "converting"
      ),
    [items]
  );

  const convertedItems = useMemo(
    () => items.filter((item) => item.convertStatus === "converted" && item.convertedBlob),
    [items]
  );

  function setItem(id, patch) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function onPickFiles(event) {
    const files = Array.from(event?.target?.files || []);
    if (!files.length) return;
    const next = files.map((file) => ({
      id: uid(),
      file,
      status: "queued",
      analysis: null,
      error: null,
      convertStatus: "idle",
      convertedBlob: null,
      convertedUrl: null,
      convertedFileName: null,
      convertedSummary: null,
    }));
    setItems((prev) => [...next, ...prev]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function clearAll() {
    items.forEach((item) => safeRevokeObjectUrl(item.convertedUrl));
    setItems([]);
    setRunning(false);
  }

  async function analyzeOne(id) {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item?.file) return;
    setItem(id, { status: "analyzing", error: null });
    try {
      const response = await postFile("/api/stt/analyze", item.file);
      const analysis = await response.json();
      setItem(id, { status: "done", analysis, error: null });
    } catch (error) {
      setItem(id, {
        status: "error",
        error: String(error?.message || error),
      });
    }
  }

  async function analyzeAll() {
    const scope = items.filter((item) => item.status === "queued" || item.status === "error");
    if (!scope.length || running) return;
    setRunning(true);
    for (const item of scope) {
      // eslint-disable-next-line no-await-in-loop
      await analyzeOne(item.id);
    }
    setRunning(false);
  }

  async function convertOne(id) {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item?.file) return;
    if (item.convertedUrl) safeRevokeObjectUrl(item.convertedUrl);
    setItem(id, { convertStatus: "converting", convertError: null });
    try {
      const response = await postFile("/api/stt/convert", item.file);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setItem(id, {
        convertStatus: "converted",
        convertedBlob: blob,
        convertedUrl: url,
        convertedFileName: buildConvertedFilename(item.file.name),
        convertedSummary: response.headers.get("x-audio-summary"),
        convertError: null,
      });
    } catch (error) {
      setItem(id, {
        convertStatus: "error",
        convertError: String(error?.message || error),
      });
    }
  }

  async function convertAllOutOfSpec() {
    if (!convertCandidates.length || running) return;
    setRunning(true);
    for (const item of convertCandidates) {
      // eslint-disable-next-line no-await-in-loop
      await convertOne(item.id);
    }
    setRunning(false);
  }

  async function downloadConvertedZip() {
    if (!convertedItems.length) return;
    const zip = new JSZip();
    const used = new Set();
    for (const item of convertedItems) {
      zip.file(
        ensureUniqueFilename(item.convertedFileName, used),
        item.convertedBlob
      );
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audios_nice_${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-900">
              Validador de Áudios URA
            </div>
            <div className="text-xs text-zinc-600">
              Valide arquivos em massa no padrão {TARGET_LABEL} e converta os itens fora do padrão.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
              {totals.total} arquivos
            </Badge>
            <Badge className="border border-green-200 bg-green-50 text-green-700">
              {totals.ok} OK
            </Badge>
            <Badge className="border border-amber-200 bg-amber-50 text-amber-800">
              {totals.fix} corrigir
            </Badge>
            <Badge className="border border-blue-200 bg-blue-50 text-blue-700">
              {totals.converted} convertidos
            </Badge>
          </div>
        </div>

        {!serviceOnline && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Serviço STT offline. Suba o serviço Python para validar e converter áudios.
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.ogg,.m4a"
            multiple
            className="hidden"
            onChange={onPickFiles}
          />
          <Button
            type="button"
            className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-800"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            Adicionar áudios
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={analyzeAll}
            disabled={!items.length || running || !serviceOnline}
          >
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="mr-2 h-4 w-4" />
            )}
            Validar todos
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={convertAllOutOfSpec}
            disabled={!convertCandidates.length || running || !serviceOnline}
          >
            <Wand2 className="mr-2 h-4 w-4" />
            Converter fora do padrão
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={downloadConvertedZip}
            disabled={!convertedItems.length}
          >
            <Download className="mr-2 h-4 w-4" />
            Baixar ZIP convertido
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={clearAll}
            disabled={!items.length || running}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Limpar
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="grid grid-cols-[minmax(220px,1.2fr)_110px_1.4fr_160px] gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-600">
          <div>Arquivo</div>
          <div>Status</div>
          <div>Dados técnicos</div>
          <div>Ações</div>
        </div>

        {!items.length ? (
          <div className="p-8 text-center text-sm text-zinc-600">
            Adicione arquivos de áudio para começar a validação.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {items.map((item) => {
              const metadata = item.analysis?.metadata;
              const issues = item.analysis?.issues || [];
              return (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(220px,1.2fr)_110px_1.4fr_160px] gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold text-zinc-900">
                      <FileAudio className="h-4 w-4 shrink-0 text-zinc-500" />
                      <span className="truncate">{item.file?.name}</span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {metadata?.duration_sec ? fmtSeconds(metadata.duration_sec) : "Aguardando análise"}
                    </div>
                  </div>

                  <div>{statusBadge(item)}</div>

                  <div className="min-w-0">
                    {metadata ? (
                      <div className="grid gap-2">
                        <div className="flex flex-wrap gap-1.5 text-xs text-zinc-600">
                          <span className="rounded-full bg-zinc-100 px-2 py-1">
                            {metadata.format_name || "-"}
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-1">
                            {metadata.codec || "-"}
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-1">
                            {metadata.sample_rate_hz || 0} Hz
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-1">
                            {metadata.channel_layout || "-"}
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-1">
                            {metadata.bit_rate_kbps || 0} kbps
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-1">
                            média {fmtDb(metadata.volume?.mean_db)}
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-1">
                            pico {fmtDb(metadata.volume?.max_db)}
                          </span>
                        </div>
                        {issues.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {issues.map((issue) => (
                              <span
                                key={issue.code}
                                title={issue.detail}
                                className={cn(
                                  "rounded-full border px-2 py-1 text-xs font-semibold",
                                  issue.severity === "error"
                                    ? "border-red-200 bg-red-50 text-red-700"
                                    : "border-amber-200 bg-amber-50 text-amber-800"
                                )}
                              >
                                {issue.label}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-xs font-semibold text-green-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Sem problemas detectados
                          </div>
                        )}
                      </div>
                    ) : item.error || item.convertError ? (
                      <div className="flex items-start gap-2 text-xs text-red-700">
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{item.error || item.convertError}</span>
                      </div>
                    ) : (
                      <div className="text-xs text-zinc-500">
                        Clique em validar para ler metadados, volume e silêncio.
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => analyzeOne(item.id)}
                      disabled={running || !serviceOnline || item.status === "analyzing"}
                    >
                      Analisar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => convertOne(item.id)}
                      disabled={running || !serviceOnline || item.convertStatus === "converting"}
                    >
                      Converter
                    </Button>
                    {item.convertedUrl && (
                      <a
                        href={item.convertedUrl}
                        download={item.convertedFileName}
                        className="inline-flex h-9 items-center rounded-xl border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                      >
                        Baixar
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {items.some((item) => item.status === "done" && !item.analysis?.matches_target) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>
              Arquivos marcados como corrigir podem ser convertidos em massa para {TARGET_LABEL}.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
