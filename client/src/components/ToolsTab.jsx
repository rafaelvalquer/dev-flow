// src/components/ToolsTab.jsx
import React, { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  TooltipProvider,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  Wrench,
  Mic,
  FileAudio,
  Sparkles,
  FileText,
  Settings2,
  Upload,
  Copy,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";

const TOOL_DEFS = [
  {
    id: "transcricao",
    title: "Transcrição de Áudio",
    desc: "Transforme áudio em texto para especificação e evolução de URA.",
    icon: Mic,
    status: "ativo",
  },
  {
    id: "gerador-fluxo",
    title: "Gerador de Fluxo URA",
    desc: "Crie árvores/fluxos a partir de texto e regras.",
    icon: Sparkles,
    status: "em_breve",
  },
  {
    id: "validador-script",
    title: "Validador de Script",
    desc: "Valida padrões, erros comuns e consistência de prompts/URA.",
    icon: FileText,
    status: "em_breve",
  },
  {
    id: "configs",
    title: "Configurações de Ferramentas",
    desc: "Preferências e integrações (idioma, formatos, presets).",
    icon: Settings2,
    status: "em_breve",
  },
];

function toolButtonClasses(active) {
  return cn(
    "rounded-xl border px-3 py-2 text-sm font-medium transition",
    "hover:bg-zinc-50",
    active
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-zinc-200 bg-white text-zinc-800"
  );
}

function fmtKB(bytes = 0) {
  const kb = Math.max(1, Math.round(bytes / 1024));
  if (kb < 1024) return `${kb} KB`;
  const mb = (kb / 1024).toFixed(2);
  return `${mb} MB`;
}

// ID simples sem libs
function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Itens de upload/transcrição
 * status:
 *  - queued: aguardando
 *  - uploading: enviando/transcrevendo
 *  - done: concluído
 *  - error: erro
 */
export default function ToolsTab() {
  const [activeTool, setActiveTool] = useState("transcricao");

  const fileInputRef = useRef(null);

  // Multi-audio queue
  const [audios, setAudios] = useState([]); // [{id,file,status,progress,result,error}]
  const [language, setLanguage] = useState("pt-BR");

  // Busy geral
  const [busy, setBusy] = useState(false);
  const [busyPct, setBusyPct] = useState(0);

  const active = useMemo(
    () => TOOL_DEFS.find((t) => t.id === activeTool) || TOOL_DEFS[0],
    [activeTool]
  );

  const totals = useMemo(() => {
    const total = audios.length;
    const done = audios.filter((a) => a.status === "done").length;
    const err = audios.filter((a) => a.status === "error").length;
    const uploading = audios.filter((a) => a.status === "uploading").length;
    const queued = audios.filter((a) => a.status === "queued").length;
    return { total, done, err, uploading, queued };
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
        return `### ${name} [${lang}]${durStr}\n${a.result.text}`;
      });
    return parts.join("\n\n");
  }, [audios]);

  function recalcBusyPct(nextAudios) {
    // progresso geral: média dos progressos (queued=0, done=100, error=100, uploading=progress)
    if (!nextAudios.length) return 0;
    const sum = nextAudios.reduce((acc, a) => {
      if (a.status === "done" || a.status === "error") return acc + 100;
      if (a.status === "queued") return acc + 0;
      return acc + (Number(a.progress) || 0);
    }, 0);
    return Math.round(sum / nextAudios.length);
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
    }));

    setAudios((prev) => {
      const next = [...newItems, ...prev];
      setBusyPct(recalcBusyPct(next));
      return next;
    });
  }

  function clearAll() {
    setAudios([]);
    setBusy(false);
    setBusyPct(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeOne(id) {
    setAudios((prev) => {
      const next = prev.filter((a) => a.id !== id);
      setBusyPct(recalcBusyPct(next));
      return next;
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

  async function transcribeOne(itemId) {
    // marca uploading
    setAudios((prev) => {
      const next = prev.map((a) =>
        a.id === itemId
          ? { ...a, status: "uploading", progress: 5, error: null }
          : a
      );
      setBusyPct(recalcBusyPct(next));
      return next;
    });

    // "fake progress" enquanto o backend processa (não há progress real)
    let tick = null;
    const startTick = () => {
      tick = window.setInterval(() => {
        setAudios((prev) => {
          const cur = prev.find((a) => a.id === itemId);
          if (!cur || cur.status !== "uploading") return prev;

          const p = Number(cur.progress) || 0;
          // sobe até 92%
          const nextP = Math.min(
            92,
            p + Math.max(1, Math.round((92 - p) * 0.07))
          );
          const next = prev.map((a) =>
            a.id === itemId ? { ...a, progress: nextP } : a
          );
          setBusyPct(recalcBusyPct(next));
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
      const curItem = audios.find((a) => a.id === itemId);
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

      const data = await r.json(); // {language, duration, text, file_saved_as}

      stopTick();

      setAudios((prev) => {
        const next = prev.map((a) =>
          a.id === itemId
            ? { ...a, status: "done", progress: 100, result: data, error: null }
            : a
        );
        setBusyPct(recalcBusyPct(next));
        return next;
      });
    } catch (err) {
      stopTick();

      setAudios((prev) => {
        const next = prev.map((a) =>
          a.id === itemId
            ? {
                ...a,
                status: "error",
                progress: 100,
                error: String(err?.message || err),
              }
            : a
        );
        setBusyPct(recalcBusyPct(next));
        return next;
      });
    }
  }

  async function transcribeAll() {
    const queued = audios.filter((a) => a.status === "queued");
    if (!queued.length) return;

    setBusy(true);

    // processamento sequencial (mais estável p/ STT e evita estourar memória/CPU)
    for (const item of queued) {
      // eslint-disable-next-line no-await-in-loop
      await transcribeOne(item.id);
    }

    setBusy(false);
  }

  function resetFailedToQueued() {
    setAudios((prev) => {
      const next = prev.map((a) =>
        a.status === "error"
          ? { ...a, status: "queued", progress: 0, error: null, result: null }
          : a
      );
      setBusyPct(recalcBusyPct(next));
      return next;
    });
  }

  return (
    <TooltipProvider>
      <motion.section
        key="tools"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 12 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        className="w-full"
      >
        <div className="mx-auto max-w-7xl px-2 py-4">
          {/* Header do módulo */}
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-red-600 to-red-700 text-white shadow-sm">
                <Wrench className="h-5 w-5" />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
                    Ferramentas
                  </h2>
                  <Badge className="border border-red-200 bg-red-50 text-red-700">
                    URA
                  </Badge>
                </div>
                <div className="text-sm text-zinc-600">
                  Central de utilitários para acelerar desenvolvimento e
                  padronização.
                </div>
              </div>
            </div>

            {/* Navegação das ferramentas */}
            <div className="flex flex-wrap items-center gap-2">
              {TOOL_DEFS.map((t) => {
                const Icon = t.icon;
                const disabled = t.status !== "ativo";
                const isActive = activeTool === t.id;

                const btn = (
                  <button
                    type="button"
                    className={toolButtonClasses(isActive)}
                    onClick={() => !disabled && setActiveTool(t.id)}
                    aria-pressed={isActive}
                    disabled={disabled}
                    style={{ opacity: disabled ? 0.55 : 1 }}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {t.title}
                      {disabled && (
                        <span className="ml-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                          Em breve
                        </span>
                      )}
                    </span>
                  </button>
                );

                return disabled ? (
                  <Tooltip key={t.id}>
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent>Em breve</TooltipContent>
                  </Tooltip>
                ) : (
                  <React.Fragment key={t.id}>{btn}</React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Conteúdo */}
          <div className="grid gap-4">
            <Card className="rounded-2xl border-zinc-200">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base text-zinc-900">
                      {active.title}
                    </CardTitle>
                    <CardDescription className="text-sm">
                      {active.desc}
                    </CardDescription>
                  </div>

                  {activeTool === "transcricao" && (
                    <Badge className="border border-green-200 bg-green-50 text-green-700">
                      Ativo
                    </Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent>
                {activeTool === "transcricao" ? (
                  <div className="grid gap-4">
                    {/* BUSY OVERLAY */}
                    {busy && (
                      <div className="fixed inset-0 z-[80] grid place-items-center bg-black/30 p-4">
                        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-zinc-900">
                                Transcrevendo áudios…
                              </div>
                              <div className="text-xs text-zinc-600">
                                Processando {totals.done + totals.err} de{" "}
                                {totals.total} itens
                              </div>
                            </div>
                            <button
                              type="button"
                              className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100"
                              onClick={() => setBusy(false)}
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
                              <span className="font-semibold text-zinc-900">
                                {totals.uploading}
                              </span>{" "}
                              em andamento •{" "}
                              <span className="font-semibold text-zinc-900">
                                {totals.queued}
                              </span>{" "}
                              na fila
                            </span>

                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() => setBusy(false)}
                              >
                                Continuar em segundo plano
                              </Button>
                            </div>
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
                              Selecione vários arquivos (.mp3, .wav, .m4a). A
                              transcrição será feita em lote.
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
                              disabled={!audios.length || busy}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Limpar
                            </Button>
                          </div>
                        </div>

                        {/* Lista compacta da fila */}
                        <div className="mt-3 grid gap-2">
                          {audios.length === 0 ? (
                            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-600">
                              Nenhum áudio na fila.
                            </div>
                          ) : (
                            audios.slice(0, 6).map((a) => (
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
                                    <div className="text-xs text-zinc-600">
                                      {fmtKB(a.file?.size || 0)} •{" "}
                                      {a.status === "queued" && "Na fila"}
                                      {a.status === "uploading" &&
                                        `Transcrevendo… ${Math.round(
                                          a.progress || 0
                                        )}%`}
                                      {a.status === "done" && "Concluído"}
                                      {a.status === "error" && "Erro"}
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
                                    disabled={busy}
                                    title="Remover da fila"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            ))
                          )}

                          {audios.length > 6 && (
                            <div className="text-xs text-zinc-600">
                              + {audios.length - 6} itens (ver abaixo em
                              “Resultados”)
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                        <div className="text-sm font-semibold text-zinc-900">
                          Opções
                        </div>

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
                                busy ||
                                audios.filter((a) => a.status === "queued")
                                  .length === 0
                              }
                            >
                              <Mic className="mr-2 h-4 w-4" />
                              {busy ? "Transcrevendo…" : "Transcrever em lote"}
                            </Button>

                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={resetFailedToQueued}
                                disabled={
                                  busy ||
                                  audios.filter((a) => a.status === "error")
                                    .length === 0
                                }
                              >
                                Tentar novamente (falhas)
                              </Button>

                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() => setBusy(true)}
                                disabled={!busy && totals.uploading === 0}
                                title="Abrir tela de progresso"
                              >
                                Ver progresso
                              </Button>
                            </div>

                            <div className="text-xs text-zinc-500">
                              Dica: processamento é sequencial para estabilidade
                              e evitar sobrecarga no STT.
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* RESULTADOS */}
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900">
                            Resultados
                          </div>
                          <div className="text-xs text-zinc-600">
                            Itens concluídos aparecem com transcrição; falhas
                            exibem o motivo.
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

                          <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
                            {totals.done}/{totals.total} concluídos
                          </Badge>
                          {totals.err > 0 && (
                            <Badge className="border border-amber-200 bg-amber-50 text-amber-700">
                              {totals.err} falhas
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
                          {audios.map((a) => (
                            <div
                              key={a.id}
                              className={cn(
                                "rounded-2xl border p-4",
                                a.status === "done" &&
                                  "border-green-200 bg-green-50/40",
                                a.status === "error" &&
                                  "border-amber-200 bg-amber-50/40",
                                (a.status === "queued" ||
                                  a.status === "uploading") &&
                                  "border-zinc-200 bg-white"
                              )}
                            >
                              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <div className="truncate text-sm font-semibold text-zinc-900">
                                      {a.file?.name || "audio"}
                                    </div>

                                    {a.status === "done" && (
                                      <Badge className="border border-green-200 bg-green-50 text-green-700">
                                        Concluído
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
                                  </div>

                                  <div className="mt-1 text-xs text-zinc-600">
                                    {fmtKB(a.file?.size || 0)}
                                    {a?.result?.duration != null &&
                                      ` • ${Number(a.result.duration).toFixed(
                                        2
                                      )}s`}
                                    {a?.result?.language &&
                                      ` • ${a.result.language}`}
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
                                      disabled={
                                        !String(a?.result?.text || "").trim()
                                      }
                                    >
                                      <Copy className="mr-2 h-4 w-4" />
                                      Copiar
                                    </Button>
                                  )}

                                  {a.status === "error" && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="rounded-xl"
                                      onClick={() =>
                                        setAudios((prev) => {
                                          const next = prev.map((x) =>
                                            x.id === a.id
                                              ? {
                                                  ...x,
                                                  status: "queued",
                                                  progress: 0,
                                                  error: null,
                                                  result: null,
                                                }
                                              : x
                                          );
                                          setBusyPct(recalcBusyPct(next));
                                          return next;
                                        })
                                      }
                                      disabled={busy}
                                    >
                                      Tentar este
                                    </Button>
                                  )}

                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="rounded-xl"
                                    onClick={() => removeOne(a.id)}
                                    disabled={busy}
                                  >
                                    Remover
                                  </Button>
                                </div>
                              </div>

                              {(a.status === "uploading" ||
                                a.status === "queued") && (
                                <div className="mt-3">
                                  <div className="mb-1 flex items-center justify-between text-xs text-zinc-600">
                                    <span>
                                      {a.status === "queued"
                                        ? "Aguardando…"
                                        : "Processando…"}
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
                          ))}
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
                            Útil para colar no Jira/Confluence como evidência.
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
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center">
                    <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-sm">
                      <Sparkles className="h-6 w-6 text-zinc-700" />
                    </div>
                    <div className="text-sm font-semibold text-zinc-900">
                      Em breve
                    </div>
                    <div className="mx-auto mt-1 max-w-xl text-sm text-zinc-600">
                      Esta ferramenta será adicionada futuramente dentro da aba{" "}
                      <strong>Ferramentas</strong>.
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </motion.section>
    </TooltipProvider>
  );
}
