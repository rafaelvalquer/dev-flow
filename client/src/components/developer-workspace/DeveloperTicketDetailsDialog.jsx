import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ExternalLink,
  Loader2,
  Play,
  Save,
  Ticket,
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
import { Separator } from "@/components/ui/separator";

import { jiraEditIssue } from "../../lib/jiraClient";
import {
  ATIVIDADES_PADRAO,
  buildCronogramaADF,
  parseCronogramaADF,
} from "../../utils/cronograma";
import {
  dueLabel,
  getAssigneeName,
  getIssueKey,
  getJiraBrowseUrl,
  getPriority,
  getStatus,
  getSummary,
} from "./utils/developerTicketUtils";

function buildDefaultSchedule() {
  return ATIVIDADES_PADRAO.map((atividade) => ({
    id: atividade.id,
    name: atividade.name,
    data: "",
    recurso: "",
    area: "",
    risk: false,
    risco: "",
  }));
}

function getIssueScheduleAdf(issue) {
  return (
    issue?.cronogramaAdf ||
    issue?.customfield_14017 ||
    issue?.fields?.customfield_14017 ||
    null
  );
}

function hasScheduleData(atividades = []) {
  return atividades.some((atividade) =>
    [
      atividade?.data,
      atividade?.recurso,
      atividade?.area,
      atividade?.risco,
    ].some((value) => String(value || "").trim()),
  );
}

function normalizeSchedule(issue) {
  const parsed = parseCronogramaADF(getIssueScheduleAdf(issue));
  return parsed.length ? parsed : buildDefaultSchedule();
}

