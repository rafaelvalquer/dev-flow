import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Download,
  Loader2,
  LogIn,
  LogOut,
  Paperclip,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { testJiraStatus } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  DEFAULT_CDR_FIELDS,
  getCdrAuthStatus,
  getCdrFields,
  loginCdrPortal,
  logoutCdrPortal,
  searchCdr,
} from "@/lib/cdr";
import { jiraUploadIssueAttachments } from "@/lib/jiraClient";
import JiraTicketPicker from "./JiraTicketPicker";

const FILTER_KEY = "devflow:cdr:lastFilters";

function todayISO() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

const LEGACY_FIELD_VALUES = {
  callId: "call_id",
  codigoAplicacao: "codigo_aplicacao",
  versaoAplicacao: "versao_aplicacao",
  disconnectionTypeDesc: "disconnection_type_desc",
  nomeSkill: "nome_skill",
  idSkill: "id_skill",
  digitCode: "digit_code",
};

function normalizeSavedFilters(filters) {
  const next = { ...DEFAULT_FILTERS, ...(filters || {}) };
  const today = todayISO();
  next.dataInicial = today;
  next.dataFinal = today;

  for (let index = 1; index <= 5; index += 1) {
    const fieldKey = `campo${index}`;
    next[fieldKey] = LEGACY_FIELD_VALUES[next[fieldKey]] || next[fieldKey];
  }

  return next;
}

