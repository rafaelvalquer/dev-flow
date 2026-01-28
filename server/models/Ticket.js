// server/models/Ticket.js
import mongoose from "mongoose";

const TicketSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, required: true },
    description: { type: String, default: "" },
    status: { type: String, trim: true, default: "Backlog", index: true },
    priority: { type: String, trim: true, default: "Medium", index: true },

    // vínculo com usuário interno (opcional)
    assigneeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    // se você quiser ligar com Jira
    jiraKey: { type: String, trim: true, index: true },

    dueDate: { type: Date },
    tags: [{ type: String, trim: true }],
  },
  { timestamps: true }
);

export default mongoose.models.Ticket || mongoose.model("Ticket", TicketSchema);
