import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Code2,
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Trash2,
  UserRound,
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
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createUra,
  createUraVersion,
  deleteUra,
  deleteUraVersion,
  fetchUraVersions,
  fetchUras,
  updateUra,
  updateUraVersion,
} from "@/lib/uraVersioning";

const URA_STATUS_OPTIONS = [
  { value: "active", label: "Ativa", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  { value: "maintenance", label: "Em manutencao", className: "border-amber-200 bg-amber-50 text-amber-800" },
  { value: "deprecated", label: "Descontinuada", className: "border-zinc-200 bg-zinc-50 text-zinc-700" },
];

const VERSION_STATUS_OPTIONS = [
  { value: "planned", label: "Planejada", className: "border-sky-200 bg-sky-50 text-sky-700" },
  { value: "deployed", label: "Implantada", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  { value: "rollback", label: "Rollback", className: "border-red-200 bg-red-50 text-red-700" },
  { value: "cancelled", label: "Cancelada", className: "border-zinc-200 bg-zinc-50 text-zinc-700" },
];

const EMPTY_URA_FORM = {
  name: "",
  description: "",
  project: "",
  owner: "",
  status: "active",
};

const EMPTY_VERSION_FORM = {
  uraId: "",
  version: "",
  deploymentDate: "",
  developer: "",
  ticket: "",
  description: "",
  changesText: "",
  scriptsText: "",
  status: "deployed",
};

function statusMeta(options, value) {
  return options.find((item) => item.value === value) || options[0];
}

function formatDateBR(ymd) {
  if (!ymd) return "Nao informado";
  const [y, m, d] = String(ymd).slice(0, 10).split("-");
  if (!y || !m || !d) return String(ymd);
  return `${d}/${m}/${y}`;
}

function versionCountLabel(count) {
  const total = Number(count || 0);
  return `${total} ${total === 1 ? "versão" : "versões"}`;
}

function splitLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function normalizeTicket(value) {
  return String(value || "").trim().toUpperCase();
}

export default function URAVersioningTab() {
  const [uras, setUras] = useState([]);
  const [versions, setVersions] = useState([]);
  const [selectedUraId, setSelectedUraId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [loadingUras, setLoadingUras] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uraModalOpen, setUraModalOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [editingUra, setEditingUra] = useState(null);
  const [editingVersion, setEditingVersion] = useState(null);
  const [uraForm, setUraForm] = useState(EMPTY_URA_FORM);
  const [versionForm, setVersionForm] = useState(EMPTY_VERSION_FORM);

  const selectedUra = useMemo(
    () => uras.find((ura) => ura.id === selectedUraId) || null,
    [selectedUraId, uras],
  );
  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) || null,
    [selectedVersionId, versions],
  );

  async function loadUras({ keepSelection = true } = {}) {
    setLoadingUras(true);
    try {
      const data = await fetchUras();
      setUras(data);
      if (!keepSelection || (selectedUraId && !data.some((ura) => ura.id === selectedUraId))) {
        setSelectedUraId(data[0]?.id || "");
      }
    } catch (err) {
      toast.error(err?.message || "Nao foi possivel carregar URAs.");
    } finally {
      setLoadingUras(false);
    }
  }

  async function loadVersions(uraId = selectedUraId) {
    if (!uraId) {
      setVersions([]);
      return;
    }

    setLoadingVersions(true);
    try {
      const data = await fetchUraVersions(uraId);
      setVersions(data);
      setSelectedVersionId((current) =>
        data.some((version) => version.id === current) ? current : "",
      );
    } catch (err) {
      setVersions([]);
      toast.error(err?.message || "Nao foi possivel carregar versionamentos.");
    } finally {
      setLoadingVersions(false);
    }
  }

  useEffect(() => {
    loadUras({ keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadVersions(selectedUraId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUraId]);

  function openNewUraModal() {
    setEditingUra(null);
    setUraForm(EMPTY_URA_FORM);
    setUraModalOpen(true);
  }

  function openEditUraModal(ura) {
    if (!ura) return;
    setEditingUra(ura);
    setUraForm({
      name: ura.name || "",
      description: ura.description || "",
      project: ura.project || "",
      owner: ura.owner || "",
      status: ura.status || "active",
    });
    setUraModalOpen(true);
  }

  function openNewVersionModal() {
    setEditingVersion(null);
    setVersionForm({
      ...EMPTY_VERSION_FORM,
      uraId: selectedUraId || uras[0]?.id || "",
      deploymentDate: new Date().toISOString().slice(0, 10),
    });
    setVersionModalOpen(true);
  }

  function openEditVersionModal(version) {
    if (!version) return;
    setEditingVersion(version);
    setVersionForm({
      uraId: version.uraId || selectedUraId || "",
      version: version.version || "",
      deploymentDate: version.deploymentDate || "",
      developer: version.developer || "",
      ticket: version.ticket || "",
      description: version.description || "",
      changesText: joinLines(version.changes),
      scriptsText: joinLines(version.scripts),
      status: version.status || "deployed",
    });
    setVersionModalOpen(true);
  }

  async function saveUra(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = editingUra
        ? await updateUra(editingUra.id, uraForm)
        : await createUra(uraForm);

      setUras((current) => {
        const exists = current.some((ura) => ura.id === saved.id);
        const next = exists
          ? current.map((ura) => (ura.id === saved.id ? saved : ura))
          : [...current, saved];
        return [...next].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      });
      setSelectedUraId(saved.id);
      setUraModalOpen(false);
      toast.success(editingUra ? "URA atualizada." : "URA cadastrada.");
    } catch (err) {
      toast.error(err?.message || "Nao foi possivel salvar a URA.");
    } finally {
      setSaving(false);
    }
  }

  async function saveVersion(event) {
    event.preventDefault();
    const payload = {
      uraId: versionForm.uraId,
      version: versionForm.version,
      deploymentDate: versionForm.deploymentDate,
      developer: versionForm.developer,
      ticket: normalizeTicket(versionForm.ticket),
      description: versionForm.description,
      changes: splitLines(versionForm.changesText),
      scripts: splitLines(versionForm.scriptsText),
      status: versionForm.status,
    };

    setSaving(true);
    try {
      const saved = editingVersion
        ? await updateUraVersion(editingVersion.id, payload)
        : await createUraVersion(payload.uraId, payload);

      if (payload.uraId !== selectedUraId) {
        setSelectedUraId(payload.uraId);
      } else {
        await loadVersions(payload.uraId);
      }
      setSelectedVersionId(saved.id);
      setVersionModalOpen(false);
      toast.success(editingVersion ? "Versionamento atualizado." : "Versionamento cadastrado.");
    } catch (err) {
      toast.error(err?.message || "Nao foi possivel salvar o versionamento.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSelectedUra() {
    if (!selectedUra) return;
    const confirmed = window.confirm(
      `Excluir a URA "${selectedUra.name}" e todos os seus versionamentos?`,
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      await deleteUra(selectedUra.id);
      const next = uras.filter((ura) => ura.id !== selectedUra.id);
      setUras(next);
      setSelectedUraId(next[0]?.id || "");
      setVersions([]);
      setSelectedVersionId("");
      toast.success("URA excluida.");
    } catch (err) {
      toast.error(err?.message || "Nao foi possivel excluir a URA.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSelectedVersion(version = selectedVersion) {
    if (!version) return;
    const confirmed = window.confirm(`Excluir o versionamento ${version.version}?`);
    if (!confirmed) return;

    setSaving(true);
    try {
      await deleteUraVersion(version.id);
      setVersions((current) => current.filter((item) => item.id !== version.id));
      setSelectedVersionId("");
      toast.success("Versionamento excluido.");
    } catch (err) {
      toast.error(err?.message || "Nao foi possivel excluir o versionamento.");
    } finally {
      setSaving(false);
    }
  }

  const selectedUraStatus = statusMeta(URA_STATUS_OPTIONS, selectedUra?.status);

  return (
    <section className="grid gap-5">
      <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-700">
              <GitBranch className="h-3.5 w-3.5" />
              URA
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-950">
              Versionamentos de URA
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-600">
              Consulte o histórico de versões das URAs, visualize alterações
              implantadas, responsaveis pelo desenvolvimento e tickets relacionados.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-zinc-200 bg-white"
              onClick={openNewUraModal}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova URA
            </Button>
            <Button
              type="button"
              className="rounded-xl bg-red-600 text-white hover:bg-red-700"
              onClick={openNewVersionModal}
              disabled={!uras.length}
            >
              <Plus className="mr-2 h-4 w-4" />
              Novo Versionamento
            </Button>
          </div>
        </div>
      </div>

      <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="text-base text-zinc-900">
                Selecione uma URA
              </CardTitle>
              <CardDescription>
                Escolha a URA para carregar automaticamente sua timeline.
              </CardDescription>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-zinc-200 bg-white"
                onClick={() => loadUras()}
                disabled={loadingUras}
              >
                {loadingUras ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Atualizar
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-zinc-200 bg-white"
                onClick={() => openEditUraModal(selectedUra)}
                disabled={!selectedUra}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Editar URA
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-red-200 bg-white text-red-700 hover:bg-red-50"
                onClick={removeSelectedUra}
                disabled={!selectedUra || saving}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir URA
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {loadingUras && !uras.length ? (
            <Skeleton className="h-12 rounded-2xl" />
          ) : uras.length ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <Select value={selectedUraId} onValueChange={setSelectedUraId}>
                <SelectTrigger className="h-12 rounded-2xl border-zinc-200 bg-white">
                  <SelectValue placeholder="Selecione uma URA" />
                </SelectTrigger>
                <SelectContent>
                  {uras.map((ura) => (
                    <SelectItem key={ura.id} value={ura.id}>
                      {ura.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedUra ? (
                <div className="flex flex-wrap gap-2">
                  <Badge className={cn("rounded-full border", selectedUraStatus.className)}>
                    {selectedUraStatus.label}
                  </Badge>
                  {selectedUra.project ? (
                    <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                      {selectedUra.project}
                    </Badge>
                  ) : null}
                  {selectedUra.owner ? (
                    <Badge className="rounded-full border border-sky-200 bg-sky-50 text-sky-700">
                      {selectedUra.owner}
                    </Badge>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center">
              <div className="text-sm font-semibold text-zinc-900">
                Nenhuma URA cadastrada.
              </div>
              <p className="mt-1 text-sm text-zinc-500">
                Cadastre a primeira URA para iniciar sua arvore de versionamento.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {!selectedUra ? (
        <div className="rounded-3xl border border-dashed border-zinc-200 bg-white px-5 py-14 text-center shadow-sm">
          <GitBranch className="mx-auto h-10 w-10 text-zinc-300" />
          <h2 className="mt-3 text-base font-semibold text-zinc-900">
            Selecione uma URA para visualizar seu histórico de versionamento.
          </h2>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm">
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>{selectedUra.name}</CardTitle>
                  <CardDescription>
                    {selectedUra.description || "Timeline de versões implantadas."}
                  </CardDescription>
                </div>
                <Badge className="w-fit rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                  {versionCountLabel(versions.length)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {loadingVersions ? (
                <div className="grid gap-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-28 rounded-2xl" />
                  ))}
                </div>
              ) : versions.length ? (
                <div className="relative grid gap-1 py-1">
                  <div className="absolute bottom-8 left-5 top-8 w-px bg-zinc-200" />
                  {versions.map((version) => {
                    const meta = statusMeta(VERSION_STATUS_OPTIONS, version.status);
                    const selected = selectedVersionId === version.id;
                    return (
                      <button
                        key={version.id}
                        type="button"
                        className={cn(
                          "group relative grid min-h-[86px] grid-cols-[42px_minmax(0,1fr)] gap-3 rounded-2xl px-2 py-3 text-left transition",
                          "hover:bg-zinc-50",
                          selected
                            ? "bg-red-50/70 ring-1 ring-red-100"
                            : "bg-transparent",
                        )}
                        onClick={() => setSelectedVersionId(version.id)}
                      >
                        <span className="relative z-10 mt-2 grid h-8 w-8 place-items-center rounded-full bg-white">
                          <span
                            className={cn(
                              "grid h-7 w-7 place-items-center rounded-full border transition",
                              selected
                                ? "border-red-500 bg-red-600 text-white shadow-sm"
                                : version.status === "deployed"
                                  ? "border-emerald-200 bg-emerald-500 text-white"
                                  : "border-zinc-300 bg-white text-zinc-400 group-hover:border-red-200 group-hover:text-red-600",
                            )}
                          >
                            {version.status === "deployed" || selected ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : (
                              <span className="h-2 w-2 rounded-full bg-current" />
                            )}
                          </span>
                        </span>

                        <div
                          className={cn(
                            "min-w-0 rounded-2xl border px-4 py-3 transition",
                            selected
                              ? "border-red-200 bg-white shadow-sm"
                              : "border-transparent bg-transparent group-hover:border-zinc-200 group-hover:bg-white",
                          )}
                        >
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_150px] md:items-start">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-lg font-bold text-zinc-950">
                                  {version.version}
                                </span>
                                <Badge className={cn("rounded-full border px-2.5 py-1 text-[11px] tracking-wide", meta.className)}>
                                  {meta.label}
                                </Badge>
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600">
                                <span className="inline-flex items-center gap-1">
                                  <CalendarDays className="h-4 w-4 text-zinc-400" />
                                  Implantada em {formatDateBR(version.deploymentDate)}
                                </span>
                                {version.ticket ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Rocket className="h-4 w-4 text-zinc-400" />
                                    Ticket: {version.ticket}
                                  </span>
                                ) : null}
                              </div>

                              {version.developer ? (
                                <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
                                  <UserRound className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                                  <span className="truncate">{version.developer}</span>
                                </div>
                              ) : null}
                            </div>

                            <div className="hidden text-right md:block">
                              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                                Implantacao
                              </div>
                              <div className="mt-1 text-sm font-bold text-zinc-700">
                                {formatDateBR(version.deploymentDate)}
                              </div>
                            </div>
                          </div>

                          {version.description ? (
                            <p className="mt-3 line-clamp-2 text-sm text-zinc-500">
                              {version.description}
                            </p>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center">
                  <CheckCircle2 className="mx-auto h-9 w-9 text-zinc-300" />
                  <div className="mt-3 text-sm font-semibold text-zinc-900">
                    Esta URA ainda nao possui versionamentos.
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    Registre a primeira versão implantada para iniciar a timeline.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="h-fit rounded-3xl border-zinc-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Resumo da URA</CardTitle>
              <CardDescription>Contexto rápido do histórico selecionado.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <InfoRow label="Projeto" value={selectedUra.project || "Nao informado"} />
              <InfoRow label="Responsavel" value={selectedUra.owner || "Nao informado"} />
              <InfoRow label="Status" value={selectedUraStatus.label} />
              <InfoRow label="Versões" value={String(versions.length)} />
              <Separator />
              <Button
                type="button"
                className="rounded-xl bg-red-600 text-white hover:bg-red-700"
                onClick={openNewVersionModal}
              >
                <Plus className="mr-2 h-4 w-4" />
                Novo Versionamento
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <VersionDetailsSheet
        ura={selectedUra}
        version={selectedVersion}
        open={Boolean(selectedVersion)}
        onOpenChange={(open) => !open && setSelectedVersionId("")}
        onEdit={() => openEditVersionModal(selectedVersion)}
        onDelete={() => removeSelectedVersion(selectedVersion)}
      />

      <UraDialog
        open={uraModalOpen}
        onOpenChange={setUraModalOpen}
        form={uraForm}
        setForm={setUraForm}
        editing={Boolean(editingUra)}
        saving={saving}
        onSubmit={saveUra}
      />

      <VersionDialog
        open={versionModalOpen}
        onOpenChange={setVersionModalOpen}
        form={versionForm}
        setForm={setVersionForm}
        uras={uras}
        editing={Boolean(editingVersion)}
        saving={saving}
        onSubmit={saveVersion}
      />
    </section>
  );
}
function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
      <span className="text-zinc-500">{label}</span>
      <strong className="min-w-0 truncate text-right text-zinc-900">{value}</strong>
    </div>
  );
}

function VersionDetailsSheet({ ura, version, open, onOpenChange, onEdit, onDelete }) {
  const meta = statusMeta(VERSION_STATUS_OPTIONS, version?.status);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[calc(100vw-1.5rem)] overflow-y-auto rounded-l-2xl sm:max-w-xl">
        <SheetHeader className="pr-8">
          <SheetTitle>
            {version?.version ? `Versão ${version.version}` : "Detalhes da versão"}
          </SheetTitle>
          <SheetDescription>
            {ura?.name || "URA"} • {formatDateBR(version?.deploymentDate)}
          </SheetDescription>
        </SheetHeader>

        {version ? (
          <div className="mt-6 grid gap-5">
            <div className="flex flex-wrap gap-2">
              <Badge className={cn("rounded-full border", meta.className)}>
                {meta.label}
              </Badge>
              {version.ticket ? (
                <Badge className="rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700">
                  {version.ticket}
                </Badge>
              ) : null}
            </div>

            <div className="grid gap-2 text-sm">
              <InfoRow label="URA" value={ura?.name || "Nao informado"} />
              <InfoRow label="Data de implantação" value={formatDateBR(version.deploymentDate)} />
              <InfoRow label="Desenvolvedor" value={version.developer || "Nao informado"} />
              <InfoRow label="Ticket" value={version.ticket || "Nao informado"} />
            </div>

            {version.description ? (
              <section className="rounded-2xl border border-zinc-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-zinc-900">Descrição</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
                  {version.description}
                </p>
              </section>
            ) : null}

            <DetailList title="Mudancas realizadas" items={version.changes} />
            <DetailList title="Scripts alterados" items={version.scripts} icon={Code2} />

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="rounded-xl bg-red-600 text-white hover:bg-red-700"
                onClick={onEdit}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Editar Versionamento
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-red-200 bg-white text-red-700 hover:bg-red-50"
                onClick={onDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailList({ title, items, icon: Icon }) {
  const safeItems = Array.isArray(items) ? items : [];
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
        {Icon ? <Icon className="h-4 w-4 text-red-600" /> : null}
        {title}
      </h3>
      {safeItems.length ? (
        <ul className="mt-3 grid gap-2 text-sm text-zinc-700">
          {safeItems.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">Nenhum item informado.</p>
      )}
    </section>
  );
}

function UraDialog({ open, onOpenChange, form, setForm, editing, saving, onSubmit }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl rounded-2xl sm:w-full">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar URA" : "Nova URA"}</DialogTitle>
            <DialogDescription>
              Cadastre a URA para iniciar sua árvore e histórico de versionamentos.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 grid gap-3">
            <Input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Nome da URA"
              className="h-11 rounded-xl"
              required
            />
            <Textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descrição"
              className="min-h-24 rounded-xl"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={form.project}
                onChange={(event) => setForm((current) => ({ ...current, project: event.target.value }))}
                placeholder="Projeto vinculado"
                className="h-11 rounded-xl"
              />
              <Input
                value={form.owner}
                onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))}
                placeholder="Responsavel"
                className="h-11 rounded-xl"
              />
            </div>
            <Select
              value={form.status}
              onValueChange={(value) => setForm((current) => ({ ...current, status: value }))}
            >
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {URA_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-red-600 text-white hover:bg-red-700" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VersionDialog({ open, onOpenChange, form, setForm, uras, editing, saving, onSubmit }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl rounded-2xl sm:w-full max-h-[88vh] overflow-y-auto">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar Versionamento" : "Novo Versionamento"}
            </DialogTitle>
            <DialogDescription>
              Registre versão, data de implantação, ticket, responsável e alterações realizadas.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 grid gap-3">
            <Select
              value={form.uraId}
              onValueChange={(value) => setForm((current) => ({ ...current, uraId: value }))}
              required
            >
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue placeholder="URA" />
              </SelectTrigger>
              <SelectContent>
                {uras.map((ura) => (
                  <SelectItem key={ura.id} value={ura.id}>
                    {ura.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={form.version}
                onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))}
                placeholder="Versão (ex: v1.2.0)"
                className="h-11 rounded-xl"
                required
              />
              <Input
                type="date"
                value={form.deploymentDate}
                onChange={(event) => setForm((current) => ({ ...current, deploymentDate: event.target.value }))}
                className="h-11 rounded-xl"
                required
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={form.developer}
                onChange={(event) => setForm((current) => ({ ...current, developer: event.target.value }))}
                placeholder="Desenvolvedor"
                className="h-11 rounded-xl"
              />
              <Input
                value={form.ticket}
                onChange={(event) => setForm((current) => ({ ...current, ticket: event.target.value }))}
                placeholder="Ticket (ex: JIRA-245)"
                className="h-11 rounded-xl"
              />
            </div>

            <Textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descrição da versão"
              className="min-h-20 rounded-xl"
            />
            <Textarea
              value={form.changesText}
              onChange={(event) => setForm((current) => ({ ...current, changesText: event.target.value }))}
              placeholder={"Mudancas realizadas (uma por linha)\n- Adicionada validacao de CPF\n- Corrigido fallback do menu"}
              className="min-h-32 rounded-xl"
            />
            <Textarea
              value={form.scriptsText}
              onChange={(event) => setForm((current) => ({ ...current, scriptsText: event.target.value }))}
              placeholder={"Scripts alterados (um por linha)\natendimento.xml\nfinanceiro.xml"}
              className="min-h-24 rounded-xl"
            />

            <Select
              value={form.status}
              onValueChange={(value) => setForm((current) => ({ ...current, status: value }))}
            >
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {VERSION_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-red-600 text-white hover:bg-red-700" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
