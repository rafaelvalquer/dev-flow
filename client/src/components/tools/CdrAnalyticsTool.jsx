import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Clock3,
  DownloadCloud,
  Loader2,
  LogIn,
  LogOut,
  Paperclip,
  PhoneCall,
  Route,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { testJiraStatus } from "@/lib/auth";
import {
  analyzeCdr,
  getCdrAuthStatus,
  loginCdrPortal,
  logoutCdrPortal,
} from "@/lib/cdr";
import { cn } from "@/lib/utils";
import BrazilCdrHeatmap from "./BrazilCdrHeatmap";
import CdrDashboardEvidenceDialog from "./CdrDashboardEvidenceDialog";
import CdrCallFlowChart from "./CdrCallFlowChart";

const SEGMENT_PRESETS = ["POS", "PRE", "CTL", "TP_POS", "TP_POS_G", "CTL_COB"];
const PIE_COLORS = ["#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed"];
const EVIDENCE_MODULES = [
  {
    id: "flow",
    label: "Fluxo de chamadas por hora",
    description: "Grafico de pico por inicio e fim de ligacao.",
  },
  {
    id: "map",
    label: "Mapa de calor por estado",
    description: "Mapa do Brasil agregado por UF a partir do DDD.",
  },
  {
    id: "ddd",
    label: "Chamadas por DDD",
    description: "Ranking dos DDDs mais recorrentes.",
  },
  {
    id: "phone-type",
    label: "Movel x fixo",
    description: "Distribuicao por tipo de telefone.",
  },
  {
    id: "transfers",
    label: "Transferencias por skill",
    description: "Ranking por NOME_SKILL e TRANSFERCODE.",
  },
  {
    id: "disconnections",
    label: "Tipos de encerramento",
    description: "Distribuicao por DISCONNECTION_TYPE_DESC.",
  },
  {
    id: "dna",
    label: "Maiores trilhas navegadas (DNA)",
    description: "Top trilhas com descricao dominante.",
  },
  {
    id: "skills",
    label: "Top skills",
    description: "Skills mais acionadas no periodo.",
  },
  {
    id: "segments",
    label: "Segmentos retornados",
    description: "Segmentos encontrados no CSV analisado.",
  },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function FieldLabel({ children }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </span>
  );
}

function pct(value) {
  return `${Math.round(Number(value || 0) * 1000) / 10}%`;
}

