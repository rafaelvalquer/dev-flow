// server/models/Ticket.js
import mongoose from "mongoose";

const AutomationRuleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, default: "Regra" },
    enabled: { type: Boolean, default: true },
    trigger: { type: Object, default: {} }, // { type, params }
    conditions: { type: Object, default: {} }, // opcional
    actions: { type: [Object], default: [] }, // [{ type, params }]
  },
  { _id: false }
);

const AutomationExecutionSchema = new mongoose.Schema(
  {
    ruleId: { type: String, default: "" },
    eventKey: { type: String, default: "" }, // idempotência
    status: { type: String, enum: ["success", "error"], default: "success" },
    executedAt: { type: Date, default: Date.now },
    payload: { type: Object, default: {} },
    error: { type: String, default: "" },
  },
  { _id: false }
);

const AutomationSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
    updatedAt: { type: Date, default: Date.now },
    graph: { type: Object, default: {} }, // ReactFlow nodes/edges/viewport
    rules: { type: [AutomationRuleSchema], default: [] },
    state: { type: Object, default: {} }, // last seen statuses etc.
    executions: { type: [AutomationExecutionSchema], default: [] },
    errors: { type: [Object], default: [] }, // {at, ruleId, msg, stack}
  },
  { _id: false }
);

/**
 * Timesheet (dentro de ticket.kanban.timesheet)
 * - entries: apontamentos por dia/subtask/dev
 * - estimates: previsão por subtask (minutos)
 * - plansByDev: planejado por dev (minutos) — opcional
 */
const TimesheetEntrySchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // `${date}|${subtaskId}|${userKey}`
    date: { type: String, required: true }, // YYYY-MM-DD
    subtaskId: { type: String, required: true }, // id interno da subtask (kanban)
    jiraKey: { type: String, default: "" },

    userKey: { type: String, required: true }, // pode ser email, _id, jiraAccountId, etc
    userName: { type: String, default: "" },

    minutes: { type: Number, default: 0 }, // >= 0
    note: { type: String, default: "" },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const TimesheetSchema = new mongoose.Schema(
  {
    version: { type: Number, default: 1 },
    updatedAt: { type: Date, default: Date.now },

    // previsão por subtask: { [subtaskId]: minutes }
    estimates: { type: Map, of: Number, default: {} },

    // planejado por dev: { [userKey]: minutes }
    plansByDev: { type: Map, of: Number, default: {} },

    // apontamentos
    entries: { type: [TimesheetEntrySchema], default: [] },
  },
  { _id: false }
);

// Mantém compatibilidade com campos já existentes em kanban
const KanbanSchema = new mongoose.Schema(
  {
    config: { type: Object, default: {} },
    timesheet: { type: TimesheetSchema, default: {} },
  },
  { _id: false, strict: false }
);

const TicketSchema = new mongoose.Schema(
  {
    ticketKey: { type: String, required: true, unique: true, index: true },

    data: { type: Object, default: {} },
    jira: { type: Object, default: {} },

    // agora tipado, mas compatível (strict:false)
    kanban: { type: KanbanSchema, default: {} },

    summary: { type: String, default: "" },
    status: { type: String, default: "" },
    assignee: { type: String, default: "" },
  },
  { timestamps: true }
);

TicketSchema.methods.ensureAutomation = function ensureAutomation() {
  if (!this.data) this.data = {};
  if (!this.data.automation) this.data.automation = {};
  if (!this.data.automation.rules) this.data.automation.rules = [];
  return this.data.automation;
};

const Ticket = mongoose.models.Ticket || mongoose.model("Ticket", TicketSchema);

export default Ticket;
export {
  TicketSchema,
  AutomationSchema,
  KanbanSchema,
  TimesheetSchema,
  TimesheetEntrySchema,
};
