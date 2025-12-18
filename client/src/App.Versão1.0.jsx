import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { adfFromTagAndText, adfToPlainText } from "./lib/adf";
import {
  getIssue,
  getComments,
  createComment,
  updateComment,
  createSubtask,
  transitionToDone,
  uploadAttachments,
  listAttachments,
  buildDownloadLinks,
} from "./lib/jira";

/* ---------- Constantes ---------- */
const CHECKBOX_IDS = [
  "dev1",
  "dev2",
  "dev3",
  "dev4",
  "dev5",
  "dev6",
  "qa1",
  "qa2",
  "qa3",
  "qa4",
  "qa5",
  "homo1",
  "homo2",
  "impl1",
  "impl2",
  "impl3",
  "pos1",
  "pos2",
];

const LABELS = {
  dev1: "Manual de boas práticas aplicado",
  dev2: "Testes de API (sucesso e erro)",
  dev3: "Testes de fluxo completos",
  dev4: "CDR Validado",
  dev5: "Documentação criada",
  dev6: "Documento GMUD preenchido",
  qa1: "Documentação recebida",
  qa2: "Casos de teste elaborados",
  qa3: "Testes executados e evidenciados",
  qa4: "Relatório enviado ao Desenvolvedor e GP",
  qa5: "Indicadores atualizados",
  homo1: "Testes acompanhados pelo solicitante",
  homo2: "'De acordo' para GMUD obtido do solicitante",
  impl1: "Implantação acompanhada com suporte",
  impl2: "OS e GMUD registradas no painel",
  impl3: "Validação implantação concluída",
  pos1: "Certificação do solicitante",
  pos2: "Indicadores acompanhados",
};

const PHASES = [
  {
    key: "dev",
    title: "Desenvolvimento",
    icon: "fas fa-code",
    ids: ["dev1", "dev2", "dev3", "dev4", "dev5", "dev6"],
  },
  {
    key: "qa",
    title: "QA",
    icon: "fas fa-vial",
    ids: ["qa1", "qa2", "qa3", "qa4", "qa5"],
  },
  {
    key: "homo",
    title: "Homologação",
    icon: "fas fa-users",
    ids: ["homo1", "homo2"],
  },
  {
    key: "impl",
    title: "Implantação",
    icon: "fas fa-rocket",
    ids: ["impl1", "impl2", "impl3"],
  },
  {
    key: "pos",
    title: "Pós-Implantação",
    icon: "fas fa-chart-line",
    ids: ["pos1", "pos2"],
  },
];

const SCRIPTS_TAG = "[Scripts alterados]";
const VARS_TAG = "[Variáveis de ambiente]";
const STORAGE_KEY = "checklist_gmud_vite";
const CONFIG_KEY = "checklist_gmud_config";
const TAB_KEY = "checklist_gmud_activeTab";
const RDM_KEY = "checklist_gmud_rdm";

//#region Utils
/* ---------- Utils ---------- */
function normalizeVarsText(str) {
  const lines = String(str || "")
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/\s*\|\s*/g, " | ")
        .replace(/\s*=\s*/g, " = ")
        .trimEnd()
    );
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n").trim();
}

function adfSafeToText(adf) {
  try {
    const t = adfToPlainText(adf || {});
    if (t && t.trim()) return t.trim();
  } catch {}
  // Fallbacks comuns do ADF do Jira
  try {
    return String(
      adf?.content?.[0]?.content?.text ??
        adf?.content?.[0]?.content?.[0]?.text ??
        ""
    ).trim();
  } catch {
    return "";
  }
}

function parseSummaryToFields(summary) {
  if (typeof summary !== "string") return null;
  const SEP = /\s*[-–—]+\s*/;
  const m = summary.match(/^\s*(OS\d+)\s*[-–—]*\s*(.+)$/i);
  if (!m) return null;
  const os = m[1];
  let rest = m[2].trim();
  let projectTag = "";
  const proj = rest.match(/^\[([^\]]+)\]\s*[-–—]*\s*(.*)$/);
  if (proj) {
    projectTag = `[${proj[1].trim()}]`;
    rest = (proj[2] || "").trim();
  }
  let firstChunk = (rest.split(SEP)[0] || "").split("(")[0].trim();
  if (!firstChunk) firstChunk = rest.split("(")[0].trim();
  const checklist =
    projectTag && firstChunk
      ? `${projectTag} - ${firstChunk}`
      : projectTag || firstChunk || "";
  return { os, checklist };
}
function computePending(rows, baselineSet) {
  const next = rows.map((r) => {
    const canon = normalizeVarsText(`${r.ambiente} | ${r.nome} = ${r.valor}`);
    const isEmpty = !canon;
    return { ...r, pendente: !isEmpty && !baselineSet.has(canon) };
  });
  const any = next.some((r) => r.pendente);
  return { next, any };
}

