import { useCallback } from "react";
import { toast } from "sonner";

import { buildDailyStatus } from "../utils/developerRiskRules";
import {
  copyTextToClipboard,
  getJiraBrowseUrl,
} from "../utils/developerTicketUtils";

export function useDeveloperWorkspaceActions({
  contextTicketKey,
  contextIssue,
  sortedRows,
  riskRows,
  onOpenExecution,
}) {
  return useCallback(
    async (action) => {
      if (action === "daily") {
        try {
          const text = buildDailyStatus(sortedRows, riskRows);
          const copied = await copyTextToClipboard(text);
          if (!copied) throw new Error("Clipboard indisponível.");
          toast.success("Status daily copiado.");
        } catch (err) {
          toast.error("Não foi possível copiar o status daily.", {
            description: err?.message || String(err),
          });
        }
        return;
      }

      const key = contextTicketKey;
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

      if (action === "comment") {
        onOpenExecution(key, { activeTab: "comentarios" });
        return;
      }

      if (action === "evidence") {
        onOpenExecution(key, { activeTab: "evidencias" });
      }
    },
    [contextIssue, contextTicketKey, onOpenExecution, riskRows, sortedRows],
  );
}
