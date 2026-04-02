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
import {
  TooltipProvider,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  EmptyState,
  ModuleHeader,
  SectionCard,
} from "@/components/layout/ModulePrimitives";

import AutomationTool from "@/components/tools/AutomationTool";
import NiceIntegrationTool from "@/components/tools/NiceIntegrationTool";

import { Mic, Sparkles, Workflow, Link2 } from "lucide-react";

import AudioTranscriptionTool from "@/components/tools/AudioTranscriptionTool";
import TextToSpeechTool from "@/components/tools/TextToSpeechTool";

const TOOL_DEFS = [
  {
    id: "transcricao",
    title: "Transcrição de Áudio",
    desc: "Transforme áudio em texto para especificação e evolução de URA.",
    icon: Mic,
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
    id: "automacao",
    title: "Automação",
    desc: "Crie fluxos de automação por ticket com gatilhos, decisões e ações.",
    icon: Workflow,
    status: "ativo",
  },
  {
    id: "nice",
    title: "Integração NICE",
    desc: "Conecte com o Contact Center por cluster com uma visão mais segura do serviço.",
    icon: Link2,
    status: "ativo",
  },
];

export default function ToolsTab() {
  const [activeTool, setActiveTool] = useState("transcricao");
  const [sttOnline, setSttOnline] = useState(null);
  const [sttLatencyMs, setSttLatencyMs] = useState(null);
  const [sttLastCheck, setSttLastCheck] = useState(null);
  const [sttError, setSttError] = useState(null);

  const active = useMemo(
    () => TOOL_DEFS.find((t) => t.id === activeTool) || TOOL_DEFS[0],
    [activeTool]
  );

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
            : j?.error || `Upstream status: ${j?.upstreamStatus || r.status}`
        );
      } catch (err) {
        if (!mounted) return;
        setSttOnline(false);
        setSttLatencyMs(null);
        setSttLastCheck(new Date());
        setSttError(
          err?.name === "AbortError"
            ? "Timeout no health-check"
            : String(err?.message || err)
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
  }, []);

  const healthBadge = (
    <Badge
      className={cn(
        "border",
        sttOnline === true && "border-green-200 bg-green-50 text-green-700",
        sttOnline === false && "border-red-200 bg-red-50 text-red-700",
        sttOnline == null && "border-zinc-200 bg-zinc-50 text-zinc-700"
      )}
    >
      {sttOnline === true
        ? "Serviços online"
        : sttOnline === false
          ? "Serviços offline"
          : "Verificando..."}
    </Badge>
  );

  function renderActiveTool() {
    if (activeTool === "transcricao") {
      return <AudioTranscriptionTool serviceOnline={sttOnline === true} />;
    }

    if (activeTool === "tts") {
      return <TextToSpeechTool serviceOnline={sttOnline === true} />;
    }

    if (activeTool === "automacao") {
      return <AutomationTool />;
    }

    if (activeTool === "nice") {
      return <NiceIntegrationTool />;
    }

    return (
      <EmptyState
        title="Em breve"
        description="Esta ferramenta será adicionada futuramente dentro da aba Ferramentas."
      />
    );
  }

  return (
    <TooltipProvider>
      <motion.section
        key="tools"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 12 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        className="w-full tools-module"
      >
        <div className="mx-auto max-w-7xl px-2 py-4 tools-shell">
          <ModuleHeader
            eyebrow="Utilitários"
            title="Ferramentas"
            description="Escolha a ferramenta e siga direto para a execução."
            badge="URA"
            nextStep={null}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600">
                  <span className="font-semibold text-zinc-900">{active.title}</span>
                </div>
                {healthBadge}
              </div>
            }
          />

          <SectionCard
            title="Ferramentas disponíveis"
            description="Selecione uma opção para abrir a área de trabalho."
            contentClassName="grid gap-3 md:grid-cols-2"
          >
            {TOOL_DEFS.map((tool) => {
              const Icon = tool.icon;
              const isActive = tool.id === activeTool;
              const disabled = tool.status !== "ativo";

              const card = (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => !disabled && setActiveTool(tool.id)}
                  aria-pressed={isActive}
                  disabled={disabled}
                  className={cn(
                    "rounded-[18px] border p-4 text-left transition",
                    isActive
                      ? "border-red-200 bg-red-50 shadow-sm"
                      : "border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm",
                    disabled && "opacity-60"
                  )}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-xl bg-zinc-50 text-zinc-900">
                      <Icon className="h-4.5 w-4.5" />
                    </div>

                    {disabled ? (
                      <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
                        Em breve
                      </Badge>
                    ) : isActive ? (
                      <Badge className="border border-red-200 bg-red-100 text-red-700">
                        Em uso
                      </Badge>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-zinc-900">
                      {tool.title}
                    </div>
                    <div className="text-sm leading-5 text-zinc-600 line-clamp-2">
                      {tool.desc}
                    </div>
                  </div>
                </button>
              );

              return disabled ? (
                <Tooltip key={tool.id}>
                  <TooltipTrigger asChild>{card}</TooltipTrigger>
                  <TooltipContent>Em breve</TooltipContent>
                </Tooltip>
              ) : (
                card
              );
            })}
          </SectionCard>

          {sttOnline === false ? (
            <EmptyState
              title={healthSummary.title}
              description={healthSummary.description}
              tone="warning"
            />
          ) : null}

          <div className="grid gap-4">
            <Card className="rounded-2xl border-zinc-200">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="text-base text-zinc-900">
                      {active.title}
                    </CardTitle>
                    <CardDescription className="text-sm">
                      {active.desc}
                    </CardDescription>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                      <span className="font-medium text-zinc-900">Status:</span>{" "}
                      {healthSummary.title}
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                      <span className="font-medium text-zinc-900">Última verificação:</span>{" "}
                      {sttLastCheck
                        ? sttLastCheck.toLocaleTimeString("pt-BR")
                        : "Aguardando"}
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent>{renderActiveTool()}</CardContent>
            </Card>
          </div>
        </div>
      </motion.section>
    </TooltipProvider>
  );
}
