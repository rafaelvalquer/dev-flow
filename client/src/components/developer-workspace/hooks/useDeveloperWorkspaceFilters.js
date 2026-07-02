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

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfYesterday() {
  const date = startOfToday();
  date.setDate(date.getDate() - 1);
  return date;
}

function countUpdatedSinceYesterday(rows = []) {
  const start = startOfYesterday().getTime();

  return rows.filter((issue) => {
    const updatedAt = getUpdatedDate(issue);
    return updatedAt && updatedAt.getTime() >= start;
  }).length;
}

function buildActiveTicketsHelper(stats) {
  const updatedSinceYesterday = Number(stats?.updatedSinceYesterday || 0);

  if (updatedSinceYesterday <= 0) {
    return "Nenhuma atualização desde ontem";
  }

  if (updatedSinceYesterday === 1) {
    return "1 atualizado desde ontem";
  }

  return `${updatedSinceYesterday} atualizados desde ontem`;
}

function isKnownPriority(priority) {
  const normalized = norm(priority);
  return (
    normalized.includes("highest") ||
    normalized.includes("high") ||
    normalized.includes("alta") ||
    normalized.includes("medium") ||
    normalized.includes("media") ||
    normalized.includes("low") ||
    normalized.includes("baixa")
  );
}

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
        if (priorityFilter === "other") {
          if (isKnownPriority(getPriority(issue))) return false;
        } else if (!norm(getPriority(issue)).includes(priorityFilter)) {
          return false;
        }
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
      if (pendencyFilter === "waitingGmud" && !isAwaitingGmud(issue))
        return false;

      return true;
    });
  }, [
    dueFilter,
    pendencyFilter,
    priorityFilter,
    search,
    sortedRows,
    statusFilter,
  ]);

  const stats = useMemo(() => {
    const active = sortedRows.length;

    const dueSoon = sortedRows.filter((issue) => {
      const days = diffDaysFromToday(getDueYmd(issue));
      return days !== null && days >= 0 && days <= 2;
    }).length;

    const noEvidence = sortedRows.filter((issue) => !hasEvidence(issue)).length;
    const waitingGmud = sortedRows.filter(isAwaitingGmud).length;
    const updatedSinceYesterday = countUpdatedSinceYesterday(sortedRows);

    return {
      active,
      dueSoon,
      noEvidence,
      waitingGmud,
      updatedSinceYesterday,
      activeHelper: buildActiveTicketsHelper({
        updatedSinceYesterday,
      }),
    };
  }, [sortedRows]);

  return { filteredRows, sortedRows, stats };
}
