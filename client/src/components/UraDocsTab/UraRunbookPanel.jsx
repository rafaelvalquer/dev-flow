import React from "react";

export default function UraRunbookPanel({ runbook = [] }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-900">Runbook de sustentacao</h3>
      <div className="mt-3 grid gap-2">
        {runbook.slice(0, 8).map((item, index) => (
          <div key={`${item.problem}-${index}`} className="rounded-lg bg-zinc-50 p-3">
            <div className="text-sm font-semibold text-zinc-900">{item.problem}</div>
            <p className="text-sm text-zinc-600">{item.whereToCheck}</p>
          </div>
        ))}
        {!runbook.length ? <p className="text-sm text-zinc-500">Nenhum item de runbook gerado.</p> : null}
      </div>
    </section>
  );
}
