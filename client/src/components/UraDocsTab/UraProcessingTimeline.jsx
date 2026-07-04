import React, { useState } from "react";
import { Cog, MessageSquareText } from "lucide-react";
import UraProcessingDetailsModal from "./UraProcessingDetailsModal";

const STEPS = [
  { key: "queued", label: "Fila", aliases: ["queued"] },
  { key: "saving_uploads", label: "Uploads", aliases: ["saving_uploads", "uploads"] },
  { key: "parse", label: "Parser", aliases: ["parse", "parser"] },
  { key: "transcription", label: "Audio", aliases: ["transcription", "audio", "audio_matching"] },
  {
    key: "ai",
    label: "IA",
    aliases: [
      "ai_organizer",
      "ai_enrichment",
      "ai_analysis",
      "semantic_organization",
      "semantic_model",
    ],
  },
  { key: "package", label: "Pacote", aliases: ["package", "drawio", "generate_package"] },
  { key: "completed", label: "Concluido", aliases: ["completed"] },
];

function normalizeStep(status) {
  if (status?.status === "completed") return "completed";
  const rawStep = String(status?.step || "").toLowerCase();
  return STEPS.find((step) => step.aliases.includes(rawStep))?.key || rawStep;
}

export default function UraProcessingTimeline({ status }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const progress = Number(status?.progress || 0);
  const currentStep = normalizeStep(status);
  const isProcessing = status?.status === "processing";
  const canOpenDetails = Boolean(status);
  return (
    <>
      <section
        role={canOpenDetails ? "button" : undefined}
        tabIndex={canOpenDetails ? 0 : undefined}
        onClick={() => {
          if (canOpenDetails) setDetailsOpen(true);
        }}
        onKeyDown={(event) => {
          if (canOpenDetails && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            setDetailsOpen(true);
          }
        }}
        className={`rounded-xl border bg-white p-4 transition ${
          canOpenDetails ? "cursor-pointer hover:border-red-200 hover:shadow-sm" : "border-zinc-200"
        } ${isProcessing ? "border-red-200" : "border-zinc-200"}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-900">Processamento</h3>
              {isProcessing ? <Cog className="h-4 w-4 animate-spin text-red-600" /> : null}
            </div>
            <p className="text-xs text-zinc-500">{status?.message || "Aguardando envio."}</p>
            {canOpenDetails ? (
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-red-600">
                <MessageSquareText className="h-3.5 w-3.5" />
                Ver detalhes da execucao
              </p>
            ) : null}
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              isProcessing ? "bg-red-50 text-red-700" : "bg-zinc-100 text-zinc-700"
            }`}
          >
            {isProcessing ? <Cog className="h-3.5 w-3.5 animate-spin" /> : null}
            {status?.status || "idle"}
          </span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100">
          <div className="h-full bg-red-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {STEPS.map(({ key, label }) => {
            const active = currentStep === key;
            return (
              <div
                key={key}
                className={`rounded-lg border px-2 py-2 text-center text-xs transition ${
                  active
                    ? `border-red-200 bg-red-50 text-red-700 ${isProcessing ? "shadow-sm ring-1 ring-red-100" : ""}`
                    : "border-zinc-200 bg-zinc-50 text-zinc-500"
                }`}
              >
                <span className="inline-flex items-center justify-center gap-1">
                  {active && isProcessing ? <Cog className="h-3 w-3 animate-spin" /> : null}
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <UraProcessingDetailsModal open={detailsOpen} onOpenChange={setDetailsOpen} status={status} />
    </>
  );
}
