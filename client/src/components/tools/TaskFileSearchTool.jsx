import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FileSearch,
  Loader2,
  LogIn,
  LogOut,
  Search,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCdrAuthStatus,
  loginCdrPortal,
  logoutCdrPortal,
  searchPortalTasks,
} from "@/lib/cdr";
import { cn } from "@/lib/utils";

const EMPTY_SUMMARY = {
  pagesRead: 0,
  tasksFound: 0,
  detailsAnalyzed: 0,
  detailsFailed: 0,
  matches: 0,
};

const RESULT_COLUMNS = [
  { key: "id", label: "ID", compact: true },
  { key: "tarefa", label: "Tarefa" },
  { key: "status", label: "Status", compact: true },
  { key: "screator", label: "SCreator" },
  { key: "ultimaExecucao", label: "Ultima Execucao" },
  { key: "proximaExecucao", label: "Proxima Execucao" },
  { key: "descricao", label: "Descricao" },
  { key: "servidor", label: "Servidor" },
  { key: "usuario", label: "Usuario", compact: true },
  { key: "arquivo", label: "Arquivo" },
  { key: "local", label: "Local" },
  { key: "remoto", label: "Remoto" },
  { key: "acao", label: "Acao" },
  { key: "descricaoEtapa", label: "Descricao da etapa" },
  { key: "ordemExecucao", label: "Ordem", compact: true },
  { key: "ultimaAtualizacao", label: "Ultima Atualizacao" },
  { key: "atualizadoPor", label: "Atualizado Por" },
];

function FieldLabel({ children }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </span>
  );
}

function numberBr(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
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
                ? `${session?.username || "Usuario"} - busca de tarefas habilitada`
                : "Autentique no Portal ICC para pesquisar Arquivo, Local e Remoto."}
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

function SummaryCard({ title, value }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-medium text-zinc-500">{title}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-950">{numberBr(value)}</p>
    </div>
  );
}

