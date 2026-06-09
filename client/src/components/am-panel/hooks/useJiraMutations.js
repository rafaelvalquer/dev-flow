import { useCallback } from "react";
import { toast } from "sonner";

import {
  jiraEditIssue,
  jiraTransitionToStatus,
  jiraUpdateIssuePriority,
} from "../../../lib/jiraClient";
import { getIssueKey } from "../amPanelUtils";
import { DOCUMENTATION_FOLDER_LABEL } from "../amPanelConstants";

export default function useJiraMutations({
  refreshIssue,
  setDocumentationTicket,
  applyTicketDueDateLocal,
  applyTicketStatusLocal,
  setMovingPersonalKeys,
  setErr,
  formatJiraActionableError,
}) {
  const refreshIssueInPanel = useCallback(
    async (issueKey) => {
      const key = String(issueKey || "")
        .trim()
        .toUpperCase();
      if (!key) return null;

      const issue = await refreshIssue(key);
      setDocumentationTicket((prev) =>
        getIssueKey(prev) === key ? { ...prev, ...issue } : prev,
      );

      return issue;
    },
    [refreshIssue, setDocumentationTicket],
  );

  const refreshTicketAfterMutation = useCallback(
    async (issueKey) => {
      const key = String(issueKey || "")
        .trim()
        .toUpperCase();
      if (!key) return null;
      return refreshIssueInPanel(key);
    },
    [refreshIssueInPanel],
  );

  async function setDocumentationFolderFlag(issueKey, enabled) {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!key) return;

    await jiraEditIssue(key, {
      update: {
        labels: [
          enabled
            ? { add: DOCUMENTATION_FOLDER_LABEL }
            : { remove: DOCUMENTATION_FOLDER_LABEL },
        ],
      },
    });
    return refreshTicketAfterMutation(key);
  }

  async function updateTicketPriority(issueKey, priorityName) {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!key || !priorityName) return;
    await jiraUpdateIssuePriority(key, priorityName);
    return refreshTicketAfterMutation(key);
  }

  async function updateTicketStatus(issueKey, statusName) {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!key || !statusName) return;
    await jiraTransitionToStatus(key, statusName);
    return refreshTicketAfterMutation(key);
  }

  async function updateTicketDueDate(issueKey, dueDate) {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    const nextDueDate = String(dueDate || "").slice(0, 10);
    if (!key) return;

    await jiraEditIssue(key, {
      fields: {
        duedate: nextDueDate || null,
      },
    });
    applyTicketDueDateLocal?.(key, nextDueDate);
    setDocumentationTicket((prev) =>
      getIssueKey(prev) === key
        ? {
            ...prev,
            dueDateRaw: nextDueDate,
            dueDate: nextDueDate,
            duedate: nextDueDate,
            fields: {
              ...(prev.fields || {}),
              duedate: nextDueDate || null,
            },
          }
        : prev,
    );
    return refreshTicketAfterMutation(key);
  }

  async function movePersonalTicketStatus(issueKey, statusName, previousStatus) {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    const nextStatus = String(statusName || "").trim();
    const prevStatus = String(previousStatus || "").trim();
    if (!key || !nextStatus || nextStatus === prevStatus) return;

    setMovingPersonalKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setErr("");
    applyTicketStatusLocal(key, nextStatus);

    try {
      await jiraTransitionToStatus(key, nextStatus);
      await refreshTicketAfterMutation(key).catch(() => null);
      toast.success(`${key} movido para ${nextStatus}.`);
    } catch (e) {
      console.error(e);
      applyTicketStatusLocal(key, prevStatus);
      const message = formatJiraActionableError(e, {
        type: "transition",
        issueKey: key,
        fallback: `Não foi possível mover ${key} para ${nextStatus}.`,
      });
      setErr(message);
      toast.error(message);
    } finally {
      setMovingPersonalKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  return {
    refreshIssueInPanel,
    refreshTicketAfterMutation,
    setDocumentationFolderFlag,
    updateTicketPriority,
    updateTicketStatus,
    updateTicketDueDate,
    movePersonalTicketStatus,
  };
}
