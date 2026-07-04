import React, { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, CircleAlert, Clock3, FileText, PackageCheck, Sparkles } from "lucide-react";
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
  if (kind === "warning" || kind === "ai_error" || kind === "fallback") return CircleAlert;
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
  if (kind === "warning") return "Warning";
  if (kind === "package") return "Pacote";
  if (kind === "file") return "Arquivo";
  return "Detalhes";
}

function buildFallbackEvents(status) {
  if (!status) return [];
  return [
    {
      id: "status-current",
      timestamp: status.updatedAt || status.createdAt,
      step: status.step || "idle",
      title: status.status === "completed" ? "Processamento concluido" : "Status atual",
      message: status.message || "Aguardando eventos detalhados do job.",
      status: status.status || "idle",
      progress: status.progress || 0,
      kind: status.status === "completed" ? "success" : "info",
    },
  ];
}

function useTypewriter(text, enabled) {
  const [visible, setVisible] = useState(enabled ? "" : text);

  useEffect(() => {
    if (!enabled) {
      setVisible(text);
      return undefined;
    }
    setVisible("");
    let index = 0;
    const interval = window.setInterval(() => {
      index += 2;
      setVisible(text.slice(0, index));
      if (index >= text.length) window.clearInterval(interval);
    }, 18);
    return () => window.clearInterval(interval);
  }, [text, enabled]);

  return visible;
}

function EventDetails({ event }) {
  const details = event.details;
  if (!details) return null;
  const text = typeof details === "string" ? details : JSON.stringify(details, null, 2);
  if (!text || text === "null") return null;
  return (
    <details className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-zinc-700">
        {detailsLabel(event.kind)}
      </summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 pb-3 text-xs leading-relaxed text-zinc-600">
        {text}
      </pre>
    </details>
  );
}

export default function UraProcessingDetailsModal({ open, onOpenChange, status }) {
  const events = useMemo(() => {
    const activity = Array.isArray(status?.activityLog) ? status.activityLog : [];
    return activity.length ? activity : buildFallbackEvents(status);
  }, [status]);
  const latest = events[events.length - 1] || {};
  const thinkingText = useTypewriter(latest.message || "", open && status?.status === "processing");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-h-[88vh] max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-zinc-200 px-5 py-4">
          <DialogTitle>Execucao do Documentador URA</DialogTitle>
          <DialogDescription>
            Acompanhe as etapas do job, chamadas de IA resumidas e mensagens tecnicas sanitizadas.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          <div className="grid gap-4">
          <div className="rounded-xl border border-red-100 bg-red-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-red-700">
                  {status?.step || "idle"} - {Math.round(Number(status?.progress || 0))}%
                </div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">
                  {latest.title || "Aguardando processamento"}
                </div>
              </div>
              {status?.status === "completed" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <Bot className="h-5 w-5 animate-pulse text-red-600" />
              )}
            </div>
            <p className="mt-3 min-h-5 text-sm leading-relaxed text-zinc-700">
              {thinkingText}
              {open && status?.status === "processing" ? <span className="animate-pulse">|</span> : null}
            </p>
          </div>

          <div className="space-y-3">
            {events.map((event, index) => {
              const Icon = eventIcon(event.kind);
              const isLatest = index === events.length - 1;
              return (
                <article
                  key={event.id || `${event.step}-${index}`}
                  className={`rounded-xl border p-4 ${
                    isLatest ? "border-red-200 bg-white shadow-sm" : "border-zinc-200 bg-white"
                  }`}
                >
                  <div className="flex gap-3">
                    <span
                      className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                        event.kind === "warning" || event.kind === "ai_error" || event.kind === "fallback"
                          ? "bg-amber-50 text-amber-700"
                          : event.kind === "success"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-700"
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${isLatest && status?.status === "processing" ? "animate-pulse" : ""}`} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-zinc-900">{event.title}</h4>
                        <span className="text-xs text-zinc-400">{formatTime(event.timestamp)}</span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-zinc-600">{event.message}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide">
                        <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-600">{event.step}</span>
                        <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-600">{event.kind}</span>
                        <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-600">{event.progress}%</span>
                      </div>
                      <EventDetails event={event} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
