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

function FlowCanvas({
  nodes,
  edges,
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
      setEdges((eds) => addEdge({ ...params, id: uid("edge") }, eds));
      onConnectHook?.(params);
    },
    [setEdges, onConnectHook]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/automation-template");
      if (!raw) return;

      const tpl = JSON.parse(raw);
      const bounds = wrapperRef.current?.getBoundingClientRect();
      const position = project({
        x: event.clientX - (bounds?.left || 0),
        y: event.clientY - (bounds?.top || 0),
      });

      onDropTemplate?.(tpl, position);
    },
    [project, onDropTemplate]
  );

  return (
    <div
      ref={wrapperRef}
      className="h-[68vh] w-full"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={(sel) =>
          onSelectionChange?.(sel?.nodes?.[0] || null)
        }
        fitView
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
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

  const [selectedNode, setSelectedNode] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState(null);

  const onNodesChange = useCallback((changes) => {
    _setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

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
    setSelectedNode(null);
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

      const merged = mergeGraph({
        savedGraph: autoCfg?.graph || {},
        entityNodes,
      });
      setNodes(merged.nodes);
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
      return merged.nodes;
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
        },
      };

      const actionNode = {
        id: actionId,
        type: "actionNode",
        position: { x: baseX + 320, y: baseY + 140 },
        data: {
          name: preset.title.split("→")[1]?.trim() || "Ação",
          action: preset.action,
          preview:
            preset.action.type === "jira.comment"
              ? String(preset.action.params?.text || "").slice(0, 80)
              : `Transicionar → ${
                  preset.action.params?.toStatus || "(selecionar)"
                }`,
        },
      };

      const edge = { id: uid("edge"), source: triggerId, target: actionId };

      setNodes((ns) => [...ns, triggerNode, actionNode]);
      setEdges((es) => [...es, edge]);
    },
    [setNodes, setEdges, ticketKey]
  );

  const onDropTemplate = useCallback(
    (preset, position) => onPickTemplate(preset, position),
    [onPickTemplate]
  );

  // Conexões: trigger->action; trigger->entity (seta target no trigger)
  const onConnectHook = useCallback(
    (params) => {
      const src = params?.source;
      const tgt = params?.target;
      if (!src || !tgt) return;

      if (isTriggerNode(src) && isEntityNode(tgt)) {
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== src) return n;
            const triggerType =
              n.data?.trigger?.type || "ticket.status.changed";
            const p = { ...(n.data?.trigger?.params || {}) };

            if (tgt.startsWith("subtask:"))
              p.subtaskKey = tgt.replace("subtask:", "");
            if (tgt.startsWith("activity:"))
              p.activityId = tgt.replace("activity:", "");

            return {
              ...n,
              data: { ...n.data, trigger: { type: triggerType, params: p } },
            };
          })
        );
      }
    },
    [setNodes]
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
            <CardContent>
              {!ticketKey ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center text-sm text-zinc-600">
                  Selecione um ticket na esquerda para carregar
                  subtarefas/atividades e montar automações.
                </div>
              ) : (
                <FlowCanvas
                  nodes={nodes}
                  edges={edges}
                  setNodes={setNodes}
                  setEdges={setEdges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onSelectionChange={(n) => setSelectedNode(n)}
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
