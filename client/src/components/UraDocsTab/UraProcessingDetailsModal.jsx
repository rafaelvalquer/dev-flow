import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  Loader2,
  PackageCheck,
  Sparkles,
  Waves,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatTime(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function eventIcon(kind) {
  if (kind === "ai" || kind === "ai_prompt" || kind === "ai_response") return Bot;
  if (kind === "warning" || kind === "ai_error" || kind === "fallback" || kind === "error") return CircleAlert;
  if (kind === "package" || kind === "success") return PackageCheck;
  if (kind === "parser" || kind === "file") return FileText;
  if (kind === "cache") return Sparkles;
  return Clock3;
}

function detailsLabel(kind) {
  if (kind === "ai_prompt") return "Prompt enviado";
  if (kind === "ai_response") return "Resposta IA";
  if (kind === "ai_error") return "Erro IA";
  if (kind === "fallback") return "Fallback";
  if (kind === "warning") return "Aviso";
  if (kind === "package") return "Pacote";
  if (kind === "file") return "Arquivo";
  return "Detalhes";
}

function stepLabel(step) {
  const labels = {
    queued: "Fila",
    saving_uploads: "Uploads",
    uploads: "Uploads",
    parse: "Parser",
    parser: "Parser",
    transcription: "Transcrição",
    audio: "Áudio",
    audio_matching: "Áudio",
    ai_organizer: "Organização IA",
    semantic_organization: "Organização semântica",
    semantic_model: "Modelo semântico",
    ai_enrichment: "Análise IA",
    ai_analysis: "Análise IA",
    package: "Pacote",
    drawio: "Draw.io",
    generate_package: "Pacote",
    completed: "Concluído",
    failed: "Falha",
    idle: "Aguardando",
  };
  const key = String(step || "idle").toLowerCase();
  return labels[key] || step || "Aguardando";
}

function kindLabel(kind) {
  const labels = {
    info: "Informação",
    debug: "Debug",
    ai: "IA",
    ai_prompt: "Prompt IA",
    ai_response: "Resposta IA",
    ai_error: "Erro IA",
    fallback: "Fallback",
    warning: "Aviso",
    error: "Erro",
    package: "Pacote",
    parser: "Parser",
    file: "Arquivo",
    cache: "Cache",
    success: "Sucesso",
    audio: "Áudio",
  };
  const key = String(kind || "info").toLowerCase();
  return labels[key] || kind || "Informação";
}

function eventKey(event, index) {
  return event.id || `${event.timestamp || "sem-hora"}-${event.step || "step"}-${event.kind || "kind"}-${index}`;
}

function eventTone(event) {
  if (event.kind === "success" || event.status === "completed") {
    return {
      shell: "border-emerald-200 bg-emerald-50/70",
      avatar: "bg-emerald-100 text-emerald-700",
      badge: "bg-emerald-100 text-emerald-700",
      glow: "shadow-[0_18px_52px_-36px_rgba(5,150,105,0.65)]",
    };
  }
  if (
    event.kind === "warning" ||
    event.kind === "ai_error" ||
    event.kind === "fallback" ||
    event.kind === "error" ||
    event.status === "failed"
  ) {
    return {
      shell: "border-amber-200 bg-amber-50/75",
      avatar: "bg-amber-100 text-amber-700",
      badge: "bg-amber-100 text-amber-800",
      glow: "shadow-[0_18px_52px_-36px_rgba(217,119,6,0.62)]",
    };
  }
  if (event.kind === "ai" || event.kind === "ai_prompt" || event.kind === "ai_response" || event.kind === "cache") {
    return {
      shell: "border-red-200 bg-red-50/65",
      avatar: "bg-red-100 text-red-700",
      badge: "bg-red-100 text-red-700",
      glow: "shadow-[0_18px_52px_-36px_rgba(220,38,38,0.58)]",
    };
  }
  return {
    shell: "border-zinc-200 bg-white",
    avatar: "bg-zinc-100 text-zinc-700",
    badge: "bg-zinc-100 text-zinc-600",
    glow: "shadow-sm",
  };
}

function buildFallbackEvents(status) {
  if (!status) return [];
  return [
    {
      id: "status-current",
      timestamp: status.updatedAt || status.createdAt,
      step: status.step || "idle",
      title: status.status === "completed" ? "Processamento concluído" : "Status atual",
      message: status.message || "Aguardando eventos detalhados do job.",
      status: status.status || "idle",
      progress: status.progress || 0,
      kind: status.status === "completed" ? "success" : "info",
    },
  ];
}

function useTypewriterText(text, enabled) {
  const [visible, setVisible] = useState(enabled ? "" : text);
  const [done, setDone] = useState(!enabled);

  useEffect(() => {
    if (!enabled) {
      setVisible(text);
      setDone(true);
      return undefined;
    }

    setVisible("");
    setDone(false);
    let index = 0;
    const interval = window.setInterval(() => {
      index += text.length > 500 ? 6 : 3;
      setVisible(text.slice(0, index));
      if (index >= text.length) {
        setDone(true);
        window.clearInterval(interval);
      }
    }, text.length > 500 ? 10 : 16);
    return () => window.clearInterval(interval);
  }, [text, enabled]);

  return { visible, done };
}

function LiveDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500 [animation-delay:140ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500 [animation-delay:280ms]" />
    </span>
  );
}

