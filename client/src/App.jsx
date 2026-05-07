import React, { useMemo, useState } from "react";
import {
  Blocks,
  ChevronRight,
  FileText,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
} from "lucide-react";
import { Toaster } from "sonner";

import "./App.css";
import "./module-primitives.css";
import "./theme-overrides.css";
import ChecklistGMUDTab from "./components/ChecklistGMUDTab";
import RDMTab from "./components/RDMTab";
import AMPanelTab from "./components/AMPanelTab";
import ToolsTab from "./components/ToolsTab";

import "react-day-picker/dist/style.css";

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
    nextStep: "Preencha os blocos essenciais e valide no preview antes de exportar.",
  },
  {
    id: "am",
    title: "Painel de Acompanhamento (PO)",
    eyebrow: "Operação com visão executiva",
    subtitle:
      "Acompanhe tickets, calendário, Gantt e dashboard com uma experiência mais limpa e orientada à decisão.",
    badge: "Jira",
    icon: LayoutDashboard,
    nextStep: "Use a visão certa para decidir rápido e agir sem trocar de contexto.",
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
];

export default function App() {
  const [mainTab, setMainTab] = useState("gmud");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["gmud"]));
  const [gmudProgressPct, setGmudProgressPct] = useState(0);
  const [rdmTitle, setRdmTitle] = useState("");
  const [rdmDueDate, setRdmDueDate] = useState("");

  const currentTab = useMemo(
    () => MAIN_TABS.find((tab) => tab.id === mainTab) || MAIN_TABS[0],
    [mainTab]
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
      tools: {
        status: "Utilitários disponíveis",
        helper: "Acesso rápido às integrações do ambiente.",
      },
    }),
    [gmudProgressPct, rdmDueDate, rdmTitle]
  );

  const contentClassName = [
    "app-module",
    mainTab === "am" ? "app-module--flush" : "",
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

  return (
    <>
      <div
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
            <section className={`app-hero ${mainTab === "am" || mainTab === "tools" || mainTab === "gmud" ? "app-hero--compact" : ""}`}>
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
                  {mainTab !== "am" && mainTab !== "tools" && mainTab !== "gmud" ? (
                    <>
                      <span className="app-chip">{tabMeta[mainTab].status}</span>
                      <span className="app-chip">{tabMeta[mainTab].helper}</span>
                    </>
                  ) : mainTab === "tools" ? (
                    <span className="app-chip">{tabMeta[mainTab].status}</span>
                  ) : null}
                </div>

                {mainTab !== "am" && mainTab !== "tools" && mainTab !== "gmud" ? (
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

              {mainTab !== "am" && mainTab !== "tools" && mainTab !== "gmud" ? (
                <div className="app-hero__panel">
                  <div className="app-hero__panel-card">
                    <span className="app-hero__panel-label">Estado atual</span>
                    <strong>{tabMeta[mainTab].status}</strong>
                    <p>{tabMeta[mainTab].helper}</p>
                  </div>

                  <div className="app-hero__panel-card">
                    <span className="app-hero__panel-label">
                      Direção de layout
                    </span>
                    <strong>Menos densidade, mais foco</strong>
                    <p>
                      Headers contextuais, áreas sticky e blocos reutilizáveis em
                      todos os módulos.
                    </p>
                  </div>
                </div>
              ) : null}
            </section>

            <section className={contentClassName}>
              {mainTab === "rdm" ? (
                <RDMTab initialTitle={rdmTitle} initialDueDate={rdmDueDate} />
              ) : null}

              {mainTab === "gmud" ? (
                <ChecklistGMUDTab
                  onProgressChange={setGmudProgressPct}
                  onRdmTitleChange={setRdmTitle}
                  onRdmDueDateChange={setRdmDueDate}
                />
              ) : null}

              {visitedTabs.has("am") ? (
                <div hidden={mainTab !== "am"}>
                  <AMPanelTab />
                </div>
              ) : null}

              {mainTab === "tools" ? <ToolsTab /> : null}
            </section>
          </main>
        </div>
      </div>

      <Toaster richColors position="top-right" />
    </>
  );
}
