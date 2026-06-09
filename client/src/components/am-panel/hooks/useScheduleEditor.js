import { useState } from "react";

import { ATIVIDADES_PADRAO } from "../../../utils/cronograma";
import {
  makeDefaultCronogramaDraft,
  saveCronogramaToJira,
} from "../../../lib/jiraPoView";

const STANDARD_CRONOGRAMA_IDS = new Set(
  ATIVIDADES_PADRAO.map((atividade) => atividade.id),
);

export default function useScheduleEditor({
  setLoading,
  setErr,
  refreshTicketAfterMutation,
  setSubView,
  formatJiraActionableError,
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorIssue, setEditorIssue] = useState(null);
  const [draft, setDraft] = useState([]);
  const [dueDateDraft, setDueDateDraft] = useState("");

  function openEditor(issue) {
    setEditorIssue(issue);
    setDraft(
      makeDefaultCronogramaDraft().map((atividade) => ({
        ...atividade,
        isCustom: !STANDARD_CRONOGRAMA_IDS.has(atividade.id),
      })),
    );
    setDueDateDraft(
      String(issue?.dueDateRaw || issue?.fields?.duedate || "").slice(0, 10),
    );
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorIssue(null);
    setDraft([]);
    setDueDateDraft("");
  }

  async function saveEditor(nextDraft = draft) {
    if (!editorIssue) return;
    setLoading(true);
    setErr("");
    try {
      await saveCronogramaToJira(editorIssue.key, nextDraft, {
        dueDate: dueDateDraft,
      });
      closeEditor();
      await refreshTicketAfterMutation(editorIssue.key);
      setSubView("calendario");
    } catch (e) {
      console.error(e);
      setErr(
        formatJiraActionableError(e, {
          type: "schedule",
          issueKey: editorIssue?.key,
          fallback: "Falha ao salvar cronograma no Jira.",
        }),
      );
    } finally {
      setLoading(false);
    }
  }

  return {
    editorOpen,
    editorIssue,
    draft,
    setDraft,
    dueDateDraft,
    setDueDateDraft,
    openEditor,
    closeEditor,
    saveEditor,
  };
}
