// src/components/tools/TextToSpeechTool.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  Play,
  Pause,
  Sparkles,
  Download,
  Trash2,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Copy,
} from "lucide-react";

const TTS_VOICE_OPTIONS = [
  {
    value: "pt-BR-FranciscaNeural",
    label: "Francisca - feminina (pt-BR)",
  },
  {
    value: "pt-BR-AntonioNeural",
    label: "Antonio - masculina (pt-BR)",
  },
];

function safeRevokeObjectUrl(u) {
  try {
    if (u) URL.revokeObjectURL(u);
  } catch {}
}

function baseName(fileName = "tts") {
  return String(fileName).replace(/\.[^/.]+$/i, "");
}

function buildFilename(prefix, ext) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${baseName(prefix || "tts")}_${stamp}.${ext}`;
}

function safeFileStem(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "audio";
}

function parseBatchLines(value = "") {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const named = line.includes("|");
      const [rawName, ...rest] = named ? line.split("|") : [];
      const text = named ? rest.join("|").trim() : line;
      const stem = named ? safeFileStem(rawName) : `audio_${String(index + 1).padStart(3, "0")}`;
      return {
        id: `${index}-${stem}`,
        fileName: `${stem}.wav`,
        text,
        status: "idle",
        validation: null,
        error: null,
        blob: null,
      };
    })
    .filter((item) => item.text);
}

function parseFilenameFromContentDisposition(cd) {
  if (!cd) return null;
  const m = /filename\*?=(?:UTF-8''|")?([^;"\n]+)"?/i.exec(cd);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

async function fetchBlob(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const txt = await r.text();
      if (txt) {
        try {
          const data = JSON.parse(txt);
          msg =
            data?.error?.details?.upstreamBody?.detail ||
            data?.error?.message ||
            data?.message ||
            txt;
        } catch {
          msg = txt;
        }
      }
    } catch {}
    throw new Error(msg);
  }

  const cd = r.headers.get("content-disposition");
  const fn = parseFilenameFromContentDisposition(cd);

  const blob = await r.blob();
  return { blob, filename: fn, contentType: r.headers.get("content-type") };
}

export default function TextToSpeechTool() {
  const audioRef = useRef(null);
  const [mode, setMode] = useState("single");

  const [text, setText] = useState("");
  const [voice, setVoice] = useState(TTS_VOICE_OPTIONS[0].value);
  const [rate, setRate] = useState("0");
  const [volume, setVolume] = useState("0"); // percentual opcional

  const [mp3Url, setMp3Url] = useState(null);
  const [mp3Blob, setMp3Blob] = useState(null);
  const [mp3Meta, setMp3Meta] = useState(null);

  const [isPlaying, setIsPlaying] = useState(false);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("idle"); // idle|ready|error
  const [error, setError] = useState(null);
  const [batchText, setBatchText] = useState("");
  const [batchItems, setBatchItems] = useState([]);
  const [batchBusy, setBatchBusy] = useState(false);

  const canGenerate = useMemo(
    () => String(text || "").trim().length > 0,
    [text]
  );

  useEffect(() => {
    return () => {
      safeRevokeObjectUrl(mp3Url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [mp3Url]);

  function clearPreview() {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch {}
    }
    safeRevokeObjectUrl(mp3Url);
    setMp3Url(null);
    setMp3Blob(null);
    setMp3Meta(null);
    setIsPlaying(false);
    setStatus("idle");
    setError(null);
  }

  async function generatePreviewMp3() {
    if (!canGenerate || busy) return;

    setBusy(true);
    setError(null);

    try {
      // troca preview anterior
      clearPreview();

      const payload = {
        text: String(text || "").trim(),
        ...(voice ? { voice } : {}),
        ...(rate ? { rate: Number(rate) } : {}),
        ...(volume ? { volume: Number(volume) } : {}),
      };

      const { blob, filename, contentType } = await fetchBlob(
        "/api/stt/tts",
        payload
      );

      const url = URL.createObjectURL(blob);
      setMp3Blob(blob);
      setMp3Url(url);
      setMp3Meta({
        filename: filename || buildFilename("tts_preview", "mp3"),
        contentType: contentType || "audio/mpeg",
      });

      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    try {
      if (el.paused) await el.play();
      else el.pause();
    } catch {}
  }

  async function downloadUlawWav() {
    if (!canGenerate || busy) return;

    setBusy(true);
    setError(null);

    try {
      const payload = {
        text: String(text || "").trim(),
        ...(voice ? { voice } : {}),
        ...(rate ? { rate: Number(rate) } : {}),
        ...(volume ? { volume: Number(volume) } : {}),
      };

      const { blob, filename } = await fetchBlob("/api/stt/tts_ulaw", payload);

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || buildFilename("tts_ulaw_nice", "wav");
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setStatus("error");
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  function copyText() {
    const t = String(text || "").trim();
    if (!t) return;
    navigator.clipboard?.writeText(t).catch(() => {});
  }

  async function validateBlob(blob, fileName) {
    const form = new FormData();
    form.append("file", blob, fileName);
    const response = await fetch("/api/stt/analyze", { method: "POST", body: form });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  async function generateBatch() {
    const parsed = parseBatchLines(batchText);
    if (!parsed.length || batchBusy) return;
    setBatchBusy(true);
    setBatchItems(parsed.map((item) => ({ ...item, status: "queued" })));
    const produced = [];

    for (const item of parsed) {
      setBatchItems((items) =>
        items.map((current) =>
          current.id === item.id ? { ...current, status: "processing", error: null } : current,
        ),
      );
      try {
        const payload = {
          text: item.text,
          ...(voice ? { voice } : {}),
          ...(rate ? { rate: Number(rate) } : {}),
          ...(volume ? { volume: Number(volume) } : {}),
        };
        const { blob } = await fetchBlob("/api/stt/tts_ulaw", payload);
        const validation = await validateBlob(blob, item.fileName);
        const done = {
          ...item,
          status: validation?.matches_target === false ? "warning" : "done",
          validation,
          blob,
        };
        produced.push(done);
        setBatchItems((items) =>
          items.map((current) => (current.id === item.id ? done : current)),
        );
      } catch (err) {
        setBatchItems((items) =>
          items.map((current) =>
            current.id === item.id
              ? { ...current, status: "error", error: String(err?.message || err) }
              : current,
          ),
        );
      }
    }
    setBatchBusy(false);
  }

  async function downloadBatchZip() {
    const ready = batchItems.filter((item) => item.blob);
    if (!ready.length) return;
    const zip = new JSZip();
    const report = ["arquivo;status;texto;problemas"];
    ready.forEach((item) => {
      zip.file(item.fileName, item.blob);
      report.push(
        [
          item.fileName,
          item.validation?.matches_target ? "OK NICE" : item.status,
          `"${item.text.replace(/"/g, '""')}"`,
          `"${(item.validation?.issues || []).map((issue) => issue.label || issue.code).join(" | ").replace(/"/g, '""')}"`,
        ].join(";"),
      );
    });
    zip.file("relatorio.csv", report.join("\n"));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pacote_tts_nice_${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="grid gap-4">
      <div className="inline-flex w-fit rounded-2xl bg-zinc-100 p-1">
        {[
          ["single", "Áudio único"],
          ["batch", "Pacote de áudios"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={cn(
              "rounded-xl px-3 py-2 text-sm font-semibold transition",
              mode === id ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600",
            )}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "batch" ? (
        <div className="grid gap-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="text-sm font-semibold text-zinc-900">
              Gerador de pacote de áudios
            </div>
            <div className="mt-1 text-xs text-zinc-600">
              Uma frase por linha ou `nome_do_arquivo | texto da frase`.
            </div>
            <textarea
              value={batchText}
              onChange={(event) => setBatchText(event.target.value)}
              placeholder={"audio_boas_vindas | Olá, seja bem-vindo.\naudio_menu_1 | Para segunda via, digite 1."}
              className="mt-3 min-h-[180px] w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                className="rounded-xl bg-red-600 text-white hover:bg-red-700"
                disabled={!parseBatchLines(batchText).length || batchBusy}
                onClick={generateBatch}
              >
                {batchBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Gerar pacote
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={!batchItems.some((item) => item.blob)}
                onClick={downloadBatchZip}
              >
                <Download className="mr-2 h-4 w-4" />
                Baixar ZIP
              </Button>
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="grid gap-2">
              {batchItems.map((item) => (
                <div key={item.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-900">{item.fileName}</div>
                      <div className="line-clamp-2 text-xs text-zinc-600">{item.text}</div>
                    </div>
                    <Badge className={cn(
                      "border",
                      item.status === "done" && "border-green-200 bg-green-50 text-green-700",
                      item.status === "warning" && "border-amber-200 bg-amber-50 text-amber-800",
                      item.status === "error" && "border-red-200 bg-red-50 text-red-700",
                      !["done", "warning", "error"].includes(item.status) && "border-zinc-200 bg-zinc-50 text-zinc-700",
                    )}>
                      {item.status === "done" ? "OK NICE" : item.status === "warning" ? "Corrigir" : item.status === "error" ? "Erro" : "Processando"}
                    </Badge>
                  </div>
                  {item.error ? <div className="mt-1 text-xs text-red-700">{item.error}</div> : null}
                </div>
              ))}
              {!batchItems.length ? (
                <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                  Nenhum áudio gerado ainda.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
      <>
      {/* Input */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-900">
              Texto para gerar áudio (TTS)
            </div>
            <div className="text-xs text-zinc-600">
              Preview em <b>MP3</b> no player. Se aprovado, baixe em{" "}
              <b>WAV μ-law 8k mono</b> (padrão URA NICE).
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={copyText}
              disabled={!canGenerate || busy}
              title="Copiar texto"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar
            </Button>

            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={clearPreview}
              disabled={busy && status !== "error"}
              title="Limpar preview"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Limpar
            </Button>
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Digite o texto que a URA deve falar..."
          className={cn(
            "mt-3 min-h-[140px] w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 p-3",
            "text-sm leading-relaxed text-zinc-900 outline-none focus:ring-2 focus:ring-red-500"
          )}
        />

        {/* Opções (opcional) */}
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs font-semibold text-zinc-700">
              Voz do audio
            </label>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
            >
              {TTS_VOICE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-semibold text-zinc-700">
                Rate
              </label>
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                {Number(rate) > 0 ? "+" : ""}
                {rate}%
              </span>
            </div>
            <input
              type="range"
              min="-50"
              max="50"
              step="1"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              aria-label="Velocidade da voz"
              className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-blue-500 via-zinc-200 to-red-500 accent-red-600 outline-none"
            />
            <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-zinc-500">
              <span>-50%</span>
              <span>0%</span>
              <span>+50%</span>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-zinc-700">
              Volume (opcional)
            </label>
            <input
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              placeholder="1.0"
              className="mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        {/* Ações */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            onClick={generatePreviewMp3}
            disabled={!canGenerate || busy}
          >
            {busy && !mp3Url ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Gerar preview (MP3)
          </Button>

          <Button
            type="button"
            className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-60"
            onClick={downloadUlawWav}
            disabled={!canGenerate || busy}
            title="Baixar WAV μ-law 8k mono (NICE)"
          >
            {busy && mp3Url ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Baixar NICE (WAV μ-law)
          </Button>

          {status === "ready" && (
            <Badge className="border border-green-200 bg-green-50 text-green-700">
              Preview pronto
            </Badge>
          )}

          {status === "error" && (
            <Badge className="border border-amber-200 bg-amber-50 text-amber-800">
              Erro
            </Badge>
          )}
        </div>

        {/* Erro */}
        {status === "error" && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <div className="min-w-0">
                <div className="font-semibold">Falha ao gerar</div>
                <div className="text-xs opacity-90">
                  {error || "Erro desconhecido"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Player / Preview */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-900">
              Player (MP3)
            </div>
            <div className="text-xs text-zinc-600">
              Use para validar o texto/entonação. Depois, baixe em WAV μ-law.
            </div>
          </div>

          {mp3Url ? (
            <div className="inline-flex items-center gap-2">
              <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
                {mp3Meta?.filename || "preview.mp3"}
              </Badge>
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            </div>
          ) : (
            <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
              Sem preview
            </Badge>
          )}
        </div>

        {mp3Url ? (
          <div className="grid gap-3">
            <audio ref={audioRef} src={mp3Url} controls className="w-full" />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={togglePlay}
              >
                {isPlaying ? (
                  <Pause className="mr-2 h-4 w-4" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {isPlaying ? "Pausar" : "Tocar"}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => {
                  if (!mp3Blob) return;
                  const url = URL.createObjectURL(mp3Blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download =
                    mp3Meta?.filename || buildFilename("tts_preview", "mp3");
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                }}
                disabled={!mp3Blob}
                title="Baixar preview MP3 (opcional)"
              >
                <Download className="mr-2 h-4 w-4" />
                Baixar preview (MP3)
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center text-sm text-zinc-600">
            Gere o preview para habilitar o player.
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
