// src/components/tools/AudioTranscriptionTool.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TooltipProvider,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  Mic,
  FileAudio,
  Upload,
  Copy,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Download,
  Repeat2,
} from "lucide-react";

const TARGET_AUDIO_LABEL = "U-law, 8000hz, 64kbps, mono";

/* =========================
   Helpers (todos aqui)
========================= */
function fmtKB(bytes = 0) {
  const kb = Math.max(1, Math.round(bytes / 1024));
  if (kb < 1024) return `${kb} KB`;
  const mb = (kb / 1024).toFixed(2);
  return `${mb} MB`;
}

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isTargetAudio(audio) {
  if (!audio) return null;
  if (typeof audio.matches_target === "boolean") return audio.matches_target;

  const codecOk = norm(audio.codec) === "ulaw" || norm(audio.codec) === "mulaw";
  const srOk = Number(audio.sample_rate_hz) === 8000;
  const brOk = Number(audio.bit_rate_kbps) === 64;
  const chOk = norm(audio.channel_layout) === "mono";
  return codecOk && srOk && brOk && chOk;
}

function safeRevokeObjectUrl(u) {
  try {
    if (u) URL.revokeObjectURL(u);
  } catch {}
}

function baseName(fileName = "audio") {
  return String(fileName).replace(/\.[^/.]+$/i, "");
}

function buildConvertedFilename(originalName) {
  return `${baseName(originalName)}.wav`;
}

function ensureUniqueFilename(name, used) {
  let final = name || "audio.wav";
  let i = 1;

  while (used.has(final)) {
    const m = final.match(/(\.[^/.]+)$/);
    const ext = m ? m[1] : "";
    const b = ext ? final.slice(0, -ext.length) : final;
    final = `${b} (${i})${ext}`;
    i += 1;
  }

  used.add(final);
  return final;
}

/**
 * Item:
 * {
 *  id, file,
 *  status: queued|uploading|done|error,
 *  progress,
 *  result, error,
 *  convertStatus: idle|converting|converted|error,
 *  convertProgress,
 *  convertError,
 *  convertedUrl,
 *  convertedFileName,
 *  convertedSummary,
 *  convertedMatchesTarget,
 *  convertedBlob
 * }
 */
