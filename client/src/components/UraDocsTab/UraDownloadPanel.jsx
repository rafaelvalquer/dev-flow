import React from "react";
import { Download } from "lucide-react";
import { uraDocsDownloadUrl } from "@/lib/uraDocsApi";

const DOWNLOADS = [
  ["zip", "Pacote ZIP"],
  ["drawio", "Draw.io"],
  ["html", "HTML"],
  ["md", "Markdown"],
];

function isNavigable(summary) {
  const counts = summary?.counts || {};
  return Number(counts.actions || 0) > 1 && Number(counts.edges || 0) > 0;
}

export default function UraDownloadPanel({ jobId, ready, summary }) {
  const canDownload = ready && isNavigable(summary);
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-900">Downloads</h3>
      {ready && !canDownload ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Fluxo navegável não encontrado. O pacote foi bloqueado para evitar download de documentação vazia.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {DOWNLOADS.map(([kind, label]) => (
          <a
            key={kind}
            href={canDownload && jobId ? uraDocsDownloadUrl(jobId, kind) : undefined}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${
              canDownload
                ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                : "pointer-events-none border-zinc-200 bg-zinc-50 text-zinc-400"
            }`}
          >
            <Download className="h-4 w-4" />
            {label}
          </a>
        ))}
      </div>
    </section>
  );
}
