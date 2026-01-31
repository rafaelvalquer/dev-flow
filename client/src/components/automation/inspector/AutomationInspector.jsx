// src/components/automation/inspector/AutomationInspector.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import {
  Check,
  ChevronsUpDown,
  Loader2,
  Trash2,
  UserX,
  ChevronDown,
  Link2Off,
} from "lucide-react";

import {
  TRIGGER_TYPES,
  ACTION_TYPES,
} from "@/components/automation/automationTemplates";

import { searchAssignableUsers } from "@/services/automationApi";
import { cn } from "@/lib/utils";

/* -----------------------
  Helpers
----------------------- */
function initials(name) {
  const s = String(name || "").trim();
  if (!s) return "??";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

function statusTone(execStatus) {
  if (execStatus === "success")
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (execStatus === "error") return "border-red-200 bg-red-50 text-red-800";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function Section({ title, description, defaultOpen = true, children }) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-2xl border border-zinc-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900">{title}</div>
          {description ? (
            <div className="mt-0.5 text-[11px] text-zinc-600">
              {description}
            </div>
          ) : null}
        </div>
        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 transition group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

function SelectNative({
  value,
  onChange,
  options,
  placeholder = "Selecione...",
}) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn(
        "h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900",
        "focus:outline-none focus:ring-2 focus:ring-zinc-200"
      )}
    >
      <option value="">{placeholder}</option>
      {(options || []).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TextareaNative({ value, onChange, className, placeholder }) {
  return (
    <textarea
      value={value || ""}
      placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn(
        "min-h-[120px] w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900",
        "focus:outline-none focus:ring-2 focus:ring-zinc-200",
        className
      )}
    />
  );
}

/* -----------------------
  Component
----------------------- */
export default function AutomationInspector({
  selectedNode,
  setNodes,
  subtasks,
  activities,
  transitions,
  ticketKey,
  onLinkEntity,
  onUnlinkEntity,
  onDeleteNode,
}) {
  const nodeKind = useMemo(() => {
    const id = String(selectedNode?.id || "");
    if (id.startsWith("trigger:")) return "trigger";
    if (id.startsWith("action:")) return "action";
    if (id.startsWith("subtask:")) return "subtask";
    if (id.startsWith("activity:")) return "activity";
    if (id.startsWith("gate:")) return "gate";
    return "unknown";
  }, [selectedNode?.id]);

  const triggerType = selectedNode?.data?.trigger?.type || "";
  const actionType = selectedNode?.data?.action?.type || "";

  const execStatus = String(selectedNode?.data?.execStatus || "").trim();
  const execAt = selectedNode?.data?.execAt || "";
  const lastEventKey = selectedNode?.data?.lastEventKey || "";

  const patchNodeData = useCallback(
    (patch) => {
      if (!selectedNode?.id) return;
      const id = selectedNode.id;

      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== id) return n;
          return {
            ...n,
            data: {
              ...(n.data || {}),
              ...(patch || {}),
            },
          };
        })
      );
    },
    [selectedNode?.id, setNodes]
  );

  /* -----------------------
    Trigger target helper (optional quick unlink)
  ----------------------- */
  const triggerParams = selectedNode?.data?.trigger?.params || {};
  const targetSummary = useMemo(() => {
    if (nodeKind !== "trigger") return null;

    // single
    const subtaskKey = triggerParams?.subtaskKey;
    const activityId = triggerParams?.activityId;

    // multi
    const subtaskKeys = Array.isArray(triggerParams?.subtaskKeys)
      ? triggerParams.subtaskKeys
      : null;
    const activityIds = Array.isArray(triggerParams?.activityIds)
      ? triggerParams.activityIds
      : null;

    if (subtaskKeys?.length)
      return `Subtarefas (${subtaskKeys.length}): ${subtaskKeys.join(", ")}`;
    if (activityIds?.length)
      return `Atividades (${activityIds.length}): ${activityIds.join(", ")}`;

    if (subtaskKey) return `Subtarefa: ${subtaskKey}`;
    if (activityId) return `Atividade: ${activityId}`;
    return "Nenhum alvo vinculado.";
  }, [nodeKind, triggerParams]);

  /* -----------------------
    Jira Assign UI
  ----------------------- */
  const params = selectedNode?.data?.action?.params || {};

  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerQuery, setOwnerQuery] = useState("");
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerOptions, setOwnerOptions] = useState([]);

  const ownerSelected = useMemo(() => {
    if (nodeKind !== "action" || actionType !== "jira.assign") return null;
    const accountId = params?.accountId;
    if (!accountId) return null;
    return {
      accountId,
      displayName: params?.displayName || "",
      emailAddress: params?.emailAddress || "",
      avatarUrl: params?.avatarUrl || "",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKind, actionType, selectedNode?.id, params?.accountId]);

  useEffect(() => {
    // reset query on node change
    setOwnerQuery("");
    setOwnerOptions([]);
    setOwnerOpen(false);
    setOwnerLoading(false);
  }, [selectedNode?.id]);

  useEffect(() => {
    if (nodeKind !== "action") return;
    if (actionType !== "jira.assign") return;

    const q = String(ownerQuery || "").trim();
    if (q.length < 2) {
      setOwnerOptions([]);
      return;
    }

    let alive = true;
    const t = setTimeout(async () => {
      setOwnerLoading(true);
      try {
        // endpoint retorna array direto OU { users: [] }
        const data = await searchAssignableUsers(ticketKey, q, 20);
        if (!alive) return;

        const users = Array.isArray(data)
          ? data
          : Array.isArray(data?.users)
          ? data.users
          : [];

        const mapped = users.map((u) => ({
          accountId: u.accountId,
          displayName: u.displayName || u.name || "",
          emailAddress: u.emailAddress || "",
          avatarUrl:
            u.avatarUrls?.["48x48"] ||
            u.avatarUrls?.["24x24"] ||
            u.avatarUrl ||
            "",
        }));

        setOwnerOptions(mapped);
      } catch (e) {
        if (!alive) return;
        setOwnerOptions([]);
      } finally {
        if (alive) setOwnerLoading(false);
      }
    }, 250);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [ownerQuery, nodeKind, actionType, ticketKey]);

  const setAssignee = useCallback(
    (uOrNull) => {
      const u = uOrNull || null;

      patchNodeData({
        action: {
          type: "jira.assign",
          params: u
            ? {
                accountId: u.accountId,
                displayName: u.displayName,
                emailAddress: u.emailAddress || "",
                avatarUrl: u.avatarUrl || "",
              }
            : {
                accountId: null,
                displayName: "",
                emailAddress: "",
                avatarUrl: "",
              },
        },
        preview: u
          ? `Responsável → ${u.displayName}`
          : "Responsável → Sem responsável",
      });
    },
    [patchNodeData]
  );

  /* -----------------------
    Empty state
  ----------------------- */
  if (!selectedNode) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        Selecione um node no flow para editar.
      </div>
    );
  }

  const isEditable = nodeKind === "trigger" || nodeKind === "action";
  const title =
    nodeKind === "trigger"
      ? "Gatilho"
      : nodeKind === "action"
      ? "Ação"
      : nodeKind === "subtask"
      ? "Subtarefa"
      : nodeKind === "activity"
      ? "Atividade"
      : nodeKind === "gate"
      ? "Gate (AND)"
      : "Node";

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-zinc-900">{title}</div>

              {nodeKind === "trigger" || nodeKind === "action" ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                    statusTone(execStatus)
                  )}
                  title={execStatus ? `Status: ${execStatus}` : "Sem execução"}
                >
                  {execStatus === "success"
                    ? "Sucesso"
                    : execStatus === "error"
                    ? "Erro"
                    : "Pendente"}
                </span>
              ) : null}
            </div>

            <div className="mt-1 text-[11px] text-zinc-600">
              ID: <span className="font-mono">{selectedNode.id}</span>
            </div>

            {(execAt || lastEventKey) &&
            (nodeKind === "trigger" || nodeKind === "action") ? (
              <div className="mt-2 grid gap-1 text-[11px] text-zinc-600">
                {execAt ? (
                  <div>
                    Última execução:{" "}
                    <span className="font-medium text-zinc-800">
                      {String(execAt)}
                    </span>
                  </div>
                ) : null}
                {lastEventKey ? (
                  <div className="truncate">
                    Evento:{" "}
                    <span className="font-mono">{String(lastEventKey)}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {isEditable ? (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => onDeleteNode?.(selectedNode.id)}
              title="Remover node"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remover
            </Button>
          ) : null}
        </div>
      </div>

      {/* Editable blocks */}
      {nodeKind === "trigger" ? (
        <Section title="Geral" description="Configurações básicas do gatilho.">
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs text-zinc-500">Nome</div>
              <Input
                value={selectedNode.data?.name || ""}
                onChange={(e) => patchNodeData({ name: e.target.value })}
                className="rounded-xl"
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-zinc-900">Ativo</div>
                <div className="text-[11px] text-zinc-600">
                  Se desativado, a regra não executa.
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-zinc-800">
                <input
                  type="checkbox"
                  checked={!!selectedNode.data?.enabled}
                  onChange={(e) => patchNodeData({ enabled: e.target.checked })}
                />
              </label>
            </div>
          </div>
        </Section>
      ) : null}

      {nodeKind === "trigger" ? (
        <Section title="Trigger" description="Tipo e parâmetros do gatilho.">
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs text-zinc-500">Tipo de gatilho</div>
              <SelectNative
                value={triggerType}
                onChange={(v) =>
                  patchNodeData({
                    trigger: { type: v, params: {} },
                  })
                }
                options={TRIGGER_TYPES.map((t) => ({
                  value: t.key,
                  label: t.label,
                }))}
              />
              <div className="mt-1 text-[11px] text-zinc-600">
                Dica: conecte o gatilho em uma Ação e (opcionalmente) em
                Subtarefa/Atividade no canvas.
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-zinc-900">
                    Alvo
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-600">
                    {targetSummary}
                  </div>
                </div>

                {typeof onUnlinkEntity === "function" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => onUnlinkEntity?.(selectedNode.id)}
                    title="Desvincular alvo do gatilho"
                  >
                    <Link2Off className="mr-2 h-4 w-4" />
                    Desvincular
                  </Button>
                ) : null}
              </div>

              <div className="mt-3 rounded-xl bg-zinc-50 p-3 text-[11px] text-zinc-700">
                Params atuais:{" "}
                <span className="font-mono">
                  {JSON.stringify(
                    selectedNode.data?.trigger?.params || {},
                    null,
                    0
                  )}
                </span>
              </div>
            </div>

            {/* Quick link helper (optional) */}
            {typeof onLinkEntity === "function" ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs font-semibold text-zinc-900">
                  Vincular alvo rapidamente
                </div>
                <div className="mt-1 text-[11px] text-zinc-600">
                  (Opcional) Você também pode vincular arrastando/conectando no
                  canvas. Aqui é um atalho.
                </div>

                <div className="mt-3 grid gap-2">
                  <SelectNative
                    value=""
                    onChange={(v) => {
                      if (!v) return;
                      onLinkEntity?.(selectedNode.id, v);
                    }}
                    placeholder="Selecionar uma subtarefa…"
                    options={(subtasks || []).map((s) => ({
                      value: `subtask:${s.jiraKey || s.key || s.id || ""}`,
                      label: `${s.jiraKey || s.key || s.id || "—"} — ${
                        s.title || s.summary || ""
                      }`,
                    }))}
                  />

                  <SelectNative
                    value=""
                    onChange={(v) => {
                      if (!v) return;
                      onLinkEntity?.(selectedNode.id, v);
                    }}
                    placeholder="Selecionar uma atividade…"
                    options={(activities || []).map((a) => ({
                      value: `activity:${a.id || a.activityId || a.key || ""}`,
                      label: `${a.name || a.title || a.id || "—"}`,
                    }))}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {nodeKind === "action" ? (
        <Section title="Geral" description="Configurações básicas da ação.">
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs text-zinc-500">Nome</div>
              <Input
                value={selectedNode.data?.name || ""}
                onChange={(e) => patchNodeData({ name: e.target.value })}
                className="rounded-xl"
              />
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              <div className="text-xs font-semibold text-zinc-900">Preview</div>
              <div className="mt-1 text-[11px] text-zinc-700">
                {selectedNode.data?.preview || "—"}
              </div>
            </div>
          </div>
        </Section>
      ) : null}

      {nodeKind === "action" ? (
        <Section title="Action" description="Tipo e parâmetros da ação.">
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs text-zinc-500">Tipo de ação</div>
              <SelectNative
                value={actionType}
                onChange={(v) =>
                  patchNodeData({
                    action: { type: v, params: {} },
                    preview: "",
                  })
                }
                options={ACTION_TYPES.map((t) => ({
                  value: t.key,
                  label: t.label,
                }))}
              />
            </div>

            {/* jira.comment */}
            {actionType === "jira.comment" ? (
              <div>
                <div className="mb-1 text-xs text-zinc-500">
                  Texto do comentário
                </div>
                <TextareaNative
                  value={selectedNode.data?.action?.params?.text || ""}
                  onChange={(v) =>
                    patchNodeData({
                      action: { type: "jira.comment", params: { text: v } },
                      preview: String(v || "").slice(0, 80),
                    })
                  }
                  placeholder="Escreva o comentário…"
                />
                <div className="mt-1 text-[11px] text-zinc-600">
                  Você pode usar variáveis (ex.: {"{ticketKey}"}).
                </div>
              </div>
            ) : null}

            {/* jira.transition */}
            {actionType === "jira.transition" ? (
              <div>
                <div className="mb-1 text-xs text-zinc-500">Status alvo</div>
                <SelectNative
                  value={selectedNode.data?.action?.params?.toStatus || ""}
                  onChange={(v) =>
                    patchNodeData({
                      action: {
                        type: "jira.transition",
                        params: { toStatus: v },
                      },
                      preview: `Transicionar → ${v || "(selecionar)"}`,
                    })
                  }
                  options={(transitions || []).map((t) => ({
                    value: t.name,
                    label: t.name,
                  }))}
                />
              </div>
            ) : null}

            {/* jira.assign */}
            {actionType === "jira.assign" ? (
              <div className="space-y-2">
                <div className="text-xs text-zinc-500">
                  Responsável (Assignee)
                </div>

                <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={ownerOpen}
                      className="h-10 w-full justify-between rounded-xl border-zinc-200 bg-white text-sm text-zinc-900 hover:bg-zinc-50"
                    >
                      <span className="min-w-0 flex-1 truncate text-left">
                        {ownerSelected?.displayName
                          ? ownerSelected.displayName
                          : params?.accountId === null
                          ? "Sem responsável"
                          : "(selecionar responsável)"}
                      </span>

                      {ownerLoading ? (
                        <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin text-zinc-500" />
                      ) : (
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-zinc-500" />
                      )}
                    </Button>
                  </PopoverTrigger>

                  <PopoverContent
                    align="start"
                    className="w-[420px] max-w-[calc(100vw-3rem)] rounded-2xl border-zinc-200 p-2"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        value={ownerQuery}
                        onValueChange={setOwnerQuery}
                        placeholder="Buscar responsável no Jira... (mín. 2 letras)"
                      />

                      <CommandList className="max-h-[260px]">
                        <CommandEmpty>
                          {ownerLoading
                            ? "Buscando..."
                            : String(ownerQuery || "").trim().length < 2
                            ? "Digite 2 ou mais caracteres para buscar."
                            : "Nenhum usuário encontrado."}
                        </CommandEmpty>

                        <CommandGroup heading="Opções">
                          <CommandItem
                            value="__none__"
                            onSelect={() => {
                              setAssignee(null);
                              setOwnerOpen(false);
                            }}
                            className="rounded-xl"
                          >
                            <span className="flex items-center gap-2">
                              <UserX className="h-4 w-4 text-zinc-500" />
                              <span className="text-sm font-medium text-zinc-800">
                                Sem responsável
                              </span>
                            </span>

                            {params?.accountId === null ? (
                              <Check className="ml-auto h-4 w-4 text-emerald-600" />
                            ) : null}
                          </CommandItem>

                          {ownerOptions.map((u) => {
                            const selected =
                              (params?.accountId || "") === (u.accountId || "");

                            return (
                              <CommandItem
                                key={u.accountId}
                                value={u.displayName}
                                onSelect={() => {
                                  setAssignee(u);
                                  setOwnerOpen(false);
                                }}
                                className="rounded-xl"
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  <Avatar className="h-7 w-7 border border-zinc-200">
                                    {u.avatarUrl ? (
                                      <AvatarImage
                                        src={u.avatarUrl}
                                        alt="avatar"
                                      />
                                    ) : null}
                                    <AvatarFallback className="bg-zinc-100 text-[10px] text-zinc-700">
                                      {initials(u.displayName)}
                                    </AvatarFallback>
                                  </Avatar>

                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-zinc-900">
                                      {u.displayName}
                                    </div>
                                    {u.emailAddress ? (
                                      <div className="truncate text-[11px] text-zinc-500">
                                        {u.emailAddress}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>

                                {selected ? (
                                  <Check className="ml-2 h-4 w-4 text-emerald-600" />
                                ) : null}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                <div className="text-[11px] text-zinc-600">
                  A busca usa “assignable users” do Jira para o ticket atual.
                </div>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {/* Read-only entities */}
      {nodeKind === "subtask" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
              Subtarefa
            </Badge>
          </div>
          <div className="mt-2 text-sm font-semibold text-zinc-900">
            {selectedNode.data?.title || selectedNode.data?.summary || "—"}
          </div>
          <div className="mt-1 text-[11px] text-zinc-600">
            JiraKey: {selectedNode.data?.jiraKey || "—"}
          </div>
        </div>
      ) : null}

      {nodeKind === "activity" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
              Atividade
            </Badge>
          </div>
          <div className="mt-2 text-sm font-semibold text-zinc-900">
            {selectedNode.data?.name || "—"}
          </div>
          <div className="mt-1 text-[11px] text-zinc-600">
            ID: {selectedNode.data?.id || "—"}
          </div>
        </div>
      ) : null}

      {nodeKind === "gate" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <Badge className="border border-orange-200 bg-orange-50 text-orange-800">
              Gate (AND)
            </Badge>
          </div>

          <div className="mt-2 text-[11px] text-zinc-600">
            Alvos conectados:
          </div>

          <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[11px] text-zinc-700">
            <span className="font-mono">
              {JSON.stringify(selectedNode.data?.targets || [], null, 0)}
            </span>
          </div>
        </div>
      ) : null}

      {/* Fallback */}
      {nodeKind === "unknown" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          Node não reconhecido pelo Inspector.
        </div>
      ) : null}

      {/* small spacing */}
      <Separator className="my-1" />
    </div>
  );
}
