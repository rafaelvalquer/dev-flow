// src/components/ChecklistGMUDTab.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { adfFromTagAndText } from "../lib/adf";
import { motion } from "framer-motion";
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
  SCRIPTS_TAG,
  VARS_TAG,
  STORAGE_KEY,
  TAB_KEY,
  normalizeVarsText,
  adfSafeToText,
  parseSummaryToFields,
  computePending,
  renderChavesFromText,
  buildVarsText,
  findTaggedComment,
} from "../utils/gmudUtils";

import KanbanBuilderModal from "./KanbanBuilderModal";
import {
  DEFAULT_KANBAN_LIBRARY,
  DEFAULT_KANBAN_WORKFLOW,
  buildTicketKanbanConfig,
  getWorkflowIndex,
} from "../utils/kanbanJiraConfig";
import {
  normalizeKey,
  extractKanbanConfigFromCommentsPayload,
  upsertKanbanConfigComment,
  ensureSubtasksForStep,
  applyJiraStatusesToConfig,
  computeOverallPct,
  computeStepPct,
  isDoneStatus,
  buildKanbanSummary,
} from "../utils/kanbanSync";

const JIRA_CACHE_PREFIX = "GMUD_JIRA_CACHE_V1:";
function jiraCacheKey(ticket) {
  return `${JIRA_CACHE_PREFIX}${String(ticket || "")
    .trim()
    .toUpperCase()}`;
}

