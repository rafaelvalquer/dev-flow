import { useCallback, useRef, useState } from "react";

import {
  buildPoView,
  fetchPoDoneLast30Days,
  fetchPoIssueDetail,
  fetchPoIssuesDetailedProgressive,
} from "../lib/jiraPoView";
import { toCalendarEvents } from "../utils/cronograma";

const EMPTY_VIEW_DATA = {
  alertas: [],
  criarCronograma: [],
  calendarioIssues: [],
  events: [],
};

const EMPTY_PROGRESS = {
  active: false,
  total: 0,
  completed: 0,
  loaded: 0,
  failed: 0,
};

function getIssueKey(issue) {
  return String(issue?.key || "")
    .trim()
    .toUpperCase();
}

export function mergeIssueByKey(list, issue) {
  const key = getIssueKey(issue);
  if (!key) return list || [];

  let found = false;
  const next = (list || []).map((item) => {
    if (getIssueKey(item) !== key) return item;
    found = true;
    return issue;
  });

  if (!found) next.push(issue);
  return next;
}

export function summarizeProgressiveLoadWarning(failures = [], doneError = null) {
  const parts = [];

  if (failures.length) {
    const keys = failures
      .slice(0, 6)
      .map((failure) => failure.key)
      .filter(Boolean)
      .join(", ");
    const more = failures.length > 6 ? ` e mais ${failures.length - 6}` : "";
    parts.push(
      `${failures.length} ticket${failures.length > 1 ? "s" : ""} não ${
        failures.length > 1 ? "carregaram" : "carregou"
      }${keys ? `: ${keys}${more}` : ""}.`,
    );
  }

  if (doneError) {
    parts.push(
      `Não foi possível atualizar os concluídos dos últimos 30 dias: ${
        doneError?.message || String(doneError)
      }`,
    );
  }

  return parts.join(" ");
}

export default function usePoJiraData() {
  const [loading, setLoading] = useState(false);
  const [reloadProgress, setReloadProgress] = useState(EMPTY_PROGRESS);
  const [err, setErr] = useState("");
  const [rawIssues, setRawIssues] = useState([]);
  const [rows, setRows] = useState([]);
  const [doneRows, setDoneRows] = useState([]);
  const [viewData, setViewData] = useState(EMPTY_VIEW_DATA);
  const reloadRunRef = useRef(0);
  const inFlightReloadRef = useRef(null);
  const loadedRef = useRef(false);

  const applyCronogramaPatchLocal = useCallback((issueKey, atividades) => {
    const ik = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!ik || !Array.isArray(atividades)) return;

    setRawIssues((prev) => {
      const next = (prev || []).map((issue) =>
        getIssueKey(issue) === ik ? { ...issue, atividades } : issue,
      );
      setViewData(buildPoView(next));
      return next;
    });

    setRows((prev) =>
      (prev || []).map((issue) =>
        getIssueKey(issue) === ik ? { ...issue, atividades } : issue,
      ),
    );

    setViewData((prev) => {
      const calendarioIssues = (prev?.calendarioIssues || []).map((issue) =>
        getIssueKey(issue) === ik ? { ...issue, atividades } : issue,
      );

      const issueEvents = toCalendarEvents(ik, atividades, new Date());
      const events = [
        ...(prev?.events || []).filter((event) => {
          const eventIssueKey = String(
            event?.extendedProps?.issueKey || event?.issueKey || "",
          )
            .trim()
            .toUpperCase();
          return eventIssueKey !== ik;
        }),
        ...issueEvents,
      ];

      return { ...prev, calendarioIssues, events };
    });
  }, []);

  const applyTicketStatusLocal = useCallback((issueKey, statusName) => {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    const nextStatus = String(statusName || "").trim();
    if (!key || !nextStatus) return;

    const patchIssue = (issue) => {
      if (getIssueKey(issue) !== key) return issue;
      return {
        ...issue,
        statusName: nextStatus,
        status:
          issue?.status && typeof issue.status === "object"
            ? { ...issue.status, name: nextStatus }
            : nextStatus,
        jira: {
          ...(issue?.jira || {}),
          status: nextStatus,
        },
        fields: {
          ...(issue?.fields || {}),
          status: {
            ...(issue?.fields?.status || {}),
            name: nextStatus,
          },
        },
      };
    };

    setRawIssues((prev) => {
      const next = (prev || []).map(patchIssue);
      setViewData(buildPoView(next));
      return next;
    });
    setRows((prev) => (prev || []).map(patchIssue));
  }, []);

  const refreshIssue = useCallback(async (issueKey) => {
    const key = String(issueKey || "")
      .trim()
      .toUpperCase();
    if (!key) return null;

    const issue = await fetchPoIssueDetail(key);

    setRawIssues((prev) => {
      const next = mergeIssueByKey(prev, issue);
      setViewData(buildPoView(next));
      return next;
    });
    setRows((prev) => mergeIssueByKey(prev, issue));

    return issue;
  }, []);

  const reload = useCallback(async () => {
    if (inFlightReloadRef.current) return inFlightReloadRef.current;

    const runId = reloadRunRef.current + 1;
    reloadRunRef.current = runId;
    const isCurrentRun = () => reloadRunRef.current === runId;

    setLoading(true);
    setErr("");
    setReloadProgress({ ...EMPTY_PROGRESS, active: true });

    const promise = (async () => {
      const donePromise = fetchPoDoneLast30Days().then(
        (data) => ({ data, error: null }),
        (error) => ({ data: null, error }),
      );

      try {
        const result = await fetchPoIssuesDetailedProgressive({
          concurrency: 8,
          onStart: ({ total }) => {
            if (!isCurrentRun()) return;
            setReloadProgress({
              active: true,
              total,
              completed: 0,
              loaded: 0,
              failed: 0,
            });
          },
          onIssue: (issue) => {
            if (!isCurrentRun()) return;
            setRawIssues((prev) => {
              const next = mergeIssueByKey(prev, issue);
              setViewData(buildPoView(next));
              return next;
            });
            setRows((prev) => mergeIssueByKey(prev, issue));
          },
          onProgress: (progress) => {
            if (!isCurrentRun()) return;
            setReloadProgress((prev) => ({
              ...prev,
              ...progress,
              active: true,
            }));
          },
        });

        const done = await donePromise;
        if (!isCurrentRun()) return null;

        setRawIssues(result.detailed);
        setViewData(buildPoView(result.detailed));
        setRows(result.detailed);
        if (!done.error) setDoneRows(done.data || []);

        loadedRef.current = true;
        setErr(summarizeProgressiveLoadWarning(result.failures || [], done.error));
        return { result, done };
      } catch (error) {
        console.error(error);
        if (isCurrentRun()) {
          setErr(error?.message || "Falha ao carregar dados do Jira.");
        }
        throw error;
      } finally {
        if (isCurrentRun()) {
          setLoading(false);
          setReloadProgress((prev) => ({ ...prev, active: false }));
        }
        inFlightReloadRef.current = null;
      }
    })();

    inFlightReloadRef.current = promise;
    return promise;
  }, []);

  const ensureLoaded = useCallback(() => {
    if (loadedRef.current) return Promise.resolve(null);
    return reload();
  }, [reload]);

  return {
    loading,
    setLoading,
    reloadProgress,
    err,
    setErr,
    rawIssues,
    rows,
    doneRows,
    viewData,
    setViewData,
    setRows,
    setDoneRows,
    reload,
    ensureLoaded,
    refreshIssue,
    applyCronogramaPatchLocal,
    applyTicketStatusLocal,
  };
}
