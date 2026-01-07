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
  transitionToBacklog,
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
  PHASE_INDEX_BY_ID,
  computeUnlockedPhaseIdx,
  getChecklistItemsForPhase,
  isDoneSubtask,
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

  const [unlockedPhaseIdx, setUnlockedPhaseIdx] = useState(PHASES.length);

  const [stepGate, setStepGate] = useState({
    open: false,
    fromIdx: null,
    toIdx: null,
  });

  const [advancingStep, setAdvancingStep] = useState(false);

  const jiraCtxRef = useRef(null);
  useEffect(() => {
    jiraCtxRef.current = jiraCtx;
  }, [jiraCtx]);

  const unlockedIdxRef = useRef(PHASES.length);
  useEffect(() => {
    unlockedIdxRef.current = unlockedPhaseIdx;
  }, [unlockedPhaseIdx]);

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

  // ====== Avanço manual de step (UI) ======
  async function ensurePhaseSubtasks(phaseIdx, ctx) {
    const phase = PHASES[phaseIdx];
    if (!phase) return { nextMap: ctx.subtasksBySummary, createdSummaries: [] };

    const phaseItems = getChecklistItemsForPhase(phaseIdx);
    const missing = phaseItems.filter((it) => {
      const k = it.summary.trim().toLowerCase();
      return !ctx.subtasksBySummary?.[k];
    });

    if (!missing.length) {
      return { nextMap: ctx.subtasksBySummary, createdSummaries: [] };
    }

    showSyncOverlay({
      title: `Criando subtarefas - ${phase.title}`,
      message: `Criando subtarefas (${0}/${missing.length})...`,
      current: 0,
      total: missing.length,
      created: [],
    });

    const nextMap = { ...(ctx.subtasksBySummary || {}) };
    const createdSummaries = [];

    for (let i = 0; i < missing.length; i++) {
      const it = missing[i];

      showSyncOverlay({
        message: `Criando subtarefas (${i + 1}/${missing.length})...`,
        current: i,
        total: missing.length,
      });

      const created = await createSubtask(
        ctx.projectId,
        ctx.ticketKey,
        it.summary
      );

      const key = it.summary.trim().toLowerCase();
      nextMap[key] = {
        key: created.key,
        id: created.id,
        status: "",
        statusCategory: "",
      };

      createdSummaries.push(it.summary);

      await new Promise((r) => setTimeout(r, 0));

      showSyncOverlay({
        current: i + 1,
        created: [...createdSummaries],
      });
    }

    return { nextMap, createdSummaries };
  }

  function openStepGate(fromIdx, toIdx) {
    setStepGate({ open: true, fromIdx, toIdx });
  }

  function closeStepGate() {
    setStepGate((prev) => ({ ...prev, open: false }));
    setAdvancingStep(false);
  }

  async function avancarParaProximoStep() {
    const toIdx = stepGate.toIdx;

    if (toIdx == null) return closeStepGate();

    // Se acabou todas as fases
    if (toIdx >= PHASES.length) return closeStepGate();

    if (!jiraCtx) {
      alert("Sincronize com o Jira antes.");
      return;
    }

    setAdvancingStep(true);

    try {
      const ensured = await ensurePhaseSubtasks(toIdx, {
        projectId: jiraCtx.projectId,
        ticketKey: jiraCtx.ticketKey,
        subtasksBySummary: jiraCtx.subtasksBySummary,
      });

      // Atualiza mapa e libera fase
      setJiraCtx((ctx) => ({
        ...ctx,
        subtasksBySummary: ensured.nextMap,
      }));

      setUnlockedPhaseIdx(toIdx);

      // Fecha o modal do gate
      closeStepGate();

      // Mostra modal final (aproveita seu syncOverlay com botão OK)
      showSyncOverlay({
        title: "Próximo step liberado",
        message:
          ensured.createdSummaries.length > 0
            ? `Fase "${PHASES[toIdx].title}" liberada. Subtarefas criadas: ${ensured.createdSummaries.length}.`
            : `Fase "${PHASES[toIdx].title}" liberada. Nenhuma subtarefa nova precisou ser criada.`,
        done: true,
        created: ensured.createdSummaries,
        current: ensured.createdSummaries.length,
        total: ensured.createdSummaries.length,
      });
    } catch (e) {
      console.error(e);

      showSyncOverlay({
        title: "Erro",
        message: "Erro ao liberar o próximo step.",
        error: e?.message ? String(e.message) : String(e),
        done: true,
      });
    } finally {
      setAdvancingStep(false);
    }
  }

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
      let subtasksBySummary = {};

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
            statusCategory: st.fields?.status?.statusCategory?.key || "",
          };
        }
      });

      setJiraCtx({ ticketKey: issue.key, projectId, subtasksBySummary });

      const parsed = parseSummaryToFields(issue.fields?.summary || "");
      if (parsed) {
        setNumeroGMUD(parsed.os);
        setNomeProjeto(parsed.checklist);
      }

      // ----------- Criar subtarefas faltantes APENAS da fase atual (step) -----------
      const items = getChecklistItems();

      // Descobre qual fase está liberada (primeira não-concluída)
      const initialUnlockedIdx = computeUnlockedPhaseIdx(subtasksBySummary);
      setUnlockedPhaseIdx(initialUnlockedIdx);

      let createdSummaries = [];

      if (initialUnlockedIdx < PHASES.length) {
        const ensureCtx = {
          ticketKey: issue.key,
          projectId,
          subtasksBySummary,
        };
        const ensured = await ensurePhaseSubtasks(
          initialUnlockedIdx,
          ensureCtx
        );

        subtasksBySummary = ensured.nextMap;
        createdSummaries = ensured.createdSummaries;

        // Atualiza ctx do Jira com o mapa pós-criação
        setJiraCtx({ ticketKey: issue.key, projectId, subtasksBySummary });
      } else {
        // Tudo concluído
        setJiraCtx({ ticketKey: issue.key, projectId, subtasksBySummary });
      }
      // ----------------------------------------------------------------------

      // Atualiza checkboxes com status vindo do Jira
      const newChecks = {};
      items.forEach((it) => {
        const st = subtasksBySummary[it.summary.trim().toLowerCase()];
        newChecks[it.id] = !!st && isDoneSubtask(st);
      });
      setCheckboxes((prev) => ({ ...prev, ...newChecks }));

      // Recalcula fase liberada
      setUnlockedPhaseIdx(computeUnlockedPhaseIdx(subtasksBySummary));

      // ----------- Comentários e anexos -----------
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

      //alert(msg);  Sem alerta, apenas o modal.
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
    // trava por item (evita clique rápido disparar duas requisições concorrentes)
    if (!onToggleChecklist._inFlight) onToggleChecklist._inFlight = new Set();
    const inFlight = onToggleChecklist._inFlight;
    if (inFlight.has(id)) return;
    inFlight.add(id);

    try {
      const currentJiraCtx = jiraCtxRef.current;

      if (currentJiraCtx) {
        const phaseIdx = PHASE_INDEX_BY_ID[id];
        const unlockedNow = unlockedIdxRef.current;

        if (typeof phaseIdx === "number" && phaseIdx > unlockedNow) {
          const current = PHASES[unlockedNow]?.title || "Fase atual";
          const target = PHASES[phaseIdx]?.title || "Fase";
          alert(`"${target}" ainda não está liberada. Conclua: "${current}".`);
          return;
        }
      }

      const isChecked = !!checkboxes[id]; // mantém como está no seu código
      const summary = (LABELS[id] || id).trim();
      const mapKey = summary.toLowerCase();

      // ---------- DESMARCAR: volta no Jira ----------
      if (isChecked) {
        // UI primeiro
        setCheckboxes((prev) => ({ ...prev, [id]: false }));

        if (!currentJiraCtx) return;

        const existing = currentJiraCtx.subtasksBySummary?.[mapKey];
        if (!existing?.key) return;

        try {
          const backPayload = await transitionToBacklog(existing.key);

          // calcula antes (evita ReferenceError por variável fora do escopo)
          const newStatus = backPayload?.status || "Backlog";
          const newCategory = backPayload?.statusCategory || "new";

          setJiraCtx((ctx) => {
            if (!ctx) return ctx;

            const base = ctx.subtasksBySummary || {};
            const prev = base[mapKey] || {};

            return {
              ...ctx,
              subtasksBySummary: {
                ...base,
                [mapKey]: {
                  ...prev,
                  ...(existing || {}),
                  status: newStatus,
                  statusCategory: newCategory,
                },
              },
            };
          });

          const phaseIdx = PHASE_INDEX_BY_ID[id];
          if (typeof phaseIdx === "number") {
            setUnlockedPhaseIdx((prev) => Math.min(prev, phaseIdx));
          }

          if (stepGate?.open) closeStepGate();
        } catch (e) {
          console.error(e);
          alert("Erro ao retornar subtarefa: " + (e?.message || e));
          setCheckboxes((prev) => ({ ...prev, [id]: true }));
        }

        return;
      }

      // ---------- MARCAR: conclui no Jira ----------
      if (!currentJiraCtx) {
        alert("Sincronize com o Jira antes.");
        return;
      }

      // UI primeiro
      setCheckboxes((prev) => ({ ...prev, [id]: true }));

      let sub = currentJiraCtx.subtasksBySummary?.[mapKey];

      try {
        // garante subtask
        if (!sub) {
          const created = await createSubtask(
            currentJiraCtx.projectId,
            currentJiraCtx.ticketKey,
            summary
          );

          sub = {
            key: created.key,
            id: created.id,
            status: "",
            statusCategory: "",
          };

          setJiraCtx((ctx) => {
            if (!ctx) return ctx;
            const base = ctx.subtasksBySummary || {};
            return {
              ...ctx,
              subtasksBySummary: {
                ...base,
                [mapKey]: sub,
              },
            };
          });
        }

        await transitionToDone(sub.key);
      } catch (e) {
        console.error(e);
        alert("Erro ao concluir subtarefa no Jira: " + (e?.message || e));
        setCheckboxes((prev) => ({ ...prev, [id]: false }));
      }
    } finally {
      inFlight.delete(id);
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
      {stepGate.open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
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
            <div style={{ fontWeight: 800, fontSize: 16 }}>
              {stepGate.toIdx >= PHASES.length
                ? "Checklist concluído"
                : "Step concluído"}
            </div>

            <div style={{ marginTop: 6, color: "#555", fontSize: 13 }}>
              {stepGate.toIdx >= PHASES.length ? (
                <>
                  Você concluiu a última fase:{" "}
                  <strong>{PHASES[stepGate.fromIdx]?.title}</strong>.
                </>
              ) : (
                <>
                  Você concluiu a fase:{" "}
                  <strong>{PHASES[stepGate.fromIdx]?.title}</strong>.
                  <br />
                  Clique para liberar o próximo step:{" "}
                  <strong>{PHASES[stepGate.toIdx]?.title}</strong>.
                </>
              )}
            </div>

            {stepGate.toIdx < PHASES.length && (
              <div
                style={{
                  marginTop: 12,
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 10,
                  background: "#fafafa",
                  maxHeight: 180,
                  overflow: "auto",
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 6 }}>
                  Itens do próximo step:
                </div>
                <ul
                  style={{ margin: "0 0 0 18px", fontSize: 12, color: "#333" }}
                >
                  {PHASES[stepGate.toIdx].ids.map((cid) => (
                    <li key={cid}>{LABELS[cid]}</li>
                  ))}
                </ul>
              </div>
            )}

            <div
              style={{
                marginTop: 14,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={closeStepGate}
                disabled={advancingStep}
              >
                Agora não
              </button>

              <button
                type="button"
                className="primary"
                onClick={avancarParaProximoStep}
                disabled={advancingStep}
              >
                {advancingStep
                  ? "Liberando..."
                  : stepGate.toIdx >= PHASES.length
                  ? "Ok"
                  : `Ir para ${PHASES[stepGate.toIdx].title}`}
              </button>
            </div>
          </div>
        </div>
      )}

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

            <style>{`
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
    to { transform: rotate(360deg); }
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
      <style>{`
  @keyframes pulse {
    from { box-shadow: 0 4px 12px rgba(255, 77, 79, 0.25); }
    to   { box-shadow: 0 6px 20px rgba(255, 77, 79, 0.4); }
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
      {/* Fases */}
      <div className="checklist-grid">
        {PHASES.map((p, idx) => {
          const pct = calcPhasePct(p.ids, checkboxes);
          const complete = pct === 100;
          const isCandidate = idx === unlockedPhaseIdx;
          const nextIdx = idx + 1;
          const hasNext = nextIdx < PHASES.length;

          return (
            <div
              key={p.key}
              className={`phase-card ${complete ? "complete" : ""} ${
                isCandidate ? "active" : ""
              }`}
              title={`${pct}% concluído`}
            >
              <div className="phase-header">
                <div className="phase-title">
                  <i className={p.icon} />
                  <h2>{p.title}</h2>
                </div>
                <div className="phase-actions">
                  {hasNext && isCandidate && complete && (
                    <button
                      type="button"
                      className="primary"
                      disabled={!jiraCtx || advancingStep || !complete}
                      title={
                        !jiraCtx
                          ? "Sincronize com o Jira antes."
                          : !complete
                          ? "Conclua este step para liberar o próximo."
                          : ""
                      }
                      onClick={() => openStepGate(idx, nextIdx)}
                    >
                      Liberar: {PHASES[nextIdx].title}
                    </button>
                  )}
                  {!hasNext && isCandidate && complete && (
                    <button
                      type="button"
                      className="primary"
                      disabled={!jiraCtx || advancingStep || !complete}
                      title={
                        !jiraCtx
                          ? "Sincronize com o Jira antes."
                          : !complete
                          ? "Conclua este step para finalizar."
                          : ""
                      }
                      onClick={() => openStepGate(idx, PHASES.length)}
                    >
                      Finalizar checklist
                    </button>
                  )}
                </div>
              </div>

              <div className="progress-phase">
                <div className="bar" style={{ width: `${pct}%` }} />
                <span className="progress-label">{pct}%</span>
              </div>

              <ul className="checklist-items">
                {p.ids.map((id) => {
                  const locked =
                    !!jiraCtx && PHASE_INDEX_BY_ID[id] > unlockedPhaseIdx;

                  return (
                    <li
                      key={id}
                      className={`checklist-item ${
                        checkboxes[id] ? "checked" : ""
                      } ${locked ? "locked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        id={`check-${id}`}
                        checked={!!checkboxes[id]}
                        disabled={locked}
                        onChange={() => onToggleChecklist(id)}
                      />
                      <label htmlFor={`check-${id}`}>{LABELS[id]}</label>
                    </li>
                  );
                })}
              </ul>
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
          Scripts
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
