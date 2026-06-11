import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Clipboard,
  FileText,
  Gauge,
  Loader2,
  RefreshCw,
  Server,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchSystemLogs } from "@/lib/systemLogs";
import { cn } from "@/lib/utils";

const DEFAULT_LOG_LINES = 200;

function formatDateTime(value, fallback = "Não informado") {
  if (!value) return fallback;

  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return fallback;
  }
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let current = bytes;
  let unitIndex = 0;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${current.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function buildCopyText(payload) {
  const logs = payload?.logs || {};
  const lineLimit = payload?.lineLimit || DEFAULT_LOG_LINES;

  return [
    `Dev Flow - Logs do Sistema`,
    `Coletado em: ${formatDateTime(payload?.checkedAt)}`,
    `Limite: últimas ${lineLimit} linhas por arquivo`,
    "",
    "==================== STT / PYTHON ====================",
    logs.stt?.text || logs.stt?.message || "(sem conteúdo)",
    "",
    "==================== BACKEND / ELECTRON ====================",
    logs.backend?.text || logs.backend?.message || "(sem conteúdo)",
    "",
  ].join("\n");
}

function LogPanel({ title, description, icon: Icon, log }) {
  const exists = Boolean(log?.exists);
  const hasError = Boolean(log?.error);
  const text = log?.text || "";

  return (
    <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="h-4 w-4 text-red-600" />
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                "rounded-full border",
                exists && !hasError
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : hasError
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-amber-200 bg-amber-50 text-amber-800",
              )}
            >
              {exists && !hasError
                ? "Arquivo encontrado"
                : hasError
                  ? "Erro ao ler"
                  : "Arquivo não encontrado"}
            </Badge>

            <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
              {log?.lineCount || 0} linhas
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-3">
        <section className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3 text-xs text-zinc-600 md:grid-cols-3">
          <div>
            <p className="font-semibold uppercase text-zinc-500">Arquivo</p>
            <p className="mt-1 break-all font-mono text-[11px] text-zinc-800">
              {log?.path || "Não informado"}
            </p>
          </div>

          <div>
            <p className="font-semibold uppercase text-zinc-500">Tamanho</p>
            <p className="mt-1 font-semibold text-zinc-900">
              {formatBytes(log?.sizeBytes)}
            </p>
          </div>

          <div>
            <p className="font-semibold uppercase text-zinc-500">
              Última alteração
            </p>
            <p className="mt-1 font-semibold text-zinc-900">
              {formatDateTime(log?.updatedAt)}
            </p>
          </div>
        </section>

        {hasError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{log.error}</p>
            </div>
          </div>
        ) : null}

        <pre className="max-h-[460px] overflow-auto rounded-2xl border border-zinc-900/10 bg-zinc-950 p-4 font-mono text-[11px] leading-5 text-zinc-100 shadow-inner">
          {text || log?.message || "Nenhuma linha disponível."}
        </pre>
      </CardContent>
    </Card>
  );
}

export default function SystemLogsView() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const combinedText = useMemo(() => buildCopyText(payload), [payload]);

  async function loadLogs() {
    setLoading(true);
    setError("");

    try {
      const data = await fetchSystemLogs({ lines: DEFAULT_LOG_LINES });
      setPayload(data);
    } catch (err) {
      setError(err?.message || "Não foi possível carregar os logs.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyAll() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard não disponível neste navegador.");
      }

      await navigator.clipboard.writeText(combinedText);
      toast.success("Logs copiados para a área de transferência.");
    } catch (err) {
      toast.error(err?.message || "Não foi possível copiar os logs.");
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  const logs = payload?.logs || {};

  return (
    <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-red-600" />
              Logs do Sistema
            </CardTitle>
            <CardDescription>
              Consulte as últimas {DEFAULT_LOG_LINES} linhas dos logs principais
              para acelerar o diagnóstico.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
              {payload
                ? `Coletado em ${formatDateTime(payload.checkedAt)}`
                : "Aguardando leitura"}
            </Badge>

            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-zinc-200 bg-white"
              onClick={loadLogs}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Atualizar
            </Button>

            <Button
              type="button"
              className="rounded-xl bg-red-600 text-white hover:bg-red-700"
              onClick={handleCopyAll}
              disabled={!payload || loading}
            >
              <Clipboard className="mr-2 h-4 w-4" />
              Copiar tudo
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-5">
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4">
          <LogPanel
            title="STT / Python"
            description="Log do serviço Python usado para transcrição e TTS."
            icon={Gauge}
            log={logs.stt}
          />

          <LogPanel
            title="Backend / Electron"
            description="Log do servidor local, inicialização e eventos do shell desktop."
            icon={Server}
            log={logs.backend}
          />
        </div>
      </CardContent>
    </Card>
  );
}
