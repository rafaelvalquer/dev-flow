// src/components/ui/date-range-picker.jsx
import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function cn(...a) {
  return a.filter(Boolean).join(" ");
}

function sameDay(a, b) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function parseBrToDate(ddmm, baseYear = new Date().getFullYear()) {
  const s = String(ddmm || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  if (!day || !month || month < 1 || month > 12 || day < 1 || day > 31)
    return null;

  const d = new Date(baseYear, month - 1, day);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function formatDateToBr(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

export function formatRangeToBr(range) {
  const from = range?.from;
  const to = range?.to;

  if (!from) return "";
  if (!to || sameDay(from, to)) return formatDateToBr(from);
  return `${formatDateToBr(from)} a ${formatDateToBr(to)}`;
}

export function parseBrStringToRange(value) {
  const raw = String(value || "").trim();
  if (!raw) return { from: null, to: null };

  const parts = raw
    .split(/\s+a\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 1) {
    const d = parseBrToDate(parts[0]);
    return { from: d, to: d };
  }

  const from = parseBrToDate(parts[0]);
  const to = parseBrToDate(parts[1]);
  return { from, to };
}

function inferModeFromValue(value) {
  const v = String(value || "");
  if (/\s+a\s+/i.test(v)) return "range";
  if (v.trim()) return "single";
  return "range";
}

// ✅ aqui é o ponto que evita “clicar duas vezes”
// - se value NÃO é range, retorna undefined (abre range sem from pré-setado)
// - se value É range, reidrata {from,to}
function draftFromValueForRange(value) {
  const raw = String(value || "").trim();
  const isRangeText = /\s+a\s+/i.test(raw);
  if (!isRangeText) return undefined;

  const parsed = parseBrStringToRange(value);
  const from = parsed?.from || undefined;
  const to = parsed?.to || undefined;

  if (!from) return undefined;
  if (to && sameDay(from, to)) return { from, to: undefined };
  return { from, to };
}

export function DateValuePicker({
  value,
  mode: modeProp,
  onModeChange,
  onChange,
  placeholder = "Selecionar…",
  disabled = false,
  className,
}) {
  const [open, setOpen] = useState(false);

  const mode = modeProp || inferModeFromValue(value);
  const parsed = useMemo(() => parseBrStringToRange(value), [value]);

  const [rangeDraft, setRangeDraft] = useState(() =>
    draftFromValueForRange(value)
  );

  useEffect(() => {
    if (mode !== "range") return;
    if (!open) setRangeDraft(draftFromValueForRange(value));
  }, [mode, open, value]);

  const selectedSingle = mode === "single" ? parsed?.from || null : null;
  const selectedRange = mode === "range" ? rangeDraft : undefined;

  const label = String(value || "").trim() || placeholder;

  function commitSingle(date) {
    if (!date) return;
    onChange?.(formatDateToBr(date));
    setOpen(false);
  }

  function rangeDraftFromValue(value) {
    const raw = String(value || "").trim();
    if (!raw) return undefined;

    const parsed = parseBrStringToRange(raw);
    const from = parsed?.from || undefined;
    const to = parsed?.to || undefined;

    if (!from) return undefined;

    // se value for data única, abre range já com "from" e "to" vazio
    if (!/\s+a\s+/i.test(raw)) return { from, to: undefined };

    // se vier range, mantém; se vier "DD/MM a DD/MM", deixa "em andamento"
    if (to && sameDay(from, to)) return { from, to: undefined };
    return { from, to };
  }

  function commitRange(next) {
    if (!next || !next.from) {
      setRangeDraft(undefined);
      return;
    }

    // ✅ normaliza: se o DayPicker retornar to===from, não fecha range
    if (next.to && sameDay(next.from, next.to)) {
      setRangeDraft({ from: next.from, to: undefined });
      return;
    }

    setRangeDraft(next);

    if (next.from && next.to) {
      onChange?.(formatRangeToBr(next));
      setOpen(false);
    }
  }

  const previewText =
    mode === "range"
      ? rangeDraft?.from
        ? rangeDraft?.to
          ? formatRangeToBr(rangeDraft)
          : `${formatDateToBr(rangeDraft.from)} —`
        : "—"
      : String(value || "").trim() || "—";

  return (
    <div className={cn("flex w-full flex-col gap-1", className)}>
      {onModeChange ? (
        <div className="inline-flex w-fit items-center rounded-lg border border-zinc-200 bg-white p-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onModeChange("single");
              setOpen(true);
            }}
            className={cn(
              "h-7 rounded-md px-2 text-[11px] font-medium",
              "focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
              mode === "single"
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-white text-zinc-900 hover:bg-zinc-50"
            )}
          >
            Única
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onModeChange("range");
              setRangeDraft(rangeDraftFromValue(value)); // ✅ reidrata corretamente
              setOpen(true);
            }}
            className={cn(
              "h-7 rounded-md px-2 text-[11px] font-medium",
              "focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
              mode === "range"
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-white text-zinc-900 hover:bg-zinc-50"
            )}
          >
            Período
          </Button>
        </div>
      ) : null}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-9 w-full min-w-0 justify-start gap-2 rounded-xl border-zinc-200 bg-white px-2.5 text-left font-normal",
              "text-zinc-900 hover:bg-zinc-50",
              "focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
              !String(value || "").trim() && "text-zinc-500"
            )}
            title={String(value || "").trim() || ""}
          >
            <CalendarDays className="h-4 w-4 shrink-0 text-zinc-500" />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          className="
    w-[480px]            /* largura da caixa */
    p-2                  /* padding menor */
    rounded-xl
    border border-zinc-200 bg-white shadow-md
    max-h-[380px]        /* limita altura */
    overflow-hidden      /* evita “vazar” */
  "
        >
          {/* calendário */}
          <div className="scale-[0.92] origin-top-left">
            {mode === "single" ? (
              <Calendar
                mode="single"
                selected={selectedSingle}
                onSelect={commitSingle}
                showOutsideDays={false}
                initialFocus
              />
            ) : (
              <Calendar
                mode="range"
                selected={selectedRange}
                onSelect={commitRange}
                showOutsideDays={false}
                numberOfMonths={1}
                initialFocus
              />
            )}
          </div>

          <div className="mt-2 border-t border-zinc-200 pt-2 text-[11px] text-zinc-600">
            <span className="font-medium text-zinc-700">Selecionado:</span>{" "}
            <span className="fontfont-mono text-zinc-900">{previewText}</span>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
