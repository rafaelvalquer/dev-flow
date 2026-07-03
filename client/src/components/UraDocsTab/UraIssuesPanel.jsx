import React from "react";

export default function UraIssuesPanel({ issues = [], warnings = [] }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-900">Warnings e inconsistencias</h3>
      <div className="mt-3 grid gap-2">
        {warnings.map((warning, index) => (
          <div key={`w-${index}`} className="whitespace-pre-line rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {warning}
          </div>
        ))}
        {issues.map((issue, index) => (
          <div key={`i-${index}`} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div className="text-sm font-semibold text-zinc-900">{issue.title || issue.category}</div>
            <p className="text-sm text-zinc-600">{issue.description}</p>
          </div>
        ))}
        {!warnings.length && !issues.length ? (
          <p className="text-sm text-zinc-500">Nenhum warning registrado.</p>
        ) : null}
      </div>
    </section>
  );
}
