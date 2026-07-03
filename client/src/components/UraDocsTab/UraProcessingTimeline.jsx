import React from "react";

const STEPS = [
  ["queued", "Fila"],
  ["saving_uploads", "Uploads"],
  ["parse", "Parser"],
  ["transcription", "Audio"],
  ["ai_enrichment", "IA"],
  ["package", "Pacote"],
  ["completed", "Concluido"],
];

export default function UraProcessingTimeline({ status }) {
  const progress = Number(status?.progress || 0);
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
        {STEPS.map(([key, label]) => {
          const active = status?.step === key || (key === "completed" && status?.status === "completed");
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
