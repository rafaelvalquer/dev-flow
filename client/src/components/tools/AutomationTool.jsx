import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
} from "reactflow";

import "reactflow/dist/style.css";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import TicketNode from "@/components/automation/nodes/TicketNode";
import SubtaskNode from "@/components/automation/nodes/SubtaskNode";
import ActivityNode from "@/components/automation/nodes/ActivityNode";
import TriggerNode from "@/components/automation/nodes/TriggerNode";
import ActionNode from "@/components/automation/nodes/ActionNode";

import AutomationTemplates from "@/components/automation/palette/AutomationTemplates";
import AutomationInspector from "@/components/automation/inspector/AutomationInspector";

import {
  listTickets,
  getTicketKanban,
  getTicketCronograma,
  getTicketTransitions,
} from "@/services/ticketsApi";
import {
  getAutomation,
  saveAutomation,
  dryRunAutomation,
} from "@/services/automationApi";

import {
  uid,
  buildEntityNodes,
  mergeGraph,
  flattenKanbanSubtasks,
  buildRulesFromFlow,
  validateFlow,
  normalizeTicketKey,
  isEntityNode,
  isTriggerNode,
  isActionNode,
} from "@/components/automation/flowModel";

const nodeTypes = {
  ticketNode: TicketNode,
  subtaskNode: SubtaskNode,
  activityNode: ActivityNode,
  triggerNode: TriggerNode,
  actionNode: ActionNode,
};

function indexRuleExecutions(executions) {
  const out = {}; // { [ruleId]: { status, executedAt, eventKey, ts } }

  for (const e of executions || []) {
    const ruleId = String(e?.ruleId || "").trim();
    if (!ruleId) continue;

    const status = String(e?.status || "").trim(); // "success" | "error" ...
    const executedAt = e?.executedAt || e?.at || e?.createdAt || null;
    const ts = executedAt ? new Date(executedAt).getTime() : 0;

    const prev = out[ruleId];
    if (!prev || ts >= (prev.ts || 0)) {
      out[ruleId] = {
        status,
        executedAt,
        eventKey: e?.eventKey || "",
        ts,
      };
    }
  }

  return out;
}

function applyExecToNodes(nodes, execIndex) {
  const idx = execIndex || {};
  return (nodes || []).map((n) => {
    if (n?.type !== "triggerNode" && n?.type !== "actionNode") return n;

    const ruleId = String(n?.data?.ruleId || "").trim();
    const info = ruleId ? idx[ruleId] : null;

    const execStatus = info?.status || ""; // "success" | "error" | ""
    const executed = execStatus === "success";
    const execAt = info?.executedAt || "";
    const lastEventKey = info?.eventKey || "";

    // evita recriar objeto se não mudou
    const prev = n?.data || {};
    if (
      prev.executed === executed &&
      prev.execStatus === execStatus &&
      prev.execAt === execAt &&
      prev.lastEventKey === lastEventKey
    ) {
      return n;
    }

    return {
      ...n,
      data: {
        ...prev,
        executed,
        execStatus,
        execAt,
        lastEventKey,
      },
    };
  });
}

