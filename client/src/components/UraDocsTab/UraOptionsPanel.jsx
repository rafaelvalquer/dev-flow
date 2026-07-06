import React from "react";

const OPTION_LABELS = {
  includeTechnicalFlow: "Fluxo técnico",
  includeBusinessFlow: "Fluxo funcional",
  includePromptTranscriptions: "Transcrições",
  includeAiAnalysis: "Análise IA",
  includeTestPlan: "Plano de testes",
  includeRunbook: "Runbook",
};

export const DEFAULT_URA_DOCS_OPTIONS = {
  includeTechnicalFlow: true,
  includeBusinessFlow: true,
  includePromptTranscriptions: true,
  includeAiAnalysis: true,
  includeTestPlan: true,
  includeRunbook: true,
  language: "pt-BR",
};

export default function UraOptionsPanel({ options, onChange }) {
  function setOption(key, value) {
    onChange({ ...options, [key]: value });
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Opções</h3>
          <p className="text-xs text-zinc-500">Controle o pacote gerado e o uso de IA.</p>
        </div>
        <select
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
          value={options.language || "pt-BR"}
          onChange={(event) => setOption("language", event.target.value)}
        >
          <option value="pt-BR">pt-BR</option>
          <option value="en-US">en-US</option>
        </select>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(OPTION_LABELS).map(([key, label]) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
          >
            <span className="text-zinc-700">{label}</span>
            <input
              type="checkbox"
              checked={options[key] !== false}
              onChange={(event) => setOption(key, event.target.checked)}
            />
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Áudios aparecem automaticamente no draw.io: usa a transcrição local quando existir; caso contrário, mostra apenas o nome do arquivo.
      </p>
    </section>
  );
}
