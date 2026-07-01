import { useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Clipboard,
  Copy,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  generateBusinessHoursInserts,
  validateBusinessHoursConfig,
} from "@/utils/businessHoursInserts";

const MAPPED_URAS = [
  "RCV_PERFIL_1A8",
  "RCV_PERFIL_11A19",
  "RCV_PERFIL_9E10",
  "RCV_PERFIL_8",
  "URA_Inbursa",
  "URA_JURIDICO_MOVEL_0800",
  "URA_JURIDICO_NET_0800",
  "aceite_voz",
];

const EMPTY_RULE_FORM = {
  date: "",
  status: "CLOSED",
  startTime: "",
  endTime: "",
  targetUras: [],
};

function nextRuleId() {
  return `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function groupForUra(name) {
  const value = String(name || "").trim().toUpperCase();
  if (value.startsWith("RCV")) return "RCV";
  if (value.startsWith("URA")) return "URA";
  return "Outros";
}

function brDateToIso(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || "").trim());
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function isoDateToBr(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatRuleSummary(rule) {
  const hours = rule.startTime || rule.endTime
    ? `${rule.startTime || "--:--"} ate ${rule.endTime || "--:--"}`
    : "dia inteiro";
  return `${rule.date} - ${rule.status} - ${hours}`;
}

function formatRuleScope(rule) {
  const targetUras = Array.isArray(rule.targetUras) ? rule.targetUras : [];
  if (!targetUras.length) return "Todas as URAs selecionadas";
  if (targetUras.length === 1) return targetUras[0];
  return `${targetUras.length} URAs especificas`;
}

export default function BusinessHoursTool() {
  const [uras] = useState(MAPPED_URAS);
  const [selectedUras, setSelectedUras] = useState([]);
  const [rules, setRules] = useState([]);
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE_FORM);
  const [editingRuleId, setEditingRuleId] = useState("");
  const [generatedSql, setGeneratedSql] = useState("");
  const [validationErrors, setValidationErrors] = useState([]);

  const groupedUras = useMemo(() => {
    const groups = { RCV: [], URA: [], Outros: [] };
    uras.forEach((ura) => {
      groups[groupForUra(ura)].push(ura);
    });
    return groups;
  }, [uras]);

  const selectedCount = selectedUras.length;

  function toggleUra(ura) {
    setGeneratedSql("");
    setValidationErrors([]);
    setSelectedUras((current) =>
      current.includes(ura)
        ? current.filter((item) => item !== ura)
        : [...current, ura],
    );
  }

  function selectGroup(group) {
    const names = groupedUras[group] || [];
    setGeneratedSql("");
    setValidationErrors([]);
    setSelectedUras((current) => [...new Set([...current, ...names])]);
  }

  function clearGroup(group) {
    const names = new Set(groupedUras[group] || []);
    setGeneratedSql("");
    setValidationErrors([]);
    setSelectedUras((current) => current.filter((item) => !names.has(item)));
  }

  function resetRuleForm() {
    setRuleForm(EMPTY_RULE_FORM);
    setEditingRuleId("");
  }

  function toggleRuleTarget(ura) {
    setRuleForm((current) => {
      const targetUras = Array.isArray(current.targetUras) ? current.targetUras : [];
      return {
        ...current,
        targetUras: targetUras.includes(ura)
          ? targetUras.filter((item) => item !== ura)
          : [...targetUras, ura],
      };
    });
  }

  function useAllSelectedTargets() {
    setRuleForm((current) => ({ ...current, targetUras: [] }));
  }

  function submitRule(event) {
    event.preventDefault();
    const nextRule = {
      date: ruleForm.date.trim(),
      status: ruleForm.status,
      startTime: ruleForm.startTime.trim(),
      endTime: ruleForm.endTime.trim(),
      targetUras: Array.isArray(ruleForm.targetUras) ? ruleForm.targetUras : [],
    };
    const candidateRules = editingRuleId
      ? rules.map((rule) => (rule.id === editingRuleId ? { ...rule, ...nextRule } : rule))
      : [...rules, { id: nextRuleId(), ...nextRule }];
    const draftSelectedUras = selectedUras.length
      ? selectedUras
      : nextRule.targetUras.length
        ? nextRule.targetUras
        : ["PREVIEW_URA"];
    const validation = validateBusinessHoursConfig({
      selectedUras: draftSelectedUras,
      rules: candidateRules,
    });

    if (!validation.valid) {
      setValidationErrors(validation.errors);
      toast.error(validation.errors[0] || "Revise a regra.");
      return;
    }

    setRules(candidateRules);
    setGeneratedSql("");
    setValidationErrors([]);
    resetRuleForm();
    toast.success(editingRuleId ? "Regra atualizada." : "Regra adicionada.");
  }

  function editRule(rule) {
    setRuleForm({
      date: rule.date || "",
      status: rule.status || "CLOSED",
      startTime: rule.startTime || "",
      endTime: rule.endTime || "",
      targetUras: Array.isArray(rule.targetUras) ? rule.targetUras : [],
    });
    setEditingRuleId(rule.id);
  }

  function removeRule(ruleId) {
    setRules((current) => current.filter((rule) => rule.id !== ruleId));
    if (editingRuleId === ruleId) resetRuleForm();
    setGeneratedSql("");
    setValidationErrors([]);
  }

  function generateSql() {
    try {
      const sql = generateBusinessHoursInserts({ selectedUras, rules });
      setGeneratedSql(sql);
      setValidationErrors([]);
      toast.success("Inserts gerados.");
    } catch (err) {
      const errors = Array.isArray(err?.errors)
        ? err.errors
        : [err?.message || "Nao foi possivel gerar inserts."];
      setValidationErrors(errors);
      toast.error(errors[0]);
    }
  }

  async function copySql() {
    if (!generatedSql) {
      toast.error("Gere os inserts antes de copiar.");
      return;
    }

    try {
      await navigator.clipboard.writeText(generatedSql);
      toast.success("Inserts copiados.");
    } catch {
      toast.error("Nao foi possivel copiar para a area de transferencia.");
    }
  }

  function clearConfig() {
    setSelectedUras([]);
    setRules([]);
    setGeneratedSql("");
    setValidationErrors([]);
    resetRuleForm();
    toast.success("Configuracao limpa.");
  }

  return (
    <section className="grid gap-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-3 py-1 text-xs font-bold uppercase text-red-700">
              <CalendarClock className="h-3.5 w-3.5" />
              tb_bussinesshours
            </div>
            <h2 className="mt-3 text-xl font-bold text-zinc-950">
              Configuracao de Feriados / Fechamento de URAs
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-zinc-600">
              Monte datas especiais, valide as regras e copie os inserts SQL prontos.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
              {selectedCount} URA{selectedCount === 1 ? "" : "s"}
            </Badge>
            <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
              {rules.length} regra{rules.length === 1 ? "" : "s"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.95fr)_minmax(0,1.45fr)]">
        <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base text-zinc-900">URAs</CardTitle>
                <CardDescription>
                  Selecione uma ou varias URAs para duplicar a configuracao.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-zinc-200 bg-white"
                onClick={() => {
                  setSelectedUras(MAPPED_URAS);
                  setGeneratedSql("");
                  setValidationErrors([]);
                }}
              >
                Selecionar 8
              </Button>
            </div>
            <Badge className="mt-3 w-fit border border-emerald-200 bg-emerald-50 text-emerald-700">
              8 URAs mapeadas
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-3">
            {["RCV", "URA", "Outros"].map((group) => (
              <div key={group} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-zinc-900">{group}</div>
                    <Badge className="border border-zinc-200 bg-white text-zinc-600">
                      {groupedUras[group]?.length || 0}
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => selectGroup(group)}
                      disabled={!groupedUras[group]?.length}
                    >
                      Todos
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => clearGroup(group)}
                      disabled={!groupedUras[group]?.length}
                    >
                      Limpar
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  {groupedUras[group]?.length ? (
                    groupedUras[group].map((ura) => {
                      const checked = selectedUras.includes(ura);
                      return (
                        <label
                          key={ura}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition",
                            checked
                              ? "border-red-200 bg-white text-red-800"
                              : "border-zinc-200 bg-white text-zinc-700 hover:border-red-100",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleUra(ura)}
                            className="h-4 w-4 accent-red-600"
                          />
                          <span className="min-w-0 truncate font-medium">{ura}</span>
                        </label>
                      );
                    })
                  ) : (
                    <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-3 py-4 text-sm text-zinc-500">
                      Nenhuma URA neste grupo.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-zinc-900">Datas e horarios</CardTitle>
              <CardDescription>
                Adicione regras OPEN ou CLOSED para as URAs selecionadas.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <form onSubmit={submitRule} className="grid gap-3">
                <div className="grid gap-3 md:grid-cols-[1fr_150px_120px_120px]">
                  <Input
                    type="date"
                    value={brDateToIso(ruleForm.date)}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        date: isoDateToBr(event.target.value),
                      }))
                    }
                    className="rounded-xl"
                  />
                  <Select
                    value={ruleForm.status}
                    onValueChange={(value) =>
                      setRuleForm((current) => ({ ...current, status: value }))
                    }
                  >
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OPEN">OPEN</SelectItem>
                      <SelectItem value="CLOSED">CLOSED</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={ruleForm.startTime}
                    onChange={(event) =>
                      setRuleForm((current) => ({ ...current, startTime: event.target.value }))
                    }
                    placeholder="HH:MM"
                    className="rounded-xl"
                  />
                  <Input
                    value={ruleForm.endTime}
                    onChange={(event) =>
                      setRuleForm((current) => ({ ...current, endTime: event.target.value }))
                    }
                    placeholder="HH:MM"
                    className="rounded-xl"
                  />
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900">
                        Escopo da regra
                      </div>
                      <div className="text-xs text-zinc-500">
                        Deixe em branco para aplicar em todas as URAs selecionadas.
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-zinc-200 bg-white"
                      onClick={useAllSelectedTargets}
                      disabled={!ruleForm.targetUras?.length}
                    >
                      Todas selecionadas
                    </Button>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {selectedUras.length ? (
                      selectedUras.map((ura) => {
                        const checked = ruleForm.targetUras?.includes(ura);
                        return (
                          <label
                            key={ura}
                            className={cn(
                              "flex cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs transition",
                              checked
                                ? "border-red-200 text-red-800"
                                : "border-zinc-200 text-zinc-700 hover:border-red-100",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={!!checked}
                              onChange={() => toggleRuleTarget(ura)}
                              className="h-4 w-4 accent-red-600"
                            />
                            <span className="min-w-0 truncate font-medium">{ura}</span>
                          </label>
                        );
                      })
                    ) : (
                      <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-3 py-4 text-sm text-zinc-500 sm:col-span-2 xl:col-span-4">
                        Selecione URAs ao lado para restringir uma regra a URAs especificas.
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="submit" className="bg-red-600 text-white hover:bg-red-700">
                    {editingRuleId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {editingRuleId ? "Salvar regra" : "Adicionar regra"}
                  </Button>
                  {editingRuleId ? (
                    <Button type="button" variant="outline" onClick={resetRuleForm}>
                      Cancelar edicao
                    </Button>
                  ) : null}
                </div>
              </form>

              <div className="grid gap-2">
                {rules.length ? (
                  rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-900">
                          {formatRuleSummary(rule)}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {formatRuleScope(rule)}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Editar regra"
                          onClick={() => editRule(rule)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Remover regra"
                          className="border-red-200 text-red-700 hover:bg-red-50"
                          onClick={() => removeRule(rule.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-6 text-sm text-zinc-500">
                    Nenhuma regra adicionada.
                  </div>
                )}
              </div>

              {validationErrors.length ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {validationErrors.slice(0, 4).map((error) => (
                    <div key={error}>{error}</div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-base text-zinc-900">Inserts SQL</CardTitle>
                  <CardDescription>
                    Resultado gerado apenas para conferencia e copia manual.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="bg-red-600 text-white hover:bg-red-700"
                    onClick={generateSql}
                  >
                    <Clipboard className="h-4 w-4" />
                    Gerar Inserts
                  </Button>
                  <Button type="button" variant="outline" onClick={copySql}>
                    <Copy className="h-4 w-4" />
                    Copiar Inserts
                  </Button>
                  <Button type="button" variant="outline" onClick={clearConfig}>
                    <RotateCcw className="h-4 w-4" />
                    Limpar Configuracao
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Textarea
                value={generatedSql}
                readOnly
                placeholder="Os inserts gerados aparecerao aqui."
                className="min-h-[260px] rounded-2xl bg-zinc-950 font-mono text-xs leading-5 text-zinc-50 placeholder:text-zinc-500"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
