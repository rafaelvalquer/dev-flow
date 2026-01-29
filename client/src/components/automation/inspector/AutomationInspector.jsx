import React, { useMemo } from "react";
import { TRIGGER_TYPES, ACTION_TYPES } from "../automationTemplates";
import { isTriggerNode, isActionNode } from "../flowModel";

function labelOf(list, key) {
  return list.find((x) => x.key === key)?.label || key;
}

export default function AutomationInspector({
  selectedNode,
  setNodes,
  subtasks,
  activities,
  transitions,
  ticketKey,
}) {
  const isTrigger = isTriggerNode(selectedNode?.id);
  const isAction = isActionNode(selectedNode?.id);

  const subtaskOptions = useMemo(() => {
    return (subtasks || [])
      .map((s) => ({
        key: s.jiraKey || s.id,
        label: `${s.title}${s.jiraKey ? ` (${s.jiraKey})` : ""}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [subtasks]);

  const activityOptions = useMemo(() => {
    return (activities || []).map((a) => ({
      key: a.id,
      label: `${a.name} (${a.id})`,
    }));
  }, [activities]);

  function patchNodeData(patch) {
    if (!selectedNode?.id) return;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === selectedNode.id ? { ...n, data: { ...n.data, ...patch } } : n
      )
    );
  }

  if (!selectedNode) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        Selecione um node para editar.
      </div>
    );
  }

  if (!isTrigger && !isAction) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        Node informativo. Regras editáveis são “Gatilho” e “Ação”.
      </div>
    );
  }

  if (isTrigger) {
    const triggerType =
      selectedNode.data?.trigger?.type || "ticket.status.changed";
    const params = selectedNode.data?.trigger?.params || {};
    const enabled = selectedNode.data?.enabled !== false;

    return (
      <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
        <div>
          <div className="text-xs font-semibold text-zinc-900">Regra</div>
          <input
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-300"
            value={selectedNode.data?.name || ""}
            onChange={(e) => patchNodeData({ name: e.target.value })}
            placeholder="Nome da regra"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => patchNodeData({ enabled: e.target.checked })}
            />
            Habilitada
          </label>
        </div>

        <div>
          <div className="text-xs font-semibold text-zinc-900">
            Tipo de gatilho
          </div>
          <select
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-300"
            value={triggerType}
            onChange={(e) =>
              patchNodeData({
                trigger: { type: e.target.value, params: {} },
              })
            }
          >
            {TRIGGER_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="mt-1 text-[11px] text-zinc-600">
            {labelOf(TRIGGER_TYPES, triggerType)}
          </div>
        </div>

        {triggerType.startsWith("subtask.") ? (
          <div>
            <div className="text-xs font-semibold text-zinc-900">Subtarefa</div>
            <select
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-300"
              value={params.subtaskKey || ""}
              onChange={(e) =>
                patchNodeData({
                  trigger: {
                    type: triggerType,
                    params: { ...params, subtaskKey: e.target.value },
                  },
                })
              }
            >
              <option value="">(selecionar)</option>
              {subtaskOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>

            {triggerType === "subtask.overdue" ? (
              <div className="mt-2">
                <div className="text-xs font-semibold text-zinc-900">
                  Data limite (YYYY-MM-DD)
                </div>
                <input
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-300"
                  value={params.dueDate || ""}
                  onChange={(e) =>
                    patchNodeData({
                      trigger: {
                        type: triggerType,
                        params: { ...params, dueDate: e.target.value },
                      },
                    })
                  }
                  placeholder="2026-01-31"
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {triggerType.startsWith("ticket.status.") ? (
          <div>
            <div className="text-xs font-semibold text-zinc-900">
              Status alvo
            </div>
            <select
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-300"
              value={params.status || ""}
              onChange={(e) =>
                patchNodeData({
                  trigger: {
                    type: triggerType,
                    params: { ...params, status: e.target.value },
                  },
                })
              }
            >
              <option value="">(selecionar)</option>
              {(transitions || []).map((t) => (
                <option key={t.to?.name || t.id} value={t.to?.name || ""}>
                  {t.to?.name || t.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {triggerType.startsWith("activity.") ? (
          <div>
            <div className="text-xs font-semibold text-zinc-900">
              Atividade (cronograma)
            </div>
            <select
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-300"
              value={params.activityId || ""}
              onChange={(e) =>
                patchNodeData({
                  trigger: {
                    type: triggerType,
                    params: { ...params, activityId: e.target.value },
                  },
                })
              }
            >
              <option value="">(selecionar)</option>
              {activityOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[11px] text-zinc-700">
          Variáveis disponíveis (comentários):{" "}
          {
            "{ticketKey} {subtaskTitle} {subtaskKey} {activityName} {activityId} {activityStart} {activityEnd} {prevStatus} {currentStatus} {dueDate}"
          }
        </div>

        <div className="text-[11px] text-zinc-500">
          Ticket:{" "}
          <span className="font-semibold text-zinc-700">{ticketKey}</span>
        </div>
      </div>
    );
  }

  // ACTION
  const actionType = selectedNode.data?.action?.type || "jira.comment";
  const params = selectedNode.data?.action?.params || {};

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
      <div>
        <div className="text-xs font-semibold text-zinc-900">Ação</div>
        <input
          className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-300"
          value={selectedNode.data?.name || ""}
          onChange={(e) => patchNodeData({ name: e.target.value })}
          placeholder="Nome da ação"
        />
      </div>

      <div>
        <div className="text-xs font-semibold text-zinc-900">Tipo de ação</div>
        <select
          className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-300"
          value={actionType}
          onChange={(e) =>
            patchNodeData({ action: { type: e.target.value, params: {} } })
          }
        >
          {ACTION_TYPES.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      {actionType === "jira.comment" ? (
        <div>
          <div className="text-xs font-semibold text-zinc-900">
            Texto do comentário
          </div>
          <textarea
            rows={6}
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-300"
            value={params.text || ""}
            onChange={(e) =>
              patchNodeData({
                action: {
                  type: actionType,
                  params: { ...params, text: e.target.value },
                },
              })
            }
            placeholder="Ex.: Subtarefa concluída: {subtaskTitle}"
          />
        </div>
      ) : null}

      {actionType === "jira.transition" ? (
        <div>
          <div className="text-xs font-semibold text-zinc-900">
            Status destino
          </div>
          <select
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-300"
            value={params.toStatus || ""}
            onChange={(e) =>
              patchNodeData({
                action: {
                  type: actionType,
                  params: { ...params, toStatus: e.target.value },
                },
              })
            }
          >
            <option value="">(selecionar)</option>
            {(transitions || []).map((t) => (
              <option key={t.to?.name || t.id} value={t.to?.name || ""}>
                {t.to?.name || t.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[11px] text-zinc-700">
        Preview (comentário): use variáveis como {"{ticketKey}"} /{" "}
        {"{currentStatus}"}.
      </div>
    </div>
  );
}