function FlowCanvas({
  nodes,
  edges,
  nodeTypes,
  setNodes,
  onNodesChange,
  onEdgesChange,
  setEdges,
  onSelectionChange,
  onDropTemplate,
  onConnectHook,
}) {
  const wrapperRef = useRef(null);
  const { project } = useReactFlow();

  const onConnect = useCallback(
    (params) => {
      // Quando o connect é "trigger -> entity", o hook centraliza consistência (params + edge única).
      const handled = onConnectHook?.(params);
      if (handled) return;

      setEdges((eds) => addEdge({ ...params, id: uid("edge") }, eds));
    },
    [setEdges, onConnectHook]
  );

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const bounds = wrapperRef.current?.getBoundingClientRect();
      const type = event.dataTransfer.getData("application/reactflow");
      const raw = event.dataTransfer.getData("application/json");
      if (!type) return;

      const tpl = raw ? JSON.parse(raw) : null;

      const position = project({
        x: event.clientX - (bounds?.left || 0),
        y: event.clientY - (bounds?.top || 0),
      });

      onDropTemplate?.({ type, position, template: tpl });
    },
    [project, onDropTemplate]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleSelectionChange = useCallback(
    (payload) => {
      // Fonte de verdade fica no AutomationTool: aqui só repassamos o payload.
      onSelectionChange?.(payload || { nodes: [], edges: [] });
    },
    [onSelectionChange]
  );

  return (
    <div ref={wrapperRef} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onSelectionChange={handleSelectionChange}
        onPaneClick={() => handleSelectionChange({ nodes: [], edges: [] })}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default function AutomationTool() {
  const [tickets, setTickets] = useState([]);
  const [q, setQ] = useState("");
  const [loadingTickets, setLoadingTickets] = useState(false);

  const [selectedTicket, setSelectedTicket] = useState(null);
  const ticketKey = normalizeTicketKey(
    selectedTicket?.ticketKey || selectedTicket?.key
  );

  const [kanbanSubtasks, setKanbanSubtasks] = useState([]);
  const [cronogramaAtividades, setCronogramaAtividades] = useState([]);
  const [transitions, setTransitions] = useState([]);

  const [loadingTicketData, setLoadingTicketData] = useState(false);

  const [showSubtasks, setShowSubtasks] = useState(true);
  const [showActivities, setShowActivities] = useState(true);

  const [nodes, _setNodes] = useState([]);
  const [edges, _setEdges] = useState([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.9 });

  const [selectedNodeId, setSelectedNodeId] = useState(null);

  const execIndexRef = useRef({});

  // NOTE: Evita "stale selectedNode".
  // Fonte de verdade é o array `nodes`; o Inspector deriva o node atual via selectedNodeId.
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  const [validationErrors, setValidationErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState(null);

  const onNodesChange = useCallback(
    (changes) => {
      const removeIds = (changes || [])
        .filter((c) => c.type === "remove")
        .map((c) => c.id);

      if (removeIds.length) {
        const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

        // Permite deletar apenas Trigger/Action. Entidades não são deletáveis.
        const allowedRemove = removeIds.filter((id) => {
          const n = byId[id];
          return isTriggerNode(n?.id) || isActionNode(n?.id);
        });

        const removeSet = new Set(allowedRemove);

        // Cascata: deletou Trigger => deleta ActionNodes do mesmo ruleId
        const ruleIds = allowedRemove
          .map((id) => byId[id])
          .filter((n) => isTriggerNode(n?.id))
          .map((n) => n?.data?.ruleId)
          .filter(Boolean);

        if (ruleIds.length) {
          for (const n of nodes) {
            if (isActionNode(n?.id) && ruleIds.includes(n.data?.ruleId)) {
              removeSet.add(n.id);
            }
          }
        }

        if (selectedNodeId && removeSet.has(selectedNodeId)) {
          setSelectedNodeId(null);
        }

        const nonRemove = (changes || []).filter((c) => c.type !== "remove");

        _setNodes((prev) => {
          let next = applyNodeChanges(nonRemove, prev);
          next = next.filter((n) => !removeSet.has(n.id));
          return next;
        });

        _setEdges((prev) =>
          prev.filter(
            (e) => !removeSet.has(e.source) && !removeSet.has(e.target)
          )
        );

        return;
      }

      _setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [nodes, selectedNodeId, _setNodes, _setEdges]
  );

  const onEdgesChange = useCallback((changes) => {
    _setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  // wrappers compat com ReactFlow onNodesChange/onEdgesChange
  const setNodes = useCallback((updater) => {
    _setNodes((prev) =>
      typeof updater === "function" ? updater(prev) : updater
    );
  }, []);
  const setEdges = useCallback((updater) => {
    _setEdges((prev) =>
      typeof updater === "function" ? updater(prev) : updater
    );
  }, []);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoadingTickets(true);
      try {
        const data = await listTickets({ q });
        if (!mounted) return;
        setTickets(Array.isArray(data?.tickets) ? data.tickets : []);
      } catch (e) {
        if (!mounted) return;
        setTickets([]);
      } finally {
        if (mounted) setLoadingTickets(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [q]);

  async function selectTicket(t) {
    setSelectedTicket(t);
    setSelectedNodeId(null);
    setDryRunResult(null);
    setValidationErrors([]);
    if (!t?.ticketKey && !t?.key) return;

    const tk = normalizeTicketKey(t.ticketKey || t.key);
    setLoadingTicketData(true);

    try {
      const [autoCfg, kanbanPayload, cronPayload, transitionsPayload] =
        await Promise.all([
          getAutomation(tk),
          getTicketKanban(tk),
          getTicketCronograma(tk),
          getTicketTransitions(tk),
        ]);

      const subtasks = flattenKanbanSubtasks(kanbanPayload);
      const activities = Array.isArray(cronPayload?.atividades)
        ? cronPayload.atividades
        : [];

      setKanbanSubtasks(subtasks);
      setCronogramaAtividades(activities);
      setTransitions(
        Array.isArray(transitionsPayload?.transitions)
          ? transitionsPayload.transitions
          : []
      );

      const entityNodes = buildEntityNodes({
        ticket: {
          ticketKey: tk,
          summary: t.summary || "",
          status: t.status || "",
          assignee: t.assignee || "",
        },
        subtasks,
        activities,
        showSubtasks,
        showActivities,
      });

      const execIndex = indexRuleExecutions(autoCfg?.executions || []);
      execIndexRef.current = execIndex;

      const merged = mergeGraph({
        savedGraph: autoCfg?.graph || {},
        entityNodes,
      });

      setNodes(applyExecToNodes(merged.nodes, execIndex));
      setEdges(merged.edges);
      setViewport(merged.viewport || { x: 0, y: 0, zoom: 0.9 });
    } finally {
      setLoadingTicketData(false);
    }
  }

  // Rebuild entity nodes when toggles change
  useEffect(() => {
    if (!ticketKey) return;
    setNodes((prev) => {
      const entityNodes = buildEntityNodes({
        ticket: {
          ticketKey,
          summary: selectedTicket?.summary || "",
          status: selectedTicket?.status || "",
          assignee: selectedTicket?.assignee || "",
        },
        subtasks: kanbanSubtasks,
        activities: cronogramaAtividades,
        showSubtasks,
        showActivities,
      });

      const saved = { nodes: prev, edges, viewport };
      const merged = mergeGraph({ savedGraph: saved, entityNodes });
      return applyExecToNodes(merged.nodes, execIndexRef.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSubtasks, showActivities]);

  const entityCount = useMemo(() => {
    const st = showSubtasks ? kanbanSubtasks.length : 0;
    const ac = showActivities ? cronogramaAtividades.length : 0;
    return { st, ac };
  }, [
    kanbanSubtasks.length,
    cronogramaAtividades.length,
    showSubtasks,
    showActivities,
  ]);

  const onPickTemplate = useCallback(
    (preset, pos) => {
      if (!ticketKey) return;
      const ruleId = uid("rule").replace("rule:", "");
      const triggerId = `trigger:${ruleId}`;
      const actionId = `action:${ruleId}:0`;

      const baseX = pos?.x ?? 0;
      const baseY = pos?.y ?? 420;

      const triggerNode = {
        id: triggerId,
        type: "triggerNode",
        position: { x: baseX, y: baseY },
        data: {
          ruleId,
          name: preset.title,
          enabled: true,
          trigger: preset.trigger,
          conditions: {},
          hint: "Conecte em uma ação (e opcionalmente ao node alvo).",
          executed: false,
          execStatus: "",
          execAt: "",
          lastEventKey: "",
        },
      };

      const actionNode = {
        id: actionId,
        type: "actionNode",
        position: { x: baseX + 320, y: baseY + 140 },
        data: {
          ruleId, // <- importante
          name: preset.title.split("→")[1]?.trim() || "Ação",
          action: preset.action,
          preview:
            preset.action.type === "jira.comment"
              ? String(preset.action.params?.text || "").slice(0, 80)
              : `Transicionar → ${
                  preset.action.params?.toStatus || "(selecionar)"
                }`,
          executed: false,
          execStatus: "",
          execAt: "",
          lastEventKey: "",
        },
      };

      const edge = { id: uid("edge"), source: triggerId, target: actionId };

      setNodes((ns) => [...ns, triggerNode, actionNode]);
      setEdges((es) => [...es, edge]);
      setSelectedNodeId(triggerId);
    },
    [setNodes, setEdges, ticketKey, setSelectedNodeId]
  );

  const onDropTemplate = useCallback(
    (preset, position) => onPickTemplate(preset, position),
    [onPickTemplate]
  );

  const isEntityId = useCallback((id) => {
    const s = String(id || "");
    return s.startsWith("subtask:") || s.startsWith("activity:");
  }, []);

  // Conexões: trigger->action; trigger->entity (seta target no trigger)
  const linkTriggerToEntity = useCallback(
    ({ triggerId, entityId }) => {
      const trgId = String(triggerId || "");
      const entId = String(entityId || "");

      // 1) Atualiza params do Trigger (mantém como está)
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== trgId) return n;
          if (!isTriggerNode(n?.id)) return n;

          const prevTrig = n.data?.trigger || {};
          const prevParams = prevTrig.params || {};
          const nextParams = { ...prevParams };

          delete nextParams.subtaskKey;
          delete nextParams.activityId;

          if (entId.startsWith("subtask:")) {
            nextParams.subtaskKey = entId.slice("subtask:".length);
          } else if (entId.startsWith("activity:")) {
            nextParams.activityId = entId.slice("activity:".length);
          }

          return {
            ...n,
            data: {
              ...n.data,
              trigger: { ...prevTrig, params: nextParams },
            },
          };
        })
      );

      // 2) Edge única: Entity -> Trigger (para cair no handle de ENTRADA do Trigger)
      setEdges((prev) => {
        const entityEdgeId = `edge:triggerEntity:${trgId}`;

        // remove edge antigo (Trigger->Entity) e o novo (Entity->Trigger) deste trigger
        let next = prev.filter(
          (e) =>
            !(
              (
                (e.source === trgId && isEntityId(e.target)) || // antigo
                (e.target === trgId && isEntityId(e.source))
              ) // novo
            ) && e.id !== entityEdgeId
        );

        if (!entId) return next;

        const exists = nodes.some((n) => n.id === entId);
        if (!exists) return next;

        next.push({
          id: entityEdgeId,
          source: entId, // <- entity sai
          target: trgId, // <- trigger entra
        });

        return next;
      });
    },
    [setNodes, setEdges, nodes, isEntityId]
  );

  const unlinkTriggerEntity = useCallback(
    (triggerId) => linkTriggerToEntity({ triggerId, entityId: "" }),
    [linkTriggerToEntity]
  );

  const deleteNodesById = useCallback(
    (ids) => {
      const removeSet = new Set((ids || []).map(String).filter(Boolean));
      if (!removeSet.size) return;

      // Regra: ao deletar Trigger, deletar ActionNodes do mesmo ruleId
      const triggerRuleIds = [];
      for (const n of nodes) {
        if (removeSet.has(n.id) && isTriggerNode(n.id)) {
          if (n.data?.ruleId) triggerRuleIds.push(n.data.ruleId);
        }
      }
      if (triggerRuleIds.length) {
        for (const n of nodes) {
          if (isActionNode(n.id) && triggerRuleIds.includes(n.data?.ruleId)) {
            removeSet.add(n.id);
          }
        }
      }

      if (selectedNodeId && removeSet.has(selectedNodeId)) {
        setSelectedNodeId(null);
      }

      setNodes((prev) => prev.filter((n) => !removeSet.has(n.id)));
      setEdges((prev) =>
        prev.filter((e) => !removeSet.has(e.source) && !removeSet.has(e.target))
      );
    },
    [nodes, selectedNodeId, setNodes, setEdges]
  );

  // Conexões: trigger->action; trigger->entity (params+edge única)
  const onConnectHook = useCallback(
    (params) => {
      const sourceId = params?.source;
      const targetId = params?.target;
      if (!sourceId || !targetId) return false;

      const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
      const sourceNode = byId[sourceId];
      const targetNode = byId[targetId];

      if (isTriggerNode(sourceId) && isEntityNode(targetId)) {
        linkTriggerToEntity({ triggerId: sourceId, entityId: targetId });
        return true;
      }
      if (isEntityNode(sourceId) && isTriggerNode(targetId)) {
        linkTriggerToEntity({ triggerId: targetId, entityId: sourceId });
        return true;
      }

      return false;
    },
    [nodes, linkTriggerToEntity]
  );

  const rules = useMemo(() => buildRulesFromFlow(nodes, edges), [nodes, edges]);

  async function onValidate() {
    const errs = validateFlow(nodes, edges);
    setValidationErrors(errs);
    return errs;
  }

  async function onSave() {
    if (!ticketKey) return;
    const errs = await onValidate();
    if (errs.length) return;

    setSaving(true);
    try {
      // salva o graph inteiro (inclui entity nodes) para reabrir igual;
      // backend pode manter e também armazenar "rules" canônico
      const payload = {
        enabled: true,
        graph: { nodes, edges, viewport },
        rules,
      };

      await saveAutomation(ticketKey, payload);
    } finally {
      setSaving(false);
    }
  }

  async function onDryRun() {
    if (!ticketKey) return;
    const errs = await onValidate();
    if (errs.length) return;

    setDryRunning(true);
    try {
      const r = await dryRunAutomation(ticketKey, rules);
      setDryRunResult(r);
    } finally {
      setDryRunning(false);
    }
  }

  const filteredTickets = useMemo(() => {
    const qq = String(q || "")
      .trim()
      .toLowerCase();
    if (!qq) return tickets;
    return tickets.filter((t) => {
      const s = `${t.ticketKey || ""} ${t.summary || ""} ${t.status || ""} ${
        t.assignee || ""
      }`.toLowerCase();
      return s.includes(qq);
    });
  }, [tickets, q]);

  return (
    <ReactFlowProvider>
      <div className="grid gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <Badge className="border border-red-200 bg-red-50 text-red-700">
              Automação
            </Badge>
            {ticketKey ? (
              <span className="text-sm text-zinc-700">
                Ticket selecionado:{" "}
                <span className="font-semibold">{ticketKey}</span>
              </span>
            ) : (
              <span className="text-sm text-zinc-600">
                Selecione um ticket para montar automações.
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={onValidate}
              disabled={!ticketKey}
            >
              Validar
            </Button>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={onDryRun}
              disabled={!ticketKey || dryRunning}
            >
              {dryRunning ? "Dry-run…" : "Executar teste (dry-run)"}
            </Button>
            <Button
              className="rounded-xl bg-red-600 hover:bg-red-700"
              onClick={onSave}
              disabled={!ticketKey || saving}
            >
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>

        {validationErrors.length ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <div className="font-semibold">Validação</div>
            <ul className="mt-1 list-disc pl-5">
              {validationErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_360px]">
          {/* LEFT */}
          <Card className="rounded-2xl border-zinc-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tickets</CardTitle>
              <div className="mt-2">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por key, resumo, status…"
                  className="rounded-xl"
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-600">
                <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5">
                  {loadingTickets
                    ? "Carregando…"
                    : `${filteredTickets.length} tickets`}
                </span>
                <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5">
                  Subtarefas: {entityCount.st}
                </span>
                <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5">
                  Atividades: {entityCount.ac}
                </span>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={showSubtasks}
                    onChange={(e) => setShowSubtasks(e.target.checked)}
                  />
                  Subtarefas
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={showActivities}
                    onChange={(e) => setShowActivities(e.target.checked)}
                  />
                  Atividades
                </label>
              </div>

              <Separator />

              <div className="max-h-[36vh] overflow-auto pr-1">
                <div className="space-y-2">
                  {filteredTickets.map((t) => {
                    const tk = normalizeTicketKey(t.ticketKey || t.key);
                    const active = tk && tk === ticketKey;
                    return (
                      <button
                        key={tk}
                        type="button"
                        onClick={() => selectTicket(t)}
                        className={cn(
                          "w-full rounded-2xl border px-3 py-2 text-left transition",
                          "hover:bg-zinc-50",
                          active
                            ? "border-red-200 bg-red-50"
                            : "border-zinc-200 bg-white"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-zinc-900">
                              {tk}
                            </div>
                            <div className="mt-0.5 line-clamp-2 text-xs text-zinc-600">
                              {t.summary || "—"}
                            </div>
                          </div>
                          {t.status ? (
                            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700">
                              {t.status}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Separator />

              <div>
                <div className="mb-2 text-xs font-semibold text-zinc-900">
                  Templates
                </div>
                <AutomationTemplates
                  onPickTemplate={(p) => onPickTemplate(p)}
                />
                <div className="mt-2 text-[11px] text-zinc-600">
                  Dica: você pode{" "}
                  <span className="font-semibold">arrastar</span> um template
                  para o canvas.
                </div>
              </div>
            </CardContent>
          </Card>

          {/* CENTER */}
          <Card className="rounded-2xl border-zinc-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Flow</CardTitle>
                {loadingTicketData ? (
                  <span className="text-sm text-zinc-600">
                    Carregando ticket…
                  </span>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="h-[70vh] min-h-[520px]">
              {!ticketKey ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center text-sm text-zinc-600">
                  Selecione um ticket na esquerda para carregar
                  subtarefas/atividades e montar automações.
                </div>
              ) : (
                <FlowCanvas
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  setNodes={setNodes}
                  setEdges={setEdges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onSelectionChange={({ nodes: selNodes } = {}) =>
                    setSelectedNodeId(selNodes?.[0]?.id || null)
                  }
                  onDropTemplate={onDropTemplate}
                  onConnectHook={onConnectHook}
                />
              )}

              {dryRunResult ? (
                <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-3 text-sm text-zinc-800">
                  <div className="font-semibold">Dry-run</div>
                  <pre className="mt-2 max-h-[220px] overflow-auto rounded-xl bg-zinc-50 p-3 text-[11px]">
                    {JSON.stringify(dryRunResult, null, 2)}
                  </pre>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* RIGHT */}
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-900">
                  Inspector
                </div>
                {ticketKey ? (
                  <span className="text-[11px] text-zinc-600">
                    {rules.length} regras
                  </span>
                ) : null}
              </div>

              <AutomationInspector
                selectedNode={selectedNode}
                setNodes={setNodes}
                subtasks={kanbanSubtasks}
                activities={cronogramaAtividades}
                transitions={transitions}
                ticketKey={ticketKey}
                onLinkEntity={(triggerId, entityId) =>
                  linkTriggerToEntity({ triggerId, entityId })
                }
                onUnlinkEntity={(triggerId) => unlinkTriggerEntity(triggerId)}
                onDeleteNode={(nodeId) => deleteNodesById([nodeId])}
              />
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-[11px] text-zinc-600">
              <div className="font-semibold text-zinc-900">
                Conexões suportadas
              </div>
              <ul className="mt-2 list-disc pl-5">
                <li>Gatilho → Ação (executa ação quando trigger disparar)</li>
                <li>
                  Gatilho → Subtarefa/Atividade (preenche alvo automaticamente)
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
