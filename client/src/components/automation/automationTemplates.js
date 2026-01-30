export const TRIGGER_TYPES = [
  { key: "subtask.completed", label: "Subtarefa concluída" },
  { key: "subtask.overdue", label: "Subtarefa atrasada (até data)" },
  { key: "ticket.status.changed", label: "Status do ticket mudou" },
  { key: "ticket.status.equals", label: "Status do ticket = X" },
  { key: "ticket.status.notEquals", label: "Status do ticket ≠ X" },
  { key: "activity.start", label: "Início da atividade (cronograma)" },
  { key: "activity.overdue", label: "Atividade atrasou (cronograma)" },
  { key: "subtask.allCompleted", label: "Subtarefas: todas concluídas (AND)" },
];

export const ACTION_TYPES = [
  { key: "jira.comment", label: "Comentar no ticket" },
  { key: "jira.transition", label: "Transicionar status do ticket" },
  { key: "jira.assign", label: "Alterar responsável (Assignee)" },
];

export const AUTOMATION_PRESETS = [
  {
    id: "preset_subtask_done_comment",
    title: "Subtarefa concluída → comentar",
    trigger: { type: "subtask.completed", params: { subtaskKey: "" } },
    action: {
      type: "jira.comment",
      params: { text: "Subtarefa concluída: {subtaskTitle} ({subtaskKey})" },
    },
  },
  {
    id: "preset_subtask_done_transition",
    title: "Subtarefa concluída → transicionar ticket",
    trigger: { type: "subtask.completed", params: { subtaskKey: "" } },
    action: { type: "jira.transition", params: { toStatus: "" } },
  },
  {
    id: "preset_subtask_overdue_comment",
    title: "Subtarefa atrasada → comentar",
    trigger: {
      type: "subtask.overdue",
      params: { subtaskKey: "", dueDate: "" },
    },
    action: {
      type: "jira.comment",
      params: {
        text: "Subtarefa atrasada até {dueDate}: {subtaskTitle} ({subtaskKey})",
      },
    },
  },
  {
    id: "preset_ticket_status_changed_comment",
    title: "Status mudou → comentar",
    trigger: { type: "ticket.status.changed", params: {} },
    action: {
      type: "jira.comment",
      params: { text: "Status mudou: {prevStatus} → {currentStatus}" },
    },
  },
  {
    id: "preset_activity_start_comment",
    title: "Início da atividade → comentar",
    trigger: { type: "activity.start", params: { activityId: "" } },
    action: {
      type: "jira.comment",
      params: {
        text: "Início da atividade: {activityName} ({activityId}) - {activityStart}",
      },
    },
  },
  {
    id: "preset_activity_overdue_comment",
    title: "Atividade atrasou → comentar",
    trigger: { type: "activity.overdue", params: { activityId: "" } },
    action: {
      type: "jira.comment",
      params: {
        text: "Atividade atrasada: {activityName} ({activityId}) - fim {activityEnd}",
      },
    },
  },
  {
    id: "subtasks_all_done_comment",
    title: "Todas subtarefas concluídas → Comentar",
    icon: "CheckCircle2",
    trigger: { type: "subtask.allCompleted", params: { subtaskKeys: [] } },
    action: {
      type: "jira.comment",
      params: { text: "✅ Todas as subtarefas do grupo foram concluídas." },
    },
  },
];