function updRdm(field, value) {
  setRdm((prev) => ({ ...prev, [field]: value }));
}
function salvarRdmLocal() {
  localStorage.setItem(RDM_KEY, JSON.stringify(rdm));
  alert("RDM salva localmente.");
}

/* ---------- Componente ---------- */
export default function App() {
  // Aba principal (módulos)
  const [mainTab, setMainTab] = useState("gmud");

  // RDM
  const [rdm, setRdm] = useState({
    titulo: "",
    oQue: "",
    porQue: "",
    paraQue: "",
    impacto: "",
    risco: "",
    rollback: "",
    data: "",
    inicio: "",
    fim: "",
    responsavel: "",
    aprovador: "",
    ambiente: "",
    observacoes: "",
  });

  // Projeto
  const [nomeProjeto, setNomeProjeto] = useState("");
  const [numeroGMUD, setNumeroGMUD] = useState("");
  const [ticketJira, setTicketJira] = useState("");

  // Checklist / comentários / anexos
  const [checkboxes, setCheckboxes] = useState(
    Object.fromEntries(CHECKBOX_IDS.map((id) => [id, false]))
  );
  const [scriptsAlterados, setScriptsAlterados] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [previewFiles, setPreviewFiles] = useState([]);

  // Variáveis
  const [chaves, setChaves] = useState([]); // {id, ambiente, nome, valor, pendente}
  const [varsBanner, setVarsBanner] = useState(false);
  const varsBaselineRef = useRef(new Set());

  // Jira
  const [jiraCtx, setJiraCtx] = useState(null); // {ticketKey, projectId, subtasksBySummary}
  const [scriptsComment, setScriptsComment] = useState({
    id: null,
    originalText: "",
  });
  const [varsComment, setVarsComment] = useState({
    id: null,
    originalText: "",
  });
  const [descricaoProjeto, setDescricaoProjeto] = useState("");
  const [criteriosAceite, setCriteriosAceite] = useState("");

  // topo do componente
  const fileInputRef = useRef(null);

  // UI
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsEmail, setSettingsEmail] = useState("");
  const [settingsToken, setSettingsToken] = useState("");
  const [activeTab, setActiveTab] = useState("scripts"); // scripts | vars | evidencias

  // Estados de carregamento
  const [syncing, setSyncing] = useState(false);
  const [savingScripts, setSavingScripts] = useState(false);
  const [savingVars, setSavingVars] = useState(false);
  const [uploading, setUploading] = useState(false);

  /* ---------- Load localStorage ---------- */
  useEffect(() => {
    const c = localStorage.getItem(CONFIG_KEY);
    if (c) {
      try {
        const { email, token } = JSON.parse(c);
        setSettingsEmail(email || "");
        setSettingsToken(token || "");
      } catch {}
    }
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      try {
        const d = JSON.parse(s);
        setNomeProjeto(d.projeto || "");
        setNumeroGMUD(d.gmud || "");
        setTicketJira(d.ticketJira || "");
        setScriptsAlterados(d.scriptsAlterados || "");
        setCheckboxes((prev) => ({ ...prev, ...d.checkboxes }));
        setChaves(
          (d.chaves || []).map((row) => ({
            ...row,
            id: crypto.randomUUID(),
            pendente: false,
          }))
        );
      } catch {}
    }
    const t = localStorage.getItem(TAB_KEY);
    if (t) setActiveTab(t);

    // RDM
    const r = localStorage.getItem(RDM_KEY);
    if (r) {
      try {
        setRdm(JSON.parse(r));
      } catch {}
    }
  }, []);

  // Persistência: RDM
  useEffect(() => {
    localStorage.setItem(RDM_KEY, JSON.stringify(rdm));
  }, [rdm]);

  /* ---------- Persist localStorage ---------- */
  useEffect(() => {
    const data = {
      projeto: nomeProjeto,
      gmud: numeroGMUD,
      ticketJira,
      scriptsAlterados,
      chaves: chaves.map(({ ambiente, nome, valor }) => ({
        ambiente,
        nome,
        valor,
      })),
      checkboxes,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [
    nomeProjeto,
    numeroGMUD,
    ticketJira,
    scriptsAlterados,
    chaves,
    checkboxes,
  ]);

  useEffect(() => {
    localStorage.setItem(TAB_KEY, activeTab);
  }, [activeTab]);

  /* ---------- Shortcuts (Ctrl+S) ---------- */
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (activeTab === "scripts") salvarScripts();
        if (activeTab === "vars") salvarVariaveis();
      }
      if (e.key === "Escape") setSettingsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeTab,
    scriptsAlterados,
    chaves,
    ticketJira,
    varsComment,
    scriptsComment,
  ]);

  /* ---------- UI helpers ---------- */
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

  function getChecklistItems() {
    return CHECKBOX_IDS.map((id) => ({ id, summary: LABELS[id] || id }));
  }

  /* ---------- Jira: sincronização ---------- */
  async function sincronizarJira() {
    if (!ticketJira.trim()) {
      alert("Preencha o Ticket do Jira (ex: ICON-245).");
      return;
    }
    setSyncing(true);
    try {
      setCheckboxes(Object.fromEntries(CHECKBOX_IDS.map((id) => [id, false])));
      setScriptsAlterados("");
      setChaves([]);

      const issue = await getIssue(
        ticketJira,
        "summary,subtasks,status,project,description,customfield_10903"
      );
      const projectId = issue.fields.project.id;
      const subtasks = issue.fields.subtasks || [];
      const subtasksBySummary = {};
      const descText = adfSafeToText(issue?.fields?.description);
      const criteriosText = adfSafeToText(issue?.fields?.customfield_10903);
      setDescricaoProjeto(descText);
      setCriteriosAceite(criteriosText);

      subtasks.forEach((st) => {
        const summary = (st.fields?.summary || "").trim();
        if (summary)
          subtasksBySummary[summary.toLowerCase()] = {
            key: st.key,
            id: st.id,
            status: st.fields?.status?.name || "",
          };
      });
      setJiraCtx({ ticketKey: issue.key, projectId, subtasksBySummary });

      const parsed = parseSummaryToFields(issue.fields?.summary || "");
      if (parsed) {
        setNumeroGMUD(parsed.os);
        setNomeProjeto(parsed.checklist);
      }

      const items = getChecklistItems();
      for (const it of items) {
        const k = it.summary.trim().toLowerCase();
        if (!subtasksBySummary[k]) {
          const created = await createSubtask(
            projectId,
            ticketJira,
            it.summary
          );
          subtasksBySummary[k] = {
            key: created.key,
            id: created.id,
            status: "",
          };
        }
      }
      const newChecks = {};
      items.forEach((it) => {
        const s =
          subtasksBySummary[
            it.summary.trim().toLowerCase()
          ]?.status?.toLowerCase() || "";
        newChecks[it.id] = ["concluído", "concluido", "done"].includes(s);
      });
      setCheckboxes((prev) => ({ ...prev, ...newChecks }));
      alert(`Sincronização concluída para ${ticketJira}.`);
    } catch (e) {
      console.error(e);
      alert("Erro ao sincronizar com o Jira: " + e.message);
    } finally {
      setSyncing(false);
    }

    // Comentários e anexos
    try {
      const payload = await getComments(ticketJira);
      // Scripts
      {
        const f = findTaggedComment(payload, SCRIPTS_TAG);
        if (f.found) {
          setScriptsComment({ id: f.id, originalText: f.textSemTag });
          setScriptsAlterados(f.textSemTag);
        } else {
          setScriptsComment({ id: null, originalText: "" });
        }
      }
      // Variáveis
      {
        const f = findTaggedComment(payload, VARS_TAG);
        if (f.found) {
          const norm = normalizeVarsText(f.textSemTag);
          setVarsComment({ id: f.id, originalText: norm });
          varsBaselineRef.current = new Set(norm.split("\n").filter(Boolean));
          renderChavesFromText(f.textSemTag);
          recomputeVarsPendingNow();
        } else {
          setVarsComment({ id: null, originalText: "" });
          varsBaselineRef.current = new Set();
          setChaves([]);
          setVarsBanner(false);
        }
      }
      try {
        await listarAnexos();
      } catch {}
    } catch (e) {
      console.warn("Falha ao carregar comentários:", e);
    }
  }
  function findTaggedComment(payload, tag) {
    const comments = payload.comments || [];
    for (const c of comments) {
      const plain = adfToPlainText(c.body || {});
      if (plain.trim().startsWith(tag)) {
        const textSemTag = plain.trim().slice(tag.length).trimStart();
        return { found: true, id: c.id, textSemTag };
      }
    }
    return { found: false, id: null, textSemTag: "" };
  }

  async function onToggleChecklist(id) {
    const checked = !checkboxes[id];
    if (!checked) {
      setCheckboxes({ ...checkboxes, [id]: false });
      return;
    }
    setCheckboxes({ ...checkboxes, [id]: true });

    if (!jiraCtx) {
      alert("Sincronize com o Jira antes.");
      return;
    }
    const summary = LABELS[id] || id;
    const key = summary.toLowerCase();
    let sub = jiraCtx.subtasksBySummary?.[key];
    try {
      if (!sub) {
        const created = await createSubtask(
          jiraCtx.projectId,
          jiraCtx.ticketKey,
          summary
        );
        sub = { key: created.key, id: created.id, status: "" };
        setJiraCtx((ctx) => ({
          ...ctx,
          subtasksBySummary: { ...ctx.subtasksBySummary, [key]: sub },
        }));
      }
      await transitionToDone(sub.key);
      sub.status = "Concluído";
    } catch (e) {
      console.error(e);
      alert("Erro ao concluir subtarefa no Jira: " + e.message);
      setCheckboxes((prev) => ({ ...prev, [id]: false }));
    }
  }

  /* ---------- Scripts ---------- */
  async function salvarScripts() {
    if (!ticketJira.trim()) {
      alert("Informe o ticket do Jira.");
      return;
    }
    const text = (scriptsAlterados || "").trim();
    if (!text) {
      alert("Campo vazio.");
      return;
    }
    setSavingScripts(true);
    try {
      if (scriptsComment.id) {
        if (text === scriptsComment.originalText) {
          alert("Sem alterações.");
          return;
        }
        const updated = await updateComment(
          ticketJira,
          scriptsComment.id,
          adfFromTagAndText(SCRIPTS_TAG, text)
        );
        setScriptsComment({ id: updated.id, originalText: text });
        alert("Comentário [Scripts alterados] atualizado.");
      } else {
        const created = await createComment(
          ticketJira,
          adfFromTagAndText(SCRIPTS_TAG, text)
        );
        setScriptsComment({ id: created.id, originalText: text });
        alert("Comentário [Scripts alterados] criado.");
      }
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar [Scripts alterados]: " + e.message);
    } finally {
      setSavingScripts(false);
    }
  }

  /* ---------- Variáveis ---------- */
  function renderChavesFromText(text) {
    const lines = normalizeVarsText(text).split("\n").filter(Boolean);
    const rows = lines.map((line) => {
      const m = line.match(/^([^|]+)\s\|\s([^=]+)\s=\s(.+)$/);
      if (m)
        return {
          id: crypto.randomUUID(),
          ambiente: m[1].trim(),
          nome: m[2].trim(),
          valor: m[3].trim(),
          pendente: false,
        };
      return {
        id: crypto.randomUUID(),
        ambiente: "",
        nome: line.trim(),
        valor: "",
        pendente: false,
      };
    });
    setChaves(rows);
  }
  function updChave(id, patch) {
    setChaves((prev) => {
      const rows = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      const { next, any } = computePending(rows, varsBaselineRef.current);
      setVarsBanner(any);
      return next;
    });
  }
  function addChave() {
    setChaves((prev) => {
      const rows = [
        ...prev,
        {
          id: crypto.randomUUID(),
          ambiente: "",
          nome: "",
          valor: "",
          pendente: true,
        },
      ];
      const { next, any } = computePending(rows, varsBaselineRef.current);
      setVarsBanner(any);
      return next;
    });
  }
  function rmChave(id) {
    setChaves((prev) => {
      const rows = prev.filter((r) => r.id !== id);
      const { next, any } = computePending(rows, varsBaselineRef.current);
      setVarsBanner(any);
      return next;
    });
  }
  function recomputeVarsPendingNow() {
    setChaves((prev) => {
      const { next, any } = computePending(prev, varsBaselineRef.current);
      setVarsBanner(any);
      return next;
    });
  }
  function buildVarsText() {
    const lines = chaves
      .map((r) =>
        `${r.ambiente || ""} | ${r.nome || ""} = ${r.valor || ""}`.trim()
      )
      .filter(
        (l) =>
          l !== " |  = " && l !== "|  =" && l.replace(/[|=]/g, "").trim() !== ""
      );
    return normalizeVarsText(lines.join("\n"));
  }
  async function salvarVariaveis() {
    if (!ticketJira.trim()) {
      alert("Informe o ticket.");
      return;
    }
    const text = buildVarsText();
    if (!text) {
      alert("Nenhuma variável preenchida.");
      return;
    }
    setSavingVars(true);
    try {
      const normalized = text;
      if (varsComment.id) {
        if (normalized === varsComment.originalText) {
          alert("Sem alterações.");
          return;
        }
        const updated = await updateComment(
          ticketJira,
          varsComment.id,
          adfFromTagAndText(VARS_TAG, normalized)
        );
        varsBaselineRef.current = new Set(
          normalized.split("\n").filter(Boolean)
        );
        setChaves((prev) => prev.map((r) => ({ ...r, pendente: false })));
        setVarsBanner(false);
        setVarsComment({ id: updated.id, originalText: normalized });
        alert("Variáveis atualizadas.");
      } else {
        const created = await createComment(
          ticketJira,
          adfFromTagAndText(VARS_TAG, normalized)
        );
        varsBaselineRef.current = new Set(
          normalized.split("\n").filter(Boolean)
        );
        setChaves((prev) => prev.map((r) => ({ ...r, pendente: false })));
        setVarsBanner(false);
        setVarsComment({ id: created.id, originalText: normalized });
        alert("Variáveis salvas.");
      }
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar variáveis: " + e.message);
    } finally {
      setSavingVars(false);
    }
  }

  /* ---------- Evidências ---------- */
  async function enviarArquivos() {
    if (!ticketJira.trim()) {
      alert("Informe o ticket.");
      return;
    }
    if (!previewFiles.length) {
      alert("Nenhum arquivo selecionado.");
      return;
    }
    setUploading(true);
    try {
      await uploadAttachments(ticketJira, previewFiles);
      alert("Arquivos enviados com sucesso.");
      setPreviewFiles([]);
      await listarAnexos();
    } catch (e) {
      console.error(e);
      alert("Erro ao enviar: " + e.message);
    } finally {
      setUploading(false);
    }
  }
  // função no componente
  function limparPreview() {
    setPreviewFiles([]);
    // também zera o input de arquivo, permitindo selecionar os mesmos arquivos novamente
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function listarAnexos() {
    const data = await listAttachments(ticketJira);
    setAttachments(data.attachments || []);
  }

  /* ---------- Progresso ---------- */
  const totalChecks = CHECKBOX_IDS.length;
  const doneChecks = useMemo(
    () => CHECKBOX_IDS.reduce((a, id) => a + (checkboxes[id] ? 1 : 0), 0),
    [checkboxes]
  );
  const geralPct = Math.round((doneChecks / totalChecks) * 100) || 0;
  function phasePct(ids) {
    const total = ids.length || 1;
    const d = ids.reduce((a, id) => a + (checkboxes[id] ? 1 : 0), 0);
    return Math.round((d / total) * 100) || 0;
  }

  //#region RENDER
  /* ---------- Render ---------- */
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
            <h1>
              {mainTab === "gmud"
                ? "Checklist GMUD"
                : "RDM – Requisição de Mudança"}
            </h1>

            {/* Barra de progresso só aparece na aba GMUD */}
            {mainTab === "gmud" && (
              <div className="progress-general">
                <div className="bar" style={{ width: `${geralPct}%` }} />
              </div>
            )}
          </div>

          <button
            className="primary"
            onClick={() => toggleSettings(true)}
            aria-expanded={settingsOpen}
          >
            ⚙ Configurações
          </button>
        </header>

        {/* ===== CONTEÚDO DA ABA RDM ===== */}
        {mainTab === "rdm" && (
          <section className="rdm-wrap">
            <div className="rdm-grid">
              <div className="rdm-card span-2">
                <label>Título</label>
                <input
                  value={rdm.titulo}
                  onChange={(e) => updRdm("titulo", e.target.value)}
                  placeholder="Título da requisição de mudança"
                />
              </div>

              <div className="rdm-card span-2">
                <label>O que vai fazer?</label>
                <textarea
                  value={rdm.oQue}
                  onChange={(e) => updRdm("oQue", e.target.value)}
                  placeholder="Descreva claramente a atividade / escopo da mudança"
                />
              </div>

              <div className="rdm-card">
                <label>Por quê?</label>
                <textarea
                  value={rdm.porQue}
                  onChange={(e) => updRdm("porQue", e.target.value)}
                  placeholder="Motivo da mudança"
                />
              </div>

              <div className="rdm-card">
                <label>Para que?</label>
                <textarea
                  value={rdm.paraQue}
                  onChange={(e) => updRdm("paraQue", e.target.value)}
                  placeholder="Objetivo/benefício esperado"
                />
              </div>

              <div className="rdm-card">
                <label>Impacto</label>
                <textarea
                  value={rdm.impacto}
                  onChange={(e) => updRdm("impacto", e.target.value)}
                  placeholder="Sistemas/serviços afetados, janelas, indisponibilidades"
                />
              </div>

              <div className="rdm-card">
                <label>Risco</label>
                <textarea
                  value={rdm.risco}
                  onChange={(e) => updRdm("risco", e.target.value)}
                  placeholder="Principais riscos e severidades"
                />
              </div>

              <div className="rdm-card span-2">
                <label>Plano de Rollback</label>
                <textarea
                  value={rdm.rollback}
                  onChange={(e) => updRdm("rollback", e.target.value)}
                  placeholder="Como reverter rapidamente em caso de falha"
                />
              </div>

              <div className="rdm-card">
                <label>Data</label>
                <input
                  type="date"
                  value={rdm.data}
                  onChange={(e) => updRdm("data", e.target.value)}
                />
              </div>
              <div className="rdm-card">
                <label>Início</label>
                <input
                  type="time"
                  value={rdm.inicio}
                  onChange={(e) => updRdm("inicio", e.target.value)}
                />
              </div>
              <div className="rdm-card">
                <label>Fim</label>
                <input
                  type="time"
                  value={rdm.fim}
                  onChange={(e) => updRdm("fim", e.target.value)}
                />
              </div>

              <div className="rdm-card">
                <label>Responsável</label>
                <input
                  value={rdm.responsavel}
                  onChange={(e) => updRdm("responsavel", e.target.value)}
                  placeholder="Quem executará"
                />
              </div>
              <div className="rdm-card">
                <label>Aprovador</label>
                <input
                  value={rdm.aprovador}
                  onChange={(e) => updRdm("aprovador", e.target.value)}
                  placeholder="Quem aprova"
                />
              </div>
              <div className="rdm-card">
                <label>Ambiente</label>
                <input
                  value={rdm.ambiente}
                  onChange={(e) => updRdm("ambiente", e.target.value)}
                  placeholder="Ex.: Homologação / Produção"
                />
              </div>

              <div className="rdm-card span-2">
                <label>Observações</label>
                <textarea
                  value={rdm.observacoes}
                  onChange={(e) => updRdm("observacoes", e.target.value)}
                  placeholder="Observações finais, dependências, contatos, etc."
                />
              </div>
            </div>

            <div className="rdm-actions">
              <button className="primary" onClick={salvarRdmLocal}>
                Salvar RDM (local)
              </button>
              <button className="primary pdf" onClick={() => window.print()}>
                Gerar PDF
              </button>
            </div>
          </section>
        )}

        {/* ===== TODO O CONTEÚDO DO CHECKLIST GMUD (condicional) ===== */}
        {mainTab === "gmud" && (
          <>
            {/* Infos projeto */}
            <div className="project-info">
              <div>
                <label>Checklist_GML</label>
                <input
                  value={nomeProjeto}
                  onChange={(e) => setNomeProjeto(e.target.value)}
                  placeholder="Ex: Sistema de Cobrança"
                />
              </div>
              <div>
                <label>Número da OS</label>
                <input
                  value={numeroGMUD}
                  onChange={(e) => setNumeroGMUD(e.target.value)}
                  placeholder="Ex: GMUD-2025-12345"
                />
              </div>
              <div>
                <label>Ticket do Jira</label>
                <input
                  value={ticketJira}
                  onChange={(e) => setTicketJira(e.target.value.toUpperCase())}
                  onBlur={() => ticketJira && listarAnexos()}
                  placeholder="Ex: ICON-1234"
                />
              </div>
              <div style={{ gridColumn: "span 3", textAlign: "right" }}>
                <button
                  className="primary"
                  onClick={sincronizarJira}
                  disabled={syncing}
                >
                  {syncing ? "Sincronizando..." : "Sincronizar com Jira"}
                </button>
              </div>
            </div>

            {/* Accordions: Descrição e Critérios */}
            <div className="accordion">
              <details className="acc-item" open={!!descricaoProjeto}>
                <summary className="acc-summary">
                  <span className="acc-left">
                    <i
                      className="fa-solid fa-circle-info acc-icon"
                      aria-hidden="true"
                    ></i>
                    <span>Descrição do Projeto</span>
                  </span>
                  <span className="acc-chevron">▾</span>
                </summary>
                <div className="acc-content">
                  {descricaoProjeto || "Sem descrição no ticket."}
                </div>
              </details>

              <details className="acc-item" open={!!criteriosAceite}>
                <summary className="acc-summary">
                  <span className="acc-left">
                    <i
                      className="fa-solid fa-clipboard-check acc-icon"
                      aria-hidden="true"
                    ></i>
                    <span>Critérios de Aceite</span>
                  </span>
                  <span className="acc-chevron">▾</span>
                </summary>
                <div className="acc-content">
                  {criteriosAceite || "Sem critérios cadastrados no ticket."}
                </div>
              </details>
            </div>

            {/* Fases */}
            <div className="checklist-grid">
              {PHASES.map((p) => {
                const pct = phasePct(p.ids);
                const complete = pct === 100;
                return (
                  <div
                    key={p.key}
                    className={`phase-card ${complete ? "complete" : ""}`}
                    title={`${pct}%`}
                  >
                    <div className="phase-header">
                      <i className={p.icon} />
                      <h2>{p.title}</h2>
                    </div>
                    <div className="progress-phase">
                      <div className="bar" style={{ width: `${pct}%` }} />
                    </div>
                    {p.ids.map((id) => (
                      <div
                        key={id}
                        className={`checklist-item ${
                          checkboxes[id] ? "checked" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={!!checkboxes[id]}
                          onChange={() => onToggleChecklist(id)}
                        />
                        <label>{LABELS[id]}</label>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Tabs internas do GMUD */}
            <div className="tabs">
              <button
                className={`tab-btn ${activeTab === "scripts" ? "active" : ""}`}
                onClick={() => setActiveTab("scripts")}
              >
                Scripts / Artefatos
              </button>
              <button
                className={`tab-btn ${activeTab === "vars" ? "active" : ""}`}
                onClick={() => setActiveTab("vars")}
              >
                Chaves (Variáveis)
              </button>
              <button
                className={`tab-btn ${
                  activeTab === "evidencias" ? "active" : ""
                }`}
                onClick={() => setActiveTab("evidencias")}
              >
                Evidências
              </button>
            </div>

            {/* Tab: Scripts */}
            <div
              className={`tab-content ${
                activeTab === "scripts" ? "active" : ""
              }`}
            >
              <textarea
                style={{
                  width: "100%",
                  height: 150,
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #ccc",
                }}
                value={scriptsAlterados}
                onChange={(e) => setScriptsAlterados(e.target.value)}
                placeholder="Ex: DEV\\TRANSFERENCIA_URA_OPER_DEV, DEV\\ivr_controle_1052_rest, etc."
              />
              <div style={{ textAlign: "right", marginTop: 10 }}>
                <button
                  className="primary"
                  onClick={salvarScripts}
                  disabled={savingScripts}
                >
                  {savingScripts ? "Salvando..." : "Salvar Scripts no Jira"}
                </button>
              </div>
            </div>

            {/* Tab: Variáveis */}
            <div
              className={`tab-content ${activeTab === "vars" ? "active" : ""}`}
            >
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "#555" }}>
                Use este campo apenas se o projeto utilizar variáveis de
                ambiente.
              </p>

              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button className="primary" onClick={addChave}>
                  Adicionar chave
                </button>
                <button
                  className="primary"
                  onClick={salvarVariaveis}
                  disabled={savingVars}
                >
                  {savingVars ? "Salvando..." : "Salvar Variáveis no Jira"}
                </button>
              </div>

              {varsBanner && (
                <div id="vars-dirty-banner">
                  Há alterações pendentes que ainda não foram enviadas ao Jira.
                </div>
              )}

              <div className="chaves-list">
                {chaves.map((row) => (
                  <div
                    key={row.id}
                    className={`chave-row ${row.pendente ? "pendente" : ""}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr 1fr 1.2fr auto", // <- sem a 2ª coluna de botões
                      gap: 8,
                      marginBottom: 8,
                      alignItems: "center",
                    }}
                  >
                    <input
                      className="chave-ambiente"
                      placeholder="Ambiente (ex: URA_PME, CONTROLE, POS)"
                      value={row.ambiente}
                      onChange={(e) =>
                        updChave(row.id, { ambiente: e.target.value })
                      }
                    />
                    <input
                      className="chave-nome"
                      placeholder="Nome da chave"
                      value={row.nome}
                      onChange={(e) =>
                        updChave(row.id, { nome: e.target.value })
                      }
                    />
                    <input
                      className="chave-valor"
                      placeholder="Valor"
                      value={row.valor}
                      onChange={(e) =>
                        updChave(row.id, { valor: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="remover-chave"
                      onClick={() => rmChave(row.id)}
                      title="Remover"
                    >
                      X
                    </button>

                    {/* Botão "Copiar" removido */}
                  </div>
                ))}
              </div>
            </div>

            {/* Tab: Evidências */}
            <div
              className={`tab-content ${
                activeTab === "evidencias" ? "active" : ""
              }`}
            >
              <input
                type="file"
                multiple
                ref={fileInputRef}
                onChange={(e) =>
                  setPreviewFiles(Array.from(e.target.files || []))
                }
              />

              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="primary"
                  onClick={limparPreview}
                  disabled={!previewFiles.length}
                >
                  Limpar pré-visualização
                </button>

                <button
                  type="button"
                  className="primary"
                  onClick={enviarArquivos}
                  disabled={uploading}
                >
                  {uploading ? "Enviando..." : "Enviar para o Jira"}
                </button>

                <button
                  type="button"
                  className="primary"
                  onClick={listarAnexos}
                >
                  Atualizar lista do Jira
                </button>
              </div>

              <h3 style={{ marginTop: 16 }}>Pré-visualização local</h3>
              <div
                className="imagens-anexadas"
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
                }}
              >
                {previewFiles.map((f) => {
                  const isImg = /^image\//i.test(f.type);
                  const url = URL.createObjectURL(f);
                  return (
                    <div
                      key={f.name + f.size}
                      className="imagem-item"
                      style={{
                        border: "1px solid #eee",
                        borderRadius: 8,
                        padding: 8,
                        position: "relative",
                      }}
                    >
                      <button
                        className="remover-img"
                        onClick={() =>
                          setPreviewFiles((prev) => prev.filter((x) => x !== f))
                        }
                        style={{ position: "absolute", right: 8, top: 8 }}
                      >
                        X
                      </button>
                      <div>
                        <strong>{f.name}</strong> {(f.size / 1024).toFixed(1)}{" "}
                        KB
                      </div>
                      {isImg ? (
                        <img
                          src={url}
                          onLoad={() => URL.revokeObjectURL(url)}
                          style={{
                            width: "100%",
                            height: 120,
                            objectFit: "cover",
                            marginTop: 6,
                            borderRadius: 6,
                          }}
                          alt=""
                        />
                      ) : (
                        <div style={{ marginTop: 6 }}>Prévia indisponível</div>
                      )}
                      <textarea
                        placeholder="Descrição (opcional, não vai pro Jira por padrão)"
                        style={{ width: "100%", height: 60, marginTop: 6 }}
                      />
                    </div>
                  );
                })}
              </div>

              <h3 style={{ marginTop: 16 }}>Anexos no Jira</h3>
              <div id="lista-anexos-jira">
                {!attachments.length ? (
                  <div>Nenhum anexo encontrado.</div>
                ) : (
                  <ul style={{ listStyle: "none", padding: 0 }}>
                    {attachments.map((a) => {
                      const links = buildDownloadLinks(a);
                      const isImg = a.mimeType?.startsWith("image/");
                      return (
                        <li
                          key={a.id}
                          style={{
                            borderBottom: "1px dashed #ddd",
                            padding: "8px 0",
                          }}
                        >
                          <div>
                            <strong>
                              <a
                                href={links.download}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {a.filename}
                              </a>
                            </strong>
                          </div>
                          <div style={{ fontSize: 12, color: "#555" }}>
                            {a.size ? (a.size / 1024).toFixed(1) + " KB" : ""}{" "}
                            {a.created
                              ? " • " + new Date(a.created).toLocaleString()
                              : ""}{" "}
                            {a.author ? " • " + a.author : ""}
                          </div>
                          <div style={{ marginTop: 6 }}>
                            <a
                              href={links.download}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              Baixar
                            </a>
                            {isImg && (
                              <>
                                {" "}
                                &nbsp;•&nbsp;
                                <a
                                  href={links.inline}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                >
                                  Abrir
                                </a>
                              </>
                            )}
                          </div>
                          {isImg && (
                            <div style={{ marginTop: 6 }}>
                              <img
                                src={links.inline}
                                style={{
                                  maxHeight: 100,
                                  maxWidth: 180,
                                  border: "1px solid #ccc",
                                  borderRadius: 4,
                                }}
                                alt=""
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* Rodapé */}
            <div className="botoes-finais">
              <button className="primary pdf" onClick={() => window.print()}>
                GERAR PDF (Imprimir)
              </button>
            </div>
          </>
        )}

        {/* PAINEL DE CONFIGURAÇÕES - sempre visível */}
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
