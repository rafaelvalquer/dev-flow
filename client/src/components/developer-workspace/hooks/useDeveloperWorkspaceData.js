import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { fetchDeveloperWorkspace } from "../../../lib/developerWorkspace";
import {
  getAssigneeAccountId,
  mergeWorkspace,
} from "../utils/developerTicketUtils";
import { EMPTY_WORKSPACE } from "../utils/developerWidgetRegistry";

export function useDeveloperWorkspaceData({ currentUser, poData }) {
  const [workspace, setWorkspace] = useState(EMPTY_WORKSPACE);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);

  const sourceRows = poData?.rawIssues?.length ? poData.rawIssues : poData?.rows || [];
  const accountId = String(currentUser?.jiraAccountId || "").trim();

  const personalRows = useMemo(() => {
    if (!accountId) return [];
    return (sourceRows || []).filter((issue) => {
      const issueAccountId = String(getAssigneeAccountId(issue)).trim();
      return issueAccountId && issueAccountId === accountId;
    });
  }, [accountId, sourceRows]);

  useEffect(() => {
    poData?.ensureLoaded?.().catch(() => null);
  }, [poData]);

  useEffect(() => {
    let active = true;
    setWorkspaceLoading(true);
    fetchDeveloperWorkspace()
      .then((data) => {
        if (active) setWorkspace(mergeWorkspace(data));
      })
      .catch((err) => {
        console.error(err);
        if (active) toast.error("Não foi possível carregar o workspace.");
      })
      .finally(() => {
        if (active) setWorkspaceLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const updateWorkspaceFromSave = useCallback((nextWorkspace) => {
    if (!nextWorkspace) return;
    setWorkspace(mergeWorkspace(nextWorkspace));
  }, []);

  return {
    workspace,
    workspaceLoading,
    sourceRows,
    personalRows,
    updateWorkspaceFromSave,
  };
}