function ResultsTable({ rows }) {
  return (
    <div className="overflow-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
      <table className="min-w-[1800px] border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 bg-zinc-100 text-zinc-700">
          <tr>
            {RESULT_COLUMNS.map((column) => (
              <th
                key={column.key}
                className={cn(
                  "whitespace-nowrap border-b border-zinc-200 px-3 py-2 font-semibold",
                  column.compact ? "w-24" : "min-w-44",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row.id} className="odd:bg-white even:bg-zinc-50">
                {RESULT_COLUMNS.map((column) => (
                  <td
                    key={`${row.id}-${column.key}`}
                    className="max-w-[360px] border-b border-zinc-100 px-3 py-2 align-top text-zinc-700"
                    title={String(row[column.key] || "")}
                  >
                    <span className="line-clamp-3 break-words">
                      {row[column.key] || "-"}
                    </span>
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                className="px-3 py-8 text-center text-sm text-zinc-500"
                colSpan={RESULT_COLUMNS.length}
              >
                Nenhuma tarefa encontrada para os filtros informados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function TaskFileSearchTool() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [filters, setFilters] = useState({ arquivo: "", local: "", remoto: "" });
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [searching, setSearching] = useState(false);

  const canSearch = useMemo(
    () =>
      Boolean(session) &&
      Boolean(filters.arquivo.trim() || filters.local.trim() || filters.remoto.trim()),
    [filters.arquivo, filters.local, filters.remoto, session],
  );

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      setBooting(true);
      try {
        const result = await getCdrAuthStatus();
        if (active) setSession(result.authenticated ? result.session : null);
      } catch (err) {
        if (active) setError(err?.message || "Nao foi possivel verificar a sessao Portal ICC.");
      } finally {
        if (active) setBooting(false);
      }
    }

    loadStatus();
    return () => {
      active = false;
    };
  }, []);

  async function handleLogin(event) {
    event.preventDefault();
    setLoggingIn(true);
    setError("");

    try {
      const result = await loginCdrPortal(loginForm);
      setSession(result.session || null);
      setLoginForm((current) => ({ ...current, password: "" }));
      toast.success("Login Portal ICC realizado.");
    } catch (err) {
      setSession(null);
      setError(err?.message || "Nao foi possivel autenticar no Portal ICC.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    setError("");

    try {
      await logoutCdrPortal();
      setSession(null);
      setRows([]);
      setSummary(EMPTY_SUMMARY);
      toast.success("Sessao Portal ICC encerrada.");
    } catch (err) {
      setError(err?.message || "Nao foi possivel encerrar a sessao Portal ICC.");
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleSearch(event) {
    event.preventDefault();
    setSearching(true);
    setError("");
    setRows([]);
    setSummary(EMPTY_SUMMARY);

    try {
      const result = await searchPortalTasks(filters);
      setRows(Array.isArray(result.rows) ? result.rows : []);
      setSummary(result.summary || EMPTY_SUMMARY);
      toast.success("Busca de tarefas concluida.");
    } catch (err) {
      setError(err?.message || "Nao foi possivel pesquisar as tarefas.");
      if (err?.code === "PORTAL_SESSION_EXPIRED" || err?.status === 401) {
        setSession(null);
        toast.warning("Sessao Portal ICC expirada. Faca login novamente.");
      }
    } finally {
      setSearching(false);
    }
  }

  if (booting) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
        <Loader2 className="h-4 w-4 animate-spin text-red-600" />
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

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <form
        onSubmit={handleSearch}
        className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
      >
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <label className="grid gap-1">
            <FieldLabel>Arquivo</FieldLabel>
            <Input
              value={filters.arquivo}
              onChange={(event) =>
                setFilters((current) => ({ ...current, arquivo: event.target.value }))
              }
              placeholder="Ex: AMX_VOICER ou 94611"
              disabled={!session || searching}
            />
          </label>

          <label className="grid gap-1">
            <FieldLabel>Local</FieldLabel>
            <Input
              value={filters.local}
              onChange={(event) =>
                setFilters((current) => ({ ...current, local: event.target.value }))
              }
              placeholder="Ex: /dados/screator/datafiles"
              disabled={!session || searching}
            />
          </label>

          <label className="grid gap-1">
            <FieldLabel>Remoto</FieldLabel>
            <Input
              value={filters.remoto}
              onChange={(event) =>
                setFilters((current) => ({ ...current, remoto: event.target.value }))
              }
              placeholder="Ex: /app/sftp/net_huawei"
              disabled={!session || searching}
            />
          </label>

          <div className="flex items-end">
            <Button type="submit" className="w-full md:w-auto" disabled={!canSearch || searching}>
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Pesquisar
            </Button>
          </div>
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard title="Paginas lidas" value={summary.pagesRead} />
        <SummaryCard title="Tarefas encontradas" value={summary.tasksFound} />
        <SummaryCard title="Detalhes analisados" value={summary.detailsAnalyzed} />
        <SummaryCard title="Detalhes com falha" value={summary.detailsFailed} />
        <SummaryCard title="Resultados" value={summary.matches} />
      </div>

      {searching ? (
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          <Loader2 className="h-4 w-4 animate-spin text-red-600" />
          Varrendo tarefas e analisando Arquivo, Local e Remoto...
        </div>
      ) : null}

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-red-100 bg-red-50 text-red-700">
              <FileSearch className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Resultados</h3>
              <p className="text-xs text-zinc-500">
                Match parcial em Arquivo, Local e/ou Remoto, sem diferenciar caixa ou acento.
              </p>
            </div>
          </div>
          <Badge className="border border-zinc-200 bg-zinc-50 text-zinc-700">
            {numberBr(rows.length)} item(ns)
          </Badge>
        </div>

        <ResultsTable rows={rows} />
      </div>
    </div>
  );
}
