import React, { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Paperclip, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { testJiraStatus } from "@/lib/auth";
import { jiraUploadIssueAttachments } from "@/lib/jiraClient";
import { cn } from "@/lib/utils";
import { createDashboardEvidencePdfFile } from "@/utils/cdrDashboardEvidencePdf";
import JiraTicketPicker from "./JiraTicketPicker";

function FieldLabel({ children }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </span>
  );
}

function jiraConnectionMessage() {
  return "Sem conexao com o Jira. Desconecte da VPN ou verifique sua conexao com a internet.";
}

export default function CdrDashboardEvidenceDialog({
  open,
  onOpenChange,
  analytics,
  filters,
  moduleOptions,
  moduleElements,
}) {
  const [ticketKey, setTicketKey] = useState("");
  const [selectedModules, setSelectedModules] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTicketKey("");
      setSelectedModules(new Set((moduleOptions || []).map((module) => module.id)));
    }
  }, [moduleOptions, open]);

  const selectedCount = selectedModules.size;
  const canSave = Boolean(ticketKey.trim()) && selectedCount > 0 && !saving;
  const isComparison = filters?.mode === "compare" || analytics?.source === "portal-export-compare";

  const modules = useMemo(
    () =>
      (moduleOptions || []).map((module) => ({
        ...module,
        selected: selectedModules.has(module.id),
      })),
    [moduleOptions, selectedModules],
  );

  function toggleModule(id) {
    setSelectedModules((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedModules((current) => {
      if (current.size === moduleOptions.length) return new Set();
      return new Set(moduleOptions.map((module) => module.id));
    });
  }

  async function handleSaveEvidence() {
    if (!canSave) return;
    setSaving(true);
    let stage = "jira";
    try {
      await testJiraStatus();
      stage = "pdf";
      const file = await createDashboardEvidencePdfFile({
        analytics,
        filters,
        modules,
        moduleElements,
      });
      stage = "upload";
      await jiraUploadIssueAttachments(ticketKey.trim(), [file]);
      toast.success(`Evidencia anexada em ${ticketKey.trim().toUpperCase()}.`);
      onOpenChange(false);
    } catch (err) {
      const status = err?.status || err?.body?.status;
      if (
        stage !== "pdf" &&
        (!status || status === 401 || status === 403 || /jira/i.test(err?.message || ""))
      ) {
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
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden p-0 sm:rounded-2xl">
        <DialogHeader className="border-b border-zinc-200 bg-white px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Paperclip className="h-4 w-4 text-red-600" />
            {isComparison
              ? "Salvar evidencia Comparativo CDR"
              : "Salvar evidencia Dashboard CDR"}
          </DialogTitle>
          <DialogDescription>
            Gere um PDF visual dos modulos selecionados e anexe no ticket Jira.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[70vh] gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-1.5">
            <FieldLabel>Ticket Jira</FieldLabel>
            <JiraTicketPicker value={ticketKey} onChange={setTicketKey} disabled={saving} />
          </div>

          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FieldLabel>Modulos da evidencia</FieldLabel>
              <Button type="button" variant="outline" size="sm" onClick={toggleAll} disabled={saving}>
                {selectedCount === moduleOptions.length ? "Limpar selecao" : "Selecionar todos"}
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {moduleOptions.map((module) => {
                const checked = selectedModules.has(module.id);
                return (
                  <button
                    key={module.id}
                    type="button"
                    className={cn(
                      "flex items-start gap-3 rounded-xl border px-3 py-3 text-left text-sm transition",
                      checked
                        ? "border-red-200 bg-red-50 text-red-800"
                        : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
                    )}
                    onClick={() => toggleModule(module.id)}
                    disabled={saving}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                        checked
                          ? "border-red-600 bg-red-600 text-white"
                          : "border-zinc-300 bg-white text-transparent",
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold">{module.label}</span>
                      <span className="mt-1 block text-xs text-zinc-500">
                        {module.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
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
