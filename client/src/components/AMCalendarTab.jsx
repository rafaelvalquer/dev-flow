// src/components/AMCalendarTab.jsx
import { memo, useMemo, useState, useCallback } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { Loader2, Search } from "lucide-react";

import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";

import AMCalendarDashboard from "./AMCalendarDashboard";

/* =========================
   HELPERS
========================= */
function cn(...a) {
  return a.filter(Boolean).join(" ");
}

function normalizeStr(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function groupAtividadeName(rawName) {
  const original = String(rawName || "").trim();
  if (!original) return "sem atividade";

  // 1) remove conteúdo entre parênteses "(...)"
  let s = original.replace(/\([^)]*\)/g, " ");

  // 2) corta sufixos após "-" ou ":"  (ex: "AAA - BBB" -> "AAA")
  s = s.replace(/\s*[-:]\s*.*$/g, " ");

  // 3) normaliza espaços
  s = s.replace(/\s+/g, " ").trim();

  // 4) normalização final: sem acento + lowercase + trim
  const key = normalizeStr(s || original)
    .replace(/\s+/g, " ")
    .trim();

  return key || "sem atividade";
}

function hashStringToIndex(str, mod) {
  const s = String(str || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return mod ? h % mod : 0;
}

function pickTextColor(hex) {
  const c = String(hex || "").replace("#", "");
  if (c.length !== 6) return "#fff";
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.62 ? "#111827" : "#ffffff";
}

/* =========================
   COMPONENT
========================= */
export default memo(function AMCalendarTab({
  viewData,
  busy,
  colorMode,
  setColorMode,
  calendarFilter,
  setCalendarFilter,
  onPersistEventChange,
}) {
  // ===== Range visível do FullCalendar (para o dashboard abaixo)
  const [visibleRange, setVisibleRange] = useState(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end };
  });

  const onDatesSet = useCallback((arg) => {
    // FullCalendar fornece start/end do range visível
    if (arg?.start && arg?.end) {
      setVisibleRange({ start: arg.start, end: arg.end });
    }
  }, []);

  // ===== Cores estáveis
  const CALENDAR_PALETTE = [
    "#2563EB",
    "#7C3AED",
    "#DB2777",
    "#DC2626",
    "#EA580C",
    "#D97706",
    "#059669",
    "#0EA5E9",
    "#14B8A6",
    "#16A34A",
    "#9333EA",
    "#E11D48",
    "#F97316",
    "#84CC16",
    "#06B6D4",
  ];

  // ✅ CORES FIXAS por atividade (modo "Por Atividade")
  const ATIVIDADE_COLOR_BY_ID = {
    devUra: "#2563EB",
    rdm: "#7C3AED",
    gmud: "#F59E0B",
    hml: "#4F46E5",
    deploy: "#16A34A",
  };

  const ATIVIDADE_LABEL_BY_ID = {
    devUra: "Desenvolvimento de URA",
    rdm: "Preenchimento RDM",
    gmud: "Aprovação GMUD",
    hml: "Homologação",
    deploy: "Implantação",
  };

  function pickColor(key) {
    const k = String(key || "—");
    const idx = hashStringToIndex(k, CALENDAR_PALETTE.length);
    return CALENDAR_PALETTE[idx];
  }

  // ===== monta calendarEvents garantindo extendedProps.recurso
  const calendarEvents = useMemo(() => {
    const evs = Array.isArray(viewData?.events) ? viewData.events : [];
    const issues = Array.isArray(viewData?.calendarioIssues)
      ? viewData.calendarioIssues
      : [];

    const recursoIndex = new Map();

    for (const iss of issues) {
      const issueKey = iss?.key;
      const atividades = Array.isArray(iss?.atividades) ? iss.atividades : [];

      for (const atv of atividades) {
        const activityId = atv?.id;
        const activityNameKey = groupAtividadeName(atv?.name);

        if (issueKey && activityId) {
          recursoIndex.set(`${issueKey}::${activityId}`, atv?.recurso);
        }

        if (issueKey && activityNameKey) {
          recursoIndex.set(
            `${issueKey}::name::${activityNameKey}`,
            atv?.recurso
          );
        }
      }
    }

    return evs.map((ev) => {
      const p = ev?.extendedProps || {};
      const issueKey = p.issueKey || ev?.issueKey;
      const activityId = p.activityId;

      const recursoFromAtividade = recursoIndex.get(
        `${issueKey}::${activityId}`
      );

      const recurso =
        String(recursoFromAtividade || "").trim() || "Sem recurso";

      return {
        ...ev,
        extendedProps: {
          ...p,
          issueKey,
          activityId,
          recurso,
        },
      };
    });
  }, [viewData?.events, viewData?.calendarioIssues]);

  // chave de cor por modo
  function getColorKeyByMode(ev, mode) {
    const p = ev?.extendedProps || {};

    if (mode === "ticket") return p.issueKey || ev?.issueKey || "—";
    if (mode === "recurso") return p.recurso || "Sem recurso";

    if (mode === "atividade") {
      if (p.activityId) return String(p.activityId);

      const fullName = p.activityName || p.atividade || ev?.title || "";
      return groupAtividadeName(fullName);
    }

    return "—";
  }

  // mapa estável (legend + consistência)
  const colorMaps = useMemo(() => {
    const maps = {
      ticket: new Map(),
      recurso: new Map(),
      atividade: new Map(),
    };

    for (const ev of calendarEvents) {
      for (const mode of ["ticket", "recurso", "atividade"]) {
        const k = String(getColorKeyByMode(ev, mode) || "—");
        if (!maps[mode].has(k)) {
          const fixed = mode === "atividade" ? ATIVIDADE_COLOR_BY_ID[k] : null;
          maps[mode].set(k, fixed || pickColor(k));
        }
      }
    }

    return maps;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarEvents]);

  // aplica cor nos eventos
  const coloredEvents = useMemo(() => {
    const map = colorMaps[colorMode] || new Map();

    return calendarEvents.map((ev) => {
      const colorKey = String(getColorKeyByMode(ev, colorMode) || "—");
      const color = map.get(colorKey) || pickColor(colorKey);

      return {
        ...ev,
        backgroundColor: color,
        borderColor: color,
        textColor: pickTextColor(color),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarEvents, colorMode, colorMaps]);

  // filtro: ticket / atividade / recurso
  const filteredEvents = useMemo(() => {
    const q = normalizeStr(calendarFilter);
    if (!q) return coloredEvents;

    return coloredEvents.filter((ev) => {
      const p = ev?.extendedProps || {};
      const hay = normalizeStr(
        [p.issueKey, p.activityName, p.recurso, ev?.title]
          .filter(Boolean)
          .join(" ")
      );
      return hay.includes(q);
    });
  }, [coloredEvents, calendarFilter]);

  // legenda
  const calendarLegend = useMemo(() => {
    const m = colorMaps[colorMode] || new Map();
    const entries = Array.from(m.entries()).sort((a, b) =>
      String(a[0]).localeCompare(String(b[0]))
    );
    const top = entries.slice(0, 8);
    const rest = entries.length - top.length;
    return { top, rest };
  }, [colorMaps, colorMode]);

  return (
    <TooltipProvider>
      <section className="grid gap-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">
                Calendário
              </h2>
              <p className="text-xs text-zinc-500">
                Arraste para mudar data e redimensione para alterar intervalo.
              </p>
            </div>

            <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
              {/* filtro */}
              <div className="relative w-full md:w-[360px]">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                <Input
                  value={calendarFilter}
                  onChange={(e) => setCalendarFilter(e.target.value)}
                  placeholder="Buscar por ticket, atividade ou recurso..."
                  className="h-10 rounded-xl border-zinc-200 bg-white pl-9 focus-visible:ring-red-500"
                />
              </div>

              {/* 3 modos de cor */}
              <div className="inline-flex w-full md:w-auto items-center rounded-xl border border-zinc-200 bg-zinc-50 p-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setColorMode("ticket")}
                  className={cn(
                    "h-9 rounded-lg px-3 text-xs font-semibold",
                    colorMode === "ticket"
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "text-zinc-700 hover:bg-white/70"
                  )}
                >
                  Por Ticket
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setColorMode("recurso")}
                  className={cn(
                    "h-9 rounded-lg px-3 text-xs font-semibold",
                    colorMode === "recurso"
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "text-zinc-700 hover:bg-white/70"
                  )}
                >
                  Por Recurso
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setColorMode("atividade")}
                  className={cn(
                    "h-9 rounded-lg px-3 text-xs font-semibold",
                    colorMode === "atividade"
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "text-zinc-700 hover:bg-white/70"
                  )}
                >
                  Por Atividade
                </Button>
              </div>
            </div>
          </div>

          {/* Legenda curta */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {calendarLegend.top.map(([label, color]) => {
              const pretty =
                colorMode === "atividade"
                  ? ATIVIDADE_LABEL_BY_ID[label] || label
                  : label;

              return (
                <Tooltip key={label}>
                  <TooltipTrigger asChild>
                    <Badge
                      className="cursor-default rounded-full border border-zinc-200 bg-white text-zinc-700"
                      title={pretty}
                    >
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="max-w-[160px] truncate">{pretty}</span>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[380px]">
                    {pretty}
                  </TooltipContent>
                </Tooltip>
              );
            })}

            {calendarLegend.rest > 0 && (
              <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                +{calendarLegend.rest}
              </Badge>
            )}
          </div>

          <div className="overflow-x-auto">
            <div className="relative">
              <FullCalendar
                plugins={[dayGridPlugin, interactionPlugin]}
                initialView="dayGridMonth"
                height="auto"
                editable={!busy}
                eventStartEditable={!busy}
                eventDurationEditable={!busy}
                eventAllow={() => !busy}
                selectable={false}
                events={filteredEvents}
                eventDrop={onPersistEventChange}
                eventResize={onPersistEventChange}
                firstDay={1}
                headerToolbar={{
                  left: "prev,next today",
                  center: "title",
                  right: "dayGridMonth,dayGridWeek",
                }}
                buttonText={{
                  today: "Hoje",
                  month: "Mês",
                  week: "Semana",
                }}
                // ✅ NOVO: Captura range visível para os gráficos abaixo (sem impactar UI)
                datesSet={onDatesSet}
              />

              {busy && (
                <div className="absolute inset-0 z-10 grid place-items-center bg-white/60 backdrop-blur-[1px]">
                  <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Atualizando Jira...
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 text-xs text-zinc-600">
            Alterações atualizam o{" "}
            <code className="rounded bg-zinc-100 px-1">customfield_14017</code>{" "}
            no Jira (otimista + revert em erro).
          </div>

          {/* =========================
              DASHBOARD (abaixo do calendário)
              NÃO impacta nada acima
          ========================= */}
          <AMCalendarDashboard
            events={filteredEvents}
            calendarioIssues={
              Array.isArray(viewData?.calendarioIssues)
                ? viewData.calendarioIssues
                : []
            }
            visibleRange={visibleRange}
          />
        </div>
      </section>
    </TooltipProvider>
  );
});
