// src/components/ToolsTab.jsx
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

import AutomationTool from "@/components/tools/AutomationTool";
import NiceIntegrationTool from "@/components/tools/NiceIntegrationTool";

import { Wrench, Mic, Sparkles, Workflow, Link2 } from "lucide-react";

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
    desc: "Gere preview em MP3 e baixe em WAV μ-law 8k mono (padrão URA NICE).",
    icon: Sparkles,
    status: "ativo",
  },
  {
    id: "automacao",
    title: "Automação",
    desc: "Crie fluxos de automação por ticket (gatilhos → ações) com ReactFlow.",
    icon: Workflow,
    status: "ativo",
  },
  {
    id: "nice",
    title: "Integração NICE",
    desc: "Conexão com o Contact Center (cluster 1/2) via backend → serviço Puppeteer.",
    icon: Link2,
    status: "ativo",
  },
];

function toolButtonClasses(active) {
  return cn(
    "rounded-xl border px-3 py-2 text-sm font-medium transition",
    "hover:bg-zinc-50",
    active
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-zinc-200 bg-white text-zinc-800",
  );
}

export default function ToolsTab() {
  const [activeTool, setActiveTool] = useState("transcricao");

  // health do serviço Python (via proxy do Node)
  const [sttOnline, setSttOnline] = useState(null); // null = carregando/desconhecido
  const [sttLatencyMs, setSttLatencyMs] = useState(null);
  const [sttLastCheck, setSttLastCheck] = useState(null);
  const [sttError, setSttError] = useState(null);

  const active = useMemo(
    () => TOOL_DEFS.find((t) => t.id === activeTool) || TOOL_DEFS[0],
    [activeTool],
  );

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
  }, []);

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
          : "Verificando…"}
    </Badge>
  );

  return (
    <TooltipProvider>
      <motion.section
        key="tools"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 12 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        className="w-full"
      >
        <div className="mx-auto max-w-7xl px-2 py-4">
          {/* Header do módulo */}
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-red-600 to-red-700 text-white shadow-sm">
                <Wrench className="h-5 w-5" />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
                    Ferramentas
                  </h2>
                  <Badge className="border border-red-200 bg-red-50 text-red-700">
                    URA
                  </Badge>
                  {healthBadge}
                </div>

                <div className="text-sm text-zinc-600">
                  Central de utilitários para acelerar desenvolvimento e
                  padronização.
                </div>
              </div>
            </div>

            {/* Navegação das ferramentas */}
            <div className="flex flex-wrap items-center gap-2">
              {TOOL_DEFS.map((t) => {
                const Icon = t.icon;
                const disabled = t.status !== "ativo";
                const isActive = activeTool === t.id;

                const btn = (
                  <button
                    type="button"
                    className={toolButtonClasses(isActive)}
                    onClick={() => !disabled && setActiveTool(t.id)}
                    aria-pressed={isActive}
                    disabled={disabled}
                    style={{ opacity: disabled ? 0.55 : 1 }}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {t.title}
                      {disabled && (
                        <span className="ml-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                          Em breve
                        </span>
                      )}
                    </span>
                  </button>
                );

                return disabled ? (
                  <Tooltip key={t.id}>
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent>Em breve</TooltipContent>
                  </Tooltip>
                ) : (
                  <React.Fragment key={t.id}>{btn}</React.Fragment>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4">
            <Card className="rounded-2xl border-zinc-200">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base text-zinc-900">
                      {active.title}
                    </CardTitle>
                    <CardDescription className="text-sm">
                      {active.desc}
                    </CardDescription>
                  </div>

                  {/* REMOVIDO: "Ativo" (evita confusão). Mantém apenas Online/Offline no header do módulo. */}
                </div>
              </CardHeader>

              <CardContent>
                {activeTool === "transcricao" ? (
                  <AudioTranscriptionTool serviceOnline={sttOnline === true} />
                ) : activeTool === "tts" ? (
                  <TextToSpeechTool serviceOnline={sttOnline === true} />
                ) : activeTool === "automacao" ? (
                  <AutomationTool />
                ) : activeTool === "nice" ? (
                  <NiceIntegrationTool />
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center">
                    <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-sm">
                      <Sparkles className="h-6 w-6 text-zinc-700" />
                    </div>
                    <div className="text-sm font-semibold text-zinc-900">
                      Em breve
                    </div>
                    <div className="mx-auto mt-1 max-w-xl text-sm text-zinc-600">
                      Esta ferramenta será adicionada futuramente dentro da aba{" "}
                      <strong>Ferramentas</strong>.
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </motion.section>
    </TooltipProvider>
  );
}