function numberBr(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function jiraConnectionMessage() {
  return "Sem conexao com o Jira. Desconecte da VPN ou verifique sua conexao com a internet.";
}

function KpiCard({ title, value, detail, icon: Icon }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-500">{title}</p>
          <p className="mt-1 truncate text-2xl font-semibold text-zinc-950">
            {value}
          </p>
          {detail ? <p className="mt-1 text-xs text-zinc-500">{detail}</p> : null}
        </div>
        {Icon ? (
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-red-100 bg-red-50 text-red-700">
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChartCard({ title, description, children }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-zinc-500">{description}</p>
        ) : null}
      </div>
      <div className="h-[280px] min-w-0">{children}</div>
    </div>
  );
}

function RankingTable({ title, rows, columns, emptyText = "Sem dados." }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-zinc-100" data-pdf-expand>
        <table className="min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-100 text-zinc-700">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="whitespace-nowrap border-b border-zinc-200 px-3 py-2 font-semibold"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows?.length ? (
              rows.map((row, index) => (
                <tr key={`${title}-${index}`} className="odd:bg-white even:bg-zinc-50">
                  {columns.map((column) => (
                    <td
                      key={`${title}-${index}-${column.key}`}
                      className="max-w-[520px] border-b border-zinc-100 px-3 py-2 align-top text-zinc-700"
                    >
                      {column.render ? column.render(row, index) : row[column.key]}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  className="px-3 py-6 text-center text-zinc-500"
                  colSpan={columns.length}
                >
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PortalLoginPanel({
  session,
  loginForm,
  setLoginForm,
  loggingIn,
  loggingOut,
  onLogin,
  onLogout,
}) {
  const authenticated = Boolean(session);

  return (
    <div className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-white text-red-600">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-900">Portal ICC</h3>
              <Badge
                className={cn(
                  "border",
                  authenticated
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-zinc-200 bg-white text-zinc-600",
                )}
              >
                {authenticated ? "Sessao ativa" : "Login necessario"}
              </Badge>
            </div>
            <p className="truncate text-xs text-zinc-500">
              {authenticated
                ? `${session?.username || "Usuario"} - CSV export habilitado`
                : "Autentique no Portal ICC para baixar e analisar o CSV."}
            </p>
          </div>
        </div>

        {authenticated ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onLogout}
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

      {!authenticated ? (
        <form onSubmit={onLogin} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-1">
            <FieldLabel>Usuario</FieldLabel>
            <Input
              value={loginForm.username}
              onChange={(event) =>
                setLoginForm((current) => ({
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
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              placeholder="Senha Portal ICC"
              autoComplete="current-password"
            />
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={loggingIn} className="w-full md:w-auto">
              {loggingIn ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              Entrar
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export default function CdrAnalyticsTool() {
  const moduleRefs = useRef({});
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [filters, setFilters] = useState({
    dataInicial: todayISO(),
    dataFinal: todayISO(),
    segmento: "POS",
  });
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [checkingJira, setCheckingJira] = useState(false);

  useEffect(() => {
    let active = true;
    getCdrAuthStatus()
      .then((data) => {
        if (active && data?.authenticated) setSession(data.session || null);
      })
      .catch((err) => {
        if (active) setError(err?.message || "Nao foi possivel verificar a sessao Portal ICC.");
      })
      .finally(() => {
        if (active) setBooting(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const summary = analytics?.summary || {};
  const charts = analytics?.charts || {};
  const phoneTypeData = charts.phoneTypes || [];
  const callsByDdd = charts.callsByDdd || [];
  const transferData = charts.transfersBySkill || [];

  function setModuleRef(id) {
    return (node) => {
      if (node) moduleRefs.current[id] = node;
      else delete moduleRefs.current[id];
    };
  }

  const topDnaColumns = useMemo(
    () => [
      { key: "pos", label: "#", render: (_row, index) => index + 1 },
      {
        key: "dna",
        label: "DNA",
        render: (row) => (
          <span className="block max-w-[520px] whitespace-normal break-words font-mono text-[11px]">
            {row.dna}
          </span>
        ),
      },
      {
        key: "scriptPointDesc",
        label: "Descricao dominante",
        render: (row) => row.scriptPointDesc || "-",
      },
      { key: "count", label: "Chamadas", render: (row) => numberBr(row.count) },
    ],
    [],
  );

  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    setLoggingIn(true);

    try {
      const data = await loginCdrPortal(loginForm);
      setSession(data.session || null);
      setLoginForm((current) => ({ ...current, password: "" }));
      toast.success("Login Portal ICC realizado.");
    } catch (err) {
      setError(err?.message || "Nao foi possivel autenticar no Portal ICC.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logoutCdrPortal();
    } catch {
      // Descarta a sessao local mesmo se o backend ja tiver expirado.
    } finally {
      setSession(null);
      setLoggingOut(false);
    }
  }

  async function handleAnalyze(event) {
    event.preventDefault();
    setError("");
    setAnalyzing(true);

    try {
      const data = await analyzeCdr(filters);
      setAnalytics(data);
      toast.success("CSV CDR analisado com sucesso.");
    } catch (err) {
      setError(err?.message || "Nao foi possivel analisar o CDR.");
      if (
        err?.status === 401 ||
        err?.status === 417 ||
        err?.code === "PORTAL_SESSION_EXPIRED"
      ) {
        setSession(null);
        toast.warning("Sessao Portal ICC expirada. Faca login novamente.");
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleOpenEvidence() {
    setCheckingJira(true);
    try {
      await testJiraStatus();
      setEvidenceOpen(true);
    } catch {
      toast.error(jiraConnectionMessage());
    } finally {
      setCheckingJira(false);
    }
  }

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  if (booting) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-600">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Verificando sessao Portal ICC...
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <PortalLoginPanel
        session={session}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        loggingIn={loggingIn}
        loggingOut={loggingOut}
        onLogin={handleLogin}
        onLogout={handleLogout}
      />

      {session ? (
        <form
          onSubmit={handleAnalyze}
          className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                Filtros da analise
              </h3>
              <p className="text-xs text-zinc-500">
                Baixa o CSV exportado do Portal ICC e calcula os indicadores.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {analytics ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleOpenEvidence}
                  disabled={checkingJira}
                >
                  {checkingJira ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                  Salvar evidencia
                </Button>
              ) : null}
              <Button type="submit" disabled={analyzing}>
                {analyzing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <DownloadCloud className="h-4 w-4" />
                )}
                Analisar
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1">
              <FieldLabel>Data inicial</FieldLabel>
              <Input
                type="date"
                value={filters.dataInicial}
                onChange={(event) => updateFilter("dataInicial", event.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <FieldLabel>Data final</FieldLabel>
              <Input
                type="date"
                value={filters.dataFinal}
                onChange={(event) => updateFilter("dataFinal", event.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <FieldLabel>Segmento</FieldLabel>
              <Input
                value={filters.segmento}
                list="cdr-segment-presets"
                onChange={(event) =>
                  updateFilter("segmento", event.target.value.toUpperCase())
                }
                placeholder="Ex: POS"
              />
              <datalist id="cdr-segment-presets">
                {SEGMENT_PRESETS.map((segment) => (
                  <option key={segment} value={segment} />
                ))}
              </datalist>
            </label>
          </div>
        </form>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {!analytics ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-600">
          <BarChart3 className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
          Informe o periodo e o segmento para carregar o dashboard.
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title="Chamadas analisadas"
              value={numberBr(summary.analyzedCalls)}
              detail={`${numberBr(analytics?.csv?.rows || 0)} linhas no CSV`}
              icon={PhoneCall}
            />
            <KpiCard
              title="Tempo medio total"
              value={summary.averageTotalFormatted || "0:00"}
              detail="DURACAO_TOTAL_CHAMADA"
              icon={Clock3}
            />
            <KpiCard
              title="Tempo medio URA"
              value={summary.averageUraFormatted || "0:00"}
              detail="DURACAO_CHAMADA_URA"
              icon={Route}
            />
            <KpiCard
              title="Transferencias"
              value={numberBr(summary.transferTotal)}
              detail={`${pct(summary.transferRate)} das chamadas`}
              icon={UsersRound}
            />
          </div>

          <div ref={setModuleRef("flow")} data-module-id="flow">
            <CdrCallFlowChart data={charts.callFlowByHour || []} />
          </div>

          <div ref={setModuleRef("map")} data-module-id="map">
            <BrazilCdrHeatmap states={charts.callsByState || []} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div ref={setModuleRef("ddd")} data-module-id="ddd">
              <ChartCard
                title="Chamadas por DDD"
                description="Top 20 DDDs extraidos da coluna ANI."
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={callsByDdd} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <ChartTooltip />
                    <Bar dataKey="count" name="Chamadas" fill="#dc2626" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <div ref={setModuleRef("phone-type")} data-module-id="phone-type">
              <ChartCard
                title="Movel x fixo"
                description="Classificacao por quantidade de digitos do ANI normalizado."
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={phoneTypeData}
                      dataKey="count"
                      nameKey="label"
                      outerRadius={95}
                      label={({ name, label, percent }) => `${name || label} ${pct(percent)}`}
                    >
                      {phoneTypeData.map((entry, index) => (
                        <Cell
                          key={entry.key}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <ChartTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <div ref={setModuleRef("transfers")} data-module-id="transfers">
              <ChartCard
                title="Transferencias por skill"
                description="Ranking por NOME_SKILL e TRANSFERCODE."
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={transferData.slice(0, 10)}
                    layout="vertical"
                    margin={{ top: 8, right: 16, bottom: 8, left: 40 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="nomeSkill"
                      tick={{ fontSize: 10 }}
                      width={120}
                    />
                    <ChartTooltip />
                    <Bar dataKey="count" name="Chamadas" fill="#2563eb" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <div ref={setModuleRef("disconnections")} data-module-id="disconnections">
              <ChartCard title="Tipos de encerramento" description="DISCONNECTION_TYPE_DESC">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={(charts.disconnections || []).slice(0, 10)}
                    layout="vertical"
                    margin={{ top: 8, right: 16, bottom: 8, left: 40 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={{ fontSize: 10 }}
                      width={130}
                    />
                    <ChartTooltip />
                    <Bar dataKey="count" name="Chamadas" fill="#16a34a" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>

          <div ref={setModuleRef("dna")} data-module-id="dna">
            <RankingTable
              title="Maiores trilhas navegadas (DNA)"
              rows={charts.dnaRanking || []}
              columns={topDnaColumns}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div ref={setModuleRef("skills")} data-module-id="skills">
              <RankingTable
                title="Top skills"
                rows={charts.skills || []}
                columns={[
                  { key: "label", label: "Skill" },
                  { key: "count", label: "Chamadas", render: (row) => numberBr(row.count) },
                ]}
              />
            </div>
            <div ref={setModuleRef("segments")} data-module-id="segments">
              <RankingTable
                title="Segmentos retornados"
                rows={charts.segments || []}
                columns={[
                  { key: "label", label: "Segmento" },
                  { key: "count", label: "Chamadas", render: (row) => numberBr(row.count) },
                ]}
              />
            </div>
          </div>
        </div>
      )}
      <CdrDashboardEvidenceDialog
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        analytics={analytics}
        filters={filters}
        moduleOptions={EVIDENCE_MODULES}
        moduleElements={moduleRefs.current}
      />
    </div>
  );
}
