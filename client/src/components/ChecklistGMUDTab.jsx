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

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RotateCw,
  Save,
  Check,
  MessageSquarePlus,
  UploadCloud,
  X,
  FileCode2,
  Layers3,
} from "lucide-react";

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
  // --- Estados para Nova Tarefa Avulsa ---
  const makeCustomTaskModal = (patch = {}) => ({
    open: false,
    stepKey: null, // string (key do step)
    title: "",
    subtasks: [""], // sempre array
    ...patch,
  });

  const [customTaskModal, setCustomTaskModal] = useState(() =>
    makeCustomTaskModal()
  );

  const [creatingCustomTask, setCreatingCustomTask] = useState(false);

  // Comentários (Jira) - Tab "Comentários"
  const [jiraCommentsList, setJiraCommentsList] = useState([]); // [{id, author, created, updated, text}]
  const [newJiraCommentText, setNewJiraCommentText] = useState("");
  const [loadingJiraComments, setLoadingJiraComments] = useState(false);
  const [postingJiraComment, setPostingJiraComment] = useState(false);

  // Helpers seguros
  const handleAddSubtaskField = () => {
    setCustomTaskModal((prev) => {
      const subs = Array.isArray(prev.subtasks) ? prev.subtasks : [""];
      return { ...prev, subtasks: [...subs, ""] };
    });
  };

  const handleUpdateSubtaskField = (index, value) => {
    setCustomTaskModal((prev) => {
      const subs = Array.isArray(prev.subtasks) ? [...prev.subtasks] : [""];
      subs[index] = value;
      return { ...prev, subtasks: subs };
    });
  };

  const handleRemoveSubtaskField = (index) => {
    setCustomTaskModal((prev) => {
      const subs = Array.isArray(prev.subtasks) ? prev.subtasks : [""];
      const next = subs.filter((_, i) => i !== index);
      return { ...prev, subtasks: next.length ? next : [""] };
    });
  };

  // Para exibir o título do step pelo stepKey (string)
  function getStepTitleByKey(stepKey) {
    const wf = getWorkflow();
    const idx = getWorkflowIndex(wf, stepKey);
    if (typeof idx === "number" && idx >= 0) return wf[idx]?.title || stepKey;
    return kanbanCfg?.columns?.[stepKey]?.title || stepKey || "";
  }

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

  function fmtDateTimeBr(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("pt-BR");
    } catch {
      return String(iso);
    }
  }

  // ADF simples (Jira Cloud) para comentário "normal" (sem TAG)
  function adfFromPlainText(text) {
    const raw = String(text ?? "");
    const lines = raw.split(/\r?\n/);

    const content = lines.map((line) => {
      const t = String(line ?? "");
      return {
        type: "paragraph",
        content: t ? [{ type: "text", text: t }] : [],
      };
    });

    return {
      type: "doc",
      version: 1,
      content: content.length ? content : [{ type: "paragraph", content: [] }],
    };
  }

  function extractAllJiraComments(payload) {
    // Jira costuma retornar { comments: [...] } em Cloud
    const arr =
      payload?.comments ||
      payload?.comments?.comments ||
      payload?.values ||
      payload?.comment?.comments ||
      [];

    const list = Array.isArray(arr) ? arr : [];

    const out = list
      .map((c) => {
        const text = String(adfSafeToText(c?.body) || "").trim();

        return {
          id: c?.id,
          author:
            c?.author?.displayName ||
            c?.updateAuthor?.displayName ||
            c?.author?.name ||
            "—",
          created: c?.created || "",
          updated: c?.updated || "",
          text,
        };
      })
      .filter((c) => c.id && c.text)
      // EXCLUI SOMENTE o comentário de config do Kanban
      .filter((c) => !/\[GMUD Kanban Config\]/i.test(c.text))
      // Ordena por data (mais antigo -> mais novo)
      .sort(
        (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
      );

    return out;
  }

  async function refreshJiraComments() {
    const tk = String(ticketJira || "")
      .trim()
      .toUpperCase();
    if (!tk) return;

    setLoadingJiraComments(true);
    try {
      const payload = await getComments(tk);
      setJiraCommentsList(extractAllJiraComments(payload));
    } catch (e) {
      console.warn("Falha ao atualizar comentários:", e);
      alert("Erro ao atualizar comentários do Jira: " + (e?.message || e));
    } finally {
      setLoadingJiraComments(false);
    }
  }

  async function addJiraComment() {
    const tk = String(ticketJira || "")
      .trim()
      .toUpperCase();
    const text = String(newJiraCommentText || "").trim();

    if (!tk) {
      alert("Informe o ticket do Jira.");
      return;
    }
    if (!text) {
      alert("Digite um comentário.");
      return;
    }

    setPostingJiraComment(true);
    try {
      await createComment(tk, adfFromPlainText(text));
      setNewJiraCommentText("");
      await refreshJiraComments();
      alert("Comentário adicionado no Jira.");
    } catch (e) {
      console.error(e);
      alert("Erro ao adicionar comentário no Jira: " + (e?.message || e));
    } finally {
      setPostingJiraComment(false);
    }
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
        setJiraCommentsList([]);
        setNewJiraCommentText("");

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

      setJiraCommentsList([]);
      setNewJiraCommentText("");
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
        if (payload) {
          setJiraCommentsList(extractAllJiraComments(payload));
        } else {
          setJiraCommentsList([]);
        }
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

  async function handleCreateCustomTask() {
    if (!jiraCtx?.ticketKey || !jiraCtx?.projectId) {
      alert("Sincronize com o Jira antes.");
      return;
    }
    if (!kanbanCfg) {
      alert("Crie a estrutura do Kanban primeiro.");
      return;
    }

    const stepKey = customTaskModal?.stepKey;
    const title = String(customTaskModal?.title || "").trim();
    const subsRaw = Array.isArray(customTaskModal?.subtasks)
      ? customTaskModal.subtasks
      : [];

    const validSubs = subsRaw
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    if (!stepKey) {
      alert("Step inválido. Abra o modal a partir do step ativo.");
      return;
    }
    if (!title || validSubs.length === 0) {
      alert("Preencha o título e pelo menos uma subtarefa.");
      return;
    }

    const stepCol = kanbanCfg?.columns?.[stepKey];
    const stepTitle = stepCol?.title || getStepTitleByKey(stepKey) || stepKey;

    setCreatingCustomTask(true);

    try {
      const createdJiraTasks = [];
      const nextMap = { ...(jiraCtx?.subtasksBySummary || {}) };

      // 1) cria subtarefas no Jira + atualiza map local (evita re-criar onToggle)
      for (const subTitle of validSubs) {
        const summary = buildKanbanSummary({
          stepTitle,
          cardTitle: title,
          subTitle,
        });

        const res = await createSubtask(
          jiraCtx.projectId,
          jiraCtx.ticketKey,
          summary
        );

        createdJiraTasks.push({
          id: crypto.randomUUID(),
          title: subTitle,
          jiraKey: res.key,
          jiraId: res.id,
        });

        nextMap[normalizeKey(summary)] = {
          key: res.key,
          id: res.id,
          status: "",
          statusCategory: "",
        };
      }

      // 2) atualiza cfg local
      const nextCfg =
        typeof structuredClone === "function"
          ? structuredClone(kanbanCfg)
          : JSON.parse(JSON.stringify(kanbanCfg));

      if (!nextCfg.columns?.[stepKey]) {
        nextCfg.columns = {
          ...(nextCfg.columns || {}),
          [stepKey]: { title: stepTitle, cards: [] },
        };
      }

      const cards = Array.isArray(nextCfg.columns[stepKey].cards)
        ? nextCfg.columns[stepKey].cards
        : [];

      nextCfg.columns[stepKey].cards = cards;
      nextCfg.columns[stepKey].cards.push({
        id: crypto.randomUUID(),
        title,
        subtasks: createdJiraTasks,
      });

      // 3) persiste no comentário do Jira
      const saved = await upsertKanbanConfigComment({
        ticketKey: jiraCtx.ticketKey,
        config: nextCfg,
        existingCommentId: kanbanComment.id,
        createComment,
        updateComment,
      });

      // 4) atualiza estados
      setKanbanCfg(applyJiraStatusesToConfig(saved.savedConfig, nextMap));
      setKanbanComment({ id: saved.commentId, originalText: saved.savedText });

      setJiraCtx((prev) =>
        prev ? { ...prev, subtasksBySummary: nextMap } : prev
      );

      // fecha e reseta modal
      setCustomTaskModal(makeCustomTaskModal());

      alert("Tarefa adicionada com sucesso!");
    } catch (e) {
      console.error(e);
      alert("Erro ao criar tarefa: " + (e?.message || e));
    } finally {
      setCreatingCustomTask(false);
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
                <Button
                  type="button"
                  onClick={closeSyncOverlay}
                  className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                >
                  <Check className="mr-2 h-4 w-4" />
                  Ok
                </Button>
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

      {/* 3. NOVO MODAL: ADICIONAR TAREFA A PARTE */}
      {customTaskModal.open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10001,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              background: "#fff",
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>
              Nova Tarefa
            </div>

            <div style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
              Adicionar no step:{" "}
              <strong>{getStepTitleByKey(customTaskModal.stepKey)}</strong>
            </div>

            <label
              style={{
                fontSize: 12,
                fontWeight: 700,
                display: "block",
                marginBottom: 6,
              }}
            >
              Título do Card
            </label>
            <input
              autoFocus
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                marginBottom: 14,
                outline: "none",
              }}
              placeholder="Ex: Validar logs de erro"
              value={customTaskModal.title || ""}
              onChange={(e) =>
                setCustomTaskModal((prev) => ({
                  ...prev,
                  title: e.target.value,
                }))
              }
            />

            <label
              style={{
                fontSize: 12,
                fontWeight: 700,
                display: "block",
                marginBottom: 6,
              }}
            >
              Subtarefas
            </label>

            <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
              {(Array.isArray(customTaskModal.subtasks)
                ? customTaskModal.subtasks
                : [""]
              ).map((st, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8 }}>
                  <input
                    style={{
                      flex: 1,
                      padding: "10px",
                      borderRadius: 8,
                      border: "1px solid #ddd",
                      outline: "none",
                    }}
                    placeholder={`Subtarefa ${idx + 1} (ex: Coletar evidência)`}
                    value={st || ""}
                    onChange={(e) =>
                      handleUpdateSubtaskField(idx, e.target.value)
                    }
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveSubtaskField(idx)}
                    disabled={
                      (customTaskModal.subtasks?.length || 1) <= 1 ||
                      creatingCustomTask
                    }
                    title="Remover"
                    style={{
                      width: 42,
                      borderRadius: 8,
                      border: "1px solid #eee",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <i className="fas fa-trash" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddSubtaskField}
              disabled={creatingCustomTask}
              style={{
                width: "100%",
                padding: "10px",
                marginBottom: 16,
                background: "transparent",
                border: "1px dashed #ccc",
                borderRadius: 10,
                color: "#666",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <i className="fas fa-plus" style={{ marginRight: 8 }} />
              Adicionar subtarefa
            </button>

            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}
            >
              <button
                type="button"
                className="secondary"
                disabled={creatingCustomTask}
                onClick={() => setCustomTaskModal(makeCustomTaskModal())}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="primary"
                disabled={
                  creatingCustomTask ||
                  !String(customTaskModal.title || "").trim() ||
                  !(
                    Array.isArray(customTaskModal.subtasks) &&
                    customTaskModal.subtasks.some((s) => String(s || "").trim())
                  )
                }
                onClick={handleCreateCustomTask}
              >
                {creatingCustomTask ? "Criando..." : "Criar Tarefa"}
              </button>
            </div>
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
              <Button
                onClick={sincronizarJira}
                disabled={syncing}
                aria-busy={syncing}
                className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                <RotateCw
                  className={cn("mr-2 h-4 w-4", syncing && "animate-spin")}
                />
                {syncing ? "Sincronizando..." : "Sincronizar com Jira"}
              </Button>
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

          {/* ===== Kanban UI Wrapper (Scroll Horizontal) ===== */}
          <div
            style={{
              marginTop: 20,
              overflowX: "auto",
              paddingBottom: 10,
              display: "flex",
              gap: 16,
              scrollbarWidth: "thin", // Para Firefox
            }}
          >
            {!kanbanCfg ? (
              <div
                style={{
                  border: "1px dashed #ccc",
                  borderRadius: 12,
                  padding: 30,
                  background: "#fff",
                  textAlign: "center",
                  width: "100%",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  Sem estrutura de Kanban
                </div>
                <p style={{ color: "#666", fontSize: 13 }}>
                  Sincronize com o Jira para visualizar o fluxo.
                </p>
                <Button
                  type="button"
                  onClick={() => setBuilderOpen(true)}
                  className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                >
                  <Layers3 className="mr-2 h-4 w-4" />
                  Montar estrutura
                </Button>
              </div>
            ) : (
              getWorkflow().map((step, idx) => {
                const stepKey = step.key;
                const col = kanbanCfg.columns?.[stepKey];
                const stat = computeStepPct(
                  kanbanCfg,
                  stepKey,
                  jiraCtx?.subtasksBySummary || {}
                );

                const isDone = idx < unlockedStepIdx;
                const isActive = idx === unlockedStepIdx;
                const isLocked = idx > unlockedStepIdx;
                const hasNext = idx + 1 < getWorkflow().length;

                // Definição da cor lateral baseada no status do Step
                const statusColor = isDone
                  ? "#28a745"
                  : isActive
                  ? "#ee0000"
                  : "#d1d1d1";

                return (
                  <div
                    key={stepKey}
                    style={{
                      flex: "0 0 280px", // Largura fixa para permitir o scroll horizontal
                      display: "flex",
                      flexDirection: "column",
                      opacity: isLocked ? 0.6 : 1,
                    }}
                  >
                    {/* Header do Step - Super Clean */}
                    <div
                      style={{
                        padding: "0 4px 12px 4px",
                        borderBottom: `2px solid ${
                          isActive ? "#ee0000" : "#eee"
                        }`,
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <i
                            className={step.icon}
                            style={{ color: statusColor, fontSize: 14 }}
                          />
                          <span
                            style={{
                              fontWeight: 800,
                              fontSize: 13,
                              textTransform: "uppercase",
                              letterSpacing: "0.5px",
                            }}
                          >
                            {step.title}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: statusColor,
                          }}
                        >
                          {isDone ? "CONCLUÍDO" : `${stat.pct}%`}
                        </span>
                      </div>

                      {/* Botão de Ação Minimalista */}
                      {isActive && stat.complete && (
                        <button
                          type="button"
                          className="primary"
                          style={{
                            width: "100%",
                            marginTop: 8,
                            padding: "4px 8px",
                            fontSize: 11,
                            borderRadius: 6,
                          }}
                          disabled={!jiraCtx || advancingStep}
                          onClick={() =>
                            openStepGate(
                              idx,
                              hasNext ? idx + 1 : getWorkflow().length
                            )
                          }
                        >
                          {hasNext ? `Liberar Próximo` : "Finalizar"}
                        </button>
                      )}
                    </div>

                    {/* Lista de Cards */}
                    <div style={{ display: "grid", gap: 10 }}>
                      {(col?.cards || []).map((card) => (
                        <div
                          key={card.id}
                          style={{
                            background: "#fff",
                            border: "1px solid #e1e1e1",
                            borderLeft: `4px solid ${statusColor}`, // Borda lateral solicitada
                            borderRadius: "4px 8px 8px 4px",
                            padding: "10px 12px",
                            transition: "transform 0.2s",
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 13,
                              color: "#333",
                              marginBottom: 6,
                            }}
                          >
                            {card.title}
                          </div>

                          <div style={{ display: "grid", gap: 4 }}>
                            {(card.subtasks || []).map((st) => {
                              const summary = buildKanbanSummary({
                                stepTitle: col.title,
                                cardTitle: card.title,
                                subTitle: st.title,
                              });
                              const mapKey = normalizeKey(summary);
                              const jira = jiraCtx?.subtasksBySummary?.[mapKey];
                              const checked = jira ? isDoneStatus(jira) : false;

                              return (
                                <label
                                  key={st.id}
                                  style={{
                                    display: "flex",
                                    gap: 8,
                                    alignItems: "flex-start",
                                    fontSize: 12,
                                    cursor: isActive ? "pointer" : "default",
                                    color: checked ? "#999" : "#444",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={!isActive}
                                    onChange={() =>
                                      onToggleKanbanSubtask(
                                        stepKey,
                                        card.id,
                                        st.id
                                      )
                                    }
                                    style={{
                                      marginTop: 2,
                                      accentColor: "#ee0000",
                                    }}
                                  />
                                  <span
                                    style={{
                                      textDecoration: checked
                                        ? "line-through"
                                        : "none",
                                    }}
                                  >
                                    {st.title}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {!(col?.cards || []).length && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#999",
                            textAlign: "center",
                            padding: 10,
                            border: "1px dashed #eee",
                          }}
                        >
                          Nenhuma subtarefa
                        </div>
                      )}
                    </div>
                    {isActive && (
                      <button
                        type="button"
                        onClick={() =>
                          setCustomTaskModal(
                            makeCustomTaskModal({ open: true, stepKey })
                          )
                        }
                        style={{
                          width: "100%",
                          padding: "10px",
                          marginTop: "12px",
                          background: "transparent",
                          border: "1px dashed #ccc",
                          borderRadius: "8px",
                          color: "#666",
                          cursor: "pointer",
                          fontSize: "13px",
                        }}
                      >
                        <i className="fas fa-plus" style={{ marginRight: 8 }} />
                        Adicionar tarefa à parte
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* ===== Navegação por Tabs (Estilo Moderno) ===== */}
          <div
            style={{
              display: "flex",
              gap: 24,
              borderBottom: "1px solid #eee",
              marginBottom: 20,
              padding: "0 4px",
            }}
          >
            {[
              { id: "scripts", label: "Scripts", icon: "fas fa-code" },
              { id: "vars", label: "Chaves (Variáveis)", icon: "fas fa-key" },
              {
                id: "evidencias",
                label: "Evidências",
                icon: "fas fa-paperclip",
              },
              {
                id: "comentarios",
                label: "Comentários",
                icon: "fas fa-comments",
              },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "12px 0",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  color: activeTab === tab.id ? "#ee0000" : "#777",
                  borderBottom: `2px solid ${
                    activeTab === tab.id ? "#ee0000" : "transparent"
                  }`,
                  transition: "all 0.2s",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <i className={tab.icon} style={{ fontSize: 12 }} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* ===== Conteúdo das Tabs ===== */}
          <div style={{ minHeight: 300 }}>
            {/* Tab: Scripts */}
            {activeTab === "scripts" && (
              <div className="animate-fade-in">
                <div style={{ position: "relative" }}>
                  <textarea
                    style={{
                      width: "100%",
                      height: 180,
                      padding: 14,
                      borderRadius: 12,
                      border: "1px solid #e1e1e1",
                      fontFamily: "'Fira Code', monospace",
                      fontSize: 13,
                      lineHeight: "1.5",
                      outline: "none",
                      backgroundColor: "#fcfcfc",
                    }}
                    value={scriptsAlterados}
                    onChange={(e) => setScriptsAlterados(e.target.value)}
                    placeholder="Ex: DEV\TRANSFERENCIA_URA_OPER_DEV..."
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginTop: 12,
                  }}
                >
                  <Button
                    onClick={salvarScripts}
                    disabled={savingScripts}
                    aria-busy={savingScripts}
                    className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 px-5 py-2.5"
                  >
                    <FileCode2
                      className={cn(
                        "mr-2 h-4 w-4",
                        savingScripts && "animate-spin"
                      )}
                    />
                    {savingScripts
                      ? "Processando..."
                      : "Salvar Scripts no Jira"}
                  </Button>
                </div>
              </div>
            )}

            {/* Tab: Variáveis */}
            {activeTab === "vars" && (
              <div className="animate-fade-in">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 16,
                    padding: "12px",
                    background: "#f8f9fa",
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontSize: 13, color: "#666" }}>
                    <i
                      className="fas fa-info-circle"
                      style={{ marginRight: 6 }}
                    />
                    Gerencie chaves de ambiente para este projeto.
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="secondary"
                      onClick={addChave}
                      style={{ padding: "8px 14px" }}
                    >
                      + Adicionar
                    </button>
                    <Button
                      onClick={salvarVariaveis}
                      disabled={savingVars}
                      aria-busy={savingVars}
                      className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 px-4 py-2"
                    >
                      <Save
                        className={cn(
                          "mr-2 h-4 w-4",
                          savingVars && "animate-spin"
                        )}
                      />
                      {savingVars ? "Salvando..." : "Salvar no Jira"}
                    </Button>
                  </div>
                </div>

                {varsBanner && (
                  <div
                    style={{
                      background: "#fff3cd",
                      color: "#856404",
                      padding: "10px 14px",
                      borderRadius: 8,
                      fontSize: 12,
                      marginBottom: 16,
                      borderLeft: "4px solid #ffeeba",
                    }}
                  >
                    <b>Atenção:</b> Você possui alterações não enviadas ao Jira.
                  </div>
                )}

                <div style={{ display: "grid", gap: 10 }}>
                  {chaves.map((row) => (
                    <div
                      key={row.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr 40px",
                        gap: 12,
                        padding: 10,
                        background: "#fff",
                        border: `1px solid ${
                          row.pendente ? "#ffeeba" : "#eee"
                        }`,
                        borderLeft: row.pendente
                          ? "4px solid #ffc107"
                          : "1px solid #eee",
                        borderRadius: 8,
                        alignItems: "center",
                      }}
                    >
                      <input
                        style={{
                          border: "none",
                          fontSize: 13,
                          fontWeight: 600,
                          outline: "none",
                        }}
                        placeholder="Ambiente"
                        value={row.ambiente}
                        onChange={(e) =>
                          updChave(row.id, { ambiente: e.target.value })
                        }
                      />
                      <input
                        style={{
                          border: "none",
                          fontSize: 13,
                          color: "#ee0000",
                          outline: "none",
                        }}
                        placeholder="Nome da chave"
                        value={row.nome}
                        onChange={(e) =>
                          updChave(row.id, { nome: e.target.value })
                        }
                      />
                      <input
                        style={{
                          border: "none",
                          fontSize: 13,
                          color: "#666",
                          outline: "none",
                        }}
                        placeholder="Valor"
                        value={row.valor}
                        onChange={(e) =>
                          updChave(row.id, { valor: e.target.value })
                        }
                      />
                      <button
                        onClick={() => rmChave(row.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#ccc",
                          cursor: "pointer",
                        }}
                      >
                        <i className="fas fa-trash-alt" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab: Evidências */}
            {activeTab === "evidencias" && (
              <div className="animate-fade-in">
                {/* Upload Zone */}
                <div
                  style={{
                    border: "2px dashed #eee",
                    padding: 24,
                    borderRadius: 12,
                    textAlign: "center",
                    background: "#fafafa",
                    marginBottom: 20,
                  }}
                >
                  <input
                    type="file"
                    multiple
                    ref={fileInputRef}
                    onChange={(e) =>
                      setPreviewFiles(Array.from(e.target.files || []))
                    }
                    style={{ display: "none" }}
                    id="upload-input"
                  />
                  <label htmlFor="upload-input" style={{ cursor: "pointer" }}>
                    <i
                      className="fas fa-cloud-upload-alt"
                      style={{ fontSize: 32, color: "#ccc", marginBottom: 10 }}
                    />
                    <div style={{ fontWeight: 600, color: "#555" }}>
                      Clique para anexar arquivos
                    </div>
                    <div style={{ fontSize: 12, color: "#999" }}>
                      Imagens, logs ou documentos
                    </div>
                  </label>
                </div>

                <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
                  <Button
                    type="button"
                    onClick={enviarArquivos}
                    disabled={uploading || !previewFiles.length}
                    aria-busy={uploading}
                    className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    <UploadCloud
                      className={cn(
                        "mr-2 h-4 w-4",
                        uploading && "animate-spin"
                      )}
                    />
                    {uploading ? "Enviando..." : "Enviar Selecionados"}
                  </Button>

                  <button
                    className="secondary"
                    onClick={limparPreview}
                    disabled={!previewFiles.length}
                  >
                    Limpar
                  </button>
                  <button
                    className="secondary"
                    onClick={listarAnexos}
                    style={{ marginLeft: "auto" }}
                  >
                    <i className="fas fa-sync" />
                  </button>
                </div>

                {/* Grid de Previews Locais */}
                {previewFiles.length > 0 && (
                  <div style={{ marginBottom: 30 }}>
                    <h4
                      style={{
                        fontSize: 13,
                        marginBottom: 12,
                        color: "#888",
                        textTransform: "uppercase",
                      }}
                    >
                      Prévia para Envio
                    </h4>
                    <div
                      style={{
                        display: "grid",
                        gap: 12,
                        gridTemplateColumns:
                          "repeat(auto-fill, minmax(200px, 1fr))",
                      }}
                    >
                      {previewFiles.map((f) => {
                        const isImg = /^image\//i.test(f.type);
                        const url = URL.createObjectURL(f);
                        return (
                          <div
                            key={f.name}
                            style={{
                              border: "1px solid #eee",
                              borderRadius: 10,
                              padding: 8,
                              background: "#fff",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 6,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  maxWidth: "140px",
                                }}
                              >
                                {f.name}
                              </span>
                              <i
                                className="fas fa-times"
                                onClick={() =>
                                  setPreviewFiles((prev) =>
                                    prev.filter((x) => x !== f)
                                  )
                                }
                                style={{ cursor: "pointer", color: "#ccc" }}
                              />
                            </div>
                            {isImg && (
                              <img
                                src={url}
                                style={{
                                  width: "100%",
                                  height: 100,
                                  objectFit: "cover",
                                  borderRadius: 6,
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Lista de Anexos no Jira */}
                <h4
                  style={{
                    fontSize: 13,
                    marginBottom: 12,
                    color: "#888",
                    textTransform: "uppercase",
                  }}
                >
                  Arquivos no Jira
                </h4>
                <div style={{ display: "grid", gap: 8 }}>
                  {!attachments.length ? (
                    <div
                      style={{
                        padding: 20,
                        textAlign: "center",
                        color: "#bbb",
                        fontSize: 13,
                      }}
                    >
                      Nenhum arquivo encontrado.
                    </div>
                  ) : (
                    attachments.map((a) => {
                      const links = buildDownloadLinks(a);
                      return (
                        <div
                          key={a.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            padding: "10px 16px",
                            background: "#fff",
                            border: "1px solid #eee",
                            borderRadius: 8,
                            gap: 12,
                          }}
                        >
                          <i
                            className={
                              a.mimeType?.includes("image")
                                ? "fas fa-image"
                                : "fas fa-file-alt"
                            }
                            style={{ color: "#aaa" }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>
                              {a.filename}
                            </div>
                            <div style={{ fontSize: 11, color: "#999" }}>
                              {(a.size / 1024).toFixed(1)} KB •{" "}
                              {new Date(a.created).toLocaleDateString()}
                            </div>
                          </div>
                          <a
                            href={links.download}
                            target="_blank"
                            style={{
                              fontSize: 12,
                              color: "#ee0000",
                              fontWeight: 600,
                              textDecoration: "none",
                            }}
                          >
                            Baixar
                          </a>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
            {/* Tab: Comentários */}
            {activeTab === "comentarios" && (
              <div className="animate-fade-in">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                    padding: "12px",
                    background: "#f8f9fa",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 13, color: "#666" }}>
                    <i className="fas fa-comments" style={{ marginRight: 6 }} />
                    {jiraCommentsList.length} comentário(s) no ticket
                  </div>

                  <button
                    className="secondary"
                    onClick={refreshJiraComments}
                    disabled={loadingJiraComments || !ticketJira.trim()}
                    style={{ padding: "8px 14px" }}
                    title={!ticketJira.trim() ? "Informe o ticket do Jira" : ""}
                  >
                    <i className="fas fa-sync" style={{ marginRight: 8 }} />
                    {loadingJiraComments ? "Atualizando..." : "Atualizar"}
                  </button>
                </div>

                {/* Novo comentário */}
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #eee",
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 14,
                  }}
                >
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 800,
                      marginBottom: 8,
                      color: "#333",
                    }}
                  >
                    Novo comentário
                  </label>

                  <textarea
                    value={newJiraCommentText}
                    onChange={(e) => setNewJiraCommentText(e.target.value)}
                    placeholder="Digite aqui o comentário que será adicionado no Jira..."
                    style={{
                      width: "100%",
                      minHeight: 90,
                      padding: 12,
                      borderRadius: 10,
                      border: "1px solid #e1e1e1",
                      outline: "none",
                      background: "#fcfcfc",
                      fontSize: 13,
                      lineHeight: "1.5",
                      resize: "vertical",
                    }}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        addJiraComment();
                      }
                    }}
                  />

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 10,
                      marginTop: 10,
                    }}
                  >
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => setNewJiraCommentText("")}
                      disabled={
                        postingJiraComment || !newJiraCommentText.trim()
                      }
                    >
                      Limpar
                    </button>

                    <Button
                      type="button"
                      onClick={addJiraComment}
                      disabled={
                        postingJiraComment ||
                        !ticketJira.trim() ||
                        !newJiraCommentText.trim()
                      }
                      aria-busy={postingJiraComment}
                      title={
                        !ticketJira.trim() ? "Informe o ticket do Jira" : ""
                      }
                      className="rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      <MessageSquarePlus
                        className={cn(
                          "mr-2 h-4 w-4",
                          postingJiraComment && "animate-spin"
                        )}
                      />
                      {postingJiraComment
                        ? "Enviando..."
                        : "Adicionar comentário no Jira"}
                    </Button>
                  </div>

                  <div style={{ marginTop: 8, fontSize: 11, color: "#999" }}>
                    Dica: Ctrl+Enter para enviar.
                  </div>
                </div>

                {/* Lista */}
                <div style={{ display: "grid", gap: 10 }}>
                  {!jiraCommentsList.length ? (
                    <div
                      style={{
                        padding: 20,
                        textAlign: "center",
                        color: "#bbb",
                        fontSize: 13,
                        border: "1px dashed #eee",
                        borderRadius: 12,
                        background: "#fff",
                      }}
                    >
                      Nenhum comentário para exibir.
                    </div>
                  ) : (
                    jiraCommentsList.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          background: "#fff",
                          border: "1px solid #eee",
                          borderRadius: 12,
                          padding: 12,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            alignItems: "baseline",
                          }}
                        >
                          <div style={{ fontWeight: 800, fontSize: 12 }}>
                            {c.author}
                          </div>
                          <div style={{ fontSize: 11, color: "#999" }}>
                            {fmtDateTimeBr(c.created)}
                          </div>
                        </div>

                        {c.updated && c.updated !== c.created && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 11,
                              color: "#aaa",
                            }}
                          >
                            Atualizado: {fmtDateTimeBr(c.updated)}
                          </div>
                        )}

                        <div
                          style={{
                            marginTop: 10,
                            fontSize: 13,
                            color: "#333",
                            whiteSpace: "pre-wrap",
                            lineHeight: "1.5",
                          }}
                        >
                          {c.text}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Rodapé */}
          <div className="botoes-finais">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-5 py-3 text-sm font-semibold text-white shadow-md transition
               hover:from-red-700 hover:to-red-800 hover:shadow-lg
               active:scale-[0.98]
               focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
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

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleSide}
              className="rounded-xl hover:bg-red-100"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </Button>
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
