import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EmptyState, ModuleHeader } from "@/components/layout/ModulePrimitives";

import AutomationTool from "@/components/tools/AutomationTool";
import AudioComparatorTool from "@/components/tools/AudioComparatorTool";
import AudioValidatorTool from "@/components/tools/AudioValidatorTool";

import { BarChart3, ChevronDown, Database, FileAudio, FileSearch, Mic, Sparkles, Workflow } from "lucide-react";

import AudioTranscriptionTool from "@/components/tools/AudioTranscriptionTool";
import TextToSpeechTool from "@/components/tools/TextToSpeechTool";
import CdrSearchTool from "@/components/tools/CdrSearchTool";
import CdrAnalyticsTool from "@/components/tools/CdrAnalyticsTool";

const TOOL_DEFS = [
  {
    id: "transcricao",
    title: "Transcrição de Áudio",
    desc: "Transforme áudio em texto para especificação e evolução de URA.",
    icon: Mic,
    status: "ativo",
  },
  {
    id: "audio-comparator",
    title: "Comparador de Audio URA",
    desc: "Compare a transcricao dos audios com o roteiro aprovado do projeto.",
    icon: FileSearch,
    status: "ativo",
  },
  {
    id: "tts",
    title: "TTS (Texto → Áudio)",
    desc: "Gere preview em MP3 e baixe em WAV μ-law 8k mono, no padrão de URA NICE.",
    icon: Sparkles,
    status: "ativo",
  },
  {
    id: "audio-validator",
    title: "Validador de Áudios URA",
    desc: "Valide e converta áudios em massa para WAV μ-law 8k mono.",
    icon: FileAudio,
    status: "ativo",
  },
  {
    id: "automacao",
    title: "Automação",
    desc: "Crie fluxos de automação por ticket com gatilhos, decisões e ações.",
    icon: Workflow,
    status: "ativo",
  },
  {
    id: "cdr",
    title: "Consulta CDR",
    desc: "Autentique no Portal ICC e consulte CDR com filtros operacionais.",
    icon: Database,
    status: "ativo",
  },
  {
    id: "cdr-analytics",
    title: "Dashboard CDR",
    desc: "Baixe o CSV do Portal ICC e visualize estatisticas por DDD, DNA, duracao e transferencias.",
    icon: BarChart3,
    status: "ativo",
  },
];

function CompactAccordion({
  title,
  description,
  icon: Icon,
  meta,
  defaultOpen = true,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className="overflow-hidden rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="p-0">
        <button
          type="button"
          className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition hover:bg-zinc-50 md:px-5"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <div className="flex min-w-0 items-start gap-3">
            {Icon ? (
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700">
                <Icon className="h-4.5 w-4.5" />
              </div>
            ) : null}

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="truncate text-base text-zinc-900">
                  {title}
                </CardTitle>
                {meta}
              </div>
              {description ? (
                <CardDescription className="mt-1 line-clamp-2 text-sm">
                  {description}
                </CardDescription>
              ) : null}
            </div>
          </div>

          <ChevronDown
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-zinc-500 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </CardHeader>

      {open ? <CardContent className="px-4 pb-4 pt-0 md:px-5">{children}</CardContent> : null}
    </Card>
  );
}

