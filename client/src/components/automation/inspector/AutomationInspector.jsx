// src/components/automation/inspector/AutomationInspector.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

import { Check, ChevronsUpDown, Loader2, Trash2, UserX } from "lucide-react";

import {
  TRIGGER_TYPES,
  ACTION_TYPES,
} from "@/components/automation/automationTemplates";
import { searchAssignableUsers } from "@/services/automationApi";

function initials(name) {
  const s = String(name || "").trim();
  if (!s) return "??";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

function SelectNative({ value, onChange, placeholder, options }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange?.(e.target.value)}
      className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none hover:bg-zinc-50"
    >
      <option value="" disabled>
        {placeholder || "Selecione..."}
      </option>
      {(options || []).map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

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
    return "unknown";
  }, [selectedNode?.id]);

  const triggerType = selectedNode?.data?.trigger?.type || "";
  const actionType = selectedNode?.data?.action?.type || "";

  const patchNodeData = (patch) => {
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
  };

  // ============================
  // UI "Alterar responsável" (jira.assign)
  // ============================
  const params = selectedNode?.data?.action?.params || {};

  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerQuery, setOwnerQuery] = useState("");
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerOptions, setOwnerOptions] = useState([]);

  const ownerSelected = useMemo(() => {
    if (nodeKind !== "action" || actionType !== "jira.assign") return null;
    const accountId = params?.accountId || "";
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
        const data = await searchAssignableUsers(ticketKey, q, 20);
        if (!alive) return;

        // ✅ FIX: aceita tanto array direto quanto { users: [...] }
        const rawUsers = Array.isArray(data)
          ? data
          : Array.isArray(data?.users)
          ? data.users
          : [];

        const mapped = rawUsers.map((u) => ({
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

  function setAssignee(uOrNull) {
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
  }

  // ============================

  if (!selectedNode) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        Selecione um node no flow para editar.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900">
            {nodeKind === "trigger"
              ? "Gatilho"
              : nodeKind === "action"
              ? "Ação"
              : nodeKind === "subtask"
              ? "Subtarefa"
              : nodeKind === "activity"
              ? "Atividade"
              : "Node"}
          </div>

          <div className="mt-1 text-[11px] text-zinc-600">
            ID: <span className="font-mono">{selectedNode.id}</span>
          </div>
        </div>

        {(nodeKind === "trigger" || nodeKind === "action") && (
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => onDeleteNode?.(selectedNode.id)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Remover
          </Button>
        )}
      </div>

      <Separator className="my-3" />

      {/* =========================
          TRIGGER
      ========================== */}
      {nodeKind === "trigger" ? (
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-zinc-500">Nome</div>
            <Input
              value={selectedNode.data?.name || ""}
              onChange={(e) => patchNodeData({ name: e.target.value })}
              className="rounded-xl"
            />
          </div>

          <div>
            <div className="mb-1 text-xs text-zinc-500">Tipo de gatilho</div>
            <SelectNative
              value={triggerType}
              placeholder="Selecione..."
              options={TRIGGER_TYPES.map((t) => ({
                key: t.key,
                label: t.label,
              }))}
              onChange={(v) =>
                patchNodeData({
                  trigger: { type: v, params: {} },
                })
              }
            />
          </div>

          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[11px] text-zinc-700">
            Params atuais:{" "}
            <span className="font-mono">
              {JSON.stringify(
                selectedNode.data?.trigger?.params || {},
                null,
                0
              )}
            </span>
          </div>

          <div className="text-[11px] text-zinc-600">
            Conecte este gatilho em uma Ação e (opcionalmente) em
            Subtarefa/Atividade.
          </div>
        </div>
      ) : null}

      {/* =========================
          ACTION
      ========================== */}
      {nodeKind === "action" ? (
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-zinc-500">Nome</div>
            <Input
              value={selectedNode.data?.name || ""}
              onChange={(e) => patchNodeData({ name: e.target.value })}
              className="rounded-xl"
            />
          </div>

          <div>
            <div className="mb-1 text-xs text-zinc-500">Tipo de ação</div>
            <SelectNative
              value={actionType}
              placeholder="Selecione..."
              options={ACTION_TYPES.map((t) => ({
                key: t.key,
                label: t.label,
              }))}
              onChange={(v) =>
                patchNodeData({
                  action: { type: v, params: {} },
                  preview: "",
                })
              }
            />
          </div>

          {/* jira.comment */}
          {actionType === "jira.comment" ? (
            <div>
              <div className="mb-1 text-xs text-zinc-500">
                Texto do comentário
              </div>
              <Textarea
                value={selectedNode.data?.action?.params?.text || ""}
                onChange={(e) =>
                  patchNodeData({
                    action: {
                      type: "jira.comment",
                      params: { text: e.target.value },
                    },
                    preview: String(e.target.value || "").slice(0, 80),
                  })
                }
                className="min-h-[120px] rounded-xl"
              />
              <div className="mt-1 text-[11px] text-zinc-500">
                Você pode usar variáveis (ex.: {"{ticketKey}"}).
              </div>
            </div>
          ) : null}

          {/* jira.transition */}
          {actionType === "jira.transition" ? (
            <div>
              <div className="mb-1 text-xs text-zinc-500">Status alvo</div>
              <select
                value={selectedNode.data?.action?.params?.toStatus || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  patchNodeData({
                    action: {
                      type: "jira.transition",
                      params: { toStatus: v },
                    },
                    preview: `Transicionar → ${v || "(selecionar)"}`,
                  });
                }}
                className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none hover:bg-zinc-50"
              >
                <option value="" disabled>
                  Selecione...
                </option>
                {(transitions || []).map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
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

              <div className="text-[11px] text-zinc-500">
                Dica: a busca usa “assignable users” do Jira para este ticket.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* =========================
          ENTITY (somente leitura)
      ========================== */}
      {nodeKind === "subtask" ? (
        <div className="space-y-2">
          <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
            Subtarefa
          </Badge>
          <div className="text-sm font-semibold text-zinc-900">
            {selectedNode.data?.title || "—"}
          </div>
          <div className="text-[11px] text-zinc-600">
            JiraKey: {selectedNode.data?.jiraKey || "—"}
          </div>
        </div>
      ) : null}

      {nodeKind === "activity" ? (
        <div className="space-y-2">
          <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
            Atividade
          </Badge>
          <div className="text-sm font-semibold text-zinc-900">
            {selectedNode.data?.name || "—"}
          </div>
          <div className="text-[11px] text-zinc-600">
            ID: {selectedNode.data?.id || "—"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
