import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  Loader2,
  Plus,
  Save,
  Settings2,
  Trash2,
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
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { ModuleHeader } from "@/components/layout/ModulePrimitives";
import {
  countActiveHolidays,
  formatWorkingWeekdays,
  normalizeCalendarSettings,
  toYMDLocal,
  WEEKDAY_LABELS,
} from "@/utils/businessCalendar";

function makeHoliday() {
  return {
    date: toYMDLocal(new Date()),
    name: "",
    repeatYearly: false,
    enabled: true,
  };
}

export default function SystemSettingsTab({
  calendarSettings,
  calendarSettingsLoading = false,
  onSaveCalendarSettings,
}) {
  const [activeSection] = useState("calendar");
  const [draft, setDraft] = useState(() =>
    normalizeCalendarSettings(calendarSettings),
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setDraft(normalizeCalendarSettings(calendarSettings));
  }, [calendarSettings, dirty]);

  const preview = useMemo(() => {
    const normalized = normalizeCalendarSettings(draft);
    return {
      week: formatWorkingWeekdays(normalized),
      holidays: countActiveHolidays(normalized),
    };
  }, [draft]);

  function updateDraft(recipe) {
    setDirty(true);
    setDraft((current) => normalizeCalendarSettings(recipe(current)));
  }

  function toggleWeekday(day) {
    updateDraft((current) => {
      const set = new Set(current.workingWeekdays || []);
      if (set.has(day)) set.delete(day);
      else set.add(day);
      return { ...current, workingWeekdays: Array.from(set) };
    });
  }

  function updateHoliday(index, patch) {
    updateDraft((current) => {
      const holidays = [...(current.holidays || [])];
      holidays[index] = { ...holidays[index], ...patch };
      return { ...current, holidays };
    });
  }

  function removeHoliday(index) {
    updateDraft((current) => ({
      ...current,
      holidays: (current.holidays || []).filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const saved = await onSaveCalendarSettings?.(
        normalizeCalendarSettings(draft),
      );
      setDraft(normalizeCalendarSettings(saved || draft));
      setDirty(false);
      toast.success("Calendario global salvo.");
    } catch (err) {
      toast.error(err?.message || "Não foi possível salvar o calendário.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid gap-5">
      <ModuleHeader
        eyebrow="Administração global"
        title="Configurações do Sistema"
        description="Ajustes compartilhados por todos os usuários e refletidos nos módulos operacionais."
        badge="Sistema"
        icon={Settings2}
        stats={[
          {
            label: "Semana útil",
            value: preview.week,
            helper: "Usada em duração e encadeamento do Gantt.",
          },
          {
            label: "Feriados ativos",
            value: String(preview.holidays),
            helper: "Dias não trabalhados cadastrados manualmente.",
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
          <CardContent className="p-3">
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition",
                activeSection === "calendar"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50",
              )}
            >
              <CalendarDays className="h-4 w-4" />
              <span className="grid">
                <span className="text-sm font-semibold">Calendário</span>
                <span className="text-xs text-zinc-500">Dias úteis e feriados</span>
              </span>
            </button>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
          <CardHeader className="gap-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="h-4 w-4 text-red-600" />
                  Calendário global de dias úteis
                </CardTitle>
                <CardDescription>
                  Esta configuração é global e afeta todos os usuários do sistema.
                </CardDescription>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                  {calendarSettingsLoading ? "Carregando" : `Semana: ${preview.week}`}
                </Badge>
                <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                  {preview.holidays} feriados ativos
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="grid gap-5">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="flex gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  A regra passa a valer quando uma duração, encadeamento,
                  reordenação ou recalculo de datas for executado. Cronogramas
                  antigos não serão reprocessados automaticamente.
                </p>
              </div>
            </div>

            <section className="grid gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Dias úteis da semana
                </h3>
                <p className="text-xs text-zinc-500">
                  Selecione os dias que entram na contagem de duração.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {WEEKDAY_LABELS.map((day) => {
                  const selected = draft.workingWeekdays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleWeekday(day.value)}
                      className={cn(
                        "flex h-14 items-center justify-center rounded-xl border text-sm font-semibold transition",
                        selected
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                      )}
                    >
                      {selected ? <Check className="mr-2 h-4 w-4" /> : null}
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </section>

            <Separator />

            <section className="grid gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900">
                    Feriados e dias não trabalhados
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Cadastre exceções que devem ser ignoradas na contagem útil.
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl border-zinc-200 bg-white"
                  onClick={() =>
                    updateDraft((current) => ({
                      ...current,
                      holidays: [...(current.holidays || []), makeHoliday()],
                    }))
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar feriado
                </Button>
              </div>

              <div className="grid gap-2">
                {(draft.holidays || []).length ? (
                  draft.holidays.map((holiday, index) => (
                    <div
                      key={`${holiday.date}-${index}`}
                      className="grid gap-2 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3 lg:grid-cols-[1.2fr_160px_150px_120px_44px] lg:items-center"
                    >
                      <Input
                        value={holiday.name || ""}
                        onChange={(event) =>
                          updateHoliday(index, { name: event.target.value })
                        }
                        placeholder="Nome do feriado"
                        className="h-10 rounded-xl border-zinc-200 bg-white"
                      />
                      <Input
                        type="date"
                        value={holiday.date || ""}
                        onChange={(event) =>
                          updateHoliday(index, { date: event.target.value })
                        }
                        className="h-10 rounded-xl border-zinc-200 bg-white"
                      />
                      <label className="flex h-10 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700">
                        <input
                          type="checkbox"
                          checked={Boolean(holiday.repeatYearly)}
                          onChange={(event) =>
                            updateHoliday(index, {
                              repeatYearly: event.target.checked,
                            })
                          }
                        />
                        Repetir anual
                      </label>
                      <label className="flex h-10 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700">
                        <input
                          type="checkbox"
                          checked={holiday.enabled !== false}
                          onChange={(event) =>
                            updateHoliday(index, { enabled: event.target.checked })
                          }
                        />
                        Ativo
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-xl border-zinc-200 bg-white text-red-600"
                        onClick={() => removeHoliday(index)}
                        aria-label="Remover feriado"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-500">
                    Nenhum feriado cadastrado.
                  </div>
                )}
              </div>
            </section>

            <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-zinc-500">
                Preview: semana útil <strong>{preview.week}</strong>, com{" "}
                <strong>{preview.holidays}</strong> feriado(s) ativo(s).
              </div>

              <Button
                type="button"
                className="rounded-xl bg-red-600 text-white hover:bg-red-700"
                onClick={handleSave}
                disabled={saving || calendarSettingsLoading}
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Salvar calendário
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
