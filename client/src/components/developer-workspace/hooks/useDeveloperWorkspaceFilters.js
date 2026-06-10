import { useMemo } from "react";

import {
  diffDaysFromToday,
  getDueYmd,
  getIssueKey,
  getPriority,
  getStatus,
  getSummary,
  getUpdatedDate,
  hasEvidence,
  isAwaitingGmud,
  isDone,
  norm,
} from "../utils/developerTicketUtils";

export function useDeveloperWorkspaceFilters({
  rows,
  preferences,
  search,
  statusFilter,
  priorityFilter,
  dueFilter,
  pendencyFilter,
}) {
  const sortedRows = useMemo(() => {
    const list = [...(rows || [])].filter((issue) => !isDone(issue));
    const sortBy = preferences.sortBy || "dueDate";

    return list.sort((a, b) => {
      if (sortBy === "priority") {
        return norm(getPriority(a)).localeCompare(norm(getPriority(b)));
      }
      if (sortBy === "updated") {
        return (
          (getUpdatedDate(b)?.getTime() || 0) -
          (getUpdatedDate(a)?.getTime() || 0)
        );
      }
      if (sortBy === "status") {
        return getStatus(a).localeCompare(getStatus(b));
      }
      const aDue = getDueYmd(a) || "9999-12-31";
      const bDue = getDueYmd(b) || "9999-12-31";
      return aDue.localeCompare(bDue);
    });
  }, [preferences.sortBy, rows]);

  const filteredRows = useMemo(() => {
    const q = norm(search);
    return sortedRows.filter((issue) => {
      const summary = getSummary(issue);
      const key = getIssueKey(issue);
      if (q && !norm(`${key} ${summary}`).includes(q)) return false;

      if (statusFilter !== "all") {
        const wanted = norm(statusFilter);
        if (!norm(getStatus(issue)).includes(wanted)) return false;
      }

      if (priorityFilter !== "all") {
        if (!norm(getPriority(issue)).includes(priorityFilter)) return false;
      }

      const due = getDueYmd(issue);
      const days = diffDaysFromToday(due);
      if (dueFilter === "none" && due) return false;
      if (dueFilter === "overdue" && !(days !== null && days < 0)) return false;
      if (dueFilter === "today" && days !== 0) return false;
      if (dueFilter === "week" && !(days !== null && days >= 0 && days <= 7)) {
        return false;
      }

      if (pendencyFilter === "noEvidence" && hasEvidence(issue)) return false;
      if (pendencyFilter === "waitingGmud" && !isAwaitingGmud(issue)) return false;

      return true;
    });
  }, [dueFilter, pendencyFilter, priorityFilter, search, sortedRows, statusFilter]);

  const stats = useMemo(() => {
    const active = sortedRows.length;
    const dueSoon = sortedRows.filter((issue) => {
      const days = diffDaysFromToday(getDueYmd(issue));
      return days !== null && days >= 0 && days <= 2;
    }).length;
    const noEvidence = sortedRows.filter((issue) => !hasEvidence(issue)).length;
    const waitingGmud = sortedRows.filter(isAwaitingGmud).length;

    return { active, dueSoon, noEvidence, waitingGmud };
  }, [sortedRows]);

  return { filteredRows, sortedRows, stats };
}
