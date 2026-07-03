import React from "react";

export default function UraPromptAnalysisTable({ prompts = [] }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-900">Prompts analisados</h3>
      <div className="mt-3 overflow-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr><th className="p-2">Arquivo</th><th className="p-2">Intencao</th><th className="p-2">Transcricao limpa</th></tr>
          </thead>
          <tbody>
            {prompts.map((item, index) => (
              <tr key={`${item.fileName}-${index}`} className="border-t border-zinc-100">
                <td className="p-2 font-medium text-zinc-900">{item.fileName}</td>
                <td className="p-2 text-zinc-600">{item.intent}</td>
                <td className="p-2 text-zinc-600">{item.cleanTranscript}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!prompts.length ? <p className="text-sm text-zinc-500">Nenhuma analise de prompt disponivel.</p> : null}
      </div>
    </section>
  );
}
