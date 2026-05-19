import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  Download,
  KeyRound,
  Loader2,
  Plus,
  Save,
  Settings2,
  Trash2,
  User,
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
import { updateJiraToken, updatePassword } from "@/lib/auth";
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

function formatDateTime(value, fallback = "Nao informado") {
  if (!value) return fallback;
  return new Date(value).toLocaleString("pt-BR");
}

export default function SystemSettingsTab({
  currentUser,
  calendarSettings,
  calendarSettingsLoading = false,
  onSaveCalendarSettings,
  onUserUpdated,
}) {
  const [activeSection, setActiveSection] = useState("calendar");
  const [draft, setDraft] = useState(() =>
    normalizeCalendarSettings(calendarSettings)
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [tokenForm, setTokenForm] = useState({
    currentPassword: "",
    jiraApiToken: "",
  });

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
      holidays: (current.holidays || []).filter(
        (_, itemIndex) => itemIndex !== index
      ),
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const saved = await onSaveCalendarSettings?.(
        normalizeCalendarSettings(draft)
      );
      setDraft(normalizeCalendarSettings(saved || draft));
      setDirty(false);
      toast.success("Calendario global salvo.");
    } catch (err) {
      toast.error(err?.message || "Nao foi possivel salvar o calendario.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordSave(event) {
    event.preventDefault();

    if (passwordForm.newPassword.length < 8) {
      toast.error("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("A confirmacao da senha nao confere.");
      return;
    }

    setPasswordSaving(true);
    try {
      const user = await updatePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      onUserUpdated?.(user);
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      toast.success("Senha atualizada.");
    } catch (err) {
      toast.error(err?.message || "Nao foi possivel alterar a senha.");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleTokenSave(event) {
    event.preventDefault();

    if (!tokenForm.jiraApiToken.trim()) {
      toast.error("Informe o novo token do Jira.");
      return;
    }

    setTokenSaving(true);
    try {
      const user = await updateJiraToken({
        currentPassword: tokenForm.currentPassword,
        jiraApiToken: tokenForm.jiraApiToken,
      });
      onUserUpdated?.(user);
      setTokenForm({ currentPassword: "", jiraApiToken: "" });
      toast.success("Token Jira atualizado.");
    } catch (err) {
      toast.error(err?.message || "Nao foi possivel atualizar o token Jira.");
    } finally {
      setTokenSaving(false);
    }
  }

  const lastLoginLabel = formatDateTime(currentUser?.lastLoginAt);
  const tokenUpdatedLabel = formatDateTime(
    currentUser?.jiraTokenUpdatedAt,
    "Token cadastrado"
  );

  return (
    <section className="grid gap-5">
      <ModuleHeader
        eyebrow="Administracao"
        title="Configuracoes"
        description="Ajustes do sistema e da sua conta para manter a operacao conectada."
        badge="Sistema"
        icon={Settings2}
        stats={[
          {
            label: "Semana util",
            value: preview.week,
            helper: "Usada em duracao e encadeamento do Gantt.",
          },
          {
            label: "Feriados ativos",
            value: String(preview.holidays),
            helper: "Dias nao trabalhados cadastrados manualmente.",
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
          <CardContent className="grid gap-2 p-3">
            <button
              type="button"
              onClick={() => setActiveSection("calendar")}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition",
                activeSection === "calendar"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
              )}
            >
              <CalendarDays className="h-4 w-4" />
              <span className="grid">
                <span className="text-sm font-semibold">Calendario</span>
                <span className="text-xs text-zinc-500">
                  Dias uteis e feriados
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection("user")}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition",
                activeSection === "user"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
              )}
            >
              <User className="h-4 w-4" />
              <span className="grid">
                <span className="text-sm font-semibold">Usuario</span>
                <span className="text-xs text-zinc-500">
                  Senha e token Jira
                </span>
              </span>
            </button>
          </CardContent>
        </Card>

        {activeSection === "calendar" ? (
          <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="gap-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarDays className="h-4 w-4 text-red-600" />
                    Calendario global de dias uteis
                  </CardTitle>
                  <CardDescription>
                    Esta configuracao e global e afeta todos os usuarios do
                    sistema.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                    {calendarSettingsLoading
                      ? "Carregando"
                      : `Semana: ${preview.week}`}
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
                    A regra passa a valer quando uma duracao, encadeamento,
                    reordenacao ou recalculo de datas for executado.
                    Cronogramas antigos nao serao reprocessados
                    automaticamente.
                  </p>
                </div>
              </div>

              <section className="grid gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900">
                    Dias uteis da semana
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Selecione os dias que entram na contagem de duracao.
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
                            : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
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
                      Feriados e dias nao trabalhados
                    </h3>
                    <p className="text-xs text-zinc-500">
                      Cadastre excecoes que devem ser ignoradas na contagem
                      util.
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
                              updateHoliday(index, {
                                enabled: event.target.checked,
                              })
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
                  Preview: semana util <strong>{preview.week}</strong>, com{" "}
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
                  Salvar calendario
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="gap-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <User className="h-4 w-4 text-red-600" />
                    Configuracao do usuario
                  </CardTitle>
                  <CardDescription>
                    Atualize sua senha e o token usado nas requisicoes com o
                    Jira.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                    Token Jira ativo
                  </Badge>
                  <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                    {currentUser?.role || "user"}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="grid gap-5">
              <section className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 md:grid-cols-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-500">
                    Nome
                  </p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">
                    {currentUser?.name || "Nao informado"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-500">
                    E-mail
                  </p>
                  <p className="mt-1 break-all text-sm font-semibold text-zinc-900">
                    {currentUser?.email || "Nao informado"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-500">
                    Ultimo login
                  </p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">
                    {lastLoginLabel}
                  </p>
                </div>
              </section>

              <div className="grid gap-4 xl:grid-cols-2">
                <form
                  className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-4"
                  onSubmit={handlePasswordSave}
                >
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                      <KeyRound className="h-4 w-4 text-red-600" />
                      Alterar senha
                    </h3>
                    <p className="text-xs text-zinc-500">
                      Use sua senha atual para confirmar a alteracao.
                    </p>
                  </div>

                  <Input
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(event) =>
                      setPasswordForm((current) => ({
                        ...current,
                        currentPassword: event.target.value,
                      }))
                    }
                    placeholder="Senha atual"
                    autoComplete="current-password"
                    className="h-10 rounded-xl border-zinc-200 bg-white"
                    required
                  />
                  <Input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(event) =>
                      setPasswordForm((current) => ({
                        ...current,
                        newPassword: event.target.value,
                      }))
                    }
                    placeholder="Nova senha"
                    autoComplete="new-password"
                    minLength={8}
                    className="h-10 rounded-xl border-zinc-200 bg-white"
                    required
                  />
                  <Input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(event) =>
                      setPasswordForm((current) => ({
                        ...current,
                        confirmPassword: event.target.value,
                      }))
                    }
                    placeholder="Confirmar nova senha"
                    autoComplete="new-password"
                    minLength={8}
                    className="h-10 rounded-xl border-zinc-200 bg-white"
                    required
                  />

                  <Button
                    type="submit"
                    className="rounded-xl bg-red-600 text-white hover:bg-red-700"
                    disabled={passwordSaving}
                  >
                    {passwordSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Salvar senha
                  </Button>
                </form>

                <form
                  className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-4"
                  onSubmit={handleTokenSave}
                >
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                      <KeyRound className="h-4 w-4 text-red-600" />
                      Atualizar token Jira
                    </h3>
                    <p className="text-xs text-zinc-500">
                      Ultima atualizacao: {tokenUpdatedLabel}
                    </p>
                  </div>

                  <Input
                    type="password"
                    value={tokenForm.currentPassword}
                    onChange={(event) =>
                      setTokenForm((current) => ({
                        ...current,
                        currentPassword: event.target.value,
                      }))
                    }
                    placeholder="Senha atual"
                    autoComplete="current-password"
                    className="h-10 rounded-xl border-zinc-200 bg-white"
                    required
                  />
                  <Input
                    type="password"
                    value={tokenForm.jiraApiToken}
                    onChange={(event) =>
                      setTokenForm((current) => ({
                        ...current,
                        jiraApiToken: event.target.value,
                      }))
                    }
                    placeholder="Novo token da API Jira"
                    autoComplete="off"
                    className="h-10 rounded-xl border-zinc-200 bg-white"
                    required
                  />

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <a
                      href="/tutorials/apresentacao-criar-token-api-jira.pptx"
                      download
                      className="inline-flex items-center gap-2 text-sm font-semibold text-red-700"
                    >
                      <Download className="h-4 w-4" />
                      Baixar tutorial do token
                    </a>

                    <Button
                      type="submit"
                      className="rounded-xl bg-red-600 text-white hover:bg-red-700"
                      disabled={tokenSaving}
                    >
                      {tokenSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Salvar token
                    </Button>
                  </div>
                </form>
              </div>

              <section className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
                <h3 className="text-sm font-semibold text-zinc-900">
                  Backlog do menu
                </h3>
                <div className="grid gap-2 md:grid-cols-2">
                  {[
                    "Perfil basico e nome de exibicao",
                    "Teste de conexao com Jira",
                    "Aviso de rotacao de token",
                    "Preferencias pessoais",
                    "Sessoes ativas",
                    "Administracao de usuarios",
                    "Recuperacao de senha",
                  ].map((item) => (
                    <div
                      key={item}
                      className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </section>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
