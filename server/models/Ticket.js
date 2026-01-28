// server/models/Ticket.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const TicketSchema = new Schema(
  {
    ticketKey: { type: String, required: true, unique: true, index: true },

    // Snapshot opcional do Jira (não quebra nada se você não usar agora)
    jira: {
      id: String,
      projectId: String,
      summary: String,
      status: String,
      priority: String,
      updatedAt: Date,
      raw: Schema.Types.Mixed,
    },

    // Campos livres da sua aplicação (variáveis que você quiser persistir)
    data: { type: Schema.Types.Mixed },

    // Kanban
    kanban: {
      config: { type: Schema.Types.Mixed },
      updatedAt: Date,
      version: { type: Number, default: 1 },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Ticket", TicketSchema);