function ChecklistGMUDTab({
  onProgressChange,
  onRdmTitleChange,
  onRdmDueDateChange,
}) {
  // Projeto
  const [nomeProjeto, setNomeProjeto] = useState("");
  const [numeroGMUD, setNumeroGMUD] = useState("");
  const [ticketJira, setTicketJira] = useState("");

  // Scripts / anexos
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

  // Sidebar
  const [ticketSideInfo, setTicketSideInfo] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);

  // topo do componente
  const fileInputRef = useRef(null);

  // UI
  const [activeTab, setActiveTab] = useState("scripts"); // scripts | vars | evidencias

  // Loading
  const [syncing, setSyncing] = useState(false);
  const [savingScripts, setSavingScripts] = useState(false);
  const [savingVars, setSavingVars] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [dataLimite, setDataLimite] = useState("");
  const [dataLimiteLabel, setDataLimiteLabel] = useState("Data limite:");

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

  // ===== Kanban =====
  const [kanbanCfg, setKanbanCfg] = useState(null);
  const [kanbanComment, setKanbanComment] = useState({
    id: null,
    originalText: "",
  });
  const [builderOpen, setBuilderOpen] = useState(false);
  const [unlockedStepIdx, setUnlockedStepIdx] = useState(0);

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

  useEffect(() => {
    if (!sideOpen) return;

    const onKey = (e) => {
      if (e.key === "Escape") setSideOpen(false);
    };

    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [sideOpen]);

  const canToggleSide = !!ticketJira?.trim() || sideOpen;
  function toggleSide() {
    if (!ticketJira?.trim() && !sideOpen) return;
    setSideOpen((v) => !v);
  }

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

  function fmtDateBr(yyyyMmDd) {
    if (!yyyyMmDd) return "";
    const ymd = String(yyyyMmDd).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return String(yyyyMmDd);
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y}`;
  }

  function toNamesArray(v) {
    if (!v) return [];
    if (Array.isArray(v)) {
      return v
        .map((x) =>
          typeof x === "string" ? x : x?.value || x?.name || x?.label || ""
        )
        .map((s) => String(s).trim())
        .filter(Boolean);
    }
    if (typeof v === "string") return [v.trim()].filter(Boolean);
    if (typeof v === "object") {
      const one = v?.value || v?.name || v?.label || "";
      return [String(one).trim()].filter(Boolean);
    }
    return [String(v)].filter(Boolean);
  }

  function getWorkflow() {
    return kanbanCfg?.workflow || DEFAULT_KANBAN_WORKFLOW;
  }
  function getStepTitle(idx) {
    const wf = getWorkflow();
    return wf[idx]?.title || "";
  }
  function getStepIdxByKey(stepKey) {
    return getWorkflowIndex(getWorkflow(), stepKey);
  }

  function listNextStepPreview(toIdx) {
    const wf = getWorkflow();
    const stepKey = wf[toIdx]?.key;
    const col = kanbanCfg?.columns?.[stepKey];
    if (!col) return [];
    const out = [];
    for (const card of col.cards || []) {
      for (const st of card.subtasks || []) {
        out.push(`${card.title} — ${st.title}`);
      }
    }
    return out;
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
        setDataLimite(d.dataLimite || "");

        setChaves(
          (d.chaves || []).map((row) => ({
            ...row,
            id: crypto.randomUUID(),
            pendente: false,
          }))
        );

        // restaura cache do Jira
        const tk = String(d.ticketJira || "")
          .trim()
          .toUpperCase();
        if (tk) {
          const cacheRaw = localStorage.getItem(jiraCacheKey(tk));
          if (cacheRaw) {
            const cache = JSON.parse(cacheRaw);

            if (cache?.jiraCtx) setJiraCtx(cache.jiraCtx);
            if (cache?.ticketSideInfo) setTicketSideInfo(cache.ticketSideInfo);

            if (cache?.kanbanCfg) setKanbanCfg(cache.kanbanCfg);
            if (cache?.kanbanComment) setKanbanComment(cache.kanbanComment);
            if (typeof cache?.unlockedStepIdx === "number")
              setUnlockedStepIdx(cache.unlockedStepIdx);

            setDescricaoProjeto(cache?.descricaoProjeto || "");
            setCriteriosAceite(cache?.criteriosAceite || "");

            if (cache?.scriptsComment) setScriptsComment(cache.scriptsComment);
            if (cache?.varsComment) {
              setVarsComment(cache.varsComment);
              varsBaselineRef.current = new Set(
                (cache.varsComment.originalText || "")
                  .split("\n")
                  .filter(Boolean)
              );
            }
          }
        }
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
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [
    nomeProjeto,
    numeroGMUD,
    ticketJira,
    dataLimite,
    scriptsAlterados,
    chaves,
  ]);

  useEffect(() => {
    const tk = String(ticketJira || "")
      .trim()
      .toUpperCase();
    if (!tk) return;

    if (!jiraCtx?.ticketKey || !jiraCtx?.projectId) return;

    const cache = {
      ticketJira: tk,
      syncedAt: Date.now(),
      jiraCtx,

      ticketSideInfo,
      descricaoProjeto,
      criteriosAceite,

      scriptsComment,
      varsComment,

      kanbanCfg,
      kanbanComment,
      unlockedStepIdx,
    };

    localStorage.setItem(jiraCacheKey(tk), JSON.stringify(cache));
  }, [
    ticketJira,
    jiraCtx,
    ticketSideInfo,
    descricaoProjeto,
    criteriosAceite,
    scriptsComment,
    varsComment,
    kanbanCfg,
    kanbanComment,
    unlockedStepIdx,
  ]);

  useEffect(() => {
    localStorage.setItem(TAB_KEY, activeTab);
  }, [activeTab]);

  /* ---------- Progresso (para o App) ---------- */
  const geralPct = useMemo(() => {
    return computeOverallPct(kanbanCfg, jiraCtx?.subtasksBySummary || {});
  }, [kanbanCfg, jiraCtx]);

  useEffect(() => {
    if (typeof onProgressChange === "function") onProgressChange(geralPct);
  }, [geralPct, onProgressChange]);

  // ao mudar ticket no input, se tiver outro cache, zera estados do ticket anterior
  useEffect(() => {
    const tk = String(ticketJira || "")
      .trim()
      .toUpperCase();
    if (!tk) return;

    const syncedKey = String(jiraCtx?.ticketKey || "")
      .trim()
      .toUpperCase();
    if (syncedKey && syncedKey !== tk) {
      setJiraCtx(null);
      setTicketSideInfo(null);
      setDescricaoProjeto("");
      setCriteriosAceite("");
      setScriptsComment({ id: null, originalText: "" });
      setVarsComment({ id: null, originalText: "" });
      varsBaselineRef.current = new Set();

      setKanbanCfg(null);
      setKanbanComment({ id: null, originalText: "" });
      setUnlockedStepIdx(0);
    }
  }, [ticketJira]); // intencional

  /* ---------- Variáveis helpers ---------- */
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

  /* ---------- Evidências ---------- */
  async function listarAnexos() {
    const data = await listAttachments(ticketJira);
    setAttachments(data.attachments || []);
  }

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

  function statusTone(status) {
    const s = String(status || "").toLowerCase();
    if (/(concluído)/.test(s)) return "success";
    if (/(backlog)/.test(s)) return "info";
    if (/(para deploy)/.test(s)) return "danger";
    if (/(desenvolvimento)/.test(s)) return "warning";
    return "neutral";
  }

  /* ---------- Step Gate ---------- */
  function openStepGate(fromIdx, toIdx) {
    setStepGate({ open: true, fromIdx, toIdx });
  }

  function closeStepGate() {
    setStepGate((prev) => ({ ...prev, open: false }));
    setAdvancingStep(false);
  }

  async function unlockNextStep() {
    const toIdx = stepGate.toIdx;
    if (toIdx == null) return closeStepGate();

    if (!jiraCtx?.ticketKey || !jiraCtx?.projectId) {
      alert("Sincronize com o Jira antes.");
      return;
    }

    if (!kanbanCfg) {
      alert("Crie a estrutura do Kanban primeiro.");
      return;
    }

    setAdvancingStep(true);

    try {
      // libera step no config (persistido no comentário)
      const cfg2 = structuredClone
        ? structuredClone(kanbanCfg)
        : JSON.parse(JSON.stringify(kanbanCfg));
      cfg2.unlockedStepIdx = toIdx;

      // cria subtarefas SOMENTE do step liberado (manual)
      const ensured = await ensureSubtasksForStep({
        cfg: cfg2,
        stepIdx: toIdx,
        ticketKey: jiraCtx.ticketKey,
        projectId: jiraCtx.projectId,
        subtasksBySummary: jiraCtx.subtasksBySummary,
        createSubtask,
        onProgress: (p) => showSyncOverlay({ ...p }),
      });

      // persiste comment com unlockedStepIdx + mappings (jiraKey/jiraId)
      const saved = await upsertKanbanConfigComment({
        ticketKey: jiraCtx.ticketKey,
        config: ensured.nextCfg,
        existingCommentId: kanbanComment.id,
        createComment,
        updateComment,
      });

      setKanbanCfg(
        applyJiraStatusesToConfig(saved.savedConfig, ensured.nextMap)
      );
      setKanbanComment({ id: saved.commentId, originalText: saved.savedText });
      setUnlockedStepIdx(saved.savedConfig.unlockedStepIdx || 0);

      setJiraCtx((prev) => ({
        ...prev,
        subtasksBySummary: ensured.nextMap,
      }));

      closeStepGate();

      showSyncOverlay({
        title: "Próximo step liberado",
        message:
          ensured.created?.length > 0
            ? `Step "${getStepTitle(toIdx)}" liberado. Subtarefas criadas: ${
                ensured.created.length
              }.`
            : `Step "${getStepTitle(
                toIdx
              )}" liberado. Nenhuma subtarefa nova precisou ser criada.`,
        done: true,
        created: ensured.created || [],
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

  /* ---------- Toggle subtask (Kanban) ---------- */
  async function onToggleKanbanSubtask(stepKey, cardId, subId) {
    if (!jiraCtx?.ticketKey || !jiraCtx?.projectId) {
      alert("Sincronize com o Jira antes.");
      return;
    }
    if (!kanbanCfg) {
      alert("Crie a estrutura do Kanban primeiro.");
      return;
    }

    const stepIdx = getStepIdxByKey(stepKey);
    if (typeof stepIdx === "number" && stepIdx > unlockedStepIdx) {
      alert(`"${getStepTitle(stepIdx)}" ainda não está liberada.`);
      return;
    }

    const col = kanbanCfg.columns?.[stepKey];
    const card = (col?.cards || []).find((c) => c.id === cardId);
    const st = (card?.subtasks || []).find((x) => x.id === subId);
    if (!st) return;

    const summary = buildKanbanSummary({
      stepTitle: col?.title || stepKey,
      cardTitle: card.title,
      subTitle: st.title,
    });

    const mapKey = normalizeKey(summary);
    const jira = jiraCtx.subtasksBySummary?.[mapKey];
    const isChecked = jira ? isDoneStatus(jira) : false;

    try {
      // garante criação (on-demand) se faltar mapping
      let jiraKey = st.jiraKey || jira?.key || null;

      if (!jiraKey) {
        const created = await createSubtask(
          jiraCtx.projectId,
          jiraCtx.ticketKey,
          summary
        );
        jiraKey = created.key;

        const cfg2 = structuredClone
          ? structuredClone(kanbanCfg)
          : JSON.parse(JSON.stringify(kanbanCfg));
        const c2 = cfg2.columns?.[stepKey]?.cards?.find((c) => c.id === cardId);
        const st2 = c2?.subtasks?.find((x) => x.id === subId);
        if (st2) {
          st2.jiraKey = created.key;
          st2.jiraId = created.id;
        }

        const saved = await upsertKanbanConfigComment({
          ticketKey: jiraCtx.ticketKey,
          config: cfg2,
          existingCommentId: kanbanComment.id,
          createComment,
          updateComment,
        });

        setKanbanCfg(saved.savedConfig);
        setKanbanComment({
          id: saved.commentId,
          originalText: saved.savedText,
        });

        setJiraCtx((prev) => ({
          ...prev,
          subtasksBySummary: {
            ...(prev?.subtasksBySummary || {}),
            [mapKey]: {
              key: created.key,
              id: created.id,
              status: "",
              statusCategory: "",
            },
          },
        }));
      }

      if (isChecked) {
        const backPayload = await transitionToBacklog(jiraKey);
        setJiraCtx((prev) => ({
          ...prev,
          subtasksBySummary: {
            ...(prev?.subtasksBySummary || {}),
            [mapKey]: {
              ...(prev?.subtasksBySummary?.[mapKey] || {}),
              key: jiraKey,
              status: backPayload?.status || "Backlog",
              statusCategory: backPayload?.statusCategory || "new",
            },
          },
        }));
      } else {
        const donePayload = await transitionToDone(jiraKey);
        setJiraCtx((prev) => ({
          ...prev,
          subtasksBySummary: {
            ...(prev?.subtasksBySummary || {}),
            [mapKey]: {
              ...(prev?.subtasksBySummary?.[mapKey] || {}),
              key: jiraKey,
              status: donePayload?.status || "Done",
              statusCategory: donePayload?.statusCategory || "done",
            },
          },
        }));
      }
    } catch (e) {
      console.error(e);
      alert("Erro ao transicionar subtarefa no Jira: " + (e?.message || e));
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
      setScriptsAlterados("");
      setChaves([]);
      setTicketSideInfo(null);
      setSideOpen(true);

      const issue = await getIssue(
        ticketJira,
        [
          "summary",
          "subtasks",
          "status",
          "project",
          "description",
          "customfield_10903",
          "duedate",
          "customfield_11519",
          "assignee",
          "creator",
          "components",
          "customfield_11520",
          "customfield_13604",
          "customfield_10015",
          "priority",
        ].join(",")
      );

      onRdmTitleChange?.(issue?.fields?.summary || "");

      const fields = issue?.fields ?? {};
      const responsavel = fields?.assignee?.displayName || "";
      const relator = fields?.creator?.displayName || "";
      const diretorias = toNamesArray(fields?.customfield_11520);
      const componentes = (fields?.components || [])
        .map((c) => c?.name)
        .filter(Boolean);

      const frente =
        fields?.customfield_13604?.value ||
        fields?.customfield_13604?.name ||
        fields?.customfield_13604?.label ||
        (typeof fields?.customfield_13604 === "string"
          ? fields.customfield_13604
          : "");

      const startDateRaw = fields?.customfield_10015;
      const startDate =
        typeof startDateRaw === "string"
          ? fmtDateBr(startDateRaw)
          : startDateRaw?.value
          ? fmtDateBr(startDateRaw.value)
          : "";

      const statusTicket = fields?.status?.name || "";

      let prioridade = fields?.priority?.name || "";
      if (!prioridade && fields?.subtasks?.length) {
        const st0 = fields.subtasks[0];
        if (st0?.key) {
          try {
            const stIssue = await getIssue(st0.key, "priority");
            prioridade = stIssue?.fields?.priority?.name || "";
          } catch {}
        }
      }

      setTicketSideInfo({
        responsavel,
        relator,
        diretorias,
        componentes,
        frente,
        startDate,
        prioridade,
        status: statusTicket,
      });

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
        hasCustomDue ? "Data limite Alterada:" : "Data limite:"
      );
      onRdmDueDateChange?.(duePicked);

      const projectId = issue.fields.project.id;
      const subtasks = issue.fields.subtasks || [];

      // IMPORTANT: normaliza a chave do mapa (pra bater com o kanban)
      let subtasksBySummary = {};
      subtasks.forEach((st) => {
        const summary = (st.fields?.summary || "").trim();
        if (summary) {
          subtasksBySummary[normalizeKey(summary)] = {
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

      const descText = adfSafeToText(issue?.fields?.description);
      const criteriosText = adfSafeToText(issue?.fields?.customfield_10903);
      setDescricaoProjeto(descText);
      setCriteriosAceite(criteriosText);

      showSyncOverlay({
        title: "Carregando dados",
        message: "Carregando comentários e anexos do Jira...",
      });

      let payload = null;
      try {
        payload = await getComments(ticketJira);
      } catch (e) {
        console.warn("Falha ao carregar comentários:", e);
      }

      // ===== KANBAN CONFIG =====
      let cfg = null;
      let cfgCommentId = null;

      if (payload) {
        const k = extractKanbanConfigFromCommentsPayload(payload);
        if (k.found && k.config) {
          cfg = k.config;
          cfgCommentId = k.commentId;
        } else if (k.found && !k.config) {
          showSyncOverlay({
            title: "Config inválida",
            message:
              "Foi encontrado um comentário de config do Kanban, mas o JSON está inválido. Refaça no modal.",
            done: true,
            error: k.error || "JSON inválido.",
          });
          setKanbanCfg(null);
          setKanbanComment({ id: k.commentId, originalText: "" });
          setBuilderOpen(true);
        }
      }

      if (cfg) {
        setKanbanCfg(cfg);
        setKanbanComment({ id: cfgCommentId, originalText: "" });
        setUnlockedStepIdx(
          typeof cfg.unlockedStepIdx === "number" ? cfg.unlockedStepIdx : 0
        );

        // cria subtasks SOMENTE do step liberado atual
        const stepToEnsure =
          typeof cfg.unlockedStepIdx === "number" ? cfg.unlockedStepIdx : 0;

        const ensured = await ensureSubtasksForStep({
          cfg,
          stepIdx: stepToEnsure,
          ticketKey: issue.key,
          projectId,
          subtasksBySummary,
          createSubtask,
          onProgress: (p) => showSyncOverlay({ ...p }),
        });

        // persiste mappings (evita duplicar em sync futuro)
        const saved = await upsertKanbanConfigComment({
          ticketKey: issue.key,
          config: ensured.nextCfg,
          existingCommentId: cfgCommentId,
          createComment,
          updateComment,
        });

        cfg = saved.savedConfig;
        subtasksBySummary = ensured.nextMap;

        setKanbanCfg(applyJiraStatusesToConfig(cfg, subtasksBySummary));
        setKanbanComment({
          id: saved.commentId,
          originalText: saved.savedText,
        });
        setUnlockedStepIdx(
          typeof cfg.unlockedStepIdx === "number" ? cfg.unlockedStepIdx : 0
        );

        setJiraCtx({ ticketKey: issue.key, projectId, subtasksBySummary });

        showSyncOverlay({
          title: "Concluído",
          message: `Sincronização concluída para ${ticketJira}.`,
          done: true,
          created: ensured.created || [],
        });
      } else if (!builderOpen) {
        // não existe config => abre builder
        setKanbanCfg(null);
        setKanbanComment({ id: null, originalText: "" });
        setUnlockedStepIdx(0);
        setBuilderOpen(true);

        showSyncOverlay({
          title: "Estrutura não encontrada",
          message:
            "Este ticket ainda não possui estrutura do Kanban. Monte a estrutura no modal para continuar.",
          done: true,
        });
      }

      // ===== Scripts / Variáveis / Anexos =====
      if (payload) {
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
      }
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

  async function handleSaveKanbanStructure(selectedByStepKey) {
    if (!jiraCtx?.ticketKey || !jiraCtx?.projectId) {
      alert("Sincronize com o Jira antes.");
      return;
    }

    setBuilderOpen(false);

    showSyncOverlay({
      title: "Criando estrutura",
      message: "Aplicando estrutura do Kanban no ticket...",
      current: 0,
      total: 0,
      created: [],
    });

    try {
      let cfg = buildTicketKanbanConfig({
        ticketKey: jiraCtx.ticketKey,
        workflow: DEFAULT_KANBAN_WORKFLOW,
        selectedByStepKey,
      });

      // cria subtasks do step 0 (manual)
      const ensured = await ensureSubtasksForStep({
        cfg,
        stepIdx: 0,
        ticketKey: jiraCtx.ticketKey,
        projectId: jiraCtx.projectId,
        subtasksBySummary: jiraCtx.subtasksBySummary,
        createSubtask,
        onProgress: (p) => showSyncOverlay({ ...p }),
      });

      cfg = ensured.nextCfg;

      // persiste comentário
      const saved = await upsertKanbanConfigComment({
        ticketKey: jiraCtx.ticketKey,
        config: cfg,
        existingCommentId: kanbanComment.id,
        createComment,
        updateComment,
      });

      setKanbanCfg(
        applyJiraStatusesToConfig(saved.savedConfig, ensured.nextMap)
      );
      setKanbanComment({ id: saved.commentId, originalText: saved.savedText });
      setUnlockedStepIdx(saved.savedConfig.unlockedStepIdx || 0);

      setJiraCtx((prev) => ({
        ...prev,
        subtasksBySummary: ensured.nextMap,
      }));

      showSyncOverlay({
        title: "Estrutura criada",
        message: "Kanban configurado no ticket e step inicial liberado.",
        done: true,
        created: ensured.created || [],
      });
    } catch (e) {
      console.error(e);
      showSyncOverlay({
        title: "Erro",
        message: "Erro ao criar estrutura do Kanban.",
        done: true,
        error: e?.message ? String(e.message) : String(e),
      });
    }
  }

  //#region HTML
  return (
    <motion.section
      key="rdm"
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.4, ease: "easeInOut" }}
      className="rdm-wrap"
    >
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
              {stepGate.toIdx >= getWorkflow().length
                ? "Kanban concluído"
                : "Step concluído"}
            </div>

            <div style={{ marginTop: 6, color: "#555", fontSize: 13 }}>
              {stepGate.toIdx >= getWorkflow().length ? (
                <>
                  Você concluiu a última fase:{" "}
                  <strong>{getStepTitle(stepGate.fromIdx)}</strong>.
                </>
              ) : (
                <>
                  Você concluiu a fase:{" "}
                  <strong>{getStepTitle(stepGate.fromIdx)}</strong>.
                  <br />
                  Clique para liberar o próximo step:{" "}
                  <strong>{getStepTitle(stepGate.toIdx)}</strong>.
                </>
              )}
            </div>

            {stepGate.toIdx < getWorkflow().length && (
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
                  {listNextStepPreview(stepGate.toIdx).map((line) => (
                    <li key={line}>{line}</li>
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
                onClick={unlockNextStep}
                disabled={advancingStep}
              >
                {advancingStep
                  ? "Liberando..."
                  : stepGate.toIdx >= getWorkflow().length
                  ? "Ok"
                  : `Liberar: ${getStepTitle(stepGate.toIdx)}`}
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
              @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
          </div>
        </div>
      )}

      {/* ===== Layout: Conteúdo + Painel lateral ===== */}
      <div className="gmud-shell">
        <div className="gmud-main">
          {/* Data limite (topo) */}
          <div className="gmud-topbar">
            <div className="gmud-deadline" title="Data limite do ticket">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="gmud-deadline__icon"
              >
                <path d="M12 8v4l3 3" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span>
                {dataLimiteLabel} {dataLimite ? fmtDueDate(dataLimite) : "—"}
              </span>
            </div>

            <button
              type="button"
              className={`gmud-side-toggle ${sideOpen ? "is-open" : ""}`}
              onClick={toggleSide}
              disabled={!canToggleSide}
              aria-expanded={sideOpen}
              aria-controls="gmud-sidebar"
              title={
                !ticketJira?.trim() && !sideOpen
                  ? "Informe o ticket do Jira"
                  : sideOpen
                  ? "Fechar detalhes"
                  : "Abrir detalhes"
              }
            >
              <i
                className={`fa-solid ${
                  sideOpen ? "fa-xmark" : "fa-circle-info"
                }`}
                aria-hidden="true"
              />
              <span>{sideOpen ? "Fechar detalhes" : "Detalhes do ticket"}</span>
            </button>
          </div>

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

          {/* Accordions */}
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

          {/* ===== Kanban UI ===== */}
          <div style={{ marginTop: 14 }}>
            {!kanbanCfg ? (
              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 12,
                  background: "#fafafa",
                }}
              >
                <div style={{ fontWeight: 900 }}>Sem estrutura de Kanban</div>
                <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
                  Clique em <strong>Sincronizar com Jira</strong>. Se o ticket
                  não tiver config, o modal abrirá para montar a estrutura.
                </div>
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setBuilderOpen(true)}
                  >
                    Montar estrutura
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${
                    getWorkflow().length
                  }, minmax(260px, 1fr))`,
                  gap: 12,
                  alignItems: "start",
                }}
              >
                {getWorkflow().map((step, idx) => {
                  const stepKey = step.key;
                  const col = kanbanCfg.columns?.[stepKey];
                  const stat = computeStepPct(
                    kanbanCfg,
                    stepKey,
                    jiraCtx?.subtasksBySummary || {}
                  );
                  const isCandidate = idx === unlockedStepIdx;
                  const hasNext = idx + 1 < getWorkflow().length;

                  return (
                    <div
                      key={stepKey}
                      style={{
                        border: "1px solid #eee",
                        borderRadius: 14,
                        overflow: "hidden",
                        background: "#fff",
                        boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
                      }}
                    >
                      <div
                        style={{
                          padding: 10,
                          borderBottom: "1px solid #eee",
                          background: "#fafafa",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <i className={step.icon} aria-hidden="true" />
                          <div style={{ fontWeight: 900, fontSize: 13 }}>
                            {step.title}
                          </div>
                          <div style={{ fontSize: 12, color: "#666" }}>
                            {stat.pct}%
                          </div>
                        </div>

                        {isCandidate && stat.complete && (
                          <button
                            type="button"
                            className="primary"
                            disabled={!jiraCtx || advancingStep}
                            onClick={() =>
                              openStepGate(
                                idx,
                                hasNext ? idx + 1 : getWorkflow().length
                              )
                            }
                          >
                            {hasNext
                              ? `Liberar: ${getStepTitle(idx + 1)}`
                              : "Finalizar"}
                          </button>
                        )}
                      </div>

                      <div style={{ padding: 10, display: "grid", gap: 10 }}>
                        {(col?.cards || []).map((card) => (
                          <div
                            key={card.id}
                            style={{
                              border: "1px solid #eee",
                              borderRadius: 12,
                              padding: 10,
                              background: "#fff",
                            }}
                          >
                            <div style={{ fontWeight: 900, fontSize: 13 }}>
                              {card.title}
                            </div>

                            <div
                              style={{ marginTop: 8, display: "grid", gap: 6 }}
                            >
                              {(card.subtasks || []).map((st) => {
                                const summary = buildKanbanSummary({
                                  stepTitle: col.title,
                                  cardTitle: card.title,
                                  subTitle: st.title,
                                });
                                const mapKey = normalizeKey(summary);
                                const jira =
                                  jiraCtx?.subtasksBySummary?.[mapKey];
                                const checked = jira
                                  ? isDoneStatus(jira)
                                  : false;

                                const locked = idx > unlockedStepIdx;

                                return (
                                  <label
                                    key={st.id}
                                    style={{
                                      display: "flex",
                                      gap: 8,
                                      alignItems: "center",
                                      fontSize: 12,
                                      opacity: locked ? 0.55 : 1,
                                    }}
                                    title={
                                      locked ? "Step ainda não liberado." : ""
                                    }
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={locked}
                                      onChange={() =>
                                        onToggleKanbanSubtask(
                                          stepKey,
                                          card.id,
                                          st.id
                                        )
                                      }
                                    />
                                    <span>{st.title}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}

                        {!(col?.cards || []).length && (
                          <div style={{ fontSize: 12, color: "#777" }}>
                            Sem cards neste step.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tabs internas */}
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
            className={`tab-content ${activeTab === "scripts" ? "active" : ""}`}
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
          <div
            className={`tab-content ${activeTab === "vars" ? "active" : ""}`}
          >
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
                    onChange={(e) =>
                      updChave(row.id, { ambiente: e.target.value })
                    }
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
        </div>

        {/* Overlay */}
        <div
          className={`gmud-sidebar-overlay ${sideOpen ? "open" : ""}`}
          onClick={() => setSideOpen(false)}
        />

        {/* Sidebar */}
        <aside
          id="gmud-sidebar"
          className={`gmud-sidebar ${sideOpen ? "open" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label="Detalhes do ticket"
        >
          <div className="gmud-sidebar-head">
            <div className="gmud-sidebar-head-left">
              <div className="gmud-sidebar-title-row">
                <span className="gmud-sidebar-dot" aria-hidden="true" />
                <div className="gmud-sidebar-title">Detalhes do ticket</div>
              </div>

              <div className="gmud-sidebar-subrow">
                <span className="gmud-ticket-pill">
                  {ticketJira ? ticketJira : "—"}
                </span>

                {ticketSideInfo?.prioridade ? (
                  <span className="gmud-ticket-pill gmud-ticket-pill--ghost">
                    <i className="fa-solid fa-flag" aria-hidden="true" />
                    {ticketSideInfo.prioridade}
                  </span>
                ) : null}

                {ticketSideInfo?.status ? (
                  <span
                    className={`gmud-ticket-pill gmud-ticket-pill--status tone-${statusTone(
                      ticketSideInfo.status
                    )}`}
                    title={`Status: ${ticketSideInfo.status}`}
                  >
                    <i className="fa-solid fa-circle" aria-hidden="true" />
                    {ticketSideInfo.status}
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              className="gmud-footer-btn"
              onClick={toggleSide}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>

          <div className="gmud-sidebar-body">
            {!ticketSideInfo ? (
              <div className="gmud-side-empty">
                {syncing ? (
                  <>
                    <div className="gmud-side-empty-title">
                      Carregando dados…
                    </div>
                    <div className="gmud-side-empty-sub">
                      Sincronizando com o Jira. Assim que concluir, os detalhes
                      aparecerão aqui.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="gmud-side-empty-title">
                      Sem dados do ticket
                    </div>
                    <div className="gmud-side-empty-sub">
                      Clique em <strong>Sincronizar com Jira</strong> para
                      exibir: responsável, relator, diretorias, componentes,
                      frente, start date e prioridade.
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="gmud-side-card gmud-side-card--modern">
                <div className="gmud-side-section">
                  <div className="gmud-side-section-title">
                    <i className="fa-solid fa-user-group" aria-hidden="true" />
                    <span>Pessoas</span>
                  </div>

                  <div className="gmud-side-grid">
                    <div className="gmud-side-row">
                      <div className="gmud-side-label">Responsável</div>
                      <div className="gmud-side-value">
                        {ticketSideInfo.responsavel || "—"}
                      </div>
                    </div>
                    <div className="gmud-side-row">
                      <div className="gmud-side-label">Relator</div>
                      <div className="gmud-side-value">
                        {ticketSideInfo.relator || "—"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="gmud-side-section">
                  <div className="gmud-side-section-title">
                    <i className="fa-solid fa-layer-group" aria-hidden="true" />
                    <span>Contexto</span>
                  </div>

                  <div className="gmud-side-grid">
                    <div className="gmud-side-row">
                      <div className="gmud-side-label">Frente</div>
                      <div className="gmud-side-value">
                        {ticketSideInfo.frente || "—"}
                      </div>
                    </div>

                    <div className="gmud-side-row">
                      <div className="gmud-side-label">Start date</div>
                      <div className="gmud-side-value">
                        {ticketSideInfo.startDate || "—"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="gmud-side-section">
                  <div className="gmud-side-section-title">
                    <i className="fa-solid fa-tag" aria-hidden="true" />
                    <span>Classificação</span>
                  </div>

                  <div className="gmud-side-grid">
                    <div className="gmud-side-row">
                      <div className="gmud-side-label">Diretorias</div>
                      <div className="gmud-side-value">
                        {ticketSideInfo.diretorias?.length ? (
                          <div className="gmud-chip-wrap">
                            {ticketSideInfo.diretorias.map((d, i) => (
                              <span
                                key={`${d}-${i}`}
                                className="gmud-chip gmud-chip--red"
                              >
                                {d}
                              </span>
                            ))}
                          </div>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>

                    <div className="gmud-side-row">
                      <div className="gmud-side-label">Componentes</div>
                      <div className="gmud-side-value">
                        {ticketSideInfo.componentes?.length ? (
                          <div className="gmud-chip-wrap">
                            {ticketSideInfo.componentes.map((c, i) => (
                              <span
                                key={`${c}-${i}`}
                                className="gmud-chip gmud-chip--gray"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      <KanbanBuilderModal
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        library={DEFAULT_KANBAN_LIBRARY}
        workflow={DEFAULT_KANBAN_WORKFLOW}
        onSave={handleSaveKanbanStructure}
      />
    </motion.section>
  );
}

export default ChecklistGMUDTab;