function loadSavedFilters() {
  try {
    const saved = window.localStorage.getItem(FILTER_KEY);
    if (!saved) return normalizeSavedFilters({});

    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return normalizeSavedFilters({});
    }

    return normalizeSavedFilters(parsed);
  } catch {
    return normalizeSavedFilters({});
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

function buildCsvBlob(columns, rows) {
  const header = columns.map(escapeCsv).join(";");
  const body = rows
    .map((row) => columns.map((column) => escapeCsv(row[column])).join(";"))
    .join("\n");
  return new Blob([`\ufeff${header}\n${body}`], {
    type: "text/csv;charset=utf-8",
  });
}

function downloadCsv(columns, rows) {
  const blob = buildCsvBlob(columns, rows);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `consulta-cdr-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function evidenceFileName() {
  const date = new Date();
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
  return `evidencias-${stamp}.csv`;
}

function createEvidenceFile(columns, rows) {
  return new File([buildCsvBlob(columns, rows)], evidenceFileName(), {
    type: "text/csv;charset=utf-8",
  });
}

function jiraConnectionMessage() {
  return "Sem conexao com o Jira. Desconecte da VPN ou verifique sua conexao com a internet.";
}

function FieldLabel({ children }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{children}</span>;
}

function normalizePageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function paginationPages(pagination) {
  const currentPage = normalizePageNumber(pagination?.currentPage) || 1;
  const totalPages = normalizePageNumber(pagination?.totalPages) || currentPage;
  const apiPages = Array.isArray(pagination?.pages)
    ? pagination.pages.map(normalizePageNumber).filter(Boolean)
    : [];
  const pages = apiPages.length
    ? apiPages
    : [1, currentPage - 1, currentPage, currentPage + 1, totalPages];

  if (totalPages > 1) {
    pages.push(1, totalPages);
  }
  pages.push(currentPage);

  return [...new Set(pages.filter((page) => page >= 1 && page <= totalPages))].sort(
    (a, b) => a - b,
  );
}

function CdrPageButton({ page, label, active = false, disabled = false, onPageChange, children }) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      className={cn(
        "h-8 min-w-8 rounded-md px-2 text-xs",
        active ? "pointer-events-none" : "",
      )}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={() => onPageChange(page)}
    >
      {children}
    </Button>
  );
}

function CdrPagination({ pagination, loading = false, onPageChange }) {
  if (!pagination) return null;

  const currentPage = normalizePageNumber(pagination.currentPage) || 1;
  const totalPages = normalizePageNumber(pagination.totalPages) || currentPage;
  const totalItems = normalizePageNumber(pagination.totalItems);
  const from = normalizePageNumber(pagination.from);
  const to = normalizePageNumber(pagination.to);
  const firstPage = normalizePageNumber(pagination.firstPage);
  const previousPage = normalizePageNumber(pagination.previousPage);
  const nextPage = normalizePageNumber(pagination.nextPage);
  const lastPage = normalizePageNumber(pagination.lastPage);
  const pages = paginationPages(pagination);
  const summary =
    totalItems && from && to
      ? `Exibindo ${from} a ${to} do total de ${totalItems} - Página ${currentPage} de ${totalPages}`
      : `Página ${currentPage} de ${totalPages}`;

  return (
    <div className="grid gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-3">
      <p className="text-center text-xs font-medium text-zinc-600">{summary}</p>
      {totalPages > 1 ? (
        <nav className="flex flex-wrap items-center justify-center gap-1" aria-label="Paginação da Consulta CDR">
          <CdrPageButton
            page={firstPage}
            label="Primeira página"
            disabled={loading || !firstPage}
            onPageChange={onPageChange}
          >
            <ChevronsLeft className="h-4 w-4" />
          </CdrPageButton>
          <CdrPageButton
            page={previousPage}
            label="Página anterior"
            disabled={loading || !previousPage}
            onPageChange={onPageChange}
          >
            <ChevronLeft className="h-4 w-4" />
          </CdrPageButton>

          {pages.map((page, index) => {
            const previous = pages[index - 1];
            const showGap = previous && page - previous > 1;
            return (
              <React.Fragment key={page}>
                {showGap ? (
                  <span className="grid h-8 min-w-8 place-items-center px-1 text-xs text-zinc-400">
                    ...
                  </span>
                ) : null}
                <CdrPageButton
                  page={page}
                  label={`Página ${page}`}
                  active={page === currentPage}
                  disabled={loading || page === currentPage}
                  onPageChange={onPageChange}
                >
                  {page}
                </CdrPageButton>
              </React.Fragment>
            );
          })}

          <CdrPageButton
            page={nextPage}
            label="Próxima página"
            disabled={loading || !nextPage}
            onPageChange={onPageChange}
          >
            <ChevronRight className="h-4 w-4" />
          </CdrPageButton>
          <CdrPageButton
            page={lastPage}
            label="Última página"
            disabled={loading || !lastPage}
            onPageChange={onPageChange}
          >
            <ChevronsRight className="h-4 w-4" />
          </CdrPageButton>
        </nav>
      ) : null}
    </div>
  );
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
          <SelectContent className="max-h-72 overflow-y-auto">
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

function CdrEvidenceDialog({ open, onOpenChange, columns, rows }) {
  const [ticketKey, setTicketKey] = useState("");
  const [mode, setMode] = useState("all");
  const [selectedRows, setSelectedRows] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTicketKey("");
      setMode("all");
      setSelectedRows(new Set());
    }
  }, [open]);

  const selectionRows = mode === "all"
    ? rows
    : rows.filter((_, index) => selectedRows.has(index));
  const canSave = Boolean(ticketKey.trim()) && selectionRows.length > 0 && !saving;
  const previewColumns = columns.slice(0, 8);

  function toggleRow(index) {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedRows((current) => {
      if (current.size === rows.length) return new Set();
      return new Set(rows.map((_, index) => index));
    });
  }

  async function handleSaveEvidence() {
    if (!canSave) return;
    setSaving(true);
    try {
      await testJiraStatus();
      const file = createEvidenceFile(columns, selectionRows);
      await jiraUploadIssueAttachments(ticketKey.trim(), [file]);
      toast.success(`Evidencia anexada em ${ticketKey.trim().toUpperCase()}.`);
      onOpenChange(false);
    } catch (err) {
      const status = err?.status || err?.body?.status;
      if (!status || status === 401 || status === 403 || /jira/i.test(err?.message || "")) {
        toast.error(jiraConnectionMessage());
      } else {
        toast.error(err?.message || "Nao foi possivel anexar a evidencia no Jira.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0 sm:rounded-2xl">
        <DialogHeader className="border-b border-zinc-200 bg-white px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Paperclip className="h-4 w-4 text-red-600" />
            Salvar evidencia CDR
          </DialogTitle>
          <DialogDescription>
            Gere um CSV da pagina atual e anexe no ticket Jira selecionado.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[70vh] gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-1.5">
            <FieldLabel>Ticket Jira</FieldLabel>
            <JiraTicketPicker value={ticketKey} onChange={setTicketKey} disabled={saving} />
          </div>

          <div className="grid gap-2">
            <FieldLabel>Linhas da evidencia</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className={cn(
                  "rounded-xl border px-3 py-3 text-left text-sm transition",
                  mode === "all"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
                )}
                onClick={() => setMode("all")}
                disabled={saving}
              >
                <span className="flex items-center gap-2 font-semibold">
                  {mode === "all" ? <Check className="h-4 w-4" /> : null}
                  Todas as linhas
                </span>
                <span className="mt-1 block text-xs text-zinc-500">
                  Anexa os {rows.length} registro(s) exibidos nesta pagina.
                </span>
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-xl border px-3 py-3 text-left text-sm transition",
                  mode === "selected"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
                )}
                onClick={() => setMode("selected")}
                disabled={saving}
              >
                <span className="flex items-center gap-2 font-semibold">
                  {mode === "selected" ? <Check className="h-4 w-4" /> : null}
                  Selecionar linhas
                </span>
                <span className="mt-1 block text-xs text-zinc-500">
                  Escolha manualmente quais registros entram no CSV.
                </span>
              </button>
            </div>
          </div>

          {mode === "selected" ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-zinc-600">
                  {selectedRows.size} de {rows.length} linha(s) selecionada(s)
                </p>
                <Button type="button" variant="outline" size="sm" onClick={toggleAllVisible} disabled={saving}>
                  {selectedRows.size === rows.length ? "Limpar selecao" : "Selecionar todas"}
                </Button>
              </div>

              <div className="max-h-[320px] overflow-auto rounded-xl border border-zinc-200 bg-white">
                <table className="min-w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-zinc-100 text-zinc-700">
                    <tr>
                      <th className="w-10 border-b border-zinc-200 px-3 py-2">
                        <span className="sr-only">Selecionar</span>
                      </th>
                      {previewColumns.map((column) => (
                        <th key={column} className="whitespace-nowrap border-b border-zinc-200 px-3 py-2 font-semibold">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rowIndex) => (
                      <tr
                        key={`evidence-${row.CallID || row.DataRow || "row"}-${rowIndex}`}
                        className={cn(
                          "cursor-pointer odd:bg-white even:bg-zinc-50 hover:bg-red-50/60",
                          selectedRows.has(rowIndex) ? "bg-red-50" : "",
                        )}
                        onClick={() => toggleRow(rowIndex)}
                      >
                        <td className="border-b border-zinc-100 px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zinc-300 accent-red-600"
                            checked={selectedRows.has(rowIndex)}
                            onChange={() => toggleRow(rowIndex)}
                            onClick={(event) => event.stopPropagation()}
                            disabled={saving}
                            aria-label={`Selecionar linha ${rowIndex + 1}`}
                          />
                        </td>
                        {previewColumns.map((column) => (
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
          ) : null}
        </div>

        <DialogFooter className="border-t border-zinc-200 bg-white px-5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSaveEvidence} disabled={!canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Anexar evidencia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CdrResults({ result, loading = false, onPageChange }) {
  const columns = result?.columns || [];
  const rows = result?.rows || [];
  const pagination = result?.pagination || null;
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [checkingJira, setCheckingJira] = useState(false);

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
      <div className="grid gap-3">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-600">
          <Search className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
          <strong className="block text-zinc-900">Nenhum registro localizado</strong>
          <span>{result.message || "A consulta retornou zero linhas."}</span>
        </div>
        <CdrPagination pagination={pagination} loading={loading} onPageChange={onPageChange} />
      </div>
    );
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

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Resultado da consulta</h3>
          <p className="text-xs text-zinc-500">
            {rows.length} registro(s) nesta página, origem {result.source || "portal"}, HTML {result.rawHtmlLength || 0} bytes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => downloadCsv(columns, rows)}
          >
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleOpenEvidence}
            disabled={checkingJira}
          >
            {checkingJira ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            Salvar evidencia
          </Button>
        </div>
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

      <CdrPagination pagination={pagination} loading={loading} onPageChange={onPageChange} />
      <CdrEvidenceDialog
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        columns={columns}
        rows={rows}
      />
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
      const next = { ...current, [key]: value, page: key === "page" ? value : "1" };
      if (key.startsWith("campo") && value === "0") {
        next[key.replace("campo", "valor")] = "";
      }
      saveFilters(next);
      return next;
    });
  }

  async function executeCdrSearch(nextFilters) {
    setError("");
    setSearching(true);

    try {
      const data = await searchCdr(nextFilters);
      setResult(data);
      setFilters(nextFilters);
      saveFilters(nextFilters);
    } catch (err) {
      setError(err?.message || "Erro ao consultar CDR.");
      if (
        err?.status === 401 ||
        err?.status === 417 ||
        err?.code === "PORTAL_SESSION_EXPIRED"
      ) {
        setSession(null);
        toast.warning("Sessao Portal ICC expirada. Faca login novamente.");
      }
    } finally {
      setSearching(false);
    }
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
    await executeCdrSearch({ ...filters, page: "1" });
  }

  async function handlePageChange(page) {
    const nextPage = normalizePageNumber(page);
    const currentPage = normalizePageNumber(result?.pagination?.currentPage || filters.page) || 1;
    if (!nextPage || nextPage === currentPage || searching) return;
    await executeCdrSearch({ ...filters, page: String(nextPage) });
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

            <div className="grid gap-2 md:grid-cols-4">
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

          <CdrResults result={result} loading={searching} onPageChange={handlePageChange} />
        </form>
      )}
    </div>
  );
}
