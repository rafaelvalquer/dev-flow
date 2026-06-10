import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../DeveloperCenterTab.css";

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

import ChecklistGMUDTab from "../ChecklistGMUDTab";
import { registerDeveloperRecentTicket } from "../../lib/developerWorkspace";

import DeveloperWorkspace from "./DeveloperWorkspace";
import { useDeveloperWorkspaceData } from "./hooks/useDeveloperWorkspaceData";
import {
  findTicketByKey,
  getPriority,
  getStatus,
  getSummary,
  normalizeTicketKey,
} from "./utils/developerTicketUtils";

export default function DeveloperCenterTab({
  currentUser,
  poData,
  onConfigureUser,
  onProgressChange,
  onRdmTitleChange,
  onRdmDueDateChange,
}) {
  const [mode, setMode] = useState("workspace");
  const [selectedTicketKey, setSelectedTicketKey] = useState("");
  const [selectedInitialTab, setSelectedInitialTab] = useState("");
  const [executionContext, setExecutionContext] = useState({
    activeTab: "",
    progress: 0,
  });
  const recentSaveTimer = useRef(null);

  const {
    workspace,
    workspaceLoading,
    sourceRows,
    personalRows,
    updateWorkspaceFromSave,
  } = useDeveloperWorkspaceData({ currentUser, poData });

  const selectedTicket = useMemo(
    () => findTicketByKey(personalRows, selectedTicketKey),
    [personalRows, selectedTicketKey],
  );

  const registerRecent = useCallback(
    async (ticketKey, patch = {}) => {
      const key = normalizeTicketKey(ticketKey);
      if (!key) return;
      const issue = findTicketByKey(personalRows, key);
      const nextWorkspace = await registerDeveloperRecentTicket(key, {
        summary: patch.summary ?? getSummary(issue),
        status: patch.status ?? getStatus(issue),
        priority: patch.priority ?? getPriority(issue),
        activeTab: patch.activeTab ?? executionContext.activeTab,
        progress: patch.progress ?? executionContext.progress,
      });
      updateWorkspaceFromSave(nextWorkspace);
    },
    [
      executionContext.activeTab,
      executionContext.progress,
      personalRows,
      updateWorkspaceFromSave,
    ],
  );

  function openExecution(ticketKey, opts = {}) {
    const key = normalizeTicketKey(ticketKey);
    if (!key) return;
    const recent = workspace.recentTickets.find(
      (item) => normalizeTicketKey(item.ticketKey) === key,
    );
    setSelectedTicketKey(key);
    setSelectedInitialTab(opts.activeTab ?? recent?.activeTab ?? "");
    setExecutionContext({
      activeTab: opts.activeTab ?? recent?.activeTab ?? "",
      progress: Number(recent?.progress || 0),
    });
    setMode("execution");
    registerRecent(key, {
      activeTab: opts.activeTab ?? recent?.activeTab ?? "",
      progress: Number(recent?.progress || 0),
    }).catch(() => null);
  }

  const handleExecutionContextChange = useCallback((next = {}) => {
    setExecutionContext((prev) => ({
      ...prev,
      ...next,
      progress:
        next.progress === undefined
          ? prev.progress
          : Math.max(0, Math.min(100, Number(next.progress || 0))),
    }));
  }, []);

  const handleChecklistProgress = useCallback(
    (progress) => {
      handleExecutionContextChange({ progress });
      onProgressChange?.(progress);
    },
    [handleExecutionContextChange, onProgressChange],
  );

  useEffect(() => {
    if (mode !== "execution" || !selectedTicketKey) return undefined;
    window.clearTimeout(recentSaveTimer.current);
    recentSaveTimer.current = window.setTimeout(() => {
      registerRecent(selectedTicketKey).catch(() => null);
    }, 900);

    return () => window.clearTimeout(recentSaveTimer.current);
  }, [executionContext, mode, registerRecent, selectedTicketKey]);

  function backToWorkspace() {
    if (selectedTicketKey) registerRecent(selectedTicketKey).catch(() => null);
    setMode("workspace");
  }

  if (mode === "execution") {
    return (
      <div className="developer-center developer-center--execution">
        <div className="developer-execution-return">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={backToWorkspace}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Workspace
          </Button>
          <div className="developer-execution-return__copy">
            <strong>{selectedTicketKey || "Ticket"}</strong>
            <span>{selectedTicket ? getSummary(selectedTicket) : "Execução operacional"}</span>
          </div>
        </div>
        <ChecklistGMUDTab
          key={selectedTicketKey}
          initialTicketJira={selectedTicketKey}
          initialActiveTab={selectedInitialTab}
          autoSyncOnOpen={workspace.preferences.autoSyncOnOpen !== false}
          onBackToWorkspace={backToWorkspace}
          onExecutionContextChange={handleExecutionContextChange}
          onProgressChange={handleChecklistProgress}
          onRdmTitleChange={onRdmTitleChange}
          onRdmDueDateChange={onRdmDueDateChange}
        />
      </div>
    );
  }

  return (
    <DeveloperWorkspace
      currentUser={currentUser}
      rows={personalRows}
      allRows={sourceRows}
      workspace={workspace}
      loading={Boolean(poData?.loading || workspaceLoading)}
      reloadProgress={poData?.reloadProgress}
      error={poData?.err}
      onReload={() => poData?.reload?.()}
      onConfigureUser={onConfigureUser}
      onOpenExecution={openExecution}
      onWorkspaceSaved={updateWorkspaceFromSave}
    />
  );
}
