import React, { useEffect, useMemo, useState } from "react";
import {
  Blocks,
  Briefcase,
  Check,
  ChevronRight,
  Download,
  FileText,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  LogIn,
  LogOut,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Toaster, toast } from "sonner";

import "./App.css";
import "./module-primitives.css";
import "./theme-overrides.css";
import DeveloperCenterTab from "./components/DeveloperCenterTab";
import RDMTab from "./components/RDMTab";
import AMPanelTab from "./components/AMPanelTab";
import ToolsTab from "./components/ToolsTab";
import SystemSettingsTab from "./components/SystemSettingsTab";
import URAVersioningTab from "./components/URAVersioningTab";
import usePoJiraData from "./hooks/usePoJiraData";
import {
  fetchCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
} from "./lib/auth";
import {
  fetchCalendarSettings,
  saveCalendarSettings,
} from "./lib/systemSettings";
import {
  DEFAULT_CALENDAR_SETTINGS,
  normalizeCalendarSettings,
} from "./utils/businessCalendar";

import "react-day-picker/dist/style.css";

const AUTH_SESSION_EXPIRED_EVENT = "devflow:auth-session-expired";
const SAVED_LOGIN_CREDENTIALS_KEY = "devflow:saved-login-credentials:v1";
const MAX_SAVED_LOGIN_CREDENTIALS = 5;

function readSavedLoginCredentials() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(SAVED_LOGIN_CREDENTIALS_KEY);
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];

    const seen = new Set();

    return parsed
      .map((item) => ({
        email: String(item?.email || "").trim(),
        password: String(item?.password || ""),
        savedAt: Number(item?.savedAt || 0),
      }))
      .filter((item) => item.email && item.password)
      .filter((item) => {
        const key = item.email.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, MAX_SAVED_LOGIN_CREDENTIALS);
  } catch {
    return [];
  }
}

function writeSavedLoginCredentials(credentials) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      SAVED_LOGIN_CREDENTIALS_KEY,
      JSON.stringify(credentials),
    );
  } catch {
    // Ignora falhas de armazenamento local; o login continua funcionando.
  }
}

function saveLoginCredential({ email, password }) {
  const normalizedEmail = String(email || "").trim();
  if (!normalizedEmail || !password) return readSavedLoginCredentials();

  const previousCredentials = readSavedLoginCredentials();
  const nextCredentials = [
    {
      email: normalizedEmail,
      password,
      savedAt: Date.now(),
    },
    ...previousCredentials.filter(
      (item) => item.email.toLowerCase() !== normalizedEmail.toLowerCase(),
    ),
  ].slice(0, MAX_SAVED_LOGIN_CREDENTIALS);

  writeSavedLoginCredentials(nextCredentials);
  return nextCredentials;
}

function isSameOriginApiRequest(input) {
  try {
    const rawUrl = typeof input === "string" ? input : input?.url;
    if (!rawUrl) return false;
    const url = new URL(rawUrl, window.location.origin);
    return (
      url.origin === window.location.origin && url.pathname.startsWith("/api/")
    );
  } catch {
    return false;
  }
}

const MAIN_TABS = [
  {
    id: "gmud",
    title: "Central do Desenvolvedor",
    eyebrow: "Fluxo operacional assistido",
    subtitle:
      "Organize tickets, scripts, variáveis, evidências e o Kanban da mudança em um só lugar.",
    badge: "GMUD",
    icon: Blocks,
    nextStep: "Sincronize o ticket e avance pela jornada de execução.",
  },
  {
    id: "rdm",
    title: "RDM • Requisição de Mudança",
    eyebrow: "Documentação pronta para entrega",
    subtitle:
      "Monte uma RDM clara, bem distribuída e com leitura executiva, sem alterar o fluxo que já existe.",
    badge: "RDM",
    icon: FileText,
    nextStep:
      "Preencha os blocos essenciais e valide no preview antes de exportar.",
  },
  {
    id: "am",
    title: "Painel de Acompanhamento (PO)",
    eyebrow: "Operação com visão executiva",
    subtitle:
      "Acompanhe tickets, calendário, Gantt e dashboard com uma experiência mais limpa e orientada à decisão.",
    badge: "Jira",
    icon: LayoutDashboard,
    nextStep:
      "Use a visão certa para decidir rápido e agir sem trocar de contexto.",
  },
  {
    id: "my",
    title: "Minha Carteira",
    eyebrow: "Foco pessoal",
    subtitle:
      "Veja seus tickets, riscos, vencimentos e próximos passos a partir do seu usuário Jira.",
    badge: "Meu Jira",
    icon: Briefcase,
    nextStep: "Configure seu usuário Jira e acompanhe sua fila pessoal.",
  },
  {
    id: "versioning",
    title: "Versionamentos",
    eyebrow: "Histórico de URAs",
    subtitle:
      "Controle versões implantadas, mudanças realizadas, responsáveis e tickets relacionados.",
    badge: "URA",
    icon: GitBranch,
    nextStep: "Selecione uma URA ou registre um novo versionamento.",
  },
  {
    id: "tools",
    title: "Ferramentas",
    eyebrow: "Utilitários essenciais",
    subtitle:
      "Transcrição, TTS, automação e integrações em uma área mais direta e limpa.",
    badge: "URA",
    icon: Sparkles,
    nextStep: "Escolha a ferramenta e execute sem sair do fluxo.",
  },
  {
    id: "settings",
    title: "Configurações do Sistema",
    eyebrow: "Administração global",
    subtitle:
      "Defina regras compartilhadas, dias úteis e feriados que orientam a operação.",
    badge: "Sistema",
    icon: Settings2,
    nextStep: "Revise o calendário global antes de recalcular cronogramas.",
  },
];

