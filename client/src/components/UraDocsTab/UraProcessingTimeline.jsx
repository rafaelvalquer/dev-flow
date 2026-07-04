import React from "react";

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
  const progress = Number(status?.progress || 0);
  const currentStep = normalizeStep(status);
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Processamento</h3>
          <p className="text-xs text-zinc-500">{status?.message || "Aguardando envio."}</p>
        </div>
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700">
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
              className={`rounded-lg border px-2 py-2 text-center text-xs ${
                active ? "border-red-200 bg-red-50 text-red-700" : "border-zinc-200 bg-zinc-50 text-zinc-500"
              }`}
            >
              {label}
            </div>
          );
        })}
      </div>
    </section>
  );
}
