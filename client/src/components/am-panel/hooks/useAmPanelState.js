import { useEffect, useMemo, useState } from "react";

import {
  buildPoInsights,
  filterPoViewData,
  getScopedIssueKeysFromPreset,
} from "../../../lib/poInsights";

export default function useAmPanelState({
  personalMode,
  currentUser,
  rawIssues,
  doneRows,
  viewData,
}) {
  const [subView, setSubView] = useState(personalMode ? "dashboard" : "acoes");
  const [personalSubView, setPersonalSubView] = useState("queue");
  const [activePreset, setActivePreset] = useState(
    personalMode ? "mine" : "all",
  );
  const [ownerFocus, setOwnerFocus] = useState(
    currentUser?.jiraDisplayName || currentUser?.name || "",
  );
  const [dashTab, setDashTab] = useState("alertas");
  const [searchText, setSearchText] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState([]);
  const [selectedAssignees, setSelectedAssignees] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [sortBy, setSortBy] = useState("updatedDesc");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsKey, setDetailsKey] = useState("");
  const [documentationOpen, setDocumentationOpen] = useState(false);
  const [documentationTicket, setDocumentationTicket] = useState(null);
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [resolutionTicket, setResolutionTicket] = useState(null);
  const [resolutionProblem, setResolutionProblem] = useState(null);
  const [resolutionComment, setResolutionComment] = useState("");
  const [resolutionDueDate, setResolutionDueDate] = useState("");
  const [resolutionSaving, setResolutionSaving] = useState(false);
  const [resolutionErr, setResolutionErr] = useState("");
  const [createIssueOpen, setCreateIssueOpen] = useState(false);
  const [colorMode, setColorMode] = useState("ticket");
  const [calendarFilter, setCalendarFilter] = useState("");
  const [movingPersonalKeys, setMovingPersonalKeys] = useState(() => new Set());

  const ownerAccountId = String(currentUser?.jiraAccountId || "").trim();
  const effectiveOwnerFocus =
    currentUser?.jiraDisplayName || ownerFocus || currentUser?.name || "";
  const insightOwnerAccountId = personalMode ? ownerAccountId : "";
  const insightOwnerFocus = personalMode ? effectiveOwnerFocus : "";
  const effectiveActivePreset =
    !personalMode && activePreset === "mine" ? "all" : activePreset;

  useEffect(() => {
    if (!personalMode) return;
    setActivePreset("mine");
  }, [personalMode, ownerAccountId]);

  useEffect(() => {
    if (!personalMode && activePreset === "mine") {
      setActivePreset("all");
    }
  }, [activePreset, personalMode]);

  useEffect(() => {
    if (currentUser?.jiraDisplayName) {
      setOwnerFocus(currentUser.jiraDisplayName);
    }
  }, [currentUser?.jiraDisplayName]);

  const poInsights = useMemo(
    () =>
      buildPoInsights({
        rawIssues,
        viewData,
        doneRows,
        ownerFocus: insightOwnerFocus,
        ownerAccountId: insightOwnerAccountId,
        excludeDoneFromOperationalSummary: personalMode,
      }),
    [
      rawIssues,
      viewData,
      doneRows,
      insightOwnerFocus,
      insightOwnerAccountId,
      personalMode,
    ],
  );

  const scopedIssueKeys = useMemo(
    () =>
      getScopedIssueKeysFromPreset({
        insights: poInsights,
        activePreset: effectiveActivePreset,
        ownerFocus: insightOwnerFocus,
        ownerAccountId: insightOwnerAccountId,
      }),
    [
      poInsights,
      effectiveActivePreset,
      insightOwnerFocus,
      insightOwnerAccountId,
    ],
  );

  const scopedViewData = useMemo(
    () => filterPoViewData(viewData, scopedIssueKeys),
    [viewData, scopedIssueKeys],
  );

  const scopedRawIssues = useMemo(
    () =>
      rawIssues.filter((issue) =>
        scopedIssueKeys.has(
          String(issue?.key || "")
            .trim()
            .toUpperCase(),
        ),
      ),
    [rawIssues, scopedIssueKeys],
  );

  const scopedDoneRows = useMemo(() => {
    if (personalMode) {
      const accountId = String(ownerAccountId || "").trim();
      const ownerName = String(effectiveOwnerFocus || "").trim().toLowerCase();
      return doneRows.filter((issue) => {
        const issueAccountId = String(issue?.assigneeAccountId || "").trim();
        if (accountId && issueAccountId) return issueAccountId === accountId;
        if (!ownerName) return false;
        const issueOwner = String(
          issue?.assignee || issue?.assigneeDisplayName || "",
        ).toLowerCase();
        return issueOwner.includes(ownerName);
      });
    }

    return doneRows.filter((issue) =>
      scopedIssueKeys.has(
        String(issue?.key || "")
          .trim()
          .toUpperCase(),
      ),
    );
  }, [doneRows, effectiveOwnerFocus, ownerAccountId, personalMode, scopedIssueKeys]);

  const scopedAlertas = useMemo(
    () => scopedViewData.alertas || [],
    [scopedViewData],
  );
  const scopedCriarCronograma = useMemo(
    () => scopedViewData.criarCronograma || [],
    [scopedViewData],
  );
  const ticketMetaMap = useMemo(
    () =>
      new Map(
        (poInsights?.items || []).map((item) => [String(item.key || ""), item]),
      ),
    [poInsights],
  );

  return {
    subView,
    setSubView,
    personalSubView,
    setPersonalSubView,
    activePreset,
    setActivePreset,
    ownerFocus,
    setOwnerFocus,
    dashTab,
    setDashTab,
    searchText,
    setSearchText,
    selectedStatuses,
    setSelectedStatuses,
    selectedAssignees,
    setSelectedAssignees,
    selectedTypes,
    setSelectedTypes,
    sortBy,
    setSortBy,
    detailsOpen,
    setDetailsOpen,
    detailsKey,
    setDetailsKey,
    documentationOpen,
    setDocumentationOpen,
    documentationTicket,
    setDocumentationTicket,
    resolutionOpen,
    setResolutionOpen,
    resolutionTicket,
    setResolutionTicket,
    resolutionProblem,
    setResolutionProblem,
    resolutionComment,
    setResolutionComment,
    resolutionDueDate,
    setResolutionDueDate,
    resolutionSaving,
    setResolutionSaving,
    resolutionErr,
    setResolutionErr,
    createIssueOpen,
    setCreateIssueOpen,
    colorMode,
    setColorMode,
    calendarFilter,
    setCalendarFilter,
    movingPersonalKeys,
    setMovingPersonalKeys,
    ownerAccountId,
    effectiveOwnerFocus,
    insightOwnerAccountId,
    insightOwnerFocus,
    effectiveActivePreset,
    poInsights,
    scopedViewData,
    scopedRawIssues,
    scopedDoneRows,
    scopedAlertas,
    scopedCriarCronograma,
    ticketMetaMap,
  };
}