export default function AudioTranscriptionTool() {
  const fileInputRef = useRef(null);

  const [audios, setAudios] = useState([]);
  const audiosRef = useRef([]);
  useEffect(() => {
    audiosRef.current = audios;
  }, [audios]);

  const [language, setLanguage] = useState("pt-BR");

  // Overlay / progresso (transcrição e conversão)
  const [running, setRunning] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [busyMode, setBusyMode] = useState(null); // "transcribe" | "convert"
  const [busyScope, setBusyScope] = useState([]); // ids envolvidos
  const [busyPct, setBusyPct] = useState(0);

  const totals = useMemo(() => {
    const total = audios.length;
    const done = audios.filter((a) => a.status === "done").length;
    const err = audios.filter((a) => a.status === "error").length;
    const uploading = audios.filter((a) => a.status === "uploading").length;
    const queued = audios.filter((a) => a.status === "queued").length;

    const convConverting = audios.filter(
      (a) => a.convertStatus === "converting"
    ).length;
    const convConverted = audios.filter(
      (a) => a.convertStatus === "converted"
    ).length;
    const convErr = audios.filter((a) => a.convertStatus === "error").length;

    return {
      total,
      done,
      err,
      uploading,
      queued,
      convConverting,
      convConverted,
      convErr,
    };
  }, [audios]);

  const outOfSpecCount = useMemo(() => {
    return audios.filter((a) => {
      if (a.status !== "done") return false;
      const match = isTargetAudio(a?.result?.audio);
      return match === false;
    }).length;
  }, [audios]);

  const convertCandidates = useMemo(() => {
    return audios.filter((a) => {
      if (a.status !== "done") return false;
      const match = isTargetAudio(a?.result?.audio);
      if (match !== false) return false;
      return a.convertStatus !== "converting";
    });
  }, [audios]);

  const allTranscriptText = useMemo(() => {
    const parts = audios
      .filter((a) => a.status === "done" && a?.result?.text)
      .map((a) => {
        const name = a?.file?.name || "audio";
        const lang = a?.result?.language || "-";
        const dur =
          typeof a?.result?.duration === "number" ? a.result.duration : null;
        const durStr = dur != null ? ` (${dur.toFixed(2)}s)` : "";
        const audioSum = a?.result?.audio?.summary
          ? `\n> Áudio: ${a.result.audio.summary}`
          : "";
        const audioTarget = a?.result?.audio?.target
          ? `\n> Target: ${a.result.audio.target}`
          : "";
        return `### ${name} [${lang}]${durStr}\n${a.result.text}${audioSum}${audioTarget}`;
      });
    return parts.join("\n\n");
  }, [audios]);

  function calcBusyPct(scopeIds, mode, items) {
    if (!scopeIds?.length) return 0;
    const setIds = new Set(scopeIds);
    const scoped = items.filter((a) => setIds.has(a.id));
    if (!scoped.length) return 0;

    const sum = scoped.reduce((acc, a) => {
      if (mode === "convert") {
        if (a.convertStatus === "converted" || a.convertStatus === "error")
          return acc + 100;
        if (a.convertStatus === "converting")
          return acc + (Number(a.convertProgress) || 0);
        return acc + 0;
      }

      if (a.status === "done" || a.status === "error") return acc + 100;
      if (a.status === "uploading") return acc + (Number(a.progress) || 0);
      return acc + 0;
    }, 0);

    return Math.round(sum / scoped.length);
  }

  function setItem(id, patch) {
    setAudios((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, ...patch } : a));
      if (running && busyMode)
        setBusyPct(calcBusyPct(busyScope, busyMode, next));
      return next;
    });
  }

  function onPickFiles(e) {
    const files = Array.from(e?.target?.files || []);
    if (!files.length) return;

    const newItems = files.map((file) => ({
      id: uid(),
      file,
      status: "queued",
      progress: 0,
      result: null,
      error: null,

      convertStatus: "idle",
      convertProgress: 0,
      convertError: null,
      convertedUrl: null,
      convertedFileName: null,
      convertedSummary: null,
      convertedMatchesTarget: null,
      convertedBlob: null,
    }));

    setAudios((prev) => [...newItems, ...prev]);
  }

  function clearAll() {
    audios.forEach((a) => safeRevokeObjectUrl(a.convertedUrl));

    setAudios([]);
    setRunning(false);
    setOverlayOpen(false);
    setBusyMode(null);
    setBusyScope([]);
    setBusyPct(0);

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeOne(id) {
    setAudios((prev) => {
      const item = prev.find((a) => a.id === id);
      if (item?.convertedUrl) safeRevokeObjectUrl(item.convertedUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  function copyAllTranscripts() {
    const text = String(allTranscriptText || "").trim();
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  function copySingle(text) {
    const t = String(text || "").trim();
    if (!t) return;
    navigator.clipboard?.writeText(t).catch(() => {});
  }

  const convertedItems = useMemo(() => {
    return audios.filter(
      (a) => a.convertStatus === "converted" && a.convertedUrl
    );
  }, [audios]);

  async function downloadConvertedZip() {
    const items = convertedItems;
    if (!items.length) return;

    const zip = new JSZip();
    const used = new Set();

    for (const a of items) {
      const name =
        a.convertedFileName || buildConvertedFilename(a.file?.name || "audio");
      const uniqueName = ensureUniqueFilename(name, used);

      const blob =
        a.convertedBlob ||
        (a.convertedUrl ? await (await fetch(a.convertedUrl)).blob() : null);

      if (blob) zip.file(uniqueName, blob);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipUrl = URL.createObjectURL(zipBlob);

    const a = document.createElement("a");
    a.href = zipUrl;
    a.download = `audios_convertidos_${new Date()
      .toISOString()
      .slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.setTimeout(() => URL.revokeObjectURL(zipUrl), 60_000);
  }

  async function transcribeOne(itemId) {
    setItem(itemId, { status: "uploading", progress: 5, error: null });

    let tick = null;
    const startTick = () => {
      tick = window.setInterval(() => {
        setAudios((prev) => {
          const cur = prev.find((a) => a.id === itemId);
          if (!cur || cur.status !== "uploading") return prev;

          const p = Number(cur.progress) || 0;
          const nextP = Math.min(
            92,
            p + Math.max(1, Math.round((92 - p) * 0.07))
          );

          const next = prev.map((a) =>
            a.id === itemId ? { ...a, progress: nextP } : a
          );

          if (running && busyMode === "transcribe")
            setBusyPct(calcBusyPct(busyScope, "transcribe", next));

          return next;
        });
      }, 450);
    };

    const stopTick = () => {
      if (tick) window.clearInterval(tick);
      tick = null;
    };

    startTick();

    try {
      const curItem = audiosRef.current.find((a) => a.id === itemId);
      const file = curItem?.file;
      if (!file) throw new Error("Arquivo não encontrado na fila.");

      const form = new FormData();
      form.append("file", file);

      const r = await fetch("/api/stt/transcribe", {
        method: "POST",
        body: form,
      });

      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const j = await r.json();
          msg = j?.error || j?.message || msg;
        } catch {}
        throw new Error(msg);
      }

      const data = await r.json();
      stopTick();

      setItem(itemId, {
        status: "done",
        progress: 100,
        result: data,
        error: null,
      });
    } catch (err) {
      stopTick();
      setItem(itemId, {
        status: "error",
        progress: 100,
        error: String(err?.message || err),
      });
    }
  }

  async function transcribeAll() {
    const queued = audios.filter((a) => a.status === "queued");
    if (!queued.length) return;

    const scope = queued.map((a) => a.id);
    setBusyMode("transcribe");
    setBusyScope(scope);
    setBusyPct(calcBusyPct(scope, "transcribe", audios));
    setRunning(true);
    setOverlayOpen(true);

    for (const item of queued) {
      // eslint-disable-next-line no-await-in-loop
      await transcribeOne(item.id);
    }

    setRunning(false);
  }

  function resetFailedToQueued() {
    setAudios((prev) =>
      prev.map((a) =>
        a.status === "error"
          ? { ...a, status: "queued", progress: 0, error: null, result: null }
          : a
      )
    );
  }

  async function convertOne(itemId) {
    setItem(itemId, {
      convertStatus: "converting",
      convertProgress: 5,
      convertError: null,
    });

    let tick = null;
    const startTick = () => {
      tick = window.setInterval(() => {
        setAudios((prev) => {
          const cur = prev.find((a) => a.id === itemId);
          if (!cur || cur.convertStatus !== "converting") return prev;

          const p = Number(cur.convertProgress) || 0;
          const nextP = Math.min(
            92,
            p + Math.max(1, Math.round((92 - p) * 0.07))
          );

          const next = prev.map((a) =>
            a.id === itemId ? { ...a, convertProgress: nextP } : a
          );

          if (running && busyMode === "convert")
            setBusyPct(calcBusyPct(busyScope, "convert", next));

          return next;
        });
      }, 450);
    };

    const stopTick = () => {
      if (tick) window.clearInterval(tick);
      tick = null;
    };

    startTick();

    try {
      const curItem = audiosRef.current.find((a) => a.id === itemId);
      const file = curItem?.file;
      if (!file) throw new Error("Arquivo não encontrado na fila.");

      if (curItem?.convertedUrl) safeRevokeObjectUrl(curItem.convertedUrl);

      const form = new FormData();
      form.append("file", file);

      const r = await fetch("/api/stt/convert", { method: "POST", body: form });

      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const t = await r.text();
          msg = t || msg;
        } catch {}
        throw new Error(msg);
      }

      // nome SEMPRE baseado no original
      const filename = buildConvertedFilename(file.name || "audio");

      const xSummary = r.headers.get("x-audio-summary");
      const xMatch = r.headers.get("x-audio-matches-target");

      const blob = await r.blob();
      const url = URL.createObjectURL(blob);

      stopTick();

      setItem(itemId, {
        convertStatus: "converted",
        convertProgress: 100,
        convertError: null,
        convertedUrl: url,
        convertedBlob: blob,
        convertedFileName: filename,
        convertedSummary: xSummary || null,
        convertedMatchesTarget:
          xMatch === "true" ? true : xMatch === "false" ? false : null,
      });
    } catch (err) {
      stopTick();
      setItem(itemId, {
        convertStatus: "error",
        convertProgress: 100,
        convertError: String(err?.message || err),
      });
    }
  }

  async function convertAllOutOfSpec() {
    const candidates = audios.filter((a) => {
      if (a.status !== "done") return false;
      const match = isTargetAudio(a?.result?.audio);
      return match === false;
    });

    if (!candidates.length) return;

    const scope = candidates.map((a) => a.id);
    setBusyMode("convert");
    setBusyScope(scope);
    setBusyPct(calcBusyPct(scope, "convert", audios));
    setRunning(true);
    setOverlayOpen(true);

    for (const item of candidates) {
      // eslint-disable-next-line no-await-in-loop
      await convertOne(item.id);
    }

    setRunning(false);
  }

  return (
    <TooltipProvider>
      <div className="grid gap-4">
        {/* OVERLAY PROGRESS */}
        {overlayOpen && running && (
          <div className="fixed inset-0 z-[80] grid place-items-center bg-black/30 p-4">
            <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900">
                    {busyMode === "convert"
                      ? "Convertendo áudios…"
                      : "Transcrevendo áudios…"}
                  </div>
                  <div className="text-xs text-zinc-600">
                    {busyMode === "convert"
                      ? `Convertendo ${busyScope.length} itens`
                      : `Transcrevendo ${busyScope.length} itens`}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100"
                  onClick={() => setOverlayOpen(false)}
                  title="Ocultar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3">
                <div className="mb-2 flex items-center justify-between text-xs text-zinc-600">
                  <span>Conclusão</span>
                  <span className="font-semibold text-zinc-900">
                    {busyPct}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-2 rounded-full bg-red-600 transition-all"
                    style={{ width: `${busyPct}%` }}
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2 text-xs text-zinc-600">
                <span>
                  {busyMode === "convert" ? (
                    <>
                      <span className="font-semibold text-zinc-900">
                        {totals.convConverting}
                      </span>{" "}
                      em andamento •{" "}
                      <span className="font-semibold text-zinc-900">
                        {totals.convConverted}
                      </span>{" "}
                      convertidos
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-zinc-900">
                        {totals.uploading}
                      </span>{" "}
                      em andamento •{" "}
                      <span className="font-semibold text-zinc-900">
                        {totals.queued}
                      </span>{" "}
                      na fila
                    </>
                  )}
                </span>

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => setOverlayOpen(false)}
                >
                  Continuar em segundo plano
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Upload / Opções */}
        <div className="grid gap-3 md:grid-cols-[1.4fr_0.6fr]">
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-zinc-900">
                  Áudios (múltiplos)
                </div>
                <div className="text-xs text-zinc-600">
                  Selecione vários arquivos (.mp3, .wav, .m4a). Validação NICE:{" "}
                  <b>{TARGET_AUDIO_LABEL}</b>.
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  multiple
                  onChange={onPickFiles}
                  className="hidden"
                  id="tools-audio-files"
                />
                <label htmlFor="tools-audio-files">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    asChild
                  >
                    <span>
                      <Upload className="mr-2 h-4 w-4" />
                      Selecionar
                    </span>
                  </Button>
                </label>

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={clearAll}
                  disabled={!audios.length || running}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Limpar
                </Button>
              </div>
            </div>

            <div className="mt-3 grid gap-2">
              {audios.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-600">
                  Nenhum áudio na fila.
                </div>
              ) : (
                audios.slice(0, 6).map((a) => {
                  const match = isTargetAudio(a?.result?.audio);
                  const needsConv = a.status === "done" && match === false;

                  return (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-xl bg-zinc-100 text-zinc-700">
                          <FileAudio className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-zinc-900">
                            {a.file?.name || "audio"}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                            <span>{fmtKB(a.file?.size || 0)}</span>
                            <span>•</span>
                            <span>
                              {a.status === "queued" && "Na fila"}
                              {a.status === "uploading" &&
                                `Transcrevendo… ${Math.round(
                                  a.progress || 0
                                )}%`}
                              {a.status === "done" && "Concluído"}
                              {a.status === "error" && "Erro"}
                            </span>

                            {a.status === "done" && (
                              <>
                                <span>•</span>
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5",
                                    match === true
                                      ? "border-green-200 bg-green-50 text-green-700"
                                      : match === false
                                      ? "border-amber-200 bg-amber-50 text-amber-800"
                                      : "border-zinc-200 bg-zinc-50 text-zinc-700"
                                  )}
                                >
                                  {match === true
                                    ? "OK NICE"
                                    : match === false
                                    ? "Fora do padrão"
                                    : "Sem validação"}
                                </span>

                                {needsConv && (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                                    Converter
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {a.status === "done" && (
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                        )}
                        {a.status === "error" && (
                          <AlertTriangle className="h-5 w-5 text-amber-600" />
                        )}
                        {a.status === "uploading" && (
                          <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
                        )}

                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl"
                          onClick={() => removeOne(a.id)}
                          disabled={running}
                          title="Remover da fila"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}

              {audios.length > 6 && (
                <div className="text-xs text-zinc-600">
                  + {audios.length - 6} itens (ver abaixo em “Resultados”)
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="text-sm font-semibold text-zinc-900">Ações</div>

            <div className="mt-2 grid gap-2">
              <label className="text-xs font-semibold text-zinc-700">
                Idioma (referência)
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="pt-BR">Português (Brasil)</option>
                <option value="pt-PT">Português (Portugal)</option>
                <option value="en-US">English (US)</option>
                <option value="es-ES">Español</option>
              </select>

              <div className="mt-2 grid gap-2">
                <Button
                  type="button"
                  className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                  onClick={transcribeAll}
                  disabled={
                    running ||
                    audios.filter((a) => a.status === "queued").length === 0
                  }
                >
                  <Mic className="mr-2 h-4 w-4" />
                  {running && busyMode === "transcribe"
                    ? "Transcrevendo…"
                    : "Transcrever em lote"}
                </Button>

                <Button
                  type="button"
                  className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-60"
                  onClick={convertAllOutOfSpec}
                  disabled={running || convertCandidates.length === 0}
                  title={
                    convertCandidates.length
                      ? `Converter ${convertCandidates.length} áudios fora do padrão`
                      : "Nenhum áudio fora do padrão após transcrição"
                  }
                >
                  <Repeat2 className="mr-2 h-4 w-4" />
                  Converter fora do padrão (massa)
                </Button>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    onClick={resetFailedToQueued}
                    disabled={
                      running ||
                      audios.filter((a) => a.status === "error").length === 0
                    }
                  >
                    Tentar novamente (falhas)
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => setOverlayOpen(true)}
                    disabled={!running}
                    title="Abrir tela de progresso"
                  >
                    Ver progresso
                  </Button>
                </div>

                <div className="text-xs text-zinc-500">
                  Observação: sem “progresso real” do backend, o % é estimado
                  até a resposta.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Banner: fora do padrão */}
        {outOfSpecCount > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <div className="min-w-0">
                <div className="font-semibold">Áudios fora do padrão NICE</div>
                <div className="text-xs opacity-90">
                  {outOfSpecCount} item(ns) não estão em{" "}
                  <b>{TARGET_AUDIO_LABEL}</b>. Use “Converter” por item ou
                  “Converter fora do padrão (massa)”.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RESULTADOS */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-zinc-900">
                Resultados
              </div>
              <div className="text-xs text-zinc-600">
                Após transcrever, validamos automaticamente o padrão NICE e
                liberamos a conversão quando necessário.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={copyAllTranscripts}
                disabled={!String(allTranscriptText || "").trim()}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copiar tudo
              </Button>

              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={downloadConvertedZip}
                disabled={running || convertedItems.length === 0}
                title={
                  convertedItems.length
                    ? `Baixar ${convertedItems.length} áudio(s) convertidos em ZIP`
                    : "Nenhum áudio convertido disponível"
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Baixar convertidos (massa)
              </Button>

              <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
                {totals.done}/{totals.total} transcritos
              </Badge>

              {outOfSpecCount > 0 && (
                <Badge className="border border-amber-200 bg-amber-50 text-amber-800">
                  {outOfSpecCount} fora do padrão
                </Badge>
              )}
            </div>
          </div>

          {audios.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center text-sm text-zinc-600">
              Adicione arquivos para começar.
            </div>
          ) : (
            <div className="grid gap-3">
              {audios.map((a) => {
                const audioInfo = a?.result?.audio;
                const match = isTargetAudio(audioInfo);
                const needsConv = a.status === "done" && match === false;

                return (
                  <div
                    key={a.id}
                    className={cn(
                      "rounded-2xl border p-4",
                      a.status === "done" && "border-green-200 bg-green-50/40",
                      a.status === "error" && "border-amber-200 bg-amber-50/40",
                      (a.status === "queued" || a.status === "uploading") &&
                        "border-zinc-200 bg-white"
                    )}
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-semibold text-zinc-900">
                            {a.file?.name || "audio"}
                          </div>

                          {a.status === "done" && (
                            <Badge className="border border-green-200 bg-green-50 text-green-700">
                              Transcrito
                            </Badge>
                          )}
                          {a.status === "error" && (
                            <Badge className="border border-amber-200 bg-amber-50 text-amber-700">
                              Falha
                            </Badge>
                          )}
                          {a.status === "uploading" && (
                            <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
                              Em andamento
                            </Badge>
                          )}
                          {a.status === "queued" && (
                            <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
                              Na fila
                            </Badge>
                          )}

                          {a.status === "done" && (
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[11px]",
                                match === true
                                  ? "border-green-200 bg-green-50 text-green-700"
                                  : match === false
                                  ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : "border-zinc-200 bg-zinc-50 text-zinc-700"
                              )}
                            >
                              {match === true
                                ? `OK NICE: ${
                                    audioInfo?.summary || TARGET_AUDIO_LABEL
                                  }`
                                : match === false
                                ? `Fora do padrão: ${audioInfo?.summary || "-"}`
                                : "Sem validação"}
                            </span>
                          )}
                        </div>

                        <div className="mt-1 text-xs text-zinc-600">
                          {fmtKB(a.file?.size || 0)}
                          {a?.result?.duration != null &&
                            ` • ${Number(a.result.duration).toFixed(2)}s`}
                          {a?.result?.language && ` • ${a.result.language}`}
                          {a?.result?.file_saved_as &&
                            ` • salvo: ${a.result.file_saved_as}`}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {a.status === "done" && (
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-xl"
                            onClick={() => copySingle(a.result?.text)}
                            disabled={!String(a?.result?.text || "").trim()}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Copiar
                          </Button>
                        )}

                        {needsConv && (
                          <Button
                            type="button"
                            className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-60"
                            onClick={() => convertOne(a.id)}
                            disabled={
                              running || a.convertStatus === "converting"
                            }
                          >
                            {a.convertStatus === "converting" ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Repeat2 className="mr-2 h-4 w-4" />
                            )}
                            Converter
                          </Button>
                        )}

                        {a.convertStatus === "converted" && a.convertedUrl && (
                          <a
                            href={a.convertedUrl}
                            download={a.convertedFileName || undefined}
                          >
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-xl"
                            >
                              <Download className="mr-2 h-4 w-4" />
                              Baixar convertido
                            </Button>
                          </a>
                        )}

                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl"
                          onClick={() => removeOne(a.id)}
                          disabled={running}
                        >
                          Remover
                        </Button>
                      </div>
                    </div>

                    {(a.status === "uploading" || a.status === "queued") && (
                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-xs text-zinc-600">
                          <span>
                            {a.status === "queued"
                              ? "Aguardando…"
                              : "Transcrevendo…"}
                          </span>
                          <span className="font-semibold text-zinc-900">
                            {Math.round(a.progress || 0)}%
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className="h-2 rounded-full bg-red-600 transition-all"
                            style={{ width: `${a.progress || 0}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {needsConv && (
                      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4" />
                          <div className="min-w-0">
                            <div className="font-semibold">
                              Fora do padrão NICE
                            </div>
                            <div className="text-xs opacity-90">
                              Detectado: <b>{audioInfo?.summary || "-"}</b>
                              <br />
                              Esperado:{" "}
                              <b>{audioInfo?.target || TARGET_AUDIO_LABEL}</b>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {a.convertStatus === "converting" && (
                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-xs text-zinc-600">
                          <span>Convertendo…</span>
                          <span className="font-semibold text-zinc-900">
                            {Math.round(a.convertProgress || 0)}%
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className="h-2 rounded-full bg-zinc-900 transition-all"
                            style={{ width: `${a.convertProgress || 0}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {a.convertStatus === "error" && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4" />
                          <div className="min-w-0">
                            <div className="font-semibold">
                              Erro na conversão
                            </div>
                            <div className="text-xs opacity-90">
                              {a.convertError || "Erro desconhecido"}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {a.convertStatus === "converted" && (
                      <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-800">
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4" />
                          <div className="min-w-0">
                            <div className="font-semibold">Convertido</div>
                            <div className="opacity-90">
                              {a.convertedSummary
                                ? `Áudio: ${a.convertedSummary}`
                                : "Arquivo convertido disponível para download."}
                              {typeof a.convertedMatchesTarget ===
                                "boolean" && (
                                <>
                                  {" "}
                                  •{" "}
                                  {a.convertedMatchesTarget
                                    ? "OK NICE"
                                    : "Ainda fora do padrão"}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {a.status === "error" && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4" />
                          <div className="min-w-0">
                            <div className="font-semibold">
                              Erro na transcrição
                            </div>
                            <div className="text-xs opacity-90">
                              {a.error || "Erro desconhecido"}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {a.status === "done" && (
                      <textarea
                        readOnly
                        value={a.result?.text || ""}
                        className={cn(
                          "mt-3 min-h-[110px] w-full resize-y rounded-xl border border-zinc-200 bg-white p-3",
                          "text-sm leading-relaxed text-zinc-900 outline-none"
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* EXPORT UNIFICADO (markdown) */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900">
                Texto consolidado
              </div>
              <div className="text-xs text-zinc-600">
                Útil para colar no Jira/Confluence como evidência (inclui
                summary/target quando disponível).
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={copyAllTranscripts}
              disabled={!String(allTranscriptText || "").trim()}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar
            </Button>
          </div>

          <textarea
            readOnly
            value={allTranscriptText}
            placeholder="As transcrições concluídas aparecerão aqui, em formato Markdown."
            className={cn(
              "min-h-[160px] w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 p-3",
              "text-sm leading-relaxed text-zinc-900 outline-none"
            )}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
