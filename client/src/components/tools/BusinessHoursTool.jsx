import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Clipboard,
  Copy,
  Database,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
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
import {
  getCdrAuthStatus,
  loginCdrPortal,
  logoutCdrPortal,
  verifyBusinessHours,
} from "@/lib/cdr";
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

const DATABASE_OPTIONS = [
  { value: "P00HU1", label: "URA.P00HU1" },
  { value: "P00HU2", label: "URA.P00HU2" },
  { value: "P00HU3", label: "URA.P00HU3" },
  { value: "P00HU3_URACLOUD", label: "URACLOUD.P00HU3" },
  { value: "P00HU3_URACEC", label: "URA_CEC.P00HU3" },
  { value: "P01CT2", label: "AVAYAREP.P01CT2" },
  { value: "CSPORA", label: "ICDIVR.CSPORA" },
  { value: "MSPORA", label: "RPT.MSPORA" },
  { value: "AWS_ROTEAMENTO", label: "AWS Roteamento" },
];

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

function numberBr(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
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

function FieldLabel({ children }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </span>
  );
}

function SummaryCard({ title, value }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-medium text-zinc-500">{title}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-950">{numberBr(value)}</p>
    </div>
  );
}

function coverageLabel(status) {
  if (status === "multiple_rules") return "Multiplas regras";
  if (status === "configured") return "Configurado";
  return "Ausente";
}

function coverageBadgeClass(status) {
  if (status === "multiple_rules") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "configured") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

