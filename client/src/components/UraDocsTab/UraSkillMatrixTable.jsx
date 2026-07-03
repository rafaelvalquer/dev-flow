import React from "react";

export default function UraSkillMatrixTable({ summary }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-900">Dados extraidos do NICE</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Object.entries(summary?.counts || {}).map(([key, value]) => (
          <div key={key} className="rounded-lg bg-zinc-50 p-3">
            <span className="text-xs capitalize text-zinc-500">{key}</span>
            <p className="text-xl font-semibold text-zinc-900">{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
