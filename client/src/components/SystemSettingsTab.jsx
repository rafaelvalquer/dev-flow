import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Bot,
  CalendarDays,
  ChevronsUpDown,
  Check,
  Database,
  Download,
  FileText,
  Gauge,
  KeyRound,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
  User,
  UserX,
  Wifi,
} from "lucide-react";

import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  testJiraStatus,
  updateJiraUser,
  updateJiraToken,
  updatePassword,
  updatePreferences,
  updateProfile,
} from "@/lib/auth";
import { jiraSearchUsers } from "@/lib/jiraClient";
import { fetchSystemDiagnostics } from "@/lib/systemDiagnostics";
import { ModuleHeader } from "@/components/layout/ModulePrimitives";
import SystemLogsView from "./SystemLogsView";
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

function formatDateTime(value, fallback = "Não informado") {
  if (!value) return fallback;
  return new Date(value).toLocaleString("pt-BR");
}

function initials(value = "") {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (parts[0]?.[0] || "?").toUpperCase();
}

function mapJiraUser(user) {
  if (!user) return null;
  return {
    accountId: user?.accountId || "",
    displayName: user?.displayName || user?.name || user?.emailAddress || "",
    emailAddress: user?.emailAddress || "",
    avatarUrl:
      user?.avatarUrl ||
      user?.avatarUrls?.["48x48"] ||
      user?.avatarUrls?.["32x32"] ||
      "",
    active: user?.active !== false,
  };
}

function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const TAB_OPTIONS = [
  { value: "gmud", label: "Central do Desenvolvedor" },
  { value: "rdm", label: "RDM" },
  { value: "am", label: "Painel PO" },
  { value: "my", label: "Minha Carteira" },
  { value: "versioning", label: "Versionamentos" },
  { value: "tools", label: "Ferramentas" },
  { value: "settings", label: "Configuracoes" },
];

const DEFAULT_PREFERENCES = {
  theme: "claro",
  primaryColor: "#cf0013",
  density: "comfortable",
  defaultTab: "gmud",
  sidebarCollapsed: false,
};

const THEME_OPTIONS = [
  {
    value: "claro",
    label: "Claro",
    helper: "Vermelho Claro e superficies claras",
  },
  {
    value: "grafite",
    label: "Grafite",
    helper: "Cinza elegante com acoes em vermelho",
  },
  { value: "oceano", label: "Oceano", helper: "Azuis suaves com acentos teal" },
  {
    value: "verde",
    label: "Verde",
    helper: "Verdes claros com contraste azul",
  },
];

const PRIMARY_COLOR_OPTIONS = [
  { value: "#cf0013", label: "Claro" },
  { value: "#0f8aa6", label: "Oceano" },
  { value: "#16803c", label: "Verde" },
  { value: "#7c3aed", label: "Violeta" },
  { value: "#e4572e", label: "Laranja" },
  { value: "#334155", label: "Grafite" },
];

const DENSITY_OPTIONS = [
  {
    value: "comfortable",
    label: "Confortável",
    helper: "Mais respiro para leitura e operação diária.",
  },
  {
    value: "compact",
    label: "Compacta",
    helper: "Mais informação visível em dashboards e tabelas.",
  },
];

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function normalizePrimaryColor(value) {
  const color = String(value || "").trim();
  return HEX_COLOR_RE.test(color)
    ? color.toLowerCase()
    : DEFAULT_PREFERENCES.primaryColor;
}