const MAIN_TAB_IDS = new Set(MAIN_TABS.map((tab) => tab.id));

function normalizeDefaultTab(tabId) {
  return MAIN_TAB_IDS.has(tabId) ? tabId : "gmud";
}

const DEFAULT_PRIMARY_COLOR = "#cf0013";
const VALID_DENSITIES = new Set(["comfortable", "compact"]);
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function normalizePrimaryColor(value) {
  const color = String(value || "").trim();
  return HEX_COLOR_RE.test(color) ? color.toLowerCase() : DEFAULT_PRIMARY_COLOR;
}

function hexToRgb(hex) {
  const normalized = normalizePrimaryColor(hex).slice(1);
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function mixRgb(left, right, amount) {
  return {
    r: Math.round(left.r + (right.r - left.r) * amount),
    g: Math.round(left.g + (right.g - left.g) * amount),
    b: Math.round(left.b + (right.b - left.b) * amount),
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((value) =>
      Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"),
    )
    .join("")}`;
}

function buildPrimaryColorVars(primaryColor) {
  const base = normalizePrimaryColor(primaryColor);
  const rgb = hexToRgb(base);
  const dark = rgbToHex(mixRgb(rgb, { r: 0, g: 0, b: 0 }, 0.18));
  const soft = rgbToHex(mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.88));

  return {
    "--primary": rgbToHsl(rgb),
    "--ring": rgbToHsl(rgb),
    "--chart-1": rgbToHsl(rgb),
    "--claro-red": base,
    "--claro-red-strong": dark,
    "--claro-red-soft": soft,
    "--claro-red-glow": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`,
    "--theme-glow-primary": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`,
    "--theme-primary-color": base,
  };
}

function AppShell({ currentUser, onLogout, onUserUpdated }) {
  const preferences = currentUser?.preferences || {};
  const preferredTab = normalizeDefaultTab(preferences.defaultTab);
  const [mainTab, setMainTab] = useState(preferredTab);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    Boolean(preferences.sidebarCollapsed),
  );
  const [visitedTabs, setVisitedTabs] = useState(() => new Set([preferredTab]));
  const [gmudProgressPct, setGmudProgressPct] = useState(0);
  const [rdmTitle, setRdmTitle] = useState("");
  const [rdmDueDate, setRdmDueDate] = useState("");
  const [calendarSettings, setCalendarSettings] = useState(
    DEFAULT_CALENDAR_SETTINGS,
  );
  const [calendarSettingsLoading, setCalendarSettingsLoading] = useState(false);
  const poData = usePoJiraData();
  const [amStartTicketRequest, setAmStartTicketRequest] = useState(null);
  const [amTicketDetailsRequest, setAmTicketDetailsRequest] = useState(null);

  useEffect(() => {
    let active = true;
    setCalendarSettingsLoading(true);
    fetchCalendarSettings()
      .then((settings) => {
        if (active) setCalendarSettings(normalizeCalendarSettings(settings));
      })
      .catch((err) => {
        console.warn("[App] Falha ao carregar calendario global.", err);
      })
      .finally(() => {
        if (active) setCalendarSettingsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const nextTab = normalizeDefaultTab(currentUser?.preferences?.defaultTab);
    setMainTab(nextTab);
    setVisitedTabs((prev) => {
      if (prev.has(nextTab)) return prev;
      const next = new Set(prev);
      next.add(nextTab);
      return next;
    });
  }, [currentUser?.preferences?.defaultTab]);

  useEffect(() => {
    setSidebarCollapsed(Boolean(currentUser?.preferences?.sidebarCollapsed));
  }, [currentUser?.preferences?.sidebarCollapsed]);

  const shellStyle = useMemo(
    () => buildPrimaryColorVars(currentUser?.preferences?.primaryColor),
    [currentUser?.preferences?.primaryColor],
  );
  const density = VALID_DENSITIES.has(currentUser?.preferences?.density)
    ? currentUser.preferences.density
    : "comfortable";

  async function handleSaveCalendarSettings(nextSettings) {
    const saved = await saveCalendarSettings(nextSettings);
    setCalendarSettings(normalizeCalendarSettings(saved));
    return saved;
  }

  const currentTab = useMemo(
    () => MAIN_TABS.find((tab) => tab.id === mainTab) || MAIN_TABS[0],
    [mainTab],
  );

  const tabMeta = useMemo(
    () => ({
      gmud: {
        status:
          gmudProgressPct > 0
            ? `${gmudProgressPct}% concluído`
            : "Aguardando ticket",
        helper:
          gmudProgressPct > 0
            ? "Jornada operacional já iniciada."
            : "Preencha projeto, OS e ticket para começar.",
      },
      rdm: {
        status: rdmTitle ? "Rascunho em andamento" : "Ainda não iniciada",
        helper: rdmDueDate
          ? `Janela definida para ${rdmDueDate}.`
          : "Estruture a documentação em blocos curtos.",
      },
      am: {
        status: "Monitoramento ativo",
        helper: "Alertas, calendário, Gantt e dashboard no mesmo fluxo.",
      },
      my: {
        status: currentUser?.jiraAccountId
          ? "Perfil Jira ativo"
          : "Configurar Jira",
        helper: currentUser?.jiraDisplayName || "Selecione seu usuário Jira.",
      },
      versioning: {
        status: "Histórico de URAs",
        helper: "Consulte e registre versões implantadas.",
      },
      tools: {
        status: "Utilitários disponíveis",
        helper: "Acesso rápido às integrações do ambiente.",
      },
      settings: {
        status: calendarSettingsLoading
          ? "Carregando calendário"
          : "Calendário global",
        helper: "Dias úteis e feriados compartilhados.",
      },
    }),
    [
      calendarSettingsLoading,
      currentUser?.jiraAccountId,
      currentUser?.jiraDisplayName,
      gmudProgressPct,
      rdmDueDate,
      rdmTitle,
    ],
  );

  const contentClassName = [
    "app-module",
    mainTab === "am" || mainTab === "my" ? "app-module--flush" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const CurrentIcon = currentTab.icon;
  const ToggleSidebarIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;

  function selectMainTab(tabId) {
    setMainTab(tabId);
    setVisitedTabs((prev) => {
      if (prev.has(tabId)) return prev;
      const next = new Set(prev);
      next.add(tabId);
      return next;
    });
  }

  function openAmStartTicketModal(request = {}) {
    const ticketKey = String(request.ticketKey || request.issue?.key || "")
      .trim()
      .toUpperCase();

    if (!ticketKey) {
      toast.error("Ticket inválido para iniciar.");
      return;
    }

    setAmStartTicketRequest({
      id: `${ticketKey}:${Date.now()}`,
      ticketKey,
      issue: request.issue || { key: ticketKey },
      source: request.source || "developer-workspace",
    });

    selectMainTab("am");
  }

  function openAmTicketDetailsModal(request = {}) {
    const ticketKey = String(
      request.ticketKey || request.issue?.key || request.key || "",
    )
      .trim()
      .toUpperCase();

    if (!ticketKey) {
      toast.error("Ticket inválido para abrir detalhes.");
      return;
    }

    setAmTicketDetailsRequest({
      id: `${ticketKey}:${Date.now()}`,
      ticketKey,
      issue: request.issue || { key: ticketKey },
      source: request.source || "developer-workspace",
    });

    selectMainTab("am");
  }

  return (
    <>
      <div
        data-theme={currentUser?.preferences?.theme || "claro"}
        data-density={density}
        style={shellStyle}
        className={`app-shell app-shell--${mainTab} ${
          sidebarCollapsed ? "app-shell--sidebar-collapsed" : ""
        }`}
      >
        <div className="app-shell__backdrop" aria-hidden="true">
          <span className="app-shell__orb app-shell__orb--primary" />
          <span className="app-shell__orb app-shell__orb--secondary" />
          <span className="app-shell__grid" />
        </div>

        <div className="app-frame">
          <aside className="app-sidebar">
            <button
              type="button"
              className="app-sidebar__toggle"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={
                sidebarCollapsed
                  ? "Expandir menu lateral"
                  : "Recolher menu lateral"
              }
              aria-pressed={sidebarCollapsed}
              title={
                sidebarCollapsed
                  ? "Expandir menu lateral"
                  : "Recolher menu lateral"
              }
            >
              <ToggleSidebarIcon className="h-4 w-4" />
            </button>

            <div className="app-brand">
              <span className="app-brand__badge">Claro Dev Flow</span>

              <div className="app-brand__row">
                <img
                  className="app-brand__logo"
                  src="https://upload.wikimedia.org/wikipedia/commons/0/0c/Claro.svg"
                  alt="Logo Claro"
                />

                <div>
                  <p className="app-brand__eyebrow">Plataforma operacional</p>
                  <h1 className="app-brand__title">Experiência unificada</h1>
                </div>
              </div>
            </div>

            <div className="app-user-card">
              <div className="app-user-card__avatar" aria-hidden="true">
                {String(currentUser?.name || currentUser?.email || "?")
                  .slice(0, 1)
                  .toUpperCase()}
              </div>

              <div className="app-user-card__content">
                <strong>{currentUser?.name || "Usuario"}</strong>
                <span>{currentUser?.email}</span>
              </div>

              <button
                type="button"
                className="app-user-card__logout"
                onClick={onLogout}
                aria-label="Sair"
                title="Sair"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>

            <nav className="app-nav" role="tablist" aria-label="Módulos">
              {MAIN_TABS.map((tab) => {
                const TabIcon = tab.icon;
                const isActive = tab.id === mainTab;
                const meta = tabMeta[tab.id];

                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`app-nav__item ${isActive ? "is-active" : ""}`}
                    onClick={() => selectMainTab(tab.id)}
                    title={sidebarCollapsed ? tab.title : undefined}
                  >
                    <span className="app-nav__icon">
                      <TabIcon className="h-5 w-5" />
                    </span>

                    <span className="app-nav__content">
                      <span className="app-nav__label">{tab.title}</span>
                      <span className="app-nav__caption">{meta.status}</span>
                    </span>

                    <ChevronRight className="app-nav__chevron h-4 w-4" />
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="app-main">
            <section className="app-hero app-hero--compact">
              <div className="app-hero__copy">
                <span className="app-hero__eyebrow">{currentTab.eyebrow}</span>

                <div className="app-hero__heading">
                  <div className="app-hero__icon">
                    <CurrentIcon className="h-6 w-6" />
                  </div>

                  <div>
                    <h2>{currentTab.title}</h2>
                    <p>{currentTab.subtitle}</p>
                  </div>
                </div>

                <div className="app-hero__chips app-hero__chips--overview">
                  <span className="app-chip app-chip--solid">
                    {currentTab.badge}
                  </span>
                  {mainTab !== "am" &&
                  mainTab !== "tools" &&
                  mainTab !== "gmud" &&
                  mainTab !== "my" ? (
                    <>
                      <span className="app-chip">
                        {tabMeta[mainTab].status}
                      </span>
                      <span className="app-chip">
                        {tabMeta[mainTab].helper}
                      </span>
                    </>
                  ) : mainTab === "tools" ? (
                    <span className="app-chip">{tabMeta[mainTab].status}</span>
                  ) : null}
                </div>

                {mainTab !== "am" &&
                mainTab !== "tools" &&
                mainTab !== "gmud" &&
                mainTab !== "my" ? (
                  <div className="app-hero__focus">
                    <span className="app-hero__focus-label">Próxima ação</span>
                    <strong>{currentTab.nextStep}</strong>
                  </div>
                ) : null}

                {mainTab === "rdm" ? (
                  <div className="app-hero__meta-row">
                    <span className="app-chip">
                      {rdmTitle ? "Título definido" : "Sem título"}
                    </span>
                    <span className="app-chip">
                      {rdmDueDate ? "Janela informada" : "Sem data limite"}
                    </span>
                  </div>
                ) : null}
              </div>
            </section>

            <section className={contentClassName}>
              {mainTab === "rdm" ? (
                <RDMTab initialTitle={rdmTitle} initialDueDate={rdmDueDate} />
              ) : null}

              {mainTab === "gmud" ? (
                <DeveloperCenterTab
                  currentUser={currentUser}
                  poData={poData}
                  onConfigureUser={() => selectMainTab("settings")}
                  onStartTicket={openAmStartTicketModal}
                  onOpenTicketDetails={openAmTicketDetailsModal}
                  onProgressChange={setGmudProgressPct}
                  onRdmTitleChange={setRdmTitle}
                  onRdmDueDateChange={setRdmDueDate}
                />
              ) : null}

              {visitedTabs.has("am") ? (
                <div hidden={mainTab !== "am"}>
                  <AMPanelTab
                    calendarSettings={calendarSettings}
                    currentUser={currentUser}
                    poData={poData}
                    startTicketRequest={amStartTicketRequest}
                    ticketDetailsRequest={amTicketDetailsRequest}
                  />
                </div>
              ) : null}

              {visitedTabs.has("my") ? (
                <div hidden={mainTab !== "my"}>
                  <AMPanelTab
                    calendarSettings={calendarSettings}
                    currentUser={currentUser}
                    poData={poData}
                    personalMode
                    onConfigureUser={() => selectMainTab("settings")}
                  />
                </div>
              ) : null}

              {visitedTabs.has("versioning") ? (
                <div hidden={mainTab !== "versioning"}>
                  <URAVersioningTab />
                </div>
              ) : null}

              {mainTab === "tools" ? <ToolsTab /> : null}

              {mainTab === "settings" ? (
                <SystemSettingsTab
                  currentUser={currentUser}
                  calendarSettings={calendarSettings}
                  calendarSettingsLoading={calendarSettingsLoading}
                  onSaveCalendarSettings={handleSaveCalendarSettings}
                  onUserUpdated={onUserUpdated}
                />
              ) : null}
            </section>
          </main>
        </div>
      </div>

      <Toaster richColors position="top-right" />
    </>
  );
}

function AuthScreen({ onAuthenticated }) {
  const initialSavedCredentials = useMemo(
    () => readSavedLoginCredentials(),
    [],
  );
  const [mode, setMode] = useState("login");
  const [savedCredentials, setSavedCredentials] = useState(
    initialSavedCredentials,
  );
  const [email, setEmail] = useState(initialSavedCredentials[0]?.email || "");
  const [password, setPassword] = useState(
    initialSavedCredentials[0]?.password || "",
  );
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [rememberMe, setRememberMe] = useState(
    initialSavedCredentials.length > 0,
  );
  const [saveCredentials, setSaveCredentials] = useState(
    initialSavedCredentials.length > 0,
  );
  const [autofilledEmail, setAutofilledEmail] = useState(
    initialSavedCredentials[0]?.email || "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isRegister = mode === "register";

  function handleEmailChange(value) {
    setEmail(value);

    if (isRegister) return;

    const savedCredential = savedCredentials.find(
      (item) => item.email.toLowerCase() === value.trim().toLowerCase(),
    );

    if (savedCredential) {
      setPassword(savedCredential.password);
      setAutofilledEmail(savedCredential.email);
      setRememberMe(true);
      setSaveCredentials(true);
      return;
    }

    if (
      autofilledEmail &&
      value.trim().toLowerCase() !== autofilledEmail.toLowerCase()
    ) {
      setPassword("");
      setAutofilledEmail("");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const user = isRegister
        ? await registerUser({ email, password, jiraApiToken })
        : await loginUser({ email, password, rememberMe });
      if (!isRegister && saveCredentials) {
        setSavedCredentials(saveLoginCredential({ email, password }));
      }
      onAuthenticated(user);
    } catch (err) {
      setError(err?.message || "Não foi possível autenticar.");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleMode() {
    const nextMode = mode === "login" ? "register" : "login";
    setMode(nextMode);
    setError("");
    setAutofilledEmail("");

    if (nextMode === "register") {
      setPassword("");
      setJiraApiToken("");
      setRememberMe(false);
      setSaveCredentials(false);
      return;
    }

    const savedCredential =
      savedCredentials.find(
        (item) => item.email.toLowerCase() === email.trim().toLowerCase(),
      ) || savedCredentials[0];

    if (savedCredential) {
      setEmail(savedCredential.email);
      setPassword(savedCredential.password);
      setAutofilledEmail(savedCredential.email);
      setRememberMe(true);
      setSaveCredentials(true);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-brand">
          <img
            className="auth-brand__logo"
            src="https://upload.wikimedia.org/wikipedia/commons/0/0c/Claro.svg"
            alt="Logo Claro"
          />
          <div>
            <span>Claro Dev Flow</span>
            <h1 id="auth-title">
              {isRegister ? "Criar acesso" : "Entrar na plataforma"}
            </h1>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>E-mail corporativo</span>
            <div className="auth-field__control">
              <Mail className="h-4 w-4" />
              <input
                type="email"
                value={email}
                onChange={(event) => handleEmailChange(event.target.value)}
                list={
                  !isRegister && savedCredentials.length
                    ? "auth-saved-emails"
                    : undefined
                }
                autoComplete="email"
                required
              />
              {!isRegister && savedCredentials.length ? (
                <datalist id="auth-saved-emails">
                  {savedCredentials.map((item) => (
                    <option key={item.email} value={item.email} />
                  ))}
                </datalist>
              ) : null}
            </div>
          </label>

          <label className="auth-field">
            <span>Senha</span>
            <div className="auth-field__control">
              <KeyRound className="h-4 w-4" />
              <input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setAutofilledEmail("");
                }}
                autoComplete={isRegister ? "new-password" : "current-password"}
                minLength={8}
                required
              />
            </div>
          </label>

          {isRegister ? (
            <label className="auth-field">
              <span>Token do Jira</span>
              <div className="auth-field__control">
                <KeyRound className="h-4 w-4" />
                <input
                  type="password"
                  value={jiraApiToken}
                  onChange={(event) => setJiraApiToken(event.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
            </label>
          ) : null}

          {!isRegister ? (
            <div className="auth-options">
              <label className="auth-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span className="auth-remember__box" aria-hidden="true">
                  {rememberMe ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span>Manter logado</span>
              </label>

              <label className="auth-remember">
                <input
                  type="checkbox"
                  checked={saveCredentials}
                  onChange={(event) => setSaveCredentials(event.target.checked)}
                />
                <span className="auth-remember__box" aria-hidden="true">
                  {saveCredentials ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span>Salvar senha neste computador</span>
              </label>
            </div>
          ) : null}

          {error ? <p className="auth-error">{error}</p> : null}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {isRegister ? (
              <UserPlus className="h-4 w-4" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {submitting
              ? "Validando..."
              : isRegister
                ? "Cadastrar e entrar"
                : "Entrar"}
          </button>
        </form>

        <div className="auth-actions">
          <button type="button" onClick={toggleMode}>
            {isRegister ? "Ja tenho cadastro" : "Criar cadastro"}
          </button>

          {isRegister ? (
            <a
              href="/tutorials/apresentacao-criar-token-api-jira.pptx"
              download
            >
              <Download className="h-4 w-4" />
              Baixar tutorial do token
            </a>
          ) : null}
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async (...args) => {
      const response = await originalFetch(...args);

      if (response.status === 401 && isSameOriginApiRequest(args[0])) {
        response
          .clone()
          .json()
          .then((payload) => {
            if (payload?.error?.code === "AUTH_REQUIRED") {
              window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
            }
          })
          .catch(() => null);
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    function handleSessionExpired() {
      setCurrentUser((user) => {
        if (user) toast.error("Sessão expirada. Entre novamente.");
        return null;
      });
    }

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(
        AUTH_SESSION_EXPIRED_EVENT,
        handleSessionExpired,
      );
    };
  }, []);

  useEffect(() => {
    let active = true;

    fetchCurrentUser()
      .then((user) => {
        if (active) setCurrentUser(user);
      })
      .catch(() => {
        if (active) setCurrentUser(null);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleLogout() {
    await logoutUser().catch(() => null);
    setCurrentUser(null);
  }

  if (authLoading) {
    return (
      <main className="auth-shell">
        <section className="auth-panel auth-panel--loading">
          <span className="auth-loading-dot" />
          <p>Carregando sessão...</p>
        </section>
      </main>
    );
  }

  if (!currentUser) {
    return <AuthScreen onAuthenticated={setCurrentUser} />;
  }

  return (
    <AppShell
      currentUser={currentUser}
      onLogout={handleLogout}
      onUserUpdated={setCurrentUser}
    />
  );
}
