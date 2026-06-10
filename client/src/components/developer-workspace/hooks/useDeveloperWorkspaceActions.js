import { useCallback } from "react";
import { toast } from "sonner";

import { buildNextActions } from "../utils/developerRiskRules";
import {
  copyTextToClipboard,
  getJiraBrowseUrl,
  getProgress,
  getStatus,
  getSummary,
} from "../utils/developerTicketUtils";

export function useDeveloperWorkspaceActions({
  contextTicketKey,
  contextIssue,
  sortedRows,
  onOpenExecution,
}) {
  return useCallback(
    async (action) => {
      const key = contextTicketKey;

      if (action === "nextPending") {
        const nextAction = buildNextActions(sortedRows, 1)[0];
        if (!nextAction?.key) {
          toast.info("Nenhuma pendência imediata encontrada.");
          return;
        }
        onOpenExecution(nextAction.key);
        return;
      }

      if (!key) {
        toast.warning("Selecione ou acesse um ticket para usar este atalho.");
        return;
      }

      if (action === "jira") {
        const url = getJiraBrowseUrl(key, contextIssue);
        if (!url) {
          toast.error("Não foi possível montar a URL do Jira.");
          return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }

      if (action === "continue") {
        onOpenExecution(key);
        return;
      }

      if (action === "comment") {
        onOpenExecution(key, { activeTab: "comentarios" });
        return;
      }

      if (action === "evidence") {
        onOpenExecution(key, { activeTab: "evidencias" });
        return;
      }

      if (action === "copyTicket") {
        try {
          const summary = getSummary(contextIssue);
          const status = getStatus(contextIssue) || "Sem status";
          const progress = getProgress(contextIssue);
          const text = `${key} - ${summary} - ${status} - ${progress}%`;
          const copied = await copyTextToClipboard(text);
          if (!copied) throw new Error("Clipboard indisponível.");
          toast.success("Ticket copiado.");
        } catch (err) {
          toast.error("Não foi possível copiar o ticket.", {
            description: err?.message || String(err),
          });
        }
      }
    },
    [contextIssue, contextTicketKey, onOpenExecution, sortedRows],
  );
}
