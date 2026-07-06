import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileText, HeartPulse } from "lucide-react";
import {
  createUraDocsJob,
  fetchUraDocsHealth,
  fetchUraDocsJob,
  fetchUraDocsResult,
} from "@/lib/uraDocsApi";
import UraUploadPanel from "./UraUploadPanel";
import UraOptionsPanel, { DEFAULT_URA_DOCS_OPTIONS } from "./UraOptionsPanel";
import UraProcessingTimeline from "./UraProcessingTimeline";
import UraAiInsightsPanel from "./UraAiInsightsPanel";
import UraPromptAnalysisTable from "./UraPromptAnalysisTable";
import UraSkillMatrixTable from "./UraSkillMatrixTable";
import UraIssuesPanel from "./UraIssuesPanel";
import UraTestPlanPanel from "./UraTestPlanPanel";
import UraRunbookPanel from "./UraRunbookPanel";
import UraDownloadPanel from "./UraDownloadPanel";

export default function UraDocsTab() {
  const [projectName, setProjectName] = useState("");
  const [niceFile, setNiceFile] = useState(null);
  const [audioFiles, setAudioFiles] = useState([]);
  const [audioZip, setAudioZip] = useState(null);
  const [options, setOptions] = useState(DEFAULT_URA_DOCS_OPTIONS);
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [health, setHealth] = useState(null);

  const ready = status?.status === "completed" && result;
  const jobId = status?.jobId;
  const insights = result?.aiInsights || {};
  const pythonOnline = health?.python?.ok === true;
  const parserInfo = health?.python?.payload || {};
  const parserVersionMissing = pythonOnline && !parserInfo?.parserVersion;
  const summaryCounts = result?.summary?.counts || status?.summary?.counts || {};
  const hasCounts = Object.keys(summaryCounts || {}).length > 0;

  useEffect(() => {
    let active = true;
    fetchUraDocsHealth()
      .then((payload) => {
        if (active) setHealth(payload);
      })
      .catch(() => {
        if (active) setHealth(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!jobId || ready || status?.status === "failed") return undefined;
    let active = true;
    const interval = window.setInterval(async () => {
      try {
        const nextStatus = await fetchUraDocsJob(jobId);
        if (!active) return;
        setStatus(nextStatus);
        if (nextStatus.status === "completed") {
          const nextResult = await fetchUraDocsResult(jobId);
          if (active) setResult(nextResult);
        }
      } catch (error) {
        if (active) toast.error(error?.message || "Falha ao consultar job.");
      }
    }, 1800);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [jobId, ready, status?.status]);

  async function handleSubmit() {
    if (!niceFile) {
      toast.error("Selecione o arquivo NICE.");
      return;
    }
    if (health && !pythonOnline) {
      toast.error("Serviço Python STT/URA Docs offline.");
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const created = await createUraDocsJob({
        niceFile,
        audioFiles,
        audioZip,
        projectName,
        options,
      });
      setStatus(created);
      toast.success("Job de documentação criado.");
    } catch (error) {
      toast.error(error?.message || "Falha ao iniciar documentação.");
    } finally {
      setSubmitting(false);
    }
  }

  const healthLabel = useMemo(() => {
    if (!health) return "Health pendente";
    const py = health.python?.ok ? "Python online" : "Python offline";
    const aiHealth = health.openai || {};
    const ai = aiHealth.configured ? "OpenAI configurada" : "OpenAI opcional";
    const parser = health.python?.payload?.parserVersion
      ? `Parser ${health.python.payload.parserVersion}`
      : "Parser sem versão";
    return `${py} - ${parser} - ${ai}`;
  }, [health]);

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-red-50 text-red-600">
              <FileText className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Documentador Inteligente de URA NICE</h2>
              <p className="text-sm text-zinc-500">Gere draw.io, HTML, Markdown, matrizes e análises a partir do fluxo NICE.</p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <HeartPulse className="h-4 w-4 text-red-600" />
            {healthLabel}
          </div>
        </div>
      </section>

        <UraUploadPanel
        projectName={projectName}
        onProjectNameChange={setProjectName}
        niceFile={niceFile}
        onNiceFileChange={setNiceFile}
        audioFiles={audioFiles}
        onAudioFilesChange={setAudioFiles}
        audioZip={audioZip}
        onAudioZipChange={setAudioZip}
        onSubmit={handleSubmit}
        submitting={submitting}
        disabled={health && !pythonOnline}
      />
      {health && !pythonOnline ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Serviço Python STT/URA Docs offline. Inicie em
          <code className="mx-1 rounded bg-white px-1">services/stt-python</code>
          com
          <code className="mx-1 rounded bg-white px-1">python -m uvicorn app:app --host 127.0.0.1 --port 8000</code>.
        </section>
      ) : null}
      {parserVersionMissing ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Serviço Python online, mas sem <code className="rounded bg-white px-1">parserVersion</code>.
          Reinicie o serviço STT/URA Docs para carregar o parser NICE novo.
        </section>
      ) : null}
      <UraOptionsPanel options={options} onChange={setOptions} />
      <UraProcessingTimeline status={status} />
      {hasCounts ? (
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-zinc-900">Fluxo extraído do NICE</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {[
              ["Actions", summaryCounts.actions],
              ["Conexões", summaryCounts.edges],
              ["Menus", summaryCounts.menus],
              ["Prompts", summaryCounts.prompts],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                <div className="text-xs text-zinc-500">{label}</div>
                <div className="text-lg font-semibold text-zinc-900">{Number(value || 0)}</div>
              </div>
            ))}
          </div>
          {Number(summaryCounts.actions || 0) <= 1 || Number(summaryCounts.edges || 0) === 0 ? (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Fluxo navegável não encontrado. Gere novamente após reiniciar o serviço Python com o parser atualizado.
            </p>
          ) : null}
        </section>
      ) : null}
      <UraDownloadPanel jobId={jobId} ready={ready} summary={result?.summary} />

      {ready ? (
        <>
          <UraSkillMatrixTable summary={result?.summary} />
          <UraAiInsightsPanel insights={insights} />
          <UraIssuesPanel issues={insights?.issues || []} warnings={result?.warnings || []} />
          <UraPromptAnalysisTable prompts={insights?.promptAnalysis || []} />
          <div className="grid gap-4 lg:grid-cols-2">
            <UraTestPlanPanel testCases={insights?.testCases || []} />
            <UraRunbookPanel runbook={insights?.runbook || []} />
          </div>
        </>
      ) : null}
    </div>
  );
}
