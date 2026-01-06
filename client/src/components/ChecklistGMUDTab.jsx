// src/components/ChecklistGMUDTab.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { adfFromTagAndText } from "../lib/adf";
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
} from "../lib/jira";
import {
  CHECKBOX_IDS,
  LABELS,
  PHASES,
  SCRIPTS_TAG,
  VARS_TAG,
  STORAGE_KEY,
  TAB_KEY,
  buildEmptyCheckboxes,
  normalizeVarsText,
  adfSafeToText,
  parseSummaryToFields,
  computePending,
  getChecklistItems,
  findTaggedComment,
  renderChavesFromText,
  buildVarsText,
  calcGeralPct,
  calcPhasePct,
} from "../utils/gmudUtils";

function ChecklistGMUDTab({
  onProgressChange,
  onRdmTitleChange,
  onRdmDueDateChange,
}) {
  // Projeto
  const [nomeProjeto, setNomeProjeto] = useState("");
  const [numeroGMUD, setNumeroGMUD] = useState("");
  const [ticketJira, setTicketJira] = useState("");

  // Checklist / comentários / anexos
  const [checkboxes, setCheckboxes] = useState(buildEmptyCheckboxes());
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
  const [activeTab, setActiveTab] = useState("scripts"); // scripts | vars | evidencias

  // Estados de carregamento
  const [syncing, setSyncing] = useState(false);
  const [savingScripts, setSavingScripts] = useState(false);
  const [savingVars, setSavingVars] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [dataLimite, setDataLimite] = useState("");
  const [dataLimiteLabel, setDataLimiteLabel] = useState("Data limite:");

  // 1) ADICIONE estes states junto dos "Estados de carregamento" (perto de syncing/saving...)
  const [syncOverlay, setSyncOverlay] = useState({
    open: false,
    title: "Sincronizando com Jira",
    message: "",
    current: 0,
    total: 0,
    created: [],
    done: false,
    error: "",
  });

  // helper opcional (facilita atualizar)
  function showSyncOverlay(patch) {
    setSyncOverlay((prev) => ({
      ...prev,
      open: true,
      done: false,
      error: "",
      ...patch,
    }));
  }
  function closeSyncOverlay() {
    setSyncOverlay((prev) => ({ ...prev, open: false }));
  }

  function fmtDueDate(yyyyMmDd) {
    if (!yyyyMmDd) return "";
    const [y, m, d] = String(yyyyMmDd).split("-");
    if (!y || !m || !d) return String(yyyyMmDd);
    return `${d}/${m}/${y}`;
  }

  /* ---------- Load localStorage (GMUD) ---------- */
  useEffect(() => {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      try {
        const d = JSON.parse(s);
        setNomeProjeto(d.projeto || "");
        setNumeroGMUD(d.gmud || "");
        setTicketJira(d.ticketJira || "");
        setScriptsAlterados(d.scriptsAlterados || "");
        setCheckboxes((prev) => ({ ...prev, ...(d.checkboxes || {}) }));
        setDataLimite(d.dataLimite || "");

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
  }, []);

  /* ---------- Persist localStorage (GMUD) ---------- */
  useEffect(() => {
    const data = {
      projeto: nomeProjeto,
      gmud: numeroGMUD,
      ticketJira,
      scriptsAlterados,
      dataLimite,
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
    dataLimite,
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
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    scriptsAlterados,
    chaves,
    ticketJira,
    varsComment,
    scriptsComment,
  ]);

  /* ---------- Progresso (para o App) ---------- */
  const geralPct = useMemo(() => calcGeralPct(checkboxes), [checkboxes]);

  useEffect(() => {
    if (typeof onProgressChange === "function") onProgressChange(geralPct);
  }, [geralPct, onProgressChange]);

  /* ---------- Jira: sincronização ---------- */

  async function sincronizarJira() {
    if (!ticketJira.trim()) {
      alert("Preencha o Ticket do Jira (ex: ICON-245).");
      return;
    }

    setSyncing(true);
    showSyncOverlay({
      title: "Sincronizando com Jira",
      message: "Buscando ticket e subtarefas no Jira...",
      current: 0,
      total: 0,
      created: [],
    });

    try {
      // reset UI
      setCheckboxes(buildEmptyCheckboxes());
      setScriptsAlterados("");
      setChaves([]);

      const issue = await getIssue(
        ticketJira,
        "summary,subtasks,status,project,description,customfield_10903,duedate,customfield_11519"
      );

      // envia o título para o App (preencher a aba RDM)
      onRdmTitleChange?.(issue?.fields?.summary || "");

      // ----------- Data limite com override -----------
      const fields = issue?.fields ?? {};
      const customDueRaw = fields.customfield_11519;

      const customDue =
        typeof customDueRaw === "string"
          ? customDueRaw.trim()
          : customDueRaw?.value
          ? String(customDueRaw.value).trim()
          : "";

      const hasCustomDue =
        typeof customDue === "string" && /^\d{4}-\d{2}-\d{2}/.test(customDue);

      const duePicked = (hasCustomDue ? customDue : fields.duedate) || "";

      setDataLimite(duePicked);
      setDataLimiteLabel(
        hasCustomDue ? "Data limite Aleterada:" : "Data limite:"
      );

      onRdmDueDateChange?.(duePicked);
      // -----------------------------------------------

      const projectId = issue.fields.project.id;
      const subtasks = issue.fields.subtasks || [];
      const subtasksBySummary = {};

      const descText = adfSafeToText(issue?.fields?.description);
      const criteriosText = adfSafeToText(issue?.fields?.customfield_10903);
      setDescricaoProjeto(descText);
      setCriteriosAceite(criteriosText);

      subtasks.forEach((st) => {
        const summary = (st.fields?.summary || "").trim();
        if (summary) {
          subtasksBySummary[summary.toLowerCase()] = {
            key: st.key,
            id: st.id,
            status: st.fields?.status?.name || "",
          };
        }
      });

      setJiraCtx({ ticketKey: issue.key, projectId, subtasksBySummary });

      const parsed = parseSummaryToFields(issue.fields?.summary || "");
      if (parsed) {
        setNumeroGMUD(parsed.os);
        setNomeProjeto(parsed.checklist);
      }

      // ----------- Criar subtarefas faltantes com overlay/progresso -----------
      const items = getChecklistItems();
      const missing = items.filter((it) => {
        const k = it.summary.trim().toLowerCase();
        return !subtasksBySummary[k];
      });

      const createdSummaries = [];

      if (missing.length) {
        showSyncOverlay({
          title: "Criando subtarefas",
          message: `Criando subtarefas (${0}/${missing.length})...`,
          current: 0,
          total: missing.length,
          created: [],
        });

        for (let i = 0; i < missing.length; i++) {
          const it = missing[i];

          showSyncOverlay({
            message: `Criando subtarefas (${i + 1}/${missing.length})...`,
            current: i,
            total: missing.length,
          });

          const created = await createSubtask(
            projectId,
            ticketJira,
            it.summary
          );

          const key = it.summary.trim().toLowerCase();
          subtasksBySummary[key] = {
            key: created.key,
            id: created.id,
            status: "",
          };
          createdSummaries.push(it.summary);

          // força a UI a “respirar” entre criações (evita parecer travado)
          // (principalmente quando a API demora e React não repinta)
          await new Promise((r) => setTimeout(r, 0));

          showSyncOverlay({
            current: i + 1,
            created: [...createdSummaries],
          });
        }

        showSyncOverlay({
          title: "Subtarefas criadas",
          message: `Foram criadas ${createdSummaries.length} subtarefas. Finalizando sincronização...`,
          current: missing.length,
          total: missing.length,
          created: [...createdSummaries],
        });
      } else {
        showSyncOverlay({
          title: "Sincronizando com Jira",
          message:
            "Nenhuma subtarefa precisava ser criada. Atualizando checklist...",
          current: 0,
          total: 0,
        });
      }
      // ----------------------------------------------------------------------

      // Atualiza checkboxes com status vindo do Jira
      const newChecks = {};
      items.forEach((it) => {
        const s =
          subtasksBySummary[
            it.summary.trim().toLowerCase()
          ]?.status?.toLowerCase() || "";
        newChecks[it.id] = ["concluído", "concluido", "done"].includes(s);
      });
      setCheckboxes((prev) => ({ ...prev, ...newChecks }));

      // ----------- Comentários e anexos (também dentro do fluxo, com mensagem) -----------
      showSyncOverlay({
        title: "Carregando dados",
        message: "Carregando comentários e anexos do Jira...",
      });

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

            const rows = renderChavesFromText(f.textSemTag);
            setChaves(rows);
            recomputeVarsPendingNow(rows);
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
      // ----------------------------------------------------------------------

      const msg =
        createdSummaries.length > 0
          ? `Sincronização concluída para ${ticketJira}. Subtarefas criadas: ${createdSummaries.length}.`
          : `Sincronização concluída para ${ticketJira}.`;

      showSyncOverlay({
        title: "Concluído",
        message: msg,
        done: true,
        created: [...createdSummaries],
      });

      alert(msg);
    } catch (e) {
      console.error(e);

      showSyncOverlay({
        title: "Erro",
        message: "Erro ao sincronizar com o Jira.",
        error: e?.message ? String(e.message) : String(e),
        done: true,
      });

      alert("Erro ao sincronizar com o Jira: " + (e?.message || e));
    } finally {
      setSyncing(false);
    }
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

  function recomputeVarsPendingNow(rowsOverride) {
    const base = rowsOverride || chaves;
    const { next, any } = computePending(base, varsBaselineRef.current);
    setVarsBanner(any);
    if (rowsOverride) setChaves(next);
  }

  async function salvarVariaveis() {
    if (!ticketJira.trim()) {
      alert("Informe o ticket.");
      return;
    }

    const text = buildVarsText(chaves);
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

  function limparPreview() {
    setPreviewFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function listarAnexos() {
    const data = await listAttachments(ticketJira);
    setAttachments(data.attachments || []);
  }

  return (
    <>
      {syncOverlay.open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(560px, 100%)",
              background: "#fff",
              borderRadius: 16,
              padding: 16,
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
              border: "1px solid #eee",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="sync-spinner" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>
                  {syncOverlay.title}
                </div>
                <div style={{ marginTop: 4, color: "#555", fontSize: 13 }}>
                  {syncOverlay.message || "Processando..."}
                </div>
              </div>
            </div>

            {syncOverlay.total > 0 && (
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    color: "#666",
                  }}
                >
                  <span>Progresso</span>
                  <span>
                    {syncOverlay.current}/{syncOverlay.total}
                  </span>
                </div>

                <div
                  style={{
                    height: 10,
                    background: "#eee",
                    borderRadius: 999,
                    overflow: "hidden",
                    marginTop: 6,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round(
                        (syncOverlay.current / syncOverlay.total) * 100
                      )}%`,
                      background: "#1677ff",
                    }}
                  />
                </div>
              </div>
            )}

            {syncOverlay.done && syncOverlay.created?.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 10,
                  maxHeight: 160,
                  overflow: "auto",
                  background: "#fafafa",
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 6 }}>
                  Subtarefas criadas:
                </div>
                <ul
                  style={{ margin: "0 0 0 18px", fontSize: 12, color: "#333" }}
                >
                  {syncOverlay.created.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {syncOverlay.error && (
              <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>
                {syncOverlay.error}
              </div>
            )}

            {syncOverlay.done && (
              <div
                style={{
                  marginTop: 14,
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  className="primary"
                  onClick={closeSyncOverlay}
                >
                  Ok
                </button>
              </div>
            )}

            <style jsx>{`
              .sync-spinner {
                width: 18px;
                height: 18px;
                border-radius: 999px;
                border: 3px solid #ddd;
                border-top-color: #1677ff;
                animation: spin 0.85s linear infinite;
                flex: 0 0 auto;
              }
              @keyframes spin {
                to {
                  transform: rotate(360deg);
                }
              }
            `}</style>
          </div>
        </div>
      )}

      {/* Data limite (topo, destaque vermelho moderno) */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, #ff4d4f22, #ff1b1f33)",
            border: "1px solid #ff4d4f",
            color: "#c41c1c",
            padding: "10px 16px",
            borderRadius: 16,
            fontWeight: 700,
            fontSize: "0.95rem",
            letterSpacing: 0.3,
            boxShadow: "0 4px 12px rgba(255, 77, 79, 0.25)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            backdropFilter: "blur(4px)",
            animation: "pulse 2s infinite alternate",
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            style={{ flexShrink: 0 }}
          >
            <path d="M12 8v4l3 3" />
            <circle cx="12" cy="12" r="10" />
          </svg>
          <span>
            {dataLimiteLabel} {dataLimite ? fmtDueDate(dataLimite) : "—"}
          </span>
        </div>
      </div>

      {/* Animação opcional */}
      <style jsx>{`
        @keyframes pulse {
          from {
            box-shadow: 0 4px 12px rgba(255, 77, 79, 0.25);
          }
          to {
            box-shadow: 0 6px 20px rgba(255, 77, 79, 0.4);
          }
        }
      `}</style>

      {/* Infos projeto */}
      <div className="project-info">
        <div>
          <label>Projeto</label>
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
          const pct = calcPhasePct(p.ids, checkboxes);
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
          className={`tab-btn ${activeTab === "evidencias" ? "active" : ""}`}
          onClick={() => setActiveTab("evidencias")}
        >
          Evidências
        </button>
      </div>

      {/* Tab: Scripts */}
      <div className={`tab-content ${activeTab === "scripts" ? "active" : ""}`}>
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
          placeholder="Ex: DEV\TRANSFERENCIA_URA_OPER_DEV, DEV\ivr_controle_1052_rest, etc."
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
      <div className={`tab-content ${activeTab === "vars" ? "active" : ""}`}>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "#555" }}>
          Use este campo apenas se o projeto utilizar variáveis de ambiente.
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
                gridTemplateColumns: "1.2fr 1fr 1.2fr auto",
                gap: 8,
                marginBottom: 8,
                alignItems: "center",
              }}
            >
              <input
                className="chave-ambiente"
                placeholder="Ambiente (ex: URA_PME, CONTROLE, POS)"
                value={row.ambiente}
                onChange={(e) => updChave(row.id, { ambiente: e.target.value })}
              />
              <input
                className="chave-nome"
                placeholder="Nome da chave"
                value={row.nome}
                onChange={(e) => updChave(row.id, { nome: e.target.value })}
              />
              <input
                className="chave-valor"
                placeholder="Valor"
                value={row.valor}
                onChange={(e) => updChave(row.id, { valor: e.target.value })}
              />
              <button
                type="button"
                className="remover-chave"
                onClick={() => rmChave(row.id)}
                title="Remover"
              >
                X
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Tab: Evidências */}
      <div
        className={`tab-content ${activeTab === "evidencias" ? "active" : ""}`}
      >
        <input
          type="file"
          multiple
          ref={fileInputRef}
          onChange={(e) => setPreviewFiles(Array.from(e.target.files || []))}
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

          <button type="button" className="primary" onClick={listarAnexos}>
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
                  <strong>{f.name}</strong> {(f.size / 1024).toFixed(1)} KB
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
  );
}

export default ChecklistGMUDTab;
