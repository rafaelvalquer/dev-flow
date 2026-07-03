import React from "react";

export default function UraTestPlanPanel({ testCases = [] }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-900">Plano de testes</h3>
      <div className="mt-3 grid gap-2">
        {testCases.slice(0, 8).map((item) => (
          <div key={item.id || item.title} className="rounded-lg bg-zinc-50 p-3">
            <div className="text-sm font-semibold text-zinc-900">{item.id} {item.title}</div>
            <p className="text-sm text-zinc-600">{item.expectedResult}</p>
          </div>
        ))}
        {!testCases.length ? <p className="text-sm text-zinc-500">Nenhum caso de teste gerado.</p> : null}
      </div>
    </section>
  );
}