function ToolPickerAccordion({ tools, activeTool, onSelect }) {
  const [open, setOpen] = useState(true);

  return (
    <Card className="overflow-hidden rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-5">
          <div className="flex min-w-0 flex-wrap gap-2">
            {tools.map((tool) => {
              const Icon = tool.icon;
              const isActive = tool.id === activeTool;

              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => onSelect(tool.id)}
                  aria-label={tool.title}
                  aria-pressed={isActive}
                  title={tool.title}
                  className={cn(
                    "grid h-11 w-11 place-items-center rounded-2xl border transition",
                    isActive
                      ? "border-red-200 bg-red-50 text-red-700 shadow-sm"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-red-100 hover:bg-red-50 hover:text-red-700",
                  )}
                >
                  <Icon className="h-5 w-5" />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-50"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? "Recolher ferramentas" : "Expandir ferramentas"}
          >
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
            />
          </button>
        </div>
      </CardHeader>

      {open ? (
        <CardContent className="px-4 pb-4 pt-0 md:px-5">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {tools.map((tool) => {
              const isActive = tool.id === activeTool;

              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => onSelect(tool.id)}
                  aria-pressed={isActive}
                  className={cn(
                    "group min-h-[82px] min-w-0 rounded-2xl border p-3 text-left transition",
                    isActive
                      ? "border-red-200 bg-red-50 shadow-sm"
                      : "border-zinc-200 bg-white hover:border-red-100 hover:bg-zinc-50 hover:shadow-sm",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-semibold text-zinc-900">
                        {tool.title}
                      </div>
                      {isActive ? (
                        <Badge className="shrink-0 border border-red-200 bg-white text-red-700">
                          Em uso
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600">
                      {tool.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

export default function ToolsTab() {
  const [activeTool, setActiveTool] = useState("transcricao");
  const [sttOnline, setSttOnline] = useState(null);
  const [sttLatencyMs, setSttLatencyMs] = useState(null);
  const [sttLastCheck, setSttLastCheck] = useState(null);
  const [sttError, setSttError] = useState(null);

  const active = useMemo(
    () => TOOL_DEFS.find((t) => t.id === activeTool) || TOOL_DEFS[0],
    [activeTool],
  );
  const ActiveIcon = active.icon;
  const usesSttHealth = !["automacao", "cdr", "cdr-analytics"].includes(activeTool);

  const healthSummary = useMemo(() => {
    if (sttOnline === true) {
      return {
        title: "Serviços online",
        description: sttLatencyMs
          ? `Último health-check em ${sttLatencyMs} ms.`
          : "Os serviços críticos responderam normalmente.",
      };
    }

    if (sttOnline === false) {
      return {
        title: "Verificar integração",
        description:
          sttError || "O health-check falhou e pode impactar transcrição e TTS.",
      };
    }

    return {
      title: "Verificando serviços",
      description: "Executando health-check para validar disponibilidade.",
    };
  }, [sttError, sttLatencyMs, sttOnline]);

  useEffect(() => {
    if (!usesSttHealth) {
      return undefined;
    }

    let mounted = true;
    let intervalId = null;

    async function checkHealth() {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3500);

      try {
        const r = await fetch("/api/stt/health", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });

        const j = await r.json().catch(() => null);
        if (!mounted) return;

        const ok = !!(j?.ok && r.ok);
        setSttOnline(ok);
        setSttLatencyMs(typeof j?.latencyMs === "number" ? j.latencyMs : null);
        setSttLastCheck(new Date());
        setSttError(
          ok
            ? null
            : j?.error || `Upstream status: ${j?.upstreamStatus || r.status}`,
        );
      } catch (err) {
        if (!mounted) return;
        setSttOnline(false);
        setSttLatencyMs(null);
        setSttLastCheck(new Date());
        setSttError(
          err?.name === "AbortError"
            ? "Timeout no health-check"
            : String(err?.message || err),
        );
      } finally {
        clearTimeout(t);
      }
    }

    checkHealth();
    intervalId = window.setInterval(checkHealth, 30_000);

    return () => {
      mounted = false;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [usesSttHealth]);

  const healthBadge = (
    <Badge
      className={cn(
        "border",
        sttOnline === true && "border-green-200 bg-green-50 text-green-700",
        sttOnline === false && "border-red-200 bg-red-50 text-red-700",
        sttOnline == null && "border-zinc-200 bg-zinc-50 text-zinc-700",
      )}
    >
      {sttOnline === true
        ? "Serviços online"
        : sttOnline === false
          ? "Serviços offline"
          : "Verificando..."}
    </Badge>
  );
  const toolStatusBadge = usesSttHealth ? (
    healthBadge
  ) : (
    <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
      {["cdr", "cdr-analytics"].includes(activeTool) ? "Portal ICC" : "Local"}
    </Badge>
  );

  function renderActiveTool() {
    if (activeTool === "transcricao") {
      return <AudioTranscriptionTool serviceOnline={sttOnline === true} />;
    }

    if (activeTool === "audio-comparator") {
      return <AudioComparatorTool serviceOnline={sttOnline === true} />;
    }

    if (activeTool === "tts") {
      return <TextToSpeechTool serviceOnline={sttOnline === true} />;
    }

    if (activeTool === "audio-validator") {
      return <AudioValidatorTool serviceOnline={sttOnline === true} />;
    }

    if (activeTool === "automacao") {
      return <AutomationTool />;
    }

    if (activeTool === "cdr") {
      return <CdrSearchTool />;
    }

    if (activeTool === "cdr-analytics") {
      return <CdrAnalyticsTool />;
    }

    return (
      <EmptyState
        title="Em breve"
        description="Esta ferramenta será adicionada futuramente dentro da aba Ferramentas."
      />
    );
  }

  return (
    <motion.section
      key="tools"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.25, ease: "easeInOut" }}
      className="w-full tools-module"
    >
      <div className="mx-auto grid max-w-7xl gap-4 px-2 py-4 tools-shell">
        <ModuleHeader
          eyebrow="Utilitários"
          title="Ferramentas"
          description="Escolha uma ferramenta e siga direto para a execução."
          badge="URA"
          nextStep={null}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex max-w-full items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
                <ActiveIcon className="h-4 w-4 shrink-0 text-red-600" />
                <span className="truncate font-semibold text-zinc-900">{active.title}</span>
              </div>
              {toolStatusBadge}
            </div>
          }
        />

        <ToolPickerAccordion
          tools={TOOL_DEFS}
          activeTool={activeTool}
          onSelect={setActiveTool}
        />

        {usesSttHealth && sttOnline === false ? (
          <EmptyState
            title={healthSummary.title}
            description={healthSummary.description}
            tone="warning"
          />
        ) : null}

        <CompactAccordion
          title="Área de trabalho"
          description={active.desc}
          icon={ActiveIcon}
          meta={
            <Badge className="border border-red-200 bg-red-50 text-red-700">
              {active.title}
            </Badge>
          }
        >
          <div className="mb-4 flex flex-wrap gap-2 text-xs text-zinc-500">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
              <span className="font-medium text-zinc-900">Status:</span>{" "}
              {usesSttHealth ? healthSummary.title : "Pronto para uso"}
            </div>
            {usesSttHealth ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                <span className="font-medium text-zinc-900">Última verificação:</span>{" "}
                {sttLastCheck ? sttLastCheck.toLocaleTimeString("pt-BR") : "Aguardando"}
              </div>
            ) : null}
          </div>

          {renderActiveTool()}
        </CompactAccordion>
      </div>
    </motion.section>
  );
}
