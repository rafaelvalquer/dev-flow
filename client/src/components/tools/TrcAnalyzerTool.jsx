import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileSearch,
  GitBranch,
  Loader2,
  Network,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TABS = [
  ["summary", "Resumo"],
  ["timeline", "Timeline"],
  ["apis", "APIs"],
  ["errors", "Falhas"],
  ["flow", "Fluxo visual"],
];

function metric(label, value) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </div>
      <div className="mt-2 truncate text-2xl font-bold text-zinc-950">
        {value ?? "-"}
      </div>
    </div>
  );
}

function severityClass(value) {
  if (["error", "confirmed", "failure"].includes(value)) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (["warning", "probable", "mention"].includes(value)) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (value === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function downloadUrl(url) {
  const link = document.createElement("a");
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function TrcAnalyzerTool() {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [detail, setDetail] = useState(null);
  const [activeTab, setActiveTab] = useState("summary");

  const summary = result?.summary || detail?.analysis?.summary || {};
  const timeline = detail?.analysis?.timeline || [];
  const apis = detail?.analysis?.apiCalls || [];
  const errors = detail?.analysis?.errors || [];
  const scripts = useMemo(
    () => summary.mostFrequentScripts || summary.scripts || [],
    [summary],
  );

  async function analyze() {
    if (!files.length || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setDetail(null);

    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      const response = await fetch("/api/trc/upload", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      setResult(data);
      const detailResponse = await fetch(`/api/trc/${data.analysisId}`);
      const detailData = await detailResponse.json().catch(() => null);
      if (detailResponse.ok && detailData?.ok) setDetail(detailData);
      setActiveTab("summary");
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
              <FileSearch className="h-4 w-4 text-red-600" />
              NICE Trace Analyzer
            </div>
            <div className="mt-1 text-xs text-zinc-600">
              Envie um ou mais `.TRC` para gerar resumo, timeline, APIs, falhas e fluxo visual.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".trc"
              multiple
              className="hidden"
              id="trc-upload-input"
              onChange={(event) => setFiles([...event.target.files])}
            />
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => document.getElementById("trc-upload-input")?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Selecionar TRC
            </Button>
            <Button
              type="button"
              className="rounded-xl bg-red-600 text-white hover:bg-red-700"
              disabled={!files.length || busy}
              onClick={analyze}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSearch className="mr-2 h-4 w-4" />}
              Analisar
            </Button>
          </div>
        </div>
        {files.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {files.map((file) => (
              <Badge key={`${file.name}-${file.size}`} className="border border-zinc-200 bg-zinc-50 text-zinc-700">
                {file.name}
              </Badge>
            ))}
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>

      {result ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {TABS.map(([id, label]) => (
                <Button
                  key={id}
                  type="button"
                  variant="outline"
                  className={cn(
                    "rounded-xl",
                    activeTab === id && "border-red-200 bg-red-50 text-red-700",
                  )}
                  onClick={() => setActiveTab(id)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => downloadUrl(`/api/trc/${result.analysisId}/export.csv`)}
              >
                <Download className="mr-2 h-4 w-4" />
                CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => downloadUrl(`/api/trc/${result.analysisId}/export.json`)}
              >
                <Download className="mr-2 h-4 w-4" />
                JSON
              </Button>
            </div>
          </div>

          {activeTab === "summary" ? (
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              {metric("Eventos", summary.totalEvents)}
              {metric("APIs", summary.totalApiCalls || apis.length)}
              {metric("Falhas", summary.totalErrors || errors.length)}
              {metric("Duração", summary.durationSeconds != null ? `${summary.durationSeconds}s` : "-")}
              {metric("ContactID", summary.contactId || summary.contactIds?.[0])}
              {metric("ANI/MSISDN", summary.msisdn || summary.ani)}
              {metric("Início", summary.startTime)}
              {metric("Fim", summary.endTime)}
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 md:col-span-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Diagnóstico automático
                </div>
                <div className="mt-2 text-sm text-zinc-700">
                  {result.reportText || detail?.analysis?.reportText || "Sem diagnóstico disponível."}
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "timeline" ? (
            <div className="mt-4 grid gap-2">
              {timeline.slice(0, 120).map((item) => (
                <div key={item.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={cn("border", severityClass(item.severity))}>{item.action}</Badge>
                    <span className="text-sm font-semibold text-zinc-900">{item.title}</span>
                    <span className="text-xs text-zinc-500">{item.time || ""}</span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-zinc-600">{item.description}</div>
                </div>
              ))}
            </div>
          ) : null}

          {activeTab === "apis" ? (
            <div className="mt-4 grid gap-2">
              {apis.map((api) => (
                <div key={api.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Network className="h-4 w-4 text-sky-600" />
                    <span className="font-semibold text-zinc-900">{api.apiName}</span>
                    <Badge className={cn("border", severityClass(api.isSuspicious ? "warning" : "success"))}>
                      HTTP {api.httpStatusCode || "-"}
                    </Badge>
                    {api.timeoutMs ? <Badge className="border border-zinc-200 bg-white text-zinc-700">{api.timeoutMs}ms</Badge> : null}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-zinc-600">{api.url || api.rawPreview}</div>
                </div>
              ))}
              {!apis.length ? <EmptyText>Nenhuma API encontrada.</EmptyText> : null}
            </div>
          ) : null}

          {activeTab === "errors" ? (
            <div className="mt-4 grid gap-2">
              {errors.map((item) => (
                <div key={item.id} className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <div className="flex items-center gap-2 font-semibold text-red-800">
                    <AlertTriangle className="h-4 w-4" />
                    {item.explanation}
                  </div>
                  <div className="mt-1 line-clamp-3 text-xs text-red-700">{item.event?.fullText}</div>
                </div>
              ))}
              {!errors.length ? <EmptyText>Nenhuma falha evidente encontrada.</EmptyText> : null}
            </div>
          ) : null}

          {activeTab === "flow" ? (
            <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="grid gap-3">
                {scripts.slice(0, 30).map((script, index) => (
                  <div key={`${script.name || script}-${index}`} className="flex items-center gap-3">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-900 text-xs font-bold text-white">
                      {index + 1}
                    </div>
                    <div className="min-w-0 rounded-xl border border-zinc-200 bg-white px-3 py-2">
                      <div className="truncate text-sm font-semibold text-zinc-900">{script.name || script}</div>
                      {script.count ? <div className="text-xs text-zinc-500">{script.count} evento(s)</div> : null}
                    </div>
                  </div>
                ))}
                {!scripts.length ? <EmptyText>Fluxo não identificado.</EmptyText> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EmptyText({ children }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
      {children}
    </div>
  );
}