const EVENT_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "errors", label: "Erros" },
  { id: "warnings", label: "Warnings" },
  { id: "ai", label: "IA" },
  { id: "parser", label: "Parser" },
  { id: "audio", label: "Áudio" },
  { id: "package", label: "Pacote" },
];

function matchesFilter(event, filter) {
  const kind = String(event?.kind || "").toLowerCase();
  const step = String(event?.step || "").toLowerCase();
  const status = String(event?.status || "").toLowerCase();
  if (filter === "all") return true;
  if (filter === "errors") return kind.includes("error") || status === "failed";
  if (filter === "warnings") return kind === "warning" || kind === "fallback" || kind === "ai_error";
  if (filter === "ai") return kind.includes("ai") || kind === "cache" || kind === "fallback" || step.includes("ai");
  if (filter === "parser") return kind === "parser" || step.includes("parse") || step.includes("parser");
  if (filter === "audio") return kind === "audio" || step.includes("audio") || step.includes("transcription");
  if (filter === "package") return kind === "package" || step.includes("package") || step.includes("drawio");
  return true;
}

function formatDuration(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function EventSummary({ events, status }) {
  const warnings = events.filter((event) => matchesFilter(event, "warnings")).length;
  const errors = events.filter((event) => matchesFilter(event, "errors")).length;
  const aiEvents = events.filter((event) => matchesFilter(event, "ai")).length;
  const latestDuration = [...events]
    .reverse()
    .map((event) => event?.details?.durationMs)
    .find((value) => Number(value) > 0);
  const summary = status?.summary?.counts || {};
  const items = [
    { label: "Eventos", value: events.length },
    { label: "Warnings", value: warnings },
    { label: "Erros", value: errors },
    { label: "Eventos IA", value: aiEvents },
    { label: "Última duração", value: formatDuration(latestDuration) || "-" },
  ];
  if (summary.actions || summary.semanticRoutes || summary.drawioPages) {
    items.push(
      { label: "Actions", value: summary.actions || 0 },
      { label: "Rotas", value: summary.semanticRoutes || 0 },
      { label: "Páginas", value: summary.drawioPages || 0 }
    );
  }
  return (
    <section className="grid gap-2 rounded-xl border border-zinc-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-zinc-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{item.label}</div>
          <div className="mt-1 text-sm font-semibold text-zinc-950">{item.value}</div>
        </div>
      ))}
    </section>
  );
}

function EventDetails({ event }) {
  const details = event.details;
  if (!details) return null;
  const text = typeof details === "string" ? details : JSON.stringify(details, null, 2);
  if (!text || text === "null") return null;
  return (
    <details className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white/75">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50">
        {detailsLabel(event.kind)}
      </summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-zinc-100 px-3 py-3 text-xs leading-relaxed text-zinc-600">
        {text}
      </pre>
    </details>
  );
}

function LiveStatusCard({ status, latest }) {
  const progress = Math.round(Number(status?.progress || latest?.progress || 0));
  const isProcessing = status?.status === "processing";
  const isCompleted = status?.status === "completed";
  const isFailed = status?.status === "failed";
  const StatusIcon = isCompleted ? CheckCircle2 : isFailed ? CircleAlert : Bot;
  return (
    <section
      className={`rounded-xl border p-4 ${
        isFailed
          ? "border-amber-200 bg-amber-50"
          : isCompleted
            ? "border-emerald-200 bg-emerald-50"
            : "border-red-100 bg-red-50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide">
            <span className={isFailed ? "text-amber-800" : isCompleted ? "text-emerald-700" : "text-red-700"}>
              {stepLabel(status?.step || latest?.step)} - {progress}%
            </span>
            {isProcessing ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2 py-1 text-red-700">
                <LiveDots />
                ao vivo
              </span>
            ) : null}
          </div>
          <h3 className="mt-2 text-sm font-semibold text-zinc-950">
            {latest?.title || "Aguardando processamento"}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-zinc-700">
            {latest?.message || status?.message || "Quando o job iniciar, os eventos aparecem aqui em tempo real."}
          </p>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/85 text-red-700 shadow-sm">
          <StatusIcon className={`h-5 w-5 ${isProcessing ? "animate-pulse" : ""}`} />
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/70">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isFailed ? "bg-amber-500" : isCompleted ? "bg-emerald-600" : "bg-red-600"
          }`}
          style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
        />
      </div>
    </section>
  );
}

