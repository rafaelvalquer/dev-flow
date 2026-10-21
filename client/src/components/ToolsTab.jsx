import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/layout/ModulePrimitives";

import AutomationTool from "@/components/tools/AutomationTool";
import AudioComparatorTool from "@/components/tools/AudioComparatorTool";
import AudioValidatorTool from "@/components/tools/AudioValidatorTool";
import AudioTranscriptionTool from "@/components/tools/AudioTranscriptionTool";
import TextToSpeechTool from "@/components/tools/TextToSpeechTool";
import CdrSearchTool from "@/components/tools/CdrSearchTool";
import CdrAnalyticsTool from "@/components/tools/CdrAnalyticsTool";
import TaskFileSearchTool from "@/components/tools/TaskFileSearchTool";
import BusinessHoursTool from "@/components/tools/BusinessHoursTool";
import UraDocsTab from "@/components/UraDocsTab/UraDocsTab";

import {
  BarChart3,
  CalendarClock,
  Check,
  ChevronDown,
  Database,
  FileAudio,
  FileSearch,
  FileText,
  Mic,
  Search,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";

const MotionSection = motion.section;

const TOOL_CATEGORIES = [
  { id: "ura-audio", label: "URA e Áudio" },
  { id: "portal-icc", label: "Portal ICC" },
  { id: "automation", label: "Automação" },
];

const TOOL_DEFS = [
  {
    id: "ura-docs",
    category: "ura-audio",
    title: "Documentador URA NICE",
    desc: "Gere documentação, draw.io, matrizes e análise inteligente a partir do NICE Studio.",
    icon: FileText,
  },
  {
    id: "transcricao",
    category: "ura-audio",
    title: "Transcrição de Áudio",
    desc: "Transforme áudio em texto para especificação e evolução de URA.",
    icon: Mic,
  },
  {
    id: "audio-comparator",
    category: "ura-audio",
    title: "Comparador de Áudio URA",
    desc: "Compare a transcrição dos áudios com o roteiro aprovado do projeto.",
    icon: FileSearch,
  },
  {
    id: "tts",
    category: "ura-audio",
    title: "TTS (Texto → Áudio)",
    desc: "Gere preview em MP3 e baixe em WAV μ-law 8k mono, no padrão de URA NICE.",
    icon: Sparkles,
  },
  {
    id: "audio-validator",
    category: "ura-audio",
    title: "Validador de Áudios URA",
    desc: "Valide e converta áudios em massa para WAV μ-law 8k mono.",
    icon: FileAudio,
  },
  {
    id: "cdr",
    category: "portal-icc",
    title: "Consulta CDR",
    desc: "Autentique no Portal ICC e consulte CDR com filtros operacionais.",
    icon: Database,
  },
  {
    id: "cdr-analytics",
    category: "portal-icc",
    title: "Dashboard CDR",
    desc: "Baixe o CSV do Portal ICC e visualize estatísticas por DDD, DNA, duração e transferências.",
    icon: BarChart3,
  },
  {
    id: "task-file-search",
    category: "portal-icc",
    title: "Busca Tarefas ICC",
    desc: "Pesquise tarefas do Portal ICC por Arquivo e Remoto na etapa principal.",
    icon: FileSearch,
  },
  {
    id: "business-hours",
    category: "portal-icc",
    title: "Feriados e Fechamentos",
    desc: "Selecione URAs, configure datas especiais e gere inserts tb_bussinesshours.",
    icon: CalendarClock,
  },
  {
    id: "automacao",
    category: "automation",
    title: "Automação",
    desc: "Crie fluxos de automação por ticket com gatilhos, decisões e ações.",
    icon: Workflow,
  },
];

function ToolNavigation({ activeTool, onSelect }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");

  const filteredTools = useMemo(() => {
    if (!normalizedQuery) return TOOL_DEFS;

    return TOOL_DEFS.filter((tool) =>
      `${tool.title} ${tool.desc}`.toLocaleLowerCase("pt-BR").includes(normalizedQuery),
    );
  }, [normalizedQuery]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar ferramenta..."
          aria-label="Buscar ferramenta"
          className="h-9 w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-9 pr-8 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-red-300 focus:bg-white focus:ring-2 focus:ring-red-100"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Limpar busca"
            className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-lg text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {filteredTools.length ? (
        <nav aria-label="Ferramentas" className="mt-3 space-y-3">
          {TOOL_CATEGORIES.map((category) => {
            const categoryTools = filteredTools.filter(
              (tool) => tool.category === category.id,
            );
            if (!categoryTools.length) return null;

            return (
              <div key={category.id}>
                <div className="mb-1 px-1">
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                    {category.label}
                  </h3>
                </div>

                <div className="space-y-1">
                  {categoryTools.map((tool) => {
                    const Icon = tool.icon;
                    const isActive = tool.id === activeTool;

                    return (
                      <button
                        key={tool.id}
                        type="button"
                        onClick={() => onSelect(tool.id)}
                        aria-pressed={isActive}
                        title={tool.desc}
                        className={cn(
                          "group flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition",
                          isActive
                            ? "border-red-200 bg-red-50 text-red-800 shadow-sm"
                            : "border-transparent text-zinc-700 hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-950",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-7 w-7 shrink-0 place-items-center rounded-md border transition",
                            isActive
                              ? "border-red-200 bg-white text-red-600"
                              : "border-zinc-200 bg-white text-zinc-500 group-hover:text-red-600",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                          {tool.title}
                        </span>
                        {isActive ? <Check className="h-3.5 w-3.5 shrink-0 text-red-600" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-5 text-center">
          <Search className="mx-auto h-5 w-5 text-zinc-300" />
          <p className="mt-2 text-xs font-semibold text-zinc-700">Nenhuma ferramenta encontrada</p>
          <p className="mt-1 text-[11px] text-zinc-500">Tente outro nome ou termo.</p>
        </div>
      )}
    </div>
  );
}

function ResponsiveToolNavigation({ activeTool, onSelect }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  function selectTool(toolId) {
    onSelect(toolId);
    setMobileOpen(false);
  }

  return (
    <>
      <Card className="hidden self-start rounded-xl border-zinc-200 bg-white shadow-sm lg:sticky lg:top-4 lg:block">
        <CardContent className="p-2.5">
          <ToolNavigation activeTool={activeTool} onSelect={onSelect} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-xl border-zinc-200 bg-white shadow-sm lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((value) => !value)}
          aria-expanded={mobileOpen}
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-zinc-50 text-red-600">
            <Workflow className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 text-sm font-semibold text-zinc-900">
            Trocar ferramenta
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-zinc-500 transition-transform",
              mobileOpen && "rotate-180",
            )}
          />
        </button>
        {mobileOpen ? (
          <CardContent className="border-t border-zinc-100 px-3 pb-3 pt-3">
            <ToolNavigation activeTool={activeTool} onSelect={selectTool} />
          </CardContent>
        ) : null}
      </Card>
    </>
  );
}

export default function ToolsTab() {
  const [activeTool, setActiveTool] = useState("transcricao");
  const [sttOnline, setSttOnline] = useState(null);

  const portalIccTools = ["cdr", "cdr-analytics", "task-file-search", "business-hours"];
  const usesSttHealth = !["automacao", "business-hours", ...portalIccTools].includes(activeTool);

  useEffect(() => {
    if (!usesSttHealth) return undefined;

    let mounted = true;
    let intervalId = null;

    async function checkHealth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      try {
        const response = await fetch("/api/stt/health", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null);
        if (!mounted) return;

        const ok = Boolean(data?.ok && response.ok);
        setSttOnline(ok);
      } catch {
        if (!mounted) return;
        setSttOnline(false);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    checkHealth();
    intervalId = window.setInterval(checkHealth, 30_000);

    return () => {
      mounted = false;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [usesSttHealth]);

  function renderActiveTool() {
    if (activeTool === "transcricao") return <AudioTranscriptionTool serviceOnline={sttOnline === true} />;
    if (activeTool === "audio-comparator") return <AudioComparatorTool serviceOnline={sttOnline === true} />;
    if (activeTool === "tts") return <TextToSpeechTool serviceOnline={sttOnline === true} />;
    if (activeTool === "audio-validator") return <AudioValidatorTool serviceOnline={sttOnline === true} />;
    if (activeTool === "automacao") return <AutomationTool />;
    if (activeTool === "cdr") return <CdrSearchTool />;
    if (activeTool === "cdr-analytics") return <CdrAnalyticsTool />;
    if (activeTool === "task-file-search") return <TaskFileSearchTool />;
    if (activeTool === "business-hours") return <BusinessHoursTool />;
    if (activeTool === "ura-docs") return <UraDocsTab />;

    return <EmptyState title="Em breve" description="Esta ferramenta será adicionada futuramente." />;
  }

  return (
    <MotionSection
      key="tools"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.25, ease: "easeInOut" }}
      className="w-full tools-module"
    >
      <div className="mx-auto grid max-w-[1600px] gap-3 px-2 py-3 tools-shell">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[216px_minmax(0,1fr)] lg:items-start">
          <ResponsiveToolNavigation activeTool={activeTool} onSelect={setActiveTool} />

          <main className="min-w-0 overflow-hidden">
            {renderActiveTool()}
          </main>
        </div>
      </div>
    </MotionSection>
  );
}