export default function DeveloperTicketDetailsDialog({
  open,
  action,
  issue,
  onClose,
  onOpenExecution,
  onScheduleSaved,
}) {
  const [scheduleDraft, setScheduleDraft] = useState(() =>
    buildDefaultSchedule(),
  );
  const [savingSchedule, setSavingSchedule] = useState(false);

  const issueKey = getIssueKey(issue) || action?.key || "";
  const title = getSummary(issue);
  const status = getStatus(issue) || "Sem status";
  const assignee = getAssigneeName(issue);
  const priority = getPriority(issue);
  const jiraUrl = getJiraBrowseUrl(issueKey, issue);

  const hasExistingSchedule = useMemo(
    () => hasScheduleData(normalizeSchedule(issue)),
    [issue],
  );

  useEffect(() => {
    if (!open) return;
    setScheduleDraft(normalizeSchedule(issue));
  }, [issue, open]);

  function updateActivity(activityId, patch) {
    setScheduleDraft((current) =>
      current.map((activity) =>
        activity.id === activityId ? { ...activity, ...patch } : activity,
      ),
    );
  }

  async function handleSaveSchedule() {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!key) {
      toast.error("Ticket inválido para salvar cronograma.");
      return;
    }

    setSavingSchedule(true);

    try {
      const adf = buildCronogramaADF(scheduleDraft);

      await jiraEditIssue(key, {
        fields: {
          customfield_14017: adf,
        },
      });

      await onScheduleSaved?.(key, scheduleDraft);

      toast.success("Cronograma salvo no Jira.");
    } catch (err) {
      toast.error("Não foi possível salvar o cronograma.", {
        description: err?.message || String(err),
      });
    } finally {
      setSavingSchedule(false);
    }
  }

  function handleOpenExecution() {
    if (!issueKey) return;
    onOpenExecution?.(issueKey, { activeTab: "" });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose?.()}>
      <DialogContent className="max-h-[90vh] w-[min(1080px,calc(100vw-32px))] max-w-[min(1080px,calc(100vw-32px))] overflow-hidden rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-red-600" />
            {issueKey
              ? `${issueKey} — Detalhes do ticket`
              : "Detalhes do ticket"}
          </DialogTitle>
          <DialogDescription>
            Revise o ticket, inicie o checklist GMUD ou monte o cronograma de
            implantação.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[68vh] gap-5 overflow-y-auto pr-1">
          <section className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                    {status}
                  </Badge>
                  <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                    {priority}
                  </Badge>
                  <Badge className="rounded-full border border-zinc-200 bg-white text-zinc-700">
                    {dueLabel(issue)}
                  </Badge>
                </div>

                <h3 className="mt-3 text-base font-semibold leading-snug text-zinc-950">
                  {title}
                </h3>

                <p className="mt-1 text-sm text-zinc-500">
                  Responsável:{" "}
                  <strong className="font-semibold text-zinc-800">
                    {assignee || "Sem responsável"}
                  </strong>
                </p>
              </div>

              {jiraUrl ? (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl border-zinc-200 bg-white"
                  onClick={() =>
                    window.open(jiraUrl, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Abrir Jira
                </Button>
              ) : null}
            </div>

            {action?.description ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {action.description}
              </div>
            ) : null}
          </section>

          <section className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
                  <CalendarDays className="h-4 w-4 text-red-600" />
                  Cronograma do ticket
                </h3>
                <p className="text-xs text-zinc-500">
                  Preencha as atividades e salve no campo Informações Adicionais
                  do Jira.
                </p>
              </div>

              <Badge
                className={
                  hasExistingSchedule
                    ? "rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "rounded-full border border-amber-200 bg-amber-50 text-amber-800"
                }
              >
                {hasExistingSchedule
                  ? "Cronograma encontrado"
                  : "Sem cronograma"}
              </Badge>
            </div>

            <div className="grid gap-2">
              <div className="hidden rounded-xl bg-zinc-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500 lg:grid lg:grid-cols-[1.4fr_1fr_1fr_1fr_90px]">
                <span>Atividade</span>
                <span>Data</span>
                <span>Recurso</span>
                <span>Área</span>
                <span>Risco</span>
              </div>

              {scheduleDraft.map((activity) => (
                <div
                  key={activity.id}
                  className="grid gap-2 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr_90px] lg:items-center"
                >
                  <div>
                    <span className="text-[11px] font-bold uppercase text-zinc-500 lg:hidden">
                      Atividade
                    </span>
                    <div className="text-sm font-semibold text-zinc-900">
                      {activity.name}
                    </div>
                  </div>

                  <label className="grid gap-1">
                    <span className="text-[11px] font-bold uppercase text-zinc-500 lg:hidden">
                      Data
                    </span>
                    <Input
                      value={activity.data || ""}
                      onChange={(event) =>
                        updateActivity(activity.id, {
                          data: event.target.value,
                        })
                      }
                      placeholder="DD/MM ou DD/MM a DD/MM"
                      className="h-10 rounded-xl border-zinc-200 bg-white"
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-[11px] font-bold uppercase text-zinc-500 lg:hidden">
                      Recurso
                    </span>
                    <Input
                      value={activity.recurso || ""}
                      onChange={(event) =>
                        updateActivity(activity.id, {
                          recurso: event.target.value,
                        })
                      }
                      placeholder="Responsável"
                      className="h-10 rounded-xl border-zinc-200 bg-white"
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-[11px] font-bold uppercase text-zinc-500 lg:hidden">
                      Área
                    </span>
                    <Input
                      value={activity.area || ""}
                      onChange={(event) =>
                        updateActivity(activity.id, {
                          area: event.target.value,
                        })
                      }
                      placeholder="Área"
                      className="h-10 rounded-xl border-zinc-200 bg-white"
                    />
                  </label>

                  <label className="flex h-10 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700">
                    <input
                      type="checkbox"
                      checked={Boolean(activity.risk || activity.risco)}
                      onChange={(event) =>
                        updateActivity(activity.id, {
                          risk: event.target.checked,
                          risco: event.target.checked ? "Risco" : "",
                        })
                      }
                    />
                    Risco
                  </label>
                </div>
              ))}
            </div>
          </section>
        </div>

        <Separator />

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl border-zinc-200 bg-white"
            onClick={onClose}
          >
            Fechar
          </Button>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-zinc-200 bg-white"
              onClick={handleOpenExecution}
              disabled={!issueKey}
            >
              <Play className="mr-2 h-4 w-4" />
              Iniciar Ticket
            </Button>

            <Button
              type="button"
              className="rounded-xl bg-red-600 text-white hover:bg-red-700"
              onClick={handleSaveSchedule}
              disabled={savingSchedule || !issueKey}
            >
              {savingSchedule ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar cronograma
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