function EventMessage({ event, index, isLatest, isProcessing, shouldAnimate, onTypingFrame }) {
  const Icon = eventIcon(event.kind);
  const tone = eventTone(event);
  const { visible, done } = useTypewriterText(event.message || "", shouldAnimate);

  useEffect(() => {
    if (shouldAnimate) onTypingFrame?.();
  }, [visible, shouldAnimate, onTypingFrame]);

  return (
    <article
      className={`rounded-xl border p-4 transition-all duration-300 ${tone.shell} ${
        isLatest ? tone.glow : ""
      }`}
    >
      <div className="flex gap-3">
        <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone.avatar}`}>
          <Icon className={`h-4 w-4 ${isLatest && isProcessing ? "animate-pulse" : ""}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="break-words text-sm font-semibold text-zinc-950">
                  {event.title || `Evento ${index + 1}`}
                </h4>
                {isLatest && isProcessing ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    processando
                  </span>
                ) : null}
              </div>
              <span className="mt-0.5 block text-xs text-zinc-500">{formatTime(event.timestamp)}</span>
            </div>
          </div>
          <p className="mt-2 min-h-5 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-700">
            {visible}
            {shouldAnimate && !done ? <span className="ml-0.5 animate-pulse text-red-700">|</span> : null}
          </p>
          {isLatest && isProcessing && done ? (
            <div className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-zinc-500">
              <Waves className="h-3.5 w-3.5 text-red-600" />
              aguardando a próxima atualização
              <LiveDots />
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide">
            <span className={`rounded-full px-2 py-1 ${tone.badge}`}>{stepLabel(event.step)}</span>
            <span className="rounded-full bg-white/80 px-2 py-1 text-zinc-600">{kindLabel(event.kind)}</span>
            <span className="rounded-full bg-white/80 px-2 py-1 text-zinc-600">
              {Math.round(Number(event.progress || 0))}%
            </span>
          </div>
          <EventDetails event={event} />
        </div>
      </div>
    </article>
  );
}

export default function UraProcessingDetailsModal({ open, onOpenChange, status }) {
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const seenEventsRef = useRef(new Set());
  const jobIdRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const [animatedKeys, setAnimatedKeys] = useState(() => new Set());
  const [activeFilter, setActiveFilter] = useState("all");

  const events = useMemo(() => {
    const activity = Array.isArray(status?.activityLog) ? status.activityLog : [];
    return activity.length ? activity : buildFallbackEvents(status);
  }, [status]);
  const visibleEvents = useMemo(
    () => events.filter((event) => matchesFilter(event, activeFilter)),
    [events, activeFilter]
  );
  const latest = events[events.length - 1] || {};
  const isProcessing = status?.status === "processing";

  useEffect(() => {
    if (jobIdRef.current === status?.jobId) return;
    jobIdRef.current = status?.jobId || null;
    seenEventsRef.current = new Set();
    setAnimatedKeys(new Set());
    setActiveFilter("all");
    stickToBottomRef.current = true;
  }, [status?.jobId]);

  useEffect(() => {
    if (!open) return;

    const nextAnimated = new Set();
    const seen = seenEventsRef.current;
    const isFirstBatch = seen.size === 0;
    const latestIndex = events.length - 1;

    events.forEach((event, index) => {
      const key = eventKey(event, index);
      if (seen.has(key)) return;
      const shouldAnimate =
        isProcessing && (!isFirstBatch || index === latestIndex || events.length === 1);
      if (shouldAnimate) nextAnimated.add(key);
      seen.add(key);
    });

    if (nextAnimated.size) {
      setAnimatedKeys((current) => new Set([...current, ...nextAnimated]));
    }
  }, [events, isProcessing, open]);

  useEffect(() => {
    if (!open || !stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [events.length, visibleEvents.length, open]);

  function handleScroll(event) {
    const target = event.currentTarget;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 120;
  }

  function keepLatestVisible() {
    if (!open || !stickToBottomRef.current) return;
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-h-[88vh] max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-zinc-200 px-5 py-4">
          <DialogTitle>Execução do Documentador URA</DialogTitle>
          <DialogDescription>
            Acompanhe a execução em formato de conversa, com eventos do parser, áudio, IA e pacote.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-zinc-50/50 p-5"
        >
          <div className="grid gap-4">
            <LiveStatusCard status={status} latest={latest} />
            <EventSummary events={events} status={status} />

            <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-2">
              {EVENT_FILTERS.map((filter) => {
                const count = events.filter((event) => matchesFilter(event, filter.id)).length;
                const active = activeFilter === filter.id;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setActiveFilter(filter.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "bg-red-600 text-white shadow-sm"
                        : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                    }`}
                  >
                    {filter.label}
                    <span className={active ? "ml-1 text-red-100" : "ml-1 text-zinc-500"}>{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-3">
              {visibleEvents.length ? visibleEvents.map((event, index) => {
                const key = eventKey(event, index);
                const isLatest = event === latest;
                return (
                  <EventMessage
                    key={key}
                    event={event}
                    index={index}
                    isLatest={isLatest}
                    isProcessing={isProcessing}
                    shouldAnimate={animatedKeys.has(key)}
                    onTypingFrame={isLatest ? keepLatestVisible : undefined}
                  />
                );
              }) : (
                <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
                  Nenhum evento encontrado para este filtro.
                </div>
              )}
            </div>
            <div ref={bottomRef} aria-hidden="true" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
