import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "../DeveloperCenterTab.css";

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

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

const ChecklistGMUDTab = lazy(() => import("../ChecklistGMUDTab"));

function ChecklistLoadingFallback() {
  return (
    <div
      className="developer-execution-loading"
      role="status"
      aria-live="polite"
    >
      <span className="developer-execution-loading__spinner" aria-hidden="true" />
      <span>Carregando jornada operacional...</span>
    </div>
  );
}

export default function DeveloperCenterTab({
  currentUser,
  poData,
  onConfigureUser,
  onStartTicket,
  onOpenTicketDetails,
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
  const executionContextRef = useRef(executionContext);

  const {
    workspace,
    workspaceLoading,
    sourceRows,
    personalRows,
    updateWorkspaceFromSave,
  } = useDeveloperWorkspaceData({ currentUser, poData });

  useEffect(() => {
    executionContextRef.current = executionContext;
  }, [executionContext]);

  const selectedTicket = useMemo(
    () => findTicketByKey(personalRows, selectedTicketKey),
    [personalRows, selectedTicketKey],
  );

  const registerRecent = useCallback(
    async (ticketKey, patch = {}) => {
      const key = normalizeTicketKey(ticketKey);
      if (!key) return;

      const issue = findTicketByKey(personalRows, key);
      const currentExecutionContext = executionContextRef.current || {};

      const nextWorkspace = await registerDeveloperRecentTicket(key, {
        summary: patch.summary ?? getSummary(issue),
        status: patch.status ?? getStatus(issue),
        priority: patch.priority ?? getPriority(issue),
        activeTab: patch.activeTab ?? currentExecutionContext.activeTab,
        progress: patch.progress ?? currentExecutionContext.progress,
      });

      updateWorkspaceFromSave(nextWorkspace);
    },
    [personalRows, updateWorkspaceFromSave],
  );

  const handleTicketUpdatedFromDetails = useCallback(
    async (ticketKey) => {
      const key = normalizeTicketKey(ticketKey);
      if (!key) return null;

      return poData?.refreshIssue?.(key);
    },
    [poData],
  );

  const openExecution = useCallback(
    (ticketKey, opts = {}) => {
      const key = normalizeTicketKey(ticketKey);
      if (!key) return;

      const recent = (workspace.recentTickets || []).find(
        (item) => normalizeTicketKey(item.ticketKey) === key,
      );

      const activeTab = opts.activeTab ?? recent?.activeTab ?? "";
      const progress = Number(recent?.progress || 0);

      setSelectedTicketKey(key);
      setSelectedInitialTab(activeTab);
      setExecutionContext({
        activeTab,
        progress,
      });
      setMode("execution");

      registerRecent(key, {
        activeTab,
        progress,
      }).catch(() => null);
    },
    [registerRecent, workspace.recentTickets],
  );

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
  }, [mode, registerRecent, selectedTicketKey]);

  const backToWorkspace = useCallback(() => {
    if (selectedTicketKey) {
      registerRecent(selectedTicketKey).catch(() => null);
    }

    setMode("workspace");
  }, [registerRecent, selectedTicketKey]);

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
            <span>
              {selectedTicket
                ? getSummary(selectedTicket)
                : "Execução operacional"}
            </span>
          </div>
        </div>

        <Suspense fallback={<ChecklistLoadingFallback />}>
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
        </Suspense>
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
      onStartTicket={onStartTicket}
      onOpenTicketDetails={onOpenTicketDetails}
      onTicketUpdatedFromDetails={handleTicketUpdatedFromDetails}
      onWorkspaceSaved={updateWorkspaceFromSave}
    />
  );
}