function normalizePreferences(preferences = {}) {
  const validTabs = new Set(TAB_OPTIONS.map((tab) => tab.value));
  const validThemes = new Set(THEME_OPTIONS.map((theme) => theme.value));
  const validDensities = new Set(
    DENSITY_OPTIONS.map((density) => density.value),
  );
  const theme = preferences.theme === "light" ? "claro" : preferences.theme;
  const density = preferences.density || DEFAULT_PREFERENCES.density;
  return {
    theme: validThemes.has(theme) ? theme : DEFAULT_PREFERENCES.theme,
    primaryColor: normalizePrimaryColor(preferences.primaryColor),
    density: validDensities.has(density)
      ? density
      : DEFAULT_PREFERENCES.density,
    defaultTab: validTabs.has(preferences.defaultTab)
      ? preferences.defaultTab
      : DEFAULT_PREFERENCES.defaultTab,
    sidebarCollapsed: Boolean(preferences.sidebarCollapsed),
  };
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) return "0s";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${Math.round(value)}s`;
}

function formatLatency(value) {
  const latency = Number(value);
  if (!Number.isFinite(latency)) return "Sem latencia";
  return `${Math.round(latency)} ms`;
}

function serviceState(service, type) {
  if (!service) {
    return {
      label: "Sem dados",
      className: "border-zinc-200 bg-zinc-50 text-zinc-700",
    };
  }

  if (service.configured === false) {
    return {
      label: "Não configurado",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }

  if (type === "portalIcc" && service.authenticated === false) {
    return {
      label: "Não autenticado",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }

  if (service.ok) {
    return {
      label: "Online",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  return {
    label: "Offline",
    className: "border-red-200 bg-red-50 text-red-700",
  };
}

function diagnosticMessage(service, type) {
  if (!service) return "Nenhum dado coletado.";
  if (service.message) return service.message;
  if (service.error?.message) return service.error.message;
  if (service.error) return String(service.error);
  if (type === "api") return `Uptime: ${formatDuration(service.uptimeSec)}.`;
  if (type === "mongo") return `Estado Mongo: ${service.label || "unknown"}.`;
  if (type === "jira") {
    const failed = (service.checks || []).find((check) => !check?.ok);
    if (failed?.error?.message) return failed.error.message;
    if (failed?.error) return String(failed.error);
    return service.host
      ? `Host: ${service.host}`
      : "Diagnóstico Jira executado.";
  }
  if (type === "stt")
    return service.status ? `HTTP ${service.status}` : "Health STT consultado.";
  if (type === "portalIcc") {
    return service.authenticated
      ? `Sessão ativa para ${service.session?.username || "usuário atual"}.`
      : "Sessão Portal ICC não encontrada.";
  }
  if (type === "automation") {
    return service.enabled === false
      ? "Automação desativada por configuração."
      : `Última execução: ${formatDateTime(service.lastRunAt)}.`;
  }
  if (type === "openai") {
    return service.configured
      ? `Modelo: ${service.model || "configurado"}.`
      : "Chave OpenAI nao configurada.";
  }
  return "Diagnóstico coletado.";
}

function StatusBadge({ service, type }) {
  const state = serviceState(service, type);
  return (
    <Badge className={cn("rounded-full border", state.className)}>
      {state.label}
    </Badge>
  );
}

function DiagnosticCard({ title, description, icon: Icon, service, type }) {
  return (
    <section className="grid gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2 text-zinc-700">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
            <p className="text-xs text-zinc-500">{description}</p>
          </div>
        </div>
        <StatusBadge service={service} type={type} />
      </div>

      <div className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
        <div className="flex items-center justify-between gap-3">
          <span>Latência</span>
          <strong className="text-zinc-900">
            {formatLatency(service?.latencyMs)}
          </strong>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Última checagem</span>
          <strong className="text-right text-zinc-900">
            {formatDateTime(service?.checkedAt, "Não executado")}
          </strong>
        </div>
      </div>

      <p className="min-h-9 text-xs leading-5 text-zinc-600">
        {diagnosticMessage(service, type)}
      </p>
    </section>
  );
}

function SystemHealthView({ diagnostics, loading, error, onRefresh }) {
  const services = diagnostics?.services || {};
  const version = diagnostics?.version || {};
  const statusMeta =
    diagnostics?.status === "online"
      ? {
          label: "Sistema online",
          className: "border-emerald-200 bg-emerald-50 text-emerald-700",
        }
      : diagnostics?.status === "offline"
        ? {
            label: "Sistema offline",
            className: "border-red-200 bg-red-50 text-red-700",
          }
        : {
            label: "Sistema instavel",
            className: "border-amber-200 bg-amber-50 text-amber-800",
          };

  return (
    <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-red-600" />
              Saúde do Sistema
            </CardTitle>
            <CardDescription>
              Visao consolidada dos servicos usados pelo Dev Flow.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("rounded-full border", statusMeta.className)}>
              {diagnostics ? statusMeta.label : "Aguardando diagnóstico"}
            </Badge>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-zinc-200 bg-white"
              onClick={onRefresh}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Atualizar diagnóstico
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

        <section className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 md:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Versão instalada
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-900">
              {version.installed || "N/D"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Ambiente
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-900">
              {version.environment || "development"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Node
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-900">
              {version.node || "N/D"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Checado em
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-900">
              {formatDateTime(diagnostics?.checkedAt, "Não executado")}
            </p>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <DiagnosticCard
            title="API Dev Flow"
            description="Servidor local e uptime da aplicacao."
            icon={Server}
            service={services.api}
            type="api"
          />
          <DiagnosticCard
            title="MongoDB"
            description="Conexão principal de dados."
            icon={Database}
            service={services.mongo}
            type="mongo"
          />
          <DiagnosticCard
            title="Jira"
            description="DNS, TCP e chamada autenticada Jira."
            icon={ShieldCheck}
            service={services.jira}
            type="jira"
          />
          <DiagnosticCard
            title="STT"
            description="Servico Python de transcricao."
            icon={Gauge}
            service={services.stt}
            type="stt"
          />
          <DiagnosticCard
            title="Portal ICC"
            description="Configuração e sessão atual do portal."
            icon={Wifi}
            service={services.portalIcc}
            type="portalIcc"
          />
          <DiagnosticCard
            title="Automação"
            description="Job interno de sincronizacao operacional."
            icon={RefreshCw}
            service={services.automation}
            type="automation"
          />
          <DiagnosticCard
            title="OpenAI"
            description="Configuração do recurso de IA."
            icon={Bot}
            service={services.openai}
            type="openai"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function AppearanceSettingsView({
  preferencesDraft,
  setPreferencesDraft,
  preferencesSaving,
  onSubmit,
}) {
  const selectedTheme = THEME_OPTIONS.find(
    (theme) => theme.value === preferencesDraft.theme,
  );
  const selectedDensity = DENSITY_OPTIONS.find(
    (density) => density.value === preferencesDraft.density,
  );

  return (
    <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4 text-red-600" />
              Aparência
            </CardTitle>
            <CardDescription>
              Personalize tema, cor, densidade e comportamento inicial da
              interface.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
              {selectedTheme?.label || "Claro"}
            </Badge>
            <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
              {selectedDensity?.label || "Confortável"}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <form className="grid gap-5" onSubmit={onSubmit}>
          <section className="grid gap-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                Tema e cor primária
              </h3>
              <p className="text-xs text-zinc-500">
                O tema define a base visual; a cor primária ajusta ações e
                destaques.
              </p>
            </div>

            <div className="grid items-start gap-3 lg:grid-cols-[1fr_1.4fr]">
              <label className="grid gap-2 text-xs font-semibold text-zinc-700">
                <span>Tema</span>
                <select
                  value={preferencesDraft.theme}
                  onChange={(event) =>
                    setPreferencesDraft((current) => ({
                      ...current,
                      theme: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
                >
                  {THEME_OPTIONS.map((theme) => (
                    <option key={theme.value} value={theme.value}>
                      {theme.label}
                    </option>
                  ))}
                </select>
                <span className="min-h-4 text-[11px] font-normal leading-4 text-zinc-500">
                  {selectedTheme?.helper}
                </span>
              </label>

              <div className="grid gap-2 text-xs font-semibold text-zinc-700">
                <span>Cor primária</span>
                <div className="flex flex-wrap gap-2">
                  {PRIMARY_COLOR_OPTIONS.map((color) => {
                    const selected =
                      normalizePrimaryColor(preferencesDraft.primaryColor) ===
                      color.value;
                    return (
                      <button
                        key={color.value}
                        type="button"
                        className={cn(
                          "h-10 w-10 rounded-full border-2 shadow-sm transition",
                          selected
                            ? "border-zinc-900 ring-2 ring-zinc-300"
                            : "border-white hover:border-zinc-300",
                        )}
                        style={{ backgroundColor: color.value }}
                        title={color.label}
                        aria-label={`Selecionar cor ${color.label}`}
                        onClick={() =>
                          setPreferencesDraft((current) => ({
                            ...current,
                            primaryColor: color.value,
                          }))
                        }
                      />
                    );
                  })}
                </div>

                <div className="grid gap-2 sm:grid-cols-[64px_1fr]">
                  <Input
                    type="color"
                    value={normalizePrimaryColor(preferencesDraft.primaryColor)}
                    onChange={(event) =>
                      setPreferencesDraft((current) => ({
                        ...current,
                        primaryColor: event.target.value,
                      }))
                    }
                    className="h-10 rounded-xl border-zinc-200 bg-white p-1"
                    aria-label="Escolher cor primária"
                  />
                  <Input
                    value={preferencesDraft.primaryColor}
                    onChange={(event) =>
                      setPreferencesDraft((current) => ({
                        ...current,
                        primaryColor: event.target.value,
                      }))
                    }
                    placeholder="#cf0013"
                    maxLength={7}
                    className="h-10 rounded-xl border-zinc-200 bg-white font-mono text-sm"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                Layout e início
              </h3>
              <p className="text-xs text-zinc-500">
                Controle a quantidade de informação em tela e o estado inicial
                do app.
              </p>
            </div>

            <div className="grid items-start gap-3 md:grid-cols-3">
              <label className="grid gap-2 text-xs font-semibold text-zinc-700">
                <span>Densidade</span>
                <div className="grid grid-cols-2 rounded-xl border border-zinc-200 bg-white p-1">
                  {DENSITY_OPTIONS.map((density) => (
                    <button
                      key={density.value}
                      type="button"
                      className={cn(
                        "rounded-lg px-3 py-2 text-xs font-semibold transition",
                        preferencesDraft.density === density.value
                          ? "bg-red-600 text-white"
                          : "text-zinc-600 hover:bg-zinc-50",
                      )}
                      onClick={() =>
                        setPreferencesDraft((current) => ({
                          ...current,
                          density: density.value,
                        }))
                      }
                    >
                      {density.label}
                    </button>
                  ))}
                </div>
                <span className="min-h-4 text-[11px] font-normal leading-4 text-zinc-500">
                  {selectedDensity?.helper}
                </span>
              </label>

              <label className="grid gap-2 text-xs font-semibold text-zinc-700">
                <span>Aba inicial</span>
                <select
                  value={preferencesDraft.defaultTab}
                  onChange={(event) =>
                    setPreferencesDraft((current) => ({
                      ...current,
                      defaultTab: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
                >
                  {TAB_OPTIONS.map((tab) => (
                    <option key={tab.value} value={tab.value}>
                      {tab.label}
                    </option>
                  ))}
                </select>
                <span className="min-h-4 text-[11px] font-normal leading-4 text-zinc-500">
                  Módulo aberto ao iniciar a plataforma.
                </span>
              </label>

              <div className="grid gap-2 text-xs font-semibold text-zinc-700">
                <span>Sidebar</span>
                <label className="flex h-10 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700">
                  <input
                    type="checkbox"
                    checked={preferencesDraft.sidebarCollapsed}
                    onChange={(event) =>
                      setPreferencesDraft((current) => ({
                        ...current,
                        sidebarCollapsed: event.target.checked,
                      }))
                    }
                  />
                  Recolhida por padrão
                </label>
                <span className="min-h-4 text-[11px] font-normal leading-4 text-zinc-500">
                  Controla o estado inicial do menu lateral.
                </span>
              </div>
            </div>
          </section>

          <div className="flex justify-end">
            <Button
              type="submit"
              className="rounded-xl bg-red-600 text-white hover:bg-red-700"
              disabled={preferencesSaving}
            >
              {preferencesSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar aparência
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
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
    normalizeCalendarSettings(calendarSettings),
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
  const [profileName, setProfileName] = useState(currentUser?.name || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [jiraStatusLoading, setJiraStatusLoading] = useState(false);
  const [jiraStatus, setJiraStatus] = useState(null);
  const [jiraUserSaving, setJiraUserSaving] = useState(false);
  const [jiraUserOpen, setJiraUserOpen] = useState(false);
  const [jiraUserQuery, setJiraUserQuery] = useState("");
  const [jiraUserOptions, setJiraUserOptions] = useState([]);
  const [jiraUserLoading, setJiraUserLoading] = useState(false);
  const [jiraUserErr, setJiraUserErr] = useState("");
  const [preferencesDraft, setPreferencesDraft] = useState(() =>
    normalizePreferences(currentUser?.preferences),
  );
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState("");

  useEffect(() => {
    if (dirty) return;
    setDraft(normalizeCalendarSettings(calendarSettings));
  }, [calendarSettings, dirty]);

  useEffect(() => {
    setProfileName(currentUser?.name || "");
    setPreferencesDraft(normalizePreferences(currentUser?.preferences));
  }, [currentUser]);

  useEffect(() => {
    if (activeSection !== "diagnostics" || diagnostics || diagnosticsLoading)
      return;
    handleDiagnosticsRefresh();
  }, [activeSection, diagnostics, diagnosticsLoading]);

  const debouncedJiraUserQuery = useDebouncedValue(jiraUserQuery, 250);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!jiraUserOpen) return;
      const q = String(debouncedJiraUserQuery || "").trim();
      setJiraUserErr("");

      if (q.length < 2) {
        setJiraUserOptions([]);
        setJiraUserLoading(false);
        return;
      }

      setJiraUserLoading(true);
      try {
        const users = await jiraSearchUsers(q);
        if (!alive) return;
        setJiraUserOptions(
          (Array.isArray(users) ? users : [])
            .map(mapJiraUser)
            .filter((user) => user?.accountId),
        );
      } catch (err) {
        if (!alive) return;
        setJiraUserOptions([]);
        setJiraUserErr(
          err?.message || "Não foi possível buscar usuários Jira.",
        );
      } finally {
        if (alive) setJiraUserLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [debouncedJiraUserQuery, jiraUserOpen]);

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
        (_, itemIndex) => itemIndex !== index,
      ),
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
      toast.error(err?.message || "Não foi possível alterar a senha.");
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
      toast.error(err?.message || "Não foi possível atualizar o token Jira.");
    } finally {
      setTokenSaving(false);
    }
  }

  async function handleProfileSave(event) {
    event.preventDefault();

    setProfileSaving(true);
    try {
      const user = await updateProfile({ name: profileName });
      onUserUpdated?.(user);
      toast.success("Perfil atualizado.");
    } catch (err) {
      toast.error(err?.message || "Não foi possível atualizar o perfil.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleJiraStatusTest() {
    setJiraStatusLoading(true);
    setJiraStatus(null);
    try {
      const status = await testJiraStatus();
      setJiraStatus(status);
      toast.success("Conexão Jira validada.");
    } catch (err) {
      setJiraStatus({
        ok: false,
        error: err?.message || "Não foi possível testar a conexão Jira.",
      });
      toast.error(err?.message || "Não foi possível testar a conexão Jira.");
    } finally {
      setJiraStatusLoading(false);
    }
  }

  async function saveJiraUser(user, successMessage = "Usuario Jira salvo.") {
    setJiraUserSaving(true);
    try {
      const saved = await updateJiraUser(user || {});
      onUserUpdated?.(saved);
      toast.success(successMessage);
    } catch (err) {
      toast.error(err?.message || "Não foi possível salvar o usuário Jira.");
    } finally {
      setJiraUserSaving(false);
    }
  }

  async function handleUseTokenJiraUser() {
    setJiraStatusLoading(true);
    setJiraStatus(null);
    try {
      const status = await testJiraStatus();
      setJiraStatus(status);
      const tokenUser = mapJiraUser(status?.jiraUser);
      if (!tokenUser?.accountId) {
        toast.error("O token foi validado, mas nao retornou accountId.");
        return;
      }
      await saveJiraUser(tokenUser, "Usuario Jira do token salvo.");
    } catch (err) {
      setJiraStatus({
        ok: false,
        error: err?.message || "Não foi possível testar a conexão Jira.",
      });
      toast.error(err?.message || "Não foi possível usar o usuário do token.");
    } finally {
      setJiraStatusLoading(false);
    }
  }

  async function handlePreferencesSave(event) {
    event.preventDefault();

    setPreferencesSaving(true);
    try {
      const user = await updatePreferences(
        normalizePreferences(preferencesDraft),
      );
      onUserUpdated?.(user);
      toast.success("Preferências salvas.");
    } catch (err) {
      toast.error(err?.message || "Não foi possível salvar as preferências.");
    } finally {
      setPreferencesSaving(false);
    }
  }

  async function handleDiagnosticsRefresh() {
    setDiagnosticsLoading(true);
    setDiagnosticsError("");
    try {
      const payload = await fetchSystemDiagnostics();
      setDiagnostics(payload);
    } catch (err) {
      setDiagnosticsError(
        err?.message || "Não foi possível carregar o diagnóstico.",
      );
    } finally {
      setDiagnosticsLoading(false);
    }
  }

  const lastLoginLabel = formatDateTime(currentUser?.lastLoginAt);
  const tokenUpdatedLabel = formatDateTime(
    currentUser?.jiraTokenUpdatedAt,
    "Token cadastrado",
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
                  : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50",
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
              onClick={() => setActiveSection("appearance")}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition",
                activeSection === "appearance"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50",
              )}
            >
              <Palette className="h-4 w-4" />
              <span className="grid">
                <span className="text-sm font-semibold">Aparência</span>
                <span className="text-xs text-zinc-500">
                  Tema, cor e densidade
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
                  : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50",
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

            <button
              type="button"
              onClick={() => setActiveSection("diagnostics")}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition",
                activeSection === "diagnostics"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50",
              )}
            >
              <Activity className="h-4 w-4" />
              <span className="grid">
                <span className="text-sm font-semibold">Diagnóstico</span>
                <span className="text-xs text-zinc-500">Saúde do sistema</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("logs")}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition",
                activeSection === "logs"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50",
              )}
            >
              <FileText className="h-4 w-4" />
              <span className="grid">
                <span className="text-sm font-semibold">Logs</span>
                <span className="text-xs text-zinc-500">STT e backend</span>
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
                    reordenacao ou recalculo de datas for executado. Cronogramas
                    antigos nao serao reprocessados automaticamente.
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
        ) : activeSection === "appearance" ? (
          <AppearanceSettingsView
            preferencesDraft={preferencesDraft}
            setPreferencesDraft={setPreferencesDraft}
            preferencesSaving={preferencesSaving}
            onSubmit={handlePreferencesSave}
          />
        ) : activeSection === "diagnostics" ? (
          <SystemHealthView
            diagnostics={diagnostics}
            loading={diagnosticsLoading}
            error={diagnosticsError}
            onRefresh={handleDiagnosticsRefresh}
          />
        ) : activeSection === "logs" ? (
          <SystemLogsView />
        ) : (
          <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="gap-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <User className="h-4 w-4 text-red-600" />
                    Configuração do usuário
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
                    {currentUser?.name || "Não informado"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-500">
                    E-mail
                  </p>
                  <p className="mt-1 break-all text-sm font-semibold text-zinc-900">
                    {currentUser?.email || "Não informado"}
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
                <section className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-4 xl:col-span-2">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                        <User className="h-4 w-4 text-red-600" />
                        Usuario Jira pessoal
                      </h3>
                      <p className="text-xs text-zinc-500">
                        Este usuario alimenta Minha Carteira e o filtro Meus
                        projetos por accountId.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl border-zinc-200 bg-white"
                        onClick={handleUseTokenJiraUser}
                        disabled={jiraStatusLoading || jiraUserSaving}
                      >
                        {jiraStatusLoading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        Usar usuario do token atual
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl border-zinc-200 bg-white text-red-700"
                        onClick={() =>
                          saveJiraUser({}, "Vinculo Jira removido.")
                        }
                        disabled={jiraUserSaving || !currentUser?.jiraAccountId}
                      >
                        <UserX className="mr-2 h-4 w-4" />
                        Limpar vinculo
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[1fr_420px] lg:items-start">
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                      {currentUser?.jiraAccountId ? (
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="h-11 w-11 border border-zinc-200">
                            {currentUser?.jiraAvatarUrl ? (
                              <AvatarImage
                                src={currentUser.jiraAvatarUrl}
                                alt="avatar"
                              />
                            ) : null}
                            <AvatarFallback className="bg-white text-zinc-700">
                              {initials(
                                currentUser?.jiraDisplayName ||
                                  currentUser?.name ||
                                  currentUser?.email,
                              )}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-zinc-900">
                              {currentUser?.jiraDisplayName ||
                                currentUser?.name ||
                                "Usuario Jira"}
                            </div>
                            <div className="truncate text-xs text-zinc-500">
                              {currentUser?.jiraEmailAddress ||
                                "E-mail Jira nao informado"}
                            </div>
                            <div className="mt-1 break-all text-[11px] text-zinc-500">
                              accountId: {currentUser.jiraAccountId}
                            </div>
                          </div>
                          <Badge className="ml-auto rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
                            Ativo
                          </Badge>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-3 py-4 text-sm text-zinc-500">
                          Nenhum usuario Jira pessoal selecionado.
                        </div>
                      )}
                    </div>

                    <Popover open={jiraUserOpen} onOpenChange={setJiraUserOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={jiraUserOpen}
                          className="h-11 justify-between rounded-xl border-zinc-200 bg-white text-left"
                          disabled={jiraUserSaving}
                        >
                          <span className="truncate">
                            Buscar e selecionar usuario Jira
                          </span>
                          {jiraUserLoading ? (
                            <Loader2 className="ml-2 h-4 w-4 animate-spin text-zinc-500" />
                          ) : (
                            <ChevronsUpDown className="ml-2 h-4 w-4 text-zinc-500" />
                          )}
                        </Button>
                      </PopoverTrigger>

                      <PopoverContent
                        align="end"
                        className="w-[420px] max-w-[calc(100vw-3rem)] rounded-2xl border-zinc-200 p-2"
                      >
                        <Command shouldFilter={false}>
                          <CommandInput
                            value={jiraUserQuery}
                            onValueChange={setJiraUserQuery}
                            placeholder="Buscar usuario no Jira... (min. 2 letras)"
                          />
                          <CommandList className="max-h-[280px]">
                            <CommandEmpty>
                              {jiraUserLoading
                                ? "Buscando..."
                                : String(jiraUserQuery || "").trim().length < 2
                                  ? "Digite 2 ou mais caracteres para buscar."
                                  : "Nenhum usuario encontrado."}
                            </CommandEmpty>
                            <CommandGroup heading="Usuarios Jira">
                              {jiraUserOptions.map((user) => {
                                const selected =
                                  currentUser?.jiraAccountId === user.accountId;
                                return (
                                  <CommandItem
                                    key={user.accountId}
                                    value={user.displayName}
                                    className="rounded-xl"
                                    onSelect={() => {
                                      setJiraUserOpen(false);
                                      setJiraUserQuery("");
                                      saveJiraUser(user);
                                    }}
                                  >
                                    <div className="flex min-w-0 flex-1 items-center gap-2">
                                      <Avatar className="h-7 w-7 border border-zinc-200">
                                        {user.avatarUrl ? (
                                          <AvatarImage
                                            src={user.avatarUrl}
                                            alt="avatar"
                                          />
                                        ) : null}
                                        <AvatarFallback className="bg-zinc-100 text-[10px] text-zinc-700">
                                          {initials(user.displayName)}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="min-w-0">
                                        <div className="truncate text-sm font-medium text-zinc-900">
                                          {user.displayName}
                                        </div>
                                        {user.emailAddress ? (
                                          <div className="truncate text-[11px] text-zinc-500">
                                            {user.emailAddress}
                                          </div>
                                        ) : null}
                                      </div>
                                    </div>
                                    {selected ? (
                                      <Check className="ml-2 h-4 w-4 text-emerald-600" />
                                    ) : null}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>

                        {jiraUserErr ? (
                          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                            {jiraUserErr}
                          </div>
                        ) : null}
                      </PopoverContent>
                    </Popover>
                  </div>
                </section>

                <form
                  className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-4"
                  onSubmit={handleProfileSave}
                >
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                      <User className="h-4 w-4 text-red-600" />
                      Perfil basico
                    </h3>
                    <p className="text-xs text-zinc-500">
                      Edite somente o nome de exibicao. O e-mail permanece fixo.
                    </p>
                  </div>

                  <Input
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder="Nome de exibicao"
                    className="h-10 rounded-xl border-zinc-200 bg-white"
                    maxLength={120}
                  />

                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                    E-mail:{" "}
                    <strong className="break-all text-zinc-900">
                      {currentUser?.email || "Não informado"}
                    </strong>
                  </div>

                  <Button
                    type="submit"
                    className="rounded-xl bg-red-600 text-white hover:bg-red-700"
                    disabled={profileSaving}
                  >
                    {profileSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Salvar perfil
                  </Button>
                </form>

                <section className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-4">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                      <ShieldCheck className="h-4 w-4 text-red-600" />
                      Status Jira
                    </h3>
                    <p className="text-xs text-zinc-500">
                      Teste o token atual sem alterar a credencial salva.
                    </p>
                  </div>

                  {jiraStatus ? (
                    <div
                      className={cn(
                        "rounded-xl border px-3 py-3 text-sm",
                        jiraStatus.ok
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-red-200 bg-red-50 text-red-900",
                      )}
                    >
                      {jiraStatus.ok ? (
                        <div className="grid gap-1">
                          <strong>Conexão Jira validada.</strong>
                          <span>
                            {jiraStatus.jiraUser?.displayName || "Usuario Jira"}{" "}
                            {jiraStatus.jiraUser?.emailAddress
                              ? `- ${jiraStatus.jiraUser.emailAddress}`
                              : ""}
                          </span>
                          {jiraStatus.jiraUser?.accountId ? (
                            <span className="break-all text-xs">
                              accountId: {jiraStatus.jiraUser.accountId}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <strong>
                          {jiraStatus.error ||
                            "Não foi possível validar o token Jira."}
                        </strong>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-600">
                      Nenhum teste executado nesta sessao.
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl border-zinc-200 bg-white"
                    onClick={handleJiraStatusTest}
                    disabled={jiraStatusLoading}
                  >
                    {jiraStatusLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Testar conexao Jira
                  </Button>
                </section>
              </div>

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
                      Última atualização: {tokenUpdatedLabel}
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
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
