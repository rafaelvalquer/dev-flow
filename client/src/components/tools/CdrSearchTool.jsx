import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Database,
  Download,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  DEFAULT_CDR_FIELDS,
  getCdrAuthStatus,
  getCdrFields,
  loginCdrPortal,
  logoutCdrPortal,
  searchCdr,
} from "@/lib/cdr";

const FILTER_KEY = "devflow:cdr:lastFilters";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_FILTERS = {
  page: "1",
  sortField: "dataInicioLigacaoUra",
  sortOrder: "desc",
  dataInicial: todayISO(),
  dataFinal: todayISO(),
  campo1: "ani",
  valor1: "",
  campo2: "0",
  valor2: "",
  campo3: "0",
  valor3: "",
  campo4: "0",
  valor4: "",
  campo5: "0",
  valor5: "",
};

function loadSavedFilters() {
  try {
    const saved = window.localStorage.getItem(FILTER_KEY);
    return saved ? { ...DEFAULT_FILTERS, ...JSON.parse(saved) } : DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(filters) {
  try {
    window.localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  } catch {}
}

function escapeCsv(value = "") {
  const stringValue = String(value ?? "");
  if (/[";\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function downloadCsv(columns, rows) {
  const header = columns.map(escapeCsv).join(";");
  const body = rows
    .map((row) => columns.map((column) => escapeCsv(row[column])).join(";"))
    .join("\n");
  const blob = new Blob([`\ufeff${header}\n${body}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `consulta-cdr-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function FieldLabel({ children }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{children}</span>;
}

function FilterPair({ index, filters, fields, disabled, onChange }) {
  const fieldKey = `campo${index}`;
  const valueKey = `valor${index}`;

  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm shadow-zinc-950/[0.03]">
      <label className="grid min-w-0 gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>{`Campo ${index}`}</FieldLabel>
          {filters[fieldKey] !== "0" ? (
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" aria-hidden="true" />
          ) : null}
        </div>
        <Select
          value={filters[fieldKey]}
          onValueChange={(value) => onChange(fieldKey, value)}
          disabled={disabled}
        >
          <SelectTrigger className="h-9 rounded-lg px-3 text-sm">
            <SelectValue placeholder="Campo" />
          </SelectTrigger>
          <SelectContent>
            {fields.map((field) => (
              <SelectItem key={`${index}-${field.value}`} value={field.value}>
                {field.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="grid min-w-0 gap-1.5">
        <span className="sr-only">{`Valor ${index}`}</span>
        <Input
          value={filters[valueKey]}
          onChange={(event) => onChange(valueKey, event.target.value)}
          disabled={disabled || filters[fieldKey] === "0"}
          placeholder={filters[fieldKey] === "0" ? "Selecione um campo" : "Valor do filtro"}
          className="h-9 rounded-lg px-3 text-sm"
        />
      </label>
    </div>
  );
}

function CdrResults({ result }) {
  const columns = result?.columns || [];
  const rows = result?.rows || [];

  if (!result) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-600">
        <Database className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
        Preencha os filtros e execute uma pesquisa para carregar os CDRs.
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-600">
        <Search className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
        <strong className="block text-zinc-900">Nenhum registro localizado</strong>
        <span>{result.message || "A consulta retornou zero linhas."}</span>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Resultado da consulta</h3>
          <p className="text-xs text-zinc-500">
            {rows.length} registro(s), origem {result.source || "portal"}, HTML {result.rawHtmlLength || 0} bytes.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => downloadCsv(columns, rows)}
        >
          <Download className="h-4 w-4" />
          CSV
        </Button>
      </div>

      <div className="max-h-[520px] overflow-auto rounded-xl border border-zinc-200 bg-white">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-100 text-zinc-700">
            <tr>
              {columns.map((column) => (
                <th key={column} className="whitespace-nowrap border-b border-zinc-200 px-3 py-2 font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${row.CallID || row.DataRow || "row"}-${rowIndex}`} className="odd:bg-white even:bg-zinc-50">
                {columns.map((column) => (
                  <td key={`${rowIndex}-${column}`} className="whitespace-nowrap border-b border-zinc-100 px-3 py-2 text-zinc-700">
                    {row[column]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CdrSearchTool() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [filters, setFilters] = useState(loadSavedFilters);
  const [fields, setFields] = useState(DEFAULT_CDR_FIELDS);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const authenticated = Boolean(session);
  const activeFilters = useMemo(
    () =>
      [1, 2, 3, 4, 5].filter(
        (index) => filters[`campo${index}`] !== "0" && filters[`valor${index}`],
      ).length,
    [filters],
  );

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

    getCdrFields()
      .then((data) => {
        if (active && Array.isArray(data?.fields) && data.fields.length) {
          setFields(data.fields);
        }
      })
      .catch(() => {
        if (active) setFields(DEFAULT_CDR_FIELDS);
      });

    return () => {
      active = false;
    };
  }, []);

  function updateFilter(key, value) {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key.startsWith("campo") && value === "0") {
        next[key.replace("campo", "valor")] = "";
      }
      saveFilters(next);
      return next;
    });
  }

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
      // A sessao local deve ser descartada mesmo se o backend ja a tiver expirado.
    } finally {
      setSession(null);
      setLoggingOut(false);
    }
  }

  async function handleSearch(event) {
    event.preventDefault();
    setError("");
    setSearching(true);

    try {
      const data = await searchCdr(filters);
      setResult(data);
    } catch (err) {
      setError(err?.message || "Erro ao consultar CDR.");
      if (err?.status === 401 || err?.code === "PORTAL_SESSION_EXPIRED") {
        setSession(null);
        toast.warning("Sessao Portal ICC expirada. Faca login novamente.");
      }
    } finally {
      setSearching(false);
    }
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
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
                ? `${session?.username || "Usuario"} - ${session?.hasJSessionId ? "JSESSIONID capturado" : "sem JSESSIONID"}`
                : "Autentique com usuario e senha do Portal ICC para consultar CDR."}
            </p>
          </div>
        </div>

        {authenticated ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Sair do ICC
          </Button>
        ) : null}
      </div>

      {!authenticated ? (
        <form onSubmit={handleLogin} className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Login Portal ICC</h3>
            <p className="text-xs text-zinc-500">
              A senha nao e armazenada e os cookies do portal ficam somente no backend.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
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
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div>
            <Button type="submit" disabled={loggingIn}>
              {loggingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Entrar
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleSearch} className="grid gap-4">
          <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">Filtros da consulta</h3>
                <p className="text-xs text-zinc-500">
                  {activeFilters} filtro(s) ativo(s) para `/portalicc/cdr-list/page/:page`.
                </p>
              </div>
              <Button type="submit" size="sm" disabled={searching}>
                {searching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Pesquisar
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-5">
              <label className="grid gap-1">
                <FieldLabel>Pagina</FieldLabel>
                <Input className="h-10 rounded-lg px-3" value={filters.page} onChange={(event) => updateFilter("page", event.target.value)} />
              </label>
              <label className="grid gap-1">
                <FieldLabel>Data inicial</FieldLabel>
                <Input className="h-10 rounded-lg px-3" type="date" value={filters.dataInicial} onChange={(event) => updateFilter("dataInicial", event.target.value)} />
              </label>
              <label className="grid gap-1">
                <FieldLabel>Data final</FieldLabel>
                <Input className="h-10 rounded-lg px-3" type="date" value={filters.dataFinal} onChange={(event) => updateFilter("dataFinal", event.target.value)} />
              </label>
              <label className="grid gap-1">
                <FieldLabel>Sort field</FieldLabel>
                <Input className="h-10 rounded-lg px-3" value={filters.sortField} onChange={(event) => updateFilter("sortField", event.target.value)} />
              </label>
              <label className="grid gap-1">
                <FieldLabel>Ordem</FieldLabel>
                <Select value={filters.sortOrder} onValueChange={(value) => updateFilter("sortOrder", value)}>
                  <SelectTrigger className="h-10 rounded-lg px-3">
                    <SelectValue placeholder="Ordem" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">Descendente</SelectItem>
                    <SelectItem value="asc">Ascendente</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5">
              {[1, 2, 3, 4, 5].map((index) => (
                <FilterPair
                  key={index}
                  index={index}
                  filters={filters}
                  fields={fields}
                  disabled={searching}
                  onChange={updateFilter}
                />
              ))}
            </div>

            {error ? (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          <CdrResults result={result} />
        </form>
      )}
    </div>
  );
}
