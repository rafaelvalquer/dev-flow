// src/App.jsx
import React, { useEffect, useState } from "react";
import "./App.css";
import ChecklistGMUDTab from "./components/ChecklistGMUDTab";
import RDMTab from "./components/RDMTab";
import AMPanelTab from "./components/AMPanelTab";
import { CONFIG_KEY } from "./utils/gmudUtils";
import "react-day-picker/dist/style.css";
import { Toaster } from "sonner";

const TAB_TITLES = {
  gmud: "Checklist GMUD",
  rdm: "RDM – Requisição de Mudança",
  am: "Painel de Acompanhamento (PO)", // Sugestão de nome (troque se quiser)
};

export default function App() {
  const [mainTab, setMainTab] = useState("gmud");
  const [gmudProgressPct, setGmudProgressPct] = useState(0);

  // NOVO: título que será enviado para a aba RDM
  const [rdmTitle, setRdmTitle] = useState("");
  const [rdmDueDate, setRdmDueDate] = useState("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsEmail, setSettingsEmail] = useState("");
  const [settingsToken, setSettingsToken] = useState("");

  useEffect(() => {
    const c = localStorage.getItem(CONFIG_KEY);
    if (c) {
      try {
        const { email, token } = JSON.parse(c);
        setSettingsEmail(email || "");
        setSettingsToken(token || "");
      } catch {}
    }
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") setSettingsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleSettings(force) {
    setSettingsOpen((v) => (typeof force === "boolean" ? force : !v));
  }
  function salvarConfiguracoes() {
    localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ email: settingsEmail, token: settingsToken })
    );
    toggleSettings(false);
  }

  return (
    <>
      {/* ABAS PRINCIPAIS - FORA DO CONTAINER */}
      <div className="main-tabs top" role="tablist" aria-label="Módulos">
        <button
          role="tab"
          aria-selected={mainTab === "gmud"}
          className={`main-tab ${mainTab === "gmud" ? "active" : ""}`}
          onClick={() => setMainTab("gmud")}
        >
          Checklist GMUD
        </button>

        <button
          role="tab"
          aria-selected={mainTab === "rdm"}
          className={`main-tab ${mainTab === "rdm" ? "active" : ""}`}
          onClick={() => setMainTab("rdm")}
        >
          RDM – Requisição de Mudança
        </button>

        {/* NOVO: Aba do Painel */}
        <button
          role="tab"
          aria-selected={mainTab === "am"}
          className={`main-tab ${mainTab === "am" ? "active" : ""}`}
          onClick={() => setMainTab("am")}
        >
          Painel de Acompanhamento (PO)
        </button>
      </div>

      {/* CONTAINER PRINCIPAL */}
      <div className="container">
        <header>
          <div>
            <img
              className="logo"
              src="https://upload.wikimedia.org/wikipedia/commons/0/0c/Claro.svg"
              alt="Logo Claro"
            />
            <h1>{TAB_TITLES[mainTab] || "Módulo"}</h1>

            {mainTab === "gmud" && (
              <div className="progress-general">
                <div className="bar" style={{ width: `${gmudProgressPct}%` }} />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => toggleSettings(true)}
            aria-expanded={settingsOpen}
            className="btn-primary btn-primary--sm"
          >
            <span aria-hidden="true">⚙</span>
            Configurações
          </button>
        </header>

        {/* Conteúdo das abas */}
        {mainTab === "rdm" && (
          <RDMTab initialTitle={rdmTitle} initialDueDate={rdmDueDate} />
        )}

        {mainTab === "gmud" && (
          <ChecklistGMUDTab
            onProgressChange={setGmudProgressPct}
            onRdmTitleChange={setRdmTitle}
            onRdmDueDateChange={setRdmDueDate}
          />
        )}

        {mainTab === "am" && (
          <AMPanelTab
            // opcional: você pode passar settingsEmail/settingsToken se for usar em chamadas futuras
            settingsEmail={settingsEmail}
            settingsToken={settingsToken}
          />
        )}

        {/* Painel de Configurações */}
        <div
          id="settings-panel"
          className={`settings-panel ${settingsOpen ? "aberta" : ""}`}
        >
          <div
            className="settings-header"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <span>Configurações</span>
            <button
              type="button"
              className="close-settings"
              onClick={() => toggleSettings(false)}
            >
              ×
            </button>
          </div>

          <div className="settings-body" style={{ display: "grid", gap: 10 }}>
            <label htmlFor="settingsEmail">E-mail (uso local)</label>
            <input
              id="settingsEmail"
              type="email"
              value={settingsEmail}
              onChange={(e) => setSettingsEmail(e.target.value)}
              placeholder="seu.email@dominio"
            />

            <label htmlFor="settingsToken">
              Token (não é usado pelo navegador)
            </label>
            <input
              id="settingsToken"
              value={settingsToken}
              onChange={(e) => setSettingsToken(e.target.value)}
              placeholder="Token de acesso"
            />

            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                type="button"
                className="primary"
                onClick={salvarConfiguracoes}
              >
                Salvar configurações
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
