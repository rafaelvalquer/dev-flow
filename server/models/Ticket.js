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

const TicketSchema = new mongoose.Schema(
  {
    ticketKey: { type: String, required: true, unique: true, index: true },

    data: { type: Object, default: {} },
    jira: { type: Object, default: {} },
    kanban: { type: Object, default: {} },

    summary: { type: String, default: "" },
    status: { type: String, default: "" },
    assignee: { type: String, default: "" },

    // opcional: se quiser tipar data.automation no schema em vez de "Object"
    // data: {
    //   type: new mongoose.Schema({ automation: { type: AutomationSchema, default: {} } }, { _id: false }),
    //   default: {}
    // }
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
export { TicketSchema, AutomationSchema };