export default function BusinessHoursTool() {
  const [uras] = useState(MAPPED_URAS);
  const [selectedUras, setSelectedUras] = useState([]);
  const [rules, setRules] = useState([]);
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE_FORM);
  const [editingRuleId, setEditingRuleId] = useState("");
  const [generatedSql, setGeneratedSql] = useState("");
  const [validationErrors, setValidationErrors] = useState([]);
  const [portalSession, setPortalSession] = useState(null);
  const [portalBooting, setPortalBooting] = useState(true);
  const [portalLoginForm, setPortalLoginForm] = useState({ username: "", password: "" });
  const [portalError, setPortalError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [database, setDatabase] = useState("AWS_ROTEAMENTO");
  const [verifyDate, setVerifyDate] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  const groupedUras = useMemo(() => {
    const groups = { RCV: [], URA: [], Outros: [] };
    uras.forEach((ura) => {
      groups[groupForUra(ura)].push(ura);
    });
    return groups;
  }, [uras]);

  const selectedCount = selectedUras.length;

  useEffect(() => {
    let active = true;

    async function loadPortalStatus() {
      setPortalBooting(true);
      try {
        const result = await getCdrAuthStatus();
        if (active) setPortalSession(result.authenticated ? result.session : null);
      } catch (err) {
        if (active) {
          setPortalError(err?.message || "Nao foi possivel verificar a sessao Portal ICC.");
        }
      } finally {
        if (active) setPortalBooting(false);
      }
    }

    loadPortalStatus();
    return () => {
      active = false;
    };
  }, []);

  function toggleUra(ura) {
    setGeneratedSql("");
    setVerifyResult(null);
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
    setVerifyResult(null);
    setValidationErrors([]);
    setSelectedUras((current) => [...new Set([...current, ...names])]);
  }

  function clearGroup(group) {
    const names = new Set(groupedUras[group] || []);
    setGeneratedSql("");
    setVerifyResult(null);
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

  async function handlePortalLogin(event) {
    event.preventDefault();
    setLoggingIn(true);
    setPortalError("");

    try {
      const result = await loginCdrPortal(portalLoginForm);
      setPortalSession(result.session || null);
      setPortalLoginForm((current) => ({ ...current, password: "" }));
      toast.success("Login Portal ICC realizado.");
    } catch (err) {
      setPortalSession(null);
      setPortalError(err?.message || "Nao foi possivel autenticar no Portal ICC.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handlePortalLogout() {
    setLoggingOut(true);
    setPortalError("");

    try {
      await logoutCdrPortal();
      setPortalSession(null);
      setVerifyResult(null);
      toast.success("Sessao Portal ICC encerrada.");
    } catch (err) {
      setPortalError(err?.message || "Nao foi possivel encerrar a sessao Portal ICC.");
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleVerifyBusinessHours(event) {
    event.preventDefault();

    if (!portalSession) {
      setPortalError("Faca login no Portal ICC antes de verificar.");
      toast.error("Faca login no Portal ICC antes de verificar.");
      return;
    }

    if (!verifyDate) {
      setPortalError("Informe a data da configuracao.");
      toast.error("Informe a data da configuracao.");
      return;
    }

    if (!selectedUras.length) {
      setPortalError("Selecione pelo menos uma URA para verificar.");
      toast.error("Selecione pelo menos uma URA para verificar.");
      return;
    }

    setVerifying(true);
    setPortalError("");
    setVerifyResult(null);

    try {
      const result = await verifyBusinessHours({
        database,
        date: verifyDate,
        uras: selectedUras,
      });
      setVerifyResult(result);
      toast.success("Verificacao concluida.");
    } catch (err) {
      const message = err?.message || "Nao foi possivel verificar no Portal ICC.";
      setPortalError(message);
      if (err?.code === "PORTAL_SESSION_EXPIRED" || err?.status === 401) {
        setPortalSession(null);
        toast.warning("Sessao Portal ICC expirada. Faca login novamente.");
      } else {
        toast.error(message);
      }
    } finally {
      setVerifying(false);
    }
  }

  function clearConfig() {
    setSelectedUras([]);
    setRules([]);
    setGeneratedSql("");
    setValidationErrors([]);
    setVerifyResult(null);
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

      {portalBooting ? (
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          <Loader2 className="h-4 w-4 animate-spin text-red-600" />
          Verificando sessao Portal ICC...
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.5fr)]">
          <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-zinc-50 text-red-600">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base text-zinc-900">Portal ICC</CardTitle>
                      <Badge
                        className={cn(
                          "border",
                          portalSession
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-zinc-200 bg-zinc-50 text-zinc-600",
                        )}
                      >
                        {portalSession ? "Sessao ativa" : "Login necessario"}
                      </Badge>
                    </div>
                    <CardDescription className="truncate">
                      {portalSession
                        ? `${portalSession?.username || "Usuario"} - verificacao habilitada`
                        : "Use o mesmo login das ferramentas CDR e Busca Tarefas."}
                    </CardDescription>
                  </div>
                </div>

                {portalSession ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePortalLogout}
                    disabled={loggingOut}
                  >
                    {loggingOut ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LogOut className="h-4 w-4" />
                    )}
                    Sair do ICC
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {!portalSession ? (
                <form onSubmit={handlePortalLogin} className="grid gap-3">
                  <label className="grid gap-1">
                    <FieldLabel>Usuario</FieldLabel>
                    <Input
                      value={portalLoginForm.username}
                      onChange={(event) =>
                        setPortalLoginForm((current) => ({
                          ...current,
                          username: event.target.value,
                        }))
                      }
                      placeholder="Ex: Z000000"
                      autoComplete="username"
                    />
                  </label>
                  <label className="grid gap-1">
                    <FieldLabel>Senha</FieldLabel>
                    <Input
                      type="password"
                      value={portalLoginForm.password}
                      onChange={(event) =>
                        setPortalLoginForm((current) => ({
                          ...current,
                          password: event.target.value,
                        }))
                      }
                      placeholder="Senha Portal ICC"
                      autoComplete="current-password"
                    />
                  </label>
                  <Button type="submit" disabled={loggingIn}>
                    {loggingIn ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="h-4 w-4" />
                    )}
                    Entrar
                  </Button>
                </form>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  Sessao pronta para consultar relatorios customizados.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-zinc-900">Verificar configuracao</CardTitle>
              <CardDescription>
                Consulte a tabela TB_BUSSINESSHOURS para a data e URAs selecionadas.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <form
                onSubmit={handleVerifyBusinessHours}
                className="grid gap-3 lg:grid-cols-[minmax(180px,240px)_minmax(160px,200px)_auto]"
              >
                <label className="grid gap-1">
                  <FieldLabel>Banco</FieldLabel>
                  <Select
                    value={database}
                    onValueChange={(value) => {
                      setDatabase(value);
                      setVerifyResult(null);
                    }}
                  >
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Banco" />
                    </SelectTrigger>
                    <SelectContent>
                      {DATABASE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="grid gap-1">
                  <FieldLabel>Data</FieldLabel>
                  <Input
                    type="date"
                    value={brDateToIso(verifyDate)}
                    onChange={(event) => {
                      setVerifyDate(isoDateToBr(event.target.value));
                      setVerifyResult(null);
                    }}
                    className="rounded-xl"
                  />
                </label>

                <div className="flex items-end">
                  <Button
                    type="submit"
                    className="w-full bg-red-600 text-white hover:bg-red-700 lg:w-auto"
                    disabled={!portalSession || !verifyDate || !selectedUras.length || verifying}
                  >
                    {verifying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    Verificar no Portal ICC
                  </Button>
                </div>
              </form>

              <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                <div className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <Database className="h-3.5 w-3.5 text-red-600" />
                  {DATABASE_OPTIONS.find((option) => option.value === database)?.label || database}
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                  {selectedUras.length} URA{selectedUras.length === 1 ? "" : "s"} selecionada
                  {selectedUras.length === 1 ? "" : "s"}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {portalError ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{portalError}</span>
        </div>
      ) : null}

      {verifyResult ? (
        <Card className="rounded-2xl border-zinc-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base text-zinc-900">
                  Resultado da verificacao
                </CardTitle>
                <CardDescription>
                  {verifyResult.date} em {verifyResult.database}
                </CardDescription>
              </div>
              <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
                {verifyResult.checkedAt
                  ? new Date(verifyResult.checkedAt).toLocaleString("pt-BR")
                  : "Consulta concluida"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard title="Selecionadas" value={verifyResult.summary?.selected} />
              <SummaryCard title="Configuradas" value={verifyResult.summary?.configured} />
              <SummaryCard title="Ausentes" value={verifyResult.summary?.missing} />
              <SummaryCard title="Linhas encontradas" value={verifyResult.summary?.rows} />
            </div>

            <div className="grid gap-3">
              {(verifyResult.coverage || []).map((item) => (
                <div
                  key={item.ura}
                  className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-semibold text-zinc-900">
                      {item.ura}
                    </div>
                    <Badge className={cn("border", coverageBadgeClass(item.status))}>
                      {coverageLabel(item.status)}
                    </Badge>
                  </div>

                  {item.rows?.length ? (
                    <div className="mt-3 overflow-auto rounded-xl border border-zinc-200 bg-white">
                      <table className="min-w-[620px] border-collapse text-left text-xs">
                        <thead className="bg-zinc-100 text-zinc-700">
                          <tr>
                            <th className="border-b border-zinc-200 px-3 py-2 font-semibold">
                              Data
                            </th>
                            <th className="border-b border-zinc-200 px-3 py-2 font-semibold">
                              Abertura
                            </th>
                            <th className="border-b border-zinc-200 px-3 py-2 font-semibold">
                              Fechamento
                            </th>
                            <th className="border-b border-zinc-200 px-3 py-2 font-semibold">
                              Status
                            </th>
                            <th className="border-b border-zinc-200 px-3 py-2 font-semibold">
                              Dia semana
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.rows.map((row, index) => (
                            <tr key={`${item.ura}-${index}`} className="odd:bg-white even:bg-zinc-50">
                              <td className="border-b border-zinc-100 px-3 py-2 text-zinc-700">
                                {row.data || "-"}
                              </td>
                              <td className="border-b border-zinc-100 px-3 py-2 text-zinc-700">
                                {row.abertura || "-"}
                              </td>
                              <td className="border-b border-zinc-100 px-3 py-2 text-zinc-700">
                                {row.fechamento || "-"}
                              </td>
                              <td className="border-b border-zinc-100 px-3 py-2 text-zinc-700">
                                {row.status || "-"}
                              </td>
                              <td className="border-b border-zinc-100 px-3 py-2 text-zinc-700">
                                {row.diaSemana || "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-white px-3 py-4 text-sm text-zinc-500">
                      Nenhum registro encontrado para a data selecionada.
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

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
                  setVerifyResult(null);
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
