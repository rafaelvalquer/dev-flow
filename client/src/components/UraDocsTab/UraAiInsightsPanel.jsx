import React from "react";

export default function UraAiInsightsPanel({ insights }) {
  const context = insights?.context || {};
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-900">Análises geradas por IA</h3>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg bg-zinc-50 p-3">
          <span className="text-xs text-zinc-500">URA</span>
          <p className="text-sm font-semibold text-zinc-900">{context.uraName || "Não identificado"}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <span className="text-xs text-zinc-500">Empresas</span>
          <p className="text-sm text-zinc-700">{(context.mainCompanies || []).join(", ") || "Sem inferência"}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <span className="text-xs text-zinc-500">Assuntos</span>
          <p className="text-sm text-zinc-700">{(context.mainDomains || []).join(", ") || "Sem inferência"}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-700">
        {insights?.executiveSummary || insights?.functionalOverview || "Nenhum resumo de IA disponível."}
      </p>
    </section>
  );
}
